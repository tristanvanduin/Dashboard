// X3 replay-core: de testbare kern van de replay-runner. De route is een dunne schil; alle
// logica leeft hier met een injecteerbare callFn, zodat determinisme, checks-aggregatie,
// kosten en het judge-pad volledig zonder LLM bewezen zijn. De replay voert de gecapturede
// prompts STRING-GELIJK opnieuw uit met een expliciet model (bewust niet via callRouted: de
// keten-fallback zou model A stiekem model B kunnen maken en dat corrumpeert de vergelijking).

import { computeCallCost } from "@/lib/analysis/o2-targets-cost";
import { checkGrounding, checkPurity, checkSanitization, checkStructure, type EvalCheckResult } from "./output-checks";
import type { EvalRunInput } from "./scorecard";
import { JudgePassSchema, buildJudgePrompt, mergeJudgePasses, judgeStability, JUDGE_PROMPT_VERSION, type JudgePass, type MergedJudgeResult, type JudgeStability } from "./judge-contract";

// ── Het fixture-contract: wat de capture-haak wegschrijft en de replay afspeelt. ──
export interface EvalFixturePayload {
  systemPrompt: string;
  userMessage: string;
  stepName: string;
  sopType: string;
  jsonMode: boolean;
  /** step (hoofdloop en synthese), checkpoint, of repair; replay speelt standaard alleen step. */
  kind?: "step" | "checkpoint" | "repair";
}

export interface EvalFixtureRecord {
  step: number;
  payload: EvalFixturePayload;
}

// De injecteerbare call: de route wikkelt callOpenRouter (expliciet model, temperatuur 0);
// de tests injecteren een fake.
export type ReplayCallFn = (args: { system: string; user: string; jsonMode: boolean }) => Promise<{
  output: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}>;

export interface ReplayStepResult {
  step: number;
  stepName: string;
  output: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  checks: EvalCheckResult[]; // grounding (tegen de eigen userMessage), purity, sanitization
}

export interface ReplayRunResult {
  stepResults: ReplayStepResult[];
  combinedDeliverable: string;
  totalDurationMs: number;
  totalCostEur: number | null;
  costPartial: boolean;
  allStepsProduced: boolean;
}

// Speelt de fixtures op volgorde af. Per stap draaien de stap-checks met de EIGEN
// userMessage als grounding (die bevat de deterministische pre-compute die het model kreeg);
// de structuur-check hoort bij de gecombineerde deliverable en gebeurt in
// buildRunInputFromReplay. Kosten via het herbruikte computeCallCost met eerlijke paden:
// alle calls geprijsd geeft de som, deels geprijsd geeft de som plus partieel, niets
// geprijsd geeft null (de scorekaart-notitie legt uit waarom).
// Fix uit de zelfcorrectie: een capture-run schrijft OOK checkpoint- en repair-prompts weg
// (alles gaat door runStep). Repairs zijn output-afhankelijk van de oorspronkelijke run en
// horen niet in een modelvergelijking; checkpoints leveren zonder context-doorvoer niets.
// Replay speelt daarom standaard alleen kind "step". En duplicaten per stap (bijv. twee
// capture-runs op dezelfde fixture_set) maken de vergelijking dubbelzinnig: die worden
// gedetecteerd zodat de route kan weigeren met de uitleg een verse fixture_set te gebruiken.
export function filterFixturesForReplay(
  fixtures: EvalFixtureRecord[],
  includeKinds: Array<NonNullable<EvalFixturePayload["kind"]>> = ["step"]
): { fixtures: EvalFixtureRecord[]; excluded: number; duplicateSteps: number[] } {
  const playable = fixtures.filter((f) => includeKinds.includes(f.payload.kind ?? "step"));
  const seen = new Set<number>();
  const duplicateSteps: number[] = [];
  for (const fixture of playable) {
    if (seen.has(fixture.step) && !duplicateSteps.includes(fixture.step)) duplicateSteps.push(fixture.step);
    seen.add(fixture.step);
  }
  return { fixtures: playable, excluded: fixtures.length - playable.length, duplicateSteps };
}

export async function replayFixtures(input: {
  fixtures: EvalFixtureRecord[];
  model: string;
  callFn: ReplayCallFn;
  prices?: Record<string, { inputPer1M: number; outputPer1M: number }>;
}): Promise<ReplayRunResult> {
  const ordered = [...input.fixtures].sort((a, b) => a.step - b.step);
  const stepResults: ReplayStepResult[] = [];
  let totalDurationMs = 0;
  let pricedSum = 0;
  let pricedCalls = 0;

  for (const fixture of ordered) {
    const started = Date.now();
    const response = await input.callFn({
      system: fixture.payload.systemPrompt,
      user: fixture.payload.userMessage,
      jsonMode: fixture.payload.jsonMode,
    });
    const durationMs = Date.now() - started;
    totalDurationMs += durationMs;

    const cost = input.prices
      ? computeCallCost(input.model, response.promptTokens, response.completionTokens, input.prices)
      : computeCallCost(input.model, response.promptTokens, response.completionTokens);
    if (cost != null) {
      pricedSum += cost;
      pricedCalls += 1;
    }

    stepResults.push({
      step: fixture.step,
      stepName: fixture.payload.stepName,
      output: response.output,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      durationMs,
      checks: [
        checkGrounding(response.output, fixture.payload.systemPrompt + "\n\n" + fixture.payload.userMessage),
        checkPurity(response.output),
        checkSanitization(response.output),
      ],
    });
  }

  const totalCalls = stepResults.length;
  const totalCostEur = pricedCalls === 0 ? null : Math.round(pricedSum * 10000) / 10000;
  const costPartial = pricedCalls > 0 && pricedCalls < totalCalls;

  return {
    stepResults,
    combinedDeliverable: stepResults.map((s) => `## Stap ${s.step}: ${s.stepName}\n\n${s.output}`).join("\n\n"),
    totalDurationMs,
    totalCostEur,
    costPartial,
    allStepsProduced: totalCalls > 0 && stepResults.every((s) => s.output.trim().length > 0),
  };
}

