// Test voor de negative-conflictchecker. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__google_negative_conflicts_test.ts

import { detectNegativeConflicts, negativeBlocks, negativeApplies, findConflicts, tokenize, MAX_CONFLICT_STORIES, type PositiveKeyword, type NegativeKeyword } from "./google-negative-conflicts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function pos(o: Partial<PositiveKeyword> = {}): PositiveKeyword {
  return { campaignName: "Search NL", adGroupName: "Schoenen", keywordText: "goedkope schoenen", matchType: "EXACT", cost: 100, conversions: 5, ...o };
}
function neg(o: Partial<NegativeKeyword> = {}): NegativeKeyword {
  return { level: "campaign", campaignName: "Search NL", adGroupName: "", listName: "", keywordText: "goedkope", matchType: "BROAD", ...o };
}

// ── De tokenisatie ──
assert(tokenize("Goedkope Schoenen!").join(" ") === "goedkope schoenen", "leestekens weg, kleine letters, woordgrenzen blijven");
assert(tokenize("   ").length === 0, "witruimte levert geen woorden");

// ── BROAD: alle woorden, volgorde maakt niet uit ──
assert(negativeBlocks({ keywordText: "goedkope", matchType: "BROAD" }, "goedkope schoenen"), "broad blokkeert als het woord voorkomt");
assert(negativeBlocks({ keywordText: "schoenen goedkope", matchType: "BROAD" }, "goedkope schoenen"), "broad negeert de volgorde: alle woorden aanwezig is genoeg");
assert(!negativeBlocks({ keywordText: "goedkope laarzen", matchType: "BROAD" }, "goedkope schoenen"), "broad eist ALLE woorden: ontbreekt er een, dan blokkeert hij niet");

// ── GEEN close variants: de reden dat deze checker bestaat ──
assert(!negativeBlocks({ keywordText: "schoen", matchType: "BROAD" }, "goedkope schoenen"), "negatives matchen GEEN close variants: enkelvoud blokkeert het meervoud NIET");
assert(negativeBlocks({ keywordText: "schoenen", matchType: "BROAD" }, "goedkope schoenen"), "maar het exacte woord blokkeert wel");
assert(!negativeBlocks({ keywordText: "goedkoop", matchType: "BROAD" }, "goedkope schoenen"), "en een verbogen vorm evenmin: \"goedkoop\" blokkeert \"goedkope schoenen\" NIET. Precies deze val is waarom deze checker bestaat, en mijn eigen testfixture trapte er eerst in.");

// ── PHRASE: de groep op volgorde, tekst eromheen mag ──
assert(negativeBlocks({ keywordText: "goedkope schoenen", matchType: "PHRASE" }, "hele goedkope schoenen kopen"), "phrase staat tekst voor en na de groep toe");
assert(!negativeBlocks({ keywordText: "schoenen goedkope", matchType: "PHRASE" }, "goedkope schoenen"), "phrase eist de VOLGORDE: omgekeerd blokkeert niet");
assert(!negativeBlocks({ keywordText: "goedkope mooie schoenen", matchType: "PHRASE" }, "goedkope schoenen"), "phrase eist een aaneengesloten groep");

// ── EXACT: alleen letterlijk ──
assert(negativeBlocks({ keywordText: "goedkope schoenen", matchType: "EXACT" }, "goedkope schoenen"), "exact blokkeert de identieke term");
assert(!negativeBlocks({ keywordText: "goedkope", matchType: "EXACT" }, "goedkope schoenen"), "exact blokkeert geen langere term");
assert(!negativeBlocks({ keywordText: "goedkope schoenen kopen", matchType: "EXACT" }, "goedkope schoenen"), "en ook geen kortere");

// ── Onbekend match-type wordt niet gegokt ──
assert(!negativeBlocks({ keywordText: "goedkope", matchType: "UNKNOWN" }, "goedkope schoenen"), "een onbekend match-type levert GEEN conflict: vals alarm kost vertrouwen");
assert(!negativeBlocks({ keywordText: "", matchType: "BROAD" }, "goedkope schoenen"), "een lege negative blokkeert niets");

