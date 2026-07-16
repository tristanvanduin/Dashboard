// L2 data-laag entreepunt: knoopt de L1-tabellen aan de rekenkern en de facts. De mappings van
// DB-rij naar compute-rij zijn puur en los testbaar; de Supabase-fetch en de orkestratie zijn
// LIVE-ONGETEST (pas met echte L1-data via MDP te verifieren). Gespiegeld op M2's analysis-data.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalMetricMap } from "@/lib/analysis/claim-consistency";
import { buildLinkedinStepFacts, type LinkedInPreparedInputs, type LinkedInStepFacts, type LinkedInCampaignMeta, type LinkedInCreativeMeta } from "./prepared-facts";
import { buildLinkedinCanonicalMetricMap } from "./canonical-map";
import type { LinkedInComputeRow } from "./prepared-compute";
import type { LinkedInDemographicRow, LinkedInPivotType } from "./types";
import type { LinkedInIcp } from "./icp-fit";

type DbRow = Record<string, unknown>;

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Pure mapping: een linkedin_account/campaign/creative_daily rij naar een compute-rij. Let op de
// hernoemingen: one_click_leads wordt leads, one_click_lead_form_opens wordt form_opens,
// external_website_conversions wordt conversions.
export function mapLinkedinDailyToComputeRow(row: DbRow, name?: string | null): LinkedInComputeRow {
  return {
    date: (row.date as string) ?? null,
    entityUrn: (row.entity_urn as string) ?? null,
    entityName: name ?? null,
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    spend: num(row.spend),
    leads: num(row.one_click_leads),
    form_opens: num(row.one_click_lead_form_opens),
    conversions: num(row.external_website_conversions),
    conversion_value: num(row.conversion_value),
  };
}

// Pure mapping: een linkedin_demographic_daily rij naar een demografie-rij.
export function mapLinkedinDemographicToComputeRow(row: DbRow): LinkedInDemographicRow {
  return {
    date: (row.date as string) ?? null,
    level: (row.level as string) ?? "",
    entityUrn: (row.entity_urn as string) ?? null,
    pivotType: row.pivot_type as LinkedInPivotType,
    pivotValueUrn: (row.pivot_value_urn as string) ?? "UNKNOWN",
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    spend: numOrNull(row.spend),
    leads: num(row.leads),
    conversions: num(row.conversions),
    coveragePct: numOrNull(row.coverage_pct),
  };
}

// De eerste dag van de maand 13 maanden voor periodEnd (het analyse-venster).
export function thirteenMonthStart(periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - 12, 1)).toISOString().slice(0, 10);
}

export interface LinkedInAnalysisData {
  canonicalMetricMap: CanonicalMetricMap;
  stepFacts: LinkedInStepFacts;
  periodStart: string;
  periodEnd: string;
}

// LIVE-ONGETEST. Haalt de L1-tabellen op, mapt ze naar compute-rijen, en orkestreert de rekenkern
// plus de facts. De cast via unknown is nodig omdat de select dynamisch is.
export async function buildLinkedinAnalysisData(
  supabase: SupabaseClient,
  clientId: string,
  periodEnd: string,
  options?: { icp?: LinkedInIcp | null; targets?: LinkedInPreparedInputs["targets"] }
): Promise<LinkedInAnalysisData> {
  const periodStart = thirteenMonthStart(periodEnd);

  const fetchDaily = async (table: string): Promise<DbRow[]> => {
    const { data } = await supabase.from(table).select("*").eq("client_id", clientId).gte("date", periodStart).lte("date", periodEnd);
    return (data ?? []) as unknown as DbRow[];
  };

  const [accountRaw, campaignRaw, creativeRaw, demoRaw] = await Promise.all([
    fetchDaily("linkedin_account_daily"),
    fetchDaily("linkedin_campaign_daily"),
    fetchDaily("linkedin_creative_daily"),
    fetchDaily("linkedin_demographic_daily"),
  ]);

  // Entiteit-metadata voor de stappen 2, 4, 7 en 8 (namen, objective, cost_type, format, audience).
  const { data: campaignMetaRaw } = await supabase.from("linkedin_campaigns").select("campaign_urn, name, objective_type, cost_type, bid_strategy, audience_count_estimate").eq("client_id", clientId);
  const { data: creativeMetaRaw } = await supabase.from("linkedin_creatives").select("creative_urn, format").eq("client_id", clientId);

  const campaignMeta: LinkedInCampaignMeta[] = ((campaignMetaRaw ?? []) as unknown as DbRow[]).map((r) => ({
    entityUrn: String(r.campaign_urn),
    name: (r.name as string) ?? null,
    objective: (r.objective_type as string) ?? null,
    cost_type: (r.cost_type as string) ?? null,
    bid_strategy: (r.bid_strategy as string) ?? null,
    audience_count: numOrNull(r.audience_count_estimate),
  }));
  const creativeMeta: LinkedInCreativeMeta[] = ((creativeMetaRaw ?? []) as unknown as DbRow[]).map((r) => ({
    entityUrn: String(r.creative_urn),
    format: (r.format as string) ?? null,
  }));

  const nameByUrn = new Map(campaignMeta.map((m) => [m.entityUrn, m.name ?? m.entityUrn]));

  const account = accountRaw.map((r) => mapLinkedinDailyToComputeRow(r));
  const campaigns = campaignRaw.map((r) => mapLinkedinDailyToComputeRow(r, nameByUrn.get(String(r.entity_urn))));
  const creatives = creativeRaw.map((r) => mapLinkedinDailyToComputeRow(r));
  const demographics = demoRaw.map((r) => mapLinkedinDemographicToComputeRow(r));

  const inputs: LinkedInPreparedInputs = { account, campaigns, creatives, demographics, campaignMeta, creativeMeta, icp: options?.icp, targets: options?.targets };
  const stepFacts = buildLinkedinStepFacts(inputs);
  const canonicalMetricMap = buildLinkedinCanonicalMetricMap(campaigns, account);

  return { canonicalMetricMap, stepFacts, periodStart, periodEnd };
}
