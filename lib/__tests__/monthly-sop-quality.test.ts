import { canonicalizeFindings } from "../analysis/canonicalize";
import {
  buildStructuredMonthlyOutput,
  computeStructuredConsistencyCounts,
  dominantRootCause,
  type StepFindingSidecar,
  validateFinalSopSynthesis,
  validateMonthlyDeliverableCompleteness,
  validateOperatingDetailLayer,
  validateRenderedFinalSopMarkdown,
  validateStructuredOutputConsistency,
} from "../analysis/monthly-structured";
import { validateStepOutput } from "../analysis/step-validator";
import { buildMonthlyQualityGate, validateMonthlyAcceptance } from "../analysis/monthly-acceptance";
import type { Finding } from "../schema/analysis-schema";
import {
  buildCoverageDimensionAvailability,
  buildStep6NoDataFallback,
  curateMonthlyStructuredFindings,
  salvageStructuredStepOutput,
  sanitizeStepActionText,
} from "../../app/api/analysis/monthly/route";

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
    metric: "ROAS",
    current_value: 0.9,
    previous_value: 1.8,
    change_pct: -50,
    severity: "critical",
    insight_type: "performance",
    is_seasonal: false,
    is_structural: true,
    cause: "Rendement zakt weg in een verlieslatend segment",
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
    stepName: "Campaign Performance",
    narrative: "Narrative",
    log_entries: ["Logregel A"],
    findings: [],
    status: "KRITIEK",
    actions: [],
    step_conclusion: "Korte stapconclusie.",
    ...overrides,
  };
}

console.log("\n=== Monthly SOP Content Quality Tests ===\n");

