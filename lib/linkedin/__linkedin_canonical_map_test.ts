// Test voor de LinkedIn canonical metric map (L2). Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__linkedin_canonical_map_test.ts

import { buildLinkedinCanonicalMetricMap } from "./canonical-map";
import { canonicalKey } from "@/lib/analysis/claim-consistency";
import type { LinkedInComputeRow } from "./prepared-compute";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function row(date: string, urn: string, impressions: number, clicks: number, spend: number, leads: number, name?: string): LinkedInComputeRow {
  return { date, entityUrn: urn, entityName: name, impressions, clicks, spend, leads, form_opens: 0, conversions: 0, conversion_value: 0 };
}

// Account: februari en maart; maart is de analysemaand, CPL = 600/20 = 30, CTR = 300/12000 = 2,5%
const account: LinkedInComputeRow[] = [
  row("2026-02-15", "acct", 8000, 200, 400, 10),
  row("2026-03-15", "acct", 12000, 300, 600, 20),
];
// c1 heeft data in de analysemaand (maart), CPL = 300/12 = 25
// c2 heeft alleen oudere data (januari) en moet wegvallen door de ankering op maart
const campaigns: LinkedInComputeRow[] = [
  row("2026-03-15", "urn:li:sponsoredCampaign:1", 6000, 150, 300, 12, "Campagne 1"),
  row("2026-01-15", "urn:li:sponsoredCampaign:2", 5000, 100, 100, 2, "Campagne 2"),
];

const map = buildLinkedinCanonicalMetricMap(campaigns, account);

// Account-KPI's onder de canonicalKey met LinkedIn-namen
assert(map.get(canonicalKey("account", "account", "CPL")) === 30, "account-CPL geankerd op maart (600/20)");
assert(map.get(canonicalKey("account", "account", "CTR")) === 2.5, "account-CTR in procenten");
assert(map.get(canonicalKey("account", "account", "Leads")) === 20, "account-Leads");
assert(map.get(canonicalKey("account", "account", "Spend")) === 600, "account-Spend");

// Campagne in de analysemaand aanwezig
assert(map.get(canonicalKey("Campagne 1", "campaign", "CPL")) === 25, "campagne 1 CPL (300/12) aanwezig");
assert(map.has(canonicalKey("Campagne 1", "campaign", "CTR")), "campagne 1 CTR aanwezig");

// Campagne met alleen oudere data valt weg door de ankering
assert(!map.has(canonicalKey("Campagne 2", "campaign", "CPL")), "campagne met alleen oudere data valt weg");

// Geen ROAS-sleutel: LinkedIn is leadgen, CPL leidt
assert(!map.has(canonicalKey("account", "account", "ROAS")), "geen ROAS in de LinkedIn canonical map");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
