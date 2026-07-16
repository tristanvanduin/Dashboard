// =====================================================================
// STATUS: DE TARGETING-CONDENSATIE EN DB-MAPPERS ZIJN PUUR EN GETEST; DE FETCH-CALLS
// ZIJN LIVE-ONGETEST EN GATED OP MDP-APPROVAL. De entiteit-endpoints en de post-content
// permissies zijn pas tegen een echte app en account te verifieren. Neem niet aan dat de
// fetch live entiteiten binnenhaalt tot dat is bevestigd.
// =====================================================================
//
// Campaign groups, campagnes (met targetingCriteria gecondenseerd naar targeting_summary) en
// creatives plus post-content waar de permissies het toelaten. Auth wordt door de aanroeper
// geresolved en als accessToken doorgegeven.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { LINKEDIN_API_VERSION } from "./sync";

const REST_BASE = "https://api.linkedin.com/rest";
const log = logger.child("linkedin-entities");

export interface TargetingSummary {
  locations: string[];
  functions: string[];
  seniorities: string[];
  industries: string[];
  company_sizes: string[];
  audiences: string[];
  exclusions: string[];
}

// Welke targeting-facet-URN naar welke samenvattingssleutel mapt. Onbekende facets bij
// include vallen weg uit de samenvatting (blijven in raw); bij exclude tellen ze als uitsluiting.
const FACET_KEY: Record<string, keyof Omit<TargetingSummary, "exclusions">> = {
  "urn:li:adTargetingFacet:locations": "locations",
  "urn:li:adTargetingFacet:titles": "functions",
  "urn:li:adTargetingFacet:functions": "functions",
  "urn:li:adTargetingFacet:jobFunctions": "functions",
  "urn:li:adTargetingFacet:seniorities": "seniorities",
  "urn:li:adTargetingFacet:industries": "industries",
  "urn:li:adTargetingFacet:staffCountRanges": "company_sizes",
  "urn:li:adTargetingFacet:audienceMatchingSegments": "audiences",
};

interface TargetingClause {
  or?: Record<string, unknown>;
  [key: string]: unknown;
}
interface TargetingCriteria {
  include?: { and?: TargetingClause[] };
  exclude?: TargetingClause;
  [key: string]: unknown;
}

// Pure condensatie van een targetingCriteria-blok naar een platte samenvatting. Loopt de
// include-and-clauses (elk een or met een facet) en de exclude door. Dedupliceert per sleutel.
export function condenseTargetingCriteria(criteria: TargetingCriteria | null | undefined): TargetingSummary {
  const summary: TargetingSummary = {
    locations: [], functions: [], seniorities: [], industries: [], company_sizes: [], audiences: [], exclusions: [],
  };
  const pushUnique = (arr: string[], values: unknown): void => {
    if (!Array.isArray(values)) return;
    for (const v of values) {
      const s = String(v);
      if (!arr.includes(s)) arr.push(s);
    }
  };
  const collect = (clause: TargetingClause | undefined, mode: "include" | "exclude"): void => {
    const block = (clause?.or ?? clause) as Record<string, unknown> | undefined;
    if (!block || typeof block !== "object") return;
    for (const [facetUrn, values] of Object.entries(block)) {
      const key = FACET_KEY[facetUrn];
      if (mode === "include" && key) pushUnique(summary[key], values);
      else if (mode === "exclude") pushUnique(summary.exclusions, values);
    }
  };
  for (const clause of criteria?.include?.and ?? []) collect(clause, "include");
  if (criteria?.exclude) collect(criteria.exclude, "exclude");
  return summary;
}

// ── Pure DB-rij-mappers ─────────────────────────────────────────────────────────

export function campaignGroupToDbRow(group: Record<string, unknown>, clientId: string): Record<string, unknown> {
  const runSchedule = (group.runSchedule ?? {}) as { start?: number; end?: number };
  return {
    group_urn: group.id ?? group.urn,
    client_id: clientId,
    name: group.name ?? null,
    status: group.status ?? null,
    total_budget: typeof group.totalBudget === "object" ? Number((group.totalBudget as { amount?: string }).amount ?? null) : null,
    start_date: runSchedule.start ? new Date(runSchedule.start).toISOString().slice(0, 10) : null,
    end_date: runSchedule.end ? new Date(runSchedule.end).toISOString().slice(0, 10) : null,
    raw: group,
    updated_at: new Date().toISOString(),
  };
}

export function campaignToDbRow(campaign: Record<string, unknown>, clientId: string): Record<string, unknown> {
  const unitCost = (campaign.unitCost ?? {}) as { amount?: string };
  const dailyBudget = (campaign.dailyBudget ?? {}) as { amount?: string };
  return {
    campaign_urn: campaign.id ?? campaign.urn,
    group_urn: campaign.campaignGroup ?? null,
    client_id: clientId,
    name: campaign.name ?? null,
    status: campaign.status ?? null,
    type: campaign.type ?? null,
    objective_type: campaign.objectiveType ?? null,
    cost_type: campaign.costType ?? null,
    daily_budget: dailyBudget.amount != null ? Number(dailyBudget.amount) : null,
    unit_cost: unitCost.amount != null ? Number(unitCost.amount) : null,
    bid_strategy: campaign.bidStrategy ?? null,
    offsite_delivery_enabled: campaign.offsiteDeliveryEnabled ?? null,
    targeting_summary: condenseTargetingCriteria(campaign.targetingCriteria as TargetingCriteria),
    audience_count_estimate: null,
    raw: campaign,
    updated_at: new Date().toISOString(),
  };
}

export function creativeToDbRow(creative: Record<string, unknown>, clientId: string): Record<string, unknown> {
  return {
    creative_urn: creative.id ?? creative.urn,
    campaign_urn: creative.campaign ?? null,
    client_id: clientId,
    status: creative.status ?? null,
    format: creative.format ?? null,
    post_urn: creative.content && typeof creative.content === "object" ? (creative.content as { reference?: string }).reference ?? null : null,
    post_text: null,
    headline: null,
    cta_label: null,
    landing_url: null,
    image_storage_path: null,
    raw: creative,
    updated_at: new Date().toISOString(),
  };
}

// ── Live-ongeteste fetch ─────────────────────────────────────────────────────────

interface FetchContext {
  accessToken: string;
}

async function getJson(ctx: FetchContext, path: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${REST_BASE}/${path}`, {
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      "LinkedIn-Version": LINKEDIN_API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  if (!res.ok) {
    log.error("Entiteit-fetch faalde:", path, res.status);
    return [];
  }
  const body = (await res.json()) as { elements?: Record<string, unknown>[] };
  return Array.isArray(body.elements) ? body.elements : [];
}

// LIVE-ONGETEST. Haalt campaign groups, campagnes en creatives op voor een ad-account. De
// exacte finder-paden en query-parameters horen per de preflight in Postman geverifieerd te
// worden voor de app-tier.
export async function fetchCampaignGroups(ctx: FetchContext, accountUrn: string): Promise<Record<string, unknown>[]> {
  return getJson(ctx, `adCampaignGroups?q=search&search=(account:(values:List(${encodeURIComponent(accountUrn)})))`);
}
export async function fetchCampaigns(ctx: FetchContext, accountUrn: string): Promise<Record<string, unknown>[]> {
  return getJson(ctx, `adCampaigns?q=search&search=(account:(values:List(${encodeURIComponent(accountUrn)})))`);
}
export async function fetchCreatives(ctx: FetchContext, campaignUrn: string): Promise<Record<string, unknown>[]> {
  return getJson(ctx, `creatives?q=criteria&campaign=${encodeURIComponent(campaignUrn)}`);
}