console.log("1. Underperformance gets containment and recovery by default");
{
  const canonical = canonicalizeFindings([
    finding({ step: 10, entity_name: "Germany", metric: "ROAS", current_value: 0.82, previous_value: 1.9, change_pct: -56.8 }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  const germanyRec = structured.recommendations.find((recommendation) => /duitsland/i.test(recommendation.hypothesis));
  assert(Boolean(germanyRec), "Germany recommendation exists");
  assert(/^Containment:/i.test(germanyRec?.hypothesis || ""), "primary route is a single containment recommendation");
  assert((germanyRec?.alternative_strategies || []).some((strategy) => strategy.mode === "containment"), "underperformer includes containment route");
  assert((germanyRec?.alternative_strategies || []).some((strategy) => strategy.mode === "recovery"), "underperformer includes recovery route");
}

console.log("2. Concrete step actions are merged into one coherent dual-route recommendation");
{
  const canonical = canonicalizeFindings([
    finding({ step: 10, entity_name: "Duitsland", metric: "ROAS", current_value: 0.78, previous_value: 1.7, change_pct: -54.1 }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 11,
        stepName: "Geo Performance",
        actions: [
          {
            actie: "Verlaag budget voor Duitsland met 50% en pauzeer DE-new",
            campagne: "Duitsland",
            deadline: "direct",
            verwachte_impact: "Beperkt direct verlies binnen 7 dagen met 35-50%.",
          },
          {
            actie: "Behoud Duitsland alleen in aparte campagne met hogere tROAS en desktop-only test",
            campagne: "Duitsland",
            deadline: "deze_week",
            verwachte_impact: "Toetst of Duitsland gecontroleerd kan herstellen zonder blended ROAS verder te drukken.",
          },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.recommendations.length === 1, `expected 1 merged recommendation, got ${structured.recommendations.length}`);
  assert(/Verlaag budget voor Duitsland met 50%/i.test(structured.recommendations[0]?.hypothesis || ""), "containment step action survives promotion");
  assert((structured.recommendations[0]?.alternative_strategies || []).some((strategy) => /Behoud Duitsland alleen in aparte campagne/i.test(strategy.action)), "recovery step action survives as alternative route");
}

console.log("3. Weak evidence downgrades readiness and labels recovery as hypothesis-driven");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 6,
      issue_cluster: "product_mix",
      entity_type: "adgroup",
      entity_name: "WC rolhouder",
      metric: "Spend",
      current_value: 160,
      previous_value: 40,
      change_pct: 300,
      evidence_level: undefined,
      confidence: "low",
      cause: "Mogelijk product- of feedprobleem, maar niet sluitend bewezen",
    }),
  ], {
    adgroup: true,
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

  const rec = structured.recommendations[0];
  assert(rec.action_readiness !== "direct_action", "weak evidence should not produce direct_action");
  assert(/hypothese-gedreven/i.test(rec.hypothesis), "weak-evidence recovery is labeled hypothesis-driven");
  assert(rec.source === "hypothesis" || rec.action_readiness === "strategic_hypothesis", "weak-evidence recovery should surface as hypothesis-like output");
}

console.log("4. Task layer splits dual-route recommendation into concrete executable tasks");
{
  const canonical = canonicalizeFindings([
    finding({ step: 2, issue_cluster: "network_quality", entity_type: "network", entity_name: "YouTube", parent_campaign: "Bestseller_RM", metric: "ROAS", current_value: 0.55, previous_value: 2.4, change_pct: -77.1 }),
  ], {
    network: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  const youtubeTasks = structured.tasks.filter((task) => /youtube/i.test(task.title) || /youtube/i.test(task.description) || /Containment:|Recovery:/i.test(task.title));
  assert(youtubeTasks.length >= 2, `dual-route recommendation should yield >=2 tasks, got ${youtubeTasks.length}`);
  assert(youtubeTasks.every((task) => /Meet via/i.test(task.description)), "task descriptions keep measurement method");
  assert(youtubeTasks.every((task) => /Voorwaarde:/i.test(task.description)), "task descriptions include validation condition");
  assert(youtubeTasks.every((task) => /Beslisregel:/i.test(task.description)), "task descriptions include stop/continue rule");
  assert(youtubeTasks.every((task) => !/Heralloceer|Wijzig de hoofdhefboom/i.test(task.title)), "task titles stay concrete");
}

console.log("5. Step validator warns when a step claims outside its own domain");
{
  const result = validateStepOutput(1, {
    narrative: "Het account zit onder target en de zoektermen tonen aan dat broad modifiers de hoofdoorzaak zijn.",
    log_entries: ["A"],
    top_3_findings: [
      finding({ step: 1, entity_type: "account", entity_name: "Account", metric: "ROAS", evidence_level: "inferred" }),
      finding({ step: 1, entity_type: "campaign", entity_name: "Brand Search", metric: "Spend", evidence_level: "inferred" }),
      finding({ step: 1, entity_type: "campaign", entity_name: "Generic Search", metric: "CVR", evidence_level: "inferred" }),
    ],
    status: "NIET OP SCHEMA",
    actions: [{ actie: "Sluit zoektermen met irrelevante modifiers uit", campagne: "Generic Search", deadline: "direct", verwachte_impact: "Minder waste spend." }],
    step_conclusion: "Zoektermen zijn de definitieve hoofdoorzaak van de accountdaling.",
  }, "");

  assert(result.warnings.some((warning) => /Step-purity/i.test(warning)), "validator should warn on out-of-domain step claim");
}

console.log("6. Unknown or weak evidence stays non-aggressive");
{
  const result = validateStepOutput(6, {
    narrative: "Er is beperkt bewijs; mogelijk speelt een feedprobleem, maar dit is te toetsen.",
    log_entries: ["A"],
    top_3_findings: [
      finding({ step: 6, issue_cluster: "product_mix", entity_type: "product", entity_name: "SKU-1", metric: "Spend", evidence_level: "unknown", confidence: "low" }),
      finding({ step: 6, issue_cluster: "product_mix", entity_type: "product", entity_name: "SKU-2", metric: "ROAS", evidence_level: "hypothesis", confidence: "low" }),
      finding({ step: 6, issue_cluster: "product_mix", entity_type: "product", entity_name: "SKU-3", metric: "CVR", evidence_level: "unknown", confidence: "low" }),
    ],
    status: "NIET OP SCHEMA",
    actions: [{ actie: "Pauzeer direct alle verlieslatende SKU's", campagne: "PMax", deadline: "direct", verwachte_impact: "Onmiddellijk minder waste." }],
    step_conclusion: "Feed of assortiment moet eerst worden getoetst voordat structurele conclusies volgen.",
  }, "Vorige stap gaf beperkt bewijs.");

  assert(result.warnings.some((warning) => /stellig|Structurele claim/i.test(warning)) || result.valid, "weak evidence should not silently pass as hard certainty");
}

console.log("7. Early-step over-specific actions lose from later step-aligned actions");
{
  const canonical = canonicalizeFindings([
    finding({ step: 7, issue_cluster: "search_term_waste", entity_type: "searchterm", entity_name: "gratis wc rolhouder", metric: "Wasteful Spend", current_value: 90, previous_value: 20, change_pct: 350 }),
  ], {
    search_term: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 1,
        stepName: "Account Performance",
        actions: [
          {
            actie: "Sluit irrelevante zoektermen direct uit op accountniveau",
            campagne: "Account",
            deadline: "direct",
            verwachte_impact: "Minder waste spend.",
          },
        ],
      }),
      parsedStep({
        stepNumber: 7,
        stepName: "Search Term Performance",
        actions: [
          {
            actie: "Sluit alleen off-catalog modifiers rond gratis wc rolhouder uit en behoud kernproducttermen",
            campagne: "Shopping",
            deadline: "direct",
            verwachte_impact: "Minder waste spend zonder relevante vraag te blokkeren.",
          },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(/off-catalog modifiers/i.test(structured.recommendations[0]?.hypothesis || ""), "later step-aligned action should outrank early broad action");
}

console.log("8. Contradictory evidence on the same entity is arbitrated before not-the-problem promotion");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 2,
      issue_cluster: "performance_winner",
      entity_type: "campaign",
      entity_name: "Broedservice Generic",
      metric: "ROAS",
      current_value: 4.4,
      previous_value: 3.6,
      change_pct: 22.2,
      severity: "positive",
      action_required: false,
      cause: "Campagne groeide efficiënt op ROAS",
    }),
    finding({
      step: 3,
      issue_cluster: "search_bidding_inflation",
      entity_type: "campaign",
      entity_name: "Broedservice Generic",
      metric: "Efficiency Ratio",
      current_value: 0.61,
      previous_value: 1.08,
      change_pct: -43.5,
      severity: "high",
      action_required: true,
      cause: "Zelfde campagne verliest efficiency door schaalfout",
    }),
  ], {
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

  const broedserviceFinding = structured.display_findings.find((item) => /broedservice generic/i.test(item.title) || /broedservice generic/i.test(item.summary));
  assert(Boolean(broedserviceFinding), "contradictory entity still surfaces as canonical display finding");
  assert(
    !structured.what_is_not_the_problem.some((item) => /broedservice generic/i.test(item)),
    "contradictory entity should not be promoted to not-the-problem"
  );
}

console.log("9. Deterministic business bottleneck beats weaker measurement risk when interpretation is still possible");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 1,
      issue_cluster: "tracking_cvr_drop",
      entity_type: "account",
      entity_name: "Account",
      metric: "CVR",
      current_value: 0.019,
      previous_value: 0.034,
      change_pct: -44.1,
      severity: "high",
      evidence_level: "inferred",
      confidence: "medium",
      cause: "Conversiemeting en funnel-signalen wijken af; tracking- of funneldefect is plausibel",
    }),
    finding({
      step: 2,
      issue_cluster: "search_budget_cap",
      entity_type: "campaign",
      entity_name: "Utrecht Brand",
      metric: "Search Lost IS (Budget)",
      current_value: 58,
      previous_value: 35,
      change_pct: 65.7,
      severity: "critical",
      evidence_level: "deterministic",
      confidence: "high",
      cause: "Budgetplafond beperkt bereik",
    }),
  ], {
    account: true,
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

  assert(!/meet|funnelkwaliteit/i.test(structured.threads[0]?.title || ""), "measurement risk should not dominate stronger deterministic business evidence");
  assert(/utrecht brand|vraag|budget/i.test(structured.threads[0]?.title || ""), "broader deterministic business issue should become primary thread");
}

console.log("10. Problem-first dedup merges branded Utrecht metrics into one canonical thread");
{
  const canonical = canonicalizeFindings([
    finding({ step: 2, issue_cluster: "search_bidding_inflation", entity_type: "campaign", entity_name: "Branded Utrecht", metric: "CPA", current_value: 45, previous_value: 28, change_pct: 60.7, severity: "high", cause: "Bieddruk stijgt in dezelfde campagne" }),
    finding({ step: 2, issue_cluster: "search_budget_cap", entity_type: "campaign", entity_name: "Branded Utrecht", metric: "Search Lost IS (Budget)", current_value: 41, previous_value: 22, change_pct: 86.3, severity: "high", cause: "Vraag wordt in dezelfde campagne afgekapt" }),
    finding({ step: 2, issue_cluster: "search_budget_cap", entity_type: "campaign", entity_name: "Branded Utrecht", metric: "Spend", current_value: 620, previous_value: 470, change_pct: 31.9, severity: "medium", cause: "Zelfde demand-capture thread trekt meer spend zonder proportioneel resultaat" }),
  ], {
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

  const brandedUtrechtFindings = structured.display_findings.filter((item) => /branded utrecht/i.test(item.title) || /branded utrecht/i.test(item.summary));
  assert(brandedUtrechtFindings.length === 1, `expected 1 canonical finding for Branded Utrecht, got ${brandedUtrechtFindings.length}`);
}

console.log("11. Prerequisite gating puts validation before bid or budget changes");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 1,
      issue_cluster: "tracking_cvr_drop",
      entity_type: "campaign",
      entity_name: "Utrecht Brand",
      metric: "CVR",
      current_value: 0.018,
      previous_value: 0.033,
      change_pct: -45.4,
      severity: "high",
      evidence_level: "inferred",
      confidence: "medium",
      cause: "Funnel- of trackingbreuk rond Utrecht Brand moet eerst worden gevalideerd",
    }),
  ], {
    campaign: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 2,
        stepName: "Campaign Performance",
        actions: [
          {
            actie: "Verhoog budget voor Utrecht Brand met 25%",
            campagne: "Utrecht Brand",
            deadline: "direct",
            verwachte_impact: "Meer volume bij gelijkblijvende CPA.",
          },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  const rec = structured.recommendations[0];
  assert(/^Validatie:/i.test(rec.hypothesis), "validation route should lead the recommendation headline");
  assert(rec.action_readiness !== "direct_action", "validation-gated recommendation should not be direct_action");
}

console.log("12. Not-the-problem hard filter excludes negative or unresolved signals");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 10,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Utrecht",
      metric: "CPA",
      current_value: 75,
      previous_value: 42,
      change_pct: 78.6,
      severity: "medium",
      action_required: true,
      cause: "CPA verslechtert in Utrecht",
    }),
    finding({
      step: 8,
      issue_cluster: "efficiency_gain",
      entity_type: "audience",
      entity_name: "Remarketing",
      metric: "ROAS",
      current_value: 5.1,
      previous_value: 4.4,
      change_pct: 15.9,
      severity: "positive",
      action_required: false,
      cause: "Remarketing blijft stabiel winstgevend",
    }),
  ], {
    geography: true,
    audience: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(
    !structured.what_is_not_the_problem.some((item) => /utrecht/i.test(item)),
    "negative action-required signal should never appear in not-the-problem"
  );
  assert(
    structured.what_is_not_the_problem.some((item) => /remarketing/i.test(item)),
    "stable positive signal may appear in not-the-problem"
  );
}

console.log("13. Nested or malformed step JSON is salvaged without contaminating downstream fields");
{
  const nested = JSON.stringify({
    output: JSON.stringify({
      narrative: "Search terms tonen 12.4% waste op beschermde modifiers.",
      log_entries: ["A"],
      top_3_findings: [
        {
          step: 7,
          issue_cluster: "search_term_waste",
          entity_type: "searchterm",
          entity_name: "gratis douchewisser",
          metric: "Wasteful Spend",
          current_value: 82,
          previous_value: 20,
          change_pct: 310,
          severity: "high",
          insight_type: "risk",
          is_seasonal: false,
          is_structural: true,
          cause: "Irrelevante modifier-intent",
          action_required: true,
          evidence_level: "inferred",
          confidence: "medium",
        },
      ],
      status: "KRITIEK",
      actions: [],
      step_conclusion: "Beschermde modifiers vragen strictere routing.",
    }),
  });

  const salvaged = salvageStructuredStepOutput(nested, 7);
  assert(Boolean(salvaged.output), "nested JSON should be salvaged");
  assert(salvaged.degraded, "nested wrapped JSON should be marked degraded");
  assert(salvaged.output?.top_3_findings[0]?.entity_name === "gratis douchewisser", "salvage keeps safe finding fields");
}

