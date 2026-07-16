// Test van de Meta-adapter (M2). Verifieert de 11-staps-structuur, dat elke stap-instructie
// het log-format en het purity-contract draagt, de Meta issue-clusters en entity-types, dat
// het output-schema Meta's lijsten gebruikt, en de registry.
// Draaien: npx tsx lib/__tests__/meta-adapter.test.ts

import { metaAdsAdapter } from "../analysis/adapters/meta-ads"; // registreert zichzelf
import { googleAdsAdapter } from "../analysis/adapters/google-ads"; // registreert zichzelf, voor de coexistentie-check
import { getAdapter, hasAdapter } from "../analysis/channel-adapter";
import { buildStepOutputSchema, MONTHLY_BENCHMARKS } from "../prompts/sop-prompts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// metaAdsAdapter direct gebruiken houdt de import (en dus de registratie-side-effect) levend.
const meta = metaAdsAdapter;

// 1. 11 stappen, compleet over alle per-stap velden.
assert(meta.stepCount === 11, "stepCount is 11");
const stepFields = ["stepInstructions", "logFormats", "purityContracts", "logFormatSkeletons", "purityRules"] as const;
for (const field of stepFields) {
  assert(Object.keys(meta[field]).length === 11, `${field} heeft 11 stappen`);
}

// 2. Elke stap-instructie bevat het log-format en het purity-contract (de combinatie).
for (let s = 1; s <= 11; s++) {
  assert(meta.stepInstructions[s].includes("Log-formaat"), `stap ${s}: stap-instructie bevat log-format`);
  assert(meta.stepInstructions[s].includes("Step-Purity Contract"), `stap ${s}: stap-instructie bevat purity-contract`);
}

// 3. Meta issue-clusters (17) en entity-types (12), niet de Google-lijst.
assert(meta.issueClusters.length === 17, "17 Meta issue-clusters");
assert(meta.issueClusters.includes("creative_fatigue"), "Meta-cluster creative_fatigue aanwezig");
assert(meta.issueClusters.includes("uncategorized"), "uncategorized aanwezig");
assert(!meta.issueClusters.includes("pmax_cannibalization"), "geen Google-cluster in Meta");
assert(meta.entityTypes.includes("adset") && meta.entityTypes.includes("placement"), "Meta entity-types adset en placement aanwezig");

// 4. Het output-schema gebruikt Meta's lijsten in plaats van Google's.
const schema = buildStepOutputSchema(meta.issueClusters.join(", "), meta.entityTypes.join("|"));
assert(schema.includes("creative_fatigue"), "schema bevat Meta-clusters");
assert(schema.includes("adset"), "schema bevat Meta entity-types");
assert(!schema.includes("pmax_cannibalization"), "schema bevat geen Google-clusters");

// 5. benchmarks dekt alle AccountType-sleutels.
const accountKeys = Object.keys(MONTHLY_BENCHMARKS);
assert(accountKeys.length > 0 && accountKeys.every((k) => k in meta.benchmarks), "benchmarks dekt alle accounttypes");

// 6. registry, channel en sopTypeKey.
assert(hasAdapter("meta_ads"), "meta_ads geregistreerd");
assert(getAdapter("meta_ads") === metaAdsAdapter, "registry resolveert meta_ads naar de adapter");
assert(meta.channel === "meta_ads", "channel is meta_ads");
assert(meta.sopTypeKey === "meta_monthly", "sopTypeKey is meta_monthly");

// 7. Beide adapters bestaan naast elkaar in de registry; registreren clobbert niet.
assert(hasAdapter("google_ads"), "google_ads blijft geregistreerd naast meta_ads");
assert(
  getAdapter("google_ads") === googleAdsAdapter && getAdapter("meta_ads") === metaAdsAdapter,
  "registry resolveert beide adapters onafhankelijk"
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
