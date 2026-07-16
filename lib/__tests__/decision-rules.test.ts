import { computeDecisionRules } from "../analysis/decision-rules";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("\n=== Decision Rules Tests ===\n");

console.log("1. ROAS below target with high spend growth -> REDUCE");
{
  const output = computeDecisionRules({
    accountType: "ecommerce_roas",
    currentAccount: { conversions: 80, roas: 1.2, cost_per_conversion: 30 },
    previousAccount: { conversions: 90, roas: 2.4, cost_per_conversion: 22 },
    campaignRows: [{ campaign_name: "Search NL", roas: 1.2, cost: 1400, conversions: 40, cost_per_conversion: 35, search_budget_lost_is: 0.1 }],
    previousCampaignRows: [{ campaign_name: "Search NL", roas: 2.2, cost: 800, conversions: 38, cost_per_conversion: 21 }],
    geoRows: [],
    deviceRows: [],
    targets: { roasTarget: 2, conversionsTarget: 100 },
  });
  assert(output.campaignDecisions[0]?.direction === "reduce", "ROAS under target + high spend growth should reduce");
}

console.log("2. ROAS above target with high lost IS -> EXPAND");
{
  const output = computeDecisionRules({
    accountType: "ecommerce_roas",
    currentAccount: { conversions: 120, roas: 3.2, cost_per_conversion: 12 },
    previousAccount: { conversions: 110, roas: 3.1, cost_per_conversion: 12.5 },
    campaignRows: [{ campaign_name: "Brand", roas: 3.2, cost: 1200, conversions: 100, cost_per_conversion: 12, search_budget_lost_is: 0.24 }],
    previousCampaignRows: [{ campaign_name: "Brand", roas: 3.1, cost: 1100, conversions: 96, cost_per_conversion: 11.5 }],
    geoRows: [],
    deviceRows: [],
    targets: { roasTarget: 2.2, cpaTarget: 20, conversionsTarget: 100 },
  });
  assert(output.campaignDecisions[0]?.direction === "expand", "ROAS above target + budget lost IS should expand");
}

console.log("3. CPA near target -> MONITOR");
{
  const output = computeDecisionRules({
    accountType: "leadgen_cpa",
    currentAccount: { conversions: 100, roas: 0, cost_per_conversion: 48 },
    previousAccount: { conversions: 98, cost_per_conversion: 46 },
    campaignRows: [{ campaign_name: "Lead Search", cost: 1000, conversions: 20, cost_per_conversion: 48, search_budget_lost_is: 0.1 }],
    previousCampaignRows: [{ campaign_name: "Lead Search", cost: 900, conversions: 19, cost_per_conversion: 47 }],
    geoRows: [],
    deviceRows: [],
    targets: { cpaTarget: 50, conversionsTarget: 100 },
  });
  assert(output.campaignDecisions[0]?.direction === "monitor", "CPA near target should monitor");
}

console.log("4. Geo efficiency < 0.7 -> GEO_REDUCE");
{
  const output = computeDecisionRules({
    accountType: "ecommerce_roas",
    currentAccount: { conversions: 100, roas: 2.5, cost_per_conversion: 20, conversion_rate: 0.05 },
    campaignRows: [],
    geoRows: [
      { country: "NL", cost: 700, conversions_value: 2100 },
      { country: "DE", cost: 300, conversions_value: 120 },
    ],
    deviceRows: [],
    targets: { roasTarget: 2 },
  });
  const de = output.geoDecisions.find((item) => item.country === "DE");
  assert(de?.direction === "geo_reduce", "low geo efficiency should reduce");
}

console.log("5. Geo efficiency > 1.2 -> GEO_EXPAND");
{
  const output = computeDecisionRules({
    accountType: "ecommerce_roas",
    currentAccount: { conversions: 100, roas: 2.5, cost_per_conversion: 20, conversion_rate: 0.05 },
    campaignRows: [],
    geoRows: [
      { country: "NL", cost: 800, conversions_value: 1200 },
      { country: "BE", cost: 200, conversions_value: 900 },
    ],
    deviceRows: [],
    targets: { roasTarget: 2 },
  });
  const be = output.geoDecisions.find((item) => item.country === "BE");
  assert(be?.direction === "geo_expand", "high geo efficiency should expand");
}

console.log("6. Device CVR < 50% of account with >20% spend -> DEVICE_REDUCE");
{
  const output = computeDecisionRules({
    accountType: "ecommerce_roas",
    currentAccount: { conversions: 100, roas: 2.5, cost_per_conversion: 20, conversion_rate: 0.06 },
    campaignRows: [],
    geoRows: [],
    deviceRows: [
      { device: "DESKTOP", cost: 700, clicks: 1000, conversions: 70, conversion_rate: 0.07 },
      { device: "MOBILE", cost: 300, clicks: 1000, conversions: 10, conversion_rate: 0.01 },
    ],
    targets: { roasTarget: 2 },
  });
  const mobile = output.deviceDecisions.find((item) => item.device === "MOBILE");
  assert(mobile?.direction === "device_reduce", "weak device CVR should reduce");
}

console.log("7. Same campaign never gets both EXPAND and REDUCE");
{
  const output = computeDecisionRules({
    accountType: "ecommerce_roas",
    currentAccount: { conversions: 150, roas: 3.1, conversion_rate: 0.05 },
    campaignRows: [
      { campaign_name: "Brand", roas: 3.1, cost: 1500, conversions: 120, cost_per_conversion: 10, search_budget_lost_is: 0.25 },
      { campaign_name: "Brand", roas: 1.1, cost: 2500, conversions: 20, cost_per_conversion: 55, search_budget_lost_is: 0.25 },
    ],
    previousCampaignRows: [
      { campaign_name: "Brand", roas: 2.9, cost: 1400, conversions: 110, cost_per_conversion: 12 },
    ],
    geoRows: [],
    deviceRows: [],
    targets: { roasTarget: 2.2, cpaTarget: 20, conversionsTarget: 100 },
  });
  const brandDirections = output.campaignDecisions.filter((item) => item.campaignName === "Brand");
  assert(brandDirections.length === 1, "campaign decisions should be deduped to one per campaign");
}

console.log("8. Binding facts render clean decision strings");
{
  const output = computeDecisionRules({
    accountType: "ecommerce_roas",
    currentAccount: { conversions: 120, roas: 2.8, conversion_rate: 0.05 },
    campaignRows: [{ campaign_name: "Brand  Search", roas: 2.8, cost: 1200, conversions: 90, cost_per_conversion: 13, search_budget_lost_is: 0.21 }],
    previousCampaignRows: [{ campaign_name: "Brand  Search", roas: 2.5, cost: 1000, conversions: 80, cost_per_conversion: 12.5 }],
    geoRows: [],
    deviceRows: [],
    targets: { roasTarget: 2.2, cpaTarget: 20, conversionsTarget: 100 },
  });

  assert(!/\|\s*\|/.test(output.bindingFacts), "binding facts should not contain empty separator fragments");
  assert(/Brand Search|Brand  Search/.test(output.bindingFacts), "campaign should remain readable in binding facts");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
