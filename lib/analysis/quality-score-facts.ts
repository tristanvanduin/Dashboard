// G2: quality-score-facts, de deterministische voorcompute voor de losse QS-analyse (spec
// SPEC_G1_G2). Kosten-gewogen, niet aantal-gewogen: een dure lage-QS-term weegt zwaarder dan
// tien goedkope. Hergebruikt de QS-drempels en de spend-gewogen berekening uit
// metric-cross-checks (geen kopie). De drie QS-componenten worden NIET gesynct; die beperking
// zit als vaste note in het facts-object zodat de prompt het verbod op component-claims kan
// afdwingen. IO-vrij en los getest; de route voedt dit uit ads_keyword_performance_monthly.

import { spendWeightedQualityScore, QS_LOW, QS_HEALTHY } from "./metric-cross-checks";

// Een QS-beweging binnen een half punt is ruis (spiegelt de stabiel-band uit de
// signaal-detectie); vanaf een half punt daling maand-op-maand spreken we van erosie.
export const QS_EROSION_DELTA = 0.5;
// Vanaf dit aandeel van de QS-gedekte spend in de lage bucket is er een structureel
// duur-inkopen-probleem.
export const LOW_QS_SPEND_ALERT = 0.2;
// Onder deze dekking (aandeel spend met een gerapporteerde QS) is elk QS-oordeel zwak.
export const MIN_QS_COVERAGE = 0.3;
export const PRIORITY_LIST_SIZE = 12;

export interface KeywordQsPerformanceRow {
  month: string; // "YYYY-MM" of "YYYY-MM-DD"
  campaign_name: string;
  ad_group_name: string | null;
  keyword_text: string;
  match_type: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  quality_score: number | null;
}

export interface QsBucketFact {
  bucket: "laag" | "midden" | "gezond";
  range: string;
  spend: number;
  sharePct: number; // aandeel van de QS-gedekte spend
  avgCtrPct: number | null; // clicks/impressions binnen de bucket
  avgCpc: number | null; // cost/clicks binnen de bucket
}

export interface QsCampaignFact {
  campaignName: string;
  spendWeightedQs: number | null;
  totalSpend: number;
  lowBucketSpend: number;
}

export interface QsPriorityKeyword {
  keywordText: string;
  campaignName: string;
  adGroupName: string | null;
  matchType: string | null;
  cost: number;
  clicks: number;
  conversions: number;
  qualityScore: number;
  converting: boolean; // een converterend laag-QS-woord is duur maar werkt: andere actie
}

export interface QsTrendPoint {
  month: string;
  spendWeightedQs: number | null;
  lowSpendSharePct: number | null;
}

export interface QsFlag {
  kind: "dure_lage_qs" | "qs_erosie" | "lage_dekking";
  detail: string;
}

export interface QualityScoreFacts {
  analysisMonth: string | null;
  coveragePct: number; // aandeel van de spend in de analysemaand met een gerapporteerde QS
  accountSpendWeightedQs: number | null;
  previousMonthQs: number | null;
  deltaMoM: number | null;
  buckets: QsBucketFact[];
  campaigns: QsCampaignFact[]; // gesorteerd op spend in de lage bucket
  priorityKeywords: QsPriorityKeyword[]; // hoge kosten maal lage QS
  trend: QsTrendPoint[];
  flags: QsFlag[];
  componentNote: string; // de vaste eerlijkheidsbeperking voor de prompt
  summary: string;
}

export const QS_COMPONENT_NOTE =
  "Alleen de totaal-QS (1 tot 10) is beschikbaar; de drie componenten (verwachte CTR, advertentierelevantie, bestemmingspagina-ervaring) worden niet gesynct. Component-oorzaken mogen dus NIET als gemeten feit worden geclaimd; hefbomen afleiden uit CTR en structuur mag, expliciet als hypothese.";

