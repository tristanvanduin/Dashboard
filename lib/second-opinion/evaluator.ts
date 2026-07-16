/**
 * Second Opinion evaluation engine.
 *
 * Evaluates each template row against available account data.
 * Uses deterministic logic first; marks unsupported items clearly.
 *
 * Data loading strategy:
 *   1. Try Supabase first (fast, already synced)
 *   2. If Supabase is empty → fetch live from Google Ads API (for new leads)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getTemplateForMode, type AuditMode, type TemplateRow } from "./template";
import {
  type AuditRowResult,
  type AuditScore,
  type SecondOpinionRun,
  calculateAllSummaries,
} from "./types";
import {
  getCampaignMetadata,
  getAdGroupKeywords,
  getCampaignImpressionShare,
  getAdGroupAdCopy,
  getProductGroupPerformance,
  getCampaignLocationTargets,
  getAccountStructure,
  getConversionActions,
  getPMaxUrlExpansionSettings,
  getShoppingCampaignPriorities,
  getAdGroupTargetingSettings,
  getCampaignFrequencyCaps,
  type GoogleAdsCredentials,
  type PMaxUrlExpansionInfo,
  type ShoppingPriorityInfo,
  type AdGroupTargetingInfo,
  type FrequencyCapInfo,
} from "../api/google-ads";
import { mergeConversionActionsWithLiveStatus } from "../client-settings";

// ── Account data context (loaded once per audit) ───────────────────────────

interface AccountContext {
  clientId: string;
  dataSource: "supabase" | "live_api" | "mixed";
  conversionActions: Array<{ id: string; name: string; category: string; includedInDashboard: boolean }>;
  kpiTargets: Record<string, unknown> | null;
  campaigns: Array<{
    campaign_id: string;
    campaign_name: string;
    campaign_type: string;
    bidding_strategy: string;
    bidding_strategy_target: number | null;
    budget_amount: number | null;
    serving_status: string;
  }>;
  keywords: Array<{
    keyword_text: string;
    match_type: string;
    campaign_name: string;
    ad_group_name: string;
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
    quality_score: number | null;
  }>;
  impressionShare: Array<{
    campaign_name: string;
    search_budget_lost_is: number | null;
    search_rank_lost_is: number | null;
    daily_budget: number | null;
  }>;
  networkPerformance: Array<{
    network_type: string;
    campaign_name: string;
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
  }>;
  creatives: Array<{
    campaign_name: string;
    ad_group_name: string;
    ad_type: string | null;
    headlines: string[] | null;
    descriptions: string[] | null;
    impressions: number;
  }>;
  products: Array<{
    campaign_name: string;
    campaign_type: string | null;
    product_title: string;
    cost: number;
    conversions: number;
    roas: number;
  }>;
  assetGroups: Array<{
    campaign_name: string;
    asset_group_name: string;
    impressions: number;
    cost: number;
    conversions: number;
  }>;
  searchTerms: Array<{
    search_term: string;
    campaign_name: string;
    clicks: number;
    cost: number;
    conversions: number;
    conversions_value?: number;
    ctr?: number;
    conversion_rate?: number;
  }>;
  locationTargets: Array<{
    campaign_name: string;
    location_name: string;
  }>;
  // PMAX intelligence data
  pmaxNetworkBreakdown: Array<{
    asset_group_name: string;
    network_type: string;
    cost: number;
    conversions: number;
    conversions_value: number;
  }>;
  pmaxAssets: Array<{
    asset_group_name: string;
    asset_type: string;
    performance_label: string;
  }>;
  pmaxPlacements: Array<{
    placement: string;
    cost: number;
    conversions: number;
  }>;
  // Second Opinion specific data (loaded live from API)
  pmaxUrlExpansion: PMaxUrlExpansionInfo[];
  shoppingPriorities: ShoppingPriorityInfo[];
  adGroupTargeting: AdGroupTargetingInfo[];
  frequencyCaps: FrequencyCapInfo[];
}

// ── Google Ads credentials helper ──────────────────────────────────────────

function getCredentials(): GoogleAdsCredentials | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!developerToken || !clientId || !clientSecret || !refreshToken) return null;
  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };
}

async function getCustomerId(supabase: SupabaseClient, clientId: string): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "api_clients")
    .maybeSingle();
  if (!data?.value || !Array.isArray(data.value)) return null;
  const client = (data.value as Array<{ id: string; googleAdsCustomerId?: string }>)
    .find((c) => c.id === clientId);
  return client?.googleAdsCustomerId ?? null;
}

// ── Load account data: Supabase first, then live API fallback ──────────────

async function loadAccountContext(
  supabase: SupabaseClient,
  clientId: string
): Promise<AccountContext> {
  // Check if Supabase has data for this client
  const { data: latestRow } = await supabase
    .from("ads_account_monthly")
    .select("month")
    .eq("client_id", clientId)
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestMonth = latestRow?.month as string | undefined;

  // Always load client_settings (available for all clients)
  const { data: settingsData } = await supabase
    .from("client_settings")
    .select("conversion_actions, kpi_targets")
    .eq("client_id", clientId)
    .maybeSingle();

  let conversionActions = (settingsData?.conversion_actions ?? []) as AccountContext["conversionActions"];
  const kpiTargets = (settingsData?.kpi_targets ?? null) as Record<string, unknown> | null;

  const credentials = getCredentials();
  const customerId = await getCustomerId(supabase, clientId);

  if (credentials && customerId) {
    try {
      const liveActions = await getConversionActions(credentials, customerId);
      conversionActions = mergeConversionActionsWithLiveStatus(
        conversionActions.map((action) => ({
          id: action.id,
          name: action.name,
          category: action.category === "primary" ? "primary" : "secondary",
          activeInAds: true,
          includedInDashboard: action.includedInDashboard,
        })),
        liveActions,
      ).map((action) => ({
        id: action.id,
        name: action.name,
        category: action.category,
        includedInDashboard: action.includedInDashboard,
      }));
    } catch { /* API not available */ }
  }

  // If Supabase has monthly data → load everything from Supabase
  if (latestMonth) {
    return loadFromSupabase(supabase, clientId, latestMonth, conversionActions, kpiTargets);
  }

  // No Supabase data → try live Google Ads API
  if (credentials && customerId) {
    return loadFromGoogleAds(credentials, customerId, clientId, conversionActions, kpiTargets);
  }

  // No data at all — return empty context
  return {
    clientId,
    dataSource: "supabase",
    conversionActions,
    kpiTargets,
    campaigns: [],
    keywords: [],
    impressionShare: [],
    networkPerformance: [],
    creatives: [],
    products: [],
    assetGroups: [],
    searchTerms: [],
    locationTargets: [],
    pmaxNetworkBreakdown: [],
    pmaxAssets: [],
    pmaxPlacements: [],
    pmaxUrlExpansion: [],
    shoppingPriorities: [],
    adGroupTargeting: [],
    frequencyCaps: [],
  };
}

