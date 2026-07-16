/**
 * Tests for output hardening: sanitization, comparison facts, action gating.
 * Run with: npx tsx lib/__tests__/output-hardening.test.ts
 */

import { fixMojibake, deduplicateHeadings, sanitizeOutput } from "../analysis/sanitize";
import { computeComparisonFacts, formatComparisonFacts } from "../analysis/comparison-facts";
import { applyActionGating } from "../analysis/action-gating";
import type { Finding, Recommendation } from "../schema/analysis-schema";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${label}`); }
}

console.log("\n=== Output Hardening Tests ===\n");

// ── Mojibake fixes ─────────────────────────────────────────────────────────

console.log("1. fixMojibake");
{
  assert(fixMojibake("â‚¬100") === "€100", "euro sign");
  assert(fixMojibake("efficiÃ«ntie") === "efficiëntie", "e-trema");
  assert(fixMojibake("geÃ¯dentificeerd") === "geïdentificeerd", "i-trema");
  assert(fixMojibake("Ã©Ã©n") === "één", "e-acute");
  assert(fixMojibake("normal text") === "normal text", "no change");
}

// ── Heading deduplication ──────────────────────────────────────────────────

console.log("2. deduplicateHeadings");
{
  const input = `## Account Performance\n\n### Stap 1: Account Performance\n\nContent here\n\n## Campaign Performance\n\n### Stap 2: Campaign Performance`;
  const result = deduplicateHeadings(input);
  const headings = result.split("\n").filter((l) => l.startsWith("#"));
  assert(headings.length === 2, `should have 2 headings, got ${headings.length}`);
  assert(!result.includes("Stap 1: Account Performance"), "Stap 1 duplicate removed");
}

console.log("3. deduplicateHeadings — no false positives");
{
  const input = `## Account Performance\n\n## Campaign Performance\n\n## Ad Group Performance`;
  const result = deduplicateHeadings(input);
  const headings = result.split("\n").filter((l) => l.startsWith("#"));
  assert(headings.length === 3, `should keep 3 unique headings, got ${headings.length}`);
}

// ── Comparison facts ───────────────────────────────────────────────────────

console.log("4. computeComparisonFacts — target deltas");
{
  const facts = computeComparisonFacts({
    accountData: [
      { month: "2026-02-01", impressions: 10000, clicks: 500, cost: 1000, conversions: 50, conversions_value: 2160, ctr: 5, avg_cpc: 2, conversion_rate: 10, cost_per_conversion: 20 },
      { month: "2026-03-01", impressions: 9000, clicks: 450, cost: 950, conversions: 45, conversions_value: 2050, ctr: 5, avg_cpc: 2.11, conversion_rate: 10, cost_per_conversion: 21.1 },
    ],
    monthlyTargets: [
      { month: 1, conversions: 40, revenue: 2000, adSpend: 900 },
      { month: 2, conversions: 42, revenue: 2100, adSpend: 950 },
      { month: 3, conversions: 55, revenue: 2500, adSpend: 1000 },
    ],
    kpiTargets: { roasTarget: 3.0 },
    sectorBenchmarks: [
      { metric: "roas", low: 1.5, median: 3.68, high: 5.0, top10: 7.0 },
    ],
    lastCompleteMonth: 3,
  });

  // Conversions: 45 vs target 55 = -18.2%
  const convComp = facts.targetComparisons.find((c) => c.metric === "conversies");
  assert(convComp !== undefined, "conversions comparison exists");
  assert(convComp!.deltaPct === -18.2, `conv delta should be -18.2, got ${convComp?.deltaPct}`);
  assert(convComp!.statusLabel === "NIET OP SCHEMA", `status should be NIET OP SCHEMA, got ${convComp?.statusLabel}`);

  // ROAS: 2050/950 = 2.157... vs target 3.0 = -28.1%
  const roasComp = facts.targetComparisons.find((c) => c.metric === "ROAS");
  assert(roasComp !== undefined, "ROAS comparison exists");
  assert(Math.abs(roasComp!.deltaPct - (-28.1)) < 1, `ROAS delta should be ~-28.1, got ${roasComp?.deltaPct}`);

  // Sector benchmark: ROAS 2.16 vs median 3.68 → should be "onder sectorgemiddelde"
  const roasBm = facts.benchmarkLabels.find((b) => b.metric === "roas");
  assert(roasBm !== undefined, "ROAS benchmark label exists");
  assert(roasBm!.label === "onder sectorgemiddelde", `label should be 'onder sectorgemiddelde', got '${roasBm?.label}'`);
}

