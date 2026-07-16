// Verificatie van F3 4c (logformat-skeleton-checks / AC-08) met de ECHTE validateStepOutput en de
// ECHTE LOG_FORMAT_SKELETONS uit step-validator.ts. Draaien: npx tsx lib/analysis/__ac08_test.ts

import { validateStepOutput, LOG_FORMAT_SKELETONS } from "./step-validator";
import type { StepOutput, Finding } from "../schema/analysis-schema";

const finding = (): Finding => ({
  entity_name: "Campagne X",
  entity_type: "campaign",
  metric: "ROAS",
  current_value: 5,
  previous_value: 4,
  change_pct: 25,
  severity: "medium",
  evidence_level: "confirmed",
} as unknown as Finding);

const makeStep = (logs: string[]): StepOutput => ({
  narrative: "Campagne X presteert bovengemiddeld met ROAS 5x, een stijging van 25% deze maand ten opzichte van de maand daarvoor zichtbaar.",
  log_entries: logs,
  top_3_findings: [finding()],
  status: "OP SCHEMA",
  actions: [],
  step_conclusion: "Conclusie van de stap met voldoende lengte voor de validatie.",
} as StepOutput);

const hasAC08 = (warnings: string[]) => warnings.some((w) => w.startsWith("AC-08"));

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const conforming = [
  "Campagne A en Campagne B dragen sterk bij aan de opwaartse trend van ROAS, 12% hoger dan gemiddeld",
  "Campagne C presteert bovengemiddeld afgelopen maand, ROAS stijgt 8% ten opzichte van voorgaande maand",
  "In week 32 is een breuklijn te identificeren, sindsdien presteert de campagne 15% meer op ROAS",
];
const free = "Een algemene opmerking zonder vast format en zonder enige onderbouwing";

console.log("\n0. De skeletten zijn geladen voor de format-stappen");
check("stap 2 heeft skeletten", (LOG_FORMAT_SKELETONS[2]?.length ?? 0) > 0);
check("stap 13 heeft GEEN skeletten (synthese)", LOG_FORMAT_SKELETONS[13] === undefined);

console.log("\n1. Drie conforme plus een vrije entry (75 procent) passeert");
{
  const v = validateStepOutput(2, makeStep([...conforming, free]));
  check("geen AC-08 warning", !hasAC08(v.warnings), v.warnings.filter(w => w.startsWith("AC-08")).join(" | "));
}

console.log("\n2. Een conforme van vier faalt met AC-08");
{
  const v = validateStepOutput(2, makeStep([conforming[0], free, free, free]));
  check("AC-08 warning aanwezig", hasAC08(v.warnings));
  check("boodschap noemt de ratio 1/4", v.warnings.some(w => /1\/4 conform/.test(w)));
  console.log("     " + v.warnings.find(w => w.startsWith("AC-08")));
}

console.log("\n3. Data-niet-beschikbaar-stappen vuren niet");
{
  const v = validateStepOutput(10, makeStep(["Engagement KPI data niet beschikbaar."]));
  check("geen AC-08 bij alleen data-niet-beschikbaar (noemer leeg)", !hasAC08(v.warnings));
}

console.log("\n4. Werkwijze-kopjes tellen niet mee in de noemer");
{
  // 1 Werkwijze-kop (genegeerd) + 3 conforme = 3/3 conform -> geen AC-08
  const v = validateStepOutput(2, makeStep(["Werkwijze A (verklaring account performance):", ...conforming]));
  check("geen AC-08 als alle echte entries conform zijn", !hasAC08(v.warnings));
}

console.log("\n5. Stap zonder skeleton (13) vuurt nooit AC-08");
{
  const v = validateStepOutput(13, makeStep([free, free, free]));
  check("geen AC-08 op stap 13", !hasAC08(v.warnings));
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
