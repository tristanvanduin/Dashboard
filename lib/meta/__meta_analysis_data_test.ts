// Fixture-test voor de DB-naar-compute-mapping (M2 data-laag, laag 1). Deterministisch, geen IO.
// De fetch (laag 2) is live-ongetest en wordt hier bewust niet aangeroepen.
// Draaien: npx tsx lib/meta/__meta_analysis_data_test.ts

import { mapMetaDailyToComputeRow, mapMetaBreakdownToComputeRow, thirteenMonthStart } from "./analysis-data";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function eq(actual: unknown, expected: unknown, label: string): void {
  assert(actual === expected, `${label} (verwacht ${expected}, kreeg ${actual})`);
}

// 1. Daily-mapping: getallen als string (zoals Meta levert), naam los, kolom-hernoeming.
const dbDaily = {
  date: "2026-03-15",
  entity_id: "c1",
  impressions: "1000",
  spend: "50.5",
  link_clicks: "20",
  conversions: "5",
  conversion_value: "500",
  reach: "800",
  frequency: "1.25",
  video_3s_views: "300",
  video_thruplay: "150",
  landing_page_views: "",
  add_to_cart: null,
  initiate_checkout: "10",
};
const mapped = mapMetaDailyToComputeRow(dbDaily, "Campagne 1");
eq(mapped.entity_id, "c1", "entity_id overgenomen");
eq(mapped.entity_name, "Campagne 1", "entity_name los gekoppeld");
eq(mapped.impressions, 1000, "impressions string naar getal");
eq(mapped.spend, 50.5, "spend string naar getal");
eq(mapped.frequency, 1.25, "frequency string naar getal");
eq(mapped.video_thruplays, 150, "video_thruplay naar video_thruplays hernoemd");
eq(mapped.landing_page_views, null, "lege string naar null (funnelveld)");
eq(mapped.add_to_cart, null, "null blijft null");
eq(mapped.initiate_checkout, 10, "initiate_checkout string naar getal");

// 2. Daily-mapping zonder naam: entity_name undefined, telling-velden default 0 bij ontbreken.
const sparse = mapMetaDailyToComputeRow({ date: "2026-03-01", entity_id: "acc" });
eq(sparse.entity_name, undefined, "geen naam meegegeven geeft undefined");
eq(sparse.impressions, 0, "ontbrekende impressions default 0");
eq(sparse.reach, null, "ontbrekende reach default null");

// 3. Breakdown-mapping: value met pipe blijft intact.
const dbBreakdown = { date: "2026-03-15", breakdown_type: "age_gender", breakdown_value: "25-34|female", impressions: "4000", spend: "400", link_clicks: "90", conversions: "15", conversion_value: "3000" };
const mb = mapMetaBreakdownToComputeRow(dbBreakdown);
eq(mb.breakdown_type, "age_gender", "breakdown_type overgenomen");
eq(mb.breakdown_value, "25-34|female", "breakdown_value met pipe intact");
eq(mb.impressions, 4000, "breakdown impressions string naar getal");
eq(mb.conversion_value, 3000, "breakdown conversion_value string naar getal");

// 4. Het 13-maands venster eindigend op periodEnd.
eq(thirteenMonthStart("2026-03-31"), "2025-03-01", "13-maands start voor maart 2026");
eq(thirteenMonthStart("2026-01-31"), "2025-01-01", "13-maands start voor januari 2026 (jaargrens)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
