// Meta signaal-detectors (categorie creative + kwaliteit). Levert de losse "signaalverhalen"
// bovenop de prepared-facts-aggregatie (lib/meta/prepared-facts.ts doet de winnaar/bleeder-
// en target-status-kant; deze module doet de diagnostische stories). Spiegelt het Google-
// signaal-frame in lib/signals/types.ts en meet UITSLUITEND op de eigen Meta-metrieken.
//
// Vier detectors:
//   - creative fatigue: hoge frequentie EN dalende CTR of stijgende CPA t.o.v. vorige periode.
//   - frequentie-verzadiging: frequentie boven de heuristische drempel (doelgroep te smal / op).
//   - ranking-zwakte: Meta's eigen quality/engagement/conversion-ranking staat BELOW_AVERAGE.
//   - hook/hold-zwakte: hook- of hold-rate ver onder de accountmediaan (relatief, geen verzonnen norm).

import { type DetectionResult, type SignalStory } from "./types";

export const FREQUENCY_FATIGUE = 3.0;       // vanaf hier is herhaling een fatigue-risico
export const FREQUENCY_SATURATION = 4.0;    // hierboven is de doelgroep aantoonbaar te vaak bereikt
export const PERF_DROP = 0.15;              // 15% CTR-daling telt als materieel
export const CPA_RISE = 0.15;               // 15% CPA-stijging telt als materieel
export const MIN_IMPRESSIONS = 1000;        // onder dit volume is elke ratio ruis
export const HOOK_HOLD_BENCH_FRAC = 0.6;    // onder 60% van de accountmediaan = zwak
export const MAX_STORIES = 3;

export interface MetaAdSignalInput {
  entityId: string;
  adName: string;
  campaignName?: string | null;
  impressions: number;
  frequency: number | null;
  hookRate: number | null;
  holdRate: number | null;
  linkCtr: number | null;
  cpa: number | null;
  roas: number | null;
  qualityRanking: string | null;
  engagementRanking: string | null;
  conversionRanking: string | null;
  prevLinkCtr?: number | null;
  prevCpa?: number | null;
}

export interface MetaLevelSignalInput {
  scope: string;          // "account" of een campagnenaam
  frequency: number | null;
  impressions: number;
}

function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function isBelowAverage(rank: string | null | undefined): boolean {
  return typeof rank === "string" && rank.trim().toUpperCase().startsWith("BELOW_AVERAGE");
}

function scopeLabel(a: MetaAdSignalInput): string {
  return a.campaignName ? `${a.campaignName} > ${a.adName}` : a.adName;
}

// ── 1. Creative fatigue ─────────────────────────────────────────────────────────────
export function detectMetaCreativeFatigue(ads: MetaAdSignalInput[]): DetectionResult {
  const checked = ["meta_creative_fatigue"];
  const scored = ads
    .filter((a) => a.impressions >= MIN_IMPRESSIONS && (a.frequency ?? 0) >= FREQUENCY_FATIGUE)
    .map((a) => {
      const ctrDrop =
        a.linkCtr != null && a.prevLinkCtr != null && a.prevLinkCtr > 0
          ? (a.prevLinkCtr - a.linkCtr) / a.prevLinkCtr
          : null;
      const cpaRise =
        a.cpa != null && a.prevCpa != null && a.prevCpa > 0 ? (a.cpa - a.prevCpa) / a.prevCpa : null;
      return { a, ctrDrop, cpaRise };
    })
    .filter((s) => (s.ctrDrop != null && s.ctrDrop >= PERF_DROP) || (s.cpaRise != null && s.cpaRise >= CPA_RISE))
    .sort((x, y) => (y.a.frequency ?? 0) - (x.a.frequency ?? 0))
    .slice(0, MAX_STORIES);

  const triggered: SignalStory[] = scored.map(({ a, ctrDrop, cpaRise }) => ({
    id: "meta_creative_fatigue",
    category: "creative" as const,
    scope: scopeLabel(a),
    story:
      `De advertentie "${a.adName}" wordt met een frequentie van ${(a.frequency ?? 0).toFixed(1)} vaak aan dezelfde mensen getoond, ` +
      (ctrDrop != null && ctrDrop >= PERF_DROP
        ? `en de link-CTR daalde ${Math.round(ctrDrop * 100)}% tegenover de vorige periode. `
        : "") +
      (cpaRise != null && cpaRise >= CPA_RISE
        ? `en de CPA steeg ${Math.round(cpaRise * 100)}%. `
        : "") +
      `Dat is het klassieke fatigue-patroon: dezelfde creative op een verzadigde doelgroep.`,
    actionDirection: "ververs de creative of verbreed de doelgroep; meer budget op dezelfde uiting versnelt alleen de uitputting",
    certainty: "bewezen_binnen_platform" as const,
    evidence: [
      { metric: "frequentie", value: Math.round((a.frequency ?? 0) * 100) / 100 },
      { metric: "link-CTR", value: a.linkCtr ?? 0, prev: a.prevLinkCtr ?? null },
      { metric: "CPA", value: a.cpa ?? 0, prev: a.prevCpa ?? null },
    ],
  }));

  return { triggered, checked };
}

