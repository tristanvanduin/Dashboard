/**
 * Regression tests for the monthly structured pipeline.
 * Run with: npx tsx lib/__tests__/monthly-structured.test.ts
 */

import { canonicalizeFindings, normalizeEntityName, normalizeMetricName } from "../analysis/canonicalize";
import {
  buildAppendixMarkdown,
  buildCanonicalMetricSnapshot,
  buildCoverageMarkdown,
  buildStructuredMonthlyOutput,
  validateMonthlyDeliverableCompleteness,
  type StepFindingSidecar,
} from "../analysis/monthly-structured";
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
    issue_cluster: "uncategorized",
    entity_type: "campaign",
    entity_name: "2. Broedmachine_RM",
    metric: "ROAS",
    current_value: 2.1,
    previous_value: 4.2,
    change_pct: -50,
    severity: "high",
    insight_type: "performance",
    is_seasonal: false,
    is_structural: true,
    cause: "Rendement daalt door inefficiënt verkeer",
    action_required: true,
    evidence_level: "deterministic",
    confidence: "high",
    benchmark_type: "previous_month",
    ...overrides,
  };
}

function parsedStep(overrides: Partial<StepFindingSidecar>): StepFindingSidecar {
  return {
    stepNumber: 1,
    stepName: "Account Performance",
    narrative: "Narrative",
    log_entries: ["Logregel A"],
    findings: [],
    status: "OP SCHEMA",
    actions: [],
    step_conclusion: "Korte stapconclusie voor de volgende stap.",
    ...overrides,
  };
}

console.log("\n=== Monthly Structured Pipeline Tests ===\n");

console.log("1. Normalization");
{
  assert(normalizeEntityName("Account Overall") === "Account", "account alias collapses");
  assert(normalizeEntityName("Belgium (BE)") === "België", "country alias collapses to Dutch");
  assert(normalizeEntityName("2. Broedmachine_RM (Search)") === "2. Broedmachine_RM", "campaign suffix stripped");
  assert(normalizeMetricName("Search Impression Share (Budget)") === "Search Lost IS (Budget)", "metric alias collapses");
  assert(normalizeMetricName("Conversion Rate") === "CVR", "CVR metric normalization");
}

