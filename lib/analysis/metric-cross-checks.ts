// Metric-cross-checks: de deterministische diagnoses die TUSSEN metrics liggen. De stappen
// zien alle data, maar het verband tussen twee metrics moest het model zelf leggen; deze
// module dwingt de vier scherpste verbanden af (zie METRIC_diagnose_matrix.md). Hergebruikt
// de G1- en hefboom-2-drempels zodat de taal consistent blijft. IO-vrij en los getest; de
// datalaag voedt dit vanuit ads_campaign_impression_share plus ads_keyword_performance_monthly.

import { NEGLIGIBLE_LOST_IS } from "./impression-share-facts";
import { HIGH_UTILIZATION } from "./budget-allocation-facts";

// ── Check 1: rank-verlies-oorzaak (quality score maal rank_lost_is) ──

export const QS_LOW = 5; // spend-gewogen QS hieronder is kwaliteitsprobleem-territorium
export const QS_HEALTHY = 7; // vanaf hier is de kwaliteit gezond en wijst rank-verlies naar het bod

export interface KeywordQsRow {
  cost: number;
  quality_score: number | null; // null als Google geen QS rapporteert
}

// De spend-gewogen quality score over de keywords van een campagne. Keywords zonder QS
// tellen niet mee; is er geen enkel keyword met QS, dan null (geen gok).
export function spendWeightedQualityScore(keywords: KeywordQsRow[]): number | null {
  let weighted = 0;
  let spend = 0;
  for (const k of keywords) {
    if (k.quality_score == null || k.quality_score <= 0 || k.cost <= 0) continue;
    weighted += k.quality_score * k.cost;
    spend += k.cost;
  }
  if (spend <= 0) return null;
  return Math.round((weighted / spend) * 10) / 10;
}

export type RankLossCause = "kwaliteitsprobleem" | "bodprobleem" | "gemengd" | "geen_materieel_rankverlies" | "geen_qs_data";

export interface RankLossDiagnosis {
  cause: RankLossCause;
  rankLostIs: number;
  spendWeightedQs: number | null;
  detail: string;
}

// Splitst rank-verlies in de twee fundamenteel verschillende oorzaken. G1 zegt DAT rank
// verliest; dit zegt WAAROM: een lage QS betekent dat de kwaliteit (advertentie of
// landingspagina) de positie drukt, een gezonde QS betekent dat het bod te laag is. De fix
// verschilt volledig, dus de diagnose moet vooraf.
export function classifyRankLossCause(rankLostIs: number, spendWeightedQs: number | null): RankLossDiagnosis {
  if (rankLostIs <= NEGLIGIBLE_LOST_IS) {
    return { cause: "geen_materieel_rankverlies", rankLostIs, spendWeightedQs, detail: "het rank-verlies is verwaarloosbaar; geen diagnose nodig" };
  }
  if (spendWeightedQs == null) {
    return { cause: "geen_qs_data", rankLostIs, spendWeightedQs, detail: "materieel rank-verlies maar geen quality-score-data; de oorzaak (kwaliteit of bod) is niet vast te stellen" };
  }
  if (spendWeightedQs < QS_LOW) {
    return { cause: "kwaliteitsprobleem", rankLostIs, spendWeightedQs, detail: `rank-verlies met een spend-gewogen QS van ${spendWeightedQs}: de kwaliteit (advertentierelevantie of landingspagina) drukt de positie; meer bieden koopt dit niet weg` };
  }
  if (spendWeightedQs >= QS_HEALTHY) {
    return { cause: "bodprobleem", rankLostIs, spendWeightedQs, detail: `rank-verlies met een gezonde spend-gewogen QS van ${spendWeightedQs}: de kwaliteit is op orde, het bod is te laag voor de positie` };
  }
  return { cause: "gemengd", rankLostIs, spendWeightedQs, detail: `rank-verlies met een spend-gewogen QS van ${spendWeightedQs} in het middengebied: kwaliteit en bod spelen beide mee` };
}

// ── Check 2: vraag-versus-aandeel-decompositie ──

export type DemandShareVerdict = "markt_kromp" | "markt_groeide" | "aandeel_verloren" | "aandeel_gewonnen" | "gemengd" | "stabiel" | "niet_bepaalbaar";

