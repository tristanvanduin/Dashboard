/**
 * Tests for dimension availability logic.
 * Run with: npx tsx lib/__tests__/dimension-availability.test.ts
 */

import {
  evaluateSopSections,
  isDimensionAvailable,
  getAvailableDimensions,
  buildAvailabilitySummary,
  type ClientDimensionProfile,
  type DimensionStatus,
} from "../analysis/dimension-availability";
import type { DimensionName } from "../types/dimensional";

// ── Test helpers ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label}`);
  }
}

function buildProfile(available: DimensionName[]): ClientDimensionProfile {
  const dimensions = new Map<DimensionName, DimensionStatus>();
  for (const dim of available) {
    dimensions.set(dim, {
      dimension: dim,
      isAvailable: true,
      rowCount: 100,
      latestMonth: "2026-03-01",
      earliestMonth: "2025-03-01",
      monthsAvailable: 13,
      isPartial: false,
      dataSource: "google_ads",
      notes: null,
    });
  }
  // Add unavailable GA4 dimensions
  for (const dim of ["engagement_metrics", "checkout_metrics"] as DimensionName[]) {
    dimensions.set(dim, {
      dimension: dim,
      isAvailable: false,
      rowCount: 0,
      latestMonth: null,
      earliestMonth: null,
      monthsAvailable: 0,
      isPartial: false,
      dataSource: "ga4_required",
      notes: "Requires GA4",
    });
  }
  return { clientId: "test-client", dimensions, fetchedAt: new Date().toISOString() };
}

// ── Tests ──────────────────────────────────────────────────────────────────

console.log("\n=== Dimension Availability Tests ===\n");

// Test 1: isDimensionAvailable
console.log("1. isDimensionAvailable");
{
  const profile = buildProfile(["account_monthly", "campaign_monthly"]);
  assert(isDimensionAvailable(profile, "account_monthly") === true, "account_monthly should be available");
  assert(isDimensionAvailable(profile, "campaign_monthly") === true, "campaign_monthly should be available");
  assert(isDimensionAvailable(profile, "device_performance") === false, "device_performance should NOT be available");
  assert(isDimensionAvailable(profile, "engagement_metrics") === false, "engagement_metrics (GA4) should NOT be available");
}

// Test 2: getAvailableDimensions
console.log("2. getAvailableDimensions");
{
  const profile = buildProfile(["account_monthly", "campaign_monthly", "keyword_performance"]);
  const avail = getAvailableDimensions(profile);
  assert(avail.length === 3, `should have 3 available dimensions, got ${avail.length}`);
  assert(avail.includes("account_monthly"), "should include account_monthly");
  assert(avail.includes("keyword_performance"), "should include keyword_performance");
}

// Test 3: evaluateSopSections — full coverage
console.log("3. evaluateSopSections — full Google Ads coverage");
{
  const allDims: DimensionName[] = [
    "account_monthly", "account_weekly", "campaign_monthly", "adgroup_monthly",
    "impression_share", "search_terms_wasteful", "keyword_performance",
    "search_terms_monthly", "product_performance", "device_performance",
    "geo_performance", "network_performance", "creative_performance",
    "asset_group_performance", "audience_performance", "ad_schedule_performance",
  ];
  const profile = buildProfile(allDims);
  const sections = evaluateSopSections(profile, "monthly");

  const supported = sections.filter((s) => s.support === "supported");
  const unsupported = sections.filter((s) => s.support === "unsupported");

  // Engagement & Checkout always unsupported (GA4)
  assert(unsupported.length === 1, `should have 1 unsupported section (Engagement & Checkout), got ${unsupported.length}`);
  assert(unsupported[0]?.name === "Engagement & Checkout", `unsupported should be Engagement & Checkout, got ${unsupported[0]?.name}`);
  assert(supported.length >= 11, `should have ≥11 supported monthly sections, got ${supported.length}`);
}

// Test 4: evaluateSopSections — minimal coverage
console.log("4. evaluateSopSections — minimal coverage (only core tables)");
{
  const coreDims: DimensionName[] = [
    "account_monthly", "account_weekly", "campaign_monthly",
    "adgroup_monthly", "search_terms_wasteful",
  ];
  const profile = buildProfile(coreDims);
  const sections = evaluateSopSections(profile, "monthly");

  const supported = sections.filter((s) => s.support === "supported");
  const unsupported = sections.filter((s) => s.support === "unsupported");

  // Core sections should work
  assert(supported.some((s) => s.name === "Account Performance"), "Account Performance should be supported");
  assert(supported.some((s) => s.name === "Campaign Performance"), "Campaign Performance should be supported");
  assert(supported.some((s) => s.name === "Ad Group Performance"), "Ad Group Performance should be supported");
  assert(supported.some((s) => s.name === "Search Term Performance"), "Search Term Performance should be supported");

  // New dimensions should be unsupported
  assert(unsupported.some((s) => s.name === "Keyword Performance"), "Keyword Performance should be unsupported");
  assert(unsupported.some((s) => s.name === "Product Performance"), "Product Performance should be unsupported");
  assert(unsupported.some((s) => s.name === "Device Performance"), "Device Performance should be unsupported");
  assert(unsupported.some((s) => s.name === "Geographic Performance"), "Geographic Performance should be unsupported");
}

// Test 5: evaluateSopSections — weekly
console.log("5. evaluateSopSections — weekly");
{
  const profile = buildProfile(["account_weekly", "search_terms_wasteful", "campaign_monthly"]);
  const sections = evaluateSopSections(profile, "weekly");
  assert(sections.length === 3, `weekly should have 3 sections, got ${sections.length}`);
  const allSupported = sections.every((s) => s.support === "supported");
  assert(allSupported, "all weekly core sections should be supported with basic data");
}

// Test 6: evaluateSopSections — biweekly with device gap
console.log("6. evaluateSopSections — biweekly (device missing)");
{
  const profile = buildProfile(["account_monthly", "account_weekly", "campaign_monthly", "adgroup_monthly"]);
  const sections = evaluateSopSections(profile, "biweekly");
  const deviceSection = sections.find((s) => s.name === "Device & Engagement");
  assert(deviceSection !== undefined, "Device & Engagement section should exist");
  assert(deviceSection?.support === "unsupported", `Device & Engagement should be unsupported, got ${deviceSection?.support}`);
  assert(deviceSection?.missingRequired.includes("device_performance") ?? false, "should list device_performance as missing");
}

// Test 7: buildAvailabilitySummary output
console.log("7. buildAvailabilitySummary");
{
  const profile = buildProfile(["account_monthly", "account_weekly", "campaign_monthly"]);
  const summary = buildAvailabilitySummary(profile, "monthly");
  assert(summary.includes("Beschikbare analysedimensies"), "should contain header");
  assert(summary.includes("Niet beschikbaar"), "should contain unsupported section");
  assert(summary.includes("Doe GEEN uitspraken"), "should contain warning");
}

// Test 8: empty profile
console.log("8. Empty profile (no data at all)");
{
  const profile: ClientDimensionProfile = {
    clientId: "empty",
    dimensions: new Map(),
    fetchedAt: new Date().toISOString(),
  };
  const sections = evaluateSopSections(profile, "monthly");
  const allUnsupported = sections.every((s) => s.support === "unsupported");
  assert(allUnsupported, "all sections should be unsupported with no data");
}

// ── Results ────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