// ── Het bereik per niveau ──
assert(negativeApplies(neg({ level: "campaign" }), pos()), "een campagne-negative raakt elke adgroep in die campagne");
assert(negativeApplies(neg({ level: "shared_set", listName: "Merk" }), pos()), "een gedeelde lijst raakt de campagne waaraan hij hangt");
assert(negativeApplies(neg({ level: "ad_group", adGroupName: "Schoenen" }), pos()), "een adgroep-negative raakt zijn eigen adgroep");
assert(!negativeApplies(neg({ level: "ad_group", adGroupName: "Laarzen" }), pos()), "maar NIET een andere adgroep");
assert(!negativeApplies(neg({ campaignName: "Search BE" }), pos()), "en een negative uit een andere campagne raakt niets");

// ── De ernst-splitsing ──
const exactDood = findConflicts([pos({ matchType: "EXACT" })], [neg()]);
assert(exactDood.length === 1 && exactDood[0].volledigDood, "een EXACT-zoekwoord kan alleen op zijn eigen term draaien: geblokkeerd is volledig dood");
assert(findConflicts([pos({ matchType: "PHRASE" })], [neg()])[0].volledigDood, "phrase idem");
const broadGewond = findConflicts([pos({ matchType: "BROAD" })], [neg()]);
assert(broadGewond.length === 1 && !broadGewond[0].volledigDood, "een BROAD-zoekwoord kan nog op verwante zoekopdrachten draaien: gewond, niet dood");

// ── Geen dubbele meldingen ──
assert(findConflicts([pos()], [neg(), neg({ keywordText: "schoenen" })]).length === 1, "een zoekwoord is al dood bij de eerste blokkade: meer negatives melden voegt niets toe");

// ── Het verhaal ──
const gevonden = detectNegativeConflicts({ positives: [pos({ matchType: "EXACT", conversions: 12 })], negatives: [neg({ level: "shared_set", listName: "Merk-uitsluitingen" })] });
assert(gevonden.triggered.length === 1, "het conflict triggert");
const verhaal = gevonden.triggered[0];
assert(verhaal.story.includes('gedeelde lijst "Merk-uitsluitingen"'), "het verhaal wijst de BRON aan: bij een gedeelde lijst weet je anders niet waar je moet zijn");
assert(verhaal.story.includes("volledig stil"), "en benoemt dat een exact-zoekwoord volledig stilstaat");
assert(verhaal.story.includes("recent of gedeeltelijk"), "met conversies in de periode is de blokkade recent of gedeeltelijk: dat hoort erbij");
assert(verhaal.certainty === "bewezen_binnen_platform", "de zekerheid is bewezen: dit is een structuurfeit, geen interpretatie");
assert(verhaal.actionDirection.includes("weg") && verhaal.actionDirection.includes("phrase of exact"), "de actie biedt de uitweg: weghalen of aanscherpen tot een strakker match-type");
const zonderConversies = detectNegativeConflicts({ positives: [pos({ conversions: 0, cost: 0 })], negatives: [neg()] });
assert(zonderConversies.triggered[0].story.includes("al langer staat"), "zonder conversies past het bij een blokkade die al langer staat");

// ── De sortering en de begrenzing ──
const veel = detectNegativeConflicts({
  positives: [
    pos({ keywordText: "goedkope schoenen", conversions: 1 }),
    pos({ keywordText: "goedkope laarzen", conversions: 30 }),
    pos({ keywordText: "goedkope sandalen", conversions: 10 }),
    pos({ keywordText: "goedkope sokken", conversions: 5 }),
  ],
  negatives: [neg()],
});
assert(veel.triggered.length === MAX_CONFLICT_STORIES, "de sectie blijft leesbaar: maximaal drie conflicten");
assert(veel.triggered[0].scope.includes("laarzen"), "het zoekwoord met de meeste conversies staat vooraan: dat is stil weggevallen omzet");

// ── De degradaties ──
assert(detectNegativeConflicts({ positives: [], negatives: [neg()] }).triggered.length === 0, "zonder zoekwoorden geen conflict");
assert(detectNegativeConflicts({ positives: [pos()], negatives: [] }).triggered.length === 0, "zonder negatives geen conflict");
assert(detectNegativeConflicts({ positives: [], negatives: [] }).checked.length === 1, "en er wordt wel gemeld dat er gecontroleerd is");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
