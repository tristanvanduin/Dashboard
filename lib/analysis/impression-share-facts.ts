// G1: de pure voorcompute voor de impression-share- en zichtbaarheidsanalyse. Dit is het
// deterministische hart dat de prompt voedt: het rekent uit waar het account zichtbaarheid
// verliest en of dat budget- of rang-gedreven is, in plaats van het model dat te laten
// gissen. IO-vrij en los getest; de losse-analyse-endpoint en de prompt zijn de dunne laag.
//
// IS-waarden worden overgenomen zoals de sync ze opslaat (fracties uit de Google Ads API).
// De classificatie vergelijkt budget-lost tegen rank-lost en is daarmee schaal-onafhankelijk.

export type LossDriver = "budget" | "rank" | "mixed" | "none";
export type ActionCandidate = "raise_budget" | "improve_bid_or_quality" | "both" | "none";

// Onder dit totale verlies is de zichtbaarheid gezond en is er geen actie nodig.
export const NEGLIGIBLE_LOST_IS = 0.05;
// Een oorzaak is primair als hij dit deel groter is dan de andere; anders is het gemengd.
export const DRIVER_MARGIN = 0.25;

export interface CampaignImpressionShareRow {
  campaign_id: string;
  campaign_name: string;
  campaign_type?: string | null;
  month: string;
  conversions?: number | null;
  cost?: number | null;
  search_impression_share?: number | null;
  search_budget_lost_is?: number | null;
  search_rank_lost_is?: number | null;
  daily_budget?: number | null;
  budget_utilization?: number | null;
}

// Bepaalt de primaire oorzaak van het zichtbaarheidsverlies. Budget-gedreven betekent dat je
// budget mist; rang-gedreven betekent dat je bod of kwaliteit tekortschiet.
export function classifyLossDriver(budgetLost: number, rankLost: number): LossDriver {
  const totalLost = budgetLost + rankLost;
  if (totalLost < NEGLIGIBLE_LOST_IS) return "none";
  if (budgetLost > rankLost * (1 + DRIVER_MARGIN)) return "budget";
  if (rankLost > budgetLost * (1 + DRIVER_MARGIN)) return "rank";
  return "mixed";
}

// De actie-kandidaat. No-go uit de spec: geen budgetverhoging voorstellen zonder
// conversiebewijs, dus een budget-gedreven campagne zonder conversies levert geen
// budget-actie op (de interpretatie kan hem wel benoemen).
export function actionForDriver(driver: LossDriver, hasConversions: boolean): ActionCandidate {
  if (driver === "none") return "none";
  if (driver === "budget") return hasConversions ? "raise_budget" : "none";
  if (driver === "rank") return "improve_bid_or_quality";
  return hasConversions ? "both" : "improve_bid_or_quality";
}

export interface CampaignISFact {
  campaignId: string;
  campaignName: string;
  campaignType: string | null;
  impressionShare: number;
  budgetLostIs: number;
  rankLostIs: number;
  totalLostIs: number;
  driver: LossDriver;
  action: ActionCandidate;
  conversions: number;
  cost: number;
  cpa: number | null;
  impressionShareMoM: number | null;
}

