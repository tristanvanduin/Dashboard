// Test voor de LinkedIn ICP-fit pre-compute (L2 kernstap). Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__linkedin_icp_test.ts

import { computeIcpFitForPivot, computeIcpFit, isIcpEmpty, type LinkedInIcp } from "./icp-fit";
import type { LinkedInDemographicRow } from "./types";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function approx(a: number | null, b: number, label: string): void {
  assert(a != null && Math.abs(a - b) < 1e-6, `${label} (kreeg ${a}, verwacht ${b})`);
}

function seg(urn: string, spend: number | null, leads: number, coverage: number | null = null): LinkedInDemographicRow {
  return {
    date: "2026-03-01", level: "CAMPAIGN", entityUrn: "urn:li:sponsoredCampaign:1",
    pivotType: "MEMBER_JOB_FUNCTION", pivotValueUrn: urn, impressions: 0, clicks: 0,
    spend, leads, conversions: 0, coveragePct: coverage,
  };
}

const segments: LinkedInDemographicRow[] = [
  seg("urn:li:function:4", 300, 6),   // in ICP
  seg("urn:li:function:8", 200, 4),   // in ICP
  seg("urn:li:function:13", 100, 1),  // niet-ICP
  seg("urn:li:function:25", 150, 1),  // niet-ICP, grootste waste
  seg("TOTAL", 750, 12, 0.75),        // samenvattingsrij met coverage
];
const icpUrns = ["urn:li:function:4", "urn:li:function:8"];
const fit = computeIcpFitForPivot(segments, "MEMBER_JOB_FUNCTION", icpUrns);

assert(!fit.degraded, "niet gedegradeerd met ingevulde ICP");
approx(fit.spendInIcpPct, 0.6667, "aandeel spend binnen ICP");
approx(fit.leadsInIcpPct, 0.8333, "aandeel leads binnen ICP");
approx(fit.wasteSpend, 250, "waste = spend op niet-ICP segmenten");
approx(fit.icpCpl, 50, "ICP-CPL = ICP-spend / ICP-leads");
approx(fit.nonIcpCpl, 125, "niet-ICP CPL = waste / niet-ICP leads");
assert(fit.largestWasteSegment?.urn === "urn:li:function:25", "grootste waste-segment correct");
approx(fit.largestWasteSegment?.spend ?? null, 150, "grootste waste-segment spend");
approx(fit.coveragePct, 0.75, "coverage_pct uit de TOTAL-rij");
approx(fit.totalSpend, 750, "totale spend over zichtbare segmenten");
assert(fit.totalLeads === 12, "totale leads");

// TOTAL en UNKNOWN tellen niet als segment mee
const withUnknown = [...segments, seg("UNKNOWN", 999, 99)];
const fit2 = computeIcpFitForPivot(withUnknown, "MEMBER_JOB_FUNCTION", icpUrns);
approx(fit2.totalSpend, 750, "UNKNOWN telt niet mee in de totalen");

// Lege ICP degradeert naar beschrijvend (geen fit-score), zonder te falen
const degraded = computeIcpFitForPivot(segments, "MEMBER_JOB_FUNCTION", []);
assert(degraded.degraded, "lege ICP degradeert");
assert(degraded.spendInIcpPct === null && degraded.leadsInIcpPct === null, "geen fit-score bij lege ICP");
assert(degraded.wasteSpend === 0 && degraded.largestWasteSegment === null, "geen waste-classificatie zonder ICP");
approx(degraded.totalSpend, 750, "totalen blijven beschrijvend beschikbaar");
approx(degraded.coveragePct, 0.75, "coverage blijft beschikbaar bij degradatie");

// isIcpEmpty
const emptyIcp: LinkedInIcp = { job_functions: [], seniorities: [], industries: [], company_sizes: [] };
assert(isIcpEmpty(emptyIcp), "lege ICP-definitie herkend");
assert(isIcpEmpty(null), "null ICP herkend als leeg");
assert(!isIcpEmpty({ job_functions: ["urn:li:function:4"], seniorities: [], industries: [], company_sizes: [] }), "gedeeltelijk ingevulde ICP is niet leeg");

// computeIcpFit over meerdere pivots
const multi: LinkedInDemographicRow[] = [
  ...segments,
  { date: "2026-03-01", level: "CAMPAIGN", entityUrn: "urn:li:sponsoredCampaign:1", pivotType: "MEMBER_SENIORITY", pivotValueUrn: "urn:li:seniority:5", impressions: 0, clicks: 0, spend: 400, leads: 8, conversions: 0, coveragePct: null },
  { date: "2026-03-01", level: "CAMPAIGN", entityUrn: "urn:li:sponsoredCampaign:1", pivotType: "MEMBER_SENIORITY", pivotValueUrn: "urn:li:seniority:1", impressions: 0, clicks: 0, spend: 100, leads: 1, conversions: 0, coveragePct: null },
];
const fits = computeIcpFit(multi, { job_functions: icpUrns, seniorities: ["urn:li:seniority:5"], industries: [], company_sizes: [] });
assert(fits.length === 2, "een fit-resultaat per aanwezige ICP-pivot");
const seniorityFit = fits.find((f) => f.pivotType === "MEMBER_SENIORITY");
approx(seniorityFit?.spendInIcpPct ?? null, 400 / 500, "senioriteit-fit berekend over de juiste pivot");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
