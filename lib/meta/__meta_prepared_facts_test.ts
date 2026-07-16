// Fixture-test voor de per-stap fact-assemblage (M2 data-laag). Deterministisch, geen IO.
// Draaien: npx tsx lib/meta/__meta_prepared_facts_test.ts

import { buildMetaStepFacts, type MetaBreakdownComputeRow, type MetaPreparedInputs } from "./prepared-facts";
import type { MetaComputeRow } from "./prepared-compute";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function eq(actual: unknown, expected: unknown, label: string): void {
  assert(actual === expected, `${label} (verwacht ${expected}, kreeg ${actual})`);
}

// Helper: daily-rijen over opeenvolgende dagen in 2026-03.
function days(entity_id: string, name: string, startDay: number, count: number, impr: number, link_clicks: number, frequency: number, conversions = 0, conversion_value = 0): MetaComputeRow[] {
  const rows: MetaComputeRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ date: `2026-03-${String(startDay + i).padStart(2, "0")}`, entity_id, entity_name: name, impressions: impr, spend: impr * 0.01, link_clicks, conversions, conversion_value, frequency });
  }
  return rows;
}

// Account: februari en maart, met funnelvelden in beide maanden.
const account: MetaComputeRow[] = [
  { date: "2026-02-15", entity_id: "acc", impressions: 10000, spend: 1000, link_clicks: 200, conversions: 20, conversion_value: 4000, frequency: 1.8, landing_page_views: 900, add_to_cart: 180, initiate_checkout: 100 },
  { date: "2026-03-15", entity_id: "acc", impressions: 12000, spend: 1000, link_clicks: 180, conversions: 15, conversion_value: 3000, frequency: 2.4, landing_page_views: 1000, add_to_cart: 200, initiate_checkout: 100 },
];

// Campagnes in de laatste maand: camp_a boven, camp_b onder het accountgemiddelde (link CTR 1,5%).
const campaigns: MetaComputeRow[] = [
  { date: "2026-03-15", entity_id: "camp_a", entity_name: "Campagne A", impressions: 6000, spend: 500, link_clicks: 120, conversions: 10, conversion_value: 2000, frequency: 2.2 },
  { date: "2026-03-15", entity_id: "camp_b", entity_name: "Campagne B", impressions: 6000, spend: 500, link_clicks: 60, conversions: 5, conversion_value: 1000, frequency: 2.6 },
];

const adsets: MetaComputeRow[] = [
  { date: "2026-03-15", entity_id: "as_1", entity_name: "Ad set 1", impressions: 8000, spend: 600, link_clicks: 140, conversions: 12, conversion_value: 2400, frequency: 2.3 },
];

// Ads: een vermoeide ad (fatigue), een winnaar (hoge ROAS), een stabiele.
const adFatigued = [...days("ad_fatigue", "Vermoeide ad", 1, 7, 1000, 20, 1.5), ...days("ad_fatigue", "Vermoeide ad", 8, 7, 1000, 10, 3.0)];
const adWinner = days("ad_winner", "Winnaar ad", 1, 14, 1000, 20, 1.5, 5, 1000);
const ads: MetaComputeRow[] = [...adFatigued, ...adWinner];

// Breakdowns: placement met waste, en demografie met en zonder volume.
const breakdowns: MetaBreakdownComputeRow[] = [
  { date: "2026-03-15", breakdown_type: "publisher_platform", breakdown_value: "facebook_feed", impressions: 5000, spend: 500, link_clicks: 100, conversions: 10, conversion_value: 2000 },
  { date: "2026-03-15", breakdown_type: "publisher_platform", breakdown_value: "audience_network", impressions: 2000, spend: 200, link_clicks: 10, conversions: 0, conversion_value: 0 },
  { date: "2026-03-15", breakdown_type: "age_gender", breakdown_value: "25-34|female", impressions: 4000, spend: 400, link_clicks: 90, conversions: 15, conversion_value: 3000 },
  { date: "2026-03-15", breakdown_type: "age_gender", breakdown_value: "18-24|male", impressions: 1000, spend: 100, link_clicks: 15, conversions: 3, conversion_value: 300 },
];

