// Hefboom 3: de pure voorcompute voor de fit van de biedstrategie. Bepaalt per campagne of
// de huidige strategie past bij het conversievolume, de waarde-tracking en het doel. IO-vrij
// en los getest; de endpoint merget de biedstrategie en conversies (ads_campaign_impression_share)
// met de conversiewaarde (ads_campaign_monthly) en het doel (kpi_targets) en roept dit aan.
//
// Smart bidding heeft data nodig om te leren; waarde-bieden heeft conversiewaarde nodig. De
// classificatie flagt precies die mismatches, in plaats van een generieke checklist.

export type BidStrategyKind = "manual" | "smart_conversion" | "smart_value" | "non_conversion" | "unknown";
export type BidStrategyFit =
  | "fit"
  | "upgrade_to_smart"
  | "switch_to_value"
  | "insufficient_volume"
  | "value_missing"
  | "review_non_conversion"
  | "unknown";

export const SMART_BIDDING_MIN_CONV = 15; // per maand, vuistregel voor smart bidding om te leren
export const VALUE_BIDDING_MIN_CONV = 30; // waarde-bieden loont pas met genoeg conversies

// Mapt de echte Google-biedstrategie-strings naar een soort. Case-ongevoelig.
export function normalizeBidStrategy(strategy: string | null | undefined): BidStrategyKind {
  if (!strategy) return "unknown";
  const s = strategy.trim().toUpperCase();
  if (s === "MANUAL_CPC" || s === "ENHANCED_CPC") return "manual";
  if (s === "MAXIMIZE_CONVERSIONS" || s === "TARGET_CPA") return "smart_conversion";
  if (s === "MAXIMIZE_CONVERSION_VALUE" || s === "TARGET_ROAS") return "smart_value";
  if (s === "TARGET_SPEND" || s === "TARGET_IMPRESSION_SHARE") return "non_conversion";
  return "unknown";
}

export interface CampaignBidInput {
  campaignId: string;
  campaignName: string;
  biddingStrategy?: string | null;
  conversions?: number | null;
  conversionsValue?: number | null;
}

export interface BidGoal {
  hasCpaTarget: boolean;
  hasRoasTarget: boolean;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// De fit-classificatie per campagne. De volgorde van de checks is bewust: eerst de
// blokkerende mismatches (waarde ontbreekt, te weinig volume), dan de upgrades.
export function classifyBidFit(campaign: CampaignBidInput, goal: BidGoal): BidStrategyFit {
  const kind = normalizeBidStrategy(campaign.biddingStrategy);
  if (kind === "unknown") return "unknown";

  const conversions = num(campaign.conversions);
  const hasValue = campaign.conversionsValue != null && num(campaign.conversionsValue) > 0;

  // Niet-conversie-strategie op een campagne die wel converteert en een doel heeft: review.
  if (kind === "non_conversion") {
    return conversions >= SMART_BIDDING_MIN_CONV && (goal.hasCpaTarget || goal.hasRoasTarget)
      ? "review_non_conversion"
      : "fit";
  }

  // Waarde-strategie zonder conversiewaarde kan niet op waarde sturen.
  if (kind === "smart_value" && !hasValue) return "value_missing";

  // Smart bidding zonder genoeg volume kan niet leren.
  if ((kind === "smart_value" || kind === "smart_conversion") && conversions < SMART_BIDDING_MIN_CONV) {
    return "insufficient_volume";
  }

  // Handmatig bij voldoende volume laat rendement liggen: upgrade naar smart.
  if (kind === "manual") {
    return conversions >= SMART_BIDDING_MIN_CONV ? "upgrade_to_smart" : "fit";
  }

  // Conversie-smart terwijl er een ROAS-doel, waarde en genoeg volume is: naar waarde-bieden.
  if (kind === "smart_conversion" && goal.hasRoasTarget && hasValue && conversions >= VALUE_BIDDING_MIN_CONV) {
    return "switch_to_value";
  }

  return "fit";
}

export interface BidFact {
  campaignId: string;
  campaignName: string;
  strategy: string;
  kind: BidStrategyKind;
  conversions: number;
  hasValue: boolean;
  fit: BidStrategyFit;
  recommendation: string;
}

const RECOMMENDATION: Record<BidStrategyFit, string> = {
  fit: "biedstrategie past bij volume, waarde en doel",
  upgrade_to_smart: "genoeg volume voor smart bidding: stap over van handmatig naar doel-CPA of doel-ROAS",
  switch_to_value: "ROAS-doel met conversiewaarde en volume: stap over naar waarde-bieden (doel-ROAS of maximaliseer conversiewaarde)",
  insufficient_volume: "te weinig conversies voor smart bidding om betrouwbaar te leren: overweeg consolidatie of een eenvoudiger strategie",
  value_missing: "waarde-strategie zonder conversiewaarde: zet eerst conversiewaarde-tracking op of stap over naar een conversie-strategie",
  review_non_conversion: "niet-conversie-strategie op een converterende campagne met een doel: heroverweeg naar conversie- of waarde-bieden",
  unknown: "biedstrategie onbekend of niet herkend: verifieer de instelling",
};

export interface BidStrategySummary {
  campaignsAnalysed: number;
  fit: number;
  mismatches: number;
  byFit: Record<BidStrategyFit, number>;
}

// De volledige analyse: per campagne de fit, met de mismatches vooraan zodat de
// belangrijkste heroverwegingen bovenaan staan.
export function analyzeBidStrategy(campaigns: CampaignBidInput[], goal: BidGoal): {
  campaigns: BidFact[];
  summary: BidStrategySummary;
} {
  const facts: BidFact[] = campaigns
    .filter((c) => c.campaignId)
    .map((c) => {
      const fit = classifyBidFit(c, goal);
      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        strategy: c.biddingStrategy ?? "onbekend",
        kind: normalizeBidStrategy(c.biddingStrategy),
        conversions: num(c.conversions),
        hasValue: c.conversionsValue != null && num(c.conversionsValue) > 0,
        fit,
        recommendation: RECOMMENDATION[fit],
      };
    });

  // Mismatches (alles behalve fit) eerst, daarbinnen op conversievolume aflopend zodat de
  // impactvolle campagnes bovenaan staan.
  facts.sort((a, b) => {
    const am = a.fit === "fit" ? 1 : 0;
    const bm = b.fit === "fit" ? 1 : 0;
    if (am !== bm) return am - bm;
    return b.conversions - a.conversions;
  });

  const byFit = {} as Record<BidStrategyFit, number>;
  for (const f of facts) byFit[f.fit] = (byFit[f.fit] ?? 0) + 1;

  const summary: BidStrategySummary = {
    campaignsAnalysed: facts.length,
    fit: facts.filter((f) => f.fit === "fit").length,
    mismatches: facts.filter((f) => f.fit !== "fit" && f.fit !== "unknown").length,
    byFit,
  };

  return { campaigns: facts, summary };
}
