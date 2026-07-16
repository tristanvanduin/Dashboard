// Test voor de zoekterm-aggregatie. Deterministisch, geen IO.
// Draaien: npx tsx lib/api/__search_term_aggregate_test.ts

import { aggregateSearchTermsByMonth } from "./google-ads-search-term-aggregate";
import type { SearchTermMonthlyRow } from "./google-ads";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function row(o: Partial<SearchTermMonthlyRow> = {}): SearchTermMonthlyRow {
  return {
    date: "2026-06",
    campaignId: "c1",
    campaignName: "Search NL",
    adGroupId: "ag1",
    adGroupName: "Adgroep A",
    searchTerm: "rode schoenen",
    matchType: "BROAD",
    impressions: 100,
    clicks: 10,
    cost: 20,
    conversions: 1,
    conversionsValue: 50,
    ...o,
  };
}

// ── DE BUG DIE DIT DICHT ──
// Dezelfde term, dezelfde maand, twee match-types: de API geeft twee rijen. De dedup in de
// orchestrator kent match_type niet en doet last-wins, dus zonder deze aggregatie zou een
// van de twee rijen verdwijnen MET zijn metrics.
const gesplitst = [
  row({ matchType: "BROAD", impressions: 800, clicks: 40, cost: 80, conversions: 4, conversionsValue: 200 }),
  row({ matchType: "PHRASE", impressions: 200, clicks: 10, cost: 20, conversions: 1, conversionsValue: 50 }),
];
const samen = aggregateSearchTermsByMonth(gesplitst);
assert(samen.length === 1, "twee match-type-rijen van dezelfde term in dezelfde maand worden EEN rij");
assert(samen[0].impressions === 1000 && samen[0].clicks === 50 && samen[0].cost === 100, "de impressies, klikken en kosten tellen op: precies wat er nu verloren ging");
assert(samen[0].conversions === 5 && samen[0].conversionsValue === 250, "de conversies en de waarde ook");
assert(samen[0].matchType === "BROAD", "het dominante match-type op impressies wint");

// De omkering: dominantie volgt de impressies, niet de volgorde van de rijen.
const omgekeerd = aggregateSearchTermsByMonth([
  row({ matchType: "BROAD", impressions: 100 }),
  row({ matchType: "EXACT", impressions: 900 }),
]);
assert(omgekeerd[0].matchType === "EXACT" && omgekeerd[0].impressions === 1000, "de laatste rij bepaalt niets: EXACT wint op volume");

// ── De tiebreak is deterministisch ──
const gelijk = aggregateSearchTermsByMonth([row({ matchType: "PHRASE", impressions: 500 }), row({ matchType: "BROAD", impressions: 500 })]);
const gelijkAndersom = aggregateSearchTermsByMonth([row({ matchType: "BROAD", impressions: 500 }), row({ matchType: "PHRASE", impressions: 500 })]);
assert(gelijk[0].matchType === "BROAD" && gelijkAndersom[0].matchType === "BROAD", "bij een gelijkstand wint de alfabetisch eerste, in beide volgordes: dezelfde input geeft altijd dezelfde output");

// ── Wat NIET samengevoegd mag worden ──
assert(aggregateSearchTermsByMonth([row({ date: "2026-06" }), row({ date: "2026-05" })]).length === 2, "een andere maand is een andere rij");
assert(aggregateSearchTermsByMonth([row({ campaignId: "c1" }), row({ campaignId: "c2" })]).length === 2, "een andere campagne is een andere rij");
assert(aggregateSearchTermsByMonth([row({ adGroupId: "ag1" }), row({ adGroupId: "ag2" })]).length === 2, "een andere adgroep is een andere rij");
assert(aggregateSearchTermsByMonth([row({ searchTerm: "rode schoenen" }), row({ searchTerm: "blauwe schoenen" })]).length === 2, "een andere zoekterm is een andere rij");

// ── De degradaties ──
assert(aggregateSearchTermsByMonth([]).length === 0, "lege input geeft lege output");
const zonderType = aggregateSearchTermsByMonth([row({ matchType: "" }), row({ matchType: "" })]);
assert(zonderType.length === 1 && zonderType[0].matchType === "" && zonderType[0].impressions === 200, "zonder match-type blijft het veld leeg maar tellen de metrics gewoon op");
const deels = aggregateSearchTermsByMonth([row({ matchType: "" , impressions: 900 }), row({ matchType: "BROAD", impressions: 100 })]);
assert(deels[0].matchType === "BROAD", "een leeg match-type telt niet mee als kandidaat: het bekende type wint, ook met minder volume");

// ── De vorm blijft intact ──
assert(samen[0].campaignName === "Search NL" && samen[0].adGroupName === "Adgroep A" && samen[0].date === "2026-06", "de identificerende velden blijven staan, dus de tabelvorm en de sleutel veranderen niet");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
