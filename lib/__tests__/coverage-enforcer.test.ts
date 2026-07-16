import { enforceSopCoverage } from "../analysis/coverage-enforcer";
import type { IssueCluster } from "../analysis/canonicalize";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function cluster(overrides: Partial<IssueCluster>): IssueCluster {
  return {
    cluster_id: "cluster_geo",
    issue_cluster: "geo_allocation",
    canonical_entity_name: "Duitsland",
    display_label: "Land: Duitsland",
    entity_scope: "country",
    entity_identity_key: "country::de",
    canonical_geo_id: "de",
    parent_campaign: null,
    parent_adgroup: null,
    canonical_metric: "ROAS",
    related_finding_ids: ["f_001"],
    dominant_severity: "high",
    dominant_confidence: "high",
    root_cause_summary: "Geo mismatch.",
    evidence_summary: "Land: Duitsland ROAS 0.86x.",
    actionability: "direct_action",
    coverage_dimensions: ["geography"],
    findings: [] as IssueCluster["findings"],
    action_required: true,
    finding_count: 1,
    severity_score: 4,
    ...overrides,
  };
}

console.log("\n=== Coverage Enforcer Tests ===\n");

console.log("1. Available dimensions become no_signal instead of disappearing");
{
  const result = enforceSopCoverage([cluster({ coverage_dimensions: ["geography"] })], {
    geography: true,
    campaign: true,
    hypotheses_sprint_plan: true,
  });

  const geography = result.coverage.find((row) => row.dimension === "geography");
  const campaign = result.coverage.find((row) => row.dimension === "campaign");

  assert(geography?.status === "covered", "covered dimension should remain covered");
  assert(campaign?.status === "no_signal", "available but unsurfaced dimension should be explicit no_signal");
  assert(result.traceabilityOk === true, "covered clusters should remain traceable");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
