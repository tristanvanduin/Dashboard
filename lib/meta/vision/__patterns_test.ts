// Test voor de M3 pattern-aggregatie (bestond al, de test ontbrak; spec-test 3).
// Deterministisch, geen IO. Draaien: npx tsx lib/meta/vision/__patterns_test.ts

import { aggregatePattern, buildContrastPairs, flagFatiguedWinners, MIN_PATTERN_ADS, type AdMetricInput } from "./patterns";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function ad(adId: string, impressions: number, conversions: number, metricValue: number): AdMetricInput {
  return { adId, impressions, conversions, metricValue };
}

// ── De ad-drempel: twee ads is geen patroon ──
assert(aggregatePattern({ attribute: "style", value: "ugc", metric: "hook_rate", ads: [ad("a", 6000, 5, 0.4), ad("b", 6000, 5, 0.35)], accountAvg: 0.3 }) === null, "een patroon met 2 ads valt af (drempel 3) en wordt niet opgeslagen");
assert(MIN_PATTERN_ADS === 3, "de ad-drempel staat op 3");

// ── Spec-test: 3 ads met elk 6.000 impressies ──
const drieAds = [ad("a", 6000, 15, 0.4), ad("b", 6000, 15, 0.38), ad("c", 6000, 10, 0.42)];
const cvrDeterministic = aggregatePattern({ attribute: "style", value: "ugc", metric: "cvr", ads: drieAds, accountAvg: 0.3 });
assert(cvrDeterministic!.evidenceLevel === "deterministic" && cvrDeterministic!.conversions === 40, "3 ads met samen 40 conversies: een cvr-patroon is deterministic");

const tienConversies = [ad("a", 6000, 4, 0.4), ad("b", 6000, 3, 0.38), ad("c", 6000, 3, 0.42)];
const cvrInferred = aggregatePattern({ attribute: "style", value: "ugc", metric: "cvr", ads: tienConversies, accountAvg: 0.3 });
assert(cvrInferred!.evidenceLevel === "inferred" && cvrInferred!.conversions === 10, "dezelfde ads met 10 conversies: inferred, want de conversie-drempel (30) is niet gehaald");

// Hook-claims per ad vanaf 5.000 impressies: een ad eronder degradeert
const hookDeterministic = aggregatePattern({ attribute: "style", value: "ugc", metric: "hook_rate", ads: drieAds, accountAvg: 0.3 });
assert(hookDeterministic!.evidenceLevel === "deterministic", "hook-claims met elke ad boven 5.000 impressies zijn deterministic");
const hookInferred = aggregatePattern({ attribute: "style", value: "ugc", metric: "hook_rate", ads: [ad("a", 6000, 5, 0.4), ad("b", 4000, 5, 0.38), ad("c", 6000, 5, 0.42)], accountAvg: 0.3 });
assert(hookInferred!.evidenceLevel === "inferred", "een ad onder de impressie-drempel degradeert het hook-patroon naar inferred");

// ── De lift als fractie ──
const lift = aggregatePattern({ attribute: "style", value: "ugc", metric: "hook_rate", ads: [ad("a", 10000, 0, 0.42), ad("b", 10000, 0, 0.42), ad("c", 10000, 0, 0.42)], accountAvg: 0.3 });
assert(lift!.liftPct === 0.4 && lift!.patternValue === 0.42, "de lift is een fractie: 0,42 tegen 0,30 is plus 0,4 (40 procent)");

// ── Contrast-paren: alleen deterministic aan beide kanten ──
const met = { ...cvrDeterministic!, value: "met_gezicht", liftPct: 0.38 };
const zonder = { ...cvrDeterministic!, value: "zonder_gezicht", liftPct: -0.1 };
const zwak = { ...cvrInferred!, value: "collage" };
const paren = buildContrastPairs([met, zonder, zwak]);
assert(paren.length === 1 && paren[0].higher.value === "met_gezicht" && paren[0].lower.value === "zonder_gezicht", "het contrast-paar zet de hoogste tegen de laagste van hetzelfde attribuut");
assert(Math.round(paren[0].deltaLiftPct * 100) / 100 === 0.48, "de delta is het verschil tussen de twee lifts");
assert(!paren.some((p) => p.higher.value === "collage" || p.lower.value === "collage"), "een inferred-patroon telt niet mee als hard contrast");

// ── Fatigue-koppeling ──
const vervanging = flagFatiguedWinners([
  { adId: "win-moe", isWinner: true, fatigueStatus: "vermoeid", ctrDeltaPct: -0.34, frequency: 3.8 },
  { adId: "win-fit", isWinner: true, fatigueStatus: "gezond" },
  { adId: "verliezer-moe", isWinner: false, fatigueStatus: "vermoeid" },
]);
assert(vervanging.length === 1 && vervanging[0].adId === "win-moe", "alleen een vermoeide WINNAAR is een vervangingskandidaat");
assert(vervanging[0].reason.includes("-34%") && vervanging[0].reason.includes("3.8"), "de reden draagt de CTR-daling en de frequency");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