console.log("14. Structured counts stay internally consistent");
{
  const canonical = canonicalizeFindings([
    finding({ step: 10, entity_name: "Duitsland", metric: "ROAS", current_value: 0.8, previous_value: 1.7, change_pct: -52.9 }),
    finding({ step: 2, issue_cluster: "tracking_cvr_drop", entity_type: "account", entity_name: "Account", metric: "CVR", current_value: 0.02, previous_value: 0.03, change_pct: -33.3, evidence_level: "inferred", confidence: "medium", cause: "Meetbreuk beïnvloedt interpretatie" }),
  ], {
    geography: true,
    account: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  const counts = computeStructuredConsistencyCounts(structured.display_findings, structured.recommendations, structured.tasks);
  assert(counts.recommendations_count === structured.consistency_counts.recommendations_count, "stored recommendation count matches computed count");
  assert(validateStructuredOutputConsistency(structured).length === 0, "structured consistency validator should pass");
  assert(validateOperatingDetailLayer(structured.operating_detail, structured.final_sop).length === 0, "operating detail validator should pass");
  assert(validateMonthlyDeliverableCompleteness(structured).length === 0, "deliverable completeness validator should pass");
}

console.log("15. Primary root cause is a single dominant claim, not a stitched list");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 10,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Duitsland",
      metric: "ROAS",
      current_value: 0.84,
      previous_value: 1.4,
      change_pct: -40,
      cause: "Duitsland trekt disproportioneel spend zonder rendabele conversiedichtheid; maar search volume blijft aanwezig / pricing mismatch is plausibel",
    }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  const rootCause = structured.threads[0]?.root_cause_summary || "";
  assert(!/[\/]/.test(rootCause), "root cause should not contain slash-joined clauses");
  assert((rootCause.match(/;/g) || []).length <= 1, "root cause may contain at most one subordinate qualifier");
}

console.log("16. Executive root cause prefers a fuller cluster summary over an afgekapt finding fragment");
{
  const rootCause = dominantRootCause({
    findings: [
      {
        ...finding({
          step: 11,
          issue_cluster: "geo_allocation",
          entity_type: "country",
          entity_name: "Duitsland",
          metric: "CPA",
          current_value: 18.38,
          previous_value: 11,
          change_pct: 67,
          cause: "Structurele mismatch tussen aanbod",
        }),
      } as never,
    ],
    root_cause_summary: "Structurele mismatch tussen aanbod/prijs en de Duitse markt resulteert in onhoudbare CPA.; Duitsland verbruikt 25% van het budget tegen een CPA die 67% boven de target ligt.",
    evidence_summary: "Land: DE (Duitsland) CPA 18.38 (+67%)",
  } as never);

  assert(/duitse markt|onhoudbare cpa/i.test(rootCause), "executive root cause should use the fuller cluster summary when the lead finding is a fragment");
  assert(!/^Structurele mismatch tussen aanbod$/i.test(rootCause), "executive root cause should not stay semantically clipped");
}

console.log("17. Positive delta but still bad absolute level gets sign-aware problem wording");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 2,
      issue_cluster: "search_bidding_inflation",
      entity_type: "campaign",
      entity_name: "Saturday PMax",
      metric: "ROAS",
      current_value: 1.12,
      previous_value: 0.79,
      change_pct: 41.7,
      severity: "high",
      cause: "ROAS herstelt, maar blijft onder rendabele drempel",
    }),
  ], {
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

  const display = structured.display_findings.find((item) => /saturday pmax/i.test(item.title) || /saturday pmax/i.test(item.summary));
  assert(/verbetert, maar blijft onder rendementsdrempel/i.test(`${display?.title} ${display?.summary}`), "problem wording should reflect positive trend but still weak absolute state");
}

console.log("18. What-is-not-the-problem excludes items that still need caveat framing");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 8,
      issue_cluster: "efficiency_gain",
      entity_type: "audience",
      entity_name: "Remarketing",
      metric: "ROAS",
      current_value: 4.8,
      previous_value: 4.1,
      change_pct: 17.1,
      severity: "positive",
      action_required: false,
      evidence_level: "inferred",
      cause: "Remarketing presteert goed, maar mogelijk speelt beperkte datadekking mee",
    }),
  ], {
    audience: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.what_is_not_the_problem.length === 0, "caveated positive signals should stay out of not-the-problem");
}

console.log("18. Validation, containment and recovery do not collapse into one recommendation bullet");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 1,
      issue_cluster: "tracking_cvr_drop",
      entity_type: "campaign",
      entity_name: "Utrecht Brand",
      metric: "CVR",
      current_value: 0.017,
      previous_value: 0.029,
      change_pct: -41.4,
      severity: "high",
      evidence_level: "inferred",
      confidence: "medium",
      cause: "Tracking of funnelmeting moet eerst worden gevalideerd",
    }),
  ], {
    campaign: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 2,
        stepName: "Campaign Performance",
        actions: [
          { actie: "Verlaag budget voor Utrecht Brand met 20%", campagne: "Utrecht Brand", deadline: "direct", verwachte_impact: "Minder spend-lekkage." },
          { actie: "Behoud Utrecht Brand in aparte recovery-test", campagne: "Utrecht Brand", deadline: "deze_week", verwachte_impact: "Toets herstel." },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  const rec = structured.recommendations[0];
  assert((rec.hypothesis.match(/Containment:|Recovery|Validatie:/g) || []).length === 1, "recommendation headline should carry exactly one primary route");
  assert((rec.alternative_strategies || []).length >= 2, "secondary routes remain available as structured alternatives");
}

console.log("19. Unresolved contradiction does not become the primary executive thread");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 2,
      issue_cluster: "performance_winner",
      entity_type: "campaign",
      entity_name: "PMAX Saturday",
      metric: "ROAS",
      current_value: 4.3,
      previous_value: 3.1,
      change_pct: 38.7,
      severity: "positive",
      action_required: false,
      cause: "Campagne groeit efficiënt",
    }),
    finding({
      step: 3,
      issue_cluster: "search_bidding_inflation",
      entity_type: "campaign",
      entity_name: "PMAX Saturday",
      metric: "CPA",
      current_value: 41,
      previous_value: 28,
      change_pct: 46.4,
      severity: "high",
      action_required: true,
      cause: "Campagne wordt tegelijk duurder en verliest efficiency",
    }),
    finding({
      step: 1,
      issue_cluster: "tracking_cvr_drop",
      entity_type: "account",
      entity_name: "Account",
      metric: "CVR",
      current_value: 0.019,
      previous_value: 0.031,
      change_pct: -38.7,
      severity: "high",
      evidence_level: "inferred",
      confidence: "medium",
      cause: "Meetkwaliteit verstoort de interpretatie van de maand",
    }),
  ], {
    campaign: true,
    account: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(!/pmax saturday/i.test(structured.threads[0]?.title || ""), "unresolved contradictory thread should not become primary thread");
}

