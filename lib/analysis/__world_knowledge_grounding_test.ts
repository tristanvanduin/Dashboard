// Verificatie van G4 4b (proactieve wereldkennis-gronding in de prepared context) met de ECHTE
// buildMonthlyStepPrompt. Draaien: npx tsx lib/analysis/__world_knowledge_grounding_test.ts

import { buildMonthlyStepPrompt } from "../prompts/sop-prompts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const prompt = buildMonthlyStepPrompt(
  "## Doelen\nTestdoelen voor het account.",
  "ecommerce_roas",
  "## Stap 6: Product Performance\nAnalyseer de productgroepen.",
  "Conclusie vorige stap."
);

console.log("\nDe prepared context bevat de wereldkennis-gronding");
check("bevat het wereldkennis-blok", /## Wereldkennis en de aangeleverde data/.test(prompt));
check("instrueert nooit als niet-bestaand, toekomstig of fictief te bestempelen", /Bestempel een term nooit als niet-bestaand, toekomstig, fictief of als future intent waste/.test(prompt));
check("instrueert onbekende namen als bestaand te behandelen", /ga er dan van uit dat die bestaat/.test(prompt));
check("stelt: de aangeleverde data is de waarheid", /De aangeleverde data is de waarheid, niet je geheugen/.test(prompt));
check("de gronding staat VOOR de stap-instructie", prompt.indexOf("Wereldkennis en de aangeleverde data") < prompt.indexOf("Analyseer de productgroepen"));
check("de stap-instructie en doelen blijven aanwezig", /Analyseer de productgroepen/.test(prompt) && /Testdoelen voor het account/.test(prompt));

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
