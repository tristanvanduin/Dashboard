// Test voor hefboom 2 (marginale budgetallocatie). Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__budget_allocation_test.ts

import { efficiencyStatus, budgetActionFor, analyzeBudgetAllocation, type CampaignBudgetInput, type BudgetTarget } from "./budget-allocation-facts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Efficientie tegen CPA-target (lager is beter), target 25 ──
const cpaT: BudgetTarget = { targetCpa: 25 };
assert(efficiencyStatus({ campaignId: "a", campaignName: "a", cost: 200, conversions: 10 }, cpaT) === "beating", "CPA 20 onder target 25: beating");
assert(efficiencyStatus({ campaignId: "a", campaignName: "a", cost: 250, conversions: 10 }, cpaT) === "on_target", "CPA 25 precies op target: on_target");
assert(efficiencyStatus({ campaignId: "a", campaignName: "a", cost: 350, conversions: 10 }, cpaT) === "missing", "CPA 35 boven target: missing");
assert(efficiencyStatus({ campaignId: "a", campaignName: "a", cost: 200, conversions: 0 }, cpaT) === "unknown", "geen conversies: unknown");

// ── Efficientie tegen ROAS-target (hoger is beter), target 4 ──
const roasT: BudgetTarget = { targetRoas: 4 };
assert(efficiencyStatus({ campaignId: "a", campaignName: "a", cost: 100, conversionsValue: 500 }, roasT) === "beating", "ROAS 5 boven target 4: beating");
assert(efficiencyStatus({ campaignId: "a", campaignName: "a", cost: 100, conversionsValue: 400 }, roasT) === "on_target", "ROAS 4 op target: on_target");
assert(efficiencyStatus({ campaignId: "a", campaignName: "a", cost: 100, conversionsValue: 300 }, roasT) === "missing", "ROAS 3 onder target: missing");
assert(efficiencyStatus({ campaignId: "a", campaignName: "a", cost: 100 }, roasT) === "unknown", "geen conversiewaarde: unknown");
// ROAS krijgt voorrang boven CPA als beide targets er zijn
assert(efficiencyStatus({ campaignId: "a", campaignName: "a", cost: 100, conversionsValue: 500, conversions: 1 }, { targetCpa: 25, targetRoas: 4 }) === "beating", "ROAS krijgt voorrang bij beide targets");

// ── Budgetbeslissing ──
// Efficient plus groeiruimte plus niet rang-beperkt: scale_up
const up = budgetActionFor({ campaignId: "A", campaignName: "A", cost: 200, conversions: 10, budgetLostIs: 0.30, rankLostIs: 0.05 }, cpaT);
assert(up.action === "scale_up" && up.marginalScore > 0, "efficient met budget-groeiruimte: scale_up met positieve score");
// Efficient maar rang-beperkt: hold, geen extra budget
const rankLimited = budgetActionFor({ campaignId: "B", campaignName: "B", cost: 200, conversions: 10, budgetLostIs: 0.05, rankLostIs: 0.30 }, cpaT);
assert(rankLimited.action === "hold" && rankLimited.rankLimited, "efficient maar rang-beperkt: hold, eerst bod of kwaliteit");
// Inefficient: scale_down
const down = budgetActionFor({ campaignId: "C", campaignName: "C", cost: 400, conversions: 10, budgetLostIs: 0.20, rankLostIs: 0.05 }, cpaT);
assert(down.action === "scale_down" && down.marginalScore === 0, "haalt de target niet: scale_down, geen marginale score");
// Efficient maar geen groeiruimte: hold
const noHead = budgetActionFor({ campaignId: "D", campaignName: "D", cost: 200, conversions: 10, budgetLostIs: 0.02, rankLostIs: 0.02, budgetUtilization: 0.5 }, cpaT);
assert(noHead.action === "hold", "efficient zonder groeiruimte: hold");
// Hoge budgetbenutting telt ook als groeiruimte
const capped = budgetActionFor({ campaignId: "E", campaignName: "E", cost: 200, conversions: 10, budgetLostIs: 0.03, rankLostIs: 0.02, budgetUtilization: 0.95 }, cpaT);
assert(capped.action === "scale_up", "efficient en tegen het budgetplafond: scale_up");
// Geen target: hold met unknown
const noTarget = budgetActionFor({ campaignId: "F", campaignName: "F", cost: 200, conversions: 10, budgetLostIs: 0.30 }, {});
assert(noTarget.action === "hold" && noTarget.efficiency === "unknown", "zonder target geen budgetbeslissing");

// ── Volledige analyse en het herallocatie-voorstel ──
const campaigns: CampaignBudgetInput[] = [
  { campaignId: "win_big", campaignName: "Winnaar groot", cost: 100, conversions: 10, budgetLostIs: 0.40, rankLostIs: 0.05 }, // CPA 10, veel ruimte
  { campaignId: "win_small", campaignName: "Winnaar klein", cost: 180, conversions: 10, budgetLostIs: 0.15, rankLostIs: 0.05 }, // CPA 18, wat ruimte
  { campaignId: "loser", campaignName: "Verliezer", cost: 500, conversions: 10, budgetLostIs: 0.10, rankLostIs: 0.05 }, // CPA 50, mist target
  { campaignId: "rank_stuck", campaignName: "Rang vast", cost: 200, conversions: 10, budgetLostIs: 0.05, rankLostIs: 0.35 }, // efficient maar rang-beperkt
];
const result = analyzeBudgetAllocation(campaigns, cpaT);
assert(result.scaleUp.length === 2, "twee scale_up-kandidaten");
assert(result.scaleUp[0].campaignId === "win_big", "de winnaar met de meeste ruimte staat bovenaan voor de volgende euro");
assert(result.scaleDown.length === 1 && result.scaleDown[0].campaignId === "loser", "de verliezer is de bron om budget uit weg te halen");
assert(result.summary.scaleUp === 2 && result.summary.scaleDown === 1 && result.summary.hold === 1, "summary verdeelt de acties correct");
assert(result.summary.hasTarget === true, "summary ziet dat er een target is");

// Lege invoer degradeert netjes
assert(analyzeBudgetAllocation([], cpaT).campaigns.length === 0, "lege invoer geeft geen campagnes");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

// ── Promptbouwer ──
import { buildBudgetAllocationPrompt } from "@/lib/prompts/budget-allocation-prompt";
{
  const r = analyzeBudgetAllocation(campaigns, cpaT);
  const prompt = buildBudgetAllocationPrompt({ summary: r.summary, scaleUp: r.scaleUp, scaleDown: r.scaleDown, target: cpaT, goalsSection: "CPA target 25" });
  let p2 = 0, f2 = 0;
  const a2 = (c: boolean, l: string) => { if (c) p2++; else { f2++; console.error(`  FAIL: ${l}`); } };
  a2(prompt.includes("Winnaar groot") && prompt.includes("Meer budget"), "prompt bevat de scale_up-kandidaten");
  a2(prompt.includes("Verliezer") && prompt.includes("Minder budget"), "prompt bevat de scale_down-bron");
  a2(prompt.includes("CPA-target 25"), "prompt noemt het target");
  a2(prompt.includes("UITSLUITEND naar campagnes met bewezen efficientie"), "prompt draagt de herallocatie-no-go");
  a2(!/\u2014/.test(prompt), "geen em-dash in de prompt");
  console.log(`\n=== Prompt: ${p2} passed, ${f2} failed ===\n`);
  if (f2 > 0) process.exit(1);
}
