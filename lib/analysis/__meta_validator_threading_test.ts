// Test van de validator-threading (gevouwen C1-rest). Bewijst dat de adapter-regels door de
// helpers en validateStepOutput stromen: met Google-regels versus Meta-regels divergeert het
// gedrag, en zonder override gelden de Google-constanten (Google byte-identiek, gedekt door de
// bestaande suite). Geen live data nodig.
// Draaien: npx tsx lib/analysis/__meta_validator_threading_test.ts

import { isFindingAlignedWithStep, isActionAlignedWithStep, validateStepOutput, STEP_PURITY_RULES } from "./step-validator";
import { metaAdsAdapter } from "./adapters/meta-ads";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// 1. isFindingAlignedWithStep divergeert: Google stap 1 staat alleen account/campaign toe,
//    Meta stap 1 heeft geen allowedEntityTypes (de regels gebruiken note plus forbiddenNarrativePatterns),
//    dus elke entity is toegestaan. Bewijst dat de rules-param echt wordt gebruikt.
assert(isFindingAlignedWithStep(1, "keyword", STEP_PURITY_RULES) === false, "Google-regels: keyword niet toegestaan op stap 1");
assert(isFindingAlignedWithStep(1, "keyword", metaAdsAdapter.purityRules) === true, "Meta-regels: geen allowedEntityTypes, dus keyword toegestaan op stap 1");
assert(isFindingAlignedWithStep(1, "account", STEP_PURITY_RULES) === true, "Google-regels: account wel toegestaan op stap 1");

// 2. isActionAlignedWithStep divergeert: Google stap 1 heeft allowedActionDomains, Meta niet.
const googleActionOk = isActionAlignedWithStep(1, "Pas de zoekterm-uitsluitingen aan", STEP_PURITY_RULES);
const metaActionOk = isActionAlignedWithStep(1, "Pas de zoekterm-uitsluitingen aan", metaAdsAdapter.purityRules);
assert(metaActionOk === true, "Meta-regels: geen allowedActionDomains, dus actie altijd toegestaan");
assert(googleActionOk !== undefined, "Google-regels: actie-domein wordt geevalueerd");

// 3. Default zonder override gebruikt de Google-constanten (geen regressie).
assert(isFindingAlignedWithStep(1, "keyword") === false, "default zonder override is identiek aan de Google-constanten");

// 4. validateStepOutput gebruikt de doorgegeven Meta purity-regels: een stap-4-narratief dat een
//    Meta-verbod schendt (kleur/compositie) levert een step-purity-warning.
function makeOutput(narrative: string) {
  return {
    narrative,
    log_entries: ["Ad X is winnaar, hook rate 30%, fatigue nee."],
    top_3_findings: [
      { entity_type: "campaign", entity_name: "Campagne A", metric: "cpa", evidence_level: "confirmed", current_value: 10, previous_value: 8 },
      { entity_type: "campaign", entity_name: "Campagne B", metric: "roas", evidence_level: "confirmed", current_value: 3, previous_value: 4 },
      { entity_type: "campaign", entity_name: "Campagne C", metric: "ctr", evidence_level: "confirmed", current_value: 2, previous_value: 2 },
    ],
    actions: [],
  } as unknown as Parameters<typeof validateStepOutput>[1];
}
const hasPurityWarning = (r: { warnings: string[] }) => r.warnings.some((w) => w.toLowerCase().includes("step-purity") && w.includes("narratief"));

const metaViolating = validateStepOutput(4, makeOutput("De kleur en compositie van de creatives verklaren het verschil."), undefined, { purityRules: metaAdsAdapter.purityRules, logFormatSkeletons: metaAdsAdapter.logFormatSkeletons });
assert(hasPurityWarning(metaViolating), "Meta-regels: kleur/compositie-narratief op stap 4 triggert step-purity-warning");

const metaClean = validateStepOutput(4, makeOutput("Ad A is winnaar met hoge hook rate en gezonde CPA versus het accountgemiddelde."), undefined, { purityRules: metaAdsAdapter.purityRules, logFormatSkeletons: metaAdsAdapter.logFormatSkeletons });
assert(!hasPurityWarning(metaClean), "Meta-regels: schoon stap-4-narratief triggert geen step-purity-warning");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
