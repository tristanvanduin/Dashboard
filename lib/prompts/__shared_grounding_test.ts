// Verificatie van Q1 stap 1 (gedeelde wereldkennis-gronding) met de ECHTE prompt-builders.
// Draaien: npx tsx lib/prompts/__shared_grounding_test.ts

import { WORLD_KNOWLEDGE_GROUNDING } from "./shared-grounding";
import { buildMonthlyStepPrompt, buildWeeklyPrompt, buildBiWeeklyPrompt } from "./sop-prompts";
import { buildSearchTermAnalysisPrompt } from "./search-term-prompts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const KEY = "De aangeleverde data is de waarheid, niet je geheugen";
const HEADER = "## Wereldkennis en de aangeleverde data";

check("de gedeelde constante bevat de kernzin", WORLD_KNOWLEDGE_GROUNDING.includes(KEY));

console.log("\nElke analyse erft de gronding uit de gedeelde bron");
const monthly = buildMonthlyStepPrompt("## Doelen\nTest", "ecommerce_roas", "## Stap 6\nAnalyseer.");
check("maand-SOP bevat de gronding", monthly.includes(HEADER) && monthly.includes(KEY));

const weekly = buildWeeklyPrompt("## Doelen\nTest", "ecommerce_roas");
check("weekly bevat de gronding", weekly.includes(HEADER) && weekly.includes(KEY));

const biweekly = buildBiWeeklyPrompt("## Doelen\nTest", "ecommerce_roas", "Vorige maand-output.");
check("biweekly bevat de gronding", biweekly.includes(HEADER) && biweekly.includes(KEY));

const searchTerms = buildSearchTermAnalysisPrompt();
check("zoekterm-analyse bevat de gronding (AA1)", searchTerms.includes(HEADER) && searchTerms.includes(KEY));

console.log("\nEén bron: de tekst is identiek over de analyses");
check("zelfde grondingstekst in maand en zoekterm", monthly.includes(WORLD_KNOWLEDGE_GROUNDING) && searchTerms.includes(WORLD_KNOWLEDGE_GROUNDING));

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
