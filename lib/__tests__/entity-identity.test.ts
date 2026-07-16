/**
 * Tests for entity scope disambiguation and scope-safe dedup.
 * Run with: npx tsx lib/__tests__/entity-identity.test.ts
 */

import { canonicalizeFindings } from "../analysis/canonicalize";
import { buildDisplayLabel, deriveEntityIdentity } from "../analysis/entity-identity";
import type { Finding } from "../schema/analysis-schema";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    step: 1,
    issue_cluster: "geo_allocation",
    entity_type: "country",
    entity_name: "Duitsland",
    entity_scope: "country",
    parent_campaign: null,
    parent_adgroup: null,
    display_label: undefined,
    metric: "ROAS",
    current_value: 0.89,
    previous_value: 1.4,
    change_pct: -36,
    severity: "high",
    insight_type: "performance",
    is_seasonal: false,
    is_structural: true,
    cause: "Duitsland blijft onder target",
    action_required: true,
    confidence: "high",
    evidence_level: "deterministic",
    benchmark_type: "previous_month",
    ...overrides,
  };
}

console.log("\n=== Entity Identity Tests ===\n");

console.log("1. Country and ad group with same geography must not dedup");
{
  const raw = [
    finding({ entity_type: "country", entity_name: "Duitsland", entity_scope: "country", issue_cluster: "geo_allocation" }),
    finding({ entity_type: "adgroup", entity_name: "DE", entity_scope: "adgroup", parent_campaign: "Shopping-core_RM", issue_cluster: "uncategorized", metric: "CPA" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    geography: true,
    adgroup: true,
    hypotheses_sprint_plan: true,
  });

  assert(canonical.findings.length === 2, `should keep both entities separate, got ${canonical.findings.length}`);
  assert(canonical.findings[0].dedup_key !== canonical.findings[1].dedup_key, "dedup keys should differ by scope");
}

console.log("2. Same canonical name across entity types remains separate");
{
  const raw = [
    finding({ entity_type: "country", entity_name: "België", entity_scope: "country" }),
    finding({ entity_type: "campaign", entity_name: "België", entity_scope: "campaign", issue_cluster: "search_budget_cap" }),
    finding({ entity_type: "adgroup", entity_name: "België", entity_scope: "adgroup", parent_campaign: "Search BE", issue_cluster: "uncategorized" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    geography: true,
    campaign: true,
    adgroup: true,
    hypotheses_sprint_plan: true,
  });

  assert(canonical.findings.length === 3, `same label across types should remain separate, got ${canonical.findings.length}`);
}

console.log("3. User-facing labels disambiguate ambiguous entities");
{
  const country = deriveEntityIdentity(finding({ entity_type: "country", entity_name: "Duitsland" }));
  const adgroup = deriveEntityIdentity(finding({ entity_type: "adgroup", entity_name: "DE", parent_campaign: "Shopping-core_RM" }));
  assert(country.display_label === "Land: Duitsland", `expected country label, got ${country.display_label}`);
  assert(adgroup.display_label === "Ad group: DE (Campagne: Shopping-core_RM)", `expected adgroup label, got ${adgroup.display_label}`);
  assert(buildDisplayLabel({ entity_type: "campaign", canonical_entity_name: "Duitsland Prospecting" }) === "Campagne: Duitsland Prospecting", "campaign label explicit");
  assert(country.canonical_geo_id === "de", `country canonical_geo_id should be de, got ${country.canonical_geo_id}`);
  assert(adgroup.canonical_geo_id === "de", `adgroup canonical_geo_id should be de, got ${adgroup.canonical_geo_id}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