console.log("5. formatComparisonFacts — produces text");
{
  const facts = computeComparisonFacts({
    accountData: [
      { month: "2026-03-01", impressions: 9000, clicks: 450, cost: 950, conversions: 45, conversions_value: 2050, ctr: 5, avg_cpc: 2.11, conversion_rate: 10, cost_per_conversion: 21.1 },
    ],
    monthlyTargets: [{ month: 3, conversions: 55, revenue: 2500, adSpend: 1000 }],
    kpiTargets: null,
    sectorBenchmarks: [],
    lastCompleteMonth: 3,
  });
  const text = formatComparisonFacts(facts);
  assert(text.includes("VOORBEREKENDE VERGELIJKINGEN"), "contains header");
  assert(text.includes("Doelstellingsstatus"), "contains targets section");
  assert(text.includes("niet zelf herberekenen"), "contains instruction");
}

// ── Action gating ──────────────────────────────────────────────────────────

console.log("6. applyActionGating — downgrades weak direct_action");
{
  const findings: Finding[] = [{
    step: 1, issue_cluster: "tracking_cvr_drop", entity_type: "account", entity_name: "Account",
    metric: "conversions", current_value: 10, previous_value: 15,
    change_pct: -33, severity: "medium", insight_type: "performance",
    is_seasonal: false, is_structural: false, cause: null, action_required: true,
  }];

  const recs: Recommendation[] = [{
    finding_index: 0, cluster_id: "cluster_tracking", thread_id: null, source: "finding",
    hypothesis: "Budget verhogen", expected_result: "+10%", measurement_metric: "conversions",
    timeframe: "2 weken", rationale: "...",
    ice_impact: 5, ice_confidence: 5, ice_ease: 5, ice_total: 5,
  }];

  // Simulate: LLM set action_readiness=direct_action but evidence_level=inferred
  (recs[0] as Record<string, unknown>).action_readiness = "direct_action";
  (recs[0] as Record<string, unknown>).evidence_level = "inferred";
  (recs[0] as Record<string, unknown>).confidence = "medium";

  applyActionGating(findings, recs);

  const result = (recs[0] as Record<string, unknown>).action_readiness;
  assert(result !== "direct_action",
    `inferred + medium confidence → should not remain direct_action, got ${result}`);
}

console.log("7. applyActionGating — hypothesis source → strategic_hypothesis");
{
  const findings: Finding[] = [];
  const recs: Recommendation[] = [{
    finding_index: null, cluster_id: "cluster_hypothesis", thread_id: null, source: "hypothesis",
    hypothesis: "Nieuwe PMax campagne", expected_result: "+20%", measurement_metric: "conversions",
    timeframe: "3 maanden", rationale: "...",
    ice_impact: 7, ice_confidence: 4, ice_ease: 3, ice_total: 4.7,
  }];
  (recs[0] as Record<string, unknown>).action_readiness = "direct_action";
  (recs[0] as Record<string, unknown>).evidence_level = "hypothesis";
  (recs[0] as Record<string, unknown>).confidence = "medium";

  applyActionGating(findings, recs);

  assert((recs[0] as Record<string, unknown>).action_readiness === "strategic_hypothesis",
    "hypothesis source → always strategic_hypothesis");
}

console.log("8. applyActionGating — small value downgrade");
{
  const findings: Finding[] = [{
    step: 5, issue_cluster: "search_term_waste", entity_type: "searchterm", entity_name: "test term",
    metric: "cost", current_value: 12, previous_value: null,
    change_pct: null, severity: "low", insight_type: "performance",
    is_seasonal: false, is_structural: false, cause: null, action_required: true,
  }];
  const recs: Recommendation[] = [{
    finding_index: 0, cluster_id: "cluster_searchterm", thread_id: null, source: "finding",
    hypothesis: "Term uitsluiten", expected_result: "€12 besparing", measurement_metric: "cost",
    timeframe: "direct", rationale: "...",
    ice_impact: 2, ice_confidence: 8, ice_ease: 9, ice_total: 6.3,
  }];
  (recs[0] as Record<string, unknown>).action_readiness = "direct_action";
  (recs[0] as Record<string, unknown>).evidence_level = "deterministic";
  (recs[0] as Record<string, unknown>).confidence = "high";

  applyActionGating(findings, recs);

  assert((recs[0] as Record<string, unknown>).action_readiness === "monitor",
    "€12 waste → downgraded to monitor");
}

// ── Results ────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
