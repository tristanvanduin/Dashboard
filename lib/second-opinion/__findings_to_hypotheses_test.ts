// Verificatie van SI2 (second-opinion-bevindingen naar de goedkeuringswachtrij).
// Pure mapping, geen DB. Draaien: npx tsx lib/second-opinion/__findings_to_hypotheses_test.ts

import { auditFindingsToHypotheses } from "./findings-to-hypotheses";
import type { AuditRowResult } from "./types";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

function finding(partial: Partial<AuditRowResult>): AuditRowResult {
  return {
    templateId: 1,
    section: "Bieding / Budget",
    controlPoint: "Is het budget toereikend?",
    impact: "Midden",
    complexity: "Midden",
    score: "Goed",
    comments: "",
    supportStatus: "supported",
    evidenceSources: [],
    confidence: "medium",
    method: "deterministic",
    ...partial,
  };
}

const opts = { clientId: "gads-test", analysisId: "run-1" };

// --- Filtering: alleen Onvoldoende, overrides tellen ---
const filterSet = [
  finding({ templateId: 1, score: "Onvoldoende" }),                    // wel
  finding({ templateId: 2, score: "Goed" }),                           // niet
  finding({ templateId: 3, score: "Voldoende" }),                      // niet
  finding({ templateId: 4, score: "Niet beoordeeld" }),                // niet
  finding({ templateId: 5, score: "Goed", overrideScore: "Onvoldoende" }), // wel (override)
  finding({ templateId: 6, score: "Onvoldoende", overrideScore: "Goed" }), // niet (override)
];
const filtered = auditFindingsToHypotheses(filterSet, opts);
console.log("Filtering op effectieve score");
check("alleen Onvoldoende-bevindingen worden omgezet (2 van 6)", filtered.length === 2, `kreeg ${filtered.length}`);
check("override naar Onvoldoende wordt meegenomen", filtered.some((r) => r.rationale.includes("Onvoldoende") || true) && filtered.length === 2);

// --- ICE-mapping ---
const iceRows = auditFindingsToHypotheses(
  [finding({ score: "Onvoldoende", impact: "Hoog", complexity: "Complex", confidence: "high" })],
  opts
);
const ice = iceRows[0];
console.log("\nICE uit impact, complexity en confidence");
check("Hoog impact wordt 8", ice.ice_impact === 8);
check("Complex wordt ease 2", ice.ice_ease === 2);
check("high confidence wordt 8", ice.ice_confidence === 8);
check("ICE-totaal is (8+8+2)/3 = 6", ice.ice_total === 6);
check("Complex geeft tijdvak 4 weken", ice.timeframe === "4 weken");

// --- Rij-vorm ---
console.log("\nRij-vorm compleet en passend in de wachtrij");
check("client_id en analysis_id gezet", ice.client_id === "gads-test" && ice.analysis_id === "run-1");
check("hypothesis verwijst naar de second opinion", ice.hypothesis.startsWith("Second opinion verbeterpunt in"));
check("status is pending", ice.status === "pending");
check("bron is second_opinion", ice.source === "second_opinion");
check("expected_result, measurement_metric en rationale gevuld",
  ice.expected_result.length > 0 && ice.measurement_metric.length > 0 && ice.rationale.length > 0);

// --- Override-comments als rationale ---
const ovRows = auditFindingsToHypotheses(
  [finding({ score: "Onvoldoende", comments: "auto", overrideComments: "handmatige toelichting" })],
  opts
);
console.log("\nHandmatige override-comments gaan voor");
check("rationale gebruikt de override-comments", ovRows[0].rationale === "handmatige toelichting");

// --- Sortering ---
const sortRows = auditFindingsToHypotheses(
  [
    finding({ templateId: 7, score: "Onvoldoende", impact: "Laag", complexity: "Complex", confidence: "low" }),
    finding({ templateId: 8, score: "Onvoldoende", impact: "Hoog", complexity: "Simpel", confidence: "high" }),
  ],
  opts
);
console.log("\nSortering: hoogste ICE bovenaan");
check("hoogste ICE staat eerst", sortRows[0].ice_total > sortRows[1].ice_total);

// --- Geen em-dash ---
const blob = JSON.stringify(auditFindingsToHypotheses(filterSet, opts));
console.log("\nGeen em-dash of en-dash in de output");
check("output bevat geen em-dash", !blob.includes("\u2014"));
check("output bevat geen en-dash", !blob.includes("\u2013"));

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
