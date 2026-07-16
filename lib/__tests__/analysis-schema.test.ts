/**
 * Tests for Zod schema validation and parse helpers.
 * Run with: npx tsx lib/__tests__/analysis-schema.test.ts
 */

import {
  parseFindings,
  parseRecommendations,
  extractJson,
  FindingSchema,
  RecommendationSchema,
  TaskSchema,
} from "../schema/analysis-schema";

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

console.log("\n=== Analysis Schema Tests ===\n");

// ── extractJson ────────────────────────────────────────────────────────────

console.log("1. extractJson");
{
  // Plain JSON
  assert(extractJson('[{"a":1}]') === '[{"a":1}]', "plain array");
  assert(extractJson('{"a":1}') === '{"a":1}', "plain object");

  // Markdown code fences
  assert(extractJson('```json\n[{"a":1}]\n```') === '[{"a":1}]', "fenced json array");
  assert(extractJson('```\n{"a":1}\n```') === '{"a":1}', "fenced no-lang object");

  // Embedded in text
  assert(extractJson('Here is the result: [{"a":1}] and more text') === '[{"a":1}]', "embedded array");
  assert(extractJson('Result: {"a":1} done') === '{"a":1}', "embedded object");

  // No JSON
  assert(extractJson('No JSON here') === null, "no json returns null");
  assert(extractJson('') === null, "empty string returns null");
}

// ── FindingSchema validation ───────────────────────────────────────────────

console.log("2. FindingSchema validation");
{
  const validFinding = {
    step: 1,
    issue_cluster: "uncategorized",
    entity_type: "campaign",
    entity_name: "Search NL",
    metric: "conversions",
    current_value: 120,
    previous_value: 150,
    change_pct: -20,
    severity: "high",
    insight_type: "trend",
    is_seasonal: false,
    is_structural: true,
    cause: "Budget verlaagd op 15 maart",
    action_required: true,
  };

  const result = FindingSchema.safeParse(validFinding);
  assert(result.success === true, "valid finding passes");

  // Invalid: missing required field
  const invalid = { ...validFinding, entity_type: "INVALID" };
  const result2 = FindingSchema.safeParse(invalid);
  assert(result2.success === false, "invalid entity_type fails");

  // Nullable fields
  const withNulls = { ...validFinding, current_value: null, previous_value: null, change_pct: null, cause: null };
  const result3 = FindingSchema.safeParse(withNulls);
  assert(result3.success === true, "nullable fields with null pass");
}

// ── parseFindings ──────────────────────────────────────────────────────────

console.log("3. parseFindings — happy path");
{
  const jsonOutput = JSON.stringify([
    {
      step: 1, entity_type: "account", entity_name: "Account",
      metric: "ROAS", current_value: 4.2, previous_value: 5.1,
      change_pct: -17.6, severity: "medium", insight_type: "performance",
      is_seasonal: false, is_structural: false, cause: null, action_required: false,
    },
    {
      step: 2, entity_type: "campaign", entity_name: "PMax NL",
      metric: "conversions", current_value: 80, previous_value: 100,
      change_pct: -20, severity: "high", insight_type: "trend",
      is_seasonal: true, is_structural: false, cause: "Seizoen", action_required: true,
    },
  ]);

  const result = parseFindings(jsonOutput);
  assert(result.success === true, "valid findings array parses");
  if (result.success) {
    assert(result.data.length === 2, `should have 2 findings, got ${result.data.length}`);
    assert(result.data[0].entity_name === "Account", "first finding entity_name");
    assert(result.data[1].severity === "high", "second finding severity");
  }
}

console.log("4. parseFindings — markdown wrapped");
{
  const mdOutput = '```json\n[{"step":1,"entity_type":"account","entity_name":"X","metric":"m","current_value":1,"previous_value":2,"change_pct":-50,"severity":"low","insight_type":"performance","is_seasonal":false,"is_structural":false,"cause":null,"action_required":false}]\n```';
  const result = parseFindings(mdOutput);
  assert(result.success === true, "markdown-wrapped findings parse");
}

