// Verificatie van Q1 AA6 (gedeelde drempel-bron) met de ECHTE prompt-builders.
// Draaien: npx tsx lib/analysis/__thresholds_test.ts

import {
  IS_LOSS_ALARM_PCT,
  PMAX_LEARNING_WEEKS,
  PMAX_LEARNING_CONVERSIONS,
  HIGH_CPA_MULTIPLE,
} from "./thresholds";
import { buildMonthlyStepPrompt, buildWeeklyPrompt } from "../prompts/sop-prompts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("De module is de bron");
check("IS_LOSS_ALARM_PCT is 20", IS_LOSS_ALARM_PCT === 20);
check("PMAX-leerfase is 6 weken / 50 conversies", PMAX_LEARNING_WEEKS === 6 && PMAX_LEARNING_CONVERSIONS === 50);
check("HIGH_CPA_MULTIPLE is 3", HIGH_CPA_MULTIPLE === 3);

const monthly = buildMonthlyStepPrompt("## Doelen\nTest", "ecommerce_roas", "## Stap 1\nAnalyseer.");
const weekly = buildWeeklyPrompt("## Doelen\nTest", "ecommerce_roas");

console.log("\nDe maand-benchmark (MONTHLY_BENCHMARKS) leest uit de bron");
check("maand toont de IS-verlies-waarde uit de constante", monthly.includes(">" + IS_LOSS_ALARM_PCT + "%"));
check("maand toont de PMAX-leerfase uit de constante", monthly.includes("min " + PMAX_LEARNING_WEEKS + " weken, " + PMAX_LEARNING_CONVERSIONS + "+"));
check("maand bevat geen letterlijke interpolatie", !monthly.includes("${"));

console.log("\nDe weekly-benchmark (getBenchmarks) leest uit dezelfde bron");
check("weekly toont de IS-verlies-waarde uit de constante", weekly.includes(">" + IS_LOSS_ALARM_PCT + "%"));
check("weekly toont de PMAX-leerfase uit de constante", weekly.includes("minimaal " + PMAX_LEARNING_WEEKS + " weken, " + PMAX_LEARNING_CONVERSIONS + "+"));
check("weekly bevat geen letterlijke interpolatie", !weekly.includes("${"));

console.log("\nEén bron: beide analyses tonen hetzelfde IS-verlies-getal");
check("maand en weekly delen het IS-verlies-getal", monthly.includes(">" + IS_LOSS_ALARM_PCT + "%") && weekly.includes(">" + IS_LOSS_ALARM_PCT + "%"));

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
