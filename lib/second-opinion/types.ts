/**
 * Second Opinion result types.
 * These map to the Supabase storage model and the PDF render model.
 */

import type { AuditSection, AuditMode, Impact, Complexity, SupportStatus } from "./template";

// ── Score model ────────────────────────────────────────────────────────────

export type AuditScore = "Goed" | "Voldoende" | "Onvoldoende" | "Niet beoordeeld" | "Niet van toepassing";

/** Numeric mapping: Goed=4, Voldoende=2, Onvoldoende=1, others=0 (excluded from scoring) */
export const SCORE_VALUES: Record<AuditScore, number> = {
  "Goed": 4,
  "Voldoende": 2,
  "Onvoldoende": 1,
  "Niet beoordeeld": 0,
  "Niet van toepassing": 0,
};

/** Scores that count toward category scoring (NvT and Niet beoordeeld are excluded) */
export function isScored(score: AuditScore): boolean {
  return score !== "Niet beoordeeld" && score !== "Niet van toepassing";
}

// ── Row result ─────────────────────────────────────────────────────────────

export interface AuditRowResult {
  templateId: number;
  section: AuditSection;
  controlPoint: string;
  impact: Impact;
  complexity: Complexity;
  /** Auto-generated score */
  score: AuditScore;
  /** Auto-generated comments */
  comments: string;
  supportStatus: SupportStatus;
  /** What evidence was used */
  evidenceSources: string[];
  /** How confident is the system in this score */
  confidence: "high" | "medium" | "low";
  /** Was this scored deterministically or via LLM */
  method: "deterministic" | "llm" | "manual" | "unsupported";

  // ── Manual override fields ──
  /** Manually overridden score (null = no override) */
  overrideScore?: AuditScore | null;
  /** Manually overridden comments (null = no override) */
  overrideComments?: string | null;
  /** When the override was made */
  overrideAt?: string | null;
  /** Whether this row has been manually overridden */
  isOverridden?: boolean;
}

// ── Section summary ────────────────────────────────────────────────────────

export interface SectionSummary {
  section: AuditSection;
  itemCount: number;
  averageScore: AuditScore;
  /** Numeric average for sorting/display */
  numericAverage: number;
}

// ── Full run result ────────────────────────────────────────────────────────

export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface SecondOpinionRun {
  id: string;
  clientId: string;
  mode: AuditMode;
  status: RunStatus;
  createdAt: string;
  completedAt: string | null;
  rows: AuditRowResult[];
  sectionSummaries: SectionSummary[];
  pdfStoragePath: string | null;
  fileId: string | null;
  error: string | null;
}

// ── Score calculation helpers ──────────────────────────────────────────────

/**
 * Calculate section summary from row results.
 * Score rules from template:
 *   Onvoldoende: < 50% van max punten
 *   Voldoende: 50% - 90% van max punten
 *   Goed: >= 90% van max punten
 */
export function calculateSectionSummary(section: AuditSection, rows: AuditRowResult[]): SectionSummary {
  const sectionRows = rows.filter((r) => r.section === section);
  if (sectionRows.length === 0) {
    return { section, itemCount: 0, averageScore: "Niet beoordeeld", numericAverage: 0 };
  }

  // Only count rows that have an actual score (exclude NvT and Niet beoordeeld)
  const scoredRows = sectionRows.filter((r) => isScored(r.score));
  const nvtCount = sectionRows.filter((r) => r.score === "Niet van toepassing").length;

  // If ALL rows are NvT, the section itself is not applicable
  if (nvtCount === sectionRows.length) {
    return { section, itemCount: sectionRows.length, averageScore: "Niet van toepassing", numericAverage: 0 };
  }

  if (scoredRows.length === 0) {
    return { section, itemCount: sectionRows.length, averageScore: "Niet beoordeeld", numericAverage: 0 };
  }

  const totalScore = scoredRows.reduce((sum, r) => sum + SCORE_VALUES[r.score], 0);
  const maxScore = scoredRows.length * SCORE_VALUES["Goed"];
  const pct = maxScore > 0 ? totalScore / maxScore : 0;
  const numericAverage = scoredRows.length > 0 ? totalScore / scoredRows.length : 0;

  let averageScore: AuditScore;
  if (pct >= 0.9) averageScore = "Goed";
  else if (pct >= 0.5) averageScore = "Voldoende";
  else averageScore = "Onvoldoende";

  return { section, itemCount: sectionRows.length, averageScore, numericAverage };
}

/**
 * Calculate all section summaries for a run.
 */
export function calculateAllSummaries(rows: AuditRowResult[]): SectionSummary[] {
  const sections = [...new Set(rows.map((r) => r.section))];
  return sections.map((s) => calculateSectionSummary(s, rows));
}

