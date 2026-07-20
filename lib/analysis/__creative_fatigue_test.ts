// Zelf-draaiende test voor de creative-vermoeidheid. Draait via tsx.
// Kern: een creative die materieel onder zijn CTR-piek zakt = vermoeid; een milde daling =
// afnemend; een creative die nu piekt of stabiel blijft wordt NIET vals gevlagd; en zonder
// genoeg maanden/volume degradeert het oordeel eerlijk naar "te weinig data".

import { analyzeCreativeFatigue, MIN_IMPRESSIONS_PER_PERIOD, type CreativePeriodRow } from "./creative-fatigue";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

// Helper: bouw maandrijen voor één creative uit een lijst CTR's (impressies vast, ruim boven drempel).
const series = (id: string, ctrs: number[], impr = 1000): CreativePeriodRow[] =>
  ctrs.map((ctr, i) => ({ id, name: id, period: `2026-0${i + 1}`, impressions: impr, clicks: Math.round(impr * ctr) }));

console.log("vermoeid vs afnemend vs stabiel:");
{
  const rows = [
    ...series("Vermoeid", [0.10, 0.09, 0.05]),   // piek 10% -> 5% = -50% => vermoeid
    ...series("Afnemend", [0.10, 0.095, 0.08]),  // piek 10% -> 8% = -20% => afnemend
    ...series("Stabiel", [0.10, 0.098, 0.099]),  // dicht bij piek => stabiel
    ...series("Groeiend", [0.05, 0.08, 0.11]),   // piek is nu => stabiel (niet vals gevlagd)
  ];
  const out = analyzeCreativeFatigue(rows);
  const byId = new Map(out.map((c) => [c.id, c]));
  assert(byId.get("Vermoeid")?.status === "vermoeid", "50% onder piek => vermoeid");
  assert(byId.get("Afnemend")?.status === "afnemend", "20% onder piek => afnemend");
  assert(byId.get("Stabiel")?.status === "stabiel", "dicht bij piek => stabiel");
  assert(byId.get("Groeiend")?.status === "stabiel", "piek in de recentste maand => niet vals gevlagd");
  assert(out[0].id === "Vermoeid", "meest versleten creative staat vooraan");
}

console.log("volume- en periode-drempel:");
{
  // Twee maanden: te weinig periodes voor een oordeel.
  const kort = analyzeCreativeFatigue(series("Kort", [0.10, 0.04]));
  assert(kort[0].status === "te_weinig_data", "onder 3 maanden => te weinig data");

  // Drie maanden maar te weinig volume per maand (onder de impressie-drempel).
  const dun = analyzeCreativeFatigue(series("Dun", [0.10, 0.08, 0.04], MIN_IMPRESSIONS_PER_PERIOD - 100));
  assert(dun[0].status === "te_weinig_data", "onvoldoende volume per maand => te weinig data");
}

console.log("cijfers kloppen:");
{
  const out = analyzeCreativeFatigue(series("V", [0.10, 0.08, 0.05]));
  const c = out[0];
  assert(Math.abs((c.peakCtr ?? 0) - 0.10) < 1e-9 && Math.abs((c.latestCtr ?? 0) - 0.05) < 1e-9, "piek- en laatste CTR correct");
  assert(Math.abs((c.declineFromPeak ?? 0) - -0.5) < 1e-9, "verval van piek = -50%");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle creative-fatigue-tests geslaagd");
