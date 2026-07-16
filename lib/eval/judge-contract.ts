// X3 judge-contract: het pure contract voor de rubric-judge (spec sectie 4). De judge zelf
// is een LLM-call op temperatuur 0 (build-kant, twee passes); dit contract legt vast wat die
// call MOET leveren en hoe de passes gemiddeld en op stabiliteit getoetst worden. De no-go
// uit de spec is hard in het schema gebakken: een score zonder citaat uit de output is
// ongeldig. IO-vrij en los getest.

import { z } from "zod";

// De vier kwaliteitsdimensies die de tool al hanteert (spec plus het bestaande
// beoordelingskader): SOP-dekking, inzicht (waarom), actionability, leesbaarheid.
export const JUDGE_DIMENSIONS = ["sop_dekking", "inzicht_waarom", "actionability", "leesbaarheid"] as const;
export type JudgeDimension = (typeof JUDGE_DIMENSIONS)[number];

export const JUDGE_PROMPT_VERSION = "x3-judge-v1";

const DimensionScoreSchema = z.object({
  score: z.number().min(0).max(10),
  citations: z.array(z.string().min(1)).min(1), // de no-go: geen score zonder citaat
  motivation: z.string().min(1),
});

export const JudgePassSchema = z.object({
  sop_dekking: DimensionScoreSchema,
  inzicht_waarom: DimensionScoreSchema,
  actionability: DimensionScoreSchema,
  leesbaarheid: DimensionScoreSchema,
});

export type JudgePass = z.infer<typeof JudgePassSchema>;

// De judge-prompt: vast, versievast, temperatuur 0 aan de call-kant. De judge beoordeelt de
// deliverable tegen het benchmark-rapport en MOET per dimensie citeren uit de deliverable.
export function buildJudgePrompt(input: { deliverable: string; benchmark: string }): { system: string; user: string; version: string } {
  const system = `Je bent een strenge, onafhankelijke beoordelaar van Google Ads analyse-rapporten. Je beoordeelt een deliverable tegen een benchmark op vier dimensies, elk 0 tot 10: sop_dekking (dekt het rapport de voorgeschreven analyses), inzicht_waarom (verklaart het WAAROM iets gebeurt, niet alleen WAT), actionability (zijn de aanbevelingen concreet en uitvoerbaar), leesbaarheid (is het helder en zonder ruis). REGELS: antwoord UITSLUITEND met JSON conform het schema; elke score MOET minimaal een letterlijk citaat uit de deliverable bevatten als onderbouwing; geen citaat betekent dat je oordeel ongeldig is; wees kritisch, een 8 of hoger is uitzonderlijk.`;
  const user = `BENCHMARK-RAPPORT (referentiekwaliteit):\n${input.benchmark}\n\nTE BEOORDELEN DELIVERABLE:\n${input.deliverable}\n\nGeef je beoordeling als JSON met per dimensie { "score": number, "citations": [".."], "motivation": ".." }.`;
  return { system, user, version: JUDGE_PROMPT_VERSION };
}

// ── Twee passes middelen: het gemiddelde per dimensie, citaten samengevoegd (uniek). ──
export interface MergedJudgeResult {
  scores: Record<JudgeDimension, number>; // gemiddelde, op 1 decimaal
  citations: Record<JudgeDimension, string[]>;
  passCount: number;
}

export function mergeJudgePasses(passA: JudgePass, passB: JudgePass): MergedJudgeResult {
  const scores = {} as Record<JudgeDimension, number>;
  const citations = {} as Record<JudgeDimension, string[]>;
  for (const dim of JUDGE_DIMENSIONS) {
    scores[dim] = Math.round(((passA[dim].score + passB[dim].score) / 2) * 10) / 10;
    citations[dim] = [...new Set([...passA[dim].citations, ...passB[dim].citations])];
  }
  return { scores, citations, passCount: 2 };
}

// ── Stabiliteit (spec-test 3): twee passes op dezelfde output horen gemiddeld minder dan
// een punt per dimensie te verschillen; zo niet, dan is de judge-prompt niet scherp genoeg
// en mag het resultaat niet als besluitbasis dienen. ──
export interface JudgeStability {
  perDimensionDelta: Record<JudgeDimension, number>;
  meanDelta: number;
  stable: boolean;
}

export const JUDGE_STABILITY_THRESHOLD = 1.0;

export function judgeStability(passA: JudgePass, passB: JudgePass): JudgeStability {
  const perDimensionDelta = {} as Record<JudgeDimension, number>;
  let total = 0;
  for (const dim of JUDGE_DIMENSIONS) {
    const delta = Math.round(Math.abs(passA[dim].score - passB[dim].score) * 10) / 10;
    perDimensionDelta[dim] = delta;
    total += delta;
  }
  const meanDelta = Math.round((total / JUDGE_DIMENSIONS.length) * 100) / 100;
  return { perDimensionDelta, meanDelta, stable: meanDelta < JUDGE_STABILITY_THRESHOLD };
}
