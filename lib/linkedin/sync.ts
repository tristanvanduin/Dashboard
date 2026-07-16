// =====================================================================
// STATUS: ORKESTRATIE BOUWT OP GEVERIFIEERDE KERNEN, MAAR DE HTTP-CALLS ZIJN
// LIVE-ONGETEST EN GATED OP MDP-APPROVAL. De restli-encoding, transform, vensters en
// rij-mapping zijn unit-getest; het adAnalytics-pad zelf is pas tegen een goedgekeurde app,
// een echte token en een echt account te verifieren (verifieer de velden per app-tier in
// Postman, zie de L1-preflight). Neem niet aan dat de sync live data binnenhaalt tot dat
// is bevestigd.
// =====================================================================
//
// Knoopt de L1-onderdelen aan elkaar: haal adAnalytics per niveau via twee veldensets (de
// circa 20-velden-limiet), merge ze, map met de transform, schrijf weg met de rij-mapping en
// upsert op de conflict-sleutel. Auth wordt door de aanroeper geresolved (zie auth.ts) en als
// accessToken doorgegeven; deze module bevat dus geen tokenopslag.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinkedInAnalyticsElement, LinkedInPivotType, LinkedInDemographicRow } from "./types";
import { mapAnalyticsElement, mapDemographicElement, buildCoverageSummaryRow, mergeFieldSets, dateRangeToIso } from "./transform";
import { linkedinDailyToDbRow, linkedinDemographicToDbRow, LINKEDIN_DAILY_CONFLICT, LINKEDIN_DEMOGRAPHIC_CONFLICT } from "./rows";
import { buildAnalyticsQuery, splitFieldSets } from "./restli";
import { trailingWindow, backfillWindow, monthlyChunks } from "./sync-windows";
import { logger } from "@/lib/logger";

// Pin een recente ondersteunde versie; verifieer in de docs bij een upgrade (versies
// verouderen na circa een jaar). Geen verspreide literals: alles via deze constante.
export const LINKEDIN_API_VERSION = "202506";
const REST_BASE = "https://api.linkedin.com/rest";

const log = logger.child("linkedin-sync");

export type LinkedInLevel = "account" | "campaign" | "creative";

const LEVEL_TABLE: Record<LinkedInLevel, string> = {
  account: "linkedin_account_daily",
  campaign: "linkedin_campaign_daily",
  creative: "linkedin_creative_daily",
};

const LEVEL_PIVOT: Record<LinkedInLevel, string> = {
  account: "ACCOUNT",
  campaign: "CAMPAIGN",
  creative: "CREATIVE",
};

// De metric-velden die we per pull vragen. De transform mapt deze naar getypeerde kolommen.
// splitFieldSets houdt elke call binnen de velden-limiet; mergeFieldSets voegt de sets samen.
const ANALYTICS_FIELDS = [
  "impressions", "clicks", "costInLocalCurrency", "landingPageClicks",
  "oneClickLeadFormOpens", "oneClickLeads", "externalWebsiteConversions",
  "externalWebsitePostClickConversions", "conversionValueInLocalCurrency",
  "videoStarts", "videoViews", "videoCompletions", "totalEngagements",
  "follows", "reactions", "comments", "shares",
];

const DEMOGRAPHIC_FIELDS = ["impressions", "clicks", "costInLocalCurrency", "oneClickLeads", "externalWebsiteConversions"];

export const LINKEDIN_PIVOT_TYPES: LinkedInPivotType[] = [
  "MEMBER_JOB_FUNCTION", "MEMBER_SENIORITY", "MEMBER_INDUSTRY",
  "MEMBER_COMPANY_SIZE", "MEMBER_REGION", "MEMBER_COUNTRY",
];

export interface SyncContext {
  supabase: SupabaseClient;
  clientId: string;
  accessToken: string;
}

