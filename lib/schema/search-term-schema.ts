/**
 * Zod schemas for Search Term Analysis structured output.
 *
 * Validates LLM batch output per search term.
 * Provides partial recovery: valid items are kept, invalid ones are flagged.
 */

import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────────────────

export const VerdictEnum = z.enum(["relevant", "irrelevant", "uncertain", "partially_relevant"]);
export type Verdict = z.infer<typeof VerdictEnum>;

export const RecommendedActionEnum = z.enum(["keep", "negative_exact", "negative_phrase", "monitor", "investigate"]);
export type RecommendedAction = z.infer<typeof RecommendedActionEnum>;

export const ConfidenceEnum = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceEnum>;

export const EvidenceLevelEnum = z.enum(["deterministic", "inferred", "weak_signal"]);
export type EvidenceLevel = z.infer<typeof EvidenceLevelEnum>;

export const ActionReadinessEnum = z.enum(["direct_action", "investigate_first", "monitor"]);
export type ActionReadiness = z.infer<typeof ActionReadinessEnum>;

export const ProductClassificationEnum = z.enum([
  "core_product_exact",
  "core_product_broad",
  "core_product_high_intent",
  "accessory_or_spare_part",
  "repair_or_support_intent",
  "adjacent_category",
  "off_catalog",
  "wrong_language_or_geo",
  "ambiguous_needs_review",
]);
export type ProductClassification = z.infer<typeof ProductClassificationEnum>;

export const EvidenceSourceEnum = z.enum([
  "feed_match",
  "site_match",
  "strategic_context",
  "lexical_inference",
  "unknown",
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceEnum>;

export const RecommendedScopeEnum = z.enum(["account", "campaign", "adgroup", "monitor_only"]);
export type RecommendedScope = z.infer<typeof RecommendedScopeEnum>;

export const ExclusionSafetyEnum = z.enum([
  "safe_to_exclude",
  "safe_to_exclude_modifier_only",
  "unsafe_to_exclude",
  "review_first",
]);
export type ExclusionSafety = z.infer<typeof ExclusionSafetyEnum>;

export const IntentTypeEnum = z.enum([
  "branded_own",           // eigen merknaam
  "branded_competitor",    // concurrent merknaam
  "generic_commercial",    // koopintentie, niet merk-gebonden
  "generic_informational", // hoe/wat/waarom, geen directe koopintentie
  "product_specific",      // specifiek product/dienst
  "category_broad",        // brede categorie
  "problem_solution",      // probleem waarvoor product/dienst de oplossing is
  "local_intent",          // bevat locatie-modifier
  "navigational",          // zoekt specifieke website/pagina
  "out_of_scope",          // totaal ongerelateerd
  // Legacy compat
  "transactional",
  "informational",
  "competitor",
  "brand",
  "unknown",
]);
export type IntentType = z.infer<typeof IntentTypeEnum>;

// ── Verdict schema ─────────────────────────────────────────────────────────

export const SearchTermVerdictSchema = z.object({
  searchTerm: z.string().min(1),
  relevanceScore: z.number().int().min(1).max(5),
  verdict: VerdictEnum,
  recommendedAction: RecommendedActionEnum,
  reason: z.string().min(1),
  // Enhanced fields (optional for backward compat)
  confidence: ConfidenceEnum.optional(),
  evidenceLevel: EvidenceLevelEnum.optional(),
  actionReadiness: ActionReadinessEnum.optional(),
  intentType: IntentTypeEnum.optional(),
  riskFlag: z.boolean().optional(),
  requiresHumanReview: z.boolean().optional(),
  // Intelligence fields
  saferAlternativeAction: RecommendedActionEnum.optional(),
  saferAlternativeReason: z.string().optional(),
  commercialityLevel: z.enum(["high", "medium", "low", "none"]).optional(),
  exclusionRisk: z.enum(["high", "medium", "low"]).optional(),
  clusterKey: z.string().optional(),
  productClassification: ProductClassificationEnum.optional(),
  soldByClient: z.boolean().optional(),
  supportedByCatalogEvidence: z.boolean().optional(),
  evidenceSource: EvidenceSourceEnum.optional(),
  evidenceSources: z.array(EvidenceSourceEnum).optional(),
  catalogEvidenceScore: z.number().optional(),
  recommendedScope: RecommendedScopeEnum.optional(),
  exclusionSafety: ExclusionSafetyEnum.optional(),
  matchedContext: z.array(z.string()).optional(),
  productContextStatus: z.enum(["protected_relevant", "relevant", "review_first", "not_sold"]).optional(),
  matchedCatalogEntityIds: z.array(z.string()).optional(),
  matchedAlias: z.string().nullable().optional(),
  matchConfidence: ConfidenceEnum.optional(),
  exclusionReasonType: z.enum([
    "not_sold",
    "variant_not_sold",
    "wrong_intent",
    "wrong_landing_page",
    "wrong_routing",
    "weak_performance_only",
    "insufficient_evidence",
  ]).optional(),
  displayLabel: z.string().optional(),
});

export type SearchTermVerdict = z.infer<typeof SearchTermVerdictSchema>;

export const SearchTermVerdictArraySchema = z.array(SearchTermVerdictSchema);

// ── Parse helpers ──────────────────────────────────────────────────────────

export interface BatchParseResult {
  success: boolean;
  verdicts: SearchTermVerdict[];
  failedCount: number;
  errors: string[];
}

/**
 * Parse and validate a batch of search term verdicts from LLM output.
 * Uses partial recovery: keeps valid items, counts invalid ones.
 */
export function parseSearchTermBatch(raw: string): BatchParseResult {
  // Strip markdown code fences
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  // Try to find JSON array
  if (!text.startsWith("[")) {
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) text = arrayMatch[0];
    else return { success: false, verdicts: [], failedCount: 0, errors: ["No JSON array found in LLM output"] };
  }

  let parsed: unknown[];
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { success: false, verdicts: [], failedCount: 0, errors: [`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`] };
  }

  if (!Array.isArray(parsed)) {
    return { success: false, verdicts: [], failedCount: 0, errors: ["Parsed result is not an array"] };
  }

  // Validate each item individually (partial recovery)
  const verdicts: SearchTermVerdict[] = [];
  const errors: string[] = [];
  let failedCount = 0;

  for (const item of parsed) {
    const result = SearchTermVerdictSchema.safeParse(item);
    if (result.success) {
      verdicts.push(result.data);
    } else {
      failedCount++;
      const termName = (item as Record<string, unknown>)?.searchTerm ?? "unknown";
      errors.push(`Invalid verdict for "${termName}": ${result.error.issues.map((i) => i.message).join(", ")}`);
    }
  }

  return {
    success: verdicts.length > 0,
    verdicts,
    failedCount,
    errors,
  };
}

// ── Coverage tracking ──────────────────────────────────────────────────────

export interface RunCoverage {
  totalInput: number;
  totalAnalyzed: number;
  totalFailed: number;
  totalRetried: number;
  totalMissing: number;
  coveragePct: number;
  batchResults: BatchResult[];
}

export interface BatchResult {
  batchNum: number;
  inputCount: number;
  outputCount: number;
  failedCount: number;
  retried: boolean;
  success: boolean;
}

/**
 * Detect search terms that were in the input but missing from the output.
 */
export function findMissingTerms(
  inputTerms: string[],
  outputVerdicts: SearchTermVerdict[]
): string[] {
  const outputSet = new Set(outputVerdicts.map((v) => v.searchTerm.toLowerCase()));
  return inputTerms.filter((t) => !outputSet.has(t.toLowerCase()));
}