function monthKey(month: string): string {
  return month.slice(0, 7);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function bucketOf(qs: number): "laag" | "midden" | "gezond" {
  if (qs < QS_LOW) return "laag";
  if (qs < QS_HEALTHY) return "midden";
  return "gezond";
}

// De volledige G2-voorcompute over de aangeleverde keyword-maandrijen (13 maanden waar
// beschikbaar). Degradeert eerlijk: zonder QS-data blijft de functie bruikbaar en zeggen de
// flags en de dekking waarom er weinig te oordelen valt.
export function analyzeQualityScore(rows: KeywordQsPerformanceRow[]): QualityScoreFacts {
  const months = [...new Set(rows.map((r) => monthKey(r.month)))].sort();
  const analysisMonth = months.length > 0 ? months[months.length - 1] : null;
  const previousMonth = months.length > 1 ? months[months.length - 2] : null;

  const rowsOf = (month: string | null) => (month == null ? [] : rows.filter((r) => monthKey(r.month) === month));
  const currentRows = rowsOf(analysisMonth);
  const previousRows = rowsOf(previousMonth);

  // Dekking: het aandeel van de spend met een gerapporteerde QS.
  const totalSpend = currentRows.reduce((sum, r) => sum + Math.max(r.cost, 0), 0);
  const coveredRows = currentRows.filter((r) => r.quality_score != null && r.quality_score > 0);
  const coveredSpend = coveredRows.reduce((sum, r) => sum + Math.max(r.cost, 0), 0);
  const coveragePct = totalSpend > 0 ? Math.round((coveredSpend / totalSpend) * 1000) / 10 : 0;

  // De kosten-gewogen verdeling in drie buckets, met per bucket de CTR- en CPC-samenhang.
  const bucketDefs: Array<{ bucket: QsBucketFact["bucket"]; range: string }> = [
    { bucket: "laag", range: `QS onder ${QS_LOW}` },
    { bucket: "midden", range: `QS ${QS_LOW} tot ${QS_HEALTHY}` },
    { bucket: "gezond", range: `QS ${QS_HEALTHY} en hoger` },
  ];
  const buckets: QsBucketFact[] = bucketDefs.map(({ bucket, range }) => {
    const inBucket = coveredRows.filter((r) => bucketOf(r.quality_score as number) === bucket);
    const spend = inBucket.reduce((sum, r) => sum + Math.max(r.cost, 0), 0);
    const clicks = inBucket.reduce((sum, r) => sum + Math.max(r.clicks, 0), 0);
    const impressions = inBucket.reduce((sum, r) => sum + Math.max(r.impressions, 0), 0);
    return {
      bucket,
      range,
      spend: Math.round(spend * 100) / 100,
      sharePct: coveredSpend > 0 ? Math.round((spend / coveredSpend) * 1000) / 10 : 0,
      avgCtrPct: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : null,
      avgCpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null,
    };
  });
  const lowBucket = buckets[0];

  // Account-niveau spend-gewogen QS, met de maand-op-maand delta en de erosie-detectie.
  const toQsRows = (list: KeywordQsPerformanceRow[]) => list.map((r) => ({ cost: r.cost, quality_score: r.quality_score }));
  const accountSpendWeightedQs = spendWeightedQualityScore(toQsRows(currentRows));
  const previousMonthQs = spendWeightedQualityScore(toQsRows(previousRows));
  const deltaMoM = accountSpendWeightedQs != null && previousMonthQs != null ? round1(accountSpendWeightedQs - previousMonthQs) : null;

  // Per campagne: de spend-gewogen QS en de spend in de lage bucket, gesorteerd op dat laatste.
  const campaignNames = [...new Set(currentRows.map((r) => r.campaign_name))];
  const campaigns: QsCampaignFact[] = campaignNames
    .map((name) => {
      const ofCampaign = currentRows.filter((r) => r.campaign_name === name);
      const covered = ofCampaign.filter((r) => r.quality_score != null && r.quality_score > 0);
      return {
        campaignName: name,
        spendWeightedQs: spendWeightedQualityScore(toQsRows(ofCampaign)),
        totalSpend: Math.round(ofCampaign.reduce((sum, r) => sum + Math.max(r.cost, 0), 0) * 100) / 100,
        lowBucketSpend: Math.round(covered.filter((r) => bucketOf(r.quality_score as number) === "laag").reduce((sum, r) => sum + Math.max(r.cost, 0), 0) * 100) / 100,
      };
    })
    .sort((a, b) => b.lowBucketSpend - a.lowBucketSpend)
    .slice(0, 8);

  // De prioriteitenlijst: hoge kosten maal lage QS, met de converterend-vlag als nuance.
  const priorityKeywords: QsPriorityKeyword[] = coveredRows
    .filter((r) => (r.quality_score as number) < QS_LOW && r.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, PRIORITY_LIST_SIZE)
    .map((r) => ({
      keywordText: r.keyword_text,
      campaignName: r.campaign_name,
      adGroupName: r.ad_group_name,
      matchType: r.match_type,
      cost: Math.round(r.cost * 100) / 100,
      clicks: r.clicks,
      conversions: r.conversions,
      qualityScore: r.quality_score as number,
      converting: r.conversions > 0,
    }));

  // De 13-maands trend waar beschikbaar.
  const trend: QsTrendPoint[] = months.map((month) => {
    const ofMonth = rowsOf(month);
    const covered = ofMonth.filter((r) => r.quality_score != null && r.quality_score > 0);
    const coveredMonthSpend = covered.reduce((sum, r) => sum + Math.max(r.cost, 0), 0);
    const lowSpend = covered.filter((r) => bucketOf(r.quality_score as number) === "laag").reduce((sum, r) => sum + Math.max(r.cost, 0), 0);
    return {
      month,
      spendWeightedQs: spendWeightedQualityScore(toQsRows(ofMonth)),
      lowSpendSharePct: coveredMonthSpend > 0 ? Math.round((lowSpend / coveredMonthSpend) * 1000) / 10 : null,
    };
  });

  // De flags.
  const flags: QsFlag[] = [];
  if (coveragePct > 0 && lowBucket.sharePct >= LOW_QS_SPEND_ALERT * 100) {
    flags.push({ kind: "dure_lage_qs", detail: `${lowBucket.sharePct} procent van de QS-gedekte spend zit in kernwoorden met QS onder ${QS_LOW}: structureel duur inkopen` });
  }
  if (deltaMoM != null && deltaMoM <= -QS_EROSION_DELTA) {
    flags.push({ kind: "qs_erosie", detail: `de spend-gewogen QS daalde ${Math.abs(deltaMoM)} punt maand-op-maand (${previousMonthQs} naar ${accountSpendWeightedQs}): de kwaliteit erodeert en dat wordt elke maand duurder` });
  }
  if (coveragePct < MIN_QS_COVERAGE * 100) {
    flags.push({ kind: "lage_dekking", detail: `slechts ${coveragePct} procent van de spend heeft een gerapporteerde QS; elk QS-oordeel is daardoor zwak en de analyse zegt vooral iets over het gedekte deel` });
  }

  const summary =
    analysisMonth == null
      ? "Geen keyword-data aangeleverd."
      : accountSpendWeightedQs == null
        ? `Analysemaand ${analysisMonth}: geen enkele gerapporteerde quality score in de data (dekking ${coveragePct} procent).`
        : `Analysemaand ${analysisMonth}: spend-gewogen QS ${accountSpendWeightedQs}${deltaMoM != null ? ` (MoM ${deltaMoM >= 0 ? "plus" : "min"} ${Math.abs(deltaMoM)})` : ""}, ${lowBucket.sharePct} procent van de QS-gedekte spend in de lage bucket, dekking ${coveragePct} procent, ${priorityKeywords.length} prioriteitswoorden.`;

  return {
    analysisMonth,
    coveragePct,
    accountSpendWeightedQs,
    previousMonthQs,
    deltaMoM,
    buckets,
    campaigns,
    priorityKeywords,
    trend,
    flags,
    componentNote: QS_COMPONENT_NOTE,
    summary,
  };
}
