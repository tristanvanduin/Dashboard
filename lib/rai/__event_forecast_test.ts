// Test voor de R1 event-forecast. Deterministisch, geen IO.
// Draaien: npx tsx lib/rai/__event_forecast_test.ts

import { forecastStream } from "./event-forecast";
import type { Edition, DailyPoint } from "./event-time-axis";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Venster van 45 dagen: campagnestart 1 maart, beurs 15 april.
const cur: Edition = { editionId: "2026", campaignStartDate: "2026-03-01", fairStartDate: "2026-04-15", fairEndDate: "2026-04-17" };
const prev: Edition = { editionId: "2025", campaignStartDate: "2025-03-01", fairStartDate: "2025-04-15", fairEndDate: "2025-04-17" };

// Vorige editie: opbouw die versnelt naar de beurs. Cumulatief tot D-15 = 2000, eind = 5000.
const prevPoints: DailyPoint[] = [
  { date: "2025-03-08", value: 500 },   // D-38
  { date: "2025-03-22", value: 700 },   // D-24
  { date: "2025-03-31", value: 800 },   // D-15  -> cum tot D-15 = 2000
  { date: "2025-04-08", value: 1500 },  // D-7
  { date: "2025-04-13", value: 1500 },  // D-2  -> eind = 5000
];
// Huidige editie tot D-15 = 2400 (voor op de vorige).
const curPoints: DailyPoint[] = [
  { date: "2026-03-08", value: 600 },   // D-38
  { date: "2026-03-22", value: 900 },   // D-24
  { date: "2026-03-31", value: 900 },   // D-15 -> cum tot D-15 = 2400
];

// ── Sjabloon-projectie op D-15 ──
const f = forecastStream({ current: { edition: cur, points: curPoints }, previous: { edition: prev, points: prevPoints }, target: 5500, asOfDate: "2026-03-31" });
assert(f.method === "vorige_editie_sjabloon", "met een vergelijkbaar vorige-editie-venster gebruikt hij de sjabloon");
assert(f.daysToFairNow === 15 && f.currentCumulative === 2400, "ankert op D-15 met de huidige cumulatieve stand");
// ratio = 5000/2000 = 2.5; projectie = 2400 * 2.5 = 6000
assert(f.projectedFinal === 6000, "projecteert met de groei van de vorige editie van D-15 naar de beurs (2,5x)");
assert(f.projectedFinal! > f.currentCumulative * (45 / 30), "de sjabloon-projectie ligt hoger dan een lineaire, want hij vangt de eindpiek");
assert(f.projectedVsTargetPct !== null && Math.abs(f.projectedVsTargetPct - 1.091) < 0.01 && f.willHitTarget === true, "projectie versus target 5500 gehaald");

// ── Vertrouwen stijgt dichter bij de beurs ──
// Op D-6 (fracLeft 6/45 = 0.13 < 0.3) hoort hoog vertrouwen.
const curBijBeurs: DailyPoint[] = [...curPoints, { date: "2026-04-05", value: 1200 }]; // D-10
const fDichtbij = forecastStream({ current: { edition: cur, points: curBijBeurs }, previous: { edition: prev, points: prevPoints }, target: 5500, asOfDate: "2026-04-09" });
assert(fDichtbij.daysToFairNow === 6 && fDichtbij.confidence === "hoog", "dicht bij de beurs is het vertrouwen hoog");
assert(f.confidence === "gemiddeld", "ver van de beurs (D-15) is het vertrouwen gemiddeld");

// ── Eerste editie: tempo-extrapolatie met onzekerheid ──
const eerste = forecastStream({ current: { edition: cur, points: curPoints }, previous: null, target: 5500, asOfDate: "2026-03-31" });
assert(eerste.method === "tempo_extrapolatie" && eerste.confidence === "laag", "eerste editie valt terug op tempo-extrapolatie met laag vertrouwen");
assert(eerste.note.includes("eerste editie") && eerste.note.includes("onderschat"), "de onzekerheid wordt expliciet benoemd");
// daysElapsed = 45-15 = 30; pace = 2400/30 = 80; projectie = 80*45 = 3600
assert(eerste.projectedFinal === 3600, "lineaire extrapolatie: 2400 in 30 dagen, doorgetrokken naar 45 dagen");