console.log("2. Canonicalize + deduplicate");
{
  const raw = [
    finding({ entity_name: "Account Overall", entity_type: "account", metric: "Conversion Rate", issue_cluster: "tracking_cvr_drop" }),
    finding({ entity_name: "Account Performance", entity_type: "account", metric: "CVR", issue_cluster: "tracking_cvr_drop", severity: "critical", cause: "Tracking of sitekwaliteit wijkt af" }),
    finding({ entity_name: "Belgium (BE)", entity_type: "country", metric: "Efficiency Ratio", current_value: 0.76, previous_value: null, change_pct: null, issue_cluster: "geo_allocation", confidence: "medium" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    account: true,
    geography: true,
    hypotheses_sprint_plan: true,
  });

  assert(canonical.findings.length === 2, `dedup should collapse aliases to 2 findings, got ${canonical.findings.length}`);
  assert(canonical.clusters.length === 2, `should produce 2 clusters, got ${canonical.clusters.length}`);
  assert(canonical.findings[0].entity_name === "Account", "entity name overwritten with canonical form");
  assert(canonical.findings.some((item) => item.metric === "Efficiency Ratio"), "metric canonical form retained");
}

console.log("3. Cluster formation + coverage");
{
  const raw = [
    finding({ entity_type: "device", entity_name: "Desktop", metric: "CPA", current_value: 22.9, previous_value: 13.1, change_pct: 75, issue_cluster: "desktop_inefficiency" }),
    finding({ entity_type: "device", entity_name: "Desktop", metric: "CPC", current_value: 1.45, previous_value: 0.9, change_pct: 61, issue_cluster: "desktop_inefficiency", severity: "medium" }),
    finding({ entity_type: "searchterm", entity_name: "broedmachine kippen", metric: "Wasteful Spend", current_value: 38, previous_value: null, change_pct: null, issue_cluster: "search_term_waste", confidence: "medium" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    device: true,
    search_term: true,
    hypotheses_sprint_plan: true,
  });

  const desktopCluster = canonical.clusters.find((cluster) => cluster.issue_cluster === "desktop_inefficiency");
  assert(Boolean(desktopCluster), "desktop cluster exists");
  assert(desktopCluster?.finding_count === 2, `desktop cluster should merge 2 findings, got ${desktopCluster?.finding_count}`);
  const searchTermCoverage = canonical.coverage.find((row) => row.dimension === "search_term");
  assert(searchTermCoverage?.status === "covered", `search_term coverage should be covered, got ${searchTermCoverage?.status}`);
  const geographyCoverage = canonical.coverage.find((row) => row.dimension === "geography");
  assert(geographyCoverage?.status === "data_unavailable", "missing dimension should be marked unavailable");
}

console.log("4. Threads + false-positive suppression");
{
  const raw = [
    finding({ step: 1, entity_type: "account", entity_name: "Account Wide", metric: "Conversion Rate", current_value: 0.03, previous_value: 0.06, change_pct: -50, issue_cluster: "tracking_cvr_drop", severity: "critical", confidence: "medium", evidence_level: "inferred" }),
    finding({ step: 2, entity_name: "2. Broedmachine_RM", metric: "Search Lost IS (Budget)", current_value: 23, previous_value: 3, change_pct: 588, issue_cluster: "search_budget_cap", severity: "critical" }),
    finding({ step: 7, entity_type: "device", entity_name: "Desktop", metric: "CPA", current_value: 23, previous_value: 13, change_pct: 75, issue_cluster: "desktop_inefficiency", severity: "high" }),
    finding({ step: 2, entity_name: "PMAX Best Sellers", metric: "ROAS", current_value: 5.36, previous_value: 3.7, change_pct: 45, issue_cluster: "pmax_cannibalization", severity: "positive", action_required: false }),
  ];

  const canonical = canonicalizeFindings(raw, {
    account: true,
    campaign: true,
    device: true,
    pmax_product_asset_groups: true,
    hypotheses_sprint_plan: true,
  });

  const sidecars: StepFindingSidecar[] = [
    parsedStep({ stepNumber: 1, stepName: "Account Performance", narrative: "Narrative 1", findings: raw.filter((item) => item.step === 1) }),
    parsedStep({ stepNumber: 2, stepName: "Campaign Performance", narrative: "Narrative 2", findings: raw.filter((item) => item.step === 2) }),
    parsedStep({ stepNumber: 7, stepName: "Audience & Device Performance", narrative: "Narrative 7", findings: raw.filter((item) => item.step === 7) }),
  ];

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: sidecars,
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.threads.length >= 3, `should select up to 3 threads, got ${structured.threads.length}`);
  assert(structured.threads[0].classification !== "false_positive_alert", "primary thread should not be a false positive");
  assert(structured.what_is_not_the_problem.some((item) => item.includes("PMAX Best Sellers")), "positive contextual cluster should move to not-the-problem layer");
}

console.log("5. Recommendation/task plan ordering");
{
  const raw = [
    finding({ step: 2, entity_name: "2. Broedmachine_RM", metric: "Search Lost IS (Budget)", current_value: 23, previous_value: 3, change_pct: 588, issue_cluster: "search_budget_cap", severity: "critical" }),
    finding({ step: 7, entity_type: "device", entity_name: "Desktop", metric: "CPA", current_value: 23, previous_value: 13, change_pct: 75, issue_cluster: "desktop_inefficiency", severity: "high" }),
    finding({ step: 5, entity_type: "searchterm", entity_name: "broedmachine kippen", metric: "Wasteful Spend", current_value: 38, previous_value: null, change_pct: null, issue_cluster: "search_term_waste", severity: "medium", confidence: "medium" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    campaign: true,
    device: true,
    search_term: true,
    hypotheses_sprint_plan: true,
  });
  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.recommendations.length >= 3, `should create recommendations, got ${structured.recommendations.length}`);
  assert(structured.recommendations[0].phase === "immediate", "highest-priority recommendation should be immediate");
  assert(structured.tasks.every((task, index, arr) => index === 0 || task.due_date_days >= arr[index - 1].due_date_days), "tasks sorted by due date");
  assert(structured.tasks.some((task) => /kernproduct|broad/i.test(task.description) || /Splits relevante brede termen/i.test(task.title)), "search term tasks should use safer product-aware wording");
  assert(structured.tasks.every((task) => !/Voeg negatieve zoektermen toe/i.test(task.title)), "dangerous generic negative task removed");
  assert(structured.success_next_month.weekly_monitoring_checklist.length > 0, "success scenario includes monitoring checklist");
  assert(structured.executive_markdown.includes("## What is NOT the problem"), "executive markdown contains strict not-the-problem section");
  assert(structured.executive_markdown.includes("## QA self-check"), "executive markdown contains QA self-check");
  assert(!structured.executive_markdown.includes("## Executive Snapshot"), "legacy executive snapshot removed");
  assert(structured.recommendations.length <= 12, `recommendation cap should hold, got ${structured.recommendations.length}`);
  assert(structured.tasks.length <= 12, `task cap should hold, got ${structured.tasks.length}`);
  assert("Immediate (Week 1)" in structured.action_plan, "action plan should use formatted immediate label");
  assert(structured.final_sop.recommendations.length >= 3 && structured.final_sop.recommendations.length <= 4, "final SOP keeps 3-4 strategic recommendations");
  assert(structured.final_sop.tasks.length >= 3 && structured.final_sop.tasks.length <= 6, "final SOP keeps 3-6 operational tasks");
  assert(structured.operating_detail.route_task_map.length >= structured.final_sop.recommendations.length, "operating layer traces every final recommendation");
  assert(structured.operating_detail.execution_detail.length >= structured.final_sop.tasks.length, "operating layer traces every final task");
  assert(structured.deliverable_markdown.includes("## Operating detail: Evidence trace"), "deliverable markdown includes operating evidence trace");
  assert(validateMonthlyDeliverableCompleteness(structured).length === 0, "two-layer deliverable completeness should pass");
}

console.log("6. Entity scope and geo action dedupe");
{
  const raw = [
    finding({ step: 3, entity_type: "country", entity_name: "Germany", metric: "ROAS", current_value: 1.8, previous_value: 3.1, change_pct: -42, issue_cluster: "geo_allocation", severity: "high" }),
    finding({ step: 3, entity_type: "adgroup", entity_name: "DE", parent_campaign: "Shopping-testers_RM", metric: "CPA", current_value: 48, previous_value: 29, change_pct: 66, issue_cluster: "geo_allocation", severity: "high" }),
    finding({ step: 3, entity_type: "campaign", entity_name: "Germany (DE) Testers & Core", metric: "ROAS", current_value: 2.0, previous_value: 3.4, change_pct: -41, issue_cluster: "geo_allocation", severity: "high" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    geography: true,
    adgroup: true,
    campaign: true,
    hypotheses_sprint_plan: true,
  });

  assert(canonical.clusters.length === 3, `scope-aware clusters should remain separate, got ${canonical.clusters.length}`);
  assert(canonical.clusters.some((cluster) => cluster.display_label === "Land: Duitsland"), "country display label is explicit");
  assert(canonical.clusters.some((cluster) => cluster.display_label.includes("Ad group: DE")), "ad group display label is explicit");

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  const geoRecs = structured.recommendations.filter((recommendation) => recommendation.action_intent_class === "geo_reallocation");
  assert(geoRecs.length === 1, `geo duplicates should collapse to one coherent recommendation, got ${geoRecs.length}`);
  const geoTasks = structured.tasks.filter((task) => task.action_intent_class === "geo_reallocation");
  assert(geoTasks.length <= 2, `geo tasks should stay compact after dedupe, got ${geoTasks.length}`);
}

console.log("7. Primary thread prefers broader causal issue over derivative symptom");
{
  const raw = [
    finding({ step: 3, entity_type: "country", entity_name: "Germany", metric: "ROAS", current_value: 1.8, previous_value: 3.5, change_pct: -49, issue_cluster: "geo_allocation", severity: "critical" }),
    finding({ step: 6, entity_type: "network", entity_name: "YouTube", parent_campaign: "PMax Best Sellers", metric: "CPA", current_value: 42, previous_value: 18, change_pct: 133, issue_cluster: "network_quality", severity: "critical" }),
    finding({ step: 7, entity_type: "device", entity_name: "Mobile", metric: "CVR", current_value: 0.8, previous_value: 1.7, change_pct: -53, issue_cluster: "mobile_opportunity", severity: "high" }),
    finding({ step: 7, entity_type: "device", entity_name: "Mobile", metric: "CPA", current_value: 18, previous_value: 10, change_pct: 80, issue_cluster: "mobile_opportunity", severity: "high" }),
    finding({ step: 7, entity_type: "device", entity_name: "Mobile", metric: "ROAS", current_value: 1.1, previous_value: 2.2, change_pct: -50, issue_cluster: "mobile_opportunity", severity: "high" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    geography: true,
    network: true,
    device: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(!/mobile/i.test(structured.threads[0]?.title || ""), `primary thread should not be derivative mobile symptom, got "${structured.threads[0]?.title}"`);
  assert(structured.final_sop.recommendations.length <= 4, "final SOP recommendations stay bounded");
}

console.log("8. PDF regression case stays deduped and root-cause first");
{
  const raw = [
    finding({ step: 3, entity_type: "country", entity_name: "Duitsland", metric: "ROAS", current_value: 0.86, previous_value: 1.5, change_pct: -43, issue_cluster: "geo_allocation", severity: "critical", cause: "Duitsland verbruikt 25% budget voor zwakke efficiency" }),
    finding({ step: 3, entity_type: "adgroup", entity_name: "DE", parent_campaign: "Shopping-testers_RM", metric: "CPA", current_value: 40.02, previous_value: 23.0, change_pct: 74, issue_cluster: "geo_allocation", severity: "critical", cause: "DE ad group trekt hoge CPA" }),
    finding({ step: 2, entity_type: "network", entity_name: "YouTube", parent_campaign: "Bestseller_RM", metric: "ROAS", current_value: 0.56, previous_value: 2.79, change_pct: -80, issue_cluster: "network_quality", severity: "critical", cause: "PMax lekt budget naar YouTube inventory" }),
    finding({ step: 7, entity_type: "device", entity_name: "Mobile", metric: "CVR", current_value: 0.0057, previous_value: 0.051, change_pct: -88.8, issue_cluster: "mobile_opportunity", severity: "high", cause: "Mobiele CVR is afgeleid van zwakke traffic mix" }),
    finding({ step: 3, entity_type: "adgroup", entity_name: "WC rolhouder", metric: "Spend", current_value: 0, previous_value: 104, change_pct: -100, issue_cluster: "product_mix", severity: "high", cause: "Historische bestseller is technisch weggevallen" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    geography: true,
    adgroup: true,
    network: true,
    device: true,
    pmax_product_asset_groups: true,
    hypotheses_sprint_plan: true,
  });
  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(!/mobile/i.test(structured.threads[0]?.title || ""), `pdf regression: primary thread should not be mobile symptom, got "${structured.threads[0]?.title}"`);
  assert(structured.recommendations.filter((recommendation) => recommendation.action_intent_class === "geo_reallocation").length === 1, "pdf regression: Germany geo action should appear once");
  assert(structured.recommendations.length < canonical.clusters.length, "pdf regression: output recommendations should be more compact than raw clusters");
  assert(structured.tasks.filter((task) => task.action_intent_class === "geo_reallocation").length <= 2, "pdf regression: Germany task layer should stay compact");
}

console.log("9. Raw findings stay complete while display findings stay compact");
{
  const many = Array.from({ length: 9 }, (_, index) =>
    finding({
      step: 5,
      entity_type: "searchterm",
      entity_name: `term ${index + 1}`,
      metric: "Wasteful Spend",
      change_pct: 10 + index,
      current_value: 20 + index,
      issue_cluster: "search_term_waste",
      severity: index < 2 ? "high" : "medium",
    })
  );
  const canonical = canonicalizeFindings(many, {
    search_term: true,
    hypotheses_sprint_plan: true,
  });
  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [parsedStep({ stepNumber: 5, stepName: "Search Term Performance", narrative: "Narrative", findings: many })],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.findings.length === canonical.findings.length, "raw findings should remain complete");
  assert((structured.step_sidecars[0].displayFindings?.length ?? 0) <= 5, `display findings should be capped at 5, got ${structured.step_sidecars[0].displayFindings?.length}`);
}

console.log("10. Canonical metric snapshot keeps cross-step framing consistent");
{
  const raw = [
    finding({ step: 1, entity_type: "country", entity_name: "Germany", metric: "ROAS", current_value: 0.85, previous_value: 3.0, change_pct: -71.6, issue_cluster: "geo_allocation", severity: "critical" }),
    finding({ step: 8, entity_type: "country", entity_name: "Land: Duitsland", metric: "ROAS", current_value: 0.85, previous_value: 3.0, change_pct: -71.6, issue_cluster: "geo_allocation", severity: "high" }),
    finding({ step: 10, entity_type: "country", entity_name: "Duitsland (DE)", metric: "ROAS", current_value: 0.85, previous_value: 3.0, change_pct: -71.6, issue_cluster: "geo_allocation", severity: "high" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    geography: true,
    hypotheses_sprint_plan: true,
  });
  const snapshot = buildCanonicalMetricSnapshot(canonical.findings);
  const germanyRoas = snapshot.filter((row) => row.display_label === "Land: Duitsland" && row.canonical_metric === "ROAS");

  assert(germanyRoas.length === 1, `canonical snapshot should keep one Germany ROAS row, got ${germanyRoas.length}`);
  assert(germanyRoas[0]?.current_value === 0.85, `expected canonical ROAS current value 0.85, got ${germanyRoas[0]?.current_value}`);

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Ruwe slottekst met mogelijk afwijkende framing",
  });

  assert(structured.canonical_metric_snapshot.some((row) => row.display_label === "Land: Duitsland" && row.canonical_metric === "ROAS"), "canonical KPI snapshot remains available in structured output");
  assert(structured.executive_markdown.includes("## Primary thread"), "final SOP markdown renders primary thread");
  assert(!structured.executive_markdown.includes("## Canonical KPI Snapshot"), "legacy KPI snapshot section removed from executive markdown");
}

console.log("11. Display findings collapse multiple metrics on the same entity");
{
  const raw = [
    finding({ step: 3, entity_type: "country", entity_name: "Duitsland", metric: "ROAS", current_value: 0.83, previous_value: 1.6, change_pct: -48, issue_cluster: "geo_allocation", severity: "critical" }),
    finding({ step: 3, entity_type: "country", entity_name: "Germany (DE)", metric: "CPA", current_value: 42, previous_value: 24, change_pct: 75, issue_cluster: "geo_allocation", severity: "high" }),
    finding({ step: 3, entity_type: "country", entity_name: "Land: Duitsland", metric: "Efficiency Ratio", current_value: 0.61, previous_value: 0.9, change_pct: -32, issue_cluster: "geo_allocation", severity: "high" }),
    finding({ step: 3, entity_type: "adgroup", entity_name: "WC rolhouder", metric: "Spend", current_value: 0, previous_value: 104, change_pct: -100, issue_cluster: "product_mix", severity: "critical" }),
    finding({ step: 3, entity_type: "adgroup", entity_name: "WC rolhouder", metric: "Impressies", current_value: 0, previous_value: 4500, change_pct: -100, issue_cluster: "product_mix", severity: "high" }),
    finding({ step: 2, entity_type: "network", entity_name: "YouTube", parent_campaign: "Bestseller_RM", metric: "Spend", current_value: 240, previous_value: 110, change_pct: 118, issue_cluster: "network_quality", severity: "high" }),
    finding({ step: 2, entity_type: "network", entity_name: "YouTube", parent_campaign: "Bestseller_RM", metric: "ROAS", current_value: 0.56, previous_value: 2.79, change_pct: -80, issue_cluster: "network_quality", severity: "critical" }),
  ];
  const canonical = canonicalizeFindings(raw, {
    geography: true,
    network: true,
    pmax_product_asset_groups: true,
    hypotheses_sprint_plan: true,
  });
  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.display_findings.filter((item) => /duitsland/i.test(item.title)).length === 1, "Germany should collapse to one display finding");
  assert(structured.display_findings.filter((item) => /wc rolhouder/i.test(item.title)).length === 1, "WC rolhouder should collapse to one display finding");
  assert(structured.display_findings.filter((item) => /youtube/i.test(item.title)).length === 1, "YouTube/Bestseller should collapse to one display finding");
}

console.log("12. Concrete step actions win over generic recommendations");
{
  const raw = [
    finding({ step: 2, entity_type: "campaign", entity_name: "Zombie Products", metric: "Spend", current_value: 180, previous_value: 60, change_pct: 200, issue_cluster: "product_mix", severity: "critical" }),
  ];
  const canonical = canonicalizeFindings(raw, {
    campaign: true,
    pmax_product_asset_groups: true,
    hypotheses_sprint_plan: true,
  });
  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 6,
        stepName: "Product Performance",
        status: "KRITIEK",
        actions: [
          { actie: "Pauzeer productgroep Zombie Products bij >€150 spend en 0 conversies", campagne: "Zombie Products", deadline: "direct", verwachte_impact: "Directe stop op budgetverlies binnen 1 dag." },
          { actie: "Heralloceer geo-budget rond Zombie Products", campagne: "Zombie Products", deadline: "deze_week", verwachte_impact: "Vage impact." },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(/Pauzeer productgroep Zombie Products/i.test(structured.recommendations[0]?.hypothesis || ""), "concrete pause action should outrank generic recommendation");
  assert(!/Heralloceer|Wijzig de hoofdhefboom/i.test(structured.recommendations[0]?.hypothesis || ""), "generic wording should not win");
}

console.log("13. Executive layer keeps critical anomalies out of not-the-problem");
{
  const raw = [
    finding({ step: 1, entity_type: "country", entity_name: "Duitsland", metric: "ROAS", current_value: 0.7, previous_value: 1.8, change_pct: -61, issue_cluster: "geo_allocation", severity: "critical", action_required: true }),
    finding({ step: 2, entity_type: "campaign", entity_name: "Brand Search", metric: "ROAS", current_value: 5.1, previous_value: 4.9, change_pct: 4, issue_cluster: "performance_winner", severity: "positive", action_required: false }),
  ];
  const canonical = canonicalizeFindings(raw, {
    geography: true,
    campaign: true,
    hypotheses_sprint_plan: true,
  });
  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(!structured.what_is_not_the_problem.some((item) => /duitsland/i.test(item)), "critical Germany issue should not land in not-the-problem");
}

console.log("14. Render hardening hides object-like payloads");
{
  const canonical = canonicalizeFindings([
    finding({ entity_name: "Account", entity_type: "account", metric: "ROAS", issue_cluster: "search_budget_cap" }),
  ], {
    account: true,
    hypotheses_sprint_plan: true,
  });
  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 1,
        stepName: "Account Performance",
        narrative: "{\"foo\":\"bar\"}",
        findings: [finding({ entity_name: "Account", entity_type: "account", metric: "ROAS", issue_cluster: "search_budget_cap" })],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(!/\{\"foo\":\"bar\"\}/.test(structured.appendix_markdown), "appendix should not leak raw JSON blobs");
  assert(!structured.appendix_markdown.includes("Narrative"), "appendix should no longer duplicate narrative payloads");
}

console.log("15. Appendix splits per step and strips boilerplate leads");
{
  const appendix = buildAppendixMarkdown([
    parsedStep({
      stepNumber: 1,
      stepName: "Account Performance",
      narrative: "Narrative die niet in de appendix moet terugkomen.",
      log_entries: [
        "In stap 1 stelden we vast dat branded vraag stabiel bleef. Het verschil van -18% met ROAS target is te verklaren door CVR.",
        "Het verschil van -18% met ROAS target is te verklaren door CVR.",
      ],
      findings: [finding({ step: 1, entity_name: "Account", entity_type: "account", metric: "ROAS" })],
      step_conclusion: "Account zit onder target door CVR-druk.",
    }),
    parsedStep({
      stepNumber: 2,
      stepName: "Campaign Performance",
      log_entries: ["Campagne A presteert ondergemiddeld afgelopen maand."],
      findings: [finding({ step: 2, entity_name: "Campagne A", metric: "CPA", change_pct: 44 })],
      step_conclusion: "Campagne A draagt de target-gap.",
    }),
  ]);

  assert(appendix.includes("## Stap 1: Account Performance"), "appendix should create H2 block for step 1");
  assert(appendix.includes("## Stap 2: Campaign Performance"), "appendix should create H2 block for step 2");
  assert(!appendix.includes("## Deep-dive Analytical Appendix"), "legacy deep-dive heading should be removed");
  assert(!appendix.includes("Narrative die niet in de appendix"), "appendix should not duplicate the narrative");
  assert(!appendix.includes("In stap 1 stelden we vast"), "appendix should strip boilerplate lead-ins");
  assert(appendix.includes("Conclusie: Account zit onder target door CVR-druk."), "appendix should include a step conclusion");
}

console.log("16. Coverage appendix shows signal counts with step numbers");
{
  const canonical = canonicalizeFindings([
    finding({ step: 1, entity_type: "account", entity_name: "Account", metric: "ROAS", issue_cluster: "tracking_cvr_drop" }),
    finding({ step: 2, entity_type: "campaign", entity_name: "Campagne A", metric: "CPA", issue_cluster: "search_budget_cap" }),
    finding({ step: 11, entity_type: "country", entity_name: "Duitsland", metric: "ROAS", issue_cluster: "geo_allocation" }),
  ], {
    account: true,
    campaign: true,
    geography: true,
    audience: false,
    hypotheses_sprint_plan: true,
  });

  const coverageMarkdown = buildCoverageMarkdown(canonical.coverage, [
    parsedStep({ stepNumber: 1, stepName: "Account Performance", log_entries: ["Accountlog"], findings: [finding({ step: 1, entity_type: "account", entity_name: "Account", metric: "ROAS" })] }),
    parsedStep({ stepNumber: 2, stepName: "Campaign Performance", log_entries: ["Campagnelog"], findings: [finding({ step: 2, entity_name: "Campagne A", metric: "CPA" })] }),
    parsedStep({ stepNumber: 11, stepName: "Geo Performance", log_entries: ["Geolog"], findings: [finding({ step: 11, entity_type: "country", entity_name: "Duitsland", metric: "ROAS" })] }),
  ]);

  assert(/account: gedekt \(\d+ signalen uit stap 1\)/i.test(coverageMarkdown), "account coverage should include step 1");
  assert(/campaign: gedekt \(\d+ signalen uit stap 1, 2\)|campaign: gedekt \(\d+ signalen uit stap 2\)/i.test(coverageMarkdown), "campaign coverage should include surfaced steps");
  assert(/geography: gedekt \(\d+ signalen uit stap 11\)/i.test(coverageMarkdown), "geography coverage should include step 11");
  assert(coverageMarkdown.includes("audience: data niet beschikbaar"), "data-unavailable dimensions should remain explicit");
}

console.log("17. Structured display findings keep breadth across steps");
{
  const raw = [
    finding({ step: 1, entity_type: "account", entity_name: "Account", metric: "ROAS", issue_cluster: "tracking_cvr_drop" }),
    finding({ step: 2, entity_name: "Campagne A", metric: "CPA", issue_cluster: "search_budget_cap" }),
    finding({ step: 3, entity_type: "adgroup", entity_name: "Ad Group A", metric: "CVR", issue_cluster: "desktop_inefficiency" }),
    finding({ step: 5, entity_type: "searchterm", entity_name: "gratis wc rolhouder", metric: "Wasteful Spend", issue_cluster: "search_term_waste" }),
    finding({ step: 7, entity_type: "searchterm", entity_name: "broedmachine kopen", metric: "Wasteful Spend", issue_cluster: "search_term_waste" }),
    finding({ step: 8, entity_type: "campaign", entity_name: "Creative Campaign", metric: "CTR", issue_cluster: "network_quality" }),
    finding({ step: 10, entity_type: "device", entity_name: "Mobile", metric: "CPA", issue_cluster: "mobile_opportunity" }),
    finding({ step: 11, entity_type: "country", entity_name: "Duitsland", metric: "ROAS", issue_cluster: "geo_allocation" }),
  ];
  const canonical = canonicalizeFindings(raw, {
    account: true,
    campaign: true,
    adgroup: true,
    search_term: true,
    creative: true,
    device: true,
    geography: true,
    hypotheses_sprint_plan: true,
  });
  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({ stepNumber: 1, findings: raw.filter((item) => item.step === 1) }),
      parsedStep({ stepNumber: 2, findings: raw.filter((item) => item.step === 2) }),
      parsedStep({ stepNumber: 3, findings: raw.filter((item) => item.step === 3) }),
      parsedStep({ stepNumber: 5, findings: raw.filter((item) => item.step === 5) }),
      parsedStep({ stepNumber: 7, findings: raw.filter((item) => item.step === 7) }),
      parsedStep({ stepNumber: 8, findings: raw.filter((item) => item.step === 8) }),
      parsedStep({ stepNumber: 10, findings: raw.filter((item) => item.step === 10) }),
      parsedStep({ stepNumber: 11, findings: raw.filter((item) => item.step === 11) }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  const distinctSteps = new Set(structured.display_findings.flatMap((item) => item.source_steps));
  assert(structured.display_findings.length >= 8, `display findings should surface at least 8 items when enough evidence exists, got ${structured.display_findings.length}`);
  assert(distinctSteps.size >= 6, `display findings should span at least 6 steps, got ${distinctSteps.size}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
