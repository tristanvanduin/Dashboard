// Test voor de LinkedIn demografie-transform, coverage_pct en DB-rij-mapping (L1).
// Deterministisch, geen IO. Draaien: npx tsx lib/linkedin/__linkedin_rows_test.ts

import { mapDemographicElement, buildCoverageSummaryRow } from "./transform";
import { linkedinDailyToDbRow, linkedinDemographicToDbRow, LINKEDIN_DAILY_CONFLICT, LINKEDIN_DEMOGRAPHIC_CONFLICT } from "./rows";
import type { LinkedInAnalyticsElement, LinkedInDailyRow, LinkedInDemographicRow } from "./types";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function approx(a: number | null, b: number, label: string): void {
  assert(a != null && Math.abs(a - b) < 1e-6, `${label} (kreeg ${a}, verwacht ${b})`);
}

const meta = { level: "CAMPAIGN", entityUrn: "urn:li:sponsoredCampaign:1", pivotType: "MEMBER_JOB_FUNCTION" as const };

// mapDemographicElement: element naar segmentrij
const segEl: LinkedInAnalyticsElement = {
  dateRange: { start: { year: 2026, month: 3, day: 1 } },
  pivotValues: ["urn:li:function:4"],
  impressions: 300,
  clicks: 6,
  costInLocalCurrency: "12.50",
  oneClickLeads: 2,
  externalWebsiteConversions: 1,
};
const seg = mapDemographicElement(segEl, meta);
assert(seg.pivotValueUrn === "urn:li:function:4", "segment-URN uit pivotValues");
assert(seg.pivotType === "MEMBER_JOB_FUNCTION", "pivot_type overgenomen");
assert(seg.impressions === 300 && seg.clicks === 6 && seg.leads === 2 && seg.conversions === 1, "segment-metrics overgenomen");
approx(seg.spend, 12.5, "segment-spend geparsed");
assert(seg.coveragePct === null, "segmentrij draagt geen coverage_pct");

// coverage_pct met onderdrukte segmenten: drie zichtbare segmenten sommeren tot 700
// impressies, terwijl de dag in totaal 1000 had; de rest is privacy-onderdrukt.
const segments: LinkedInDemographicRow[] = [
  { date: "2026-03-01", level: "CAMPAIGN", entityUrn: "urn:li:sponsoredCampaign:1", pivotType: "MEMBER_JOB_FUNCTION", pivotValueUrn: "urn:li:function:4", impressions: 300, clicks: 6, spend: 12.5, leads: 2, conversions: 1, coveragePct: null },
  { date: "2026-03-01", level: "CAMPAIGN", entityUrn: "urn:li:sponsoredCampaign:1", pivotType: "MEMBER_JOB_FUNCTION", pivotValueUrn: "urn:li:function:8", impressions: 250, clicks: 5, spend: 10, leads: 1, conversions: 0, coveragePct: null },
  { date: "2026-03-01", level: "CAMPAIGN", entityUrn: "urn:li:sponsoredCampaign:1", pivotType: "MEMBER_JOB_FUNCTION", pivotValueUrn: "urn:li:function:13", impressions: 150, clicks: 2, spend: null, leads: 0, conversions: 0, coveragePct: null },
];
const summary = buildCoverageSummaryRow(segments, 1000, { date: "2026-03-01", ...meta });
assert(summary.pivotValueUrn === "TOTAL", "samenvattingsrij heeft pivot_value_urn TOTAL");
assert(summary.impressions === 700, "som van de zichtbare segment-impressies");
approx(summary.coveragePct, 0.7, "coverage_pct = 700/1000");
approx(summary.spend, 22.5, "spend somt alleen de niet-null segmenten");
assert(summary.leads === 3 && summary.clicks === 13, "leads en clicks gesommeerd");

// Volledige dekking en nul-totaal
const full = buildCoverageSummaryRow(segments, 700, { date: "2026-03-01", ...meta });
approx(full.coveragePct, 1, "volledige dekking geeft 1");
const zero = buildCoverageSummaryRow(segments, 0, { date: "2026-03-01", ...meta });
assert(zero.coveragePct === null, "nul-totaal geeft null coverage_pct");

// DB-mapping: snake_case kolommen, conversion_value ENKELVOUD
const dailyRow: LinkedInDailyRow = {
  date: "2026-03-01", entityUrn: "urn:li:sponsoredCampaign:1", impressions: 10000, clicks: 200, spend: 400,
  ctr: 0.02, cpc: 2, cpm: 40, landingPageClicks: 180, oneClickLeadFormOpens: 50, oneClickLeads: 10,
  externalWebsiteConversions: 8, postClickConversions: 6, conversionValue: 1200, cpl: 40, formCompletionRate: 0.2,
  videoStarts: 0, videoViews: 0, videoCompletions: 0, videoCompletionRate: null, totalEngagements: 30,
  follows: 3, reactions: 12, comments: 2, shares: 1,
};
const db = linkedinDailyToDbRow(dailyRow, "client-9");
assert(db.client_id === "client-9", "client_id gezet");
assert(db.entity_urn === "urn:li:sponsoredCampaign:1", "entity_urn kolom");
assert("conversion_value" in db && !("conversions_value" in db), "conversion_value is ENKELVOUD");
assert(db.one_click_leads === 10 && db.form_completion_rate === 0.2, "leadgen-kolommen gemapt");
assert(db.landing_page_clicks === 180 && db.post_click_conversions === 6, "snake_case kolommen gemapt");

const demoDb = linkedinDemographicToDbRow(summary, "client-9");
assert(demoDb.pivot_type === "MEMBER_JOB_FUNCTION" && demoDb.pivot_value_urn === "TOTAL", "demografie-kolommen gemapt");
assert(demoDb.coverage_pct === 0.7, "coverage_pct kolom gezet");

// Conflict-sleutels matchen het LONG-format
assert(LINKEDIN_DAILY_CONFLICT === "client_id,date,entity_urn", "daily conflict-sleutel");
assert(LINKEDIN_DEMOGRAPHIC_CONFLICT.includes("pivot_type") && LINKEDIN_DEMOGRAPHIC_CONFLICT.includes("pivot_value_urn"), "demografie conflict-sleutel bevat pivot-kolommen");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