// De brug naar de scorekaart: aggregeert de stap-checks naar errors-per-categorie, draait de
// structuur-check op de gecombineerde deliverable, en vult de run-input eerlijk (replay v1
// heeft geen repair-loop en parseert geen finale handelingen; die velden zijn feitelijk 0).
export function buildRunInputFromReplay(input: {
  model: string;
  fixtureSet: string;
  run: ReplayRunResult;
  requiredSections: string[];
}): EvalRunInput {
  const errorsByCategory: Record<string, number> = {};
  for (const stepResult of input.run.stepResults) {
    for (const check of stepResult.checks) {
      if (!check.passed) {
        errorsByCategory[check.check] = (errorsByCategory[check.check] ?? 0) + check.issues.length;
      }
    }
  }
  const structuur = checkStructure(input.run.combinedDeliverable, input.requiredSections);
  if (!structuur.passed) errorsByCategory["structuur"] = (errorsByCategory["structuur"] ?? 0) + structuur.issues.length;

  return {
    model: input.model,
    fixtureSet: input.fixtureSet,
    gatePassed: input.run.allStepsProduced,
    errorsByCategory,
    warningsByCategory: {},
    repairCount: 0,
    finalActions: [],
    durationMs: input.run.totalDurationMs,
    totalCostEur: input.run.totalCostEur,
    costPartial: input.run.costPartial,
    outputText: input.run.combinedDeliverable,
    // De echte grounding-check is per stap al gedaan (tegen de eigen userMessage, waar de
    // pre-compute in zit) en geaggregeerd in errorsByCategory. De kaart-brede check krijgt
    // de deliverable zelf als grounding zodat hij per definitie slaagt en niets dubbel telt.
    groundingText: input.run.combinedDeliverable,
    requiredSections: input.requiredSections,
  };
}

// ── De judge-uitvoering om het contract heen: twee passes, per pass maximaal EEN
// schema-retry met de validatorfout als feedback (werkwijze: een repair max), dan de
// middeling en de stabiliteitsblokkade. ──

export type JudgeCallFn = (args: { system: string; user: string }) => Promise<{ output: string }>;

export interface JudgeRunResult {
  ok: boolean;
  reason: string | null;
  merged: MergedJudgeResult | null;
  stability: JudgeStability | null;
  promptVersion: string;
}

function stripFences(text: string): string {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

async function runSingleJudgePass(callFn: JudgeCallFn, system: string, user: string): Promise<JudgePass | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const suffix =
      attempt === 0
        ? ""
        : "\n\nJe vorige antwoord was geen geldige JSON conform het schema. Antwoord UITSLUITEND met het JSON-object, zonder enige tekst eromheen, met per dimensie score, citations (minimaal een citaat) en motivation.";
    const response = await callFn({ system, user: user + suffix });
    try {
      const parsed = JudgePassSchema.safeParse(JSON.parse(stripFences(response.output)));
      if (parsed.success) return parsed.data;
    } catch {
      // JSON.parse faalde; de retry-suffix dekt dit
    }
  }
  return null;
}

export async function runJudge(input: {
  callFn: JudgeCallFn;
  deliverable: string;
  benchmark: string;
}): Promise<JudgeRunResult> {
  const prompt = buildJudgePrompt({ deliverable: input.deliverable, benchmark: input.benchmark });

  const passA = await runSingleJudgePass(input.callFn, prompt.system, prompt.user);
  if (!passA) return { ok: false, reason: "pass A leverde geen geldige beoordeling (ook na een retry)", merged: null, stability: null, promptVersion: JUDGE_PROMPT_VERSION };
  const passB = await runSingleJudgePass(input.callFn, prompt.system, prompt.user);
  if (!passB) return { ok: false, reason: "pass B leverde geen geldige beoordeling (ook na een retry)", merged: null, stability: null, promptVersion: JUDGE_PROMPT_VERSION };

  const stability = judgeStability(passA, passB);
  if (!stability.stable) {
    return {
      ok: false,
      reason: `de twee judge-passes verschillen gemiddeld ${stability.meanDelta} punt per dimensie (drempel 1,0); het oordeel is geblokkeerd`,
      merged: mergeJudgePasses(passA, passB),
      stability,
      promptVersion: JUDGE_PROMPT_VERSION,
    };
  }

  return { ok: true, reason: null, merged: mergeJudgePasses(passA, passB), stability, promptVersion: JUDGE_PROMPT_VERSION };
}
