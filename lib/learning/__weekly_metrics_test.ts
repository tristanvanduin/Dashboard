// Test voor de metriek-aggregator van de H1-evaluator. Deterministisch, geen IO.
// Draaien: npx tsx lib/learning/__weekly_metrics_test.ts

import { aggregateWeeks, weeksInWindow, isDerivableMetric, addDays, type WeeklyRow } from "./weekly-metrics";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function week(week_start: string, cost: number, conversions: number, impressions = 10000, clicks = 500, conversions_value = 0): WeeklyRow {
  return { week_start, cost, conversions, impressions, clicks, conversions_value };
}

// ── DE VALKUIL: ratio's uit totalen, niet uit gemiddelde weekratio's ──
// Week 1: 900 kosten op 3 conversies is CPA 300. Week 2: 100 kosten op 97 conversies is
// CPA ruim 1. Het gemiddelde van die twee weekratio's is ongeveer 150; de eerlijke
// periode-CPA is 10. Een factor 15 verschil, en precies de fout die de tabel uitlokt
// doordat hij cost_per_conversion per week kant-en-klaar aanbiedt.
const scheef = aggregateWeeks([week("2026-06-01", 900, 3), week("2026-06-08", 100, 97)]);
assert(scheef.cpa === 10, "de CPA komt uit totalen (1000 gedeeld door 100), niet uit het gemiddelde van de weekelijkse CPA's");
assert(scheef.cost === 1000 && scheef.conversions === 100, "de totalen tellen gewoon op");

const ratios = aggregateWeeks([week("2026-06-01", 500, 10, 20000, 1000, 2000), week("2026-06-08", 500, 10, 20000, 1000, 3000)]);
assert(ratios.ctr === 0.05 && ratios.cpc === 0.5, "CTR en CPC komen uit de totalen: 2000 klikken op 40000 impressies is 0,05");
assert(ratios.roas === 5 && ratios.conversion_rate === 0.01, "ROAS en conversieratio ook: 5000 waarde op 1000 kosten is 5");
assert(ratios.cpa === 50, "en de CPA");

// ── Een ratio met noemer nul ONTBREEKT, want nul suggereert een meting ──
const geenConversies = aggregateWeeks([week("2026-06-01", 500, 0)]);
assert(!("cpa" in geenConversies), "zonder conversies bestaat er geen CPA; het veld ontbreekt in plaats van nul te zijn");
assert(geenConversies.conversions === 0, "de teller zelf is wel gewoon nul");
const geenKlikken = aggregateWeeks([week("2026-06-01", 500, 0, 10000, 0)]);
assert(!("cpc" in geenKlikken) && !("conversion_rate" in geenKlikken), "zonder klikken geen CPC en geen conversieratio");
const geenImpressies = aggregateWeeks([week("2026-06-01", 0, 0, 0, 0)]);
assert(!("ctr" in geenImpressies) && !("roas" in geenImpressies), "zonder impressies geen CTR, zonder kosten geen ROAS");
assert(Object.keys(aggregateWeeks([])).length === 0, "een leeg venster levert een leeg record, geen nullen");

// ── Wat is afleidbaar ──
assert(isDerivableMetric("cpa") && isDerivableMetric("roas") && isDerivableMetric("ctr"), "de kernmetrics zijn afleidbaar uit de weekdata");
assert(!isDerivableMetric("impression_share"), "impressie-aandeel zit NIET in de weektabel: een hypothese daarover is op dit niveau onmeetbaar en dat moet de evaluator eerlijk zeggen");
assert(!isDerivableMetric("quality_score"), "quality score evenmin");

// ── Het half-open venster ──
const weken = [week("2026-05-25", 100, 5), week("2026-06-01", 100, 5), week("2026-06-08", 100, 5), week("2026-06-15", 100, 5)];
const venster = weeksInWindow(weken, new Date("2026-06-01"), new Date("2026-06-15"));
assert(venster.length === 2 && venster[0].week_start === "2026-06-01", "het venster is half-open: de startweek telt mee, de eindweek niet");
assert(weeksInWindow(weken, new Date("2026-06-15"), new Date("2026-06-22")).length === 1, "een venster van een week pakt precies die week");
assert(weeksInWindow(weken, new Date("2026-07-01"), new Date("2026-07-08")).length === 0, "een venster zonder data levert niets");
assert(addDays(new Date("2026-06-01"), -28).toISOString().slice(0, 10) === "2026-05-04", "addDays rekent terug over maandgrenzen heen");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
