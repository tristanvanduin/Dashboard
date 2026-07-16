// Hefboom 2: de pure voorcompute voor marginale budgetallocatie. Bepaalt waar de volgende
// euro heen moet en waar hij vandaan komt, op drie deterministische assen: efficientie
// tegen de target (CPA of ROAS), groeiruimte (budget-lost impression share en
// budgetbenutting) en verzadiging (rank-lost impression share). Bouwt voort op de IS-data
// van G1. IO-vrij en los getest; de endpoint merget ads_campaign_monthly (conversiewaarde)
// met ads_campaign_impression_share (verlies) en roept dit aan.
//
// De marginale gedachte: de volgende euro gaat naar een campagne die efficient EN
// budget-beperkt is (bewezen vraag die hij niet volledig bedient), en komt van een campagne
// die de target mist. Een rang-beperkte campagne krijgt geen budget, want daar is het bod of
// de kwaliteit de rem, niet het budget (dat is de G1-actie).

export type BudgetAction = "scale_up" | "scale_down" | "hold";
export type EfficiencyStatus = "beating" | "on_target" | "missing" | "unknown";

export const EFFICIENCY_MARGIN = 0.10; // binnen 10 procent van de target is op target
export const HEADROOM_LOST_IS = 0.10; // budget-lost IS vanaf 10 procent is echte groeiruimte
export const HIGH_UTILIZATION = 0.9; // budgetbenutting vanaf 90 procent tikt tegen het plafond
export const RANK_SATURATED = 0.2; // rank-lost IS vanaf 20 procent is rang-beperkt

export interface CampaignBudgetInput {
  campaignId: string;
  campaignName: string;
  cost?: number | null;
  conversions?: number | null;
  conversionsValue?: number | null;
  budgetLostIs?: number | null;
  rankLostIs?: number | null;
  budgetUtilization?: number | null;
}

