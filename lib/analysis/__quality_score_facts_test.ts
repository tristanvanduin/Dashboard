// Test voor de G2 quality-score-facts. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__quality_score_facts_test.ts

import { analyzeQualityScore, QS_EROSION_DELTA, LOW_QS_SPEND_ALERT, QS_COMPONENT_NOTE, type KeywordQsPerformanceRow } from "./quality-score-facts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function kw(o: Partial<KeywordQsPerformanceRow> & { keyword_text: string; cost: number; quality_score: number | null }): KeywordQsPerformanceRow {
  return {
    month: "2026-06",
    campaign_name: "Search NL",
    ad_group_name: "Adgroup A",
    match_type: "BROAD",
    impressions: 1000,
    clicks: 100,
    conversions: 0,
    ...o,
  };
}

// ── De kosten-gewogen verdeling: een dure lage-QS-term weegt zwaarder dan goedkope gezonde ──
const verdeling = analyzeQualityScore([
  kw({ keyword_text: "duur laag", cost: 900, quality_score: 3, clicks: 300, impressions: 10000, conversions: 2 }),
  kw({ keyword_text: "goedkoop gezond a", cost: 50, quality_score: 8, clicks: 25, impressions: 200 }),
  kw({ keyword_text: "goedkoop gezond b", cost: 50, quality_score: 9, clicks: 25, impressions: 200 }),
]);
const laag = verdeling.buckets.find((b) => b.bucket === "laag")!;
const gezond = verdeling.buckets.find((b) => b.bucket === "gezond")!;
assert(laag.sharePct === 90 && gezond.sharePct === 10, "de verdeling is kosten-gewogen: 90 procent van de spend zit laag ondanks twee gezonde woorden");
assert(verdeling.accountSpendWeightedQs === 3.6, "de account-QS is spend-gewogen (hergebruikte berekening)");
assert(verdeling.flags.some((f) => f.kind === "dure_lage_qs"), "90 procent lage spend geeft de dure-lage-qs-flag (drempel 20 procent)");
assert(LOW_QS_SPEND_ALERT === 0.2, "de alert-drempel is 20 procent");

// ── De bucket-samenhang: CTR en CPC per bucket ──
assert(laag.avgCtrPct === 3 && laag.avgCpc === 3, "de lage bucket toont de CTR (300 van 10000) en de CPC (900 gedeeld door 300)");
assert(gezond.avgCtrPct === 12.5 && gezond.avgCpc === 2, "de gezonde bucket toont de eigen CTR en CPC voor de samenhang-duiding");

// ── De prioriteitenlijst: hoge kosten maal lage QS, met de converterend-vlag ──
assert(verdeling.priorityKeywords.length === 1 && verdeling.priorityKeywords[0].keywordText === "duur laag", "alleen lage-QS-woorden komen op de prioriteitenlijst");
assert(verdeling.priorityKeywords[0].converting === true, "een converterend laag-QS-woord draagt de vlag: duur maar het werkt, andere actie");
const sortering = analyzeQualityScore([
  kw({ keyword_text: "laag klein", cost: 100, quality_score: 4 }),
  kw({ keyword_text: "laag groot", cost: 500, quality_score: 2 }),
  kw({ keyword_text: "gezond", cost: 800, quality_score: 8 }),
]);
assert(sortering.priorityKeywords[0].keywordText === "laag groot" && sortering.priorityKeywords.length === 2, "de lijst sorteert op kosten aflopend en sluit gezonde woorden uit");

// ── Degradatie: deels ontbrekende QS ──
const deels = analyzeQualityScore([
  kw({ keyword_text: "met qs", cost: 200, quality_score: 8 }),
  kw({ keyword_text: "zonder qs", cost: 800, quality_score: null }),
]);
assert(deels.coveragePct === 20, "de dekking is het spend-aandeel met QS: 200 van 1000");
assert(deels.flags.some((f) => f.kind === "lage_dekking" && f.detail.includes("20")), "onder de 30 procent dekking komt de lage-dekking-flag met het percentage");
assert(deels.accountSpendWeightedQs === 8, "de account-QS rekent alleen over het gedekte deel (geen gok over de rest)");

// ── Degradatie: geen enkele QS ──
const geen = analyzeQualityScore([kw({ keyword_text: "a", cost: 100, quality_score: null })]);
assert(geen.accountSpendWeightedQs === null && geen.coveragePct === 0, "zonder enige QS is de account-QS null en de dekking nul");
assert(geen.priorityKeywords.length === 0 && geen.summary.includes("geen enkele gerapporteerde"), "de samenvatting zegt eerlijk dat er niets te oordelen valt");

// ── Erosie: de maand-op-maand delta ──
const erosie = analyzeQualityScore([
  kw({ keyword_text: "a", cost: 100, quality_score: 7, month: "2026-05" }),
  kw({ keyword_text: "a", cost: 100, quality_score: 6, month: "2026-06" }),
]);
assert(erosie.analysisMonth === "2026-06" && erosie.previousMonthQs === 7 && erosie.deltaMoM === -1, "de analysemaand is de laatste en de delta is de maand-op-maand beweging");
assert(erosie.flags.some((f) => f.kind === "qs_erosie" && f.detail.includes("erodeert")), "een daling van een punt geeft de erosie-flag");
const stabiel = analyzeQualityScore([
  kw({ keyword_text: "a", cost: 100, quality_score: 7, month: "2026-05" }),
  kw({ keyword_text: "a", cost: 100, quality_score: 6.7, month: "2026-06" }),
]);
assert(!stabiel.flags.some((f) => f.kind === "qs_erosie") && QS_EROSION_DELTA === 0.5, "een beweging binnen de halve punt is ruis, geen erosie");

// ── De trend en de campagne-sortering ──
assert(erosie.trend.length === 2 && erosie.trend[0].month === "2026-05" && erosie.trend[1].spendWeightedQs === 6, "de trendreeks loopt chronologisch met de QS per maand");
const campagnes = analyzeQualityScore([
  kw({ keyword_text: "a", cost: 300, quality_score: 3, campaign_name: "Probleem" }),
  kw({ keyword_text: "b", cost: 900, quality_score: 8, campaign_name: "Gezond" }),
]);
assert(campagnes.campaigns[0].campaignName === "Probleem" && campagnes.campaigns[0].lowBucketSpend === 300, "campagnes sorteren op spend in de lage bucket, niet op totale spend");

// ── De componenten-beperking zit hard in het facts-object ──
assert(verdeling.componentNote === QS_COMPONENT_NOTE && verdeling.componentNote.includes("NIET als gemeten feit"), "de componenten-no-go reist mee naar de prompt");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
