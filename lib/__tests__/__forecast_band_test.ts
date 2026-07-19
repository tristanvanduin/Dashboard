// Zelf-draaiende test voor de forecast-onzekerheidsband. Draait via tsx.
// Kern: de band is nul bij te weinig historie of geen toekomst; hij groeit met de spreiding
// van de gerealiseerde ratio's; de onzekerheid zit alleen op de toekomst; low klemt op 0.

import { computeConfidenceBand } from "../forecast";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

console.log("degeneratie:");
assert(computeConfidenceBand([1.0], 1000, 5000).spreadPct === 0, "één gerealiseerde maand => geen band");
assert(computeConfidenceBand([1.0, 1.1], 0, 5000).spreadPct === 0, "geen toekomst => geen band");
assert(computeConfidenceBand([], 1000, 5000).spreadPct === 0, "geen historie => geen band");

console.log("spreiding drijft de breedte:");
{
  // Stabiele account (alle ratio's gelijk) => stdev 0 => geen band, ondanks toekomst.
  const stable = computeConfidenceBand([1.0, 1.0, 1.0, 1.0], 2000, 6000);
  assert(stable.spreadPct === 0, "stabiele ratio's => geen band");
  // Volatiele account => band > 0.
  const volatile = computeConfidenceBand([0.6, 1.4, 0.7, 1.3], 2000, 6000);
  assert(volatile.spreadPct > 0 && volatile.high > volatile.low, "volatiele ratio's => echte band");
  // Meer volatiliteit => bredere band.
  const meer = computeConfidenceBand([0.2, 1.8, 0.3, 1.7], 2000, 6000);
  assert(meer.spreadPct > volatile.spreadPct, "meer spreiding => bredere band");
}

console.log("alleen toekomst-onzekerheid + klem:");
{
  // stdev van [0.5,1.5] = 0.5; halfBand = 0.5 * futureExpected.
  const b = computeConfidenceBand([0.5, 1.5], 1000, 4000);
  assert(Math.abs((b.high - 4000) - 500) < 1 && Math.abs((4000 - b.low) - 500) < 1, "halfband = stdev × toekomst-som (±500)");
  // Kleine puntprognose, grote toekomst-som: low klemt op 0, gaat niet negatief.
  const klem = computeConfidenceBand([0.1, 1.9], 5000, 1000);
  assert(klem.low === 0, "low klemt op 0 (geen negatieve prognose)");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle forecast-band-tests geslaagd");
