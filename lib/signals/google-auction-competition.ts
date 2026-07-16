// Categorie A: Google veiling- en concurrentie-verhalen (SIGNAALVERHALEN_bibliotheek.md).
// Multi-metric verhalen die samen een diagnose dragen die geen enkele metric alleen vertelt.
// Puur en los getest; de datalaag voedt dit uit ads_campaign_impression_share,
// ads_keyword_performance_monthly (spend-gewogen QS), ads_change_history en
// ads_pmax_search_categories plus ads_search_terms_monthly.

import { type DetectionResult, type SignalStory, relDelta, pct } from "./types";

// De drempels, expliciet en op een plek.
export const IS_DROP_MATERIAL = 0.05; // vijf procentpunt IS-daling is materieel
export const CPC_RISE_MATERIAL = 0.05; // vijf procent relatieve CPC-stijging
export const QS_STABLE_BAND = 0.5; // een QS-beweging binnen een half punt is stabiel
export const IMPRESSIONS_STABLE_FLOOR = -0.05; // impressies boven min vijf procent tellen als de vraag is er
export const KANNIBALISATIE_OVERLAP = 0.3; // vanaf dertig procent token-overlap raken PMax en search elkaar
export const KANNIBALISATIE_SHIFT = 0.1; // tien procent verschuiving in impressies

// Een eigen wijziging die de veiling-metrics kan verklaren: budget of bod/target.
export const OWN_CHANGE_RESOURCE_TYPES = ["CAMPAIGN_BUDGET", "TARGET_SPEND", "TARGET_ROAS", "TARGET_CPA"];

export interface OwnChangeEvent {
  resource_type: string;
  campaign_name: string | null;
}

export interface AuctionCampaignInput {
  campaignName: string;
  isBranded: boolean;
  impressionShare: number; // 0 tot 1
  prevImpressionShare: number;
  rankLostIs: number;
  prevRankLostIs: number;
  cpc: number;
  prevCpc: number;
  impressions: number;
  prevImpressions: number;
  spendWeightedQs: number | null;
  prevSpendWeightedQs: number | null;
  ownChanges: OwnChangeEvent[]; // de bod- en budgetwijzigingen van deze campagne in de periode
}

// Verhaal A1: concurrentiedruk-toename. Vijf metrics samen: het aandeel daalt, het verlies
// door rang stijgt, de klikprijs stijgt, de eigen kwaliteit bleef stabiel, en er was geen
// eigen bod- of budgetwijziging. Dan duwt een ander. Met een eigen wijziging in de periode
// degradeert het verhaal naar een indicatie, want eigen handelen is dan niet uit te sluiten.
export function detectConcurrentiedruk(c: AuctionCampaignInput): DetectionResult {
  const checked = ["concurrentiedruk_toename"];
  const isDrop = c.prevImpressionShare - c.impressionShare;
  const rankLostRise = c.rankLostIs - c.prevRankLostIs;
  const cpcDelta = relDelta(c.cpc, c.prevCpc);
  const qsStable =
    c.spendWeightedQs != null && c.prevSpendWeightedQs != null && Math.abs(c.spendWeightedQs - c.prevSpendWeightedQs) <= QS_STABLE_BAND;
  const relevantOwnChanges = c.ownChanges.filter((e) => OWN_CHANGE_RESOURCE_TYPES.includes(e.resource_type));

  const coreTrigger = isDrop >= IS_DROP_MATERIAL && rankLostRise > 0 && cpcDelta != null && cpcDelta >= CPC_RISE_MATERIAL && qsStable;
  if (!coreTrigger) return { triggered: [], checked };

  const evidence = [
    { metric: "impression_share", value: c.impressionShare, prev: c.prevImpressionShare },
    { metric: "rank_lost_is", value: c.rankLostIs, prev: c.prevRankLostIs },
    { metric: "cpc", value: c.cpc, prev: c.prevCpc },
    { metric: "spend_weighted_qs", value: c.spendWeightedQs ?? "geen", prev: c.prevSpendWeightedQs ?? "geen" },
    { metric: "eigen_bod_of_budgetwijzigingen", value: relevantOwnChanges.length },
  ];

  if (relevantOwnChanges.length === 0) {
    return {
      triggered: [
        {
          id: "concurrentiedruk_toename",
          category: "veiling_concurrentie",
          scope: c.campaignName,
          story: `Het aandeel daalde ${pct(isDrop)} door rang terwijl de CPC ${pct(cpcDelta)} steeg, de kwaliteit stabiel bleef en er geen eigen bod- of budgetwijziging was: een concurrent verhoogt de druk in de veiling.`,
          actionDirection: "beoordeel of de positie het waard is om te verdedigen (bod of kwaliteit) of dat je de duurdere veiling bewust laat lopen",
          certainty: "bewezen_binnen_platform",
          evidence,
        },
      ],
      checked,
    };
  }

  return {
    triggered: [
      {
        id: "concurrentiedruk_toename",
        category: "veiling_concurrentie",
        scope: c.campaignName,
        story: `De veiling-metrics wijzen op oplopende druk (aandeel min ${pct(isDrop)}, CPC plus ${pct(cpcDelta)}, kwaliteit stabiel), maar er waren ${relevantOwnChanges.length} eigen bod- of budgetwijzigingen in de periode; eigen handelen is niet uit te sluiten.`,
        actionDirection: "controleer eerst de eigen wijzigingen (change history) voordat dit als concurrentiedruk wordt behandeld",
        certainty: "indicatie",
        evidence,
      },
    ],
    checked,
  };
}