async function loadFromSupabase(
  supabase: SupabaseClient,
  clientId: string,
  latestMonth: string,
  conversionActions: AccountContext["conversionActions"],
  kpiTargets: Record<string, unknown> | null,
): Promise<AccountContext> {
  const [
    campaignsRes, keywordsRes, isRes, networkRes,
    creativesRes, productsRes, assetGroupsRes, searchTermsRes,
    pmaxNetworkRes, pmaxAssetsRes, pmaxPlacementsRes,
  ] = await Promise.all([
    supabase.from("ads_campaign_metadata").select("*").eq("client_id", clientId),
    supabase.from("ads_keyword_performance_monthly").select("keyword_text, match_type, campaign_name, ad_group_name, impressions, clicks, cost, conversions, quality_score").eq("client_id", clientId).eq("month", latestMonth).order("cost", { ascending: false }).limit(1000),
    supabase.from("ads_campaign_impression_share").select("campaign_name, search_budget_lost_is, search_rank_lost_is, daily_budget").eq("client_id", clientId).eq("month", latestMonth),
    supabase.from("ads_network_performance_monthly").select("network_type, campaign_name, impressions, clicks, cost, conversions").eq("client_id", clientId).eq("month", latestMonth),
    supabase.from("ads_creative_performance").select("campaign_name, ad_group_name, ad_type, headlines, descriptions, impressions").eq("client_id", clientId).eq("month", latestMonth).order("impressions", { ascending: false }).limit(500),
    supabase.from("ads_product_performance_monthly").select("campaign_name, campaign_type, product_title, cost, conversions, roas").eq("client_id", clientId).eq("month", latestMonth).order("cost", { ascending: false }).limit(500),
    supabase.from("ads_asset_group_performance_monthly").select("campaign_name, asset_group_name, impressions, cost, conversions").eq("client_id", clientId).eq("month", latestMonth),
    supabase.from("ads_search_terms_monthly").select("search_term, campaign_name, clicks, cost, conversions, conversions_value, ctr, conversion_rate").eq("client_id", clientId).eq("month", latestMonth).order("cost", { ascending: false }).limit(2000),
    // PMAX intelligence
    supabase.from("ads_pmax_network_breakdown").select("asset_group_name, network_type, cost, conversions, conversions_value").eq("client_id", clientId).order("cost", { ascending: false }),
    supabase.from("ads_pmax_asset_performance").select("asset_group_name, asset_type, performance_label").eq("client_id", clientId),
    supabase.from("ads_pmax_placements").select("placement, cost, conversions").eq("client_id", clientId).order("cost", { ascending: false }).limit(500),
  ]);

  // Load audit-specific data live from API (not stored in Supabase monthly tables)
  let locationTargets: AccountContext["locationTargets"] = [];
  let pmaxUrlExpansion: PMaxUrlExpansionInfo[] = [];
  let shoppingPriorities: ShoppingPriorityInfo[] = [];
  let adGroupTargeting: AdGroupTargetingInfo[] = [];
  let frequencyCaps: FrequencyCapInfo[] = [];

  const creds = getCredentials();
  const custId = await getCustomerId(supabase, clientId);
  if (creds && custId) {
    const [locRes, urlRes, shopRes, tgtRes, freqRes] = await Promise.all([
      getCampaignLocationTargets(creds, custId).catch(() => []),
      getPMaxUrlExpansionSettings(creds, custId).catch(() => []),
      getShoppingCampaignPriorities(creds, custId).catch(() => []),
      getAdGroupTargetingSettings(creds, custId).catch(() => []),
      getCampaignFrequencyCaps(creds, custId).catch(() => []),
    ]);
    locationTargets = locRes.map((lt) => ({ campaign_name: lt.campaignName, location_name: lt.locationName }));
    pmaxUrlExpansion = urlRes;
    shoppingPriorities = shopRes;
    adGroupTargeting = tgtRes;
    frequencyCaps = freqRes;
  }

  return {
    clientId,
    dataSource: "supabase",
    conversionActions,
    kpiTargets,
    campaigns: (campaignsRes.data ?? []) as AccountContext["campaigns"],
    keywords: (keywordsRes.data ?? []) as AccountContext["keywords"],
    impressionShare: (isRes.data ?? []) as AccountContext["impressionShare"],
    networkPerformance: (networkRes.data ?? []) as AccountContext["networkPerformance"],
    creatives: (creativesRes.data ?? []) as AccountContext["creatives"],
    products: (productsRes.data ?? []) as AccountContext["products"],
    assetGroups: (assetGroupsRes.data ?? []) as AccountContext["assetGroups"],
    searchTerms: (searchTermsRes.data ?? []) as AccountContext["searchTerms"],
    locationTargets,
    pmaxNetworkBreakdown: (pmaxNetworkRes.data ?? []) as AccountContext["pmaxNetworkBreakdown"],
    pmaxAssets: (pmaxAssetsRes.data ?? []) as AccountContext["pmaxAssets"],
    pmaxPlacements: (pmaxPlacementsRes.data ?? []) as AccountContext["pmaxPlacements"],
    pmaxUrlExpansion,
    shoppingPriorities,
    adGroupTargeting,
    frequencyCaps,
  };
}

async function loadFromGoogleAds(
  credentials: GoogleAdsCredentials,
  customerId: string,
  clientId: string,
  conversionActions: AccountContext["conversionActions"],
  kpiTargets: Record<string, unknown> | null,
): Promise<AccountContext> {
  // Date range for impression share (last 90 days)
  const endDate = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // Fetch live data from Google Ads API in parallel
  const [
    campaignMeta, keywords, impressionShareRaw,
    adCopy, products, locationTargets, accountStructure,
    pmaxUrlExpansion, shoppingPriorities, adGroupTargeting, frequencyCaps,
  ] = await Promise.all([
    getCampaignMetadata(credentials, customerId),
    getAdGroupKeywords(credentials, customerId),
    getCampaignImpressionShare(credentials, customerId, startDate, endDate),
    getAdGroupAdCopy(credentials, customerId),
    getProductGroupPerformance(credentials, customerId),
    getCampaignLocationTargets(credentials, customerId),
    getAccountStructure(credentials, customerId),
    getPMaxUrlExpansionSettings(credentials, customerId),
    getShoppingCampaignPriorities(credentials, customerId),
    getAdGroupTargetingSettings(credentials, customerId),
    getCampaignFrequencyCaps(credentials, customerId),
  ]);

  // Map campaign metadata
  const campaigns: AccountContext["campaigns"] = campaignMeta.map((cm) => ({
    campaign_id: cm.campaignId,
    campaign_name: cm.campaignName,
    campaign_type: cm.campaignType,
    bidding_strategy: cm.biddingStrategy,
    bidding_strategy_target: cm.biddingStrategyTarget,
    budget_amount: cm.budgetAmount,
    serving_status: cm.servingStatus,
  }));

  // Map keywords (from getAdGroupKeywords — no performance metrics, but text + match type)
  const keywordData: AccountContext["keywords"] = keywords.map((k) => ({
    keyword_text: k.keyword,
    match_type: k.matchType,
    campaign_name: k.campaignName,
    ad_group_name: k.adGroupName,
    impressions: 0, clicks: 0, cost: 0, conversions: 0, quality_score: null,
  }));

  // Map impression share
  const impressionShare: AccountContext["impressionShare"] = impressionShareRaw.map((is) => ({
    campaign_name: is.campaignName,
    search_budget_lost_is: is.searchBudgetLostIS,
    search_rank_lost_is: is.searchRankLostIS,
    daily_budget: is.dailyBudget,
  }));

  // Map creatives
  const creatives: AccountContext["creatives"] = adCopy.map((ad) => ({
    campaign_name: ad.campaignName,
    ad_group_name: ad.adGroupName,
    ad_type: "RESPONSIVE_SEARCH_AD",
    headlines: ad.headlines,
    descriptions: ad.descriptions,
    impressions: 0,
  }));

  // Map products
  const productData: AccountContext["products"] = products.map((p) => ({
    campaign_name: p.campaignName,
    campaign_type: null,
    product_title: p.productTitle,
    cost: p.cost,
    conversions: p.conversions,
    roas: p.cost > 0 ? p.conversionsValue / p.cost : 0,
  }));

  // Map location targets
  const locationData: AccountContext["locationTargets"] = locationTargets.map((lt) => ({
    campaign_name: lt.campaignName,
    location_name: lt.locationName,
  }));

  return {
    clientId,
    dataSource: "live_api",
    conversionActions,
    kpiTargets,
    campaigns,
    keywords: keywordData,
    impressionShare,
    networkPerformance: [],
    creatives,
    products: productData,
    assetGroups: [],
    searchTerms: [],
    locationTargets: locationData,
    pmaxNetworkBreakdown: [],
    pmaxAssets: [],
    pmaxPlacements: [],
    pmaxUrlExpansion,
    shoppingPriorities,
    adGroupTargeting,
    frequencyCaps,
  };
}

