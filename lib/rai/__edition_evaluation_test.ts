// Test voor de RAI-editie-evaluatie. Deterministisch, geen IO.
// Draaien: npx tsx lib/rai/__edition_evaluation_test.ts

import { buildEditionEvaluation, renderEditionEvaluationSection } from "./edition-evaluation";
import type { RaiDataPoint, RaiEdition } from "./event-comparison";
import type { EventStreamTargetRow } from "./target-resolution";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const HUIDIG: RaiEdition = { editionId: "aqm-2026", fairId: "aqm", geoClone: "AQM", cadence: "annual", campaignStartDate: "2026-01-01", fairStartDate: "2026-06-01", fairEndDate: "2026-06-03" };
const VORIG: RaiEdition = { editionId: "aqm-2025", fairId: "aqm", geoClone: "AQM", cadence: "annual", campaignStartDate: "2025-01-01", fairStartDate: "2025-06-01", fairEndDate: "2025-06-03" };

// Dagelijkse punten: elke dag een vaste waarde, zodat de cumulatieven voorspelbaar zijn.
function reeks(editionId: string, van: string, dagen: number, waarde: number, stream: "registraties" | "exposanten"): RaiDataPoint[] {
  const out: RaiDataPoint[] = [];
  const start = new Date(van);
  for (let i = 0; i < dagen; i += 1) {
    out.push({
      date: new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10),
      value: waarde,
      geoClone: "AQM",
      stream,
      editionId,
    });
  }
  return out;
}

function target(o: Partial<EventStreamTargetRow> = {}): EventStreamTargetRow {
  return { geoCloneKey: "AQM", editionId: "aqm-2026", stream: "registraties", volumeTarget: 1000, cpaTarget: 10, budgetPlanned: 10000, confirmedByClient: true, ...o };
}

const punten = [
  ...reeks("aqm-2026", "2026-01-01", 100, 10, "registraties"), // 1000 tot en met 10 april
  ...reeks("aqm-2025", "2025-01-01", 150, 10, "registraties"),
];

// ── VOOR de beurs: alles is een projectie ──
const voor = buildEditionEvaluation({
  points: punten,
  editions: [HUIDIG, VORIG],
  targetRows: [target()],
  currentEditionId: "aqm-2026",
  geoClone: "AQM",
  asOfDate: "2026-04-10",
});
assert(!voor.afgelopen && voor.daysToFair !== null && voor.daysToFair > 0, "voor de beurs staat de teller op dagen-tot en is de editie niet afgelopen");
assert(voor.summary.includes("dagen tot de beurs"), "de samenvatting telt af naar de beurs in plaats van een maand te noemen");
const regVoor = voor.streams.find((s) => s.stream === "registraties")!;
assert(["op_koers", "voor", "achter", "niet_bepaalbaar"].includes(regVoor.verdict), "voor de beurs zijn de verdicten projectie-verdicten, nooit gehaald of gemist");
assert(regVoor.detail.includes("koerst op") || regVoor.verdict === "niet_bepaalbaar", "en de taal is voorwaardelijk");

const sectieVoor = renderEditionEvaluationSection(voor);
assert(sectieVoor.includes("PROJECTIE") && sectieVoor.includes("geen verwachting als uitkomst"), "de sectie instrueert het model expliciet om een projectie niet als uitkomst te presenteren");
assert(!sectieVoor.includes("UITKOMST"), "en spreekt voor de beurs niet van een uitkomst");

// ── NA de beurs: het is een feit ──
const na = buildEditionEvaluation({
  points: punten,
  editions: [HUIDIG, VORIG],
  targetRows: [target()],
  currentEditionId: "aqm-2026",
  geoClone: "AQM",
  asOfDate: "2026-06-10",
});
assert(na.afgelopen, "na de beursdatum is de editie afgelopen");
const regNa = na.streams.find((s) => s.stream === "registraties")!;
assert(["gehaald", "gemist", "niet_bepaalbaar", "geen_target"].includes(regNa.verdict), "na afloop zijn de verdicten uitkomst-verdicten, nooit op_koers");
assert(regNa.verdict !== "op_koers" && regNa.verdict !== "voor" && regNa.verdict !== "achter", "een afgelopen beurs koerst nergens meer op");
const sectieNa = renderEditionEvaluationSection(na);
assert(sectieNa.includes("UITKOMST") && sectieNa.includes("verleden tijd"), "de sectie instrueert het model om na afloop in de verleden tijd te schrijven");

// ── De beursdag zelf telt als afgerond ──
const opDeDag = buildEditionEvaluation({ points: punten, editions: [HUIDIG, VORIG], targetRows: [target()], currentEditionId: "aqm-2026", geoClone: "AQM", asOfDate: "2026-06-01" });
assert(opDeDag.afgelopen, "op de beursdag zelf valt er niets meer bij te sturen: dat telt als afgerond");

// ── De degradatie is PER STREAM ──
assert(voor.streams.length === 2, "beide streams worden altijd geevalueerd");
const expVoor = voor.streams.find((s) => s.stream === "exposanten")!;
assert(expVoor.verdict === "geen_target", "exposanten heeft geen target in deze fixture en krijgt dus geen oordeel");
assert(expVoor.detail.includes("geen oordeel") && expVoor.detail.includes("de stand is"), "maar de stand wordt wel benoemd: beschrijven mag, veroordelen niet");
assert(regVoor.verdict !== "geen_target", "en registraties wordt daar NIET door geraakt: de degradatie is per stream, niet per editie");

// ── De ontbrekende targets worden geteld ──
assert(voor.ontbrekendeTargets.length > 0 && voor.ontbrekendeTargets.some((m) => m.includes("exposanten")), "de ontbrekende targets worden expliciet opgesomd met hun reden");
assert(voor.summary.includes("van de zes targets ontbreekt"), "en de samenvatting noemt hoeveel van de zes cellen er missen");

// ── Een onbekende editie degradeert ──
const onbekend = buildEditionEvaluation({ points: punten, editions: [HUIDIG], targetRows: [target()], currentEditionId: "bestaat-niet", geoClone: "AQM", asOfDate: "2026-04-10" });
assert(onbekend.summary.includes("niet gevonden") && onbekend.daysToFair === null, "een onbekende editie levert geen evaluatie maar zegt dat eerlijk");

// ── De niet-vergelijkbaar-reden reist mee ──
const zonderVorige = buildEditionEvaluation({
  points: reeks("aqm-2026", "2026-01-01", 100, 10, "registraties"),
  editions: [HUIDIG],
  targetRows: [target()],
  currentEditionId: "aqm-2026",
  geoClone: "AQM",
  asOfDate: "2026-04-10",
});
const sectieZonder = renderEditionEvaluationSection(zonderVorige);
assert(sectieZonder.includes("niet vergelijkbaar"), "zonder vorige editie zegt de sectie dat de vergelijking niet kan, met de reden erbij");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