console.log("5. parseFindings — partial recovery");
{
  const mixedOutput = JSON.stringify([
    {
      step: 1, entity_type: "account", entity_name: "OK",
      metric: "m", current_value: 1, previous_value: 2,
      change_pct: -50, severity: "low", insight_type: "performance",
      is_seasonal: false, is_structural: false, cause: null, action_required: false,
    },
    { step: "INVALID", entity_type: 999 }, // bad
  ]);

  const result = parseFindings(mixedOutput);
  assert(result.success === true, "partial recovery succeeds");
  if (result.success) {
    assert(result.data.length === 1, `should recover 1 valid finding, got ${result.data.length}`);
  }
}

console.log("6. parseFindings — no JSON");
{
  const result = parseFindings("This is just plain text with no JSON");
  assert(result.success === false, "no json returns failure");
}

console.log("6b. parseFindings — deterministic issue cluster fallback");
{
  const jsonOutput = JSON.stringify([
    {
      step: 5,
      entity_type: "searchterm",
      entity_name: "broedmachine kopen",
      metric: "Wasteful Spend",
      current_value: 42,
      previous_value: null,
      change_pct: null,
      severity: "medium",
      insight_type: "risk",
      is_seasonal: false,
      is_structural: false,
      cause: "Zoekterm lijkt breed maar is niet automatisch irrelevant",
      action_required: true,
    },
  ]);

  const result = parseFindings(jsonOutput);
  assert(result.success === true, "finding without explicit issue_cluster still parses");
  if (result.success) {
    assert(result.data[0]?.issue_cluster === "search_term_waste", `expected inferred search_term_waste, got ${result.data[0]?.issue_cluster}`);
  }
}

// ── parseRecommendations ───────────────────────────────────────────────────

console.log("7. parseRecommendations — happy path");
{
  const jsonOutput = JSON.stringify({
    recommendations: [{
      finding_index: 0, source: "finding", hypothesis: "tROAS verlagen",
      expected_result: "+15% conversies", measurement_metric: "conversions",
      timeframe: "4 weken", rationale: "Huidige tROAS is te hoog",
      ice_impact: 7, ice_confidence: 6, ice_ease: 8, ice_total: 7,
    }],
    tasks: [{
      recommendation_index: 0, title: "tROAS verlagen van 500% naar 400%",
      description: "Pas tROAS aan in Google Ads", action_type: "bid",
      owner: "Ranking Masters", affected_campaign: "PMax NL",
      affected_adgroup: null, affected_keyword: null,
      current_value: "500%", target_value: "400%",
      priority: "high", frequency: "direct", due_date_days: 7,
    }],
  });

  const result = parseRecommendations(jsonOutput);
  assert(result.success === true, "valid recs+tasks parses");
  if (result.success) {
    assert(result.data.recommendations.length === 1, "should have 1 rec");
    assert(result.data.tasks.length === 1, "should have 1 task");
    assert(result.data.tasks[0].owner === "Ranking Masters", "task owner");
    assert(result.data.recommendations[0].cluster_id === "cluster_unknown", "recommendation cluster_id defaults");
    assert(result.data.tasks[0].thread_id === null, "task thread_id defaults to null");
  }
}

console.log("8. parseRecommendations — invalid task owner with valid rec");
{
  const jsonOutput = JSON.stringify({
    recommendations: [{
      finding_index: null, source: "hypothesis", hypothesis: "Test",
      expected_result: "Test", measurement_metric: "conversions",
      timeframe: "2w", rationale: "Reden",
      ice_impact: 5, ice_confidence: 5, ice_ease: 5, ice_total: 5,
    }],
    tasks: [{
      recommendation_index: 0, title: "Do something",
      description: "...", action_type: "bid",
      owner: "INVALID_OWNER", // not "Ranking Masters" or "Klant"
      affected_campaign: null, affected_adgroup: null, affected_keyword: null,
      current_value: null, target_value: null,
      priority: "high", frequency: "direct", due_date_days: 7,
    }],
  });

  const result = parseRecommendations(jsonOutput);
  // Should succeed: 1 valid rec, 0 valid tasks (partial recovery)
  assert(result.success === true, "partial recovery with 1 valid rec + invalid task");
  if (result.success) {
    assert(result.data.recommendations.length === 1, "1 valid rec should survive");
    assert(result.data.tasks.length === 0, "invalid task should be filtered out");
  }
}

// ── Results ────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