// ── Deterministic evaluators per template ID ───────────────────────────────

type Evaluator = (ctx: AccountContext) => { score: AuditScore; comments: string; confidence: "high" | "medium" | "low" };

const evaluators: Record<number, Evaluator> = {
  // #9: Tracking — conversie-acties primair/secundair correct?
  9: (ctx) => {
    const actions = ctx.conversionActions;
    if (actions.length === 0) return { score: "Niet beoordeeld", comments: "Geen conversie-acties gevonden in account.", confidence: "low" };
    const primary = actions.filter((a) => a.category === "primary");
    const secondary = actions.filter((a) => a.category === "secondary");
    const active = actions.filter((a) => a.includedInDashboard);
    const names = actions.map((a) => `${a.name} (${a.category})`).slice(0, 5).join(", ");
    if (primary.length >= 1 && secondary.length >= 1) return { score: "Goed", comments: `${primary.length} primaire + ${secondary.length} secundaire actie(s). Correct ingedeeld: ${names}.`, confidence: "high" };
    if (primary.length >= 1) return { score: "Voldoende", comments: `${primary.length} primaire actie(s) maar geen secundaire. Acties: ${names}.`, confidence: "medium" };
    if (actions.length > 0 && primary.length === 0) return { score: "Onvoldoende", comments: `${actions.length} conversie-acties gevonden maar geen als primair gemarkeerd: ${names}. Configureer primair/secundair.`, confidence: "high" };
    return { score: "Voldoende", comments: `${active.length} actieve conversie-acties.`, confidence: "medium" };
  },

  // #10: Tracking — alle conversieacties correct?
  10: (ctx) => {
    const actions = ctx.conversionActions;
    if (actions.length === 0) return { score: "Niet beoordeeld", comments: "Geen conversie-acties gevonden.", confidence: "low" };
    const active = actions.filter((a) => a.includedInDashboard);
    const names = actions.map((a) => a.name).slice(0, 5).join(", ");
    if (active.length === 0) return { score: "Onvoldoende", comments: `${actions.length} conversie-acties gevonden maar geen actief: ${names}.`, confidence: "high" };
    return { score: active.length >= 2 ? "Goed" : "Voldoende", comments: `${active.length} van ${actions.length} conversie-acties actief: ${names}.`, confidence: "medium" };
  },

  // #11: Bieding / Budget — biedstrategieën logisch?
  11: (ctx) => {
    const campaigns = ctx.campaigns.filter((c) => c.serving_status === "ELIGIBLE" || c.serving_status === "SERVING" || c.serving_status === "ENABLED");
    if (campaigns.length === 0) return { score: "Niet beoordeeld", comments: "Geen actieve campagnes gevonden.", confidence: "low" };
    const strategies = [...new Set(campaigns.map((c) => c.bidding_strategy))];
    const hasSmartBidding = strategies.some((s) => ["TARGET_CPA", "TARGET_ROAS", "MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSION_VALUE"].includes(s));
    const hasManual = strategies.some((s) => ["MANUAL_CPC", "MANUAL_CPM"].includes(s));
    if (hasSmartBidding && !hasManual) return { score: "Goed", comments: `Smart bidding actief (${strategies.join(", ")}). Logisch bij voldoende conversies.`, confidence: "high" };
    if (hasManual && !hasSmartBidding) return { score: "Onvoldoende", comments: `Alleen handmatig bieden (${strategies.join(", ")}). Overweeg smart bidding bij voldoende volume.`, confidence: "medium" };
    return { score: "Voldoende", comments: `Mix van strategieën: ${strategies.join(", ")}. Controleer of handmatige campagnes bewust zijn.`, confidence: "medium" };
  },

  // #12: Budget toereikend?
  12: (ctx) => {
    const isData = ctx.impressionShare;
    if (isData.length === 0) return { score: "Niet beoordeeld", comments: "Geen impression share data beschikbaar.", confidence: "low" };
    const budgetLost = isData.filter((c) => (c.search_budget_lost_is ?? 0) > 0.2);
    if (budgetLost.length === 0) return { score: "Goed", comments: "Geen campagnes met >20% IS verlies door budget.", confidence: "high" };
    const names = budgetLost.map((c) => c.campaign_name).slice(0, 3).join(", ");
    return { score: "Onvoldoende", comments: `${budgetLost.length} campagne(s) verliezen >20% IS door budget: ${names}.`, confidence: "high" };
  },

  // #13: Zoekwoorden logisch + matchtype?
  13: (ctx) => {
    if (ctx.keywords.length === 0) return { score: "Niet beoordeeld", comments: "Geen keyword data beschikbaar.", confidence: "low" };
    const matchTypes = [...new Set(ctx.keywords.map((k) => k.match_type))];
    const broadCount = ctx.keywords.filter((k) => k.match_type === "BROAD").length;
    const exactCount = ctx.keywords.filter((k) => k.match_type === "EXACT").length;
    const phraseCount = ctx.keywords.filter((k) => k.match_type === "PHRASE").length;
    const total = ctx.keywords.length;
    const broadPct = Math.round((broadCount / total) * 100);
    const comments = `${total} keywords: ${exactCount} exact, ${phraseCount} phrase, ${broadCount} broad (${broadPct}%).`;
    if (broadPct > 80) return { score: "Onvoldoende", comments: comments + " Te veel broad match zonder controle.", confidence: "medium" };
    if (matchTypes.length >= 2) return { score: "Voldoende", comments, confidence: "medium" };
    return { score: "Goed", comments, confidence: "medium" };
  },

  // #14: Zoekwoorden logisch gesegmenteerd?
  14: (ctx) => {
    if (ctx.keywords.length === 0) return { score: "Niet beoordeeld", comments: "Geen keyword data.", confidence: "low" };
    const adGroups = [...new Set(ctx.keywords.map((k) => k.ad_group_name))];
    const avgPerGroup = Math.round(ctx.keywords.length / adGroups.length);
    const comments = `${ctx.keywords.length} keywords over ${adGroups.length} ad groups (gem. ${avgPerGroup} per groep).`;
    if (avgPerGroup > 30) return { score: "Onvoldoende", comments: comments + " Ad groups zijn te breed — overweeg opsplitsen.", confidence: "medium" };
    if (avgPerGroup > 15) return { score: "Voldoende", comments, confidence: "medium" };
    return { score: "Goed", comments: comments + " Goede segmentatie.", confidence: "medium" };
  },

  // #15: DSA aanwezig en logisch?
  15: (ctx) => {
    if (ctx.campaigns.length === 0) return { score: "Niet beoordeeld", comments: "Geen campagnes.", confidence: "low" };
    const dsaCampaigns = ctx.campaigns.filter((c) =>
      c.campaign_name.toLowerCase().includes("dsa") || c.campaign_type === "DYNAMIC_SEARCH_ADS"
    );
    if (dsaCampaigns.length === 0) return { score: "Onvoldoende", comments: "Geen DSA campagne gevonden. Overweeg DSA voor keyword-discovery.", confidence: "medium" };
    return { score: "Goed", comments: `DSA campagne(s) actief: ${dsaCampaigns.map((c) => c.campaign_name).join(", ")}.`, confidence: "high" };
  },

  // #16: Correcte campagnedoelen?
  16: (ctx) => {
    if (ctx.campaigns.length === 0) return { score: "Niet beoordeeld", comments: "Geen campagnes.", confidence: "low" };
    const withTarget = ctx.campaigns.filter((c) => c.bidding_strategy_target && c.bidding_strategy_target > 0);
    const pct = Math.round((withTarget.length / ctx.campaigns.length) * 100);
    if (pct >= 80) return { score: "Goed", comments: `${pct}% van campagnes heeft een biedingsdoel ingesteld.`, confidence: "high" };
    if (pct >= 50) return { score: "Voldoende", comments: `${pct}% heeft een doel. ${ctx.campaigns.length - withTarget.length} campagnes zonder target.`, confidence: "medium" };
    return { score: "Onvoldoende", comments: `Slechts ${pct}% heeft een doel. Meeste campagnes missen een specifiek target.`, confidence: "medium" };
  },

  // #17: Zoekpartners / Display netwerken?
  17: (ctx) => {
    if (ctx.networkPerformance.length === 0) {
      // No stored network data — but if we have campaigns we can still note
      if (ctx.campaigns.length > 0) return { score: "Voldoende", comments: "Network performance data niet beschikbaar. Controleer handmatig of zoekpartners/display aan staan.", confidence: "low" };
      return { score: "Niet beoordeeld", comments: "Geen data.", confidence: "low" };
    }
    const searchPartners = ctx.networkPerformance.filter((n) => n.network_type === "SEARCH_PARTNERS");
    const display = ctx.networkPerformance.filter((n) => n.network_type === "CONTENT");
    const parts: string[] = [];
    if (searchPartners.length > 0) {
      const spCost = searchPartners.reduce((s, n) => s + n.cost, 0);
      const spConv = searchPartners.reduce((s, n) => s + n.conversions, 0);
      parts.push(`Zoekpartners: €${Math.round(spCost)} spend, ${Math.round(spConv)} conversies`);
    }
    if (display.length > 0) {
      const dCost = display.reduce((s, n) => s + n.cost, 0);
      const dConv = display.reduce((s, n) => s + n.conversions, 0);
      parts.push(`Display netwerk: €${Math.round(dCost)} spend, ${Math.round(dConv)} conversies`);
    }
    if (parts.length === 0) return { score: "Goed", comments: "Geen zoekpartners of display netwerken actief.", confidence: "high" };
    return { score: "Voldoende", comments: parts.join(". ") + ". Controleer of prestaties de kosten rechtvaardigen.", confidence: "medium" };
  },

  // #18: Negatives toegevoegd? (Full search term waste analysis)
  18: (ctx) => {
    if (ctx.searchTerms.length === 0 && ctx.keywords.length === 0) return { score: "Niet beoordeeld", comments: "Geen zoekterm of keyword data.", confidence: "low" };

    const totalTerms = ctx.searchTerms.length;
    const totalCost = ctx.searchTerms.reduce((s, st) => s + (st.cost ?? 0), 0);

    // Tier 1: Zero-conversion terms (absolute waste)
    const zeroConv = ctx.searchTerms.filter((st) => st.conversions === 0 && st.cost > 0);
    const zeroConvCost = zeroConv.reduce((s, st) => s + st.cost, 0);

    // Tier 2: Terms with conversions but extremely high CPA (>3x account average)
    const termsWithConv = ctx.searchTerms.filter((st) => st.conversions > 0 && st.cost > 0);
    const avgCpa = termsWithConv.length > 0
      ? termsWithConv.reduce((s, st) => s + st.cost, 0) / termsWithConv.reduce((s, st) => s + st.conversions, 0)
      : 0;
    const highCpa = avgCpa > 0
      ? termsWithConv.filter((st) => (st.cost / st.conversions) > avgCpa * 3 && st.cost > 10)
      : [];
    const highCpaCost = highCpa.reduce((s, st) => s + st.cost, 0);

    // Tier 3: Terms with clicks but no revenue (for ecommerce — conversions but €0 value)
    const zeroValue = ctx.searchTerms.filter((st) =>
      st.conversions > 0 && (st.conversions_value ?? 0) === 0 && st.cost > 5
    );

    const totalWaste = zeroConvCost + highCpaCost;
    const wastePercent = totalCost > 0 ? Math.round((totalWaste / totalCost) * 100) : 0;
    const allWasteful = zeroConv.length + highCpa.length;

    // Build detailed comment
    const parts: string[] = [];
    parts.push(`${totalTerms} zoektermen geanalyseerd (€${Math.round(totalCost)} totale spend).`);
    if (zeroConv.length > 0) parts.push(`${zeroConv.length} termen zonder conversies (€${Math.round(zeroConvCost)} waste).`);
    if (highCpa.length > 0) parts.push(`${highCpa.length} termen met CPA >3x gemiddelde (€${Math.round(highCpaCost)} inefficient).`);
    if (zeroValue.length > 0) parts.push(`${zeroValue.length} termen met conversies maar €0 omzet.`);
    if (allWasteful > 0) parts.push(`Totaal: ${wastePercent}% van de spend is waste of inefficient.`);
    const comments = parts.join(" ");

    if (allWasteful === 0) return { score: "Goed", comments: `${totalTerms} zoektermen geanalyseerd — geen significante waste gevonden. Negatives zijn goed ingericht.`, confidence: "high" };
    if (wastePercent > 20 || zeroConv.length > 50) return { score: "Onvoldoende", comments, confidence: "high" };
    if (wastePercent > 10 || zeroConv.length > 20) return { score: "Voldoende", comments, confidence: "high" };
    return { score: "Goed", comments, confidence: "high" };
  },

  // #19: Kwaliteitsscore?
  19: (ctx) => {
    const withQs = ctx.keywords.filter((k) => k.quality_score !== null && k.quality_score !== undefined);
    if (withQs.length === 0) return { score: "Niet beoordeeld", comments: "Quality Score data niet beschikbaar.", confidence: "low" };
    const avg = withQs.reduce((sum, k) => sum + (k.quality_score ?? 0), 0) / withQs.length;
    const low = withQs.filter((k) => (k.quality_score ?? 0) < 5).length;
    const comments = `Gemiddelde QS: ${avg.toFixed(1)}/10 over ${withQs.length} keywords. ${low} keywords met QS < 5.`;
    if (avg >= 7) return { score: "Goed", comments, confidence: "high" };
    if (avg >= 5) return { score: "Voldoende", comments, confidence: "high" };
    return { score: "Onvoldoende", comments, confidence: "high" };
  },

  // #20: RSA's compleet + CTR Boosters?
  20: (ctx) => {
    if (ctx.creatives.length === 0) return { score: "Niet beoordeeld", comments: "Geen creative data.", confidence: "low" };
    const rsas = ctx.creatives.filter((c) => c.ad_type === "RESPONSIVE_SEARCH_AD");
    if (rsas.length === 0) return { score: "Onvoldoende", comments: "Geen RSA's gevonden.", confidence: "high" };
    const incomplete = rsas.filter((r) => (r.headlines?.length ?? 0) < 10 || (r.descriptions?.length ?? 0) < 3);
    if (incomplete.length === 0) return { score: "Goed", comments: `${rsas.length} RSA's, allemaal met 10+ headlines en 3+ descriptions.`, confidence: "high" };
    return { score: "Voldoende", comments: `${rsas.length} RSA's gevonden, ${incomplete.length} onvolledig (<10 headlines of <3 descriptions).`, confidence: "high" };
  },

  // #21: PMAX campagnedoelen?
  21: (ctx) => {
    const pmax = ctx.campaigns.filter((c) => c.campaign_type === "PERFORMANCE_MAX");
    if (pmax.length === 0) return { score: "Niet van toepassing", comments: "Geen PMax campagnes in dit account.", confidence: "high" };
    const withTarget = pmax.filter((c) => c.bidding_strategy_target && c.bidding_strategy_target > 0);
    if (withTarget.length === pmax.length) return { score: "Goed", comments: `${pmax.length} PMax campagne(s), allemaal met biedingsdoel.`, confidence: "high" };
    return { score: "Onvoldoende", comments: `${pmax.length - withTarget.length} van ${pmax.length} PMax campagnes zonder specifiek biedingsdoel.`, confidence: "medium" };
  },

  // #23: PMAX branded zoektermen?
  23: (ctx) => {
    const pmax = ctx.campaigns.filter((c) => c.campaign_type === "PERFORMANCE_MAX");
    if (pmax.length === 0) return { score: "Niet van toepassing", comments: "Geen PMax campagnes in dit account.", confidence: "high" };
    const brandShopping = ctx.campaigns.filter((c) =>
      c.campaign_type === "SHOPPING" && c.campaign_name.toLowerCase().includes("brand")
    );
    if (brandShopping.length > 0) return { score: "Goed", comments: `PMax actief + branded Shopping campagne aanwezig (${brandShopping[0].campaign_name}). Goed ingericht.`, confidence: "medium" };
    return { score: "Voldoende", comments: `PMax actief maar geen branded Shopping campagne gevonden. Controleer of branded termen zijn uitgesloten via Google Support.`, confidence: "low" };
  },

  // #25: PMAX assets?
  25: (ctx) => {
    if (ctx.assetGroups.length === 0) {
      const pmax = ctx.campaigns.filter((c) => c.campaign_type === "PERFORMANCE_MAX");
      if (pmax.length === 0) return { score: "Niet van toepassing", comments: "Geen PMax campagnes in dit account.", confidence: "high" };
      return { score: "Niet beoordeeld", comments: "Asset group data niet beschikbaar.", confidence: "low" };
    }
    const withImpressions = ctx.assetGroups.filter((ag) => ag.impressions > 0);
    return { score: withImpressions.length > 0 ? "Voldoende" : "Onvoldoende", comments: `${ctx.assetGroups.length} asset groups, ${withImpressions.length} actief met impressies.`, confidence: "medium" };
  },

  // #26 + #33: Product performance verdeling
  26: (ctx) => evaluateProductPerformance(ctx),
  33: (ctx) => evaluateProductPerformance(ctx),

  // #27: Shopping + PMAX kannibalisatie?
  27: (ctx) => {
    const shopping = ctx.campaigns.filter((c) => c.campaign_type === "SHOPPING");
    const pmax = ctx.campaigns.filter((c) => c.campaign_type === "PERFORMANCE_MAX");
    if (shopping.length === 0 && pmax.length === 0) return { score: "Niet van toepassing", comments: "Geen Shopping of PMax campagnes in dit account.", confidence: "high" };
    if (shopping.length > 0 && pmax.length > 0) return { score: "Voldoende", comments: `Beide actief: ${shopping.length} Shopping + ${pmax.length} PMax. Controleer op kannibalisatie.`, confidence: "medium" };
    if (pmax.length > 0) return { score: "Goed", comments: `${pmax.length} PMax campagne(s) actief, geen Standard Shopping.`, confidence: "medium" };
    return { score: "Voldoende", comments: `${shopping.length} Shopping campagne(s) actief. Overweeg PMax als aanvulling.`, confidence: "medium" };
  },

  // #30: Shopping negatives?
  30: (ctx) => evaluators[18](ctx), // Same logic as Search negatives

  // #32: Shopping zoekpartners?
  32: (ctx) => evaluators[17](ctx),

  // #34: Remarketing campagnes actief?
  34: (ctx) => {
    if (ctx.campaigns.length === 0) return { score: "Niet beoordeeld", comments: "Geen campagnes.", confidence: "low" };
    const remarketing = ctx.campaigns.filter((c) =>
      c.campaign_type === "DISPLAY" || c.campaign_type === "VIDEO" || c.campaign_type === "DISCOVERY" || c.campaign_type === "DEMAND_GEN" ||
      c.campaign_name.toLowerCase().includes("remarketing") || c.campaign_name.toLowerCase().includes("retargeting")
    );
    if (remarketing.length > 0) return { score: "Goed", comments: `${remarketing.length} remarketing campagne(s) actief: ${remarketing.map((c) => c.campaign_name).slice(0, 3).join(", ")}.`, confidence: "high" };
    return { score: "Onvoldoende", comments: "Geen remarketing campagnes gevonden (Display, Discovery, YouTube, Demand Gen). Overweeg remarketing op te zetten.", confidence: "high" };
  },

  // #37: Remarketing biedstrategie logisch?
  37: (ctx) => {
    const remarketing = ctx.campaigns.filter((c) =>
      c.campaign_type === "DISPLAY" || c.campaign_name.toLowerCase().includes("remarketing")
    );
    if (remarketing.length === 0) return { score: "Niet van toepassing", comments: "Geen remarketing campagnes in dit account.", confidence: "high" };
    const strategies = [...new Set(remarketing.map((c) => c.bidding_strategy))];
    return { score: "Voldoende", comments: `Remarketing biedstrategieën: ${strategies.join(", ")}.`, confidence: "medium" };
  },

  // #40: Campagnestructuur logisch?
  40: (ctx) => {
    if (ctx.campaigns.length === 0) return { score: "Niet beoordeeld", comments: "Geen campagnes.", confidence: "low" };
    const types = [...new Set(ctx.campaigns.map((c) => c.campaign_type))];
    const count = ctx.campaigns.length;
    const activeCount = ctx.campaigns.filter((c) => ["ELIGIBLE", "SERVING", "ENABLED"].includes(c.serving_status)).length;
    const comments = `${count} campagnes (${activeCount} actief) over ${types.length} type(s): ${types.join(", ")}.`;
    if (count <= 5) return { score: "Goed", comments: comments + " Compact en overzichtelijk.", confidence: "medium" };
    if (count <= 15) return { score: "Voldoende", comments, confidence: "medium" };
    return { score: "Voldoende", comments: comments + " Relatief veel campagnes — controleer of structuur logisch is.", confidence: "low" };
  },

  // #22: PMax URL uitbreiding?
  22: (ctx) => {
    if (ctx.pmaxUrlExpansion.length === 0) {
      const pmax = ctx.campaigns.filter((c) => c.campaign_type === "PERFORMANCE_MAX");
      if (pmax.length === 0) return { score: "Niet van toepassing", comments: "Geen PMax campagnes in dit account.", confidence: "high" };
      return { score: "Niet beoordeeld", comments: "URL expansion data niet beschikbaar.", confidence: "low" };
    }
    const optedOut = ctx.pmaxUrlExpansion.filter((p) => p.urlExpansionOptOut);
    const notOptedOut = ctx.pmaxUrlExpansion.filter((p) => !p.urlExpansionOptOut);
    if (notOptedOut.length === 0) return { score: "Goed", comments: `URL uitbreiding uitgeschakeld bij alle ${ctx.pmaxUrlExpansion.length} PMax campagne(s). Goed — geen irrelevante URL's.`, confidence: "high" };
    if (optedOut.length > 0) return { score: "Voldoende", comments: `${optedOut.length} van ${ctx.pmaxUrlExpansion.length} PMax campagnes met URL uitbreiding uit. ${notOptedOut.map((p) => p.campaignName).join(", ")} heeft het nog aan.`, confidence: "high" };
    return { score: "Onvoldoende", comments: `URL uitbreiding staat aan bij alle ${ctx.pmaxUrlExpansion.length} PMax campagne(s): ${notOptedOut.map((p) => p.campaignName).join(", ")}. Overweeg uitschakelen of irrelevante URL's uitsluiten.`, confidence: "high" };
  },

  // #28: Shopping campagnedoelen?
  28: (ctx) => {
    const shopping = ctx.campaigns.filter((c) => c.campaign_type === "SHOPPING");
    if (shopping.length === 0) return { score: "Niet van toepassing", comments: "Geen Shopping campagnes in dit account.", confidence: "high" };
    const withTarget = shopping.filter((c) => c.bidding_strategy_target && c.bidding_strategy_target > 0);
    if (withTarget.length === shopping.length) return { score: "Goed", comments: `${shopping.length} Shopping campagne(s), allemaal met biedingsdoel.`, confidence: "high" };
    return { score: "Onvoldoende", comments: `${shopping.length - withTarget.length} van ${shopping.length} Shopping campagnes zonder specifiek biedingsdoel.`, confidence: "medium" };
  },

  // #29: Product filters (via account structure — product group counts)
  29: (ctx) => {
    const shopping = ctx.campaigns.filter((c) => c.campaign_type === "SHOPPING");
    if (shopping.length === 0) return { score: "Niet van toepassing", comments: "Geen Shopping campagnes in dit account.", confidence: "high" };
    // If we have product data, check if there's segmentation
    if (ctx.products.length > 0) {
      const campaigns = [...new Set(ctx.products.map((p) => p.campaign_name))];
      return { score: "Voldoende", comments: `${ctx.products.length} producten actief over ${campaigns.length} campagne(s). Controleer handmatig of filters optimaal zijn.`, confidence: "low" };
    }
    return { score: "Niet beoordeeld", comments: "Geen productdata beschikbaar om filters te beoordelen.", confidence: "low" };
  },

  // #31: Shopping prioriteitsinstellingen?
  31: (ctx) => {
    if (ctx.shoppingPriorities.length === 0) {
      const shopping = ctx.campaigns.filter((c) => c.campaign_type === "SHOPPING");
      if (shopping.length === 0) return { score: "Niet van toepassing", comments: "Geen Shopping campagnes in dit account.", confidence: "high" };
      return { score: "Niet beoordeeld", comments: "Prioriteitsdata niet beschikbaar.", confidence: "low" };
    }
    const priorities = ctx.shoppingPriorities.map((s) => `${s.campaignName}: prioriteit ${s.priority}`);
    const uniquePriorities = [...new Set(ctx.shoppingPriorities.map((s) => s.priority))];
    if (ctx.shoppingPriorities.length === 1) return { score: "Goed", comments: `1 Shopping campagne: ${priorities[0]}. Prioriteit n.v.t. bij enkele campagne.`, confidence: "high" };
    if (uniquePriorities.length === 1) return { score: "Onvoldoende", comments: `${ctx.shoppingPriorities.length} Shopping campagnes met dezelfde prioriteit (${uniquePriorities[0]}). Differentieer voor betere controle.`, confidence: "high" };
    return { score: "Goed", comments: `Shopping prioriteiten gedifferentieerd: ${priorities.join(", ")}.`, confidence: "high" };
  },

  // #35: Remarketing doelgroepen gesegmenteerd?
  35: (ctx) => {
    const remarketing = ctx.campaigns.filter((c) =>
      c.campaign_type === "DISPLAY" || c.campaign_type === "VIDEO" || c.campaign_type === "DISCOVERY" || c.campaign_type === "DEMAND_GEN" ||
      c.campaign_name.toLowerCase().includes("remarketing") || c.campaign_name.toLowerCase().includes("retargeting")
    );
    if (remarketing.length === 0) return { score: "Niet van toepassing", comments: "Geen remarketing campagnes in dit account.", confidence: "high" };
    // Check if there are multiple remarketing campaigns (sign of segmentation)
    if (remarketing.length >= 3) return { score: "Goed", comments: `${remarketing.length} remarketing campagnes: ${remarketing.map((c) => c.campaign_name).slice(0, 4).join(", ")}. Goede segmentatie.`, confidence: "medium" };
    if (remarketing.length === 2) return { score: "Voldoende", comments: `${remarketing.length} remarketing campagnes. Overweeg verdere segmentatie (bijv. op basis van tijd/intentie).`, confidence: "medium" };
    return { score: "Onvoldoende", comments: `Slechts 1 remarketing campagne (${remarketing[0].campaign_name}). Overweeg segmentatie op basis van activiteit, intentie en tijd.`, confidence: "medium" };
  },

  // #36: Uitsluitingsplaatsingen?
  36: (ctx) => {
    const display = ctx.campaigns.filter((c) => c.campaign_type === "DISPLAY" || c.campaign_type === "VIDEO");
    if (display.length === 0) return { score: "Niet van toepassing", comments: "Geen Display/Video campagnes in dit account.", confidence: "high" };
    return { score: "Voldoende", comments: `${display.length} Display/Video campagne(s) actief. Controleer handmatig of uitsluitingsplaatsingen zijn toegevoegd voor slecht presterende plaatsingen.`, confidence: "low" };
  },

  // #38: Geoptimaliseerd targeting (optimized targeting)?
  38: (ctx) => {
    if (ctx.adGroupTargeting.length === 0) {
      const remarketing = ctx.campaigns.filter((c) => c.campaign_type === "DISPLAY" || c.campaign_type === "DISCOVERY");
      if (remarketing.length === 0) return { score: "Niet van toepassing", comments: "Geen Display/Discovery campagnes in dit account.", confidence: "high" };
      return { score: "Voldoende", comments: "Targeting settings data niet beschikbaar. Controleer handmatig of geoptimaliseerd targeting aanstaat.", confidence: "low" };
    }
    const optimizedOn = ctx.adGroupTargeting.filter((t) => t.optimizedTargetingEnabled);
    const optimizedOff = ctx.adGroupTargeting.filter((t) => !t.optimizedTargetingEnabled);
    if (optimizedOn.length === 0) return { score: "Goed", comments: `Geoptimaliseerd targeting uit bij alle ${ctx.adGroupTargeting.length} ad group(s). Goed voor remarketing.`, confidence: "high" };
    if (optimizedOff.length > 0) return { score: "Voldoende", comments: `${optimizedOn.length} van ${ctx.adGroupTargeting.length} ad groups met geoptimaliseerd targeting aan. Controleer of dit gewenst is.`, confidence: "medium" };
    return { score: "Onvoldoende", comments: `Geoptimaliseerd targeting staat aan bij alle ${ctx.adGroupTargeting.length} ad groups. Bij remarketing kan dit leiden tot irrelevant bereik.`, confidence: "medium" };
  },

  // #39: Frequentiebeheer?
  39: (ctx) => {
    if (ctx.frequencyCaps.length === 0) {
      const display = ctx.campaigns.filter((c) => c.campaign_type === "DISPLAY" || c.campaign_type === "VIDEO");
      if (display.length === 0) return { score: "Niet van toepassing", comments: "Geen Display/Video campagnes in dit account.", confidence: "high" };
      return { score: "Voldoende", comments: "Frequentiecap data niet beschikbaar. Standaard laat Google Ads dit optimaliseren.", confidence: "low" };
    }
    const withCap = ctx.frequencyCaps.filter((f) => f.hasFrequencyCap);
    const withoutCap = ctx.frequencyCaps.filter((f) => !f.hasFrequencyCap);
    if (withCap.length === ctx.frequencyCaps.length) return { score: "Goed", comments: `Frequentielimiet ingesteld bij alle ${ctx.frequencyCaps.length} campagne(s): ${withCap.map((f) => `${f.campaignName} (${f.capCount}/${f.capTimeUnit})`).slice(0, 3).join(", ")}.`, confidence: "high" };
    if (withoutCap.length === ctx.frequencyCaps.length) return { score: "Voldoende", comments: `Geen frequentielimiet ingesteld. Google Ads optimaliseert automatisch. Overweeg handmatige limiet bij hoge frequency.`, confidence: "medium" };
    return { score: "Voldoende", comments: `${withCap.length} van ${ctx.frequencyCaps.length} campagnes met frequentielimiet.`, confidence: "medium" };
  },

  // #41: AAR's (Auto Applied Recommendations)?
  41: (ctx) => {
    // Google Ads API doesn't expose AAR settings directly in a simple query
    // But we can give a meaningful "check this" response instead of "niet beoordeeld"
    return { score: "Voldoende", comments: "AAR-instellingen zijn niet via de API te verifiëren. Controleer in Google Ads onder Aanbevelingen > Automatisch toepassen. Aanbeveling: zet AAR's UIT voor maximale controle.", confidence: "low" };
  },

  // #42: Plaatsingen/contentvormen uitgesloten?
  42: (ctx) => {
    const display = ctx.campaigns.filter((c) => c.campaign_type === "DISPLAY" || c.campaign_type === "VIDEO" || c.campaign_type === "PERFORMANCE_MAX");
    if (display.length === 0) return { score: "Goed", comments: "Geen Display/Video/PMax campagnes die plaatsingen gebruiken.", confidence: "high" };
    return { score: "Voldoende", comments: `${display.length} campagne(s) met plaatsingen (Display/Video/PMax). Controleer handmatig of gevoelige/irrelevante content categorieën zijn uitgesloten in Accountinstellingen > Contentgeschiktheid.`, confidence: "low" };
  },

  // #43: Locatie targeting correct?
  43: (ctx) => {
    if (ctx.locationTargets.length === 0) {
      if (ctx.campaigns.length > 0) return { score: "Voldoende", comments: "Locatie targeting data niet geladen. Controleer handmatig.", confidence: "low" };
      return { score: "Niet beoordeeld", comments: "Geen data.", confidence: "low" };
    }
    const locations = [...new Set(ctx.locationTargets.map((l) => l.location_name))];
    const campaignsWithTargets = [...new Set(ctx.locationTargets.map((l) => l.campaign_name))];
    return { score: "Goed", comments: `${campaignsWithTargets.length} campagne(s) met locatie targeting: ${locations.slice(0, 5).join(", ")}${locations.length > 5 ? ` (+${locations.length - 5} meer)` : ""}.`, confidence: "medium" };
  },

  // #44: Accounts gekoppeld (GA4, GMC, etc)?
  44: (ctx) => {
    // Can't fully verify linked accounts via standard API, but give actionable advice
    const hasShopping = ctx.campaigns.some((c) => c.campaign_type === "SHOPPING" || c.campaign_type === "PERFORMANCE_MAX");
    const comments = hasShopping
      ? "Shopping/PMax campagnes actief — Merchant Center is gekoppeld. Controleer handmatig of GA4 en My Business ook zijn gekoppeld."
      : "Controleer handmatig of GA4, Google Merchant Center (indien e-commerce) en Google My Business (indien lokaal) zijn gekoppeld.";
    return { score: "Voldoende", comments, confidence: "low" };
  },

  // ── PMAX Intelligence checks ──

  // #46: PMAX network mix gezond?
  46: (ctx) => {
    if (ctx.pmaxNetworkBreakdown.length === 0) {
      const pmax = ctx.campaigns.filter((c) => c.campaign_type === "PERFORMANCE_MAX");
      if (pmax.length === 0) return { score: "Niet van toepassing", comments: "Geen PMax campagnes in dit account.", confidence: "high" };
      return { score: "Niet beoordeeld", comments: "Geen PMAX network breakdown data beschikbaar.", confidence: "low" };
    }
    const totalCost = ctx.pmaxNetworkBreakdown.reduce((s, n) => s + n.cost, 0);
    const totalConv = ctx.pmaxNetworkBreakdown.reduce((s, n) => s + n.conversions, 0);
    const displayCost = ctx.pmaxNetworkBreakdown.filter((n) => n.network_type === "CONTENT" || n.network_type === "YOUTUBE_WATCH").reduce((s, n) => s + n.cost, 0);
    const displayConv = ctx.pmaxNetworkBreakdown.filter((n) => n.network_type === "CONTENT" || n.network_type === "YOUTUBE_WATCH").reduce((s, n) => s + n.conversions, 0);
    const displayCostPct = totalCost > 0 ? Math.round((displayCost / totalCost) * 100) : 0;
    const displayConvPct = totalConv > 0 ? Math.round((displayConv / totalConv) * 100) : 0;
    const searchCost = ctx.pmaxNetworkBreakdown.filter((n) => n.network_type === "SEARCH").reduce((s, n) => s + n.cost, 0);
    const searchPct = totalCost > 0 ? Math.round((searchCost / totalCost) * 100) : 0;

    if (displayCostPct > 40 && displayConvPct < 15) return { score: "Onvoldoende", comments: `Display/Video neemt ${displayCostPct}% van PMAX spend maar levert slechts ${displayConvPct}% conversies. Groei komt van lage-kwaliteit inventory.`, confidence: "high" };
    if (searchPct < 20) return { score: "Voldoende", comments: `Search is slechts ${searchPct}% van PMAX spend. De campagne leunt zwaar op Display/Video/Shopping.`, confidence: "medium" };
    return { score: "Goed", comments: `Gezonde netwerkverdeling: Search ${searchPct}%, Display/Video ${displayCostPct}%. Conversies zijn proportioneel verdeeld.`, confidence: "high" };
  },

  // #47: Asset groups zonder conversies?
  47: (ctx) => {
    const pmax = ctx.campaigns.filter((c) => c.campaign_type === "PERFORMANCE_MAX");
    if (pmax.length === 0) return { score: "Niet van toepassing", comments: "Geen PMax campagnes in dit account.", confidence: "high" };
    if (ctx.assetGroups.length === 0) return { score: "Niet beoordeeld", comments: "Geen asset group data beschikbaar.", confidence: "low" };
    const zeroConv = ctx.assetGroups.filter((ag) => ag.conversions === 0 && ag.cost > 10);
    const wasteCost = zeroConv.reduce((s, ag) => s + ag.cost, 0);
    if (zeroConv.length === 0) return { score: "Goed", comments: `Alle ${ctx.assetGroups.length} asset groups leveren conversies.`, confidence: "high" };
    if (zeroConv.length > 2 || wasteCost > 100) return { score: "Onvoldoende", comments: `${zeroConv.length} asset group(s) zonder conversies (€${Math.round(wasteCost)} waste): ${zeroConv.map((a) => a.asset_group_name).slice(0, 3).join(", ")}.`, confidence: "high" };
    return { score: "Voldoende", comments: `${zeroConv.length} asset group(s) met spend maar 0 conversies. Kleine waste (€${Math.round(wasteCost)}).`, confidence: "medium" };
  },

  // #48: Asset kwaliteit?
  48: (ctx) => {
    const pmax = ctx.campaigns.filter((c) => c.campaign_type === "PERFORMANCE_MAX");
    if (pmax.length === 0) return { score: "Niet van toepassing", comments: "Geen PMax campagnes in dit account.", confidence: "high" };
    if (ctx.pmaxAssets.length === 0) return { score: "Niet beoordeeld", comments: "Geen asset performance data beschikbaar.", confidence: "low" };
    const low = ctx.pmaxAssets.filter((a) => a.performance_label === "LOW").length;
    const best = ctx.pmaxAssets.filter((a) => a.performance_label === "BEST").length;
    const good = ctx.pmaxAssets.filter((a) => a.performance_label === "GOOD").length;
    const total = ctx.pmaxAssets.length;
    const types = [...new Set(ctx.pmaxAssets.map((a) => a.asset_type))];
    const hasVideo = types.some((t) => t.includes("VIDEO") || t.includes("YOUTUBE"));
    const comments = `${total} assets: ${best} BEST, ${good} GOOD, ${low} LOW. Types: ${types.join(", ")}. ${hasVideo ? "Video aanwezig." : "Geen video — overweeg toevoegen."}`;
    if (low > best * 2 && low >= 3) return { score: "Onvoldoende", comments, confidence: "medium" };
    if (best + good >= low) return { score: "Goed", comments, confidence: "high" };
    return { score: "Voldoende", comments, confidence: "medium" };
  },

  // #49: Placement waste?
  49: (ctx) => {
    const pmax = ctx.campaigns.filter((c) => c.campaign_type === "PERFORMANCE_MAX");
    if (pmax.length === 0) return { score: "Niet van toepassing", comments: "Geen PMax campagnes in dit account.", confidence: "high" };
    if (ctx.pmaxPlacements.length === 0) return { score: "Niet beoordeeld", comments: "Geen placement data beschikbaar.", confidence: "low" };
    const waste = ctx.pmaxPlacements.filter((p) => p.cost > 20 && p.conversions === 0);
    const wasteCost = waste.reduce((s, p) => s + p.cost, 0);
    if (waste.length === 0) return { score: "Goed", comments: `${ctx.pmaxPlacements.length} plaatsingen geanalyseerd, geen significant waste gevonden.`, confidence: "high" };
    if (wasteCost > 100) return { score: "Onvoldoende", comments: `€${Math.round(wasteCost)} verspild op ${waste.length} plaatsing(en) zonder conversies. Top: ${waste.slice(0, 3).map((p) => p.placement).join(", ")}.`, confidence: "high" };
    return { score: "Voldoende", comments: `${waste.length} plaatsing(en) met spend maar 0 conversies (€${Math.round(wasteCost)}). Beperkte waste.`, confidence: "medium" };
  },
};

