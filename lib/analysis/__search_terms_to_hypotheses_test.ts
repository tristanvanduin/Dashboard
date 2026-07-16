// Verificatie van SI1 (zoekterm-analyse naar de goedkeuringswachtrij).
// Pure mapping, geen DB. Draaien: npx tsx lib/analysis/__search_terms_to_hypotheses_test.ts

import { searchTermVerdictsToHypotheses, type SearchTermVerdictInput } from "./search-terms-to-hypotheses";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

function verdict(p: Partial<SearchTermVerdictInput>): SearchTermVerdictInput {
  return { searchTerm: "term", recommendedAction: "monitor", cost: 0, conversions: 0, ...p };
}

const opts = { clientId: "gads-test", analysisId: null };

// --- Geen negatives -> geen voorstel ---
const none = searchTermVerdictsToHypotheses(
  [verdict({ recommendedAction: "monitor" }), verdict({ recommendedAction: "investigate" })],
  opts
);
console.log("Geen geadviseerde negatives");
check("geen negatives geeft een lege lijst", none.length === 0);

// --- Aggregatie en filtering ---
const mixed = searchTermVerdictsToHypotheses(
  [
    verdict({ searchTerm: "a", recommendedAction: "negative_exact", cost: 60 }),
    verdict({ searchTerm: "b", recommendedAction: "negative_phrase", cost: 60 }),
    verdict({ recommendedAction: "monitor", cost: 200 }),
    verdict({ recommendedAction: "investigate", cost: 200 }),
  ],
  opts
);
console.log("\nAggregatie tot een voorstel, alleen negatives geteld");
check("een aggregaat-voorstel, niet per term", mixed.length === 1);
check("alleen de 2 negatives geteld in de hypothesis", mixed[0].hypothesis.includes("2"));
check("rationale toont de exact/phrase-verdeling", mixed[0].rationale.includes("1 exact, 1 phrase"));

// --- Spend-geschaalde impact ---
console.log("\nImpact schaalt met verspilde spend");
const high = searchTermVerdictsToHypotheses([verdict({ recommendedAction: "negative_exact", cost: 120 })], opts);
const mid = searchTermVerdictsToHypotheses([verdict({ recommendedAction: "negative_exact", cost: 30 })], opts);
const low = searchTermVerdictsToHypotheses([verdict({ recommendedAction: "negative_exact", cost: 10 })], opts);
check("hoge spend (>=100) geeft impact 8", high[0].ice_impact === 8);
check("midden spend (25-100) geeft impact 5", mid[0].ice_impact === 5);
check("lage spend (<25) geeft impact 2", low[0].ice_impact === 2);
check("ICE-totaal hoog is (8+8+8)/3 = 8", high[0].ice_total === 8);

// --- Rij-vorm ---
const row = mixed[0];
console.log("\nRij-vorm passend in de wachtrij");
check("status is pending", row.status === "pending");
check("bron is search_terms", row.source === "search_terms");
check("analysis_id is null (geen uuid-run)", row.analysis_id === null);
check("confidence 8 en ease 8", row.ice_confidence === 8 && row.ice_ease === 8);
check("expected_result en measurement_metric gevuld", row.expected_result.length > 0 && row.measurement_metric.length > 0);

// --- Voorbeelden gesorteerd op kosten ---
const sorted = searchTermVerdictsToHypotheses(
  [
    verdict({ searchTerm: "goedkoop", recommendedAction: "negative_exact", cost: 5 }),
    verdict({ searchTerm: "duur", recommendedAction: "negative_exact", cost: 100 }),
    verdict({ searchTerm: "midden", recommendedAction: "negative_exact", cost: 50 }),
  ],
  opts
);
console.log("\nVoorbeelden: duurste term eerst");
check("duurste term staat vooraan in de voorbeelden", sorted[0].rationale.indexOf("duur") < sorted[0].rationale.indexOf("goedkoop"));

// --- Geen em-dash ---
console.log("\nGeen em-dash of en-dash in de output");
const blob = JSON.stringify(mixed);
check("output bevat geen em-dash", !blob.includes("\u2014"));
check("output bevat geen en-dash", !blob.includes("\u2013"));

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
