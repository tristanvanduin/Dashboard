import { canonicalizeFindings } from "../analysis/canonicalize";
import { buildStructuredMonthlyOutput, type StepFindingSidecar } from "../analysis/monthly-structured";
import { validateStepOutput } from "../analysis/step-validator";
import type { Finding, StepOutput } from "../schema/analysis-schema";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`  FAIL: ${label}`);
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    step: 1,
    issue_cluster: "geo_allocation",
    entity_type: "country",
    entity_name: "Duitsland",
    metric: "ROAS",
    current_value: 0.83,
    previous_value: 1.6,
    change_pct: -48,
    severity: "high",
    insight_type: "performance",
    is_seasonal: false,
    is_structural: true,
    cause: "Duitsland blijft structureel onder accountgemiddelde.",
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
    log_entries: ["Werkwijze A uitgevoerd."],
    findings: [],
    status: "KRITIEK",
    actions: [],
    step_conclusion: "Stapconclusie",
    ...overrides,
  };
}

console.log("\n=== Math Consistency Tests ===\n");

console.log("1. 'X ligt onder Y' alleen als X < Y");
{
  const output: StepOutput = {
    narrative: "Duitsland ROAS steeg naar 0.83 en ligt onder 1.60 volgens deze zin.",
    log_entries: ["Werkwijze A uitgevoerd."],
    top_3_findings: [
      finding({ entity_name: "Duitsland", metric: "ROAS", current_value: 0.83, previous_value: 1.6 }),
      finding({ entity_name: "Nederland", metric: "ROAS", current_value: 3.2, previous_value: 2.8, severity: "positive" }),
      finding({ entity_name: "België", metric: "ROAS", current_value: 1.1, previous_value: 1.4, severity: "medium" }),
    ],
    status: "KRITIEK",
    actions: [],
    step_conclusion: "ROAS-verschillen vragen om ingrijpen.",
  };
  const result = validateStepOutput(1, output);
  assert(result.warnings.some((warning) => /Wiskundige inconsistentie/i.test(warning)), "validator should flag wrong direction wording");
}

console.log("2. Deterministic evidence mag niet bij 'geen data'");
{
  const output: StepOutput = {
    narrative: "Er is geen data beschikbaar voor keywords, waardoor werkwijze B niet uitvoerbaar is.",
    log_entries: ["Werkwijze A niet uitvoerbaar door ontbrekende data."],
    top_3_findings: [
      finding({ entity_type: "account", entity_name: "Account", metric: "Data Availability", evidence_level: "deterministic", severity: "medium", current_value: null, previous_value: null, change_pct: null }),
      finding({ entity_type: "account", entity_name: "Account", metric: "Data Availability", evidence_level: "hypothesis", severity: "low", current_value: null, previous_value: null, change_pct: null }),
      finding({ entity_type: "account", entity_name: "Account", metric: "Data Availability", evidence_level: "hypothesis", severity: "low", current_value: null, previous_value: null, change_pct: null }),
    ],
    status: "NIET OP SCHEMA",
    actions: [{ actie: "Activeer keyword-export in Google Ads", campagne: null, deadline: "deze_week", verwachte_impact: "Keyword-analyse wordt weer uitvoerbaar." }],
    step_conclusion: "Zonder keyword-data blijven conclusies voorlopig hypothetisch.",
  };
  const result = validateStepOutput(5, output);
  assert(result.errors.some((error) => /deterministic/i.test(error)), "validator should reject deterministic evidence on no-data step");
}

