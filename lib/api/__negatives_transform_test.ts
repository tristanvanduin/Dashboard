// Test voor de negatives-transform. Deterministisch, geen IO.
// Draaien: npx tsx lib/api/__negatives_transform_test.ts

import { negativeToDbRow, negativesToDbRows } from "./google-ads-negatives-transform";
import type { NegativeKeywordRow } from "./google-ads";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const NU = "2026-07-15T10:00:00.000Z";
function neg(o: Partial<NegativeKeywordRow> = {}): NegativeKeywordRow {
  return { level: "campaign", campaignName: "Search NL", adGroupName: "", listName: "", keywordText: "gratis", matchType: "BROAD", ...o };
}

// ── De drie niveaus ──
const campagne = negativeToDbRow(neg(), "c1", NU)!;
assert(campagne.level === "campaign" && campagne.campaign_name === "Search NL", "een campagne-negative mapt met zijn campagne");
assert(campagne.ad_group_name === "" && campagne.list_name === "", "de niet-gebruikte niveaus worden LEGE STRINGS, niet null: de primaire sleutel kan geen expressies bevatten");

const adgroep = negativeToDbRow(neg({ level: "ad_group", adGroupName: "Adgroep A" }), "c1", NU)!;
assert(adgroep.level === "ad_group" && adgroep.ad_group_name === "Adgroep A", "een adgroep-negative mapt met zijn adgroep");

const lijst = negativeToDbRow(neg({ level: "shared_set", listName: "Merk-uitsluitingen" }), "c1", NU)!;
assert(lijst.level === "shared_set" && lijst.list_name === "Merk-uitsluitingen" && lijst.campaign_name === "Search NL", "een gedeelde lijst draagt de lijstnaam EN de campagne waaraan hij hangt: een conflict is altijd per campagne");

// ── Wat wegvalt ──
assert(negativeToDbRow(neg({ keywordText: "" }), "c1", NU) === null, "zonder zoekwoordtekst valt de rij af: die kan geen conflict vormen");
assert(negativeToDbRow(neg({ keywordText: "   " }), "c1", NU) === null, "witruimte is geen zoekwoord");

// ── De normalisatie ──
assert(negativeToDbRow(neg({ matchType: "broad" }), "c1", NU)!.match_type === "BROAD", "het match-type gaat naar hoofdletters, zodat de matcher niet op casing hoeft te letten");
assert(negativeToDbRow(neg({ matchType: "" }), "c1", NU)!.match_type === "UNKNOWN", "een leeg match-type wordt expliciet UNKNOWN in plaats van leeg");
assert(negativeToDbRow(neg({ keywordText: "  gratis  " }), "c1", NU)!.keyword_text === "gratis", "de zoekwoordtekst wordt getrimd");

// ── De dedup ──
const dubbel = negativesToDbRows([neg(), neg()], "c1", NU);
assert(dubbel.length === 1, "dezelfde negative uit twee bronnen dedupliceert: zonder dat botst de upsert op zichzelf");
const zelfdeTekstAndereBron = negativesToDbRows([
  neg({ level: "campaign" }),
  neg({ level: "shared_set", listName: "Lijst" }),
], "c1", NU);
assert(zelfdeTekstAndereBron.length === 2, "dezelfde tekst op een ANDER niveau blijft een eigen rij: dat zijn echt twee uitsluitingen");
const zelfdeTekstAnderMatchType = negativesToDbRows([neg({ matchType: "BROAD" }), neg({ matchType: "EXACT" })], "c1", NU);
assert(zelfdeTekstAnderMatchType.length === 2, "hetzelfde woord met een ander match-type blokkeert iets anders en blijft dus apart");

// ── De degradaties ──
assert(negativesToDbRows([], "c1", NU).length === 0, "lege input geeft lege output");
assert(negativesToDbRows([neg({ keywordText: "" }), neg()], "c1", NU).length === 1, "een onbruikbare rij tussen goede rijen valt alleen zelf af");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
