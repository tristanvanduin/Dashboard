// M2 data-laag (entreepunt): de brug tussen de M1-tabellen en de rekenkern. Twee lagen:
//   1. Pure mapping van DB-rijen (snake_case) naar de compute-rij. Volledig op fixtures te testen.
//   2. De Supabase-fetch en de orkestratie naar canonical map en per-stap facts. De fetch is de
//      LIVE-ONGETESTE grens (zelfde status als de M1-sync-HTTP): pas tegen live Meta-data te
//      verifieren. De route roept buildMetaAnalysisData aan voor kanaal meta_ads.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMetaStepFacts, type MetaBreakdownComputeRow, type MetaStepFacts } from "./prepared-facts";
import { buildMetaCanonicalMetricMap } from "./canonical-map";
import type { MetaComputeRow } from "./prepared-compute";
import type { CanonicalMetricMap } from "@/lib/analysis/claim-consistency";

type DbRow = Record<string, unknown>;

function num(value: unknown): number {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

// --- Laag 1: pure mapping (getest) ---

// Een meta_*_daily-rij naar de compute-rij. De entity_name komt los uit de entiteit-tabel,
// omdat de daily-tabellen die niet bevatten.
export function mapMetaDailyToComputeRow(row: DbRow, name?: string): MetaComputeRow {
  return {
    date: String(row.date ?? ""),
    entity_id: String(row.entity_id ?? ""),
    entity_name: name,
    impressions: num(row.impressions),
    spend: num(row.spend),
    link_clicks: num(row.link_clicks),
    conversions: num(row.conversions),
    conversion_value: num(row.conversion_value),
    reach: numOrNull(row.reach),
    frequency: numOrNull(row.frequency),
    video_3s_views: numOrNull(row.video_3s_views),
    video_thruplays: numOrNull(row.video_thruplay),
    landing_page_views: numOrNull(row.landing_page_views),
    add_to_cart: numOrNull(row.add_to_cart),
    initiate_checkout: numOrNull(row.initiate_checkout),
  };
}

export function mapMetaBreakdownToComputeRow(row: DbRow): MetaBreakdownComputeRow {
  return {
    date: String(row.date ?? ""),
    breakdown_type: String(row.breakdown_type ?? ""),
    breakdown_value: String(row.breakdown_value ?? ""),
    impressions: num(row.impressions),
    spend: num(row.spend),
    link_clicks: num(row.link_clicks),
    conversions: num(row.conversions),
    conversion_value: num(row.conversion_value),
  };
}

// De startdatum van het 13-maands venster dat eindigt op periodEnd (YYYY-MM-DD).
export function thirteenMonthStart(periodEnd: string): string {
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 12, 1));
  return start.toISOString().slice(0, 10);
}

// --- Laag 2: fetch en orkestratie (LIVE-ONGETEST aan de fetch-grens) ---

// Bouwt een entity_id -> naam map uit een entiteit-tabel (meta_campaigns/meta_adsets/meta_ads).
async function fetchNameMap(supabase: SupabaseClient, clientId: string, table: string, nameColumn: string): Promise<Map<string, string>> {
  const { data } = await supabase.from(table).select(`entity_id, ${nameColumn}`).eq("client_id", clientId);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as unknown as DbRow[]) {
    const id = String(row.entity_id ?? "");
    const name = String((row as Record<string, unknown>)[nameColumn] ?? "");
    if (id && name) map.set(id, name);
  }
  return map;
}

async function fetchDaily(supabase: SupabaseClient, clientId: string, table: string, start: string, end: string): Promise<DbRow[]> {
  const { data } = await supabase.from(table).select("*").eq("client_id", clientId).gte("date", start).lte("date", end);
  return (data ?? []) as DbRow[];
}

export interface MetaAnalysisData {
  canonicalMetricMap: CanonicalMetricMap;
  stepFacts: MetaStepFacts;
}

// Haalt de M1-rijen op, mapt ze, en levert de canonical map plus de per-stap facts.
// LIVE-ONGETEST: de fetch tegen de meta_*-tabellen is pas met live data te verifieren; de
// mapping en de rekenlaag eronder zijn wel gedekt door fixtures.
export async function buildMetaAnalysisData(
  supabase: SupabaseClient,
  clientId: string,
  periodEnd: string,
  targets?: { roasTarget?: number | null; cpaTarget?: number | null }
): Promise<MetaAnalysisData> {
  const start = thirteenMonthStart(periodEnd);

  const [campaignNames, adsetNames, adNames] = await Promise.all([
    fetchNameMap(supabase, clientId, "meta_campaigns", "campaign_name"),
    fetchNameMap(supabase, clientId, "meta_adsets", "adset_name"),
    fetchNameMap(supabase, clientId, "meta_ads", "ad_name"),
  ]);

  const [accountRaw, campaignRaw, adsetRaw, adRaw, breakdownRaw] = await Promise.all([
    fetchDaily(supabase, clientId, "meta_account_daily", start, periodEnd),
    fetchDaily(supabase, clientId, "meta_campaign_daily", start, periodEnd),
    fetchDaily(supabase, clientId, "meta_adset_daily", start, periodEnd),
    fetchDaily(supabase, clientId, "meta_ad_daily", start, periodEnd),
    fetchDaily(supabase, clientId, "meta_breakdown_daily", start, periodEnd),
  ]);

  const account = accountRaw.map((r) => mapMetaDailyToComputeRow(r));
  const campaigns = campaignRaw.map((r) => mapMetaDailyToComputeRow(r, campaignNames.get(String(r.entity_id ?? ""))));
  const adsets = adsetRaw.map((r) => mapMetaDailyToComputeRow(r, adsetNames.get(String(r.entity_id ?? ""))));
  const ads = adRaw.map((r) => mapMetaDailyToComputeRow(r, adNames.get(String(r.entity_id ?? ""))));
  const breakdowns = breakdownRaw.map(mapMetaBreakdownToComputeRow);

  const canonicalMetricMap = buildMetaCanonicalMetricMap(campaigns, account);
  const stepFacts = buildMetaStepFacts({ account, campaigns, adsets, ads, breakdowns, targets });

  return { canonicalMetricMap, stepFacts };
}
