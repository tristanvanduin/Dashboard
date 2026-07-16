// Test voor de cluster-fix (M2): Meta-clusters parsen via de IssueClusterEnum-unie, en de
// validClusters pass-through in canonicalize behoudt het eigen kanaal-cluster. Zonder validClusters
// (het Google-pad) blijft het bestaande CLUSTER_ALIASES-gedrag intact. Geen live data.
// Draaien: npx tsx lib/analysis/__meta_cluster_validation_test.ts

import { canonicalizeFindings } from "./canonicalize";
import { IssueClusterEnum } from "../schema/analysis-schema";
import { metaAdsAdapter } from "./adapters/meta-ads";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// 1. Meta-clusters zijn geldig in de enum-unie, Google blijft geldig, onzin faalt.
assert(IssueClusterEnum.safeParse("creative_fatigue").success, "creative_fatigue geldig in IssueClusterEnum");
assert(IssueClusterEnum.safeParse("hook_dropoff").success, "hook_dropoff geldig in IssueClusterEnum");
assert(IssueClusterEnum.safeParse("frequency_saturation").success, "frequency_saturation geldig in IssueClusterEnum");
assert(IssueClusterEnum.safeParse("tracking_cvr_drop").success, "Google-cluster tracking_cvr_drop blijft geldig");
assert(!IssueClusterEnum.safeParse("totaal_verzonnen_cluster").success, "onzin-cluster faalt nog steeds");

// 2. Pass-through: met Meta validClusters blijft het cluster, zonder mapt CLUSTER_ALIASES het.
const findings = [
  { entity_type: "ad", entity_name: "Ad X", metric: "link ctr", cause: "test", evidence_level: "confirmed", current_value: 1, previous_value: 2, issue_cluster: "creative_fatigue" },
] as unknown as Parameters<typeof canonicalizeFindings>[0];

const withValid = canonicalizeFindings(findings, {}, { validClusters: metaAdsAdapter.issueClusters });
assert(withValid.findings[0].issue_cluster === "creative_fatigue", "met validClusters blijft creative_fatigue behouden");

const withoutValid = canonicalizeFindings(findings, {});
assert(withoutValid.findings[0].issue_cluster !== "creative_fatigue", "zonder validClusters wordt het Meta-cluster gemapt (Google-pad ongewijzigd)");
assert(withoutValid.findings[0].issue_cluster === "creative_mismatch", "zonder validClusters mapt creative_fatigue naar creative_mismatch via CLUSTER_ALIASES");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
