// Test voor de LinkedIn adAnalytics-transform (L1). Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__linkedin_transform_test.ts

import { parseNum, dateRangeToIso, mergeFieldSets, mapAnalyticsElement } from "./transform";
import type { LinkedInAnalyticsElement } from "./types";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function approx(a: number | null, b: number, label: string): void {
  assert(a != null && Math.abs(a - b) < 1e-6, `${label} (kreeg ${a}, verwacht ${b})`);
}

// parseNum
assert(parseNum(42) === 42, "parseNum getal");
assert(parseNum("3.14") === 3.14, "parseNum numerieke string");
assert(parseNum("") === null, "parseNum lege string geeft null");
assert(parseNum("n/a") === null, "parseNum niet-numeriek geeft null");
assert(parseNum(null) === null, "parseNum null geeft null");

// dateRangeToIso
assert(dateRangeToIso({ start: { year: 2026, month: 3, day: 7 } }) === "2026-03-07", "datumconversie met padding");
assert(dateRangeToIso({ start: { year: 2026, month: 11, day: 25 } }) === "2026-11-25", "datumconversie tweecijferig");
assert(dateRangeToIso(undefined) === null, "ontbrekende dateRange geeft null");

// mergeFieldSets: twee veldensets van hetzelfde segment op dezelfde dag
const setA: LinkedInAnalyticsElement[] = [
  { dateRange: { start: { year: 2026, month: 3, day: 1 } }, pivotValues: ["urn:li:c:1"], impressions: 1000, clicks: 20 },
];
const setB: LinkedInAnalyticsElement[] = [
  { dateRange: { start: { year: 2026, month: 3, day: 1 } }, pivotValues: ["urn:li:c:1"], impressions: 9999, oneClickLeads: 5 },
  { dateRange: { start: { year: 2026, month: 3, day: 2 } }, pivotValues: ["urn:li:c:1"], impressions: 500 },
];
const merged = mergeFieldSets(setA, setB);
assert(merged.length === 2, "merge levert twee unieke dag-entiteit-rijen");
const day1 = merged.find((e) => dateRangeToIso(e.dateRange) === "2026-03-01");
assert(day1?.impressions === 1000, "set A wint bij conflict (impressions blijft 1000)");
assert(day1?.clicks === 20, "veld uit set A blijft staan");
assert(day1?.oneClickLeads === 5, "set B vult ontbrekend veld (oneClickLeads) aan");
const day2 = merged.find((e) => dateRangeToIso(e.dateRange) === "2026-03-02");
assert(day2?.impressions === 500, "B-only element toegevoegd");

// mapAnalyticsElement: afgeleide metrics
const el: LinkedInAnalyticsElement = {
  dateRange: { start: { year: 2026, month: 3, day: 1 } },
  pivotValues: ["urn:li:sponsoredCampaign:123"],
  impressions: 10000,
  clicks: 200,
  costInLocalCurrency: "400.00",
  oneClickLeadFormOpens: 50,
  oneClickLeads: 10,
  videoStarts: 800,
  videoViews: 600,
  videoCompletions: 200,
};
const row = mapAnalyticsElement(el);
assert(row.date === "2026-03-01", "rij-datum");
assert(row.entityUrn === "urn:li:sponsoredCampaign:123", "rij-entiteit uit pivotValues");
assert(row.impressions === 10000 && row.clicks === 200, "tellingen overgenomen");
approx(row.spend, 400, "spend geparsed uit string");
approx(row.ctr, 0.02, "ctr = clicks/impressions");
approx(row.cpc, 2, "cpc = spend/clicks");
approx(row.cpm, 40, "cpm = spend/impressions*1000");
approx(row.cpl, 40, "cpl = spend/leads");
approx(row.formCompletionRate, 0.2, "form_completion_rate = leads/form_opens");
approx(row.videoCompletionRate, 0.25, "video_completion_rate = completions/starts");

// Nul-delingen geven null, geen Infinity of NaN
const empty: LinkedInAnalyticsElement = {
  dateRange: { start: { year: 2026, month: 3, day: 2 } },
  pivotValues: ["urn:li:sponsoredCampaign:124"],
  impressions: 0,
  clicks: 0,
  costInLocalCurrency: 0,
  oneClickLeadFormOpens: 0,
  oneClickLeads: 0,
};
const emptyRow = mapAnalyticsElement(empty);
assert(emptyRow.ctr === null, "ctr bij 0 impressies geeft null");
assert(emptyRow.cpc === null, "cpc bij 0 clicks geeft null");
assert(emptyRow.cpm === null, "cpm bij 0 impressies geeft null");
assert(emptyRow.cpl === null, "cpl bij 0 leads geeft null");
assert(emptyRow.formCompletionRate === null, "form_completion_rate bij 0 form_opens geeft null");
assert(emptyRow.videoCompletionRate === null, "video_completion_rate bij 0 starts geeft null");
assert(emptyRow.impressions === 0 && emptyRow.clicks === 0, "tellingen blijven 0, niet null");

// conversion_value is nullable: ontbrekend geeft null
assert(mapAnalyticsElement({ pivotValues: ["x"], impressions: 1 }).conversionValue === null, "conversion_value ontbrekend geeft null");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
