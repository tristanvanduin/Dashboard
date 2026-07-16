// C1 parity-test: bewijst dat de Google-pipeline na de adapter-refactor byte-voor-byte
// dezelfde system prompts produceert. De kern loopt nu door de ECHTE buildMonthlyStepPrompt:
// voor elke stap, elk accounttype en met of zonder vorige conclusies bouwen we de prompt
// een keer via het Google-pad (de constanten) en een keer via het adapter-pad (adapter.
// stepInstructions plus adapter.benchmarks), en eisen stringgelijkheid. Zo dekt de test de
// daadwerkelijke prompt-assemblage af, niet een handmatige reconstructie.
//
// Draaien: npx tsx lib/__tests__/channel-adapter-google-parity.test.ts

import { buildMonthlyStepPrompt, MONTHLY_BENCHMARKS, buildStepOutputSchema, MONTHLY_STEP_OUTPUT_SCHEMA, type AccountType } from "../prompts/sop-prompts";
import { MONTHLY_V2_STEP_INSTRUCTIONS } from "../prompts/monthly-v2";
import { googleAdsAdapter } from "../analysis/adapters/google-ads"; // registreert zichzelf
import { getAdapter, hasAdapter } from "../analysis/channel-adapter";
import { STEP_PURITY_RULES, LOG_FORMAT_SKELETONS } from "../analysis/step-validator";
import { ENTITY_ALIASES, METRIC_ALIASES } from "../analysis/canonicalize";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const adapter = getAdapter("google_ads");

// 1. KERN: de echte system prompt per stap, byte-voor-byte gelijk via Google-pad en adapter-pad,
//    over alle accounttypes en met of zonder vorige conclusies.
const accountTypes = Object.keys(MONTHLY_BENCHMARKS) as AccountType[];
const prevVariants: Array<string | undefined> = [undefined, "## Context\nVorige conclusie."];
for (const accountType of accountTypes) {
  for (let step = 1; step <= adapter.stepCount; step++) {
    for (const prev of prevVariants) {
      const viaGoogle = buildMonthlyStepPrompt("## Doelen\nTest", accountType, MONTHLY_V2_STEP_INSTRUCTIONS[step], prev);
      const viaAdapter = buildMonthlyStepPrompt("## Doelen\nTest", accountType, adapter.stepInstructions[step], prev, adapter);
      assert(viaGoogle === viaAdapter, `stap ${step} (${accountType}, prev=${prev ? "ja" : "nee"}): prompt byte-voor-byte gelijk`);
    }
  }
}

// 2. stepCount en stap-instructies.
assert(adapter.stepCount === 13, "stepCount is 13");
assert(Object.keys(MONTHLY_V2_STEP_INSTRUCTIONS).length === 13, "13 stap-instructies aanwezig");

// 3. issueClusters is de prompt-lijst (19) en de adapter-lijsten reproduceren het verbatim schema.
assert(adapter.issueClusters.length === 19, "issueClusters is de 19-item prompt-lijst");
assert(adapter.issueClusters.includes("pmax_cannibalization"), "Google-specifiek cluster aanwezig");
assert(adapter.issueClusters.includes("uncategorized"), "uncategorized aanwezig");
assert(adapter.entityTypes.length === 12, "entityTypes is de 12-item lijst");
assert(
  buildStepOutputSchema(adapter.issueClusters.join(", "), adapter.entityTypes.join("|")) === MONTHLY_STEP_OUTPUT_SCHEMA,
  "de adapter-lijsten reproduceren het verbatim output-schema byte-voor-byte"
);

// 4. benchmarks: dezelfde sleutels en waarden, en de default in buildMonthlyStepPrompt is identiek.
assert(adapter.benchmarks === MONTHLY_BENCHMARKS, "adapter.benchmarks is de bestaande constante");

// 5. validator-input en aliases gelijk in referentie en omvang.
assert(adapter.logFormatSkeletons === LOG_FORMAT_SKELETONS, "logFormatSkeletons is de bestaande constante");
assert(adapter.purityRules === STEP_PURITY_RULES, "purityRules is de bestaande constante");
assert(adapter.metricAliases.length === METRIC_ALIASES.length, "metricAliases zelfde aantal");
assert(adapter.entityAliases.length === ENTITY_ALIASES.length, "entityAliases zelfde aantal");

// 6. registry: bekend kanaal resolved, onbekend kanaal weigert netjes (geen crash).
assert(hasAdapter("google_ads") === true, "google_ads geregistreerd");
assert(hasAdapter("tiktok_ads") === false, "tiktok_ads niet geregistreerd");
assert(googleAdsAdapter.sopTypeKey === "monthly", "sopTypeKey is monthly");
let threw = false;
try { getAdapter("onbekend_kanaal"); } catch { threw = true; }
assert(threw, "onbekend kanaal gooit een nette fout");

// 7. Output-schema via functie: byte-voor-byte gelijk met de Google-default, en de
//    kanaal-override vervangt de cluster- en entity-lijst echt (valideert ook de constanten).
assert(buildStepOutputSchema() === MONTHLY_STEP_OUTPUT_SCHEMA, "buildStepOutputSchema() byte-voor-byte gelijk aan het origineel");
const overridden = buildStepOutputSchema("cluster_a, cluster_b", "type_x|type_y");
assert(overridden.includes("cluster_a, cluster_b"), "override injecteert de kanaal-clusterlijst");
assert(overridden.includes("type_x|type_y"), "override injecteert de kanaal-entitylijst");
assert(!overridden.includes("pmax_cannibalization"), "override verwijdert de Google-clusterlijst");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
