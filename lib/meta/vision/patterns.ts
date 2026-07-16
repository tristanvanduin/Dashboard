// M3 pattern-aggregatie (5d): het deterministische hart. Join features met performance en
// bewijs elk patroon met n, impressies en evidence_level; geen enkele creative-claim zonder
// bewijs. IO-vrij en los getest; de datalaag (de join met meta_ad_daily) is build-kant.

export type PatternMetric = "link_ctr" | "hook_rate" | "hold_rate" | "cvr" | "cpa" | "roas";
export type EvidenceLevel = "deterministic" | "inferred";

// De spec-drempels, letterlijk en op een plek.
export const MIN_PATTERN_ADS = 3; // "een patroon telt vanaf 3 ads"
export const MIN_AD_IMPRESSIONS_FOR_CTR = 5000; // "CTR- en hook-claims per ad vanaf 5.000 impressies"
export const MIN_PATTERN_CONVERSIONS = 30; // "CVR/CPA/ROAS-claims per patroon vanaf 30 conversies"

const IMPRESSION_GATED_METRICS: PatternMetric[] = ["link_ctr", "hook_rate", "hold_rate"];
const CONVERSION_GATED_METRICS: PatternMetric[] = ["cvr", "cpa", "roas"];

export interface AdMetricInput {
  adId: string;
  impressions: number;
  conversions: number;
  metricValue: number; // de waarde van deze ene ad op de gevraagde metric
}

export interface PatternAggregate {
  attribute: string;
  value: string;
  metric: PatternMetric;
  nAds: number;
  impressions: number;
  conversions: number;
  patternValue: number; // impressie- of conversie-gewogen, afhankelijk van de metric
  accountAvg: number;
  liftPct: number; // (patternValue - accountAvg) / accountAvg
  evidenceLevel: EvidenceLevel;
}

function weightedAverage(ads: AdMetricInput[], weightKey: "impressions" | "conversions"): number {
  const totalWeight = ads.reduce((s, a) => s + a[weightKey], 0);
  if (totalWeight <= 0) return 0;
  return ads.reduce((s, a) => s + a.metricValue * a[weightKey], 0) / totalWeight;
}

// Aggregeert een patroon (attribuut plus waarde plus metric) uit de bijdragende ads. Geeft
// null als het niet eens de ad-drempel haalt: zo'n patroon wordt NIET opgeslagen, conform
// de spec-no-go "geen patroon rapporteren zonder n, impressies en evidence_level".
export function aggregatePattern(input: {
  attribute: string;
  value: string;
  metric: PatternMetric;
  ads: AdMetricInput[];
  accountAvg: number;
}): PatternAggregate | null {
  const { attribute, value, metric, ads, accountAvg } = input;

  if (ads.length < MIN_PATTERN_ADS) return null;

  const impressions = ads.reduce((s, a) => s + a.impressions, 0);
  const conversions = ads.reduce((s, a) => s + a.conversions, 0);

  const isImpressionMetric = IMPRESSION_GATED_METRICS.includes(metric);
  const patternValue = isImpressionMetric ? weightedAverage(ads, "impressions") : weightedAverage(ads, "conversions") || ads.reduce((s, a) => s + a.metricValue, 0) / ads.length;

  const liftPct = accountAvg !== 0 ? Math.round(((patternValue - accountAvg) / accountAvg) * 1000) / 1000 : 0;

  let fullThresholdMet: boolean;
  if (isImpressionMetric) {
    fullThresholdMet = ads.every((a) => a.impressions >= MIN_AD_IMPRESSIONS_FOR_CTR);
  } else if (CONVERSION_GATED_METRICS.includes(metric)) {
    fullThresholdMet = conversions >= MIN_PATTERN_CONVERSIONS;
  } else {
    fullThresholdMet = false;
  }

  return {
    attribute,
    value,
    metric,
    nAds: ads.length,
    impressions,
    conversions,
    patternValue: Math.round(patternValue * 10000) / 10000,
    accountAvg,
    liftPct,
    evidenceLevel: fullThresholdMet ? "deterministic" : "inferred",
  };
}

export interface ContrastPair {
  attribute: string;
  metric: PatternMetric;
  higher: PatternAggregate;
  lower: PatternAggregate;
  deltaLiftPct: number; // het verschil tussen de twee lift-percentages
}

// De tegenhanger-paren voor hetzelfde attribuut en dezelfde metric, zodat de briefing
// contrast kan tonen ("met gezicht +38% hook rate versus zonder gezicht"). Alleen paren
// waarvan beide kanten evidence_level deterministic zijn, tellen als hard contrast.
export function buildContrastPairs(patterns: PatternAggregate[]): ContrastPair[] {
  const byAttributeMetric = new Map<string, PatternAggregate[]>();
  for (const p of patterns) {
    const key = `${p.attribute}|||${p.metric}`;
    if (!byAttributeMetric.has(key)) byAttributeMetric.set(key, []);
    byAttributeMetric.get(key)!.push(p);
  }

  const pairs: ContrastPair[] = [];
  for (const group of byAttributeMetric.values()) {
    const deterministic = group.filter((p) => p.evidenceLevel === "deterministic");
    if (deterministic.length < 2) continue;
    const sorted = [...deterministic].sort((a, b) => b.liftPct - a.liftPct);
    // Het sterkste en het zwakste van dezelfde dimensie vormen het scherpste contrast.
    const higher = sorted[0];
    const lower = sorted[sorted.length - 1];
    pairs.push({
      attribute: higher.attribute,
      metric: higher.metric,
      higher,
      lower,
      deltaLiftPct: Math.round((higher.liftPct - lower.liftPct) * 1000) / 1000,
    });
  }
  return pairs;
}

export interface FatigueInput {
  adId: string;
  isWinner: boolean; // draagt een van de geselecteerde winnende patronen
  fatigueStatus: "gezond" | "vermoeid" | "onbekend";
  ctrDeltaPct?: number | null;
  frequency?: number | null;
}

export interface ReplacementCandidate {
  adId: string;
  reason: string;
}

// Koppelt de fatigue-status (uit M2 stap 4) aan de winnende ads: een winnaar die ook
// vermoeid is, is een vervangingskandidaat. Puur, want de fatigue-status zelf is al elders
// berekend en komt hier alleen binnen als data.
export function flagFatiguedWinners(ads: FatigueInput[]): ReplacementCandidate[] {
  return ads
    .filter((a) => a.isWinner && a.fatigueStatus === "vermoeid")
    .map((a) => {
      const parts: string[] = [];
      if (a.ctrDeltaPct != null) parts.push(`CTR ${Math.round(a.ctrDeltaPct * 100)}%`);
      if (a.frequency != null) parts.push(`frequency ${a.frequency}`);
      return { adId: a.adId, reason: parts.length ? `winnaar maar vermoeid (${parts.join(", ")})` : "winnaar maar vermoeid" };
    });
}