console.log("20. Noisy accounts keep executive surfaced findings capped and compressed");
{
  const noisyFindings = Array.from({ length: 80 }, (_, index) =>
    finding({
      step: (index % 10) + 1,
      issue_cluster: index % 2 === 0 ? "search_budget_cap" : "search_bidding_inflation",
      entity_type: "campaign",
      entity_name: `Noise Campaign ${Math.floor(index / 4)}`,
      metric: index % 4 === 0 ? "CPA" : index % 4 === 1 ? "ROAS" : index % 4 === 2 ? "CVR" : "Spend",
      current_value: 10 + index,
      previous_value: 5 + index / 2,
      change_pct: 20 + index,
      severity: index % 5 === 0 ? "critical" : "high",
      cause: "Zelfde demand-capture probleem op dezelfde campagne",
    })
  );
  const canonical = canonicalizeFindings(noisyFindings, {
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

  assert(structured.display_findings.length <= 40, `display findings should stay capped, got ${structured.display_findings.length}`);
}

console.log("21. Same business problem does not surface as separate CPA, ROAS and CVR executive findings");
{
  const canonical = canonicalizeFindings([
    finding({ step: 2, issue_cluster: "search_bidding_inflation", entity_type: "campaign", entity_name: "Branded Utrecht", metric: "CPA", current_value: 45, previous_value: 28, change_pct: 60.7, severity: "high", cause: "Zelfde demand-capture probleem" }),
    finding({ step: 2, issue_cluster: "search_bidding_inflation", entity_type: "campaign", entity_name: "Branded Utrecht", metric: "ROAS", current_value: 1.1, previous_value: 1.6, change_pct: -31.3, severity: "high", cause: "Zelfde demand-capture probleem" }),
    finding({ step: 2, issue_cluster: "search_bidding_inflation", entity_type: "campaign", entity_name: "Branded Utrecht", metric: "CVR", current_value: 0.018, previous_value: 0.027, change_pct: -33.3, severity: "high", cause: "Zelfde demand-capture probleem" }),
  ], {
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

  const brandedFindings = structured.display_findings.filter((item) => /branded utrecht/i.test(item.title) || /branded utrecht/i.test(item.summary));
  assert(brandedFindings.length === 1, `expected 1 executive finding for same business problem, got ${brandedFindings.length}`);
}

console.log("22. Final SOP markdown uses exact sections and strips legacy executive shape");
{
  const canonical = canonicalizeFindings([
    finding({ step: 11, issue_cluster: "geo_allocation", entity_type: "country", entity_name: "Duitsland", metric: "ROAS", current_value: 0.82, previous_value: 1.6, change_pct: -48.7, severity: "critical" }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(validateFinalSopSynthesis(structured.final_sop).length === 0, "final SOP quality gate should pass");
  assert(structured.executive_markdown.includes("## Primary thread"), "final SOP includes Primary thread");
  assert(structured.executive_markdown.includes("## Root cause"), "final SOP includes Root cause");
  assert(structured.executive_markdown.includes("## Supporting evidence"), "final SOP includes Supporting evidence");
  assert(structured.executive_markdown.includes("## What is NOT the problem"), "final SOP includes What is NOT the problem");
  assert(structured.executive_markdown.includes("## Recommendations"), "final SOP includes Recommendations");
  assert(structured.executive_markdown.includes("## Tasks"), "final SOP includes Tasks");
  assert(structured.executive_markdown.includes("## QA self-check"), "final SOP includes QA self-check");
  assert(!/Executive Snapshot|Top 3 Threads|Action Plan By Phase|Recommendations Overview|Task Plan/.test(structured.executive_markdown), "legacy executive sections should be gone");
  assert(structured.deliverable_markdown.includes("## Operating detail: Route-to-task mapping"), "deliverable includes route-to-task mapping");
  assert(structured.operating_detail.route_task_map.every((item) => item.supporting_evidence.length > 0), "recommendations remain traceable to evidence");
  assert(structured.operating_detail.execution_detail.every((item) => item.linked_recommendation >= 1), "tasks remain traceable to recommendations");
  assert(!/Executive Snapshot|Top 3 Threads|Action Plan By Phase|Recommendations Overview|Task Plan/.test(structured.deliverable_markdown), "deliverable should not regress to legacy executive structure");
}

console.log("23. Final SOP keeps one primary thread and one compact root cause");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 10,
      issue_cluster: "network_quality",
      entity_type: "network",
      entity_name: "YouTube",
      parent_campaign: "Bestseller_RM",
      metric: "ROAS",
      current_value: 0.56,
      previous_value: 2.8,
      change_pct: -80,
      severity: "critical",
      cause: "Video-inventory trekt lage-intentie clicks aan zonder rendabele conversie.",
    }),
    finding({
      step: 11,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Duitsland",
      metric: "CPA",
      current_value: 18.4,
      previous_value: 11.0,
      change_pct: 67.2,
      severity: "critical",
      cause: "Duitse expansie absorbeert budget tegen zwakkere conversiedichtheid.",
    }),
  ], {
    network: true,
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert((structured.final_sop.primary_thread.match(/[.!?]/g) || []).length === 1, "primary thread should stay one sentence");
  assert((structured.final_sop.root_cause.split(/[.!?]+/).filter(Boolean)).length <= 2, "root cause should stay within two sentences");
}

console.log("24. Final SOP recommendations stay single-route and tasks stay operator-grade");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 1,
      issue_cluster: "tracking_cvr_drop",
      entity_type: "campaign",
      entity_name: "Branded Utrecht",
      metric: "CVR",
      current_value: 0.015,
      previous_value: 0.031,
      change_pct: -51.6,
      severity: "high",
      evidence_level: "inferred",
      confidence: "medium",
      cause: "Meting of funnelbreuk verstoort de interpretatie van branded Utrecht.",
    }),
  ], {
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

  assert(structured.final_sop.recommendations.every((item) => ["validation", "containment", "recovery", "controlled scale"].includes(item.route)), "final SOP recommendations should be single-route");
  assert(structured.final_sop.recommendations.every((item) => item.handeling && item.object && item.meet_via && item.voorwaarde && item.beslisregel && item.risico), "recommendations should keep all operational fields");
  assert(structured.final_sop.tasks.every((item) => item.linked_recommendation >= 1), "tasks should link to recommendation");
  assert(structured.final_sop.tasks.every((item) => item.handeling && item.object && item.meet_via && item.voorwaarde && item.beslisregel && item.risico), "tasks should keep operator-grade fields");
}

console.log("25. Geo side-thread cannot beat broader deterministic scaling failure");
{
  const canonical = canonicalizeFindings([
    finding({ step: 2, issue_cluster: "product_mix", entity_type: "product", entity_name: "Standard (PMAX Broedmachine)", metric: "CVR", current_value: 0.0279, previous_value: 0.2222, change_pct: -87.4, severity: "critical", cause: "Agressieve schaling trok minder relevant verkeer de campagne in." }),
    finding({ step: 7, issue_cluster: "search_term_waste", entity_type: "searchterm", entity_name: "kippenvoerbak", metric: "Spend", current_value: 39.24, previous_value: null, change_pct: null, severity: "high", cause: "Brede relevante term landt in een zwakke routinglaag." }),
    finding({ step: 11, issue_cluster: "geo_allocation", entity_type: "country", entity_name: "België (BE)", metric: "ROAS", current_value: 3.18, previous_value: 4.92, change_pct: -35.4, severity: "high", cause: "België absorbeert schaal minder efficiënt dan NL." }),
  ], {
    pmax_product_asset_groups: true,
    search_term: true,
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(!/belgi/i.test(structured.final_sop.primary_thread), "Belgium should not become false primary thread when broader scaling failure dominates");
}

console.log("26. Rendered final SOP blocks duplicated instruction fragments and empty alternative routes");
{
  const canonical = canonicalizeFindings([
    finding({ step: 7, issue_cluster: "search_term_waste", entity_type: "searchterm", entity_name: "fit fysiotherapie", metric: "CVR", current_value: 0, previous_value: 0.013, change_pct: -100, severity: "critical", cause: "Branded high-intent verkeer breekt na de klik." }),
  ], {
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

  const renderedValidation = validateRenderedFinalSopMarkdown(structured.final_sop.markdown);
  assert(renderedValidation.errors.length === 0, `rendered final SOP should pass markdown gate, got: ${renderedValidation.errors.join("; ")}`);
  assert(!/Alternative route:\s*$/m.test(structured.final_sop.markdown), "empty alternative route line should not render");
  assert(!/Continueer alleen als doorzetten alleen als|Ga alleen door .* ga pas door/i.test(structured.final_sop.markdown), "duplicated instruction fragments should be removed");
}

console.log("27. Final SOP cardinality stays compact on executive output");
{
  const canonical = canonicalizeFindings([
    finding({ step: 3, issue_cluster: "geo_allocation", entity_type: "country", entity_name: "Duitsland", metric: "ROAS", current_value: 0.83, previous_value: 1.6, change_pct: -48, severity: "critical" }),
    finding({ step: 2, issue_cluster: "network_quality", entity_type: "network", entity_name: "YouTube", parent_campaign: "Bestseller_RM", metric: "ROAS", current_value: 0.56, previous_value: 2.79, change_pct: -80, severity: "critical" }),
    finding({ step: 10, issue_cluster: "mobile_opportunity", entity_type: "device", entity_name: "Mobile", metric: "CVR", current_value: 0.01, previous_value: 0.04, change_pct: -75, severity: "high" }),
  ], {
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

  const renderedValidation = validateRenderedFinalSopMarkdown(structured.final_sop.markdown);
  assert(renderedValidation.recommendationCount >= 3 && renderedValidation.recommendationCount <= 4, "executive recommendations stay capped at 3-4");
  assert(renderedValidation.taskCount >= 3 && renderedValidation.taskCount <= 6, "executive tasks stay capped at 3-6");
}

console.log("28. Cross-step allocative mechanism beats network symptom as primary thread");
{
  const canonical = canonicalizeFindings([
    finding({ step: 2, issue_cluster: "pmax_cannibalization", entity_type: "campaign", entity_name: "PMAX Best Sellers", metric: "Spend", current_value: 4200, previous_value: 320, change_pct: 1212, severity: "critical", cause: "Budget schuift disproportioneel naar brede expansie zonder rendabele volumekwaliteit." }),
    finding({ step: 6, issue_cluster: "product_mix", entity_type: "product", entity_name: "Standard", metric: "CVR", current_value: 0.028, previous_value: 0.222, change_pct: -87.4, severity: "critical", cause: "Schaling verdund de winstgevende kern met zwakke inventory." }),
    finding({ step: 12, issue_cluster: "network_quality", entity_type: "network", entity_name: "YouTube", parent_campaign: "PMAX Best Sellers", metric: "ROAS", current_value: 0.55, previous_value: 2.4, change_pct: -77.1, severity: "high", cause: "Video-inventory is een symptoom van bredere allocatiefout." }),
  ], {
    campaign: true,
    pmax_product_asset_groups: true,
    network: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(!/youtube/i.test(structured.final_sop.primary_thread), "network symptom should not become primary thread when allocative mechanism is stronger");
}

console.log("29. Duplicate containment recommendations collapse into one route");
{
  const canonical = canonicalizeFindings([
    finding({ step: 11, issue_cluster: "geo_allocation", entity_type: "country", entity_name: "Duitsland", metric: "ROAS", current_value: 0.82, previous_value: 1.6, change_pct: -48.7, severity: "critical" }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 11,
        stepName: "Geo Performance",
        actions: [
          { actie: "Verlaag Duitsland budget naar €100 per dag", campagne: "Duitsland", deadline: "direct", verwachte_impact: "Minder spend-lekkage." },
          { actie: "Verlaag Duitsland budget naar €110 per dag", campagne: "Duitsland", deadline: "direct", verwachte_impact: "Minder spend-lekkage." },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  const containmentRecs = structured.final_sop.recommendations.filter((item) => item.route === "containment");
  assert(containmentRecs.length === 1, `duplicate containment routes should collapse to one, got ${containmentRecs.length}`);
}

console.log("30. Final tasks contain no evaluation placeholders");
{
  const canonical = canonicalizeFindings([
    finding({ step: 7, issue_cluster: "search_term_waste", entity_type: "searchterm", entity_name: "gratis wc rolhouder", metric: "Spend", current_value: 90, previous_value: 20, change_pct: 350, severity: "critical" }),
  ], {
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

  assert(structured.final_sop.tasks.every((item) => !/^(Evalueer|Monitor|Bekijk)\b/i.test(item.handeling)), "final tasks should not be placeholder evaluation tasks");
}

console.log("31. Quality gate blocks invalid steps before a green monthly export flow");
{
  const acceptance = validateMonthlyAcceptance({
    narrativeSteps: Array.from({ length: 13 }, (_, index) => ({
      stepNumber: index + 1,
      stepName: `Stap ${index + 1}`,
      output: "Narrative",
      model: "test",
      tokensUsed: 1,
      saved: false,
      latencyMs: 1,
      retries: 0,
    })),
    recommendations: [],
    tasks: [],
    coverage: [{
      dimension: "campaign",
      status: "covered",
      findings_surfaced: 1,
      surfaced_cluster_ids: [],
      data_available: true,
      note: "Campagnesignaal aanwezig.",
    }],
    findings: [],
    checkpointsRun: 3,
    stepValidations: [
      { stepNumber: 12, valid: false, warnings: [], errors: ["Geen log entries gevonden"] },
    ],
  });
  const gate = buildMonthlyQualityGate({
    stepValidations: [{ stepNumber: 12, valid: false, warnings: [], errors: ["Geen log entries gevonden"] }],
    acceptance,
  });

  assert(!gate.passed, "quality gate should fail when a final step is invalid");
  assert(gate.state === "blocked_invalid_steps", `expected blocked_invalid_steps, got ${gate.state}`);
  assert(gate.invalid_steps.includes(12), "invalid step 12 should be listed");
}

console.log("32. Coverage truth stays true when campaign signal only comes through prepared context");
{
  const availability = buildCoverageDimensionAvailability({
    campaignData: [],
    campaignMetaData: [{ campaign_name: "Brand Search" }],
    adgroupData: [],
    isData: [],
    searchData: [],
    creativeData: [],
    audienceData: [],
    deviceData: [],
    countryData: [],
    networkData: [],
    scheduleData: [],
    enrichment: { dimensionProfile: { dimensions: new Map() } },
    preparedContext: {
      comparison_facts_campaigns: [{ campaignName: "Brand Search" }] as never,
      comparison_facts_adgroups: [],
    } as never,
  });

  assert(availability.campaign === true, "campaign availability should stay true with prepared campaign context");
}

console.log("33. Final SOP recommendation surface stays aligned with the dominant thread");
{
  const canonical = canonicalizeFindings([
    finding({ step: 11, issue_cluster: "geo_allocation", entity_type: "country", entity_name: "Duitsland", metric: "ROAS", current_value: 0.81, previous_value: 1.7, change_pct: -52.3, severity: "critical", cause: "Duitsland trekt disproportioneel spend zonder rendement." }),
    finding({ step: 10, issue_cluster: "desktop_inefficiency", entity_type: "device", entity_name: "Desktop", metric: "CPA", current_value: 55, previous_value: 24, change_pct: 129.2, severity: "high", cause: "Desktop is secundair zwak binnen hetzelfde account." }),
  ], {
    geography: true,
    device: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 10,
        stepName: "Device Performance",
        actions: [
          {
            actie: "Verlaag desktop bieddruk in Duitsland",
            campagne: "Duitsland",
            deadline: "direct",
            verwachte_impact: "Beperkt device-lekkage.",
          },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(/duitsland/i.test(structured.final_sop.primary_thread), "primary thread should stay on Duitsland");
  assert(structured.final_sop.recommendations.some((recommendation) => /duitsland/i.test(recommendation.object)), "at least one final recommendation should stay on the dominant geo surface");
}

console.log("34. Decision rules keep metric acronyms clean");
{
  const canonical = canonicalizeFindings([
    finding({ step: 11, issue_cluster: "geo_allocation", entity_type: "country", entity_name: "Duitsland", metric: "ROAS", current_value: 0.82, previous_value: 1.7, change_pct: -51.8, severity: "critical" }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 11,
        stepName: "Geo Performance",
        actions: [
          {
            actie: "Verlaag Duitsland budget gecontroleerd",
            campagne: "Duitsland",
            deadline: "direct",
            verwachte_impact: "ROAS herstelt sneller.",
          },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.final_sop.recommendations.every((recommendation) => !/\brOAS\b|\bcPA\b/.test(recommendation.beslisregel)), "decision rules should preserve metric acronyms");
}

console.log("35. Step 12 keeps scoped no-data note without invalidating deterministic schedule/network findings");
{
  const result = validateStepOutput(12, {
    narrative: "Checkout funnel data is niet beschikbaar. Schedule toont dat donderdagmiddag zwak is en YouTube lekt rendement weg.",
    log_entries: [
      "Checkout funnel data niet beschikbaar.",
      "YOUTUBE presteerde afgelopen maand ondergemiddeld op ROAS.",
    ],
    top_3_findings: [
      finding({ step: 12, issue_cluster: "network_quality", entity_type: "network", entity_name: "YouTube", metric: "ROAS", evidence_level: "deterministic" }),
      finding({ step: 12, issue_cluster: "schedule_waste", entity_type: "schedule", entity_name: "Thursday 13:00-15:00", metric: "CPA", evidence_level: "deterministic", severity: "high" }),
      finding({ step: 12, issue_cluster: "performance_winner", entity_type: "schedule", entity_name: "Sunday 10:00-12:00", metric: "ROAS", evidence_level: "deterministic", severity: "positive", action_required: false }),
    ],
    status: "KRITIEK",
    actions: [{ actie: "Sluit YouTube inventory uit", campagne: "Bestseller_RM", deadline: "deze_week", verwachte_impact: "Minder waste." }],
    step_conclusion: "Schedule en network verklaren de resterende inefficiëntie.",
  }, "Vorige stap.", {
    availability: {
      step: 12,
      dimensions: [
        { name: "Checkout data", available: false, rowCount: 0 },
        { name: "Schedule data", available: true, rowCount: 12 },
        { name: "Network data", available: true, rowCount: 3 },
      ],
      promptNote: "Checkout ontbreekt, schedule en network zijn beschikbaar.",
    },
  });

  assert(result.valid, "step 12 should stay valid when only checkout is unavailable");
  assert(result.errors.length === 0, "scoped checkout no-data note should not invalidate schedule/network findings");
}

console.log("36. Unrelated promoted actions cannot hijack final executive recommendation surface");
{
  const canonical = canonicalizeFindings([
    finding({ step: 11, issue_cluster: "geo_allocation", entity_type: "country", entity_name: "Duitsland", metric: "ROAS", current_value: 0.78, previous_value: 1.65, change_pct: -52.7, severity: "critical", cause: "Duitsland absorbeert spend zonder rendementsmatch." }),
    finding({ step: 11, issue_cluster: "geo_allocation", entity_type: "adgroup", entity_name: "DE Shopping Core", metric: "ROAS", current_value: 0.92, previous_value: 1.6, change_pct: -42.5, severity: "high", cause: "Zelfde landprobleem toont zich ook in de DE ad group." }),
    finding({ step: 8, issue_cluster: "creative_mismatch", entity_type: "creative", entity_name: "DE Hero Asset", metric: "ROAS", current_value: 0.55, previous_value: 1.2, change_pct: -54.2, severity: "high", cause: "DE creative trekt irrelevante traffic." }),
  ], {
    geography: true,
    creative: true,
    adgroup: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 4,
        stepName: "Auction Insights",
        actions: [
          {
            actie: "Verlaag het tROAS doel van Shopping-bleeder_RM met 10%",
            campagne: "Shopping-bleeder_RM",
            deadline: "direct",
            verwachte_impact: "Meer volume op een winstgevende campagne.",
          },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(/duitsland/i.test(structured.final_sop.primary_thread), "primary thread should stay on Duitsland");
  assert(structured.final_sop.recommendations.every((recommendation) => /duitsland|de /i.test(`${recommendation.object} ${recommendation.handeling}`)), "final recommendations should stay on the Duitsland surface");
}

console.log("37. Monthly finding curation removes meta data-availability noise first");
{
  const canonical = canonicalizeFindings([
    finding({ step: 5, entity_type: "account", entity_name: "Account", metric: "Data Availability", issue_cluster: "uncategorized", severity: "medium", cause: "Datagap." }),
    ...Array.from({ length: 31 }, (_, index) =>
      finding({
        step: 11,
        entity_type: "country",
        entity_name: `Land ${index + 1}`,
        metric: "ROAS",
        issue_cluster: "geo_allocation",
        severity: index < 5 ? "critical" : "medium",
        action_required: true,
      })
    ),
  ], {
    account: true,
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const curated = curateMonthlyStructuredFindings(canonical.findings);
  assert(curated.length <= 30, `curated findings should stay at or below 30, got ${curated.length}`);
  assert(curated.every((finding) => finding.metric !== "Data Availability"), "data availability meta finding should be removed from structured findings");
}

console.log("38. Legacy executive validator only blocks legacy headings, not incidental body phrases");
{
  const canonical = canonicalizeFindings([
    finding({ step: 11, issue_cluster: "geo_allocation", entity_type: "country", entity_name: "Duitsland", metric: "CPA", current_value: 18, previous_value: 11, change_pct: 63.6, severity: "critical", cause: "Duitsland trekt disproportioneel spend zonder rendementsmatch." }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 13,
        stepName: "Hypotheses & Sprintplanning",
        narrative: "De sprint houdt een task plan aan voor Duitsland zonder terug te vallen naar legacy headings.",
        log_entries: ["Task plan blijft hier gewone bodytekst en geen heading."],
        findings: [],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(validateStructuredOutputConsistency(structured).length === 0, "incidental body phrases should not trip the legacy executive heading gate");
}

console.log("39. Root cause sentence counter does not split on decimals");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 11,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Duitsland",
      metric: "CPA",
      current_value: 18.38,
      previous_value: 11,
      change_pct: 67,
      severity: "critical",
      cause: "Duitsland maakt 31.6% van het budget onrendabel doordat de CPA €18.38 bedraagt.",
    }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(validateFinalSopSynthesis(structured.final_sop).length === 0, "decimal values in root cause should not trip the sentence-count validator");
}

console.log("40. Executive geo thread uses the Germany surface directly");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 11,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Duitsland",
      metric: "ROAS",
      current_value: 0.83,
      previous_value: 1.55,
      change_pct: -46.5,
      severity: "critical",
      cause: "Duitsland absorbeert disproportioneel budget zonder rendementsmatch.",
    }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(/duitsland/i.test(structured.final_sop.primary_thread), "primary thread should stay on the Germany surface");
  assert(!/Geo-allocatie rond Land:/i.test(structured.final_sop.primary_thread), "primary thread should avoid awkward geo-allocation boilerplate");
}

console.log("41. Executive root cause combines mechanism and business impact when both exist");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 1,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "DE",
      metric: "ROAS",
      current_value: 0.83,
      previous_value: 1.4,
      change_pct: -40.7,
      severity: "critical",
      cause: "Duitsland absorbeert 31.6% van het budget tegen een onacceptabele ROAS van 0.83x en CPA van €24.51.",
    }),
    finding({
      step: 11,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Duitsland",
      metric: "CPA",
      current_value: 18.38,
      previous_value: 11,
      change_pct: 67,
      severity: "critical",
      cause: "Structurele markt-mismatch met extreem lage CVR in Duitsland ondanks expansie-ambitie.",
    }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(/markt-mismatch/i.test(structured.final_sop.root_cause), "root cause should keep the causal mechanism");
  assert(/31\.6% van het budget|0\.83x|24\.51/i.test(structured.final_sop.root_cause), "root cause should keep the business impact");
}

console.log("42. What is NOT the problem falls back to a stable positive signal");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 11,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Duitsland",
      metric: "ROAS",
      current_value: 0.82,
      previous_value: 1.55,
      change_pct: -47.1,
      severity: "critical",
      cause: "Duitsland blijft verlieslatend.",
    }),
    finding({
      step: 11,
      issue_cluster: "efficiency_gain",
      entity_type: "country",
      entity_name: "Nederland",
      metric: "ROAS",
      current_value: 2.64,
      previous_value: 2.41,
      change_pct: 9.5,
      severity: "positive",
      action_required: false,
      cause: "Nederland blijft winstgevend met stabiele vraagkwaliteit.",
    }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.final_sop.what_is_not_the_problem.length >= 1, "not-the-problem should not stay empty when a stable positive signal exists");
  assert(/nederland/i.test(structured.final_sop.what_is_not_the_problem[0] || ""), "not-the-problem should name the stable positive surface");
}

console.log("43. Executive recommendations keep dependency framing and clean decision rules");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 11,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Duitsland",
      metric: "ROAS",
      current_value: 0.8,
      previous_value: 1.5,
      change_pct: -46.7,
      severity: "critical",
      cause: "Duitsland absorbeert spend zonder rendementsmatch.",
    }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 11,
        stepName: "Geo Performance",
        actions: [
          {
            actie: "Verlaag budget voor Duitsland met 40%",
            campagne: "Duitsland",
            deadline: "direct",
            verwachte_impact: "Beperkt directe spend-lekkage.",
          },
          {
            actie: "Behoud Duitsland alleen in aparte campagne met hogere tROAS",
            campagne: "Duitsland",
            deadline: "deze_week",
            verwachte_impact: "Toetst gecontroleerd herstel.",
          },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  const recovery = structured.final_sop.recommendations.find((item) => item.route === "recovery");
  const scale = structured.final_sop.recommendations.find((item) => item.route === "controlled scale");
  assert(/Start pas nadat containment/i.test(recovery?.voorwaarde || ""), "recovery should depend on successful containment first");
  assert(/hersteltest/i.test(scale?.voorwaarde || ""), "controlled scale should depend on a successful recovery test");
  assert(structured.final_sop.recommendations.every((item) => !/schaal alleen door als schaal alleen door als/i.test(item.beslisregel)), "decision rules should stay free of duplicated scale phrases");
  assert(/Recommendation 1 \((validation|containment|recovery|controlled scale)\)/i.test(structured.final_sop.markdown), "executive markdown should label recommendation routes explicitly");
}

console.log("44. Broader campaign diagnosis beats a narrow search-term hook when business impact is higher");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 7,
      issue_cluster: "search_term_waste",
      entity_type: "searchterm",
      entity_name: "kippenvoerbak",
      parent_campaign: "Catch-all Shopping",
      metric: "CPA",
      current_value: 39.24,
      previous_value: 18.1,
      change_pct: 116.8,
      severity: "high",
      cause: "Brede term overschrijdt de CPA-doelstelling zonder conversie.",
    }),
    finding({
      step: 2,
      issue_cluster: "product_mix",
      entity_type: "campaign",
      entity_name: "PMAX Broedmachine @ Best Sellers",
      metric: "CVR",
      current_value: 0.27,
      previous_value: 2.12,
      change_pct: -87.0,
      severity: "critical",
      cause: "Extreme spend-schaling leidt tot CVR-verwatering en rendementsval op campagneniveau.",
    }),
  ], {
    search_term: true,
    campaign: true,
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

  assert(!/zoektermverspilling/i.test(structured.final_sop.primary_thread), `search-term hook should not dominate the executive primary thread, got "${structured.final_sop.primary_thread}"`);
  assert(/pmax|campagne/i.test(structured.final_sop.primary_thread), "broader campaign diagnosis should become the executive thread");
}

console.log("45. What is NOT the problem falls back to a rejected alternative thread when no clean positive exists");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 11,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Duitsland",
      metric: "ROAS",
      current_value: 0.82,
      previous_value: 1.55,
      change_pct: -47.1,
      severity: "critical",
      cause: "Duitsland blijft verlieslatend.",
    }),
    finding({
      step: 10,
      issue_cluster: "network_quality",
      entity_type: "network",
      entity_name: "YouTube",
      parent_campaign: "Bestseller_RM",
      metric: "ROAS",
      current_value: 0.44,
      previous_value: 1.23,
      change_pct: -64.2,
      severity: "high",
      cause: "YouTube lekt budget weg maar blijft secundair aan de geo-diagnose.",
    }),
  ], {
    geography: true,
    network: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.final_sop.what_is_not_the_problem.length >= 1, "not-the-problem should not stay empty when a safe rejected alternative exists");
  assert(/lagere business impact dan de gekozen hoofdthread/i.test(structured.final_sop.what_is_not_the_problem[0] || ""), "fallback not-the-problem should explain why the alternative is not primary");
}

console.log("46. Executive sentence hygiene keeps numbered campaign labels intact");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 2,
      issue_cluster: "brand_leakage",
      entity_type: "campaign",
      entity_name: "1. brand_RM",
      metric: "CVR",
      current_value: 0.0105,
      previous_value: 0.15,
      change_pct: -93,
      severity: "critical",
      cause: "Extreme CVR drop in brand campagne suggereert tracking issues of verwatering door non-brand verkeer.",
    }),
  ], {
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

  assert(/brand_RM/i.test(structured.final_sop.primary_thread), `primary thread should keep the full campaign label, got "${structured.final_sop.primary_thread}"`);
  assert(!/^Campagne:\s*1\.\s*$/i.test(structured.final_sop.primary_thread), "primary thread should not truncate to 'Campagne: 1.'");
}

console.log("47. Executive evidence does not render impossible CVR percentages");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 2,
      issue_cluster: "brand_leakage",
      entity_type: "campaign",
      entity_name: "1. brand_RM",
      metric: "CVR",
      current_value: 1.05,
      previous_value: 15,
      change_pct: -93,
      severity: "critical",
      cause: "Brandverkeer converteert nauwelijks nog.",
    }),
  ], {
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

  assert(!/10500\.00%/.test(structured.final_sop.markdown), "executive markdown should not multiply already-percent CVR values");
}

console.log("48. Geo thread beats a generic PMAX diagnosis when country evidence is broader");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 2,
      issue_cluster: "pmax_cannibalization",
      entity_type: "campaign",
      entity_name: "Bestseller_RM",
      metric: "Impressies",
      current_value: 303139,
      previous_value: 73931,
      change_pct: 310.4,
      severity: "high",
      cause: "Enorme impressie-groei bij gelijkblijvende SIS duidt op expansie naar laag-converterende netwerken of zoektermen.",
    }),
    finding({
      step: 11,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Duitsland",
      metric: "ROAS",
      current_value: 0.83,
      previous_value: 1.6,
      change_pct: -48.1,
      severity: "critical",
      cause: "Mismatch tussen hoge CTR en lage CVR in Duitsland houdt structureel verlieslatende spend in stand.",
    }),
    finding({
      step: 3,
      issue_cluster: "geo_allocation",
      entity_type: "adgroup",
      entity_name: "DE (Shopping-bleeder_RM)",
      metric: "CPA",
      current_value: 24.51,
      previous_value: 13.4,
      change_pct: 82.9,
      severity: "high",
      cause: "DE-adgroup bevestigt hetzelfde Germany-probleem op adgroup-niveau.",
    }),
  ], {
    campaign: true,
    geography: true,
    adgroup: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(/duitsland/i.test(structured.final_sop.primary_thread), `geo surface should outrank generic PMAX diagnosis, got "${structured.final_sop.primary_thread}"`);
  assert(!/^PMax /i.test(structured.final_sop.primary_thread), "generic PMAX thread should not dominate when Germany evidence is broader");
}

console.log("49. Executive root cause does not duplicate the same clause");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 7,
      issue_cluster: "search_term_waste",
      entity_type: "searchterm",
      entity_name: "fysio haarlem",
      metric: "CPA",
      current_value: null,
      previous_value: null,
      change_pct: null,
      severity: "high",
      cause: "Hoge CTR (8.17%) suggereert relevantie, maar 0% CVR wijst op een landing page mismatch of te brede intentie voor de huidige biedstrategie.",
    }),
  ], {
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

  assert(!/Hoge CTR \(8\.17%\).*Hoge CTR \(8\.17%\)/i.test(structured.final_sop.root_cause), `root cause should not duplicate the same clause, got "${structured.final_sop.root_cause}"`);
}

