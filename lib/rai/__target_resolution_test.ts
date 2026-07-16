// Test voor de R1 target-resolutie. Deterministisch, geen IO.
// Draaien: npx tsx lib/rai/__target_resolution_test.ts

import { validateTargetRows, resolveStreamTarget, resolveEventTargets, suggestTargetsFromPreviousEdition, checkEditionCpaPlausibility, TARGET_STREAMS, TARGET_METRICS, type EventStreamTargetRow } from "./target-resolution";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function rij(o: Partial<EventStreamTargetRow> = {}): EventStreamTargetRow {
  return {
    geoCloneKey: "AQM",
    editionId: "AQM-2026",
    stream: "registraties",
    volumeTarget: 8000,
    cpaTarget: 12.5,
    budgetPlanned: 100000,
    confirmedByClient: true,
    ...o,
  };
}

const CATALOGUS = ["AQA", "AQM", "AQC", "ICC"];

// ── Validatie ──
const nulGuard = validateTargetRows([rij({ cpaTarget: 0 })], CATALOGUS);
assert(nulGuard.some((i) => i.level === "error" && i.detail.includes("nooit een vergelijking met 0")), "een nul-target is een error met de O2-nul-guard-taal");
const conflict = validateTargetRows([rij(), rij({ volumeTarget: 9000 })], CATALOGUS);
assert(conflict.some((i) => i.level === "error" && i.detail.includes("2 rijen")), "twee rijen voor dezelfde (geo-clone, editie, stream) zijn een conflict-error");
const onbekend = validateTargetRows([rij({ geoCloneKey: "XXX" })], CATALOGUS);
assert(onbekend.some((i) => i.level === "warning" && i.detail.includes("onbekende geo-clone-sleutel")), "een sleutel buiten de catalogus is een warning");
const leeg = validateTargetRows([rij({ volumeTarget: null, cpaTarget: null, budgetPlanned: null })], CATALOGUS);
assert(leeg.some((i) => i.level === "warning" && i.detail.includes("lege rij")), "een rij zonder enige metric is een warning");
const onbevestigd = validateTargetRows([rij({ confirmedByClient: false })], CATALOGUS);
assert(onbevestigd.some((i) => i.level === "warning" && i.detail.includes("telt niet als target")), "onbevestigd is een warning met de mens-in-de-lus-uitleg");
assert(validateTargetRows([rij()], CATALOGUS).filter((i) => i.level === "error").length === 0, "een gezonde bevestigde rij geeft geen errors");

// ── Resolutie: exact, zonder fallback ──
const rows = [rij(), rij({ stream: "exposanten", volumeTarget: 400, cpaTarget: 85, budgetPlanned: null })];
const ok = resolveStreamTarget(rows, { geoCloneKey: "AQM", editionId: "AQM-2026", stream: "registraties", metric: "cpa" });
assert(ok.status === "resolved" && ok.value === 12.5, "de exacte match resolvet de metric-waarde");

const andereEditie = resolveStreamTarget(rows, { geoCloneKey: "AQM", editionId: "AQM-2027", stream: "registraties", metric: "cpa" });
assert(andereEditie.status === "geen_target" && andereEditie.reason.includes("bewust geen fallback"), "een target van editie 2026 lost 2027 NIET op: targets horen bij een editie");

const andereClone = resolveStreamTarget(rows, { geoCloneKey: "AQA", editionId: "AQM-2026", stream: "registraties", metric: "cpa" });
assert(andereClone.status === "geen_target", "de Mexico-targets gelden niet voor Amsterdam: geen cross-clone-fallback (de Tristan-correctie hard)");

const voorstel = resolveStreamTarget([rij({ confirmedByClient: false })], { geoCloneKey: "AQM", editionId: "AQM-2026", stream: "registraties", metric: "volume" });
assert(voorstel.status === "geen_target" && voorstel.reason.includes("ONBEVESTIGD"), "een onbevestigd voorstel resolvet niet, met de bevestig-instructie als reden");

const metricLeeg = resolveStreamTarget([rij({ budgetPlanned: null })], { geoCloneKey: "AQM", editionId: "AQM-2026", stream: "registraties", metric: "budget" });
assert(metricLeeg.status === "geen_target" && metricLeeg.reason.includes("geen budget-target"), "een rij zonder deze metric geeft de onderscheiden reden");

const dubbel = resolveStreamTarget([rij(), rij()], { geoCloneKey: "AQM", editionId: "AQM-2026", stream: "registraties", metric: "cpa" });
assert(dubbel.status === "conflict" && dubbel.reason.includes("kiest niet"), "bij een conflict weigert de resolutie te kiezen");

// ── De event-matrix: beide streams apart, missing benoemd ──
const matrix = resolveEventTargets(rows, { geoCloneKey: "AQM", editionId: "AQM-2026" });
assert(matrix.cells.length === 6 && TARGET_STREAMS.length === 2 && TARGET_METRICS.length === 3, "de matrix is twee streams maal drie metrics");
assert(matrix.complete === false && matrix.missing.length === 1 && matrix.missing[0].stream === "exposanten" && matrix.missing[0].metric === "budget", "de ene ontbrekende cel (exposanten-budget) staat benoemd in de missing-lijst");
const registratiesCellen = matrix.cells.filter((c) => c.stream === "registraties" && c.resolution.status === "resolved");
assert(registratiesCellen.length === 3, "de registraties-stream resolvet volledig los van de exposanten-stream (nooit samengevoegd)");

// ── De voorstel-generator ──
const voorstellen = suggestTargetsFromPreviousEdition({
  geoCloneKey: "AQM",
  newEditionId: "AQM-2027",
  previousRealized: [
    { stream: "registraties", volumeRealized: 7842.6, cpaRealized: 13.456 },
    { stream: "exposanten", volumeRealized: null, cpaRealized: null },
  ],
});
assert(voorstellen.length === 1 && voorstellen[0].stream === "registraties", "alleen streams met een echte realisatie krijgen een voorstel");
assert(voorstellen[0].confirmedByClient === false && voorstellen[0].budgetPlanned === null, "een voorstel is onbevestigd en budget blijft leeg (budget is een keuze, geen extrapolatie)");
assert(voorstellen[0].volumeTarget === 7843 && voorstellen[0].cpaTarget === 13.46, "de voorstel-waarden zijn netjes afgerond");
const kringloop = resolveStreamTarget(voorstellen, { geoCloneKey: "AQM", editionId: "AQM-2027", stream: "registraties", metric: "volume" });
assert(kringloop.status === "geen_target", "en het voorstel resolvet zelf NIET tot de klant bevestigt: de kringloop is dicht");

// ── Plausibiliteit via de hergebruikte O2-guard ──
assert(checkEditionCpaPlausibility(1.5, 15).implausible === true, "een CPA-target tienmaal onder de vorige editie is implausibel (herijking, geen prestatie)");
assert(checkEditionCpaPlausibility(150, 15).implausible === true, "de guard is symmetrisch: tienmaal erboven is ook implausibel");
assert(checkEditionCpaPlausibility(14, 15).implausible === false, "een target in de buurt van de vorige editie is plausibel");
assert(checkEditionCpaPlausibility(12, null).implausible === false, "zonder vorige-editie-referentie geen oordeel");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
