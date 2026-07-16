// =====================================================================
// STATUS: ORKESTRATIE BOUWT OP GEVERIFIEERDE KERNEN, MAAR DE HTTP-CALLS ZIJN
// LIVE-ONGETEST. De transform, vensters en rij-mapping zijn unit-getest; het async
// insights-pad zelf is pas tegen een echte token en account te verifieren. Neem niet
// aan dat de sync live data binnenhaalt tot dat is bevestigd.
// =====================================================================
//
// Knoopt de M1-onderdelen aan elkaar: haal insights per niveau via het async-pad,
// map met de transform, schrijf weg met de rij-mapping en upsert op de conflict-sleutel.
// Auth wordt door de aanroeper geresolved volgens het Google-secret-patroon (credentials
// naar access_token) en als accessToken plus accountId doorgegeven; deze module bevat
// dus geen tokenopslag.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaInsightsRow } from "./types";
import { mapInsightsRow } from "./transform";
import { metaDailyToDbRow, META_DAILY_CONFLICT } from "./rows";
import { trailingWindow, backfillWindow, monthlyChunks } from "./sync-windows";
import { logger } from "@/lib/logger";

// Per juni 2026 v25 (Graph en Marketing API). Pin hier; verifieer bij een upgrade de
// changelog, met name de views-metric die reach vervangt en de Advantage+ read-only-shift.
export const META_API_VERSION = "v25.0";
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

const log = logger.child("meta-sync");

export type MetaLevel = "account" | "campaign" | "adset" | "ad";

const LEVEL_TABLE: Record<MetaLevel, string> = {
  account: "meta_account_daily",
  campaign: "meta_campaign_daily",
  adset: "meta_adset_daily",
  ad: "meta_ad_daily",
};

// De velden die we per insights-pull vragen. De transform mapt deze naar getypeerde kolommen.
const INSIGHTS_FIELDS = [
  "impressions", "reach", "frequency", "clicks", "inline_link_clicks", "spend", "cpm", "cpc", "ctr",
  "actions", "action_values", "purchase_roas",
  "video_3sec_watched_actions", "video_thruplay_watched_actions",
  "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions", "video_p100_watched_actions",
  "quality_ranking", "engagement_rate_ranking", "conversion_rate_ranking",
].join(",");

export interface SyncContext {
  supabase: SupabaseClient;
  clientId: string;
  accountId: string; // act_XXXX
  accessToken: string;
}

// LIVE-ONGETEST. Het async insights-pad: maak een report_run_id, poll tot klaar, haal
// de resultaten op. De vorm volgt de Meta-docs (POST /act_<id>/insights met level,
// time_increment=1, time_range, fields, breakdowns; poll; GET). Tegen een echte account
// te verifieren; tot dan een dunne, expliciet gemarkeerde grens.
export async function fetchInsightsAsync(
  ctx: SyncContext,
  opts: { level: MetaLevel; since: string; until: string; breakdowns?: string }
): Promise<MetaInsightsRow[]> {
  const params = new URLSearchParams({
    level: opts.level,
    time_increment: "1",
    time_range: JSON.stringify({ since: opts.since, until: opts.until }),
    fields: INSIGHTS_FIELDS,
    access_token: ctx.accessToken,
  });
  if (opts.breakdowns) params.set("breakdowns", opts.breakdowns);

  const createRes = await fetch(`${GRAPH}/${ctx.accountId}/insights`, { method: "POST", body: params });
  const created = (await createRes.json()) as { report_run_id?: string; error?: { message?: string } };
  if (!created.report_run_id) {
    log.error("Geen report_run_id van Meta:", created.error?.message ?? "onbekend");
    return [];
  }

  // Poll tot het rapport klaar is (max een redelijk aantal pogingen).
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`${GRAPH}/${created.report_run_id}?access_token=${ctx.accessToken}`);
    const status = (await statusRes.json()) as { async_status?: string; async_percent_completion?: number };
    if (status.async_status === "Job Completed") break;
    if (status.async_status === "Job Failed") {
      log.error("Meta insights-job faalde voor", opts.level, opts.since, opts.until);
      return [];
    }
  }

  // Haal de resultaten op met paginatie.
  const rows: MetaInsightsRow[] = [];
  let next: string | null = `${GRAPH}/${created.report_run_id}/insights?limit=500&access_token=${ctx.accessToken}`;
  while (next) {
    const page = (await (await fetch(next)).json()) as { data?: MetaInsightsRow[]; paging?: { next?: string } };
    if (Array.isArray(page.data)) rows.push(...page.data);
    next = page.paging?.next ?? null;
  }
  return rows;
}

// Dedupliceert op de samengestelde sleutel voor we upserten (zelfde discipline als de
// Google-orchestrator), zodat een her-pull van dezelfde dag muteert in plaats van dupliceert.
function dedupeByKey(rows: Record<string, unknown>[], keyFields: string[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = keyFields.map((f) => String(row[f])).join("|");
    seen.set(key, row); // laatste wint
  }
  return [...seen.values()];
}

// Synct een niveau voor een venster: pull, map, dedupe, upsert. Geeft het aantal rijen terug.
export async function syncMetaLevel(ctx: SyncContext, level: MetaLevel, since: string, until: string): Promise<number> {
  const insights = await fetchInsightsAsync(ctx, { level, since, until });
  const dbRows = insights.map((r) => metaDailyToDbRow(mapInsightsRow(r), ctx.clientId, { includeRankings: level === "ad" }));
  const deduped = dedupeByKey(dbRows, ["client_id", "date", "entity_id"]);
  if (deduped.length === 0) return 0;
  const { error } = await ctx.supabase.from(LEVEL_TABLE[level]).upsert(deduped, { onConflict: META_DAILY_CONFLICT, ignoreDuplicates: false });
  if (error) {
    log.error("Upsert mislukt voor", level, error.message);
    return 0;
  }
  return deduped.length;
}

// Daily incremental: alle vier de niveaus over het 28-daagse trailing venster (attributie-herstatement).
export async function syncMetaDaily(ctx: SyncContext, endDate: string): Promise<Record<MetaLevel, number>> {
  const { since, until } = trailingWindow(endDate, 28);
  const result = {} as Record<MetaLevel, number>;
  for (const level of ["account", "campaign", "adset", "ad"] as MetaLevel[]) {
    result[level] = await syncMetaLevel(ctx, level, since, until);
  }
  return result;
}

// Initiele backfill: 13 maanden, in maand-chunks om de async-pulls behapbaar te houden.
export async function syncMetaBackfill(ctx: SyncContext, endDate: string): Promise<number> {
  const { since, until } = backfillWindow(endDate, 13);
  let total = 0;
  for (const chunk of monthlyChunks(since, until)) {
    for (const level of ["account", "campaign", "adset", "ad"] as MetaLevel[]) {
      total += await syncMetaLevel(ctx, level, chunk.since, chunk.until);
    }
  }
  return total;
}
