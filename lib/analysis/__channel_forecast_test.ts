// Zelf-draaiende test voor de run-rate-forecast (jonge kanalen). Draait via tsx.
// Kern: lopende-maand-projectie op tempo (met betrouwbaarheidsdrempel), en de volgende-maand-
// trend met klemming zodat een korte reeks niet wild extrapoleert.

import { projectCurrentMonth, projectNextMonth, forecastChannelMetric, MIN_DAYS_FOR_RUNRATE, TREND_BAND, type MonthValue } from "./channel-forecast";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

console.log("lopende maand (run-rate):");
{
  // 300 in 10 dagen van 30 => 900 geprojecteerd, betrouwbaar (>=5 dagen).
  const r = projectCurrentMonth(300, 10, 30);
  assert(r.projected === 900 && r.reliable, "300/10*30 = 900, betrouwbaar");
  assert(projectCurrentMonth(50, 2, 30).reliable === false, `onder ${MIN_DAYS_FOR_RUNRATE} dagen => onbetrouwbaar`);
  assert(projectCurrentMonth(0, 0, 30).projected === null, "dag 0 => geen projectie");
}

console.log("volgende maand (trend + klemming):");
{
  assert(projectNextMonth([]).method === "geen", "geen data => geen");
  const two = projectNextMonth([{ month: "2026-05", value: 100 }, { month: "2026-06", value: 120 }]);
  assert(two.method === "laatste" && two.projected === 120, "onder 3 maanden => laatste maand vlak");

  // Stijgende reeks 100,120,140,160 => trend projecteert ~180, binnen +50% van 160 (=240) => 180.
  const up = projectNextMonth([{ month: "1", value: 100 }, { month: "2", value: 120 }, { month: "3", value: 140 }, { month: "4", value: 160 }]);
  assert(up.method === "trend" && up.projected! > 160 && up.projected! <= 240, `stijgende trend projecteert vooruit (${up.projected})`);

  // Wilde reeks: laatste 100, maar trend zou naar 1000 willen => geklemd op +50% (150).
  const wild = projectNextMonth([{ month: "1", value: 10 }, { month: "2", value: 20 }, { month: "3", value: 500 }, { month: "4", value: 100 }]);
  assert(wild.projected! <= 100 * (1 + TREND_BAND) + 1, `geklemd binnen +${TREND_BAND * 100}% van de laatste maand (${wild.projected})`);
  assert(wild.projected! >= 0, "nooit negatief");
}

console.log("combinatie:");
{
  const f = forecastChannelMetric({
    fullMonths: [{ month: "1", value: 1000 }, { month: "2", value: 1100 }, { month: "3", value: 1200 }],
    mtd: 400, dayOfMonth: 10, daysInMonth: 30,
  });
  assert(f.currentMonthProjected === 1200 && f.currentMonthReliable, "lopende maand geprojecteerd");
  assert(f.nextMonthMethod === "trend" && f.nextMonthProjected! > 1200, "volgende maand via trend, stijgend");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle channel-forecast-tests geslaagd");
