// Test voor X4 lens 2 (funnelrol en overlap). Deterministisch, geen IO.
// Draaien: npx tsx lib/cross-channel/__funnel_overlap_test.ts

import { classifyFunnelRole, analyzeFunnelOverlap, type CampaignFunnelInput } from "./funnel-overlap";
import { ATTRIBUTION_FOOTNOTE } from "./lens-facts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function camp(o: Partial<CampaignFunnelInput> & { channel: CampaignFunnelInput["channel"]; campaignId: string }): CampaignFunnelInput {
  return { campaignName: o.campaignId, ...o };
}

// ── Rolclassificatie per signaal ──
assert(classifyFunnelRole(camp({ channel: "google_ads", campaignId: "b", isBranded: true, campaignType: "SEARCH" })).role === "branded_capture", "de branded-vlag wint van het campagnetype");
assert(classifyFunnelRole(camp({ channel: "meta_ads", campaignId: "r", audienceKind: "custom_warm" })).role === "retargeting", "een warme doelgroep is retargeting");
assert(classifyFunnelRole(camp({ channel: "meta_ads", campaignId: "p1", audienceKind: "broad" })).role === "prospecting", "een brede doelgroep is prospecting");
assert(classifyFunnelRole(camp({ channel: "meta_ads", campaignId: "p2", audienceKind: "lookalike" })).role === "prospecting", "een lookalike is prospecting");
assert(classifyFunnelRole(camp({ channel: "google_ads", campaignId: "d", campaignType: "DEMAND_GEN" })).role === "prospecting", "DEMAND_GEN is vraag-genererend");
assert(classifyFunnelRole(camp({ channel: "google_ads", campaignId: "s", campaignType: "SEARCH" })).role === "prospecting", "SEARCH zonder branded-vlag vangt actieve vraag");
const onbekend = classifyFunnelRole(camp({ channel: "linkedin_ads", campaignId: "x", objective: "IETS_NIEUWS" }));
assert(onbekend.role === "onbekend" && onbekend.basis.includes("geen herkend"), "een niet-herkende waarde degradeert naar onbekend met uitleg");

// ── Dubbele warme pool: twee kanalen retargeten ──
const dubbel = analyzeFunnelOverlap([
  camp({ channel: "meta_ads", campaignId: "m-rt", audienceKind: "custom_warm" }),
  camp({ channel: "linkedin_ads", campaignId: "li-rt", audienceKind: "custom_warm" }),
  camp({ channel: "google_ads", campaignId: "g-p", campaignType: "SEARCH" }),
]);
const poolFlag = dubbel.flags.find((f) => f.kind === "dubbele_warme_pool");
assert(poolFlag != null, "twee kanalen op de warme pool geeft de dubbel-betaal-flag");
assert(poolFlag!.campaigns.length === 2 && poolFlag!.campaigns.every((c) => c.role === "retargeting"), "de flag draagt de onderliggende campagnelijst (no-go: geen advies zonder lijst)");
assert(poolFlag!.detail.includes("meta_ads") && poolFlag!.detail.includes("linkedin_ads"), "de detail benoemt de betrokken kanalen");
assert(dubbel.attributionFootnote === ATTRIBUTION_FOOTNOTE, "de uitkomst draagt de attributie-voetnoot");

// Een kanaal dat retarget is GEEN dubbele pool
const enkel = analyzeFunnelOverlap([
  camp({ channel: "meta_ads", campaignId: "m-rt", audienceKind: "custom_warm" }),
  camp({ channel: "google_ads", campaignId: "g-p", campaignType: "SEARCH" }),
]);
assert(!enkel.flags.some((f) => f.kind === "dubbele_warme_pool"), "retargeting vanuit een kanaal is geen dubbel-betaal-risico");

// ── Geen prospecting: groeiplafond ──
const plafond = analyzeFunnelOverlap([
  camp({ channel: "meta_ads", campaignId: "m-rt", audienceKind: "custom_warm" }),
  camp({ channel: "google_ads", campaignId: "g-b", isBranded: true, campaignType: "SEARCH" }),
]);
const plafondFlag = plafond.flags.find((f) => f.kind === "geen_prospecting");
assert(plafondFlag != null && plafondFlag.detail.includes("groeiplafond"), "alleen warme en merkvraag geeft de groeiplafond-flag");
assert(plafondFlag!.campaigns.length === 2, "de plafond-flag draagt de geclassificeerde campagnes");

// Met prospecting erbij verdwijnt de plafond-flag
const gezond = analyzeFunnelOverlap([
  camp({ channel: "meta_ads", campaignId: "m-p", audienceKind: "broad" }),
  camp({ channel: "meta_ads", campaignId: "m-rt", audienceKind: "custom_warm" }),
  camp({ channel: "google_ads", campaignId: "g-b", isBranded: true, campaignType: "SEARCH" }),
]);
assert(!gezond.flags.some((f) => f.kind === "geen_prospecting"), "met prospecting is er geen plafond-flag");
assert(gezond.byRole.prospecting === 1 && gezond.byRole.retargeting === 1 && gezond.byRole.branded_capture === 1, "de rolverdeling telt correct");

// ── Onbekend wordt eerlijk geteld en telt niet mee als bewijs ──
const veelOnbekend = analyzeFunnelOverlap([
  camp({ channel: "linkedin_ads", campaignId: "x1" }),
  camp({ channel: "linkedin_ads", campaignId: "x2" }),
]);
assert(veelOnbekend.unknownCount === 2, "onbekende campagnes worden geteld");
assert(veelOnbekend.flags.length === 0, "alleen onbekenden geven geen flags (geen plafond-oordeel zonder geclassificeerd bewijs)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
