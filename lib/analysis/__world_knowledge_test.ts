// Verificatie van G4 4a (wereldkennis-gronding) met de ECHTE validateStepOutput.
// Draaien: npx tsx lib/analysis/__world_knowledge_test.ts

import { validateStepOutput } from "./step-validator";
import type { StepOutput, Finding } from "../schema/analysis-schema";

const finding = (): Finding => ({
  entity_name: "Apple Generic", entity_type: "campaign", metric: "ROAS",
  current_value: 5, previous_value: 4, change_pct: 25, severity: "medium", evidence_level: "confirmed",
} as unknown as Finding);

const makeStep = (narrative: string): StepOutput => ({
  narrative,
  log_entries: [narrative],
  top_3_findings: [finding()],
  status: "OP SCHEMA",
  actions: [],
  step_conclusion: "Conclusie van de stap met voldoende lengte voor de validatie.",
} as StepOutput);

const hasWK = (warnings: string[]) => warnings.some((w) => w.startsWith("Wereldkennis"));

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const liveWithIphone = ["iphone 17 kopen", "apple generic", "search generic broedmachine"];
const liveWithoutIphone = ["apple generic", "search generic broedmachine"];

console.log("\n1. iPhone 17 als niet-bestaand bestempeld terwijl het in de live data staat -> Wereldkennis-warning");
{
  const v = validateStepOutput(6, makeStep("De spend op iPhone 17 wordt geclassificeerd als future intent waste, want het is een niet-bestaand model."), undefined, { liveTerms: liveWithIphone });
  check("Wereldkennis-warning aanwezig", hasWK(v.warnings), v.warnings.join(" | "));
  check("noemt iphone 17", /iphone 17/.test(v.warnings.find((w) => w.startsWith("Wereldkennis")) || ""));
  console.log("     " + v.warnings.find((w) => w.startsWith("Wereldkennis")));
}

console.log("\n2. Zelfde twijfel maar de term staat NIET in de live data -> geen warning (model kan gelijk hebben)");
{
  const v = validateStepOutput(6, makeStep("De spend op iPhone 17 wordt geclassificeerd als future intent waste, want het is een niet-bestaand model."), undefined, { liveTerms: liveWithoutIphone });
  check("geen Wereldkennis-warning", !hasWK(v.warnings));
}

console.log("\n3. Geen twijfel-frase (positieve zin) -> geen warning");
{
  const v = validateStepOutput(6, makeStep("De campagne op iPhone 17 presteert sterk met een ROAS van 5x en groeiende omzet deze maand."), undefined, { liveTerms: liveWithIphone });
  check("geen Wereldkennis-warning bij een positieve zin", !hasWK(v.warnings));
}

console.log("\n4. Twijfel zonder product-versie-token -> geen warning (niets om aan de data te toetsen)");
{
  const v = validateStepOutput(6, makeStep("Een deel van de spend gaat naar een fictief product zonder duidelijke onderbouwing in de data."), undefined, { liveTerms: liveWithIphone });
  check("geen Wereldkennis-warning zonder versie-token", !hasWK(v.warnings));
}

console.log("\n5. Geen liveTerms meegegeven -> check draait niet");
{
  const v = validateStepOutput(6, makeStep("De spend op iPhone 17 wordt geclassificeerd als future intent waste, want het is een niet-bestaand model."), undefined, {});
  check("geen Wereldkennis-warning zonder liveTerms", !hasWK(v.warnings));
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
