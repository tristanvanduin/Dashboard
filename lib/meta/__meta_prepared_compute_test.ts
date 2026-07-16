// Fixture-tests voor de Meta pre-compute (M2 data-laag). Volledig deterministisch, geen IO.
// Kernpunt uit de spec: stap 4 levert per ad hook/hold/CTR/fatigue-flags correct.
// Draaien: npx tsx lib/meta/__meta_prepared_compute_test.ts

import {
  aggregateMonthly,
  computeMoMChain,
  computeVsAverage,
  detectAdFatigue,
  deriveFromRows,
  trendDirection,
  type MetaComputeRow,
} from "./prepared-compute";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function eq(actual: unknown, expected: unknown, label: string): void {
  assert(actual === expected, `${label} (verwacht ${expected}, kreeg ${actual})`);
}

// Helper: bouw daily-rijen voor een entiteit over opeenvolgende dagen in 2026-03.
function days(
  entity_id: string,
  entity_name: string,
  startDay: number,
  count: number,
  impr: number,
  link_clicks: number,
  frequency: number,
  conversions = 0,
  conversion_value = 0
): MetaComputeRow[] {
  const rows: MetaComputeRow[] = [];
  for (let i = 0; i < count; i++) {
    const day = String(startDay + i).padStart(2, "0");
    rows.push({ date: `2026-03-${day}`, entity_id, entity_name, impressions: impr, spend: impr * 0.01, link_clicks, conversions, conversion_value, frequency });
  }
  return rows;
}

// 1. deriveFromRows herberekent afgeleiden uit sommen, niet door ratio's te middelen.
//    Dag 1: 1000 impr, 30 clicks (3%). Dag 2: 3000 impr, 30 clicks (1%). Som: 4000 impr, 60 clicks = 1,5%.
const mixCtr: MetaComputeRow[] = [
  { date: "2026-03-01", entity_id: "a", impressions: 1000, spend: 10, link_clicks: 30, conversions: 3, conversion_value: 300, frequency: 1.2 },
  { date: "2026-03-02", entity_id: "a", impressions: 3000, spend: 30, link_clicks: 30, conversions: 3, conversion_value: 300, frequency: 1.4 },
];
eq(deriveFromRows(mixCtr).link_ctr_pct, 1.5, "link CTR uit sommen (niet gemiddelde van 3% en 1%)");
eq(deriveFromRows(mixCtr).conversions, 6, "conversies gesommeerd");
eq(deriveFromRows(mixCtr).roas, 15, "ROAS uit sommen (600 / 40)");

// 2. aggregateMonthly groepeert op maand en sorteert.
const twoMonths: MetaComputeRow[] = [
  ...days("acc", "Account", 1, 1, 1000, 10, 1.5, 5, 500).map((r) => ({ ...r, date: "2026-02-15" })),
  ...days("acc", "Account", 1, 1, 2000, 40, 1.6, 10, 2000),
];
const agg = aggregateMonthly(twoMonths);
eq(agg.length, 2, "twee maanden geaggregeerd");
eq(agg[0].month, "2026-02", "eerste maand is februari");
eq(agg[1].month, "2026-03", "tweede maand is maart");

// 3. computeMoMChain: laatste versus vorige maand, delta% per KPI in de keten.
const mom = computeMoMChain(agg);
eq(mom.latest_month, "2026-03", "MoM laatste maand");
eq(mom.previous_month, "2026-02", "MoM vorige maand");
const conv = mom.chain.find((c) => c.metric === "Conversies");
assert(conv?.latest === 10 && conv?.previous === 5 && conv?.delta_pct === 100 && conv?.direction === "stijgt", "Conversies MoM plus 100% stijgt");
const ctrFact = mom.chain.find((c) => c.metric === "Link CTR");
assert(ctrFact?.latest === 2 && ctrFact?.previous === 1, "Link CTR laatste 2% versus vorige 1%");

// 4. computeVsAverage: positie boven/onder/gelijk.
eq(computeVsAverage("CPA", 12, 10).position, "boven", "CPA boven gemiddelde");
eq(computeVsAverage("CPA", 8, 10).position, "onder", "CPA onder gemiddelde");
eq(computeVsAverage("CPA", 10, 10).position, "gelijk", "CPA gelijk aan gemiddelde");

// 5. trendDirection: stijgende en dalende reeks.
const rising = [1, 2, 3, 4].map((v, i) => ({ month: `2026-0${i + 1}`, ...deriveFromRows([{ date: `2026-0${i + 1}-01`, entity_id: "x", impressions: 1000, spend: 10, link_clicks: v * 10, conversions: 0, conversion_value: 0, frequency: 1 }]) }));
eq(trendDirection(rising, "link_ctr_pct", 4), "stijgt", "stijgende CTR-trend");

// 6. KERN: stap-4 fatigue-detectie per ad, met de 30%-drempel en de frequency-gate boven 2.5.
//    Ad fatigued: baseline 2,0% (dag 1-7), recent 1,0% (dag 8-14, -50%), frequency 3,0 -> fatigue.
const adFatigued = [...days("ad_fatigue", "Vermoeide ad", 1, 7, 1000, 20, 1.5), ...days("ad_fatigue", "Vermoeide ad", 8, 7, 1000, 10, 3.0)];
//    Ad stabiel: baseline 1,5%, recent 1,5%, frequency 3,0 -> geen fatigue (CTR daalt niet).
const adStable = [...days("ad_stable", "Stabiele ad", 1, 7, 1000, 15, 1.5), ...days("ad_stable", "Stabiele ad", 8, 7, 1000, 15, 3.0)];
//    Ad drop maar lage frequency: baseline 2,0%, recent 1,0%, frequency 2,0 -> geen fatigue (gate).
const adLowFreq = [...days("ad_lowfreq", "Lage frequency", 1, 7, 1000, 20, 1.5), ...days("ad_lowfreq", "Lage frequency", 8, 7, 1000, 10, 2.0)];

const fatigueFacts = detectAdFatigue([...adFatigued, ...adStable, ...adLowFreq]);
const f = (id: string) => fatigueFacts.find((x) => x.entity_id === id);

eq(f("ad_fatigue")?.fatigue, true, "vermoeide ad: fatigue true");
eq(f("ad_fatigue")?.baseline_link_ctr_pct, 2, "vermoeide ad: baseline link CTR 2%");
eq(f("ad_fatigue")?.recent_link_ctr_pct, 1, "vermoeide ad: recente link CTR 1%");
eq(f("ad_fatigue")?.ctr_change_pct, -50, "vermoeide ad: CTR-daling -50%");
eq(f("ad_fatigue")?.recent_frequency, 3, "vermoeide ad: recente frequency 3,0");
eq(f("ad_fatigue")?.days_live, 14, "vermoeide ad: 14 dagen live");

eq(f("ad_stable")?.fatigue, false, "stabiele ad: geen fatigue (CTR daalt niet)");
eq(f("ad_lowfreq")?.fatigue, false, "lage frequency: geen fatigue (frequency-gate onder 2,5)");
eq(f("ad_lowfreq")?.ctr_change_pct, -50, "lage frequency: CTR daalt wel -50% maar gate blokkeert fatigue");

// 7. Lege en eendaagse reeksen breken niet.
eq(computeMoMChain([]).chain.length, 0, "lege reeks geeft lege keten");
eq(detectAdFatigue([]).length, 0, "geen ad-rijen geeft geen facts");
const oneDay = detectAdFatigue(days("ad_one", "Eendaags", 1, 1, 1000, 20, 3.0));
eq(oneDay[0]?.fatigue, false, "eendaagse ad: geen fatigue (baseline en recent gelijk)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
