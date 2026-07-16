// Test voor de E1-formatter buildClientMemoryGrounding. Deterministisch, geen IO.
// Draaien: npx tsx lib/memory/__client_memory_grounding_test.ts

import { buildClientMemoryGrounding } from "./client-memory";
import type { ClientMemory, MemoryReport, MemoryHypothesis } from "./client-memory";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function mem(reports: MemoryReport[], hypotheses: MemoryHypothesis[]): ClientMemory {
  return { clientId: "minismus", reports, hypotheses };
}
function rapport(month: number, year: number, status: string): MemoryReport {
  return { month, year, status, reportDate: `${year}-0${month}-01` };
}
function hypo(h: Partial<MemoryHypothesis>): MemoryHypothesis {
  return { hypothesis: "H", status: "pending", source: null, iceTotal: 0, outcome: null, resultMet: null, learning: null, createdAt: "2026-01-01", ...h };
}

// Lege memory: lege string, geen gedragswijziging voor nieuwe klanten
assert(buildClientMemoryGrounding(mem([], [])) === "", "lege memory geeft een lege string");

// Rapporten verschijnen, nieuwste caps op 3
const vijfRapporten = [rapport(6, 2026, "final"), rapport(5, 2026, "final"), rapport(4, 2026, "sent"), rapport(3, 2026, "final"), rapport(2, 2026, "draft")];
const gRapporten = buildClientMemoryGrounding(mem(vijfRapporten, []));
assert(gRapporten.includes("Recente rapporten:"), "de rapporten-sectie verschijnt");
assert(gRapporten.includes("6/2026 (final)"), "een rapport wordt met maand, jaar en status getoond");
assert((gRapporten.match(/- \d+\/\d+/g) || []).length === 3, "maximaal 3 rapporten (cap)");
assert(gRapporten.includes("Verzin geen geheugen"), "de anti-hallucinatie-slotzin staat erin");

// Hypotheses met uitkomst hebben voorrang boven recente zonder uitkomst
const metUitkomst = hypo({ hypothesis: "Verhoog budget kernwoorden", status: "completed", resultMet: true, learning: "CPA daalde 12 procent" });
const zonderUitkomst = hypo({ hypothesis: "Test nieuwe doelgroep", status: "pending" });
const gHyp = buildClientMemoryGrounding(mem([], [zonderUitkomst, metUitkomst]));
assert(gHyp.includes("Eerdere hypotheses en uitkomsten:"), "de hypotheses-sectie verschijnt");
assert(gHyp.includes("Verhoog budget kernwoorden") && gHyp.includes("doel gehaald"), "resultMet true geeft doel gehaald");
assert(gHyp.includes("Learning: CPA daalde 12 procent"), "de learning wordt toegevoegd");

// resultMet false geeft doel niet gehaald
const gefaald = buildClientMemoryGrounding(mem([], [hypo({ hypothesis: "X", status: "completed", resultMet: false })]));
assert(gefaald.includes("doel niet gehaald"), "resultMet false geeft doel niet gehaald");

// Zonder resultMet valt het terug op outcome of status
const opStatus = buildClientMemoryGrounding(mem([], [hypo({ hypothesis: "Y", status: "rejected", outcome: null })]));
assert(opStatus.includes("(uitkomst: rejected)"), "zonder resultMet en outcome valt het terug op de status");

// Cap van 8 hypotheses, met voorkeur voor die met uitkomst
const twaalfMetUitkomst = Array.from({ length: 12 }, (_v, i) => hypo({ hypothesis: `H${i}`, status: "completed", resultMet: i % 2 === 0 }));
const gCap = buildClientMemoryGrounding(mem([], twaalfMetUitkomst));
assert((gCap.match(/- \[completed\]/g) || []).length === 8, "maximaal 8 hypotheses (cap)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
