// Zelf-draaiende test voor de losse-analyses -> hypothese-mappers (SI7). Draait via tsx.
// Kern per analyse: geen actiepunten => leeg voorstel (verversen), wél actiepunten => precies
// één voorstel met de juiste bron, ICE-totaal uit (I+C+E)/3, en de kern in de rationale.

import {
  budgetAllocationToHypotheses,
  bidStrategyToHypotheses,
  impressionShareToHypotheses,
  rsaInsightsToHypotheses,
  landingAuditToHypotheses,
  qualityScoreToHypotheses,
  type LandingAuditItem,
} from "./standalone-to-hypotheses";
import type { BudgetFact } from "./budget-allocation-facts";
import type { BidFact } from "./bid-strategy-facts";
import type { CampaignISFact } from "./impression-share-facts";
import type { RsaInsightsFacts } from "./rsa-insights-facts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const opts = { clientId: "c1", analysisId: null };
const bfact = (name: string): BudgetFact => ({
  campaignId: name, campaignName: name, efficiency: "beating", hasHeadroom: true, rankLimited: false, action: "scale_up",
  cpa: 10, roas: 5, cost: 100, budgetLostIs: 0.2, rankLostIs: 0.1, marginalScore: 1, reason: "",
});

console.log("budgetallocatie:");
{
  const rows = budgetAllocationToHypotheses(
    { summary: { campaignsAnalysed: 5, scaleUp: 2, scaleDown: 1, hold: 2, hasTarget: true }, scaleUp: [bfact("A"), bfact("B")], scaleDown: [bfact("C")] },
    opts
  );
  assert(rows.length === 1, "één voorstel bij op/af-schaal");
  assert(rows[0].source === "budget_allocation", "bron budget_allocation");
  assert(rows[0].ice_confidence === 8, "vertrouwen 8 mét doel");
  assert(rows[0].ice_total === Math.round(((rows[0].ice_impact + 8 + 6) / 3) * 10) / 10, "ICE-totaal afgeleid");
  assert(/opschalen \(2\)/.test(rows[0].rationale) && /afschalen \(1\)/.test(rows[0].rationale), "rationale bevat op/af-aantallen");

  const none = budgetAllocationToHypotheses({ summary: { campaignsAnalysed: 3, scaleUp: 0, scaleDown: 0, hold: 3, hasTarget: false }, scaleUp: [], scaleDown: [] }, opts);
  assert(none.length === 0, "geen actie => leeg");
  const noTarget = budgetAllocationToHypotheses({ summary: { campaignsAnalysed: 2, scaleUp: 1, scaleDown: 0, hold: 1, hasTarget: false }, scaleUp: [bfact("A")], scaleDown: [] }, opts);
  assert(noTarget[0].ice_confidence === 5, "vertrouwen 5 zónder doel");
}

console.log("biedstrategie:");
{
  const mk = (name: string, fit: BidFact["fit"]): BidFact => ({ campaignId: name, campaignName: name, strategy: "manual", kind: "manual", conversions: 30, hasValue: false, fit, recommendation: "" });
  const rows = bidStrategyToHypotheses(
    { summary: { campaignsAnalysed: 3, fit: 1, mismatches: 2, byFit: { fit: 1, upgrade_to_smart: 1, switch_to_value: 1, insufficient_volume: 0, value_missing: 0, review_non_conversion: 0, unknown: 0 } },
      campaigns: [mk("A", "fit"), mk("B", "upgrade_to_smart"), mk("C", "switch_to_value")] },
    opts
  );
  assert(rows.length === 1 && rows[0].source === "bid_strategy", "één voorstel, bron bid_strategy");
  assert(/2 campagne/.test(rows[0].hypothesis), "benoemt 2 mismatches");
  assert(!/1× fit/.test(rows[0].rationale), "fit-campagnes tellen niet als mismatch in de rationale");

  const allFit = bidStrategyToHypotheses({ summary: { campaignsAnalysed: 1, fit: 1, mismatches: 0, byFit: { fit: 1, upgrade_to_smart: 0, switch_to_value: 0, insufficient_volume: 0, value_missing: 0, review_non_conversion: 0, unknown: 0 } }, campaigns: [mk("A", "fit")] }, opts);
  assert(allFit.length === 0, "alles fit => leeg");
}

