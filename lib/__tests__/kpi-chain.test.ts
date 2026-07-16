import { computeCampaignKpiChains, computeKpiChain } from "../analysis/kpi-chain";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("\n=== KPI Chain Tests ===\n");

console.log("1. CVR drop can become primary driver");
{
  const chain = computeKpiChain({
    currentMonth: { conversion_value: 1000, conversions: 20, clicks: 1000, impressions: 10000, ctr: 0.1, conversion_rate: 0.02, avg_cpc: 1, cost: 1000 },
    previousMonth: { conversion_value: 2200, conversions: 40, clicks: 1000, impressions: 10000, ctr: 0.1, conversion_rate: 0.04, avg_cpc: 1, cost: 1000 },
    resultMetric: "conversions",
  });
  assert(chain.primaryDriver === "conversion_rate", `expected conversion_rate primary driver, got ${chain.primaryDriver}`);
}

console.log("2. CPC rise appears in chain when it moves hardest");
{
  const chain = computeKpiChain({
    currentMonth: { conversion_value: 1300, conversions: 30, clicks: 900, impressions: 9000, ctr: 0.1, conversion_rate: 0.033, avg_cpc: 2.5, cost: 2250 },
    previousMonth: { conversion_value: 1400, conversions: 32, clicks: 920, impressions: 9200, ctr: 0.1, conversion_rate: 0.034, avg_cpc: 1.1, cost: 1012 },
    resultMetric: "conversions",
  });
  assert(chain.chain.some((item) => item.metric === "avg_cpc"), "avg_cpc should be present in conversions chain");
}

console.log("3. Impression drop can become primary driver");
{
  const chain = computeKpiChain({
    currentMonth: { conversion_value: 1000, conversions: 25, clicks: 400, impressions: 5000, ctr: 0.08, conversion_rate: 0.0625, avg_cpc: 1.2, cost: 480 },
    previousMonth: { conversion_value: 2000, conversions: 50, clicks: 800, impressions: 12000, ctr: 0.0667, conversion_rate: 0.0625, avg_cpc: 1.2, cost: 960 },
    resultMetric: "conversions",
  });
  assert(chain.primaryDriver === "impressions" || chain.primaryDriver === "clicks", `expected impressions/clicks primary driver, got ${chain.primaryDriver}`);
}

console.log("4. Multiple drivers stay visible in formatted chain");
{
  const chain = computeKpiChain({
    currentMonth: { conversion_value: 1600, conversions: 30, clicks: 700, impressions: 9000, ctr: 0.078, conversion_rate: 0.043, avg_cpc: 1.4, cost: 980 },
    previousMonth: { conversion_value: 2200, conversions: 45, clicks: 900, impressions: 12000, ctr: 0.075, conversion_rate: 0.05, avg_cpc: 1.2, cost: 1080 },
    resultMetric: "conversion_value",
  });
  assert(chain.formattedChain.split(". ").length >= 3, "formatted chain should mention multiple drivers");
}

console.log("5. Campaign-level chains are computed");
{
  const chains = computeCampaignKpiChains({
    campaignData: [
      { campaign_name: "Brand", month: "2026-03-01", conversions_value: 1200, conversions: 30, clicks: 600, impressions: 6000, ctr: 0.1, conversion_rate: 0.05, avg_cpc: 1.2, cost: 720 },
      { campaign_name: "Brand", month: "2026-02-01", conversions_value: 1600, conversions: 40, clicks: 650, impressions: 6100, ctr: 0.107, conversion_rate: 0.0615, avg_cpc: 1.1, cost: 715 },
      { campaign_name: "Generic", month: "2026-03-01", conversions_value: 700, conversions: 10, clicks: 500, impressions: 10000, ctr: 0.05, conversion_rate: 0.02, avg_cpc: 1.7, cost: 850 },
      { campaign_name: "Generic", month: "2026-02-01", conversions_value: 950, conversions: 14, clicks: 550, impressions: 9800, ctr: 0.056, conversion_rate: 0.025, avg_cpc: 1.6, cost: 880 },
    ],
    lastMonth: "2026-03",
    monthBeforeLast: "2026-02",
    resultMetric: "conversion_value",
  });
  assert(chains.length === 2, `expected 2 campaign chains, got ${chains.length}`);
  assert(chains[0]?.formattedChain.includes("Brand") || chains[1]?.formattedChain.includes("Brand"), "campaign name should be embedded in formatted chain");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