// Verhaal A2: brand onder vuur. Het merk-aandeel daalt en de merk-CPC stijgt terwijl de
// impressies tonen dat de vraag er wel is: iemand biedt op het merk. Alleen zinvol op een
// campagne die als branded gemarkeerd is.
export function detectBrandOnderVuur(c: AuctionCampaignInput): DetectionResult {
  const checked = ["brand_onder_vuur"];
  if (!c.isBranded) return { triggered: [], checked };

  const isDrop = c.prevImpressionShare - c.impressionShare;
  const cpcDelta = relDelta(c.cpc, c.prevCpc);
  const imprDelta = relDelta(c.impressions, c.prevImpressions);
  const demandPresent = imprDelta != null && imprDelta >= IMPRESSIONS_STABLE_FLOOR;

  if (isDrop >= IS_DROP_MATERIAL && cpcDelta != null && cpcDelta >= CPC_RISE_MATERIAL && demandPresent) {
    return {
      triggered: [
        {
          id: "brand_onder_vuur",
          category: "veiling_concurrentie",
          scope: c.campaignName,
          story: `Op de merk-campagne daalde het aandeel ${pct(isDrop)} en steeg de CPC ${pct(cpcDelta)} terwijl de merkvraag er is: iemand biedt op het merk.`,
          actionDirection: "verdedig de merkpositie (het is de goedkoopste klik die er is) en identificeer de bieder waar mogelijk",
          certainty: "bewezen_binnen_platform",
          evidence: [
            { metric: "impression_share", value: c.impressionShare, prev: c.prevImpressionShare },
            { metric: "cpc", value: c.cpc, prev: c.prevCpc },
            { metric: "impressions", value: c.impressions, prev: c.prevImpressions },
          ],
        },
      ],
      checked,
    };
  }
  return { triggered: [], checked };
}

// De token-overlap-helper voor A3: het aandeel van de PMax-categorie-tokens dat ook in de
// eigen zoektermen voorkomt. Genormaliseerd, tokens van vier tekens of langer.
export function tokenOverlapRatio(pmaxLabels: string[], searchTerms: string[]): number {
  const tokenize = (list: string[]) =>
    new Set(
      list
        .flatMap((s) => s.toLowerCase().split(/[^a-z0-9]+/))
        .filter((t) => t.length >= 4)
    );
  const labelTokens = tokenize(pmaxLabels);
  if (labelTokens.size === 0) return 0;
  const termTokens = tokenize(searchTerms);
  let hits = 0;
  for (const t of labelTokens) if (termTokens.has(t)) hits += 1;
  return Math.round((hits / labelTokens.size) * 1000) / 1000;
}

export interface KannibalisatieInput {
  searchCampaignName: string;
  pmaxCampaignName: string;
  pmaxCategoryLabels: string[];
  searchTerms: string[];
  searchImpressions: number;
  prevSearchImpressions: number;
  pmaxImpressions: number;
  prevPmaxImpressions: number;
}

// Verhaal A3: PMax-kannibalisatie. De PMax-zoekcategorieen overlappen met de eigen
// zoektermen, de search-campagne verliest impressies en PMax wint ze: PMax eet de eigen
// campagne in plaats van nieuwe vraag. Een indicatie, want Google toont de exacte
// verdringing niet; de overlap plus de tegengestelde beweging maken het verhaal.
export function detectPmaxKannibalisatie(input: KannibalisatieInput): DetectionResult {
  const checked = ["pmax_kannibalisatie"];
  const overlap = tokenOverlapRatio(input.pmaxCategoryLabels, input.searchTerms);
  const searchDelta = relDelta(input.searchImpressions, input.prevSearchImpressions);
  const pmaxDelta = relDelta(input.pmaxImpressions, input.prevPmaxImpressions);

  if (
    overlap >= KANNIBALISATIE_OVERLAP &&
    searchDelta != null &&
    searchDelta <= -KANNIBALISATIE_SHIFT &&
    pmaxDelta != null &&
    pmaxDelta >= KANNIBALISATIE_SHIFT
  ) {
    return {
      triggered: [
        {
          id: "pmax_kannibalisatie",
          category: "veiling_concurrentie",
          scope: `${input.searchCampaignName} versus ${input.pmaxCampaignName}`,
          story: `De PMax-zoekcategorieen overlappen ${pct(overlap)} met de eigen zoektermen, de search-campagne verloor ${pct(Math.abs(searchDelta))} impressies en PMax won ${pct(pmaxDelta)}: PMax eet de eigen campagne in plaats van nieuwe vraag.`,
          actionDirection: "voeg de merk- en kerntermen als uitsluiting toe aan PMax of accepteer de verschuiving bewust; vergelijk de CPA van beide paden",
          certainty: "indicatie",
          evidence: [
            { metric: "token_overlap", value: overlap },
            { metric: "search_impressions", value: input.searchImpressions, prev: input.prevSearchImpressions },
            { metric: "pmax_impressions", value: input.pmaxImpressions, prev: input.prevPmaxImpressions },
          ],
        },
      ],
      checked,
    };
  }
  return { triggered: [], checked };
}
