// Test voor de LinkedIn analysis-data mappings (L2). Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__linkedin_analysis_data_test.ts

import { mapLinkedinDailyToComputeRow, mapLinkedinDemographicToComputeRow, thirteenMonthStart } from "./analysis-data";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// mapLinkedinDailyToComputeRow: de kolom-hernoemingen
const dailyDbRow = {
  client_id: "client-9",
  date: "2026-03-15",
  entity_urn: "urn:li:sponsoredCampaign:1",
  impressions: 10000,
  clicks: 200,
  spend: 400,
  one_click_leads: 12,
  one_click_lead_form_opens: 60,
  external_website_conversions: 8,
  conversion_value: 1200,
};
const computeRow = mapLinkedinDailyToComputeRow(dailyDbRow, "Campagne 1");
assert(computeRow.date === "2026-03-15", "datum overgenomen");
assert(computeRow.entityUrn === "urn:li:sponsoredCampaign:1", "entity_urn naar entityUrn");
assert(computeRow.entityName === "Campagne 1", "naam meegegeven");
assert(computeRow.impressions === 10000 && computeRow.clicks === 200 && computeRow.spend === 400, "basis-metrics overgenomen");
assert(computeRow.leads === 12, "one_click_leads naar leads");
assert(computeRow.form_opens === 60, "one_click_lead_form_opens naar form_opens");
assert(computeRow.conversions === 8, "external_website_conversions naar conversions");
assert(computeRow.conversion_value === 1200, "conversion_value overgenomen");

// Ontbrekende velden worden 0
const sparse = mapLinkedinDailyToComputeRow({ date: "2026-03-01", entity_urn: "x", impressions: 100 });
assert(sparse.leads === 0 && sparse.form_opens === 0 && sparse.conversions === 0, "ontbrekende tellingen worden 0");
assert(sparse.entityName === null, "geen naam geeft null");

// mapLinkedinDemographicToComputeRow
const demoDbRow = {
  date: "2026-03-15",
  level: "CAMPAIGN",
  entity_urn: "urn:li:sponsoredCampaign:1",
  pivot_type: "MEMBER_JOB_FUNCTION",
  pivot_value_urn: "urn:li:function:4",
  impressions: 300,
  clicks: 6,
  spend: 12.5,
  leads: 2,
  conversions: 1,
  coverage_pct: 0.8,
};
const demoRow = mapLinkedinDemographicToComputeRow(demoDbRow);
assert(demoRow.pivotType === "MEMBER_JOB_FUNCTION" && demoRow.pivotValueUrn === "urn:li:function:4", "demografie pivot en value gemapt");
assert(demoRow.spend === 12.5 && demoRow.leads === 2, "demografie-metrics gemapt");
assert(demoRow.coveragePct === 0.8, "coverage_pct naar coveragePct");
// Null spend en coverage blijven null
const demoNull = mapLinkedinDemographicToComputeRow({ date: "2026-03-15", level: "CAMPAIGN", entity_urn: "x", pivot_type: "MEMBER_SENIORITY", pivot_value_urn: "TOTAL", impressions: 700, clicks: 10, spend: null, leads: 5, conversions: 0, coverage_pct: null });
assert(demoNull.spend === null && demoNull.coveragePct === null, "null spend en coverage blijven null");

// thirteenMonthStart: eerste dag van de maand 13 maanden terug
assert(thirteenMonthStart("2026-03-31") === "2025-03-01", "13 maanden voor maart 2026 is maart 2025");
assert(thirteenMonthStart("2026-01-31") === "2025-01-01", "jaargrens correct");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