function isoToDatePart(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

// LIVE-ONGETEST. Eén adAnalytics-call met versie-headers en Restli 2.0. 429 met backoff;
// tel de call voor de quota-logging. De vorm volgt de LinkedIn-docs (GET /adAnalytics met
// q=analytics, timeGranularity=DAILY, pivot, dateRange, fields, entiteit-List).
async function fetchAnalyticsPage(ctx: SyncContext, query: string, callCounter: { calls: number }): Promise<LinkedInAnalyticsElement[]> {
  const url = `${REST_BASE}/adAnalytics?${query}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    callCounter.calls += 1;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        "LinkedIn-Version": LINKEDIN_API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) {
      log.error("adAnalytics-call faalde:", res.status);
      return [];
    }
    const body = (await res.json()) as { elements?: LinkedInAnalyticsElement[] };
    return Array.isArray(body.elements) ? body.elements : [];
  }
  log.error("adAnalytics gaf 429 na alle pogingen");
  return [];
}

// LIVE-ONGETEST. Haalt de twee veldensets op (vanwege de velden-limiet) en merget ze per
// dag plus entiteit tot complete elementen.
async function fetchAnalytics(
  ctx: SyncContext,
  opts: { pivot: string; since: string; until: string; entities: string[]; fields: string[] },
  callCounter: { calls: number }
): Promise<LinkedInAnalyticsElement[]> {
  const sets = splitFieldSets(opts.fields, 18);
  let merged: LinkedInAnalyticsElement[] = [];
  for (const fieldSet of sets) {
    const query = buildAnalyticsQuery({
      pivot: opts.pivot,
      dateRange: { start: isoToDatePart(opts.since), end: isoToDatePart(opts.until) },
      fields: fieldSet,
      campaigns: opts.entities,
    });
    const page = await fetchAnalyticsPage(ctx, query, callCounter);
    merged = merged.length === 0 ? page : mergeFieldSets(merged, page);
  }
  return merged;
}

// Dedupliceert op de samengestelde sleutel voor we upserten, zodat een her-pull van dezelfde
// dag muteert in plaats van dupliceert.
function dedupeByKey(rows: Record<string, unknown>[], keyFields: string[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = keyFields.map((f) => String(row[f])).join("|");
    seen.set(key, row);
  }
  return [...seen.values()];
}

// Synct een niveau voor een venster: pull, merge, map, dedupe, upsert. Geeft het aantal rijen terug.
export async function syncLinkedinLevel(
  ctx: SyncContext,
  level: LinkedInLevel,
  entities: string[],
  since: string,
  until: string,
  callCounter: { calls: number } = { calls: 0 }
): Promise<number> {
  const elements = await fetchAnalytics(ctx, { pivot: LEVEL_PIVOT[level], since, until, entities, fields: ANALYTICS_FIELDS }, callCounter);
  const dbRows = elements.map((el) => linkedinDailyToDbRow(mapAnalyticsElement(el), ctx.clientId));
  const deduped = dedupeByKey(dbRows, ["client_id", "date", "entity_urn"]);
  if (deduped.length === 0) return 0;
  const { error } = await ctx.supabase.from(LEVEL_TABLE[level]).upsert(deduped, { onConflict: LINKEDIN_DAILY_CONFLICT, ignoreDuplicates: false });
  if (error) {
    log.error("Upsert mislukt voor", level, error.message);
    return 0;
  }
  return deduped.length;
}

// LIVE-ONGETEST. Synct de demografie voor een campagne over een venster: per pivot-type een
// aparte call (member-pivots zijn niet combineerbaar), map naar segmentrijen, en per dag een
// TOTAL-samenvattingsrij met coverage_pct op basis van de dag-totaalimpressies. De totalen
// per dag komen mee uit dailyTotals (de entiteit-dagrijen die al gesynct zijn).
export async function syncLinkedinDemographics(
  ctx: SyncContext,
  campaignUrn: string,
  since: string,
  until: string,
  dailyTotalsByDate: Map<string, number>,
  callCounter: { calls: number } = { calls: 0 }
): Promise<number> {
  const allRows: LinkedInDemographicRow[] = [];
  for (const pivotType of LINKEDIN_PIVOT_TYPES) {
    const elements = await fetchAnalytics(ctx, { pivot: pivotType, since, until, entities: [campaignUrn], fields: DEMOGRAPHIC_FIELDS }, callCounter);
    const segments = elements.map((el) => mapDemographicElement(el, { level: "CAMPAIGN", entityUrn: campaignUrn, pivotType }));
    allRows.push(...segments);

    // Per dag een TOTAL-samenvattingsrij met coverage_pct.
    const byDate = new Map<string, LinkedInDemographicRow[]>();
    for (const seg of segments) {
      if (!seg.date) continue;
      const list = byDate.get(seg.date) ?? [];
      list.push(seg);
      byDate.set(seg.date, list);
    }
    for (const [date, daySegments] of byDate) {
      const total = dailyTotalsByDate.get(date) ?? 0;
      allRows.push(buildCoverageSummaryRow(daySegments, total, { date, level: "CAMPAIGN", entityUrn: campaignUrn, pivotType }));
    }
  }
  const dbRows = allRows.map((row) => linkedinDemographicToDbRow(row, ctx.clientId));
  const deduped = dedupeByKey(dbRows, ["client_id", "date", "level", "entity_urn", "pivot_type", "pivot_value_urn"]);
  if (deduped.length === 0) return 0;
  const { error } = await ctx.supabase.from("linkedin_demographic_daily").upsert(deduped, { onConflict: LINKEDIN_DEMOGRAPHIC_CONFLICT, ignoreDuplicates: false });
  if (error) {
    log.error("Demografie-upsert mislukt:", error.message);
    return 0;
  }
  return deduped.length;
}

// Daily incremental: de drie niveaus over het trailing venster van 30 dagen (attributie-herstatement).
export async function syncLinkedinDaily(
  ctx: SyncContext,
  endDate: string,
  entitiesByLevel: Record<LinkedInLevel, string[]>
): Promise<Record<LinkedInLevel, number>> {
  const { since, until } = trailingWindow(endDate, 30);
  const result = {} as Record<LinkedInLevel, number>;
  for (const level of ["account", "campaign", "creative"] as LinkedInLevel[]) {
    result[level] = await syncLinkedinLevel(ctx, level, entitiesByLevel[level], since, until);
  }
  return result;
}

// Initiele backfill: 13 maanden, in maand-chunks om de async-pulls en de dagelijkse app-quota
// behapbaar te houden.
export async function syncLinkedinBackfill(
  ctx: SyncContext,
  endDate: string,
  entitiesByLevel: Record<LinkedInLevel, string[]>
): Promise<number> {
  const { since, until } = backfillWindow(endDate, 13);
  let total = 0;
  for (const chunk of monthlyChunks(since, until)) {
    for (const level of ["account", "campaign", "creative"] as LinkedInLevel[]) {
      total += await syncLinkedinLevel(ctx, level, entitiesByLevel[level], chunk.since, chunk.until);
    }
  }
  return total;
}

// Helper voor de demografie-coverage: bouwt de dag-totaalimpressies uit reeds gesynct
// campagne-dagrijen, zodat coverage_pct tegen het juiste totaal wordt berekend.
export function dailyTotalsFromElements(elements: LinkedInAnalyticsElement[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const el of elements) {
    const date = dateRangeToIso(el.dateRange);
    if (!date) continue;
    const imp = typeof el.impressions === "number" ? el.impressions : Number(el.impressions ?? 0);
    totals.set(date, (totals.get(date) ?? 0) + (Number.isFinite(imp) ? imp : 0));
  }
  return totals;
}