// ── Enhanced section summary ───────────────────────────────────────────────

export interface EnhancedSectionSummary extends SectionSummary {
  scoredCount: number;
  unscoredCount: number;
  manualReviewCount: number;
  confidenceNote: string;
}

export function calculateEnhancedSummary(section: AuditSection, rows: AuditRowResult[]): EnhancedSectionSummary {
  const base = calculateSectionSummary(section, rows);
  const sectionRows = rows.filter((r) => r.section === section);
  const scored = sectionRows.filter((r) => isScored(getFinalScore(r)));
  const nvt = sectionRows.filter((r) => getFinalScore(r) === "Niet van toepassing");
  const unscored = sectionRows.filter((r) => getFinalScore(r) === "Niet beoordeeld");
  const manualReview = sectionRows.filter((r) => r.supportStatus === "unsupported" || r.method === "unsupported");

  let confidenceNote = "";
  if (nvt.length === sectionRows.length) {
    confidenceNote = "Niet van toepassing voor dit account";
  } else if (unscored.length === 0 && nvt.length === 0) {
    confidenceNote = "Alle checks beoordeeld";
  } else if (unscored.length === 0 && nvt.length > 0) {
    confidenceNote = `${scored.length} beoordeeld, ${nvt.length} niet van toepassing`;
  } else if (scored.length === 0) {
    confidenceNote = "Geen checks automatisch beoordeeld — handmatige review vereist";
  } else {
    const parts = [`${scored.length} van ${sectionRows.length} beoordeeld`];
    if (nvt.length > 0) parts.push(`${nvt.length} n.v.t.`);
    if (unscored.length > 0) parts.push(`${unscored.length} handmatige review`);
    confidenceNote = parts.join(", ");
  }

  return {
    ...base,
    scoredCount: scored.length,
    unscoredCount: unscored.length,
    manualReviewCount: manualReview.length,
    confidenceNote,
  };
}

// ── Executive summary ──────────────────────────────────────────────────────

export type Verdict = "Sterk" | "Voldoende" | "Aandacht nodig" | "Kritiek";

export interface PriorityItem {
  controlPoint: string;
  section: AuditSection;
  impact: string;
  reason: string;
}

export interface ExecutiveSummary {
  verdict: Verdict;
  verdictExplanation: string;
  auditConfidence: "Hoog" | "Gemiddeld" | "Beperkt";
  confidenceExplanation: string;
  totalChecks: number;
  scoredChecks: number;
  unscoredChecks: number;
  goodCount: number;
  voldoendeCount: number;
  onvoldoendeCount: number;
  directActions: PriorityItem[];
  investigateFirst: PriorityItem[];
  efficiencyLeaks: PriorityItem[];
  growthBlockers: PriorityItem[];
  manualReviewItems: PriorityItem[];
  enhancedSummaries: EnhancedSectionSummary[];
}

/**
 * Compute a full executive summary from audit rows.
 * Derives all insights from structured data — no LLM involved.
 */