export interface ImpressionShareSummary {
  campaignsAnalysed: number;
  budgetDriven: number;
  rankDriven: number;
  mixed: number;
  healthy: number;
  raiseBudgetCandidates: number;
  bidOrQualityCandidates: number;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Analyseert de campagne-IS-rijen: neemt per campagne de laatste maand, classificeert de
// oorzaak, bepaalt de actie, rekent de MoM tegen de vorige maand, en rangschikt op het
// grootste zichtbaarheidsverlies zodat de belangrijkste campagnes bovenaan staan.
export function analyzeCampaignImpressionShare(rows: CampaignImpressionShareRow[]): {
  campaigns: CampaignISFact[];
  summary: ImpressionShareSummary;
} {
  const byCampaign = new Map<string, CampaignImpressionShareRow[]>();
  for (const row of rows) {
    if (!row.campaign_id || !row.month) continue;
    const list = byCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    byCampaign.set(row.campaign_id, list);
  }

  const campaigns: CampaignISFact[] = [];
  for (const [campaignId, list] of byCampaign) {
    list.sort((a, b) => String(a.month).localeCompare(String(b.month)));
    const latest = list[list.length - 1];
    const prior = list.length >= 2 ? list[list.length - 2] : null;

    const budgetLostIs = num(latest.search_budget_lost_is);
    const rankLostIs = num(latest.search_rank_lost_is);
    const conversions = num(latest.conversions);
    const cost = num(latest.cost);
    const driver = classifyLossDriver(budgetLostIs, rankLostIs);

    campaigns.push({
      campaignId,
      campaignName: latest.campaign_name,
      campaignType: latest.campaign_type ?? null,
      impressionShare: num(latest.search_impression_share),
      budgetLostIs,
      rankLostIs,
      totalLostIs: Math.round((budgetLostIs + rankLostIs) * 10000) / 10000,
      driver,
      action: actionForDriver(driver, conversions > 0),
      conversions,
      cost,
      cpa: conversions > 0 ? Math.round((cost / conversions) * 100) / 100 : null,
      impressionShareMoM: prior
        ? Math.round((num(latest.search_impression_share) - num(prior.search_impression_share)) * 10000) / 10000
        : null,
    });
  }

  campaigns.sort((a, b) => b.totalLostIs - a.totalLostIs);

  const summary: ImpressionShareSummary = {
    campaignsAnalysed: campaigns.length,
    budgetDriven: campaigns.filter((c) => c.driver === "budget").length,
    rankDriven: campaigns.filter((c) => c.driver === "rank").length,
    mixed: campaigns.filter((c) => c.driver === "mixed").length,
    healthy: campaigns.filter((c) => c.driver === "none").length,
    raiseBudgetCandidates: campaigns.filter((c) => c.action === "raise_budget" || c.action === "both").length,
    bidOrQualityCandidates: campaigns.filter((c) => c.action === "improve_bid_or_quality" || c.action === "both").length,
  };

  return { campaigns, summary };
}

export interface CountryImpressionShareRow {
  country_code: string;
  month: string;
  search_impression_share?: number | null;
  search_budget_lost_is?: number | null;
  search_rank_lost_is?: number | null;
  total_cost?: number | null;
}

export interface CountryISFact {
  countryCode: string;
  impressionShare: number;
  totalLostIs: number;
  driver: LossDriver;
  cost: number;
}

// Vat de geo-laag samen: per land de laatste maand, geclassificeerd, gerangschikt op het
// grootste verlies, zodat zichtbaar wordt waar de zichtbaarheid regionaal wegvalt.
export function analyzeGeoImpressionShare(rows: CountryImpressionShareRow[], topN = 10): CountryISFact[] {
  const byCountry = new Map<string, CountryImpressionShareRow[]>();
  for (const row of rows) {
    if (!row.country_code || !row.month) continue;
    const list = byCountry.get(row.country_code) ?? [];
    list.push(row);
    byCountry.set(row.country_code, list);
  }

  const countries: CountryISFact[] = [];
  for (const [countryCode, list] of byCountry) {
    list.sort((a, b) => String(a.month).localeCompare(String(b.month)));
    const latest = list[list.length - 1];
    const budgetLostIs = num(latest.search_budget_lost_is);
    const rankLostIs = num(latest.search_rank_lost_is);
    countries.push({
      countryCode,
      impressionShare: num(latest.search_impression_share),
      totalLostIs: Math.round((budgetLostIs + rankLostIs) * 10000) / 10000,
      driver: classifyLossDriver(budgetLostIs, rankLostIs),
      cost: num(latest.total_cost),
    });
  }

  countries.sort((a, b) => b.totalLostIs - a.totalLostIs);
  return countries.slice(0, topN);
}