export const DOMINANT_EFFECT = 0.6; // een effect dat 60 procent van de verandering draagt is dominant
export const STABLE_DELTA_PCT = 0.05; // impressie-verandering onder 5 procent is stabiel

export interface DemandShareDecomposition {
  verdict: DemandShareVerdict;
  impressionsDeltaPct: number | null;
  marketEffect: number; // impressie-verandering toe te schrijven aan de markt (eligible)
  shareEffect: number; // impressie-verandering toe te schrijven aan het eigen aandeel
  detail: string;
}

// Impressies zijn markt maal aandeel: eligible = impressions / IS. Een impressie-verandering
// splitst in een markt-effect (de vraag veranderde) en een aandeel-effect (wij wonnen of
// verloren). Zonder deze splitsing krijgt een krimpende markt onterecht een
// optimalisatie-advies. Standaard-decompositie: delta = deltaMarkt maal IS_vorig plus
// Markt_nu maal deltaIS.
export function decomposeDemandVsShare(input: {
  impressions: number;
  impressionShare: number; // 0 tot 1
  prevImpressions: number;
  prevImpressionShare: number; // 0 tot 1
}): DemandShareDecomposition {
  const { impressions, impressionShare, prevImpressions, prevImpressionShare } = input;
  if (impressionShare <= 0 || prevImpressionShare <= 0 || prevImpressions <= 0) {
    return { verdict: "niet_bepaalbaar", impressionsDeltaPct: null, marketEffect: 0, shareEffect: 0, detail: "geen geldige impression share of vorige periode; de decompositie kan niet" };
  }

  const eligible = impressions / impressionShare;
  const prevEligible = prevImpressions / prevImpressionShare;
  const delta = impressions - prevImpressions;
  const impressionsDeltaPct = Math.round((delta / prevImpressions) * 1000) / 1000;

  const marketEffect = Math.round((eligible - prevEligible) * prevImpressionShare);
  const shareEffect = Math.round(eligible * (impressionShare - prevImpressionShare));

  if (Math.abs(impressionsDeltaPct) < STABLE_DELTA_PCT) {
    return { verdict: "stabiel", impressionsDeltaPct, marketEffect, shareEffect, detail: "de impressies zijn stabiel; geen decompositie-oordeel nodig" };
  }

  const totalAbs = Math.abs(marketEffect) + Math.abs(shareEffect);
  const marketDominant = totalAbs > 0 && Math.abs(marketEffect) / totalAbs >= DOMINANT_EFFECT;
  const shareDominant = totalAbs > 0 && Math.abs(shareEffect) / totalAbs >= DOMINANT_EFFECT;

  if (marketDominant) {
    const verdict: DemandShareVerdict = marketEffect < 0 ? "markt_kromp" : "markt_groeide";
    return { verdict, impressionsDeltaPct, marketEffect, shareEffect, detail: verdict === "markt_kromp" ? "de zoekvraag zelf kromp; dit is geen prestatieprobleem maar een marktbeweging, stel verwachtingen bij in plaats van te optimaliseren" : "de zoekvraag zelf groeide; de impressie-groei is vooral markt, niet eigen verdienste" };
  }
  if (shareDominant) {
    const verdict: DemandShareVerdict = shareEffect < 0 ? "aandeel_verloren" : "aandeel_gewonnen";
    return { verdict, impressionsDeltaPct, marketEffect, shareEffect, detail: verdict === "aandeel_verloren" ? "de markt bleef maar wij verloren aandeel; dit is wel een prestatieprobleem en vraagt ingrijpen" : "wij wonnen aandeel in een gelijke markt" };
  }
  return { verdict: "gemengd", impressionsDeltaPct, marketEffect, shareEffect, detail: "markt en aandeel bewogen beide materieel; beoordeel ze los" };
}

// ── Check 3: CPC-drukrichting (CPC-delta maal IS-delta) ──

export type CpcPressure = "veiling_verhit" | "positie_gekocht" | "efficienter_ingekocht" | "ontspannen_veiling" | "stabiel" | "niet_bepaalbaar";

export const PRESSURE_DELTA = 0.05; // een beweging vanaf 5 procent telt als richting