console.log("impression share:");
{
  const mk = (name: string, lost: number): CampaignISFact => ({ campaignId: name, campaignName: name, campaignType: null, impressionShare: 0.5, budgetLostIs: lost, rankLostIs: 0, totalLostIs: lost, lossDriver: "budget", actionCandidate: "raise_budget", conversions: 5, cost: 100, cpa: 20, impressionShareMoM: null } as unknown as CampaignISFact);
  const rows = impressionShareToHypotheses(
    { summary: { campaignsAnalysed: 3, budgetDriven: 2, rankDriven: 1, mixed: 0, healthy: 0, raiseBudgetCandidates: 2, bidOrQualityCandidates: 1 }, campaigns: [mk("A", 0.3), mk("B", 0.2)] },
    opts
  );
  assert(rows.length === 1 && rows[0].source === "impression_share", "één voorstel, bron impression_share");
  assert(rows[0].ice_confidence === 8, "vertrouwen 8 (harde IS-meting)");
  assert(/3 campagne/.test(rows[0].hypothesis), "totaal 3 kandidaten");

  const none = impressionShareToHypotheses({ summary: { campaignsAnalysed: 1, budgetDriven: 0, rankDriven: 0, mixed: 0, healthy: 1, raiseBudgetCandidates: 0, bidOrQualityCandidates: 0 }, campaigns: [] }, opts);
  assert(none.length === 0, "geen kandidaten => leeg");
}

console.log("RSA-copy:");
{
  const facts: RsaInsightsFacts = {
    analysisMonth: "2026-06", adCount: 4, assetRowCount: 20, trekkers: [], bleeders: [], pinDominance: [], lowVariantAds: [],
    actions: [
      { kind: "vervang_bleeder", fieldType: "HEADLINE", assetText: "x", adGroupName: "g", detail: "vervang zwakke kop" },
      { kind: "unpin_dominante_pin", fieldType: "HEADLINE", assetText: "y", adGroupName: "g", detail: "laat pin los" },
    ],
    attributionNote: "indicatief", summary: "samenvatting",
  };
  const rows = rsaInsightsToHypotheses(facts, opts);
  assert(rows.length === 1 && rows[0].source === "rsa_insights", "één voorstel, bron rsa_insights");
  assert(rows[0].ice_ease === 7, "ease 7 (copy is snel)");
  assert(/1× vervang_bleeder/.test(rows[0].rationale), "rationale telt actie-soorten");

  const none = rsaInsightsToHypotheses({ ...facts, actions: [] }, opts);
  assert(none.length === 0, "geen acties => leeg");
}

console.log("landing-audit:");
{
  const items: LandingAuditItem[] = [
    { url: "https://a", readable: true, priceMismatch: true, overallScore: 7, grootsteGap: null },
    { url: "https://b", readable: true, priceMismatch: false, overallScore: 3, grootsteGap: "USP ontbreekt" },
    { url: "https://c", readable: true, priceMismatch: false, overallScore: 9, grootsteGap: null },
  ];
  const rows = landingAuditToHypotheses(items, opts);
  assert(rows.length === 1 && rows[0].source === "landing_audit", "één voorstel, bron landing_audit");
  assert(rows[0].ice_impact === 8, "impact 8 bij prijsafwijking");
  assert(/prijsafwijking/.test(rows[0].hypothesis), "hypothese markeert de prijsafwijking");
  assert(/2 landingspagina/.test(rows[0].hypothesis), "2 betrokken pagina's (a prijs, b lage score; c niet)");

  const clean = landingAuditToHypotheses([{ url: "https://c", readable: true, priceMismatch: false, overallScore: 9, grootsteGap: null }], opts);
  assert(clean.length === 0, "alles goed => leeg");
}

console.log("quality score:");
{
  const rows = qualityScoreToHypotheses({
    flags: [{ kind: "dure_lage_qs", detail: "3 keywords met QS<=4 dragen 600 euro spend." }],
    priorityKeywords: [
      { keywordText: "kas kopen", campaignName: "GRT", adGroupName: null, matchType: "BROAD", cost: 400, clicks: 80, conversions: 0, qualityScore: 3, converting: false },
      { keywordText: "tuinbouw beurs", campaignName: "GRT", adGroupName: null, matchType: "EXACT", cost: 300, clicks: 60, conversions: 5, qualityScore: 4, converting: true },
    ],
  }, opts);
  assert(rows.length === 1 && rows[0].source === "quality_score", "één voorstel, bron quality_score");
  assert(/€400/.test(rows[0].rationale), "waste telt alleen niet-converterende keywords (400, niet 700)");
  assert(rows[0].ice_impact === 4, "impact 4 onder de waste-drempel");
  assert(rows[0].ice_ease === 4, "ease 4 (QS is copy/landing-werk)");
  assert(qualityScoreToHypotheses({ flags: [], priorityKeywords: [] }, opts).length === 0, "geen flags => leeg");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle standalone-to-hypotheses-tests geslaagd");