// ── 2. Frequentie-verzadiging (account/campagne-niveau) ─────────────────────────────
export function detectMetaFrequencySaturation(levels: MetaLevelSignalInput[]): DetectionResult {
  const checked = ["meta_frequency_saturation"];
  const triggered: SignalStory[] = levels
    .filter((l) => l.impressions >= MIN_IMPRESSIONS && (l.frequency ?? 0) >= FREQUENCY_SATURATION)
    .sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0))
    .slice(0, MAX_STORIES)
    .map((l) => ({
      id: "meta_frequency_saturation",
      category: "creative" as const,
      scope: l.scope,
      story:
        `Op ${l.scope === "account" ? "accountniveau" : `"${l.scope}"`} ligt de frequentie op ${(l.frequency ?? 0).toFixed(1)}: ` +
        `de gemiddelde persoon ziet de advertenties zo vaak dat extra vertoningen weinig toevoegen.`,
      actionDirection: "verbreed de doelgroep of verhoog de creative-variatie; een smalle doelgroep raakt snel verzadigd",
      certainty: "indicatie" as const,
      evidence: [{ metric: "frequentie", value: Math.round((l.frequency ?? 0) * 100) / 100 }],
    }));
  return { triggered, checked };
}

// ── 3. Ranking-zwakte (Meta's eigen diagnose) ───────────────────────────────────────
export function detectMetaRankingWeakness(ads: MetaAdSignalInput[]): DetectionResult {
  const checked = ["meta_ranking_weakness"];
  const scored = ads
    .filter((a) => a.impressions >= MIN_IMPRESSIONS)
    .map((a) => {
      const weak: string[] = [];
      if (isBelowAverage(a.qualityRanking)) weak.push("kwaliteit");
      if (isBelowAverage(a.engagementRanking)) weak.push("betrokkenheid");
      if (isBelowAverage(a.conversionRanking)) weak.push("conversie");
      return { a, weak };
    })
    .filter((s) => s.weak.length > 0)
    .sort((x, y) => y.weak.length - x.weak.length || y.a.impressions - x.a.impressions)
    .slice(0, MAX_STORIES);

  const triggered: SignalStory[] = scored.map(({ a, weak }) => ({
    id: "meta_ranking_weakness",
    category: "kwaliteit" as const,
    scope: scopeLabel(a),
    story:
      `Meta beoordeelt de advertentie "${a.adName}" als benedengemiddeld op ${weak.join(", ")} ` +
      `(ranking${weak.length > 1 ? "s" : ""} below average). Dat drukt de vertoning en verhoogt de kosten tegenover concurrenten in dezelfde veiling.`,
    actionDirection: "verbeter de zwakke as: creative/relevantie bij kwaliteit, hook/interactie bij betrokkenheid, landingspagina/aanbod bij conversie",
    certainty: "bewezen_binnen_platform" as const,
    evidence: [
      { metric: "quality_ranking", value: a.qualityRanking ?? "onbekend" },
      { metric: "engagement_ranking", value: a.engagementRanking ?? "onbekend" },
      { metric: "conversion_ranking", value: a.conversionRanking ?? "onbekend" },
    ],
  }));

  return { triggered, checked };
}

// ── 4. Hook/hold-zwakte (relatief aan de accountmediaan) ────────────────────────────
export function detectMetaHookHoldWeakness(ads: MetaAdSignalInput[]): DetectionResult {
  const checked = ["meta_hook_hold_weakness"];
  const eligible = ads.filter((a) => a.impressions >= MIN_IMPRESSIONS);
  const medHook = median(eligible.map((a) => a.hookRate).filter((v): v is number => v != null));
  const medHold = median(eligible.map((a) => a.holdRate).filter((v): v is number => v != null));
  if (medHook == null && medHold == null) return { triggered: [], checked };

  const scored = eligible
    .map((a) => {
      const weakHook = a.hookRate != null && medHook != null && medHook > 0 && a.hookRate < medHook * HOOK_HOLD_BENCH_FRAC;
      const weakHold = a.holdRate != null && medHold != null && medHold > 0 && a.holdRate < medHold * HOOK_HOLD_BENCH_FRAC;
      return { a, weakHook, weakHold };
    })
    .filter((s) => s.weakHook || s.weakHold)
    .sort((x, y) => y.a.impressions - x.a.impressions) // grootste bereik (dus grootste impact) eerst
    .slice(0, MAX_STORIES);

  const triggered: SignalStory[] = scored.map(({ a, weakHook, weakHold }) => ({
    id: "meta_hook_hold_weakness",
    category: "creative" as const,
    scope: scopeLabel(a),
    story:
      `De video-advertentie "${a.adName}" ` +
      (weakHook ? "grijpt in de eerste seconden slecht (hook-rate ver onder de accountmediaan)" : "") +
      (weakHook && weakHold ? " en " : "") +
      (weakHold ? "houdt kijkers slecht vast (hold-rate ver onder de accountmediaan)" : "") +
      `. De boodschap komt zo bij weinig mensen echt binnen.`,
    actionDirection: weakHook
      ? "herzie de eerste 3 seconden (opening/thumbnail); daar valt het publiek af"
      : "kort de video in of versterk het midden; kijkers haken halverwege af",
    certainty: "bewezen_binnen_platform" as const,
    evidence: [
      { metric: "hook_rate", value: a.hookRate ?? 0 },
      { metric: "hold_rate", value: a.holdRate ?? 0 },
      { metric: "accountmediaan hook", value: medHook ?? 0 },
    ],
  }));

  return { triggered, checked };
}

// ── Aggregator ──────────────────────────────────────────────────────────────────────
export function buildMetaCreativeSignals(input: { ads: MetaAdSignalInput[]; levels: MetaLevelSignalInput[] }): DetectionResult {
  const results = [
    detectMetaCreativeFatigue(input.ads),
    detectMetaFrequencySaturation(input.levels),
    detectMetaRankingWeakness(input.ads),
    detectMetaHookHoldWeakness(input.ads),
  ];
  return {
    triggered: results.flatMap((r) => r.triggered),
    checked: [...new Set(results.flatMap((r) => r.checked))],
  };
}