console.log("50. Executive recommendations and tasks stay on the same surface as the primary Fit thread");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 7,
      issue_cluster: "search_term_waste",
      entity_type: "keyword",
      entity_name: "fysiotherapie rotterdam",
      metric: "CPA",
      current_value: 156.45,
      previous_value: 48.2,
      change_pct: 224.5,
      severity: "critical",
      cause: "Keyword verbrandt budget zonder rendementsmatch na een te brede routing.",
    }),
  ], {
    search_term: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 7,
        stepName: "Search Terms",
        actions: [
          {
            actie: "Verlaag budget op fit fysiotherapie (Utrecht) totdat routing is opgeschoond",
            campagne: "fit fysiotherapie (Utrecht)",
            deadline: "deze_week",
            verwachte_impact: "Beperkt waste spend.",
          },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(/rotterdam/i.test(structured.final_sop.primary_thread), `primary thread should stay on the Rotterdam surface, got "${structured.final_sop.primary_thread}"`);
  assert(structured.final_sop.recommendations.every((item) => /rotterdam/i.test(`${item.object} ${item.handeling}`)), "final recommendations should stay on the primary Rotterdam surface");
  assert(structured.final_sop.tasks.every((item) => /rotterdam/i.test(`${item.object} ${item.handeling}`)), "final tasks should stay on the same executive surface");
}

console.log("51. Not-the-problem fallback is rendered into final stored markdown");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 11,
      issue_cluster: "geo_allocation",
      entity_type: "country",
      entity_name: "Duitsland",
      metric: "ROAS",
      current_value: 0.82,
      previous_value: 1.55,
      change_pct: -47.1,
      severity: "critical",
      cause: "Duitsland blijft verlieslatend.",
    }),
    finding({
      step: 10,
      issue_cluster: "network_quality",
      entity_type: "network",
      entity_name: "YouTube",
      parent_campaign: "Bestseller_RM",
      metric: "ROAS",
      current_value: 0.44,
      previous_value: 1.23,
      change_pct: -64.2,
      severity: "high",
      cause: "YouTube lekt budget weg maar blijft secundair aan de geo-diagnose.",
    }),
  ], {
    geography: true,
    network: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.final_sop.what_is_not_the_problem.length >= 1, "final stored output should keep a not-the-problem bullet");
  assert(!/Geen expliciete schone positive signalen geselecteerd/i.test(structured.final_sop.markdown), "executive markdown should not fall back to the generic placeholder when safe alternatives exist");
}

