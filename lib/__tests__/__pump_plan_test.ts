// Test voor het pure pump-werkplan (W1.3, 5b). Deterministisch, geen IO.
// Draaien: npx tsx lib/__tests__/__pump_plan_test.ts

import { buildWorkPlan, savedProgressFromRows, resolveResumeIndex, unitsForBatch, contextCheckpointForStep, checkpointAfterForChannel, GOOGLE_CHECKPOINT_AFTER, FINAL_SECTION, type WorkUnit } from "../scheduler/pump-plan";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Het plan van een 13-staps Google-run ──
const plan = buildWorkPlan(13);
assert(plan.length === 17, "13 stappen plus 3 checkpoints plus finalize is 17 units");
assert(plan[0].kind === "step" && plan[0].step === 1, "het plan begint bij stap 1");
assert(plan[3].kind === "checkpoint" && (plan[3] as { name: string }).name === "Checkpoint A", "Checkpoint A staat direct na stap 3");
assert(plan[8].kind === "checkpoint" && (plan[8] as { name: string }).name === "Checkpoint B", "Checkpoint B staat direct na stap 7");
assert(plan[14].kind === "checkpoint" && (plan[14] as { name: string }).name === "Checkpoint C", "Checkpoint C staat direct na stap 12");
assert(plan[15].kind === "step" && (plan[15] as { step: number }).step === 13, "stap 13 volgt op Checkpoint C");
assert(plan[16].kind === "finalize", "de afronding is de laatste unit");

// ── Voortgangsvertaling uit sop_analysis_output-rijen ──
const rijen = [
  { section: "Account Performance", step_number: 1 },
  { section: "Campaign Performance", step_number: 2 },
  { section: "Checkpoint A", step_number: 0 },
  { section: "quality_gate_monthly_v2", step_number: 0 },
];
const saved = savedProgressFromRows(rijen);
assert(saved.stepNumbers.has(1) && saved.stepNumbers.has(2) && !saved.stepNumbers.has(0), "stappen herkend, step_number 0 telt niet als stap");
assert(saved.checkpointNames.has("Checkpoint A"), "checkpoint herkend aan de section-naam");
assert(saved.finalized === false, "quality_gate alleen is nog geen afronding");
assert(savedProgressFromRows([{ section: FINAL_SECTION, step_number: 0 }]).finalized === true, "structured_monthly_v2 markeert de afronding");

// ── Resume-index: idempotent hervatten ──
assert(resolveResumeIndex(plan, savedProgressFromRows([])) === 0, "een verse run begint bij unit 0");
const naDrieStappen = savedProgressFromRows([
  { section: "s1", step_number: 1 }, { section: "s2", step_number: 2 }, { section: "s3", step_number: 3 },
]);
assert(resolveResumeIndex(plan, naDrieStappen) === 3, "na stap 1 tot 3 zonder checkpoint hervat de run bij Checkpoint A");
const metCheckpointA = savedProgressFromRows([
  { section: "s1", step_number: 1 }, { section: "s2", step_number: 2 }, { section: "s3", step_number: 3 },
  { section: "Checkpoint A", step_number: 0 },
]);
assert(resolveResumeIndex(plan, metCheckpointA) === 4, "met Checkpoint A opgeslagen is stap 4 de volgende");
const gat = savedProgressFromRows([
  { section: "s1", step_number: 1 }, { section: "s3", step_number: 3 },
]);
assert(resolveResumeIndex(plan, gat) === 1, "een gat (stap 2 ontbreekt) wordt eerst gedicht");
const allesRijen: Array<{ section: string; step_number: number }> = [];
for (let s = 1; s <= 13; s += 1) allesRijen.push({ section: `s${s}`, step_number: s });
allesRijen.push({ section: "Checkpoint A", step_number: 0 }, { section: "Checkpoint B", step_number: 0 }, { section: "Checkpoint C", step_number: 0 }, { section: FINAL_SECTION, step_number: 0 });
assert(resolveResumeIndex(plan, savedProgressFromRows(allesRijen)) === null, "alles opgeslagen betekent completed");

// ── Batch-selectie ──
const batch = unitsForBatch(plan, 3, 5);
assert(batch.length === 5 && batch[0].kind === "checkpoint", "de batch begint op de resume-index");
assert((batch[4] as WorkUnit & { step?: number }).kind === "step" && (batch[4] as { step: number }).step === 7, "vijf units vanaf Checkpoint A eindigen bij stap 7");
assert(unitsForBatch(plan, 16, 5).length === 1, "aan het einde blijft alleen de afronding over");
assert(unitsForBatch(plan, 99, 5).length === 0 && unitsForBatch(plan, 0, 0).length === 0, "randgevallen geven een lege batch");

// ── De runningContext-bron per stap ──
assert(contextCheckpointForStep(2) === null, "stap 2 draait op de init-context");
assert(contextCheckpointForStep(4) === "Checkpoint A", "stap 4 krijgt de context van Checkpoint A");
assert(contextCheckpointForStep(9) === "Checkpoint B", "stap 9 krijgt de context van Checkpoint B");
assert(contextCheckpointForStep(13) === "Checkpoint C", "stap 13 krijgt de context van Checkpoint C");
assert(GOOGLE_CHECKPOINT_AFTER.size === 3, "drie vaste checkpointpunten");

// ── W2.1/W2.2: per-kanaal checkpoint-posities ──
const metaPlan = buildWorkPlan(11, checkpointAfterForChannel("meta_ads"));
assert(metaPlan.length === 15, "Meta: 11 stappen plus 3 checkpoints plus finalize is 15 units");
assert(metaPlan.filter((u) => u.kind === "checkpoint").length === 3, "Meta heeft drie checkpoints");
assert(metaPlan[15 - 2].kind === "step" && (metaPlan[13] as { step: number }).step === 11, "Meta stap 11 is de finale stap na Checkpoint C");
assert(contextCheckpointForStep(11, checkpointAfterForChannel("meta_ads")) === "Checkpoint C", "Meta stap 11 draait op de context van Checkpoint C");

const liPlan = buildWorkPlan(9, checkpointAfterForChannel("linkedin_ads"));
assert(liPlan.length === 12, "LinkedIn: 9 stappen plus 2 checkpoints plus finalize is 12 units");
assert(liPlan.filter((u) => u.kind === "checkpoint").length === 2, "LinkedIn heeft twee checkpoints");
assert(contextCheckpointForStep(9, checkpointAfterForChannel("linkedin_ads")) === "Checkpoint B", "LinkedIn stap 9 draait op de context van Checkpoint B");

assert(checkpointAfterForChannel("google_ads") === GOOGLE_CHECKPOINT_AFTER, "onbekend of google valt terug op de Google-map");
assert(checkpointAfterForChannel("iets_anders") === GOOGLE_CHECKPOINT_AFTER, "een onbekend kanaal valt terug op Google");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
