// Test voor hefboom 3 (fit van de biedstrategie). Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__bid_strategy_test.ts

import { normalizeBidStrategy, classifyBidFit, analyzeBidStrategy, SMART_BIDDING_MIN_CONV, VALUE_BIDDING_MIN_CONV, type CampaignBidInput, type BidGoal } from "./bid-strategy-facts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Normalisatie van de echte strings ──
assert(normalizeBidStrategy("MANUAL_CPC") === "manual", "MANUAL_CPC is handmatig");
assert(normalizeBidStrategy("ENHANCED_CPC") === "manual", "ENHANCED_CPC is semi-handmatig");
assert(normalizeBidStrategy("MAXIMIZE_CONVERSIONS") === "smart_conversion", "MAXIMIZE_CONVERSIONS is conversie-smart");
assert(normalizeBidStrategy("TARGET_CPA") === "smart_conversion", "TARGET_CPA is conversie-smart");
assert(normalizeBidStrategy("MAXIMIZE_CONVERSION_VALUE") === "smart_value", "MAXIMIZE_CONVERSION_VALUE is waarde-smart");
assert(normalizeBidStrategy("TARGET_ROAS") === "smart_value", "TARGET_ROAS is waarde-smart");
assert(normalizeBidStrategy("TARGET_SPEND") === "non_conversion", "TARGET_SPEND is niet-conversie");
assert(normalizeBidStrategy("TARGET_IMPRESSION_SHARE") === "non_conversion", "TARGET_IMPRESSION_SHARE is niet-conversie");
assert(normalizeBidStrategy("target_roas") === "smart_value", "case-ongevoelig");
assert(normalizeBidStrategy(null) === "unknown" && normalizeBidStrategy("IETS") === "unknown", "leeg of onbekend is unknown");

const cpaGoal: BidGoal = { hasCpaTarget: true, hasRoasTarget: false };
const roasGoal: BidGoal = { hasCpaTarget: false, hasRoasTarget: true };
const geenGoal: BidGoal = { hasCpaTarget: false, hasRoasTarget: false };
const camp = (strategy: string, conversions: number, conversionsValue: number | null = null): CampaignBidInput =>
  ({ campaignId: "c", campaignName: "c", biddingStrategy: strategy, conversions, conversionsValue });

// ── Handmatig ──
assert(classifyBidFit(camp("MANUAL_CPC", 40), cpaGoal) === "upgrade_to_smart", "handmatig met veel volume: upgrade naar smart");
assert(classifyBidFit(camp("MANUAL_CPC", 5), cpaGoal) === "fit", "handmatig met weinig volume: prima");
assert(classifyBidFit(camp("ENHANCED_CPC", 40), cpaGoal) === "upgrade_to_smart", "eCPC met veel volume: upgrade");

// ── Smart zonder genoeg volume ──
assert(classifyBidFit(camp("TARGET_CPA", 8), cpaGoal) === "insufficient_volume", "doel-CPA met te weinig conversies: onvoldoende volume");
assert(classifyBidFit(camp("MAXIMIZE_CONVERSION_VALUE", 5, 1000), roasGoal) === "insufficient_volume", "waarde-smart met te weinig volume: onvoldoende volume");

// ── Waarde-strategie zonder waarde ──
assert(classifyBidFit(camp("TARGET_ROAS", 50, null), roasGoal) === "value_missing", "doel-ROAS zonder conversiewaarde: waarde ontbreekt");
assert(classifyBidFit(camp("TARGET_ROAS", 50, 0), roasGoal) === "value_missing", "conversiewaarde 0 telt als ontbrekend");

// ── Conversie-smart met ROAS-doel, waarde en volume ──
assert(classifyBidFit(camp("MAXIMIZE_CONVERSIONS", 40, 2000), roasGoal) === "switch_to_value", "conversie-smart met ROAS-doel en waarde: naar waarde-bieden");
assert(classifyBidFit(camp("MAXIMIZE_CONVERSIONS", 40, 2000), cpaGoal) === "fit", "conversie-smart met CPA-doel: prima");
assert(classifyBidFit(camp("MAXIMIZE_CONVERSIONS", 20, 2000), roasGoal) === "fit", "conversie-smart met ROAS-doel maar te weinig volume voor waarde-bieden: nog niet switchen");

// ── Niet-conversie-strategie ──
assert(classifyBidFit(camp("TARGET_SPEND", 40), cpaGoal) === "review_non_conversion", "TARGET_SPEND op een converterende campagne met doel: heroverweeg");
assert(classifyBidFit(camp("TARGET_IMPRESSION_SHARE", 40), geenGoal) === "fit", "niet-conversie zonder doel: legitiem, prima");
assert(classifyBidFit(camp("TARGET_SPEND", 3), cpaGoal) === "fit", "niet-conversie met weinig conversies: geen mismatch");

// ── Fit en unknown ──
assert(classifyBidFit(camp("TARGET_CPA", 40), cpaGoal) === "fit", "doel-CPA met genoeg volume en CPA-doel: past");
assert(classifyBidFit(camp("IETS_ONBEKENDS", 40), cpaGoal) === "unknown", "onbekende strategie: unknown");

// ── Volledige analyse: mismatches vooraan ──
const campaigns: CampaignBidInput[] = [
  camp2("goed", "TARGET_CPA", 40),
  camp2("handmatig_groot", "MANUAL_CPC", 100),
  camp2("waarde_kapot", "TARGET_ROAS", 50, null),
];
function camp2(id: string, strategy: string, conversions: number, conversionsValue: number | null = 500): CampaignBidInput {
  return { campaignId: id, campaignName: id, biddingStrategy: strategy, conversions, conversionsValue };
}
const result = analyzeBidStrategy(campaigns, cpaGoal);
assert(result.campaigns[0].fit !== "fit", "een mismatch staat bovenaan, niet de fit-campagne");
assert(result.summary.campaignsAnalysed === 3 && result.summary.fit === 1 && result.summary.mismatches === 2, "summary telt fit en mismatches correct");
assert(result.summary.byFit.upgrade_to_smart === 1 && result.summary.byFit.value_missing === 1, "byFit verdeelt de soorten");

assert(SMART_BIDDING_MIN_CONV === 15 && VALUE_BIDDING_MIN_CONV === 30, "de drempels staan op 15 en 30 conversies");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

// ── Promptbouwer ──
import { buildBidStrategyPrompt } from "@/lib/prompts/bid-strategy-prompt";
{
  const r = analyzeBidStrategy(campaigns, cpaGoal);
  const prompt = buildBidStrategyPrompt({ summary: r.summary, campaigns: r.campaigns, goal: cpaGoal, goalsSection: "CPA doel 25" });
  let p2 = 0, f2 = 0;
  const a2 = (c: boolean, l: string) => { if (c) p2++; else { f2++; console.error(`  FAIL: ${l}`); } };
  a2(prompt.includes("handmatig_groot") && prompt.includes("upgrade_to_smart"), "prompt bevat de voorgerekende diagnose");
  a2(prompt.includes("CPA-doel"), "prompt noemt het doel");
  a2(prompt.includes("smart bidding UITSLUITEND bij campagnes met genoeg conversievolume"), "prompt draagt de smart-bidding-no-go");
  a2(prompt.includes("waarde-bieden UITSLUITEND als de conversiewaarde"), "prompt draagt de waarde-no-go");
  a2(!/\u2014/.test(prompt), "geen em-dash in de prompt");
  console.log(`\n=== Prompt: ${p2} passed, ${f2} failed ===\n`);
  if (f2 > 0) process.exit(1);
}
