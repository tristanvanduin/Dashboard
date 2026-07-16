import { z } from "zod";

export const CheckpointFindingSchema = z.object({
  entiteit: z.string().min(1),
  metric: z.string().min(1),
  ernst: z.enum(["critical", "high", "medium", "low", "positive"]),
  samenvatting: z.string().min(1),
  bevestigd_door: z.array(z.string()).default([]),
});

export const CheckpointPatternSchema = z.object({
  pattern: z.string().min(1),
  confirmed_by: z.array(z.string()).min(1),
});

export const CheckpointContradictionSchema = z.object({
  finding_a: z.string().min(1),
  finding_b: z.string().min(1),
  resolution_needed: z.string().min(1),
});

export const CheckpointOutputSchema = z.object({
  consolidated_findings: z.array(CheckpointFindingSchema).max(15),
  primary_thread: z.string().min(1),
  confirmed_patterns: z.array(CheckpointPatternSchema).default([]),
  contradictions: z.array(CheckpointContradictionSchema).default([]),
  running_context: z.string().min(1).max(1500),
});

export type CheckpointOutput = z.infer<typeof CheckpointOutputSchema>;

export interface AcceptanceCriterionResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export const AcceptanceReportSchema = z.object({
  passed: z.boolean(),
  criteria: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      passed: z.boolean(),
      detail: z.string(),
    })
  ),
});

export type AcceptanceReport = z.infer<typeof AcceptanceReportSchema>;

export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export function parseCheckpointOutput(raw: string) {
  const extracted = extractJsonObject(raw);
  if (!extracted) {
    return { success: false as const, error: "Geen JSON-object gevonden", raw };
  }
  try {
    const parsed = JSON.parse(extracted);
    const data = CheckpointOutputSchema.parse(parsed);
    return { success: true as const, data };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
      raw,
    };
  }
}