export interface CpcPressureDiagnosis {
  pressure: CpcPressure;
  cpcDeltaPct: number | null;
  isDeltaPct: number | null;
  detail: string;
}

// CPC stijgt en IS daalt: de veiling verhit (concurrentie, externe druk). CPC stijgt en IS
// stijgt: we kopen positie (eigen keuze, beoordeel of dat rendeert). Twee tegengestelde
// verhalen achter dezelfde CPC-stijging.
export function classifyCpcPressure(input: { cpc: number; prevCpc: number; impressionShare: number; prevImpressionShare: number }): CpcPressureDiagnosis {
  const { cpc, prevCpc, impressionShare, prevImpressionShare } = input;
  if (prevCpc <= 0 || prevImpressionShare <= 0) {
    return { pressure: "niet_bepaalbaar", cpcDeltaPct: null, isDeltaPct: null, detail: "geen geldige vorige periode" };
  }
  const cpcDeltaPct = Math.round(((cpc - prevCpc) / prevCpc) * 1000) / 1000;
  const isDeltaPct = Math.round(((impressionShare - prevImpressionShare) / prevImpressionShare) * 1000) / 1000;

  const cpcUp = cpcDeltaPct >= PRESSURE_DELTA;
  const cpcDown = cpcDeltaPct <= -PRESSURE_DELTA;
  const isUp = isDeltaPct >= PRESSURE_DELTA;
  const isDown = isDeltaPct <= -PRESSURE_DELTA;

  if (cpcUp && isDown) return { pressure: "veiling_verhit", cpcDeltaPct, isDeltaPct, detail: "de CPC stijgt terwijl het aandeel daalt: de veiling verhit door externe druk; meer betalen levert minder op" };
  if (cpcUp && isUp) return { pressure: "positie_gekocht", cpcDeltaPct, isDeltaPct, detail: "de CPC stijgt en het aandeel stijgt mee: er wordt positie gekocht; beoordeel of de extra kosten renderen" };
  if (cpcDown && isUp) return { pressure: "efficienter_ingekocht", cpcDeltaPct, isDeltaPct, detail: "meer aandeel tegen een lagere CPC: efficienter ingekocht" };
  if (cpcDown && isDown) return { pressure: "ontspannen_veiling", cpcDeltaPct, isDeltaPct, detail: "CPC en aandeel dalen beide: de inzet of de veiling ontspant; check of dit een bewuste keuze is" };
  return { pressure: "stabiel", cpcDeltaPct, isDeltaPct, detail: "geen materiele beweging in CPC of aandeel" };
}

// ── Check 4: budget-lost-consistentie (budget_lost_is maal budget_utilization) ──

export type BudgetLostVerdict = "echt_budget_tekort" | "pacing_probleem" | "geen_budget_verlies";

export interface BudgetLostDiagnosis {
  verdict: BudgetLostVerdict;
  budgetLostIs: number;
  budgetUtilization: number | null;
  detail: string;
}

// Verlies door budget terwijl de benutting onder het plafond ligt is geen budget-tekort maar
// een pacing- of instellingsprobleem; een verhoog-advies zou daar onterecht zijn. Verfijnt
// hefboom 2 met dezelfde HIGH_UTILIZATION-drempel.
export function classifyBudgetLost(budgetLostIs: number, budgetUtilization: number | null): BudgetLostDiagnosis {
  if (budgetLostIs <= NEGLIGIBLE_LOST_IS) {
    return { verdict: "geen_budget_verlies", budgetLostIs, budgetUtilization, detail: "geen materieel verlies door budget" };
  }
  if (budgetUtilization != null && budgetUtilization < HIGH_UTILIZATION) {
    return { verdict: "pacing_probleem", budgetLostIs, budgetUtilization, detail: `verlies door budget terwijl de benutting op ${Math.round(budgetUtilization * 100)} procent ligt: het budget raakt niet op, dus dit is een pacing- of instellingsprobleem; verhogen lost dit niet op` };
  }
  return { verdict: "echt_budget_tekort", budgetLostIs, budgetUtilization, detail: "verlies door budget met een benutting tegen het plafond: het budget is echt de rem" };
}
