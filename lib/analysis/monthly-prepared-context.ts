import type { SupabaseClient } from "@supabase/supabase-js";
import { computeAnalysisTargets } from "@/lib/analysis/compute-targets";
import {
  computeCampaignMomFacts,
  computeComparisonFacts,
  computeCampaignComparisonFacts,
  computeAdGroupComparisonFacts,
  formatCampaignComparisonTable,
  formatComparisonFacts,
} from "@/lib/analysis/comparison-facts";
import { checkStepDataAvailability, type StepDataAvailability } from "@/lib/analysis/data-availability";
import {
  computeDecisionRules,
  type DecisionRulesOutput,
  type DecisionRuleCampaignRow,
  type DecisionRuleDeviceRow,
  type DecisionRuleGeoRow,
} from "@/lib/analysis/decision-rules";
import { computeCampaignKpiChains, computeKpiChain, type KpiChain } from "@/lib/analysis/kpi-chain";
import { fetchClientContext, fmt, monthsAgo } from "@/lib/analysis/helpers";

export interface AnalysisPreparedContextRow {
  id?: string;
  client_id: string;
  analysis_date: string;
  prepared_at?: string;
  decision_rules: DecisionRulesOutput;
  kpi_chain_account: KpiChain;
  kpi_chains_campaigns: KpiChain[];
  comparison_facts_campaigns: ReturnType<typeof computeCampaignComparisonFacts>;
  comparison_facts_adgroups: ReturnType<typeof computeAdGroupComparisonFacts>;
  binding_facts_text: string;
  kpi_chain_text: string;
  campaign_table_text: string;
  data_availability: StepDataAvailability[];
}

export interface MonthlyPreparedInputs {
  analysisYear: number;
  lastCompleteMonth: number;
  periodStart: string;
  periodEnd: string;
  accountData: Record<string, unknown>[];
  weeklyData: Record<string, unknown>[];
  campaignData: Record<string, unknown>[];
  adgroupData: Record<string, unknown>[];
  isData: Record<string, unknown>[];
  searchData: Record<string, unknown>[];
  accountYoyData: Record<string, unknown>[];
  campaignYoyData: Record<string, unknown>[];
  campaignMetaData: Record<string, unknown>[];
  creativeData: Record<string, unknown>[];
  audienceData: Record<string, unknown>[];
  deviceData: Record<string, unknown>[];
  countryData: Record<string, unknown>[];
  countryYoyData: Record<string, unknown>[];
  networkData: Record<string, unknown>[];
  scheduleData: Record<string, unknown>[];
  productData: Record<string, unknown>[];
  keywordData: Record<string, unknown>[];
  enrichedProductData: Record<string, unknown>[];
  checkoutData: Record<string, unknown>[];
  goalsSection: string;
  accountType: Awaited<ReturnType<typeof fetchClientContext>>["accountType"];
  targetResult: Awaited<ReturnType<typeof computeAnalysisTargets>> | null;
}

type CampaignKpiRow = {
  campaign_name: string;
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
};

type CampaignComparisonRow = CampaignKpiRow & {
  cost_per_conversion?: number;
  roas?: number;
};

type AdGroupComparisonRow = {
  ad_group_name: string;
  campaign_name: string;
  month: string;
  cost: number;
  conversions: number;
  conversions_value: number;
  clicks: number;
  impressions: number;
  cost_per_conversion?: number;
  roas?: number;
};

function computeAnalysisWindow() {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const analysisYear = currentMonth === 1 ? now.getFullYear() - 1 : now.getFullYear();
  const lastCompleteMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const periodEndDate = new Date(analysisYear, lastCompleteMonth, 0);
  return {
    analysisYear,
    lastCompleteMonth,
    periodEnd: fmt(periodEndDate),
    periodStart: monthsAgo(13),
  };
}

async function fetchSectorBenchmarks(
  supabase: SupabaseClient,
  clientId: string,
  accountType: MonthlyPreparedInputs["accountType"]
) {
  const { data: clientSectorData } = await supabase
    .from("client_settings")
    .select("sector")
    .eq("client_id", clientId)
    .maybeSingle();
  const sectorKey = clientSectorData?.sector || (accountType.startsWith("ecommerce") ? "ecommerce_mid_ticket" : accountType.startsWith("leadgen") ? "leadgen_generiek" : null);
  if (!sectorKey) return [];
  const { data } = await supabase
    .from("benchmark_sectors")
    .select("metric, low, median, high, top10")
    .eq("sector", sectorKey);
  return (data ?? []) as Array<{ metric: string; low: number; median: number; high: number; top10: number }>;
}

