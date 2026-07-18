// Verificatie van de Meta signaal-detectors met de ECHTE module.
// Draaien: npx tsx lib/signals/__meta_signals_test.ts

import {
  detectMetaCreativeFatigue,
  detectMetaFrequencySaturation,
  detectMetaRankingWeakness,
  detectMetaHookHoldWeakness,
  buildMetaCreativeSignals,
  type MetaAdSignalInput,
  type MetaLevelSignalInput,
} from "./meta-creative";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

function ad(over: Partial<MetaAdSignalInput>): MetaAdSignalInput {
  return {
    entityId: "a1", adName: "Ad", campaignName: "Camp", impressions: 5000,
    frequency: 1.5, hookRate: 0.3, holdRate: 0.2, linkCtr: 0.01, cpa: 20, roas: 3,
    qualityRanking: "AVERAGE", engagementRanking: "AVERAGE", conversionRanking: "AVERAGE",
    prevLinkCtr: 0.01, prevCpa: 20, ...over,
  };
}

console.log("\n1. Creative fatigue");
{
  const r = detectMetaCreativeFatigue([
    ad({ adName: "Moe", frequency: 3.5, linkCtr: 0.007, prevLinkCtr: 0.01 }), // CTR -30%
    ad({ adName: "Gezond", frequency: 3.5, linkCtr: 0.01, prevLinkCtr: 0.01 }), // geen daling
  ]);
  check("hoge frequentie + CTR-daling triggert", r.triggered.length === 1 && r.triggered[0].scope.includes("Moe"));
  check("stabiele CTR triggert niet", !r.triggered.some((t) => t.scope.includes("Gezond")));
  check("categorie is creative", r.triggered[0]?.category === "creative");
  check("lage frequentie triggert niet", detectMetaCreativeFatigue([ad({ frequency: 1.2, linkCtr: 0.005, prevLinkCtr: 0.01 })]).triggered.length === 0);
  check("cpa-stijging triggert ook", detectMetaCreativeFatigue([ad({ frequency: 3.2, cpa: 30, prevCpa: 20, linkCtr: 0.01, prevLinkCtr: 0.01 })]).triggered.length === 1);
  check("onder minimum impressies telt niet", detectMetaCreativeFatigue([ad({ impressions: 500, frequency: 4, linkCtr: 0.005, prevLinkCtr: 0.01 })]).triggered.length === 0);
}

console.log("\n2. Frequentie-verzadiging");
{
  const levels: MetaLevelSignalInput[] = [
    { scope: "account", frequency: 4.5, impressions: 100000 },
    { scope: "Camp lage freq", frequency: 2.0, impressions: 50000 },
  ];
  const r = detectMetaFrequencySaturation(levels);
  check("frequentie boven drempel triggert", r.triggered.length === 1 && r.triggered[0].scope === "account");
  check("certainty is indicatie (heuristiek)", r.triggered[0].certainty === "indicatie");
  check("laag volume telt niet", detectMetaFrequencySaturation([{ scope: "x", frequency: 6, impressions: 100 }]).triggered.length === 0);
}

console.log("\n3. Ranking-zwakte");
{
  const r = detectMetaRankingWeakness([
    ad({ adName: "Zwak", qualityRanking: "BELOW_AVERAGE_35", engagementRanking: "BELOW_AVERAGE_20", conversionRanking: "AVERAGE" }),
    ad({ adName: "Prima", qualityRanking: "ABOVE_AVERAGE", engagementRanking: "AVERAGE", conversionRanking: "AVERAGE" }),
  ]);
  check("below_average triggert", r.triggered.length === 1 && r.triggered[0].scope.includes("Zwak"));
  check("twee zwakke assen benoemd", r.triggered[0].story.includes("kwaliteit") && r.triggered[0].story.includes("betrokkenheid"));
  check("bewezen_binnen_platform", r.triggered[0].certainty === "bewezen_binnen_platform");
  check("goede rankings triggeren niet", !r.triggered.some((t) => t.scope.includes("Prima")));
}

console.log("\n4. Hook/hold-zwakte (relatief)");
{
  const ads = [
    ad({ adName: "A", hookRate: 0.30, holdRate: 0.20 }),
    ad({ adName: "B", hookRate: 0.32, holdRate: 0.22 }),
    ad({ adName: "C", hookRate: 0.31, holdRate: 0.21 }),
    ad({ adName: "Zwak", hookRate: 0.10, holdRate: 0.20 }), // hook ver onder mediaan (~0.31)
  ];
  const r = detectMetaHookHoldWeakness(ads);
  check("hook ver onder mediaan triggert", r.triggered.some((t) => t.scope.includes("Zwak")));
  check("gemiddelde ads triggeren niet", !r.triggered.some((t) => t.scope.includes("A") && !t.scope.includes("Zwak")));
  check("leeg bij geen video-data", detectMetaHookHoldWeakness([ad({ hookRate: null, holdRate: null })]).triggered.length === 0);
}

console.log("\n5. Aggregator + checked-lijst");
{
  const r = buildMetaCreativeSignals({
    ads: [ad({ adName: "Moe", frequency: 3.5, linkCtr: 0.006, prevLinkCtr: 0.01, qualityRanking: "BELOW_AVERAGE_10" })],
    levels: [{ scope: "account", frequency: 5, impressions: 100000 }],
  });
  check("checked bevat alle vier de detectors", r.checked.length === 4);
  check("meerdere verhalen getriggerd", r.triggered.length >= 2);
  check("lege input geeft nul verhalen, geen fout", buildMetaCreativeSignals({ ads: [], levels: [] }).triggered.length === 0);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
