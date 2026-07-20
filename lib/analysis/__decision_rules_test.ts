// Zelf-draaiende test voor de deterministische beslisregels (de keystone: hier komt de
// actierichting per campagne/geo/device vandaan). Draait via tsx. Kern: accountstatus tegen
// target, de campagne-triggers (reduce/investigate/expand/monitor) voor ROAS- en CPA-accounts,
// de geo- en device-efficiency-drempels, en dat de bindende feiten de richting in kapitalen
// vastleggen zodat het LLM er niet tegenin kan gaan.

import { computeDecisionRules, type DecisionRulesInput } from "./decision-rules";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const base = (over: Partial<DecisionRulesInput>): DecisionRulesInput => ({
  accountType: "ecommerce_roas",
  currentAccount: {},
  campaignRows: [],
  geoRows: [],
  deviceRows: [],
  targets: {},
  ...over,
});

console.log("accountstatus:");
{
  const op = computeDecisionRules(base({ currentAccount: { conversions: 100 }, targets: { conversionsTarget: 100 } }));
  assert(op.accountStatus === "OP SCHEMA", "conversies op target zonder roas/cpa-target => OP SCHEMA");
  const niet = computeDecisionRules(base({ currentAccount: { conversions: 85 }, targets: { conversionsTarget: 100 } }));
  assert(niet.accountStatus === "NIET OP SCHEMA", "85% van target => NIET OP SCHEMA");
  const kritiek = computeDecisionRules(base({ currentAccount: { conversions: 50 }, targets: { conversionsTarget: 100 } }));
  assert(kritiek.accountStatus === "KRITIEK", "onder 80% van target => KRITIEK");
}

console.log("campagne-richting (ROAS-account):");
{
  const reduce = computeDecisionRules(base({
    accountType: "ecommerce_roas",
    campaignRows: [{ campaign_name: "Slecht", roas: 1.0, cost: 200 }],
    previousCampaignRows: [{ campaign_name: "Slecht", cost: 100 }],
    targets: { roasTarget: 3 },
  })).campaignDecisions[0];
  assert(reduce.direction === "reduce" && reduce.confidence === "high", "ROAS ver onder target + spend explodeert => reduce/high");

  const investigate = computeDecisionRules(base({
    accountType: "ecommerce_roas",
    campaignRows: [{ campaign_name: "Slecht", roas: 1.0, cost: 200 }],
    previousCampaignRows: [{ campaign_name: "Slecht", cost: 195 }],
    targets: { roasTarget: 3 },
  })).campaignDecisions[0];
  assert(investigate.direction === "investigate", "ROAS onder target maar vlakke spend => investigate");

  const expand = computeDecisionRules(base({
    accountType: "ecommerce_roas",
    campaignRows: [{ campaign_name: "Winner", roas: 4.0, cost: 100, search_budget_lost_is: 15 }],
    targets: { roasTarget: 3 },
  })).campaignDecisions[0];
  assert(expand.direction === "expand", "ROAS ruim boven target + budgetverlies => expand");
}

console.log("campagne-richting (CPA-leadgen):");
{
  const reduce = computeDecisionRules(base({
    accountType: "leadgen_cpa",
    campaignRows: [{ campaign_name: "Duur", cost_per_conversion: 50, cost: 200 }],
    previousCampaignRows: [{ campaign_name: "Duur", cost: 100 }],
    targets: { cpaTarget: 30 },
  })).campaignDecisions[0];
  assert(reduce.direction === "reduce", "CPA ver boven target + spend stijgt => reduce");

  const expand = computeDecisionRules(base({
    accountType: "leadgen_cpa",
    campaignRows: [{ campaign_name: "Efficient", cost_per_conversion: 20, cost: 100, search_budget_lost_is: 20 }],
    targets: { cpaTarget: 30 },
  })).campaignDecisions[0];
  assert(expand.direction === "expand", "CPA onder target + budgetverlies => expand");
}

console.log("geo- en device-richting:");
{
  const geo = computeDecisionRules(base({
    geoRows: [
      { country: "NL", cost: 100, conversions_value: 50 },
      { country: "DE", cost: 100, conversions_value: 150 },
    ],
  })).geoDecisions;
  const nl = geo.find((g) => g.country === "NL");
  const de = geo.find((g) => g.country === "DE");
  assert(nl?.direction === "geo_reduce", "land dat meer spend absorbeert dan het teruggeeft => geo_reduce");
  assert(de?.direction === "geo_expand", "land met disproportionele conversiewaarde => geo_expand");

  const dev = computeDecisionRules(base({
    currentAccount: { conversion_rate: 0.05 },
    deviceRows: [
      { device: "mobile", cost: 100, clicks: 1000, conversions: 10 },
      { device: "desktop", cost: 100, clicks: 1000, conversions: 100 },
    ],
  })).deviceDecisions;
  assert(dev.find((d) => d.device === "mobile")?.direction === "device_reduce", "device dat ver onder account-CVR converteert => device_reduce");
  assert(dev.find((d) => d.device === "desktop")?.direction === "device_expand", "device dat ruim boven account-CVR converteert => device_expand");
}

console.log("bindende feiten:");
{
  const out = computeDecisionRules(base({
    accountType: "ecommerce_roas",
    campaignRows: [{ campaign_name: "Slecht", roas: 1.0, cost: 200 }],
    previousCampaignRows: [{ campaign_name: "Slecht", cost: 100 }],
    targets: { roasTarget: 3 },
  }));
  assert(/BINDENDE ACTIERICHTINGEN/.test(out.bindingFacts), "bindende feiten dragen de kop");
  assert(/Slecht: REDUCE/.test(out.bindingFacts), "richting staat in kapitalen bij de campagne");
  assert(/REDUCE = je mag NIET/.test(out.bindingFacts), "expliciete tegen-regel voor reduce");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle decision-rules-tests geslaagd");
