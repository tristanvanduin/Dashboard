// Test voor de LinkedIn facts-assemblage (L2). Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__linkedin_facts_test.ts

import { buildLinkedinStepFacts, type LinkedInPreparedInputs } from "./prepared-facts";
import type { LinkedInComputeRow } from "./prepared-compute";
import type { LinkedInDemographicRow } from "./types";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function row(date: string, urn: string, impressions: number, clicks: number, spend: number, leads: number, form_opens: number, name?: string): LinkedInComputeRow {
  return { date, entityUrn: urn, entityName: name, impressions, clicks, spend, leads, form_opens, conversions: 0, conversion_value: 0 };
}
function demo(urn: string, spend: number | null, leads: number, coverage: number | null = null): LinkedInDemographicRow {
  return { date: "2026-03-15", level: "CAMPAIGN", entityUrn: "urn:li:sponsoredCampaign:1", pivotType: "MEMBER_JOB_FUNCTION", pivotValueUrn: urn, impressions: 0, clicks: 0, spend, leads, conversions: 0, coveragePct: coverage };
}

// Account: twee maanden, met leads en CPL-verbetering
const account: LinkedInComputeRow[] = [
  row("2026-02-10", "acct", 5000, 100, 400, 5, 25),
  row("2026-02-20", "acct", 5000, 100, 400, 5, 25),
  row("2026-03-10", "acct", 6000, 150, 300, 10, 50),
  row("2026-03-20", "acct", 6000, 150, 300, 10, 50),
];
// Campagnes in maart: c1 sterk (lage CPL), c2 zwak (hoge CPL)
const campaigns: LinkedInComputeRow[] = [
  row("2026-03-10", "urn:li:sponsoredCampaign:1", 6000, 120, 240, 16, 40, "Sterke campagne"),
  row("2026-03-10", "urn:li:sponsoredCampaign:2", 6000, 180, 360, 4, 60, "Zwakke campagne"),
];
// Creatives in maart met formats, met genoeg dagen voor CTR-verval
const creatives: LinkedInComputeRow[] = [];
for (let d = 1; d <= 14; d++) {
  const day = `2026-03-${String(d).padStart(2, "0")}`;
  const decayCtr = d <= 7 ? 200 : 100; // clicks daalt in de tweede week
  creatives.push(row(day, "urn:li:sponsoredCreative:a", 10000, decayCtr, 100, 5, 20));
  creatives.push(row(day, "urn:li:sponsoredCreative:b", 10000, 50, 100, 1, 10));
}
const demographics: LinkedInDemographicRow[] = [
  demo("urn:li:function:4", 300, 8),   // in ICP
  demo("urn:li:function:8", 200, 4),   // in ICP
  demo("urn:li:function:13", 250, 2),  // niet-ICP
  demo("TOTAL", 750, 14, 0.8),
];
const inputs: LinkedInPreparedInputs = {
  account, campaigns, creatives, demographics,
  campaignMeta: [
    { entityUrn: "urn:li:sponsoredCampaign:1", name: "Sterke campagne", objective: "LEAD_GENERATION", cost_type: "CPC", bid_strategy: "MANUAL", audience_count: 25000 },
    { entityUrn: "urn:li:sponsoredCampaign:2", name: "Zwakke campagne", objective: "LEAD_GENERATION", cost_type: "CPM", bid_strategy: "MAX_DELIVERY", audience_count: 8000 },
  ],
  creativeMeta: [
    { entityUrn: "urn:li:sponsoredCreative:a", format: "single_image" },
    { entityUrn: "urn:li:sponsoredCreative:b", format: "video" },
  ],
  icp: { job_functions: ["urn:li:function:4", "urn:li:function:8"], seniorities: [], industries: [], company_sizes: [] },
  targets: { cplTarget: 40 },
};

const facts = buildLinkedinStepFacts(inputs);
assert(Object.keys(facts).length === 9, "negen stappen geassembleerd");

