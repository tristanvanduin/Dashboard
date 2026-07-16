// Test van de LinkedIn-adapter (L2). Verifieert de 9-staps-structuur, dat elke stap-instructie
// het log-format en het purity-contract draagt, de LinkedIn issue-clusters en entity-types, de
// LinkedIn-kern (CPL leidt, geen ROAS-fixatie, ICP-fit als kernstap), en de registry-coexistentie.
// Draaien: npx tsx lib/__tests__/linkedin-adapter.test.ts

import { linkedinAdsAdapter } from "../analysis/adapters/linkedin-ads"; // registreert zichzelf
import { googleAdsAdapter } from "../analysis/adapters/google-ads"; // coexistentie-check
import { getAdapter, hasAdapter } from "../analysis/channel-adapter";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// De adapter direct gebruiken houdt de import (en dus de registratie-side-effect) levend.
const li = linkedinAdsAdapter;

// 1. 9 stappen, compleet over alle per-stap velden.
assert(li.stepCount === 9, "stepCount is 9");
assert(li.channel === "linkedin_ads", "channel is linkedin_ads");
assert(li.sopTypeKey === "linkedin_monthly", "sopTypeKey is linkedin_monthly");
const stepFields = ["stepInstructions", "logFormats", "purityContracts", "logFormatSkeletons", "purityRules"] as const;
for (const field of stepFields) {
  assert(Object.keys(li[field]).length === 9, `${field} heeft 9 stappen`);
}

// 2. Elke stap-instructie bevat het log-format en het purity-contract (de combinatie).
for (let s = 1; s <= 9; s++) {
  assert(li.stepInstructions[s].includes("Log-formaat"), `stap ${s}: stap-instructie bevat log-format`);
  assert(li.stepInstructions[s].includes("Step-Purity Contract"), `stap ${s}: stap-instructie bevat purity-contract`);
}

// 3. Issue-clusters (17) en entity-types (12), met de kern-elementen.
assert(li.issueClusters.length === 17, "17 issue-clusters");
for (const cluster of ["icp_waste", "cpl_inflation", "form_dropoff", "audience_saturation", "uncategorized"]) {
  assert(li.issueClusters.includes(cluster), `issue-cluster ${cluster} aanwezig`);
}
assert(li.entityTypes.length === 12, "12 entity-types");
for (const et of ["job_function", "seniority", "industry", "company_size", "campaign_group"]) {
  assert(li.entityTypes.includes(et), `entity-type ${et} aanwezig`);
}

// 4. De LinkedIn-kern: CPL leidt, geen ROAS-fixatie, ICP-fit is de kernstap.
assert(/CPL/i.test(li.stepInstructions[1]) && /geen ROAS/i.test(li.purityRules[1]?.note ?? ""), "stap 1 stelt CPL centraal en waarschuwt tegen ROAS-fixatie");
assert(/ICP-fit/i.test(li.stepInstructions[5]) && /kernstap/i.test(li.stepInstructions[5]), "stap 5 is de ICP-fit kernstap");
assert(/coverage/i.test(li.stepInstructions[5]), "stap 5 vermeldt coverage voor onderdrukte segmenten");
assert(/zonder ingevulde ICP/i.test(li.stepInstructions[5]), "stap 5 dekt de lege-ICP-degradatie");
assert(/leidgen|leadgen/i.test(li.benchmarks.leadgen_cpa) && /0,4 tot 0,65/.test(li.benchmarks.leadgen_cpa), "benchmarks zijn leadgen B2B met LinkedIn-CTR-richtwaarden");
for (const key of ["ecommerce_roas", "ecommerce_cpa", "leadgen_cpa", "leadgen_volume", "hybrid"] as const) {
  assert(typeof li.benchmarks[key] === "string" && li.benchmarks[key].length > 0, `benchmark voor ${key} aanwezig`);
}

// 5. Checkpoints en no-go zitten impliciet in de contracten; controleer de belangrijkste no-go's.
assert(/geen leadkwaliteit-claim zonder ICP/i.test(li.purityRules[5]?.note ?? ""), "stap 5 verbiedt leadkwaliteit-claims zonder ICP of CRM");

// 6. Aliases werken op de LinkedIn-terminologie.
const cplAlias = li.metricAliases.find(([re]) => re.test("cost per lead"));
assert(cplAlias?.[1] === "CPL", "CPL-alias canonicaliseert cost per lead");
const funcAlias = li.entityAliases.find(([re]) => re.test("job function"));
assert(funcAlias?.[1] === "job_function", "job_function-alias canonicaliseert");

// 7. Registry: linkedin_ads resolvet en coexisteert met Google.
assert(hasAdapter("linkedin_ads"), "linkedin_ads is geregistreerd");
assert(getAdapter("linkedin_ads").channel === "linkedin_ads", "getAdapter geeft de LinkedIn-adapter");
assert(getAdapter("google_ads") === googleAdsAdapter, "Google-adapter coexisteert ongewijzigd");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