console.log("52. Step 6 no-data fallback stays validator-safe and evidence-consistent");
{
  const fallback = buildStep6NoDataFallback();
  const validation = validateStepOutput(6, {
    narrative: fallback.narrative,
    log_entries: fallback.log_entries,
    top_3_findings: fallback.findings,
    status: fallback.status,
    actions: fallback.actions,
    step_conclusion: fallback.step_conclusion,
  }, "", {
    availability: {
      step: 6,
      dimensions: [{ name: "Product data", available: false, rowCount: 0 }],
      promptNote: "Let op: Product data niet beschikbaar.",
    },
  });

  assert(validation.valid, `step 6 no-data fallback should validate cleanly, got ${validation.errors.join("; ")}`);
  assert(fallback.findings.length === 0, "step 6 no-data fallback should not emit deterministic findings");
}

console.log("53. Step 2 action phrasing is sanitized away from forbidden verbs");
{
  const rawAction = "Voeg de merknaam toe als negatief zoekwoord op accountniveau (of PMAX exclusion list) om de cannibalisatie van '1. brand_RM' door PMAX te onderzoeken.";
  const sanitized = sanitizeStepActionText(2, rawAction);
  const validation = validateStepOutput(2, {
    narrative: "Campagneverschillen tonen een duidelijke allocatiefout.",
    log_entries: ["Campagne A presteert ondergemiddeld."],
    top_3_findings: [
      finding({ step: 2, issue_cluster: "pmax_cannibalization", entity_type: "campaign", entity_name: "1. brand_RM", metric: "CPA", evidence_level: "inferred" }),
      finding({ step: 2, issue_cluster: "pmax_cannibalization", entity_type: "campaign", entity_name: "5. PMAX High potentials | > 30", metric: "Spend", evidence_level: "inferred" }),
      finding({ step: 2, issue_cluster: "search_budget_cap", entity_type: "campaign", entity_name: "1. brand_RM", metric: "Search Lost IS (Budget)", evidence_level: "inferred" }),
    ],
    status: "NIET OP SCHEMA",
    actions: [{
      actie: sanitized,
      campagne: "1. brand_RM",
      deadline: "deze_week",
      verwachte_impact: "Valideert en begrenst cannibalisatie op campagneniveau.",
    }],
    step_conclusion: "Campagneverschillen wijzen op PMAX-kannibalisatie rond brand verkeer.",
  }, "");

  assert(!/\bonderzoek|analyseer|optimaliseer|consolideer/i.test(sanitized), `sanitized action should remove forbidden verbs, got "${sanitized}"`);
  assert(validation.valid, `sanitized step 2 action should validate cleanly, got ${validation.errors.join("; ")}`);
}

