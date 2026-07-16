// Test voor de RSA-insights-kern en de W1 message-match-kern. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__rsa_w1_kern_test.ts

import { analyzeRsaInsights, RSA_ATTRIBUTION_NOTE, BLEEDER_MIN_IMPRESSIONS, MIN_HEADLINE_VARIANTS, type RsaAssetRow } from "./rsa-insights-facts";
import { extractAdClaims, checkClaimsOnPage, normalizePrice, headlineH1Overlap, buildMessageMatchFacts, MessageMatchSchema, buildMessageMatchPrompt, MESSAGE_MATCH_PROMPT_VERSION } from "./landing-message-match";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ════ RSA ════
function asset(o: Partial<RsaAssetRow> & { asset_id: string; asset_text: string }): RsaAssetRow {
  return {
    month: "2026-06",
    campaign_name: "Search NL",
    ad_group_name: "Adgroup A",
    ad_id: "ad-1",
    field_type: "HEADLINE",
    pinned_field: null,
    performance_label: "GOOD",
    impressions: 10000,
    clicks: 300,
    conversions: 5,
    cost: 200,
    ...o,
  };
}

// ── Aggregatie over ads en het dominante label ──
const basis = analyzeRsaInsights([
  asset({ asset_id: "h1", asset_text: "Zelfde Kop", ad_id: "ad-1", performance_label: "BEST", impressions: 8000 }),
  asset({ asset_id: "h1b", asset_text: "zelfde  kop", ad_id: "ad-2", performance_label: "LOW", impressions: 2000 }),
  asset({ asset_id: "h2", asset_text: "Andere kop", ad_id: "ad-1", performance_label: "LOW", impressions: 12000 }),
]);
assert(basis.attributionNote === RSA_ATTRIBUTION_NOTE && basis.attributionNote.includes("dubbel"), "de dubbeltelling-note reist verplicht mee naar de prompt");
const zelfde = [...basis.trekkers, ...basis.bleeders].find((i) => i.assetText === "Zelfde Kop")!;
assert(zelfde.adCount === 2 && zelfde.impressions === 10000, "dezelfde tekst aggregeert over ads (genormaliseerd op spaties en hoofdletters)");
assert(zelfde.dominantLabel === "BEST" && zelfde.labelShares.best === 80, "het dominante label is impressie-gewogen: 8000 BEST tegen 2000 LOW is 80 procent BEST");
assert(basis.bleeders.length === 1 && basis.bleeders[0].assetText === "Andere kop", "een LOW-dominant asset met volume is een bleeder");
assert(analyzeRsaInsights([asset({ asset_id: "h3", asset_text: "Klein", performance_label: "LOW", impressions: BLEEDER_MIN_IMPRESSIONS - 1 })]).bleeders.length === 0, "onder de volumedrempel geen bleeder-oordeel");

// ── Serving-aandeel binnen (ad, field_type) ──
const serving = analyzeRsaInsights([
  asset({ asset_id: "a", asset_text: "Dominant", impressions: 9000 }),
  asset({ asset_id: "b", asset_text: "Rest", impressions: 1000 }),
  asset({ asset_id: "d", asset_text: "Descriptie", field_type: "DESCRIPTION", impressions: 5000 }),
]);
const dominant = serving.trekkers.find((i) => i.assetText === "Dominant")!;
assert(dominant.servingSharePct === 90, "het serving-aandeel rekent binnen field_type en ad: 9000 van 10000 headline-vertoningen");

// ── Trekkers: BEST sorteert boven GOOD ──
const sortering = analyzeRsaInsights([
  asset({ asset_id: "g", asset_text: "Goede", performance_label: "GOOD", impressions: 50000 }),
  asset({ asset_id: "b2", asset_text: "Beste", performance_label: "BEST", impressions: 6000 }),
]);
assert(sortering.trekkers[0].assetText === "Beste", "BEST-dominant sorteert boven GOOD, ook met minder volume");

// ── Pin-dominantie en de unpin-actie alleen bij LOW ──
const pins = analyzeRsaInsights([
  asset({ asset_id: "p1", asset_text: "Gepind slecht", pinned_field: "HEADLINE_1", performance_label: "LOW", impressions: 7000 }),
  asset({ asset_id: "p2", asset_text: "Vrij", impressions: 3000 }),
  asset({ asset_id: "p3", asset_text: "Gepind goed", ad_id: "ad-2", pinned_field: "HEADLINE_1", performance_label: "BEST", impressions: 9000 }),
  asset({ asset_id: "p4", asset_text: "Vrij 2", ad_id: "ad-2", impressions: 1000 }),
]);
assert(pins.pinDominance.length === 2 && pins.pinDominance[0].servingSharePct === 70, "een gepind asset boven de dominantie-drempel wordt gemeld met het aandeel");
assert(pins.actions.filter((a) => a.kind === "unpin_dominante_pin").length === 1 && pins.actions.find((a) => a.kind === "unpin_dominante_pin")!.assetText === "Gepind slecht", "de unpin-actie komt alleen bij een dominante pin met het LOW-label");

