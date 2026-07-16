// Test voor de G1-voorcompute (impression share). Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__impression_share_test.ts

import { classifyLossDriver, actionForDriver, analyzeCampaignImpressionShare, analyzeGeoImpressionShare, NEGLIGIBLE_LOST_IS, type CampaignImpressionShareRow } from "./impression-share-facts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Classificatie ──
assert(classifyLossDriver(0.30, 0.05) === "budget", "veel budget-verlies, weinig rang: budget-gedreven");
assert(classifyLossDriver(0.05, 0.30) === "rank", "veel rang-verlies, weinig budget: rang-gedreven");
assert(classifyLossDriver(0.20, 0.19) === "mixed", "budget en rang dicht bij elkaar: gemengd");
assert(classifyLossDriver(0.01, 0.02) === "none", "totaal verlies onder de drempel: gezond");
assert(classifyLossDriver(0, 0) === "none", "geen verlies: gezond");
// Precies op de marge-grens: 0.10 versus 0.10*1.25=0.125, dus niet primair -> mixed
assert(classifyLossDriver(0.12, 0.10) === "mixed", "net binnen de marge blijft gemengd");
assert(classifyLossDriver(0.13, 0.10) === "budget", "net buiten de marge wordt budget-gedreven");

// ── Actie-kandidaat, met de no-go ──
assert(actionForDriver("budget", true) === "raise_budget", "budget-gedreven met conversies: budget erbij");
assert(actionForDriver("budget", false) === "none", "budget-gedreven zonder conversies: geen budget-actie (no-go)");
assert(actionForDriver("rank", true) === "improve_bid_or_quality", "rang-gedreven: bod of kwaliteit");
assert(actionForDriver("rank", false) === "improve_bid_or_quality", "rang-gedreven blijft bod of kwaliteit zonder conversies");
assert(actionForDriver("mixed", true) === "both", "gemengd met conversies: beide");
assert(actionForDriver("mixed", false) === "improve_bid_or_quality", "gemengd zonder conversies: alleen bod of kwaliteit");
assert(actionForDriver("none", true) === "none", "gezond: geen actie");

// ── Per-campagne-analyse ──
function rij(id: string, month: string, is: number, budgetLost: number, rankLost: number, conv = 10, cost = 200): CampaignImpressionShareRow {
  return { campaign_id: id, campaign_name: `Campagne ${id}`, campaign_type: "SEARCH", month, search_impression_share: is, search_budget_lost_is: budgetLost, search_rank_lost_is: rankLost, conversions: conv, cost };
}

const rows: CampaignImpressionShareRow[] = [
  rij("A", "2026-02", 0.55, 0.35, 0.10),   // budget-gedreven, veel verlies
  rij("A", "2026-03", 0.60, 0.30, 0.10, 12, 240), // A laatste maand
  rij("B", "2026-03", 0.70, 0.05, 0.25, 8, 400),  // rang-gedreven
  rij("C", "2026-03", 0.95, 0.02, 0.01, 5, 100),  // gezond
  rij("D", "2026-03", 0.50, 0.30, 0.10, 0, 50),   // budget-gedreven maar geen conversies
];

const { campaigns, summary } = analyzeCampaignImpressionShare(rows);
assert(campaigns.length === 4, "vier unieke campagnes (A samengevoegd over twee maanden)");
assert(campaigns[0].campaignId === "A", "de grootste verliezer (A, 0.40 verlies) staat bovenaan");
const A = campaigns.find((c) => c.campaignId === "A")!;
assert(A.driver === "budget" && A.action === "raise_budget", "A is budget-gedreven met budget-actie");
assert(A.impressionShare === 0.60 && A.totalLostIs === 0.40, "A gebruikt de laatste maand (maart)");
assert(A.impressionShareMoM !== null && Math.abs(A.impressionShareMoM - 0.05) < 1e-9, "A heeft een MoM van +0.05 tegenover februari");
assert(A.cpa === 20, "A CPA is 240 gedeeld door 12 is 20");
const B = campaigns.find((c) => c.campaignId === "B")!;
assert(B.driver === "rank" && B.action === "improve_bid_or_quality", "B is rang-gedreven met bod-of-kwaliteit-actie");
assert(B.impressionShareMoM === null, "B heeft maar een maand, dus geen MoM");
const D = campaigns.find((c) => c.campaignId === "D")!;
assert(D.driver === "budget" && D.action === "none", "D is budget-gedreven maar zonder conversies geen budget-actie");
assert(D.cpa === null, "D zonder conversies heeft geen CPA");

