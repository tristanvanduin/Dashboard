// Verificatie van de LinkedIn signaal-detectors met de ECHTE module.
// Draaien: npx tsx lib/signals/__linkedin_signals_test.ts

import {
  detectLinkedInFormDropOff,
  detectLinkedInCplPressure,
  detectLinkedInEngagementWeakness,
  detectLinkedInVideoDropOff,
  buildLinkedInSignals,
  type LinkedInEntitySignalInput,
} from "./linkedin-signals";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

function ent(over: Partial<LinkedInEntitySignalInput>): LinkedInEntitySignalInput {
  return {
    entityUrn: "urn:1", name: "Camp", impressions: 10000, clicks: 100,
    ctr: 0.01, cpl: 40, formOpens: 100, formCompletionRate: 0.5,
    videoCompletionRate: 0.3, prevCtr: 0.01, prevCpl: 40, ...over,
  };
}

console.log("\n1. Lead-form drop-off");
{
  const r = detectLinkedInFormDropOff([
    ent({ name: "Lek", formOpens: 200, formCompletionRate: 0.08 }),
    ent({ name: "Goed", formOpens: 200, formCompletionRate: 0.6 }),
  ]);
  check("lage completion triggert", r.triggered.length === 1 && r.triggered[0].scope === "Lek");
  check("goede completion triggert niet", !r.triggered.some((t) => t.scope === "Goed"));
  check("categorie conversie_meting", r.triggered[0].category === "conversie_meting");
  check("te weinig opens telt niet", detectLinkedInFormDropOff([ent({ formOpens: 5, formCompletionRate: 0.05 })]).triggered.length === 0);
}

console.log("\n2. CPL-druk");
{
  const rise = detectLinkedInCplPressure([ent({ name: "Duur", cpl: 60, prevCpl: 40 })]); // +50%
  check("CPL-stijging triggert", rise.triggered.length === 1 && rise.triggered[0].scope === "Duur");
  check("stijging zonder target = indicatie", rise.triggered[0].certainty === "indicatie");
  const over = detectLinkedInCplPressure([ent({ name: "BovenTarget", cpl: 60, prevCpl: 58 })], { cplTarget: 50 });
  check("boven target triggert + bewezen", over.triggered.length === 1 && over.triggered[0].certainty === "bewezen_binnen_platform");
  check("stabiele CPL onder target triggert niet", detectLinkedInCplPressure([ent({ cpl: 40, prevCpl: 40 })], { cplTarget: 50 }).triggered.length === 0);
}

console.log("\n3. Betrokkenheid-zwakte (relatief)");
{
  const r = detectLinkedInEngagementWeakness([
    ent({ name: "A", ctr: 0.010 }),
    ent({ name: "B", ctr: 0.011 }),
    ent({ name: "C", ctr: 0.012 }),
    ent({ name: "Zwak", ctr: 0.003 }), // ver onder mediaan ~0.011
  ]);
  check("CTR ver onder mediaan triggert", r.triggered.some((t) => t.scope === "Zwak"));
  check("gemiddelde triggert niet", !r.triggered.some((t) => t.scope === "A"));
  check("te weinig kliks telt niet", detectLinkedInEngagementWeakness([ent({ clicks: 2, ctr: 0.0001 })]).triggered.length === 0);
}

console.log("\n4. Video-drop-off (relatief)");
{
  const r = detectLinkedInVideoDropOff([
    ent({ name: "A", videoCompletionRate: 0.30 }),
    ent({ name: "B", videoCompletionRate: 0.32 }),
    ent({ name: "C", videoCompletionRate: 0.31 }),
    ent({ name: "Kort-uit", videoCompletionRate: 0.10 }),
  ]);
  check("lage completion triggert", r.triggered.some((t) => t.scope === "Kort-uit"));
  check("leeg zonder video-data", detectLinkedInVideoDropOff([ent({ videoCompletionRate: null })]).triggered.length === 0);
}

console.log("\n5. Aggregator");
{
  const r = buildLinkedInSignals({
    entities: [ent({ name: "Probleem", formOpens: 200, formCompletionRate: 0.05, cpl: 70, prevCpl: 40 })],
    targets: { cplTarget: 50 },
  });
  check("checked bevat alle vier de detectors", r.checked.length === 4);
  check("meerdere verhalen getriggerd", r.triggered.length >= 2);
  check("lege input geeft nul verhalen, geen fout", buildLinkedInSignals({ entities: [] }).triggered.length === 0);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