export async function fetchMonthlyPreparedInputs(
  supabase: SupabaseClient,
  clientId: string
): Promise<MonthlyPreparedInputs> {
  const { analysisYear, lastCompleteMonth, periodStart, periodEnd } = computeAnalysisWindow();
  const [
    accountRes, weeklyRes, campaignRes, adgroupRes, isRes, searchRes,
    accountYoyRes, campaignYoyRes, campaignMetaRes,
    creativeRes, audienceRes, deviceRes, countryRes, countryYoyRes, networkRes, scheduleRes, productRes,
    keywordRes, enrichedProductRes, checkoutRes,
    clientCtx, targetResult,
  ] = await Promise.all([
    supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).lte("month", periodEnd).order("month"),
    supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).gte("week_start", monthsAgo(2)).lte("week_start", periodEnd).order("week_start"),
    supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).lte("month", periodEnd).order("month"),
    supabase.from("ads_adgroup_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).lte("month", periodEnd).order("month"),
    supabase.from("ads_campaign_impression_share").select("*").eq("client_id", clientId).gte("month", monthsAgo(6)).lte("month", periodEnd).order("month"),
    supabase.from("ads_search_terms_wasteful").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(500),
    supabase.from("ads_account_yoy").select("*").eq("client_id", clientId).lte("month", periodEnd).order("month"),
    supabase.from("ads_campaign_yoy").select("*").eq("client_id", clientId).lte("month", periodEnd).order("month"),
    supabase.from("ads_campaign_metadata").select("*").eq("client_id", clientId),
    supabase.from("ads_creative_performance").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("impressions", { ascending: false }).limit(100),
    supabase.from("ads_audience_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(100),
    supabase.from("ads_device_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("month"),
    supabase.from("ads_country_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(6)).lte("month", periodEnd).order("month"),
    supabase.from("ads_country_yoy").select("*").eq("client_id", clientId).lte("month", periodEnd),
    supabase.from("ads_network_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(100),
    supabase.from("ads_ad_schedule_performance").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(200),
    supabase.from("ads_product_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(200),
    supabase.from("ads_keyword_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(300),
    supabase.from("google_ads_product_performance").select("*").eq("client_id", clientId).gte("date", monthsAgo(3)).lte("date", periodEnd).order("cost", { ascending: false }).limit(300),
    supabase.from("google_ads_checkout_funnel").select("*").eq("client_id", clientId).gte("date", monthsAgo(3)).lte("date", periodEnd).order("date"),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId),
  ]);

  return {
    analysisYear,
    lastCompleteMonth,
    periodStart,
    periodEnd,
    accountData: (accountRes.data ?? []) as Record<string, unknown>[],
    weeklyData: (weeklyRes.data ?? []) as Record<string, unknown>[],
    campaignData: (campaignRes.data ?? []) as Record<string, unknown>[],
    adgroupData: (adgroupRes.data ?? []) as Record<string, unknown>[],
    isData: (isRes.data ?? []) as Record<string, unknown>[],
    searchData: (searchRes.data ?? []) as Record<string, unknown>[],
    accountYoyData: (accountYoyRes.data ?? []) as Record<string, unknown>[],
    campaignYoyData: (campaignYoyRes.data ?? []) as Record<string, unknown>[],
    campaignMetaData: (campaignMetaRes.data ?? []) as Record<string, unknown>[],
    creativeData: (creativeRes.data ?? []) as Record<string, unknown>[],
    audienceData: (audienceRes.data ?? []) as Record<string, unknown>[],
    deviceData: (deviceRes.data ?? []) as Record<string, unknown>[],
    countryData: (countryRes.data ?? []) as Record<string, unknown>[],
    countryYoyData: (countryYoyRes.data ?? []) as Record<string, unknown>[],
    networkData: (networkRes.data ?? []) as Record<string, unknown>[],
    scheduleData: (scheduleRes.data ?? []) as Record<string, unknown>[],
    productData: (productRes.data ?? []) as Record<string, unknown>[],
    keywordData: (keywordRes.data ?? []) as Record<string, unknown>[],
    enrichedProductData: (enrichedProductRes.data ?? []) as Record<string, unknown>[],
    checkoutData: (checkoutRes.data ?? []) as Record<string, unknown>[],
    goalsSection: clientCtx.goalsSection,
    accountType: clientCtx.accountType,
    targetResult,
  };
}

function latestMonthLabel(analysisYear: number, lastCompleteMonth: number) {
  return `${analysisYear}-${String(lastCompleteMonth).padStart(2, "0")}`;
}

function previousMonthLabel(analysisYear: number, lastCompleteMonth: number) {
  const prevDate = new Date(analysisYear, lastCompleteMonth - 2, 1);
  return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
}

function toDecisionCampaignRows(input: MonthlyPreparedInputs): DecisionRuleCampaignRow[] {
  const latestMonth = latestMonthLabel(input.analysisYear, input.lastCompleteMonth);
  const isMap = new Map(
    input.isData
      .filter((row) => String(row.month || "").slice(0, 7) === latestMonth)
      .map((row) => [String(row.campaign_name || ""), row])
  );
  return input.campaignData
    .filter((row) => String(row.month || "").slice(0, 7) === latestMonth)
    .map((row) => {
      const impressionShareRow = isMap.get(String(row.campaign_name || ""));
      return {
        campaign_id: String(row.campaign_id || "") || null,
        campaign_name: String(row.campaign_name || ""),
        roas: Number(row.roas || 0),
        cost_per_conversion: Number(row.cost_per_conversion || 0),
        cost: Number(row.cost || 0),
        conversions: Number(row.conversions || 0),
        conversions_value: Number(row.conversions_value || 0),
        search_budget_lost_is: Number(impressionShareRow?.search_budget_lost_is || 0),
      };
    });
}

function toCampaignComparisonRows(input: MonthlyPreparedInputs): CampaignComparisonRow[] {
  return input.campaignData.map((row) => ({
    campaign_name: String(row.campaign_name || ""),
    month: String(row.month || ""),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    cost: Number(row.cost || 0),
    conversions: Number(row.conversions || 0),
    conversions_value: Number(row.conversions_value || 0),
    cost_per_conversion: Number(row.cost_per_conversion || 0),
    roas: Number(row.roas || 0),
  }));
}

function toCampaignKpiRows(input: MonthlyPreparedInputs): CampaignKpiRow[] {
  return input.campaignData.map((row) => ({
    campaign_name: String(row.campaign_name || ""),
    month: String(row.month || ""),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    cost: Number(row.cost || 0),
    conversions: Number(row.conversions || 0),
    conversions_value: Number(row.conversions_value || 0),
  }));
}

function toAdGroupComparisonRows(input: MonthlyPreparedInputs): AdGroupComparisonRow[] {
  return input.adgroupData.map((row) => ({
    ad_group_name: String(row.ad_group_name || ""),
    campaign_name: String(row.campaign_name || ""),
    month: String(row.month || ""),
    cost: Number(row.cost || 0),
    conversions: Number(row.conversions || 0),
    conversions_value: Number(row.conversions_value || 0),
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    cost_per_conversion: Number(row.cost_per_conversion || 0),
    roas: Number(row.roas || 0),
  }));
}

function toPreviousDecisionCampaignRows(input: MonthlyPreparedInputs): DecisionRuleCampaignRow[] {
  const previousMonth = previousMonthLabel(input.analysisYear, input.lastCompleteMonth);
  return input.campaignData
    .filter((row) => String(row.month || "").slice(0, 7) === previousMonth)
    .map((row) => ({
      campaign_id: String(row.campaign_id || "") || null,
      campaign_name: String(row.campaign_name || ""),
      roas: Number(row.roas || 0),
      cost_per_conversion: Number(row.cost_per_conversion || 0),
      cost: Number(row.cost || 0),
      conversions: Number(row.conversions || 0),
      conversions_value: Number(row.conversions_value || 0),
    }));
}

function toGeoDecisionRows(input: MonthlyPreparedInputs): DecisionRuleGeoRow[] {
  const latestMonth = latestMonthLabel(input.analysisYear, input.lastCompleteMonth);
  return input.countryData
    .filter((row) => String(row.month || "").slice(0, 7) === latestMonth)
    .map((row) => ({
      country: String(row.country_code || row.country || "Onbekend"),
      cost: Number(row.cost || 0),
      conversions: Number(row.conversions || 0),
      conversions_value: Number(row.conversions_value || 0),
      spend_share: Number(row.spend_share || 0),
    }));
}

function toDeviceDecisionRows(input: MonthlyPreparedInputs): DecisionRuleDeviceRow[] {
  const latestMonth = latestMonthLabel(input.analysisYear, input.lastCompleteMonth);
  return input.deviceData
    .filter((row) => String(row.month || "").slice(0, 7) === latestMonth)
    .filter((row) => !row.level || String(row.level) === "account")
    .map((row) => ({
      device: String(row.device || "UNSPECIFIED"),
      cost: Number(row.cost || 0),
      clicks: Number(row.clicks || 0),
      conversions: Number(row.conversions || 0),
      conversion_rate: Number(row.conversion_rate || 0),
    }));
}

export async function buildPreparedContextRow(
  supabase: SupabaseClient,
  clientId: string,
  existingInputs?: MonthlyPreparedInputs
): Promise<{ prepared: AnalysisPreparedContextRow; inputs: MonthlyPreparedInputs }> {
  const inputs = existingInputs ?? await fetchMonthlyPreparedInputs(supabase, clientId);
  const campaignComparisonRows = toCampaignComparisonRows(inputs);
  const campaignKpiRows = toCampaignKpiRows(inputs);
  const adgroupComparisonRows = toAdGroupComparisonRows(inputs);
  const latestMonth = latestMonthLabel(inputs.analysisYear, inputs.lastCompleteMonth);
  const previousMonth = previousMonthLabel(inputs.analysisYear, inputs.lastCompleteMonth);
  const currentAccount = inputs.accountData.find((row) => String(row.month || "").slice(0, 7) === latestMonth) ?? {};
  const previousAccount = inputs.accountData.find((row) => String(row.month || "").slice(0, 7) === previousMonth) ?? {};
  const targetMonth = inputs.targetResult?.monthlyExpected?.[inputs.lastCompleteMonth - 1];
  const benchmarks = await fetchSectorBenchmarks(supabase, clientId, inputs.accountType);
  const { data: clientSettingsData } = await supabase
    .from("client_settings")
    .select("kpi_targets")
    .eq("client_id", clientId)
    .maybeSingle();
  const comparisonFacts = computeComparisonFacts({
    accountData: inputs.accountData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; ctr: number; avg_cpc: number; conversion_rate: number; cost_per_conversion: number; roas?: number }>,
    monthlyTargets: inputs.targetResult?.monthlyExpected ?? null,
    kpiTargets: {
      roasTarget: Number(clientSettingsData?.kpi_targets?.roasTarget || 0),
      cpaTarget: Number(clientSettingsData?.kpi_targets?.cpaTarget || 0),
    },
    sectorBenchmarks: benchmarks,
    lastCompleteMonth: inputs.lastCompleteMonth,
  });
  const decisionRules = computeDecisionRules({
    accountType: inputs.accountType,
    currentAccount,
    previousAccount,
    campaignRows: toDecisionCampaignRows(inputs),
    previousCampaignRows: toPreviousDecisionCampaignRows(inputs),
    geoRows: toGeoDecisionRows(inputs),
    deviceRows: toDeviceDecisionRows(inputs),
    targets: {
      roasTarget: Number((comparisonFacts.targetComparisons.find((item) => item.metric === "ROAS")?.benchmark) || 0),
      cpaTarget: Number((comparisonFacts.targetComparisons.find((item) => item.metric === "CPA")?.benchmark) || 0),
      conversionsTarget: Number(targetMonth?.conversions || 0),
    },
  });
  const kpiChainAccount = computeKpiChain({
    currentMonth: {
      conversion_value: Number((currentAccount as Record<string, unknown>).conversions_value || 0),
      conversions: Number((currentAccount as Record<string, unknown>).conversions || 0),
      clicks: Number((currentAccount as Record<string, unknown>).clicks || 0),
      impressions: Number((currentAccount as Record<string, unknown>).impressions || 0),
      ctr: Number((currentAccount as Record<string, unknown>).ctr || 0),
      conversion_rate: Number((currentAccount as Record<string, unknown>).conversion_rate || 0),
      avg_cpc: Number((currentAccount as Record<string, unknown>).avg_cpc || 0),
      cost: Number((currentAccount as Record<string, unknown>).cost || 0),
    },
    previousMonth: {
      conversion_value: Number((previousAccount as Record<string, unknown>).conversions_value || 0),
      conversions: Number((previousAccount as Record<string, unknown>).conversions || 0),
      clicks: Number((previousAccount as Record<string, unknown>).clicks || 0),
      impressions: Number((previousAccount as Record<string, unknown>).impressions || 0),
      ctr: Number((previousAccount as Record<string, unknown>).ctr || 0),
      conversion_rate: Number((previousAccount as Record<string, unknown>).conversion_rate || 0),
      avg_cpc: Number((previousAccount as Record<string, unknown>).avg_cpc || 0),
      cost: Number((previousAccount as Record<string, unknown>).cost || 0),
    },
    resultMetric: Number((currentAccount as Record<string, unknown>).conversions_value || 0) > 0 ? "conversion_value" : "conversions",
  });
  const kpiChainsCampaigns = computeCampaignKpiChains({
    campaignData: campaignKpiRows,
    lastMonth: latestMonth,
    monthBeforeLast: previousMonth,
    resultMetric: "conversion_value",
  }).slice(0, 12);
  const campaignComparisonFacts = computeCampaignComparisonFacts({
    campaignData: campaignComparisonRows,
    lastCompleteMonth: inputs.lastCompleteMonth,
    analysisYear: inputs.analysisYear,
    accountType: inputs.accountType,
    kpiTargets: {
      roasTarget: Number((comparisonFacts.targetComparisons.find((item) => item.metric === "ROAS")?.benchmark) || 0),
      cpaTarget: Number((comparisonFacts.targetComparisons.find((item) => item.metric === "CPA")?.benchmark) || 0),
    },
  });
  const adgroupComparisonFacts = computeAdGroupComparisonFacts({
    adgroupData: adgroupComparisonRows,
    lastCompleteMonth: inputs.lastCompleteMonth,
    analysisYear: inputs.analysisYear,
  });
  const dataAvailability = checkStepDataAvailability({
    audienceData: inputs.audienceData,
    deviceData: inputs.deviceData,
    checkoutData: inputs.checkoutData,
    creativeData: inputs.creativeData,
    keywordData: inputs.keywordData,
    productData: inputs.productData,
    countryData: inputs.countryData,
    networkData: inputs.networkData,
    scheduleData: inputs.scheduleData,
  });
  const kpiChainText = [
    "## PRE-COMPUTED KPI-KETEN (gebruik als basis, reken NIET zelf)",
    kpiChainAccount.formattedChain,
    "",
    ...kpiChainsCampaigns.slice(0, 8).map((chain) => `- ${chain.formattedChain}`),
    "",
    "Gebruik deze keten als structuur. Verklaar WAAROM de primary driver is veranderd.",
    "Benoem het mechanisme, niet alleen het cijfer.",
  ].join("\n");
  const campaignTableText = [
    formatCampaignComparisonTable(campaignComparisonFacts),
    "",
    computeCampaignMomFacts(
      campaignKpiRows,
      inputs.lastCompleteMonth,
      inputs.analysisYear
    ),
  ].filter(Boolean).join("\n\n");
  const prepared: AnalysisPreparedContextRow = {
    client_id: clientId,
    analysis_date: inputs.periodEnd,
    decision_rules: decisionRules,
    kpi_chain_account: kpiChainAccount,
    kpi_chains_campaigns: kpiChainsCampaigns,
    comparison_facts_campaigns: campaignComparisonFacts,
    comparison_facts_adgroups: adgroupComparisonFacts,
    binding_facts_text: decisionRules.bindingFacts,
    kpi_chain_text: kpiChainText,
    campaign_table_text: campaignTableText,
    data_availability: dataAvailability,
  };
  return { prepared, inputs };
}

export async function getPreparedContext(
  supabase: SupabaseClient,
  clientId: string,
  analysisDate: string
) {
  const { data } = await supabase
    .from("analysis_prepared_context")
    .select("*")
    .eq("client_id", clientId)
    .eq("analysis_date", analysisDate)
    .maybeSingle();
  return data as AnalysisPreparedContextRow | null;
}

export async function savePreparedContext(
  supabase: SupabaseClient,
  prepared: AnalysisPreparedContextRow
) {
  const { data, error } = await supabase
    .from("analysis_prepared_context")
    .upsert(prepared, {
      onConflict: "client_id,analysis_date",
      ignoreDuplicates: false,
    })
    .select("id")
    .maybeSingle();
  return { data, error };
}
