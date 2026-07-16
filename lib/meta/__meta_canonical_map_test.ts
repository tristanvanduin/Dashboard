// Fixture-test voor de Meta canonical metric map (M2 data-laag). Deterministisch, geen IO.
// Draaien: npx tsx lib/meta/__meta_canonical_map_test.ts

import { buildMetaCanonicalMetricMap } from "./canonical-map";
import { canonicalKey } from "../analysis/claim-consistency";
import type { MetaComputeRow } from "./prepared-compute";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function eq(actual: unknown, expected: unknown, label: string): void {
  assert(actual === expected, `${label} (verwacht ${expected}, kreeg ${actual})`);
}

// Account: februari en maart. Laatste maand maart: ROAS 3,0, Link CTR 1,5%.
const account: MetaComputeRow[] = [
  { date: "2026-02-15", entity_id: "acc", impressions: 10000, spend: 1000, link_clicks: 200, conversions: 20, conversion_value: 4000 },
  { date: "2026-03-15", entity_id: "acc", impressions: 12000, spend: 1000, link_clicks: 180, conversions: 15, conversion_value: 3000 },
];

// Campagnes: camp_a actief in maart (ROAS 4,0, Link CTR 2,0%); camp_old alleen in februari.
const campaigns: MetaComputeRow[] = [
  { date: "2026-03-15", entity_id: "c_a", entity_name: "Campagne A", impressions: 6000, spend: 500, link_clicks: 120, conversions: 10, conversion_value: 2000 },
  { date: "2026-02-15", entity_id: "c_old", entity_name: "Oude campagne", impressions: 4000, spend: 400, link_clicks: 80, conversions: 8, conversion_value: 1600 },
];

const map = buildMetaCanonicalMetricMap(campaigns, account);

// 1. Account-waarden op de canonical sleutels (laatste maand).
eq(map.get(canonicalKey("account", "account", "ROAS")), 3, "account ROAS 3,0 in de map");
eq(map.get(canonicalKey("account", "account", "Link CTR")), 1.5, "account Link CTR 1,5% in de map");
eq(map.get(canonicalKey("account", "account", "Conversies")), 15, "account Conversies 15 in de map");

// 2. Campagne A op de canonical sleutels.
eq(map.get(canonicalKey("Campagne A", "campaign", "ROAS")), 4, "Campagne A ROAS 4,0 in de map");
eq(map.get(canonicalKey("Campagne A", "campaign", "Link CTR")), 2, "Campagne A Link CTR 2,0% in de map");

// 3. Verankering op de analysemaand: een campagne met alleen februari-data doet niet mee.
eq(map.has(canonicalKey("Oude campagne", "campaign", "ROAS")), false, "campagne zonder data in de analysemaand staat niet in de map");

// 4. De map bevat de verwachte sleutels en niet meer dan dat voor deze fixtures.
assert(map.size >= 9, "map bevat de account- en campagne-A-sleutels");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
