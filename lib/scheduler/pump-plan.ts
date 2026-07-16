// W1.3 (O3, 5b): het pure werkplan van een monthly-run voor de hervatbare pump. Een run
// bestaat uit geordende werkeenheden: de stappen, de checkpoints op de vaste punten en
// de afronding (quality gate plus full plus structured). resolveResumeIndex bepaalt
// idempotent waar een hervatte run verder gaat op basis van wat al persistent in
// sop_analysis_output staat. IO-vrij en los getest; runNextSteps (de IO-orkestratie,
// volgende ronde) consumeert dit.
//
// Anatomie uit de code (gegrond 3 juli 2026): de Google-flow draait Checkpoint A na
// stap 3, B na stap 7 en C na stap 12, en de keten loopt via de runningContext uit het
// laatste checkpoint. Checkpoints worden nu alleen in het geheugen gehouden; voor
// hervatbaarheid MOET de pump ze als sectie persisteren (step_number 0, section gelijk
// aan de checkpoint-naam), anders is de runningContext na een onderbreking weg. De
// afronding is klaar zodra de sectie structured_monthly_v2 bestaat.

export type WorkUnit =
  | { kind: "step"; step: number }
  | { kind: "checkpoint"; after: number; name: string }
  | { kind: "finalize" };

// De vaste Google-checkpointpunten (runCheckpoint-aanroepen in de route).
export const GOOGLE_CHECKPOINT_AFTER: ReadonlyMap<number, string> = new Map([
  [3, "Checkpoint A"],
  [7, "Checkpoint B"],
  [12, "Checkpoint C"],
]);

// W2.1 (M2b): Meta heeft 11 stappen; checkpoints na 3, 7 en 10 laten stap 11 als finale,
// analoog aan Google. W2.2 (L2b): LinkedIn heeft 9 stappen; twee checkpoints na 3 en 6
// laten stappen 7 tot 9 als slotcluster.
export const META_CHECKPOINT_AFTER: ReadonlyMap<number, string> = new Map([
  [3, "Checkpoint A"],
  [7, "Checkpoint B"],
  [10, "Checkpoint C"],
]);

export const LINKEDIN_CHECKPOINT_AFTER: ReadonlyMap<number, string> = new Map([
  [3, "Checkpoint A"],
  [6, "Checkpoint B"],
]);

// De checkpoint-posities voor een kanaal; valt terug op Google.
export function checkpointAfterForChannel(channel: string): ReadonlyMap<number, string> {
  if (channel === "meta_ads") return META_CHECKPOINT_AFTER;
  if (channel === "linkedin_ads") return LINKEDIN_CHECKPOINT_AFTER;
  return GOOGLE_CHECKPOINT_AFTER;
}

// De sectie die de afronding markeert (de laatste van de drie afrondingssecties).
export const FINAL_SECTION = "structured_monthly_v2";

export function buildWorkPlan(
  stepCount: number,
  checkpointAfter: ReadonlyMap<number, string> = GOOGLE_CHECKPOINT_AFTER
): WorkUnit[] {
  const plan: WorkUnit[] = [];
  for (let step = 1; step <= stepCount; step += 1) {
    plan.push({ kind: "step", step });
    const name = checkpointAfter.get(step);
    if (name) plan.push({ kind: "checkpoint", after: step, name });
  }
  plan.push({ kind: "finalize" });
  return plan;
}

export interface SavedProgress {
  stepNumbers: ReadonlySet<number>;
  checkpointNames: ReadonlySet<string>;
  finalized: boolean;
}

// Vertaalt sop_analysis_output-rijen naar de voortgang. Stappen zijn herkenbaar aan
// step_number >= 1; checkpoints aan hun section-naam; de afronding aan FINAL_SECTION.
export function savedProgressFromRows(
  rows: ReadonlyArray<{ section?: string | null; step_number?: number | null }>
): SavedProgress {
  const stepNumbers = new Set<number>();
  const checkpointNames = new Set<string>();
  let finalized = false;
  for (const row of rows) {
    const step = row.step_number;
    if (typeof step === "number" && step >= 1) stepNumbers.add(step);
    const section = row.section ?? "";
    if (section.startsWith("Checkpoint ")) checkpointNames.add(section);
    if (section === FINAL_SECTION) finalized = true;
  }
  return { stepNumbers, checkpointNames, finalized };
}

// De index van de eerstvolgende uit te voeren unit; null betekent dat alles er al staat
// en de run op completed mag. Gaten worden eerst gedicht (idempotentie).
export function resolveResumeIndex(plan: readonly WorkUnit[], saved: SavedProgress): number | null {
  for (let i = 0; i < plan.length; i += 1) {
    const unit = plan[i];
    if (unit.kind === "step" && !saved.stepNumbers.has(unit.step)) return i;
    if (unit.kind === "checkpoint" && !saved.checkpointNames.has(unit.name)) return i;
    if (unit.kind === "finalize" && !saved.finalized) return i;
  }
  return null;
}

// De units voor deze invocatie: maximaal batchSize eenheden vanaf de resume-index.
export function unitsForBatch(plan: readonly WorkUnit[], startIndex: number, batchSize: number): WorkUnit[] {
  if (startIndex < 0 || startIndex >= plan.length || batchSize < 1) return [];
  return plan.slice(startIndex, startIndex + batchSize);
}

// Welk checkpoint levert de runningContext voor een stap: het laatste checkpoint VOOR
// die stap. Null betekent dat de stap op de init-context draait (geen checkpoint ervoor).
export function contextCheckpointForStep(
  step: number,
  checkpointAfter: ReadonlyMap<number, string> = GOOGLE_CHECKPOINT_AFTER
): string | null {
  let best: { after: number; name: string } | null = null;
  for (const [after, name] of checkpointAfter) {
    if (after < step && (!best || after > best.after)) best = { after, name };
  }
  return best?.name ?? null;
}