export interface BudgetTarget {
  targetCpa?: number | null;
  targetRoas?: number | null;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Efficientie tegen de target. ROAS krijgt voorrang als er een ROAS-target en conversiewaarde
// is (hoger is beter); anders CPA (lager is beter). Zonder target of zonder basis: unknown.
export function efficiencyStatus(campaign: CampaignBudgetInput, target: BudgetTarget): EfficiencyStatus {
  const cost = num(campaign.cost);
  if (target.targetRoas != null && target.targetRoas > 0 && campaign.conversionsValue != null && cost > 0) {
    const roas = num(campaign.conversionsValue) / cost;
    if (roas >= target.targetRoas * (1 + EFFICIENCY_MARGIN)) return "beating";
    if (roas >= target.targetRoas * (1 - EFFICIENCY_MARGIN)) return "on_target";
    return "missing";
  }
  if (target.targetCpa != null && target.targetCpa > 0 && num(campaign.conversions) > 0) {
    const cpa = cost / num(campaign.conversions);
    if (cpa <= target.targetCpa * (1 - EFFICIENCY_MARGIN)) return "beating";
    if (cpa <= target.targetCpa * (1 + EFFICIENCY_MARGIN)) return "on_target";
    return "missing";
  }
  return "unknown";
}

export interface BudgetFact {
  campaignId: string;
  campaignName: string;
  efficiency: EfficiencyStatus;
  hasHeadroom: boolean;
  rankLimited: boolean;
  action: BudgetAction;
  cpa: number | null;
  roas: number | null;
  cost: number;
  budgetLostIs: number;
  rankLostIs: number;
  marginalScore: number; // hoger betekent een betere plek voor de volgende euro
  reason: string;
}

// De budgetbeslissing per campagne. scale_up alleen bij efficient plus groeiruimte plus
// niet rang-beperkt; scale_down bij het missen van de target; anders hold.
export function budgetActionFor(campaign: CampaignBudgetInput, target: BudgetTarget): BudgetFact {
  const cost = num(campaign.cost);
  const conversions = num(campaign.conversions);
  const budgetLostIs = num(campaign.budgetLostIs);
  const rankLostIs = num(campaign.rankLostIs);
  const efficiency = efficiencyStatus(campaign, target);
  const hasHeadroom = budgetLostIs >= HEADROOM_LOST_IS || num(campaign.budgetUtilization) >= HIGH_UTILIZATION;
  const rankLimited = rankLostIs >= RANK_SATURATED;

  let action: BudgetAction;
  let reason: string;
  if ((efficiency === "beating" || efficiency === "on_target") && hasHeadroom && !rankLimited) {
    action = "scale_up";
    reason = "efficient en budget-beperkt met groeiruimte";
  } else if (efficiency === "missing") {
    action = "scale_down";
    reason = "haalt de target niet, budget beter elders benut";
  } else if (rankLimited && (efficiency === "beating" || efficiency === "on_target")) {
    action = "hold";
    reason = "efficient maar rang-beperkt: eerst bod of kwaliteit, geen extra budget";
  } else {
    action = "hold";
    reason = efficiency === "unknown" ? "geen target of basis om efficientie te beoordelen" : "geen duidelijk budgetsignaal";
  }

  const cpa = conversions > 0 ? Math.round((cost / conversions) * 100) / 100 : null;
  const roas = campaign.conversionsValue != null && cost > 0 ? Math.round((num(campaign.conversionsValue) / cost) * 100) / 100 : null;

  // Marginale score voor de rangschikking van scale_up: hoe ver boven target maal de
  // groeiruimte. Alleen zinvol voor efficiente campagnes; anders 0.
  let marginalScore = 0;
  if (action === "scale_up") {
    let overTarget = 0;
    if (target.targetRoas != null && roas != null && target.targetRoas > 0) overTarget = (roas - target.targetRoas) / target.targetRoas;
    else if (target.targetCpa != null && cpa != null && target.targetCpa > 0) overTarget = (target.targetCpa - cpa) / target.targetCpa;
    marginalScore = Math.round(Math.max(0, overTarget) * budgetLostIs * 10000) / 10000;
  }

  return { campaignId: campaign.campaignId, campaignName: campaign.campaignName, efficiency, hasHeadroom, rankLimited, action, cpa, roas, cost, budgetLostIs, rankLostIs, marginalScore, reason };
}

export interface BudgetAllocationSummary {
  campaignsAnalysed: number;
  scaleUp: number;
  scaleDown: number;
  hold: number;
  hasTarget: boolean;
}

// De volledige analyse: per campagne de beslissing, plus het herallocatie-voorstel met de
// scale_up-kandidaten (gerangschikt op marginale score, beste plek voor de volgende euro)
// en de scale_down-kandidaten (gerangschikt op grootste inefficientie, eerste bron).
export function analyzeBudgetAllocation(campaigns: CampaignBudgetInput[], target: BudgetTarget): {
  campaigns: BudgetFact[];
  scaleUp: BudgetFact[];
  scaleDown: BudgetFact[];
  summary: BudgetAllocationSummary;
} {
  const facts = campaigns
    .filter((c) => c.campaignId)
    .map((c) => budgetActionFor(c, target));

  const scaleUp = facts.filter((f) => f.action === "scale_up").sort((a, b) => b.marginalScore - a.marginalScore);
  const scaleDown = facts
    .filter((f) => f.action === "scale_down")
    .sort((a, b) => b.cost - a.cost); // grootste verspilling eerst, gemeten aan spend op de misser

  const summary: BudgetAllocationSummary = {
    campaignsAnalysed: facts.length,
    scaleUp: scaleUp.length,
    scaleDown: scaleDown.length,
    hold: facts.filter((f) => f.action === "hold").length,
    hasTarget: target.targetCpa != null || target.targetRoas != null,
  };

  return { campaigns: facts, scaleUp, scaleDown, summary };
}
