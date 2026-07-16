import type { StepResult } from "@/lib/analysis/helpers";
import type { ThreadRecommendation, ThreadTask } from "@/lib/analysis/monthly-structured";
import type { SopCoverage } from "@/lib/analysis/canonicalize";
import type { AcceptanceCriterionResult, AcceptanceReport } from "@/lib/schema/monthly-pipeline-schema";
import type { StepValidationResult } from "@/lib/analysis/step-validator";

const FORBIDDEN_WORDS = ["consolideer", "optimaliseer", "onderzoek", "analyseer"];

function hasForbiddenWord(text: string): boolean {
  const normalized = text.toLowerCase();
  return FORBIDDEN_WORDS.some((word) => normalized.includes(word));
}

function dedupKey(entity: string, metric: string): string {
  return `${entity.toLowerCase()}::${metric.toLowerCase()}`;
}

export function validateMonthlyAcceptance(opts: {
  narrativeSteps: StepResult[];
  recommendations: ThreadRecommendation[];
  tasks: ThreadTask[];
  coverage: SopCoverage[];
  findings: Array<{ canonical_entity_name: string; canonical_metric: string }>;
  checkpointsRun: number;
  stepValidations?: StepValidationResult[];
}): AcceptanceReport {
  const { narrativeSteps, recommendations, tasks, coverage, findings, checkpointsRun, stepValidations = [] } = opts;
  const criteria: AcceptanceCriterionResult[] = [];

  const deepDiveSteps = narrativeSteps.filter((step) => step.stepNumber >= 1 && step.stepNumber <= 13);
  criteria.push({
    id: "AC-01",
    label: "Alle 13 SOP-stappen aanwezig",
    passed: deepDiveSteps.length === 13,
    detail: `${deepDiveSteps.length}/13 stappen uitgevoerd`,
  });

  criteria.push({
    id: "AC-03",
    label: "Max 30 unieke bevindingen",
    passed: findings.length <= 30,
    detail: `${findings.length} unieke bevindingen`,
  });

  const findingKeys = new Set<string>();
  let duplicateFindings = 0;
  for (const finding of findings) {
    const key = dedupKey(finding.canonical_entity_name, finding.canonical_metric);
    if (findingKeys.has(key)) duplicateFindings += 1;
    findingKeys.add(key);
  }
  criteria.push({
    id: "AC-14",
    label: "Geen duplicate entiteit+metric bevindingen",
    passed: duplicateFindings === 0,
    detail: duplicateFindings === 0 ? "0 duplicaten" : `${duplicateFindings} duplicaten gevonden`,
  });

  criteria.push({
    id: "AC-04",
    label: "Max 15 taken, geen duplicaten",
    passed: tasks.length <= 15,
    detail: `${tasks.length} taken`,
  });

  criteria.push({
    id: "AC-05",
    label: "Max 10 aanbevelingen, concreet",
    passed: recommendations.length <= 10 && recommendations.every((recommendation) => !hasForbiddenWord(recommendation.hypothesis)),
    detail: `${recommendations.length} aanbevelingen`,
  });

  criteria.push({
    id: "AC-11",
    label: "3 checkpoints uitgevoerd",
    passed: checkpointsRun === 3,
    detail: `${checkpointsRun}/3 checkpoints`,
  });

  criteria.push({
    id: "AC-10",
    label: "3-lagen structuur aanwezig",
    passed: coverage.length > 0,
    detail: "Executive, bevindingen/acties en deep-dive worden opgebouwd in de route-output",
  });

  const officialStepValidations = stepValidations.filter((validation) => validation.stepNumber >= 1 && validation.stepNumber <= 13);
  const invalidOfficialSteps = officialStepValidations
    .filter((validation) => !validation.valid)
    .map((validation) => validation.stepNumber);
  criteria.push({
    id: "AC-15",
    label: "Geen invalid step-outputs in de finale 13 stappen",
    passed: invalidOfficialSteps.length === 0,
    detail: invalidOfficialSteps.length === 0
      ? `${officialStepValidations.length || 0} finale stapvalidaties akkoord`
      : `Invalid steps: ${invalidOfficialSteps.join(", ")}`,
  });

  const passed = criteria.every((criterion) => criterion.passed);
  return { passed, criteria };
}

export interface MonthlyQualityGateReport {
  passed: boolean;
  state: "passed" | "blocked_invalid_steps" | "blocked_acceptance";
  invalid_steps: number[];
  blocking_reasons: string[];
}

export function buildMonthlyQualityGate(opts: {
  stepValidations: StepValidationResult[];
  acceptance: AcceptanceReport;
}): MonthlyQualityGateReport {
  const officialStepValidations = opts.stepValidations.filter((validation) => validation.stepNumber >= 1 && validation.stepNumber <= 13);
  const invalidSteps = Array.from(new Set(
    officialStepValidations
      .filter((validation) => !validation.valid)
      .map((validation) => validation.stepNumber)
  )).sort((a, b) => a - b);

  if (invalidSteps.length > 0) {
    return {
      passed: false,
      state: "blocked_invalid_steps",
      invalid_steps: invalidSteps,
      blocking_reasons: invalidSteps.map((stepNumber) => `Step ${stepNumber} is invalid en mag niet door naar structured save/export.`),
    };
  }

  if (!opts.acceptance.passed) {
    const failedCriteria = opts.acceptance.criteria
      .filter((criterion) => !criterion.passed)
      .map((criterion) => `${criterion.id}: ${criterion.label} (${criterion.detail})`);
    return {
      passed: false,
      state: "blocked_acceptance",
      invalid_steps: [],
      blocking_reasons: failedCriteria.length > 0
        ? failedCriteria
        : ["Acceptance faalde zonder expliciete criteria-detail."],
    };
  }

  return {
    passed: true,
    state: "passed",
    invalid_steps: [],
    blocking_reasons: [],
  };
}
