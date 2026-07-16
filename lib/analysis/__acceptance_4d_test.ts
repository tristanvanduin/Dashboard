// Verificatie van F3 4d (acceptance AC-16/17/18) met de ECHTE validateMonthlyAcceptance.
// Draaien: npx tsx lib/analysis/__acceptance_4d_test.ts

import { validateMonthlyAcceptance } from "./monthly-acceptance";
import type { FinalSopRecommendation, FinalSopTask } from "./monthly-structured";
import type { StepValidationResult } from "./step-validator";

const rec = (handeling: string, beslisregel: string): FinalSopRecommendation => ({
  route: "containment", handeling, object: "x", doel: "x", meet_via: "x", voorwaarde: "x", beslisregel, risico: "x",
} as FinalSopRecommendation);

const baseOpts = (
  finalSop: { recommendations: FinalSopRecommendation[]; tasks: FinalSopTask[] },
  stepValidations: StepValidationResult[] = []
) => ({
  narrativeSteps: [],
  recommendations: [],
  tasks: [],
  coverage: [],
  findings: [],
  checkpointsRun: 3,
  stepValidations,
  finalSop,
}) as Parameters<typeof validateMonthlyAcceptance>[0];

const find = (report: ReturnType<typeof validateMonthlyAcceptance>, id: string) =>
  report.criteria.find((c) => c.id === id);

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("\n1. AC-16: duplicaat-handeling vuurt en blokkeert");
{
  const report = validateMonthlyAcceptance(baseOpts({
    recommendations: [rec("Bevries het budget", "regel A"), rec("Bevries het budget", "regel B")],
    tasks: [],
  }));
  check("AC-16 faalt bij duplicaat-handeling", find(report, "AC-16")?.passed === false);
  check("gate is geblokkeerd (passed false)", report.passed === false);
  console.log("     " + find(report, "AC-16")?.detail);
}

console.log("\n2. AC-16: unieke handelingen passeren");
{
  const report = validateMonthlyAcceptance(baseOpts({
    recommendations: [rec("Bevries het budget", "regel A"), rec("Verhoog het bod stapsgewijs", "regel B")],
    tasks: [],
  }));
  check("AC-16 slaagt bij unieke handelingen", find(report, "AC-16")?.passed === true);
}

console.log("\n3. AC-17: dubbelconditie-beslisregel vuurt en blokkeert");
{
  const report = validateMonthlyAcceptance(baseOpts({
    recommendations: [rec("Schaal de campagne", "Schaal als de ROAS boven target ligt alleen als de CPA onder de grens als signaal blijft")],
    tasks: [],
  }));
  check("AC-17 faalt bij dubbelconditie", find(report, "AC-17")?.passed === false, find(report, "AC-17")?.detail);
  check("gate is geblokkeerd (passed false)", report.passed === false);
  console.log("     " + find(report, "AC-17")?.detail);
}

console.log("\n4. AC-17: enkelvoudige beslisregel passeert");
{
  const report = validateMonthlyAcceptance(baseOpts({
    recommendations: [rec("Schaal de campagne", "Schaal door zolang de ROAS boven target blijft; stop bij een terugval")],
    tasks: [],
  }));
  check("AC-17 slaagt bij enkelvoudige beslisregel", find(report, "AC-17")?.passed === true);
}

console.log("\n5. AC-18: rapporteert het percentage en blokkeert niet");
{
  const stepValidations: StepValidationResult[] = [
    { stepNumber: 1, valid: true, warnings: ["AC-08: log_entries volgen het SOP-logformat onvoldoende (1/4 conform)"], errors: [] },
    { stepNumber: 2, valid: true, warnings: [], errors: [] },
  ];
  const report = validateMonthlyAcceptance(baseOpts({ recommendations: [rec("x", "enkel zolang het goed gaat")], tasks: [] }, stepValidations));
  check("AC-18 is altijd passed (rapporterend)", find(report, "AC-18")?.passed === true);
  check("AC-18 detail noemt 50%", /50%/.test(find(report, "AC-18")?.detail || ""), find(report, "AC-18")?.detail);
  console.log("     " + find(report, "AC-18")?.detail);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
