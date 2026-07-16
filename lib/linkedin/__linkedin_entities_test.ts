// Test voor de LinkedIn targeting-condensatie en entiteit-mappers (L1). Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__linkedin_entities_test.ts

import { condenseTargetingCriteria, campaignToDbRow, campaignGroupToDbRow, creativeToDbRow } from "./entities";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Targeting-condensatie: include-and met locaties, senioriteit en functies; exclude met industrie
const criteria = {
  include: {
    and: [
      { or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:103644278", "urn:li:geo:101165590"] } },
      { or: { "urn:li:adTargetingFacet:seniorities": ["urn:li:seniority:5", "urn:li:seniority:6"] } },
      { or: { "urn:li:adTargetingFacet:titles": ["urn:li:title:100"] } },
      { or: { "urn:li:adTargetingFacet:staffCountRanges": ["urn:li:staffCountRange:(11,50)"] } },
    ],
  },
  exclude: { or: { "urn:li:adTargetingFacet:industries": ["urn:li:industry:43"] } },
};
const summary = condenseTargetingCriteria(criteria);
assert(summary.locations.length === 2, "twee locaties gecondenseerd");
assert(summary.seniorities.includes("urn:li:seniority:5"), "senioriteit gecondenseerd");
assert(summary.functions.includes("urn:li:title:100"), "functie (titles-facet) naar functions");
assert(summary.company_sizes.length === 1, "bedrijfsgrootte (staffCountRanges) gecondenseerd");
assert(summary.exclusions.includes("urn:li:industry:43"), "exclude naar uitsluitingen");
assert(summary.industries.length === 0, "uitgesloten industrie staat niet bij include-industrie");

// Dedup en lege input
const dup = condenseTargetingCriteria({ include: { and: [
  { or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:1", "urn:li:geo:1"] } },
] } });
assert(dup.locations.length === 1, "dubbele locatie gededupliceerd");
const emptySummary = condenseTargetingCriteria(null);
assert(emptySummary.locations.length === 0 && emptySummary.exclusions.length === 0, "null-criteria geeft lege samenvatting");

// Campagne-mapper: bevat de gecondenseerde targeting_summary en mapt budget/kosten
const campaign = {
  id: "urn:li:sponsoredCampaign:123",
  campaignGroup: "urn:li:sponsoredCampaignGroup:9",
  name: "Test",
  status: "ACTIVE",
  type: "SPONSORED_UPDATES",
  costType: "CPM",
  dailyBudget: { amount: "150.00" },
  unitCost: { amount: "12.50" },
  targetingCriteria: criteria,
};
const cRow = campaignToDbRow(campaign, "client-9");
assert(cRow.campaign_urn === "urn:li:sponsoredCampaign:123", "campaign_urn gemapt");
assert(cRow.group_urn === "urn:li:sponsoredCampaignGroup:9", "group_urn gemapt");
assert(cRow.daily_budget === 150 && cRow.unit_cost === 12.5, "budget en unit_cost geparsed");
assert(cRow.cost_type === "CPM", "cost_type gemapt");
const ts = cRow.targeting_summary as { locations: string[] };
assert(ts.locations.length === 2, "targeting_summary ingebed in de campagnerij");
assert(cRow.client_id === "client-9", "client_id gezet");

// Campaign group en creative mappers
const gRow = campaignGroupToDbRow({ id: "urn:li:sponsoredCampaignGroup:9", name: "Groep", status: "ACTIVE", runSchedule: { start: 1735689600000 } }, "client-9");
assert(gRow.group_urn === "urn:li:sponsoredCampaignGroup:9" && gRow.start_date != null, "campaign group gemapt met start_date");

const crRow = creativeToDbRow({ id: "urn:li:sponsoredCreative:5", campaign: "urn:li:sponsoredCampaign:123", status: "ACTIVE", format: "single_image" }, "client-9");
assert(crRow.creative_urn === "urn:li:sponsoredCreative:5" && crRow.campaign_urn === "urn:li:sponsoredCampaign:123", "creative gemapt");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
