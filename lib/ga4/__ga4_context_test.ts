export {};
// Verificatie van de GA4-contextlaag: (a) absent → LEGE promptContext (SOP draait ongewijzigd
// door, geen valse zekerheid); (b) mock → een gelabeld blok met de vier signaal-soorten en de
// bewijs-basis-instructie; (c) de deterministische evidenceBasis-guard.
// Draaien: npx tsx lib/ga4/__ga4_context_test.ts

import { buildGa4ContextBlock, resolveEvidenceBasis } from "./context";
import { buildGa4DemoDataset } from "@/lib/demo/ga4-demo";
import type { Ga4Dataset } from "./types";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

console.log("\n1. availability 'absent' → lege promptContext (nul promptwijziging)");
{
  const absent: Ga4Dataset = { availability: "absent", config: null, rows: [], limitations: ["GA4 niet geconfigureerd voor deze klant."] };
  const block = buildGa4ContextBlock(absent, "google_ads");
  check("promptContext is leeg", block.promptContext === "", `len=${block.promptContext.length}`);
  check("defaultEvidenceBasis = platform", block.defaultEvidenceBasis === "platform");
  check("beperking blijft zichtbaar", block.limitations.length === 1);
}

console.log("\n2. mock-dataset → gelabeld blok met de vier signaal-soorten + bewijs-basis");
{
  const block = buildGa4ContextBlock(buildGa4DemoDataset(new Date()), "google_ads");
  const t = block.promptContext;
  check("bevat GA4-CONTEXT-kop", t.includes("GA4-CONTEXT"));
  check("MEDIA-SIGNAAL aanwezig", t.includes("MEDIA-SIGNAAL"));
  check("WEBSITE/FUNNEL-SIGNAAL aanwezig", t.includes("WEBSITE/FUNNEL-SIGNAAL"));
  check("TRACKING-SIGNAAL aanwezig", t.includes("TRACKING-SIGNAAL"));
  check("CRO-SIGNAAL aanwezig", t.includes("CRO-SIGNAAL"));
  check("bewijs-basis-instructie aanwezig", t.includes("[platform]") && t.includes("[ga4]") && t.includes("[combined]") && t.includes("[estimated]"));
  check("expliciet: overschrijf platform niet zonder bewijs", t.toLowerCase().includes("overschrijf een platformconclusie niet"));
  check("demo-dataset triggert de tracking-break in de context", block.signals.triggered.length === 1, `triggered=${block.signals.triggered.length}`);
  check("mock markeert een beperking (geen valse zekerheid)", block.limitations.some((l) => l.toLowerCase().includes("mock")));
}

console.log("\n3. Deterministische evidenceBasis-guard");
{
  check("schatting → estimated", resolveEvidenceBasis({ ga4Available: true, usedGa4: true, usedPlatform: true, isEstimated: true }) === "estimated");
  check("GA4 gebruikt zonder data → platform (geen valse GA4-claim)", resolveEvidenceBasis({ ga4Available: false, usedGa4: true, usedPlatform: false, isEstimated: false }) === "platform");
  check("GA4 + platform samen → combined", resolveEvidenceBasis({ ga4Available: true, usedGa4: true, usedPlatform: true, isEstimated: false }) === "combined");
  check("alleen GA4 → ga4", resolveEvidenceBasis({ ga4Available: true, usedGa4: true, usedPlatform: false, isEstimated: false }) === "ga4");
  check("alleen platform → platform", resolveEvidenceBasis({ ga4Available: true, usedGa4: false, usedPlatform: true, isEstimated: false }) === "platform");
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);