console.log("54. Hypotheses are surfaced explicitly in the deliverable layer");
{
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
      cause: "Budgetcap blokkeert schaling van een gezond segment.",
    }),
  ], {
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

  assert(structured.operating_detail.hypotheses_and_next_month_proof.length >= 1, "operating detail should expose explicit hypotheses");
  assert(structured.deliverable_markdown.includes("## Operating detail: Hypotheses and next-month proof"), "deliverable should render explicit hypothesis section");
}

console.log("55. Hypotheses stay in normal Dutch, remain pending by default and expose proof fields");
{
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
      cause: "Budgetcap blokkeert schaling van een gezond segment.",
    }),
  ], {
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

  const firstHypothesis = structured.operating_detail.hypotheses_and_next_month_proof[0];
  const sentences = firstHypothesis.hypothesis.split(".").map((part) => part.trim()).filter(Boolean);
  assert(sentences.length <= 2, "hypothesis should stay within two sentences");
  assert(/^Als /i.test(firstHypothesis.hypothesis), "hypothesis should start with a Dutch causal expectation");
  assert(!/dan moet/i.test(firstHypothesis.hypothesis), "hypothesis should not use command language");
  assert(firstHypothesis.status === "pending", "new hypotheses should default to pending");
  assert(firstHypothesis.accepted_into_sprint === false, "new hypotheses should not enter sprint implicitly");
  assert(firstHypothesis.rejected_reason === null, "new hypotheses should not start rejected");
  assert(firstHypothesis.success_metrics.length > 0, "hypothesis should expose success metrics");
  assert(firstHypothesis.guardrail_metrics.length > 0, "hypothesis should expose guardrail metrics");
  assert(firstHypothesis.evaluation_window.length > 0, "hypothesis should expose evaluation window");
  assert(firstHypothesis.accept_if.length > 0, "hypothesis should expose accept criteria");
  assert(firstHypothesis.reject_if.length > 0, "hypothesis should expose reject criteria");
}