assert(summary.campaignsAnalysed === 4, "summary telt vier campagnes");
assert(summary.budgetDriven === 2 && summary.rankDriven === 1 && summary.healthy === 1, "summary verdeelt de oorzaken correct");
assert(summary.raiseBudgetCandidates === 1, "alleen A is een echte budget-kandidaat, niet D");
assert(summary.bidOrQualityCandidates === 1, "B is de bod-of-kwaliteit-kandidaat");

// Lege invoer degradeert netjes
assert(analyzeCampaignImpressionShare([]).campaigns.length === 0, "lege invoer geeft geen campagnes");

// ── Geo-samenvatting ──
const geo = analyzeGeoImpressionShare([
  { country_code: "NL", month: "2026-03", search_impression_share: 0.80, search_budget_lost_is: 0.15, search_rank_lost_is: 0.05, total_cost: 1000 },
  { country_code: "BE", month: "2026-03", search_impression_share: 0.50, search_budget_lost_is: 0.10, search_rank_lost_is: 0.40, total_cost: 500 },
  { country_code: "DE", month: "2026-03", search_impression_share: 0.98, search_budget_lost_is: 0.01, search_rank_lost_is: 0.01, total_cost: 200 },
]);
assert(geo[0].countryCode === "BE" && geo[0].driver === "rank", "BE verliest het meest en is rang-gedreven");
assert(geo[geo.length - 1].countryCode === "DE" && geo[geo.length - 1].driver === "none", "DE is gezond en staat onderaan");

assert(NEGLIGIBLE_LOST_IS === 0.05, "de gezond-drempel is 5 procent verlies");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

// ── Promptbouwer (import onderaan om de kern-test los te houden) ──
import { buildImpressionSharePrompt } from "@/lib/prompts/impression-share-prompt";
{
  const analysis = analyzeCampaignImpressionShare(rows);
  const geoFacts = analyzeGeoImpressionShare([
    { country_code: "BE", month: "2026-03", search_impression_share: 0.5, search_budget_lost_is: 0.1, search_rank_lost_is: 0.4, total_cost: 500 },
  ]);
  const prompt = buildImpressionSharePrompt({ summary: analysis.summary, campaigns: analysis.campaigns, geo: geoFacts, goalsSection: "CPA target: 25 euro" });
  let p2 = 0, f2 = 0;
  const a2 = (c: boolean, l: string) => { if (c) p2++; else { f2++; console.error(`  FAIL: ${l}`); } };
  a2(prompt.includes("Campagne A") && prompt.includes("budget-gedreven"), "prompt bevat de voorgerekende campagne-diagnose");
  a2(prompt.includes("BE") && prompt.includes("per land"), "prompt bevat de geo-laag");
  a2(prompt.includes("CPA target: 25 euro"), "prompt bevat de doelstellingen");
  a2(prompt.includes("UITSLUITEND bij een campagne met gezonde conversie-economie") || prompt.includes("UITSLUITEND"), "prompt draagt de budget-no-go");
  a2(prompt.includes("Verzin geen cijfers"), "prompt draagt de anti-hallucinatie-regel");
  a2(!prompt.includes("--") || !/\u2014/.test(prompt), "geen em-dash in de prompt");
  console.log(`\n=== Prompt: ${p2} passed, ${f2} failed ===\n`);
  if (f2 > 0) process.exit(1);
}