console.log("3. ICE-spread >= 2.0 tussen hoogste en laagste aanbeveling");
{
  const clusters = canonicalizeFindings([
    finding({ step: 1, entity_name: "Duitsland", metric: "ROAS", current_value: 0.83, previous_value: 1.6, severity: "critical" }),
    finding({ step: 2, entity_type: "campaign", entity_name: "Brand Search NL", metric: "Search IS", current_value: 55, previous_value: 40, change_pct: 37, issue_cluster: "search_budget_cap", severity: "critical" }),
    finding({ step: 3, entity_type: "network", entity_name: "YouTube", metric: "CPA", current_value: 42, previous_value: 18, change_pct: 133, issue_cluster: "network_quality", severity: "high" }),
  ], {
    geography: true,
    campaign: true,
    network: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 1,
        stepName: "Account Performance",
        status: "KRITIEK",
        actions: [
          { actie: "Verlaag dagbudget Duitsland met 50% naar €40/dag", campagne: "Duitsland", deadline: "direct", verwachte_impact: "Minder spend-lekkage en hogere blended ROAS." },
        ],
      }),
      parsedStep({
        stepNumber: 2,
        stepName: "Campaign Performance",
        status: "KRITIEK",
        actions: [
          { actie: "Verhoog dagbudget Brand Search NL met 20% naar €180/dag", campagne: "Brand Search NL", deadline: "deze_week", verwachte_impact: "Meer impression share en extra conversies binnen target CPA." },
        ],
      }),
      parsedStep({
        stepNumber: 12,
        stepName: "Checkout, Schedule & Network Performance",
        status: "NIET OP SCHEMA",
        actions: [
          { actie: "Sluit YouTube inventory uit in PMax Best Sellers", campagne: "PMax Best Sellers", deadline: "deze_maand", verwachte_impact: "Lagere CPA op zwakke netwerkinventory." },
        ],
      }),
    ],
    findings: clusters.findings,
    clusters: clusters.clusters,
    coverage: clusters.coverage,
    conclusionText: "Conclusie",
  });

  const iceInOrder = structured.recommendations.map((recommendation) => recommendation.ice_total);
  assert(iceInOrder.length >= 3, "should build at least 3 recommendations from step actions");
  // Build 1 (F5) verving enforceIceSpread (kunstmatige spreiding) door eerlijke ranking.
  // Niet langer een geforceerde spread van 2.0 toetsen, maar dat de aanbevelingen aflopend
  // op hun echte ICE staan en geldige, eindige scores hebben.
  assert(iceInOrder.every((value, index) => index === 0 || iceInOrder[index - 1] >= value), "recommendations should be ranked by descending ICE");
  assert(iceInOrder.every((value) => typeof value === "number" && Number.isFinite(value)), "ICE totals should be finite numbers");
}

console.log("4. Aanbevelingen bevatten geen verboden woorden");
{
  const clusters = canonicalizeFindings([
    finding({ step: 2, entity_type: "campaign", entity_name: "Brand Search NL", metric: "Search IS", current_value: 55, previous_value: 40, change_pct: 37, issue_cluster: "search_budget_cap", severity: "critical" }),
  ], {
    campaign: true,
    hypotheses_sprint_plan: true,
  });

  const structured = buildStructuredMonthlyOutput({
    parsedSteps: [
      parsedStep({
        stepNumber: 2,
        stepName: "Campaign Performance",
        status: "KRITIEK",
        actions: [
          { actie: "Verhoog dagbudget Brand Search NL met 20% naar €180/dag", campagne: "Brand Search NL", deadline: "direct", verwachte_impact: "Meer impression share en extra conversies." },
          { actie: "Heralloceer geo-budget rond Duitsland", campagne: "Duitsland", deadline: "deze_week", verwachte_impact: "Vagere impact." },
        ],
      }),
    ],
    findings: clusters.findings,
    clusters: clusters.clusters,
    coverage: clusters.coverage,
    conclusionText: "Conclusie",
  });

  assert(structured.recommendations.every((recommendation) => !/heralloceer|wijzig de hoofdhefboom/i.test(recommendation.hypothesis)), "recommendations should exclude forbidden generic wording");
}

console.log("5. Dedup-key 'duitsland::roas' resulteert in max 1 finding");
{
  const canonical = canonicalizeFindings([
    finding({ step: 1, entity_name: "Duitsland", metric: "ROAS", current_value: 0.83 }),
    finding({ step: 2, entity_name: "Duitsland (Shopping-bleeder_RM)", metric: "ROAS", current_value: 1.12, severity: "critical" }),
    finding({ step: 3, entity_name: "Land: Duitsland", metric: "ROAS", current_value: 1.6, evidence_level: "inferred" }),
  ], {
    geography: true,
    hypotheses_sprint_plan: true,
  });

  const germanyRoas = canonical.findings.filter((item) => /(^|::)duitsland::ROAS$/i.test(item.dedup_key));
  assert(germanyRoas.length === 1, `expected max 1 Germany ROAS dedup key, got ${germanyRoas.length}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