console.log("56. Executive recommendations stay on the primary PMAX surface in diffuse cases");
{
  const canonical = canonicalizeFindings([
    finding({
      step: 2,
      issue_cluster: "uncategorized",
      entity_type: "campaign",
      entity_name: "2. PMAX_Behandeling",
      metric: "CVR",
      current_value: 2.17,
      previous_value: 3.41,
      change_pct: -36.36,
      severity: "critical",
      cause: "Conversie-lekkage binnen PMAX drukt het campagne-rendement.",
    }),
    finding({
      step: 10,
      issue_cluster: "mobile_opportunity",
      entity_type: "device",
      entity_name: "CONNECTED_TV",
      parent_campaign: "2. PMAX_Behandeling",
      metric: "CVR",
      current_value: 0,
      previous_value: 0.3,
      change_pct: -100,
      severity: "high",
      cause: "CTV inventory levert geen rendement op.",
    }),
  ], {
    campaign: true,
    device: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 3,
        stepName: "Ad Group Performance",
        actions: [
          {
            actie: "Controleer de asset-kwaliteit en signalen in '2. PMAX_Behandeling' vanwege de CTR daling.",
            campagne: "2. PMAX_Behandeling",
            deadline: "deze_week",
            verwachte_impact: "Stabiliseert campagnekwaliteit.",
          },
          {
            actie: "Pauzeer keyword 'voorkeurshouding baby' (Phrase) in campagne kinderfysiotherapie - Rotterdam.",
            campagne: "kinderfysiotherapie - Rotterdam",
            deadline: "deze_week",
            verwachte_impact: "Bespaart waste spend.",
          },
          {
            actie: "Stel een negatieve device bid modifier van -100% in voor CONNECTED_TV in alle PMAX campagnes.",
            campagne: "2. PMAX_Behandeling",
            deadline: "deze_week",
            verwachte_impact: "Elimineert non-converting inventory.",
          },
        ],
      }),
    ],
    findings: canonical.findings,
    clusters: canonical.clusters,
    coverage: canonical.coverage,
    conclusionText: "Conclusie",
  });

  assert(/2\. PMAX_Behandeling/i.test(structured.final_sop.primary_thread), `primary thread should stay on PMAX_Behandeling, got "${structured.final_sop.primary_thread}"`);
  assert(/conversie-effici[eë]ntie|CVR/i.test(structured.final_sop.primary_thread), `primary thread should still express the PMAX conversion problem, got "${structured.final_sop.primary_thread}"`);
  assert(structured.final_sop.recommendations.every((item) => /pmax_behandeling|PMAX_Behandeling/i.test(`${item.object} ${item.handeling}`)), "final executive recommendations should stay on the PMAX surface");
  assert(structured.final_sop.recommendations.every((item) => !/voorkeurshouding baby|connected_tv|rotterdam/i.test(item.handeling)), "narrow keyword or device tactics should not surface as executive recommendations");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