// ── Variant-armoede en het indicatieve veld ──
assert(basis.lowVariantAds.length === 2 && basis.lowVariantAds[0].headlineCount < MIN_HEADLINE_VARIANTS, "ads met te weinig unieke headlines worden gemeld");
assert(basis.actions.some((a) => a.kind === "vul_varianten_aan"), "variant-armoede levert een aanvul-actie");
assert(zelfde.indicative.conversions === 10 && !("conversions" in zelfde), "conversies staan uitsluitend in het indicatieve veld");
assert(basis.summary.includes("2 RSA's") || basis.summary.includes("RSA"), "de samenvatting telt de RSA's");

// ════ W1 ════
// ── Prijs-normalisatie en claim-extractie ──
assert(normalizePrice("€14,95") === "14.95" && normalizePrice("£14.95") === "14.95", "prijzen normaliseren over valuta en komma-punt heen");
const claims = extractAdClaims(["Get yours for just £14.95", "Same day shipment", "Gratis verzending en 30 dagen retour", "Nu 20% korting", "Gratis case erbij"]);
assert(claims.some((c) => c.type === "prijs" && c.normalized === "14.95"), "de prijs-claim wordt herkend en genormaliseerd");
assert(claims.some((c) => c.type === "snelheid_levering") && claims.some((c) => c.type === "percentage" && c.normalized === "20%") && claims.some((c) => c.type === "garantie"), "snelheid, percentage en garantie worden als typen herkend");
assert(claims.filter((c) => c.type === "gratis" && c.normalized === "gratis").length === 1, "dezelfde claim dedupliceert over regels");

// ── Presence: letterlijk, deels, ontbreekt, prijs-mismatch ──
const pagina = "Welkom. Personaliseer je hoesje. same day shipment op alle bestellingen. Prijs: €19,95. Verzending is gratis vanaf 20 euro. Onze hoesjes zijn gemaakt van duurzaam materiaal en beschermen je telefoon optimaal tegen vallen en krassen. Kies je model en upload je eigen ontwerp in de editor.";
const checks = checkClaimsOnPage(claims, pagina);
assert(checks.find((c) => c.claim.type === "snelheid_levering" && c.claim.normalized === "same day")!.status === "gevonden_letterlijk", "een letterlijke belofte wordt gevonden met bewijs-fragment");
const prijsCheck = checks.find((c) => c.claim.type === "prijs")!;
assert(prijsCheck.status === "prijs_wijkt_af" && prijsCheck.evidence!.includes("14.95") && prijsCheck.evidence!.includes("19.95"), "een afwijkende prijs is een mismatch met beide bedragen als bewijs, niet een ontbreekt");
assert(checks.find((c) => c.claim.type === "percentage")!.status === "ontbreekt", "een korting die nergens terugkomt ontbreekt");

// ── Kop-overlap, coverage en de facts-bundel ──
const overlap = headlineH1Overlap(["Personaliseer je telefoonhoesje vandaag"], "Personaliseer je eigen telefoonhoesje");
assert(overlap.ratio >= 0.6 && overlap.bestHeadline !== null, "de kop-overlap meet de token-dekking van de beste headline");
const facts = buildMessageMatchFacts({ headlines: ["Same day shipment"], descriptions: ["Gratis verzending"], pageText: pagina, h1: "Personaliseer je hoesje" });
assert(facts.status === "leesbaar" && facts.coveragePct === 100 && facts.priceMismatch === false, "de facts bundelen coverage en de mismatch-vlag");

// ── Het degradatiepad ──
const dood = buildMessageMatchFacts({ headlines: ["x"], descriptions: [], pageText: "Access denied", h1: null });
assert(dood.status === "pagina_niet_leesbaar" && dood.reason.includes("bot-blokkade"), "een onleesbare pagina stopt de audit eerlijk voordat er een LLM aan te pas komt");

// ── Het contract: geen matched zonder pagina-citaat ──
const geldig = { overall_score: 6, oordeel_per_claim: [{ claim: "same day", oordeel: "matched", citaat_ad: "Same day shipment", citaat_pagina: "same day shipment op alle bestellingen" }], grootste_gap: "de korting ontbreekt", aanbeveling: "voeg de 20 procent op de pagina toe" };
assert(MessageMatchSchema.safeParse(geldig).success, "een volledig onderbouwd oordeel parseert");
assert(!MessageMatchSchema.safeParse({ ...geldig, oordeel_per_claim: [{ claim: "x", oordeel: "matched", citaat_ad: "a", citaat_pagina: "" }] }).success, "matched zonder pagina-citaat is ongeldig (X3-judge-principe)");
assert(MessageMatchSchema.safeParse({ ...geldig, oordeel_per_claim: [{ claim: "x", oordeel: "missing", citaat_ad: "a", citaat_pagina: "" }] }).success, "missing mag zonder pagina-citaat, er is immers niets te citeren");
const prompt = buildMessageMatchPrompt({ adCopy: "copy", pageExcerpt: "excerpt", facts: facts as Extract<typeof facts, { status: "leesbaar" }> });
assert(prompt.version === MESSAGE_MATCH_PROMPT_VERSION && prompt.system.includes("ENIGE bron") && prompt.system.includes("LETTERLIJK citaat"), "de prompt is versievast en eist citaten uit beide bronnen");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