export function computeExecutiveSummary(rows: AuditRowResult[]): ExecutiveSummary {
  const finalRows = resolveFinalRows(rows);
  const scored = finalRows.filter((r) => isScored(r.score));
  const nvt = finalRows.filter((r) => r.score === "Niet van toepassing");
  const unscored = finalRows.filter((r) => r.score === "Niet beoordeeld");
  const good = scored.filter((r) => r.score === "Goed");
  const voldoende = scored.filter((r) => r.score === "Voldoende");
  const onvoldoende = scored.filter((r) => r.score === "Onvoldoende");

  // Verdict
  const pctGood = scored.length > 0 ? good.length / scored.length : 0;
  const pctOnvoldoende = scored.length > 0 ? onvoldoende.length / scored.length : 0;

  let verdict: Verdict;
  let verdictExplanation: string;
  if (pctOnvoldoende > 0.5) {
    verdict = "Kritiek";
    verdictExplanation = `Meer dan de helft van de beoordeelde checks (${onvoldoende.length} van ${scored.length}) scoort onvoldoende. Er zijn fundamentele verbeterpunten.`;
  } else if (pctOnvoldoende > 0.25) {
    verdict = "Aandacht nodig";
    verdictExplanation = `${onvoldoende.length} van ${scored.length} checks scoren onvoldoende. Er zijn concrete verbeterkansen.`;
  } else if (pctGood > 0.7) {
    verdict = "Sterk";
    verdictExplanation = `${good.length} van ${scored.length} checks scoren goed. Het account is solide ingericht.`;
  } else {
    verdict = "Voldoende";
    verdictExplanation = `Het account functioneert maar heeft verbeterpotentieel. ${voldoende.length + onvoldoende.length} checks vragen aandacht.`;
  }

  // Confidence — NvT items don't count against coverage
  const applicableRows = rows.length - nvt.length;
  const coveragePct = applicableRows > 0 ? scored.length / applicableRows : 0;
  let auditConfidence: ExecutiveSummary["auditConfidence"];
  let confidenceExplanation: string;
  if (coveragePct >= 0.8) {
    auditConfidence = "Hoog";
    confidenceExplanation = `${scored.length} van ${rows.length} checks zijn automatisch beoordeeld (${Math.round(coveragePct * 100)}% dekking).`;
  } else if (coveragePct >= 0.5) {
    auditConfidence = "Gemiddeld";
    confidenceExplanation = `${scored.length} van ${rows.length} checks beoordeeld (${Math.round(coveragePct * 100)}% dekking). ${unscored.length} checks vereisen handmatige review.`;
  } else {
    auditConfidence = "Beperkt";
    confidenceExplanation = `Slechts ${scored.length} van ${rows.length} checks beoordeeld (${Math.round(coveragePct * 100)}% dekking). Het oordeel is voorlopig.`;
  }

  // Priority buckets
  const directActions: PriorityItem[] = [];
  const investigateFirst: PriorityItem[] = [];
  const efficiencyLeaks: PriorityItem[] = [];
  const growthBlockers: PriorityItem[] = [];
  const manualReviewItems: PriorityItem[] = [];

  for (const row of finalRows) {
    // Manual review items
    if (row.score === "Niet beoordeeld" && row.supportStatus === "unsupported") {
      manualReviewItems.push({
        controlPoint: row.controlPoint,
        section: row.section,
        impact: row.impact,
        reason: "Geen geautomatiseerde data — handmatige beoordeling nodig",
      });
      continue;
    }

    if (row.score !== "Onvoldoende") continue;

    // Classify onvoldoende items by section/type
    const item: PriorityItem = {
      controlPoint: row.controlPoint,
      section: row.section,
      impact: row.impact,
      reason: row.comments,
    };

    // Direct actions: high impact + high confidence
    if (row.impact === "Hoog" && row.confidence === "high") {
      directActions.push(item);
    }
    // Investigate first: high impact + lower confidence
    else if (row.impact === "Hoog") {
      investigateFirst.push(item);
    }

    // Business impact buckets
    const lower = row.controlPoint.toLowerCase();
    if (lower.includes("budget") || lower.includes("waste") || lower.includes("negative") || lower.includes("zoekpartner")) {
      efficiencyLeaks.push(item);
    }
    if (lower.includes("remarketing") || lower.includes("dsa") || lower.includes("pmax") || lower.includes("shopping") || lower.includes("schaal") || lower.includes("audience")) {
      growthBlockers.push(item);
    }
  }

  // Enhanced summaries
  const sections = [...new Set(rows.map((r) => r.section))];
  const enhancedSummaries = sections.map((s) => calculateEnhancedSummary(s, finalRows));

  return {
    verdict,
    verdictExplanation,
    auditConfidence,
    confidenceExplanation,
    totalChecks: rows.length,
    scoredChecks: scored.length,
    unscoredChecks: unscored.length,
    goodCount: good.length,
    voldoendeCount: voldoende.length,
    onvoldoendeCount: onvoldoende.length,
    directActions: directActions.slice(0, 5),
    investigateFirst: investigateFirst.slice(0, 5),
    efficiencyLeaks: efficiencyLeaks.slice(0, 3),
    growthBlockers: growthBlockers.slice(0, 3),
    manualReviewItems: manualReviewItems.slice(0, 5),
    enhancedSummaries,
  };
}

// ── Final row resolution ───────────────────────────────────────────────────

/** Get the effective (final) score for a row: override wins over auto-generated. */
export function getFinalScore(row: AuditRowResult): AuditScore {
  return row.overrideScore ?? row.score;
}

/** Get the effective (final) comments for a row. */
export function getFinalComments(row: AuditRowResult): string {
  return row.overrideComments ?? row.comments;
}

/**
 * Resolve all rows to their final effective state.
 * Returns new row objects with score/comments set to the final values.
 * Used by PDF renderer and section summary calculation.
 */
export function resolveFinalRows(rows: AuditRowResult[]): AuditRowResult[] {
  return rows.map((row) => ({
    ...row,
    score: getFinalScore(row),
    comments: getFinalComments(row),
  }));
}

/**
 * Calculate section summaries using final effective scores (respects overrides).
 */
export function calculateFinalSummaries(rows: AuditRowResult[]): SectionSummary[] {
  const finalRows = resolveFinalRows(rows);
  return calculateAllSummaries(finalRows);
}
