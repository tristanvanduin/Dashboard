// X3 comparison-report: de pure markdown-bouwer voor het vergelijkingsrapport (spec sectie
// 4, punt 5). Volledig deterministisch op de aangeleverde scorekaarten en judge-resultaten;
// de optionele derde judge-call (de drie grootste kwalitatieve verschillen) heeft hier zijn
// contract: een Zod-schema dat elk verschil met citaten uit BEIDE kandidaten onderbouwt.

import { z } from "zod";
import type { ScorecardComparison, DeterministicScorecard } from "./scorecard";
import type { MergedJudgeResult } from "./judge-contract";
import { JUDGE_DIMENSIONS } from "./judge-contract";

// ── Het contract voor de drie grootste verschillen (derde judge-call, optioneel). ──
export const TopDifferenceSchema = z.object({
  titel: z.string().min(1),
  citaat_a: z.string().min(1),
  citaat_b: z.string().min(1),
  duiding: z.string().min(1),
});
export const TopDifferencesSchema = z.array(TopDifferenceSchema).min(1).max(3);
export type TopDifference = z.infer<typeof TopDifferenceSchema>;

export function buildDifferencesPrompt(input: { deliverableA: string; deliverableB: string; modelA: string; modelB: string }): { system: string; user: string } {
  return {
    system:
      "Je vergelijkt twee analyse-rapporten die op exact dezelfde input zijn gemaakt door twee verschillende modellen. Benoem de DRIE grootste kwalitatieve verschillen. REGELS: antwoord UITSLUITEND met een JSON-array van maximaal drie objecten { \"titel\", \"citaat_a\", \"citaat_b\", \"duiding\" }; elk verschil MOET een letterlijk citaat uit kandidaat A en een uit kandidaat B bevatten; zonder beide citaten is het verschil ongeldig.",
    user: `KANDIDAAT A (${input.modelA}):\n${input.deliverableA}\n\nKANDIDAAT B (${input.modelB}):\n${input.deliverableB}\n\nGeef de drie grootste kwalitatieve verschillen als JSON-array.`,
  };
}

// ── De markdown-bouwer. ──
function winnerLabel(winner: string, modelA: string, modelB: string): string {
  if (winner === "a") return modelA;
  if (winner === "b") return modelB;
  if (winner === "gelijk") return "gelijk";
  return "niet bepaalbaar";
}

function formatValue(value: number | boolean | null): string {
  if (value === null) return "onbekend";
  if (typeof value === "boolean") return value ? "ja" : "nee";
  return String(value);
}

export function buildComparisonMarkdown(input: {
  comparison: ScorecardComparison;
  scorecardA: DeterministicScorecard;
  scorecardB: DeterministicScorecard;
  judgeA?: MergedJudgeResult | null;
  judgeB?: MergedJudgeResult | null;
  differences?: TopDifference[] | null;
}): string {
  const { comparison, scorecardA, scorecardB } = input;
  const lines: string[] = [];

  lines.push(`# Modelvergelijking: ${comparison.modelA} tegen ${comparison.modelB}`);
  lines.push("");
  lines.push(`Fixture-set: ${comparison.fixtureSet}`);
  lines.push("");
  lines.push(`Samenvatting: ${comparison.modelA} wint ${comparison.summary.aWins} metingen, ${comparison.modelB} wint ${comparison.summary.bWins}, gelijk op ${comparison.summary.ties}, niet bepaalbaar op ${comparison.summary.undecided}.`);
  lines.push("");
  lines.push("## Deterministische metingen");
  lines.push("");
  lines.push(`| Meting | ${comparison.modelA} | ${comparison.modelB} | Winnaar | Richting |`);
  lines.push("|---|---|---|---|---|");
  for (const metric of comparison.metrics) {
    lines.push(
      `| ${metric.metric} | ${formatValue(metric.a)} | ${formatValue(metric.b)} | ${winnerLabel(metric.winner, comparison.modelA, comparison.modelB)} | ${metric.direction === "hoger_is_beter" ? "hoger is beter" : "lager is beter"} |`
    );
  }
  lines.push("");

  const costNotes = [scorecardA.costNote ? `${comparison.modelA}: ${scorecardA.costNote}` : null, scorecardB.costNote ? `${comparison.modelB}: ${scorecardB.costNote}` : null].filter((n): n is string => n != null);
  if (costNotes.length > 0) {
    lines.push("## Kosten-notities");
    lines.push("");
    for (const note of costNotes) lines.push(`- ${note}`);
    lines.push("");
  }

  const judgeBlocks: Array<{ model: string; judge: MergedJudgeResult }> = [];
  if (input.judgeA) judgeBlocks.push({ model: comparison.modelA, judge: input.judgeA });
  if (input.judgeB) judgeBlocks.push({ model: comparison.modelB, judge: input.judgeB });
  if (judgeBlocks.length > 0) {
    lines.push("## Rubric-beoordeling (judge, gemiddelde van twee passes)");
    lines.push("");
    for (const block of judgeBlocks) {
      lines.push(`### ${block.model}`);
      lines.push("");
      for (const dim of JUDGE_DIMENSIONS) {
        const citation = block.judge.citations[dim][0] ?? "";
        lines.push(`- ${dim}: ${block.judge.scores[dim]} van 10. Citaat: "${citation.slice(0, 160)}"`);
      }
      lines.push("");
    }
  }

  if (input.differences && input.differences.length > 0) {
    lines.push("## De grootste kwalitatieve verschillen (judge)");
    lines.push("");
    for (const [index, diff] of input.differences.entries()) {
      lines.push(`${index + 1}. **${diff.titel}**: ${diff.duiding}`);
      lines.push(`   - ${comparison.modelA}: "${diff.citaat_a.slice(0, 160)}"`);
      lines.push(`   - ${comparison.modelB}: "${diff.citaat_b.slice(0, 160)}"`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