function evaluateProductPerformance(ctx: AccountContext): { score: AuditScore; comments: string; confidence: "high" | "medium" | "low" } {
  if (ctx.products.length === 0) return { score: "Niet beoordeeld", comments: "Geen productdata beschikbaar.", confidence: "low" };
  const totalCost = ctx.products.reduce((s, p) => s + p.cost, 0);
  const top10Cost = ctx.products.slice(0, 10).reduce((s, p) => s + p.cost, 0);
  const concentration = totalCost > 0 ? Math.round((top10Cost / totalCost) * 100) : 0;
  const zeroConv = ctx.products.filter((p) => p.conversions === 0 && p.cost > 0);
  const wasteCost = zeroConv.reduce((s, p) => s + p.cost, 0);
  const comments = `${ctx.products.length} producten. Top 10 = ${concentration}% van spend. ${zeroConv.length} producten met spend maar 0 conversies (€${Math.round(wasteCost)}).`;
  if (concentration > 80 && zeroConv.length > 10) return { score: "Onvoldoende", comments, confidence: "high" };
  if (zeroConv.length > 5) return { score: "Voldoende", comments, confidence: "medium" };
  return { score: "Goed", comments, confidence: "medium" };
}

// ── Main evaluation function ───────────────────────────────────────────────

function evaluateRow(row: TemplateRow, ctx: AccountContext): AuditRowResult {
  if (row.supportStatus === "unsupported") {
    return {
      templateId: row.id,
      section: row.section,
      controlPoint: row.controlPoint,
      impact: row.impact,
      complexity: row.complexity,
      score: "Niet beoordeeld",
      comments: "Handmatige beoordeling vereist — geen geautomatiseerde data beschikbaar.",
      supportStatus: "unsupported",
      evidenceSources: [],
      confidence: "low",
      method: "unsupported",
    };
  }

  const evaluator = evaluators[row.id];
  if (evaluator) {
    const result = evaluator(ctx);
    return {
      templateId: row.id,
      section: row.section,
      controlPoint: row.controlPoint,
      impact: row.impact,
      complexity: row.complexity,
      score: result.score,
      comments: result.comments,
      supportStatus: row.supportStatus,
      evidenceSources: row.dataSources,
      confidence: result.confidence,
      method: "deterministic",
    };
  }

  return {
    templateId: row.id,
    section: row.section,
    controlPoint: row.controlPoint,
    impact: row.impact,
    complexity: row.complexity,
    score: "Niet beoordeeld",
    comments: "Gedeeltelijke data beschikbaar — handmatige beoordeling aanbevolen.",
    supportStatus: row.supportStatus,
    evidenceSources: row.dataSources,
    confidence: "low",
    method: "manual",
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function runSecondOpinionAudit(
  supabase: SupabaseClient,
  clientId: string,
  mode: AuditMode,
  onPhase?: (phaseKey: "fetch_account_context" | "evaluate_checks" | "synthesize_findings", message?: string) => Promise<void>
): Promise<Omit<SecondOpinionRun, "id" | "createdAt" | "pdfStoragePath" | "fileId">> {
  const template = getTemplateForMode(mode);
  await onPhase?.("fetch_account_context", "Auditcontext, benchmarks en accountdata ophalen...");
  const ctx = await loadAccountContext(supabase, clientId);

  await onPhase?.("evaluate_checks", `Auditchecks uitvoeren (${template.length} controlepunten)...`);
  const rows: AuditRowResult[] = template.map((row) => evaluateRow(row, ctx));
  await onPhase?.("synthesize_findings", "Sectiescores en auditconclusie samenstellen...");
  const sectionSummaries = calculateAllSummaries(rows);

  return {
    clientId,
    mode,
    status: "completed",
    completedAt: new Date().toISOString(),
    rows,
    sectionSummaries,
    error: null,
  };
}
