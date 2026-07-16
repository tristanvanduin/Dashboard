// Test voor de metric-cross-checks. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__metric_cross_checks_test.ts

import { spendWeightedQualityScore, classifyRankLossCause, decomposeDemandVsShare, classifyCpcPressure, classifyBudgetLost, QS_LOW, QS_HEALTHY, DOMINANT_EFFECT } from "./metric-cross-checks";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Spend-gewogen QS ──
const qs = spendWeightedQualityScore([
  { cost: 900, quality_score: 3 },
  { cost: 100, quality_score: 9 },
]);
assert(qs === 3.6, "de QS is spend-gewogen: 90 procent van de spend op QS 3 trekt het gemiddelde naar 3,6");
assert(spendWeightedQualityScore([{ cost: 100, quality_score: null }]) === null, "zonder enige QS-data: null, geen gok");
assert(spendWeightedQualityScore([{ cost: 0, quality_score: 8 }]) === null, "keywords zonder spend wegen niet mee");

// ── Rank-verlies-oorzaak (het letterlijke voorbeeld uit de vraag) ──
const kwaliteit = classifyRankLossCause(0.25, 3.6);
assert(kwaliteit.cause === "kwaliteitsprobleem", "rank-verlies met lage QS is een kwaliteitsprobleem");
assert(kwaliteit.detail.includes("meer bieden koopt dit niet weg"), "de detail zegt dat bieden dit niet oplost");
const bod = classifyRankLossCause(0.25, 8.2);
assert(bod.cause === "bodprobleem", "rank-verlies met gezonde QS is een bodprobleem");
assert(classifyRankLossCause(0.25, 6).cause === "gemengd", "QS in het middengebied: gemengd");
assert(classifyRankLossCause(0.03, 3).cause === "geen_materieel_rankverlies", "verwaarloosbaar rank-verlies: geen diagnose");
assert(classifyRankLossCause(0.25, null).cause === "geen_qs_data", "materieel verlies zonder QS-data wordt eerlijk gemeld");
assert(QS_LOW === 5 && QS_HEALTHY === 7, "de QS-drempels staan op 5 en 7");

// ── Vraag-versus-aandeel-decompositie ──
// Markt kromp: eligible van 20000 naar 12000, IS stabiel 0,5. Impressies 10000 naar 6000.
const krimp = decomposeDemandVsShare({ impressions: 6000, impressionShare: 0.5, prevImpressions: 10000, prevImpressionShare: 0.5 });
assert(krimp.verdict === "markt_kromp", "impressie-daling bij gelijk aandeel is markt-krimp");
assert(krimp.marketEffect === -4000 && krimp.shareEffect === 0, "het volledige effect is markt, nul aandeel");
assert(krimp.detail.includes("geen prestatieprobleem"), "de detail beschermt tegen een onterecht optimalisatie-advies");
// Aandeel verloren: markt gelijk (eligible 20000), IS van 0,5 naar 0,3. Impressies 10000 naar 6000.
const verloren = decomposeDemandVsShare({ impressions: 6000, impressionShare: 0.3, prevImpressions: 10000, prevImpressionShare: 0.5 });
assert(verloren.verdict === "aandeel_verloren", "dezelfde impressie-daling bij gelijke markt is aandeel-verlies");
assert(verloren.marketEffect === 0 && verloren.shareEffect === -4000, "het volledige effect is aandeel, nul markt");
assert(verloren.detail.includes("vraagt ingrijpen"), "aandeel-verlies is wel een prestatieprobleem");
// Wiskundige consistentie: markt plus aandeel benadert de delta
assert(Math.abs(krimp.marketEffect + krimp.shareEffect - -4000) <= 1, "de decompositie telt op tot de impressie-delta");
// Stabiel en niet-bepaalbaar
assert(decomposeDemandVsShare({ impressions: 10100, impressionShare: 0.5, prevImpressions: 10000, prevImpressionShare: 0.5 }).verdict === "stabiel", "kleine beweging is stabiel");
assert(decomposeDemandVsShare({ impressions: 6000, impressionShare: 0, prevImpressions: 10000, prevImpressionShare: 0.5 }).verdict === "niet_bepaalbaar", "zonder geldige IS geen decompositie");
assert(DOMINANT_EFFECT === 0.6, "de dominantie-drempel is 60 procent");

// ── CPC-drukrichting ──
assert(classifyCpcPressure({ cpc: 1.2, prevCpc: 1.0, impressionShare: 0.4, prevImpressionShare: 0.5 }).pressure === "veiling_verhit", "CPC omhoog en IS omlaag: de veiling verhit");
assert(classifyCpcPressure({ cpc: 1.2, prevCpc: 1.0, impressionShare: 0.6, prevImpressionShare: 0.5 }).pressure === "positie_gekocht", "CPC omhoog en IS omhoog: positie gekocht");
assert(classifyCpcPressure({ cpc: 0.9, prevCpc: 1.0, impressionShare: 0.6, prevImpressionShare: 0.5 }).pressure === "efficienter_ingekocht", "CPC omlaag en IS omhoog: efficienter");
assert(classifyCpcPressure({ cpc: 1.01, prevCpc: 1.0, impressionShare: 0.5, prevImpressionShare: 0.5 }).pressure === "stabiel", "kleine bewegingen zijn stabiel");
assert(classifyCpcPressure({ cpc: 1.2, prevCpc: 0, impressionShare: 0.5, prevImpressionShare: 0.5 }).pressure === "niet_bepaalbaar", "zonder vorige CPC geen oordeel");

// ── Budget-lost-consistentie ──
const pacing = classifyBudgetLost(0.2, 0.7);
assert(pacing.verdict === "pacing_probleem", "budget-verlies bij 70 procent benutting is een pacing-probleem");
assert(pacing.detail.includes("verhogen lost dit niet op"), "de detail voorkomt een onterecht verhoog-advies");
assert(classifyBudgetLost(0.2, 0.95).verdict === "echt_budget_tekort", "budget-verlies tegen het plafond is een echt tekort");
assert(classifyBudgetLost(0.03, 0.5).verdict === "geen_budget_verlies", "verwaarloosbaar verlies: geen oordeel");
assert(classifyBudgetLost(0.2, null).verdict === "echt_budget_tekort", "zonder benuttingsdata telt materieel verlies als tekort (conservatief)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
