// Zelf-draaiende test voor de KPI-keten (verklaart WAAROM het resultaat bewoog). Draait via tsx.
// Kern: de resultdelta uit totalen, de primaire driver = de metriek met het grootste relatieve
// verschil, de bijdrage-richting (helpt/schaadt het resultaat), en de per-campagne-variant die
// alleen maanden met beide datapunten meeneemt en op impact sorteert.

import { computeKpiChain, computeCampaignKpiChains } from "./kpi-chain";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

console.log("kern-keten (conversiewaarde):");
{
  const kc = computeKpiChain({
    previousMonth: { conversions: 100, conversion_value: 10000, clicks: 1000, impressions: 10000 },
    currentMonth: { conversions: 150, conversion_value: 15000, clicks: 1000, impressions: 10000 },
    resultMetric: "conversion_value",
  });
  assert(kc.resultDelta === 50, "conversiewaarde +50% uit totalen");
  assert(kc.primaryDriver === "conversions", "primaire driver = grootste relatieve beweging (conversies)");
  assert(kc.chain[0].rank === 1 && kc.chain[0].metric === "conversions", "de driver staat op rang 1");
  assert(kc.chain.find((l) => l.metric === "conversions")?.contribution === "positive", "stijgende conversies helpen een stijgend resultaat");
  assert(kc.chain.find((l) => l.metric === "aov")?.contribution === "neutral", "vlakke AOV is neutraal");
  assert(/Conversiewaarde/.test(kc.formattedChain) && /Conversies/.test(kc.formattedChain), "leesbare keten benoemt resultaat en driver");
}

console.log("bijdrage-richting bij een daling (positive = verklaart de richting, negative = werkte tegen):");
{
  const kc = computeKpiChain({
    previousMonth: { conversions: 200, conversion_value: 20000, clicks: 1000, impressions: 10000 },
    currentMonth: { conversions: 100, conversion_value: 10000, clicks: 2000, impressions: 10000 },
    resultMetric: "conversion_value",
  });
  assert(kc.resultDelta === -50, "conversiewaarde -50%");
  assert(kc.chain.find((l) => l.metric === "conversion_rate")?.contribution === "positive", "dalende CVR beweegt mee met de daling => verklaart het (positive)");
  assert(kc.chain.find((l) => l.metric === "clicks")?.contribution === "negative", "stijgende clicks werkten tegen de daling in => negative");
}

console.log("per-campagne-ketens:");
{
  const chains = computeCampaignKpiChains({
    campaignData: [
      { campaign_name: "A", month: "2026-06", conversions_value: 200, conversions: 20, clicks: 100, impressions: 1000 },
      { campaign_name: "A", month: "2026-05", conversions_value: 100, conversions: 10, clicks: 100, impressions: 1000 },
      { campaign_name: "B", month: "2026-06", conversions_value: 110, conversions: 11, clicks: 100, impressions: 1000 },
      { campaign_name: "B", month: "2026-05", conversions_value: 100, conversions: 10, clicks: 100, impressions: 1000 },
      { campaign_name: "C", month: "2026-06", conversions_value: 999, conversions: 99, clicks: 100, impressions: 1000 },
    ],
    lastMonth: "2026-06",
    monthBeforeLast: "2026-05",
    resultMetric: "conversion_value",
  });
  assert(chains.length === 2, "alleen campagnes met beide maanden tellen mee (C valt af)");
  assert(chains[0].formattedChain.startsWith("A:"), "grootste beweging (A, +100%) staat vooraan");
  assert(chains[0].resultDelta === 100 && chains[1].resultDelta === 10, "resultdelta per campagne klopt en is gesorteerd");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle kpi-chain-tests geslaagd");
