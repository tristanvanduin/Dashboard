// Test voor de R1 event-tijdas-kern. Deterministisch, geen IO.
// Draaien: npx tsx lib/rai/__event_time_axis_test.ts

import { daysToFair, isWithinWindow, windowLengthDays, cumulativeThroughDaysOut, cumulativeCurve, alignEditionsAtEqualDaysOut, MATERIAL_WINDOW_DIFF, type Edition, type DailyPoint } from "./event-time-axis";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Editie 2026: campagne start 1 maart, beurs 15-17 april.
const ed2026: Edition = { editionId: "2026", campaignStartDate: "2026-03-01", fairStartDate: "2026-04-15", fairEndDate: "2026-04-17" };
// Editie 2025: campagne start 2 maart, beurs 16-18 april (vergelijkbaar venster).
const ed2025: Edition = { editionId: "2025", campaignStartDate: "2025-03-02", fairStartDate: "2025-04-16", fairEndDate: "2025-04-18" };

// ── Dagen tot beurs ──
assert(daysToFair("2026-04-15", "2026-04-15") === 0, "op de eerste beursdag is dagen-tot-beurs 0");
assert(daysToFair("2026-04-15", "2026-04-01") === 14, "14 dagen voor de beurs");
assert(daysToFair("2026-04-15", "2026-04-20") === -5, "na de beurs is het negatief");
assert(daysToFair("kapot", "2026-04-01") === null, "een ongeldige datum geeft null");

// ── Venster ──
assert(isWithinWindow("2026-03-15", ed2026), "een datum binnen campagne en beurs valt in het venster");
assert(!isWithinWindow("2026-02-15", ed2026), "voor de campagnestart valt buiten het venster");
assert(!isWithinWindow("2026-04-20", ed2026), "na het beurseinde valt buiten het venster");
assert(isWithinWindow("2026-04-17", ed2026), "de laatste beursdag valt nog in het venster");

// ── Vensterlengte ──
assert(windowLengthDays(ed2026) === 45, "van 1 maart tot 15 april is 45 dagen");

// ── Cumulatief tot dagen-uit ──
const punten2026: DailyPoint[] = [
  { date: "2026-03-01", value: 10 }, // D-45
  { date: "2026-03-31", value: 20 }, // D-15
  { date: "2026-04-10", value: 30 }, // D-5
  { date: "2026-02-01", value: 999 }, // buiten venster, moet genegeerd
];
// Tot D-15 (x=15): alleen de punten met dagen-uit >= 15, dus D-45 en D-15
assert(cumulativeThroughDaysOut(punten2026, ed2026, 15) === 30, "cumulatief tot D-15 telt D-45 en D-15, negeert D-5 en buiten-venster");
assert(cumulativeThroughDaysOut(punten2026, ed2026, 5) === 60, "cumulatief tot D-5 telt alle drie de in-venster punten");
assert(cumulativeThroughDaysOut(punten2026, ed2026, 50) === 0, "tot D-50 is er nog niets");

// ── Cumulatieve curve ──
const curve = cumulativeCurve(punten2026, ed2026);
assert(curve.length === 3, "de curve heeft drie in-venster punten");
assert(curve[0].daysToFair === 45 && curve[0].cumulative === 10, "de curve begint ver voor de beurs");
assert(curve[2].daysToFair === 5 && curve[2].cumulative === 60, "de curve eindigt cumulatief dicht bij de beurs");

// ── Editie-over-editie op gelijke dagen-uit ──
const punten2025: DailyPoint[] = [
  { date: "2025-03-02", value: 8 }, // D-45
  { date: "2025-04-01", value: 12 }, // D-15
  { date: "2025-04-11", value: 25 }, // D-5
];
// Vandaag 31 maart 2026 = D-15 voor de 2026-beurs. Vergelijk cumulatief tot D-15.
const cmp = alignEditionsAtEqualDaysOut({ edition: ed2026, points: punten2026 }, { edition: ed2025, points: punten2025 }, "2026-03-31");
assert(cmp.comparable === true, "vergelijkbare vensters zijn vergelijkbaar");
assert(cmp.daysToFairNow === 15, "vandaag is D-15");
assert(cmp.currentCumulative === 30, "huidige editie tot D-15 is 30");
assert(cmp.previousCumulativeAtSameDaysOut === 20, "vorige editie tot D-15 is 20 (8 plus 12)");
assert(cmp.deltaPct !== null && Math.abs(cmp.deltaPct - 0.5) < 1e-9, "50 procent voor op de vorige editie");

// ── Markering: eerste editie ──
const eerste = alignEditionsAtEqualDaysOut({ edition: ed2026, points: punten2026 }, null, "2026-03-31");
assert(!eerste.comparable && eerste.reason === "eerste_editie", "geen vorige editie: markering eerste_editie");
assert(eerste.currentCumulative === 30, "de huidige stand wordt wel gegeven bij een eerste editie");

// ── Markering: geen vorige data ──
const geenData = alignEditionsAtEqualDaysOut({ edition: ed2026, points: punten2026 }, { edition: ed2025, points: [] }, "2026-03-31");
assert(!geenData.comparable && geenData.reason === "geen_vorige_data", "lege vorige-editie-data: markering geen_vorige_data");

// ── Markering: materieel ander venster ──
// Vorige editie met een veel korter venster (start 1 april, dus 15 dagen ipv 45).
const edKort: Edition = { editionId: "2025k", campaignStartDate: "2025-04-01", fairStartDate: "2025-04-16", fairEndDate: "2025-04-18" };
const anderVenster = alignEditionsAtEqualDaysOut({ edition: ed2026, points: punten2026 }, { edition: edKort, points: punten2025 }, "2026-03-31");
assert(!anderVenster.comparable && anderVenster.reason === "materieel_ander_venster", "sterk afwijkend venster: markering ipv stille vergelijking");

assert(MATERIAL_WINDOW_DIFF === 0.2, "de venster-verschil-drempel is 20 procent");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
