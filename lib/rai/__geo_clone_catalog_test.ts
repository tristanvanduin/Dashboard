// Test voor de RAI geo-clone-catalogus en het filter. Deterministisch, geen IO.
// Draaien: npx tsx lib/rai/__geo_clone_catalog_test.ts

import { RAI_GEO_CLONES, abbreviationInName, matchGeoCloneByCampaignName, visibleGeoClones, assignCampaigns } from "./geo-clone-catalog";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Afkorting als afgebakende token ──
assert(abbreviationInName("AQM", "AQM | Search | Registraties | NL"), "AQM matcht aan het begin met scheidingsteken");
assert(abbreviationInName("ICC", "Display_ICC_Exposanten"), "ICC matcht tussen underscores");
assert(abbreviationInName("AQM", "campagne aqm brand"), "case-ongevoelig en tussen spaties");
assert(!abbreviationInName("AQM", "AQMX Search"), "AQM matcht NIET binnen AQMX");
assert(!abbreviationInName("AQM", "XAQM Search"), "AQM matcht NIET binnen XAQM");
assert(!abbreviationInName("AQM", "Aquatech Amsterdam Search"), "AQM matcht niet in een naam zonder de afkorting");
assert(abbreviationInName("AQM", "Search-AQM"), "AQM matcht aan het einde na een streepje");

// ── Bevestigde afkortingen koppelen aan de juiste variant ──
const aqm = matchGeoCloneByCampaignName("AQM | Search | Registraties");
assert(aqm?.brand === "Aquatech" && aqm.location === "Mexico" && aqm.confirmed, "AQM koppelt aan Aquatech Mexico (bevestigd)");
const icc = matchGeoCloneByCampaignName("ICC_Display");
assert(icc?.brand === "Interclean" && icc.location === "China" && icc.confirmed, "ICC koppelt aan Interclean China (bevestigd)");

// ── GreenTech geo-clones (afkortingen bevestigd: GRT/GRA/GRN) ──
const gra = matchGeoCloneByCampaignName("GRA | Search");
assert(gra?.brand === "GreenTech" && gra.location === "Americas" && gra.confirmed, "GRA koppelt aan GreenTech Americas (bevestigd)");
const grt = matchGeoCloneByCampaignName("GRT | Search");
assert(grt?.location === "Amsterdam", "GRT koppelt aan GreenTech Amsterdam");
const grn = matchGeoCloneByCampaignName("GRN | Display");
assert(grn?.location === "North America", "GRN koppelt aan GreenTech North America");

// ── Onbekende campagne ──
assert(matchGeoCloneByCampaignName("Generic Brand Campaign") === null, "een campagne zonder bekende afkorting geeft null");

// ── Hide-if-absent: alleen varianten met een match tonen ──
const campagnes = [
  "AQM | Search | Registraties",
  "AQM | Display | Exposanten",
  "ICC | Search | Registraties",
];
const zichtbaar = visibleGeoClones(campagnes);
assert(zichtbaar.length === 2, "alleen twee varianten zijn zichtbaar (AQM en ICC), niet de hele catalogus");
assert(zichtbaar.some((v) => v.abbreviation === "AQM") && zichtbaar.some((v) => v.abbreviation === "ICC"), "de zichtbare varianten zijn precies AQM en ICC");
assert(!zichtbaar.some((v) => v.abbreviation === "ITA"), "een variant zonder campagne (Intertraffic Amsterdam) wordt niet getoond");

// ── Toewijzing, onbekend apart ──
const toewijzing = assignCampaigns(["AQM | Search", "Onbekende campagne", "ICC | Display"]);
assert(toewijzing[0].variant?.abbreviation === "AQM", "eerste campagne toegewezen aan AQM");
assert(toewijzing[1].variant === null, "de onbekende campagne blijft null, niet stil bij een variant");
assert(toewijzing[2].variant?.abbreviation === "ICC", "derde campagne toegewezen aan ICC");

// ── Catalogus-compleetheid ──
assert(RAI_GEO_CLONES.length >= 18, "de catalogus dekt alle bekende merken en geo-clones");
assert(RAI_GEO_CLONES.filter((v) => v.confirmed).length === 6, "zes afkortingen zijn bevestigd (AQM, ICC, ICA, GRT, GRA, GRN), de rest is te verifieren");
assert(new Set(RAI_GEO_CLONES.map((v) => v.abbreviation)).size === RAI_GEO_CLONES.length, "alle afkortingen zijn uniek, geen dubbele");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
