import assert from "node:assert/strict";
import { canonicalizeFindings } from "../analysis/canonicalize";
import { buildStructuredMonthlyOutput } from "../analysis/monthly-structured";
import {
  buildMonthlyHypothesesInsightsPayload,
  encodeHypothesisPersistenceMetadata,
  planHypothesisSprintSync,
  type PersistedSprintHypothesisRow,
  type PersistedSprintItemRow,
} from "../analysis/monthly-hypotheses-insights";
import type { Finding } from "../schema/analysis-schema";

console.log("\n=== Monthly Hypotheses Insights Tests ===\n");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    console.log(name);
    fn();
    passed++;
  } catch (error) {
    failed++;
    console.error(`  FAIL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    step: overrides.step ?? 4,
    issue_cluster: overrides.issue_cluster ?? "search_budget_cap",
    entity_type: overrides.entity_type ?? "campaign",
    entity_name: overrides.entity_name ?? "UK-MPC - Apple - Generic - Automated",
    metric: overrides.metric ?? "Search Lost IS (Budget)",
    current_value: overrides.current_value ?? 23.24,
    previous_value: overrides.previous_value ?? 13.49,
    change_pct: overrides.change_pct ?? 72.28,
    severity: overrides.severity ?? "critical",
    insight_type: overrides.insight_type ?? "risk",
    is_seasonal: overrides.is_seasonal ?? false,
    is_structural: overrides.is_structural ?? true,
    cause: overrides.cause ?? "Budgetcap blokkeert schaal van een winstgevend segment.",
    action_required: overrides.action_required ?? true,
    evidence_level: overrides.evidence_level ?? "deterministic",
    confidence: overrides.confidence ?? "high",
    benchmark_type: overrides.benchmark_type,
    parent_campaign: overrides.parent_campaign,
    parent_adgroup: overrides.parent_adgroup,
    issue_cluster_explanation: overrides.issue_cluster_explanation,
    entity_scope: overrides.entity_scope,
    display_label: overrides.display_label,
  };
}

function buildFixture() {
  const canonical = canonicalizeFindings([
    finding({
      step: 4,
      issue_cluster: "search_budget_cap",
      entity_type: "campaign",
      entity_name: "UK-MPC - Apple - Generic - Automated",
      metric: "Search Lost IS (Budget)",
      current_value: 23.24,
      previous_value: 13.49,
      change_pct: 72.28,
      severity: "critical",
      cause: "Budget is ontoereikend om de stijgende vraag op te vangen.",
    }),
    finding({
      step: 2,
      issue_cluster: "scaling_opportunity",
      entity_type: "campaign",
      entity_name: "UK-MPC - Branded",
      metric: "ROAS",
      current_value: 4.66,
      previous_value: 3.04,
      change_pct: 53.4,
      severity: "positive",
      insight_type: "positive",
      cause: "Merkverkeer blijft sterk converteren.",
      action_required: false,
    }),
  ], {
    campaign: true,
    hypotheses_sprint_plan: true,
  });

  return buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });
}

test("1. Hypotheses in structured output carry explicit workflow links", () => {
  const structured = buildFixture();
  assert(structured.operating_detail.hypotheses_and_next_month_proof.length >= 1, "expected at least one structured hypothesis");
  structured.operating_detail.hypotheses_and_next_month_proof.forEach((hypothesis) => {
    assert(hypothesis.id, "hypothesis should have id");
    assert(hypothesis.linked_finding_ids.length >= 1, "hypothesis should link to findings");
    assert(hypothesis.linked_recommendation_ids.length >= 1, "hypothesis should link to recommendations");
    assert(hypothesis.linked_task_ids.length >= 1, "hypothesis should link to tasks");
    assert(hypothesis.status === "pending", "default status should be pending");
  });
});

test("2. Insights payload count equals structured hypothesis count", () => {
  const structured = buildFixture();
  const payload = buildMonthlyHypothesesInsightsPayload({
    structuredOutput: structured,
    analysisId: "analysis-1",
    structuredRowId: "structured-1",
    structuredCreatedAt: "2026-04-16T00:00:00.000Z",
    persistedHypotheses: [],
    sprintItems: [],
  });

  assert.equal(
    payload.hypotheses.length,
    structured.operating_detail.hypotheses_and_next_month_proof.length,
    "insights payload count should equal structured hypothesis count"
  );
  assert(payload.hypotheses.every((hypothesis) => hypothesis.linked_findings.length >= 1), "payload hypotheses should resolve linked findings");
  assert(payload.hypotheses.every((hypothesis) => hypothesis.linked_tasks.length >= 1), "payload hypotheses should resolve linked tasks");
});

test("3. Accept planning pushes all linked tasks and stays idempotent on second accept", () => {
  const structured = buildFixture();
  const hypothesis = structured.operating_detail.hypotheses_and_next_month_proof[0];
  const firstPlan = planHypothesisSprintSync({
    hypothesis,
    structuredOutput: structured,
    existingItems: [],
  });
  assert.equal(firstPlan.drafts.length, hypothesis.linked_task_ids.length, "all linked task ids should produce sprint drafts");
  assert.equal(firstPlan.missingDrafts.length, hypothesis.linked_task_ids.length, "first accept should push every linked task");
  assert.equal(firstPlan.allLinkedTasksPresent, false, "before insert, sprint sync should not be complete");

  const existingItems: PersistedSprintItemRow[] = firstPlan.drafts.map((draft, index) => ({
    id: `sprint-item-${index + 1}`,
    hypothesis_id: "persisted-hypothesis-1",
    task: draft.task,
    status: "todo",
    owner: draft.owner,
    metrics: draft.metrics,
    review_timeframe: draft.review_timeframe,
  }));
  const secondPlan = planHypothesisSprintSync({
    hypothesis,
    structuredOutput: structured,
    existingItems,
  });
  assert.equal(secondPlan.missingDrafts.length, 0, "second accept should not create duplicates");
  assert.equal(secondPlan.allLinkedTasksPresent, true, "once all tasks exist, sprint sync should be complete");
});

test("3b. Existing sprint items from an older hypothesis are reusable on a fresh rerun", () => {
  const structured = buildFixture();
  const hypothesis = structured.operating_detail.hypotheses_and_next_month_proof[0];
  const initialPlan = planHypothesisSprintSync({
    hypothesis,
    structuredOutput: structured,
    existingItems: [],
  });

  const foreignItems: PersistedSprintItemRow[] = initialPlan.drafts.map((draft, index) => ({
    id: `foreign-sprint-item-${index + 1}`,
    hypothesis_id: "older-hypothesis-id",
    task: draft.task,
    status: "todo",
    owner: draft.owner,
    metrics: draft.metrics,
    review_timeframe: draft.review_timeframe,
  }));

  const reusedPlan = planHypothesisSprintSync({
    hypothesis,
    structuredOutput: structured,
    existingItems: foreignItems,
  });

  assert.equal(reusedPlan.missingDrafts.length, 0, "fresh rerun should be able to reuse matching sprint items");
  assert.equal(reusedPlan.allLinkedTasksPresent, true, "matching sprint items from a previous hypothesis should satisfy full fanout");
});

test("4. Reject payload keeps rejected status and blocks sprint success", () => {
  const structured = buildFixture();
  const hypothesis = structured.operating_detail.hypotheses_and_next_month_proof[0];
  const persistedRows: PersistedSprintHypothesisRow[] = [{
    id: "persisted-hypothesis-1",
    client_id: "gads-8794436501",
    analysis_id: "analysis-1",
    hypothesis: hypothesis.hypothesis,
    expected_result: hypothesis.success_next_month,
    measurement_metric: "Search Lost IS (Budget)",
    timeframe: hypothesis.label,
    rationale: encodeHypothesisPersistenceMetadata({
      source_hypothesis_id: hypothesis.id,
      source_structured_created_at: "2026-04-16T00:00:00.000Z",
      why_we_think_this: hypothesis.why_we_think_this,
      validation_or_exploitation_step: hypothesis.validation_or_exploitation_step,
      linked_primary_thread: hypothesis.linked_primary_thread,
      linked_finding_ids: hypothesis.linked_finding_ids,
      linked_recommendation_ids: hypothesis.linked_recommendation_ids,
      linked_task_ids: hypothesis.linked_task_ids,
      rejected_reason: "Past niet bij de huidige sprintfocus.",
    }),
    status: "rejected",
  }];

  const payload = buildMonthlyHypothesesInsightsPayload({
    structuredOutput: structured,
    analysisId: "analysis-1",
    structuredRowId: "structured-1",
    structuredCreatedAt: "2026-04-16T00:00:00.000Z",
    persistedHypotheses: persistedRows,
    sprintItems: [],
  });

  assert.equal(payload.hypotheses[0]?.status, "rejected", "rejected hypothesis should stay rejected in payload");
  assert.equal(payload.hypotheses[0]?.rejected_reason, "Past niet bij de huidige sprintfocus.", "reject reason should persist");
  assert.equal(payload.hypotheses[0]?.accepted_into_sprint, false, "rejected hypothesis should not be marked as pushed into sprint");
});

test("5. Partial sprint push is not marked as success", () => {
  const structured = buildFixture();
  const hypothesis = structured.operating_detail.hypotheses_and_next_month_proof[0];
  const firstLinkedTask = structured.final_sop.tasks[0];
  const persistedRows: PersistedSprintHypothesisRow[] = [{
    id: "persisted-hypothesis-1",
    client_id: "gads-8794436501",
    analysis_id: "analysis-1",
    hypothesis: hypothesis.hypothesis,
    expected_result: hypothesis.success_next_month,
    measurement_metric: "Search Lost IS (Budget)",
    timeframe: hypothesis.label,
    rationale: encodeHypothesisPersistenceMetadata({
      source_hypothesis_id: hypothesis.id,
      source_structured_created_at: "2026-04-16T00:00:00.000Z",
      why_we_think_this: hypothesis.why_we_think_this,
      validation_or_exploitation_step: hypothesis.validation_or_exploitation_step,
      linked_primary_thread: hypothesis.linked_primary_thread,
      linked_finding_ids: hypothesis.linked_finding_ids,
      linked_recommendation_ids: hypothesis.linked_recommendation_ids,
      linked_task_ids: hypothesis.linked_task_ids,
      rejected_reason: null,
    }),
    status: "accepted",
  }];
  const sprintItems: PersistedSprintItemRow[] = [{
    id: "sprint-item-1",
    hypothesis_id: "persisted-hypothesis-1",
    task: firstLinkedTask.handeling,
    status: "todo",
    owner: "Ranking Masters",
    metrics: firstLinkedTask.meet_via,
    review_timeframe: "Deze sprint",
  }];

  const payload = buildMonthlyHypothesesInsightsPayload({
    structuredOutput: structured,
    analysisId: "analysis-1",
    structuredRowId: "structured-1",
    structuredCreatedAt: "2026-04-16T00:00:00.000Z",
    persistedHypotheses: persistedRows,
    sprintItems,
  });

  assert.equal(payload.hypotheses[0]?.status, "accepted", "status may be accepted");
  assert.equal(payload.hypotheses[0]?.accepted_into_sprint, false, "partial sprint push must not look like a full success");
});

test("6. MPC UK regression: hypotheses remain visible in insights payload data", () => {
  const structured = buildFixture();
  const payload = buildMonthlyHypothesesInsightsPayload({
    structuredOutput: structured,
    analysisId: "analysis-uk",
    structuredRowId: "structured-uk",
    structuredCreatedAt: "2026-04-16T00:00:00.000Z",
    persistedHypotheses: [],
    sprintItems: [],
  });

  assert(payload.hypotheses.some((hypothesis) => /uk-mpc - apple - generic - automated/i.test(hypothesis.linked_primary_thread) || /uk-mpc - apple - generic - automated/i.test(hypothesis.hypothesis)), "MPC UK hypothesis should be visible in insights payload");
});

test("7. Insights payload also resolves hypotheses from stored rows that only keep display_findings", () => {
  const structured = buildFixture();
  const storedLikeStructured = {
    final_sop: structured.final_sop,
    operating_detail: structured.operating_detail,
    display_findings: structured.display_findings as any,
  };

  const payload = buildMonthlyHypothesesInsightsPayload({
    structuredOutput: storedLikeStructured,
    analysisId: "analysis-stored",
    structuredRowId: "structured-stored",
    structuredCreatedAt: "2026-04-16T00:00:00.000Z",
    persistedHypotheses: [],
    sprintItems: [],
  });

  assert.equal(payload.hypotheses.length, structured.operating_detail.hypotheses_and_next_month_proof.length, "stored-like payload should keep hypothesis count");
  assert(payload.hypotheses.every((hypothesis) => Array.isArray(hypothesis.linked_findings)), "stored-like payload should stay renderable even when only display_findings are available");
});

test("8. Fresh rerun stays pending when only a stale accepted hypothesis row exists", () => {
  const structured = buildFixture();
  const hypothesis = structured.operating_detail.hypotheses_and_next_month_proof[0];
  const payload = buildMonthlyHypothesesInsightsPayload({
    structuredOutput: structured,
    analysisId: "analysis-1",
    structuredRowId: "structured-1",
    structuredCreatedAt: "2026-04-16T00:00:00.000Z",
    persistedHypotheses: [{
      id: "persisted-hypothesis-stale",
      client_id: "gads-8794436501",
      analysis_id: "analysis-1",
      hypothesis: hypothesis.hypothesis,
      expected_result: hypothesis.success_next_month,
      measurement_metric: "Search Lost IS (Budget)",
      timeframe: hypothesis.label,
      rationale: encodeHypothesisPersistenceMetadata({
        source_hypothesis_id: hypothesis.id,
        source_structured_created_at: "2026-04-15T00:00:00.000Z",
        why_we_think_this: hypothesis.why_we_think_this,
        validation_or_exploitation_step: hypothesis.validation_or_exploitation_step,
        linked_primary_thread: hypothesis.linked_primary_thread,
        linked_finding_ids: hypothesis.linked_finding_ids,
        linked_recommendation_ids: hypothesis.linked_recommendation_ids,
        linked_task_ids: hypothesis.linked_task_ids,
        rejected_reason: null,
      }),
      status: "accepted",
    }],
    sprintItems: [],
  });

  assert.equal(payload.hypotheses[0]?.status, "pending", "stale accepted rows may not auto-accept a fresh rerun");
  assert.equal(payload.hypotheses[0]?.accepted_into_sprint, false, "fresh rerun must stay out of sprint until manual accept");
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