// ── Onvergelijkbaar venster: ook terugval ──
const prevKort: Edition = { editionId: "2025k", campaignStartDate: "2025-04-01", fairStartDate: "2025-04-15", fairEndDate: "2025-04-17" };
const anderVenster = forecastStream({ current: { edition: cur, points: curPoints }, previous: { edition: prevKort, points: prevPoints }, target: 5500, asOfDate: "2026-03-31" });
assert(anderVenster.method === "tempo_extrapolatie" && anderVenster.note.includes("vergelijkbaar"), "een onvergelijkbaar venster valt terug op tempo met de reden erbij");

// ── Nooit voorbij de beurs ──
const naBeurs = forecastStream({ current: { edition: cur, points: [...curPoints, { date: "2026-04-14", value: 2600 }] }, previous: { edition: prev, points: prevPoints }, target: 5500, asOfDate: "2026-04-20" });
assert(naBeurs.method === "beurs_bereikt" && naBeurs.daysToFairNow! < 0, "na de beurs wordt niet geprojecteerd; de eindstand is bekend");
assert(naBeurs.projectedFinal === naBeurs.currentCumulative, "na de beurs is de projectie gelijk aan de gerealiseerde eindstand");

// ── Extreme exponentiële ramp: vroeg op de curve niet naar 0 klappen of exploderen ──
// Vorige editie: 96% van het volume valt pas in de laatste 2 dagen (typisch beurs-gedrag).
// Cum tot D-30 = 20; eind = 5000. Restvolume ná D-30 = 4980.
const rampPrev: DailyPoint[] = [
  { date: "2025-03-06", value: 20 },    // D-40
  { date: "2025-03-31", value: 180 },   // D-15
  { date: "2025-04-13", value: 4800 },  // D-2  -> eind = 5000
];

// (1) Stand 0 op D-30 (nog niets geconverteerd): projecteer NIET 0, maar het absolute
// restvolume van de vorige editie bovenop de stand. asOfDate D-30 = 2026-03-16.
const nul = forecastStream({ current: { edition: cur, points: [{ date: "2026-03-25", value: 30 }] }, previous: { edition: prev, points: rampPrev }, target: 5500, asOfDate: "2026-03-16" });
assert(nul.daysToFairNow === 30 && nul.currentCumulative === 0, "op D-30 staat de huidige editie nog op 0 (piek moet nog komen)");
assert(nul.method === "vorige_editie_restvolume" && nul.confidence === "laag", "vroeg op de ramp ankert hij op het restvolume, expliciet laag-zeker");
assert(nul.projectedFinal === 4980, "projectie = stand (0) + restvolume vorige editie (4980), niet 0");
assert(nul.projectedFinal !== 0, "de forecast klapt niet naar 0 door de exponentiële opbouw");

// (2) Kleine stand op D-30: geen explosie via een ratio door een piepklein getal.
// Multiplicatief zou 40 * (5000/20) = 10.000 geven; het restvolume-anker geeft 40 + 4980.
const klein = forecastStream({ current: { edition: cur, points: [{ date: "2026-03-10", value: 40 }] }, previous: { edition: prev, points: rampPrev }, target: 5500, asOfDate: "2026-03-16" });
assert(klein.currentCumulative === 40 && klein.method === "vorige_editie_restvolume", "kleine stand ver van de beurs valt op het restvolume-anker");
assert(klein.projectedFinal === 5020, "projectie = 40 + 4980 = 5020, niet de geëxplodeerde 10.000");
assert(klein.projectedFinal! < 6000, "de tempo-ratio explodeert niet door de deling door een piepklein getal");

// (3) Zodra genoeg van de curve is opgebouwd (>= 15%), keert hij terug naar de multiplicatieve
// sjabloon. Op D-2 stond bij rampPrev alles (materialized 100%): ratio 1, projectie ~ stand.
const opRamp = forecastStream({ current: { edition: cur, points: [{ date: "2026-04-01", value: 300 }, { date: "2026-04-13", value: 4600 }] }, previous: { edition: prev, points: rampPrev }, target: 5500, asOfDate: "2026-04-13" });
assert(opRamp.daysToFairNow === 2 && opRamp.method === "vorige_editie_sjabloon", "dicht bij de beurs, met de curve opgebouwd, weer de multiplicatieve sjabloon");

// ── Geen basis ──
const geen = forecastStream({ current: { edition: cur, points: [] }, previous: null, target: 5500, asOfDate: "2026-03-05" });
assert(geen.method === "geen_basis" && geen.projectedFinal === null, "zonder verstreken opbouw geen projectie");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