// Stap 1: MoM-keten en CPL-target-gap
const s1 = facts[1] as { mom_chain: { metric: string }[]; target_gap: { status: string; cpl: number } | null; latest_month: string };
assert(s1.latest_month === "2026-03", "stap 1 laatste maand");
assert(s1.mom_chain[0].metric === "Leads", "stap 1 keten begint met Leads");
// Maart account-CPL = 600/20 = 30, target 40 -> OP SCHEMA
assert(s1.target_gap?.cpl === 30 && s1.target_gap?.status === "OP SCHEMA", "stap 1 CPL-target-gap OP SCHEMA");

// Stap 2: campagnes versus accountgemiddelde
const s2 = facts[2] as { entities: { entity: string; cpl: { position: string }; cost_type: string | null }[] };
assert(s2.entities.length === 2, "stap 2 twee campagnes");
const c1 = s2.entities.find((e) => e.entity === "urn:li:sponsoredCampaign:1");
const c2 = s2.entities.find((e) => e.entity === "urn:li:sponsoredCampaign:2");
assert(c1?.cpl.position === "onder", "sterke campagne CPL onder accountgemiddelde");
assert(c2?.cpl.position === "boven", "zwakke campagne CPL boven accountgemiddelde");
assert(c1?.cost_type === "CPC", "campagne-metadata (cost_type) meegenomen");

// Stap 4: creatives per format met label en CTR-verval
const s4 = facts[4] as { creatives: { creative: string; format: string; label: string; ctr_decay: { decline_pct: number } | null }[] };
const creativeA = s4.creatives.find((c) => c.creative === "urn:li:sponsoredCreative:a");
assert(creativeA?.format === "single_image", "creative-format uit metadata");
assert(creativeA?.ctr_decay != null && creativeA.ctr_decay.decline_pct < 0, "CTR-verval gedetecteerd (dalend)");

// Stap 5: ICP-fit
const s5 = facts[5] as { available: boolean; degraded: boolean; pivots: { spendInIcpPct: number | null }[] };
assert(s5.available && !s5.degraded, "stap 5 ICP-fit beschikbaar en niet gedegradeerd");
assert(s5.pivots[0].spendInIcpPct != null && s5.pivots[0].spendInIcpPct > 0.6, "ICP spend-aandeel berekend (500/750)");

// Stap 6: funnel
const s6 = facts[6] as { has_leadgen: boolean; completion_rate_pct: number | null };
assert(s6.has_leadgen === true, "stap 6 detecteert leadgen");
assert(s6.completion_rate_pct === 20, "completion rate = 20/100 = 20%");

// Stap 7: verzadiging
const s7 = facts[7] as { cpm_trend_3m: string; saturation_signal: boolean; audience_sizes: unknown[] };
assert(typeof s7.saturation_signal === "boolean", "stap 7 verzadigingssignaal aanwezig");
assert(s7.audience_sizes.length === 2, "stap 7 audience-omvang uit metadata");

// Stap 8: bidding
const s8 = facts[8] as { available: boolean; campaigns: { cost_type: string | null }[] };
assert(s8.available && s8.campaigns.length === 2, "stap 8 bidding uit metadata");

// Stap 8 degradeert zonder metadata
const noBidding = buildLinkedinStepFacts({ ...inputs, campaignMeta: undefined })[8] as { available: boolean };
assert(noBidding.available === false, "stap 8 degradeert netjes zonder metadata");

// Stap 5 degradeert bij lege ICP
const emptyIcpFacts = buildLinkedinStepFacts({ ...inputs, icp: { job_functions: [], seniorities: [], industries: [], company_sizes: [] } })[5] as { degraded: boolean };
assert(emptyIcpFacts.degraded === true, "stap 5 degradeert bij lege ICP");

// Stap 9: synthese-marker
const s9 = facts[9] as { note: string; account_months: number };
assert(s9.account_months === 2 && /synthese/i.test(s9.note), "stap 9 synthese-marker");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