const inputs: MetaPreparedInputs = { account, campaigns, adsets, ads, breakdowns, targets: { roasTarget: 3 } };
const facts = buildMetaStepFacts(inputs) as Record<number, any>;

// 1. Alle 11 stappen aanwezig.
eq(Object.keys(facts).length, 11, "facts heeft 11 stappen");
for (let s = 1; s <= 11; s++) assert(facts[s] !== undefined, `stap ${s} aanwezig`);

// 2. Stap 1: laatste maand, MoM-keten en target-status.
eq(facts[1].latest_month, "2026-03", "stap 1 laatste maand maart");
eq(facts[1].previous_month, "2026-02", "stap 1 vorige maand februari");
const convFact = facts[1].mom_chain.find((c: any) => c.metric === "Conversies");
eq(convFact.delta_pct, -25, "stap 1: Conversies MoM -25%");
eq(facts[1].target.type, "ROAS", "stap 1: ROAS-target gebruikt");
eq(facts[1].target.status, "OP SCHEMA", "stap 1: ROAS 3,0 haalt target 3 (OP SCHEMA)");

// 3. Stap 2: camp_a boven, camp_b onder het accountgemiddelde op Link CTR.
const campA = facts[2].entities.find((e: any) => e.entity_id === "camp_a");
const campB = facts[2].entities.find((e: any) => e.entity_id === "camp_b");
eq(campA.vs_average.find((v: any) => v.metric === "Link CTR").position, "boven", "stap 2: camp_a boven gemiddelde Link CTR");
eq(campB.vs_average.find((v: any) => v.metric === "Link CTR").position, "onder", "stap 2: camp_b onder gemiddelde Link CTR");

// 4. Stap 4: vermoeide ad is bleeder met fatigue-flag, winnaar is winnaar.
const adF = facts[4].ads.find((a: any) => a.entity_id === "ad_fatigue");
const adW = facts[4].ads.find((a: any) => a.entity_id === "ad_winner");
eq(adF.fatigue.flag, true, "stap 4: vermoeide ad fatigue true");
eq(adF.classification, "bleeder", "stap 4: vermoeide ad geclassificeerd als bleeder");
eq(adW.classification, "winnaar", "stap 4: hoge-ROAS ad geclassificeerd als winnaar");

// 5. Stap 6: audience_network heeft waste (spend zonder conversies).
const an = facts[6].segments.find((s: any) => s.breakdown_value === "audience_network");
eq(facts[6].available, true, "stap 6 beschikbaar");
eq(an.waste, true, "stap 6: audience_network is waste");

// 6. Stap 7: 25-34 haalt volume, 18-24 niet (gate op 10 conversies).
const seg2534 = facts[7].segments.find((s: any) => s.breakdown_value === "25-34|female");
const seg1824 = facts[7].segments.find((s: any) => s.breakdown_value === "18-24|male");
eq(seg2534.volume_ok, true, "stap 7: 25-34 haalt minimumvolume");
eq(seg1824.volume_ok, false, "stap 7: 18-24 onder minimumvolume");

// 7. Stap 8: funnel beschikbaar, eerste fase (Impressions naar LPV) is een hoge drop-off.
eq(facts[8].available, true, "stap 8 funnel beschikbaar");
const firstStage = facts[8].stages[0];
eq(firstStage.flag_high, true, "stap 8: Impressions naar LPV is hoge drop-off (>50%)");

// 8. Stap 5 en 11 zijn expliciete markers.
eq(facts[5].available, false, "stap 5 markeert geen vision-data");
assert(typeof facts[11].note === "string", "stap 11 is een synthese-marker");

// 9. Stap 10: weekdagen aanwezig.
assert(Array.isArray(facts[10].days) && facts[10].days.length >= 1, "stap 10 heeft weekdagen");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
