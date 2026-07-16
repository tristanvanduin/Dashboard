/**
 * Zod schemas for structured LLM output validation.
 *
 * These schemas match the existing sop_insights / sop_recommendations / sop_tasks
 * table structures. They replace the brittle regex + JSON.parse fallback chains
 * in the monthly analysis route (steps 7-8).
 */

import { z } from "zod";

// ── Shared enums ───────────────────────────────────────────────────────────

export const SeverityEnum = z.enum(["critical", "high", "medium", "low", "positive"]);
export type Severity = z.infer<typeof SeverityEnum>;

export const EntityTypeEnum = z.enum(["account", "campaign", "adgroup", "keyword", "product", "searchterm", "creative", "audience", "device", "country", "network", "schedule"]);
export type EntityType = z.infer<typeof EntityTypeEnum>;

export const InsightTypeEnum = z.enum(["performance", "trend", "anomaly", "opportunity", "risk", "positive"]);
export type InsightType = z.infer<typeof InsightTypeEnum>;

export const ActionTypeEnum = z.enum([
  "budget", "bid", "targeting", "creative", "structure",
  "tracking", "audit", "negative", "website", "content", "feed",
]);
export type ActionType = z.infer<typeof ActionTypeEnum>;

export const PriorityEnum = z.enum(["critical", "high", "medium", "low"]);
export type Priority = z.infer<typeof PriorityEnum>;

export const FrequencyEnum = z.enum(["direct", "weekly", "biweekly", "monthly"]);
export type Frequency = z.infer<typeof FrequencyEnum>;

export const OwnerEnum = z.enum(["Ranking Masters", "Klant"]);
export type Owner = z.infer<typeof OwnerEnum>;

export const RecommendationSourceEnum = z.enum(["finding", "hypothesis"]);
export type RecommendationSource = z.infer<typeof RecommendationSourceEnum>;

export const EvidenceLevelEnum = z.enum(["deterministic", "inferred", "hypothesis", "unknown"]);
export type EvidenceLevel = z.infer<typeof EvidenceLevelEnum>;

export const ConfidenceEnum = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceEnum>;

export const BenchmarkTypeEnum = z.enum([
  "monthly_target", "pace_target", "annual_goal",
  "sector_benchmark", "account_average", "campaign_average",
  "previous_month", "previous_year",
]);
export type BenchmarkType = z.infer<typeof BenchmarkTypeEnum>;

export const ActionReadinessEnum = z.enum([
  "direct_action",        // voldoende bewijs, direct uitvoerbaar
  "investigate_first",    // signaal sterk genoeg om te onderzoeken
  "monitor",              // te weinig data, observeren
  "strategic_hypothesis",  // langetermijn idee, niet urgent
]);
export type ActionReadiness = z.infer<typeof ActionReadinessEnum>;

export const IssueClusterEnum = z.enum([
  "tracking_cvr_drop",
  "search_budget_cap",
  "desktop_inefficiency",
  "mobile_opportunity",
  "audience_inefficiency",
  "creative_mismatch",
  "schedule_waste",
  "network_quality",
  "search_partner_waste",
  "geo_allocation",
  "search_term_waste",
  "search_bidding_inflation",
  "pmax_cannibalization",
  "product_mix",
  "brand_leakage",
  "performance_winner",
  "efficiency_gain",
  "scaling_opportunity",
  "device_performance_gap",
  "low_cvr_high_ctr",
  "volume_shortfall",
  "uncategorized",
]);
export type IssueCluster = z.infer<typeof IssueClusterEnum>;

export const ProblemClassificationSchema = z.enum([
  "real_problem",
  "expected_tradeoff",
  "contextual_shift",
  "measurement_risk",
  "false_positive_alert",
]);
export type ProblemClassification = z.infer<typeof ProblemClassificationSchema>;

export const ActionPhaseSchema = z.enum(["immediate", "short_term", "medium_term"]);
export type ActionPhase = z.infer<typeof ActionPhaseSchema>;

export const AnalysisThreadSchema = z.object({
  id: z.string(),
  priority: z.number().int().min(1).max(4),
  title: z.string(),
  classification: ProblemClassificationSchema,
  root_cause_summary: z.string(),
  business_impact: z.string(),
  supporting_cluster_ids: z.array(z.string()),
  recommended_recommendation_ids: z.array(z.number().int()),
  monitoring_metrics: z.array(z.string()),
  confidence: ConfidenceEnum,
  phase: ActionPhaseSchema,
});
export type AnalysisThread = z.infer<typeof AnalysisThreadSchema>;

// ── Finding schema (step 7 output) ────────────────────────────────────────

export const FindingSchema = z.object({
  step: z.number().int().min(1).max(13),
  issue_cluster: IssueClusterEnum,
  issue_cluster_explanation: z.string().optional(),
  entity_type: EntityTypeEnum,
  entity_name: z.string().min(1),
  entity_scope: z.string().optional(),
  parent_campaign: z.string().nullable().optional(),
  parent_adgroup: z.string().nullable().optional(),
  display_label: z.string().optional(),
  metric: z.string().min(1),
  current_value: z.number().nullable(),
  previous_value: z.number().nullable(),
  change_pct: z.number().nullable(),
  severity: SeverityEnum,
  insight_type: InsightTypeEnum,
  is_seasonal: z.boolean(),
  is_structural: z.boolean(),
  cause: z.string().nullable(),
  action_required: z.boolean(),
  // Evidence model (optional for backward compatibility)
  evidence_level: EvidenceLevelEnum.optional(),
  confidence: ConfidenceEnum.optional(),
  benchmark_type: BenchmarkTypeEnum.optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const FindingsArraySchema = z.array(FindingSchema);

export const StepStatusEnum = z.enum(["KRITIEK", "NIET OP SCHEMA", "OP SCHEMA"]);
export type StepStatus = z.infer<typeof StepStatusEnum>;

export const StepActionSchema = z.object({
  actie: z.string().min(5).refine(
    (val) => !/(consolideer|optimaliseer|onderzoek|analyseer)/i.test(val),
    { message: "Actie bevat verboden woord" }
  ),
  campagne: z.string().nullable(),
  deadline: z.enum(["direct", "deze_week", "volgende_week", "deze_maand"]),
  verwachte_impact: z.string().min(5),
});
export type StepAction = z.infer<typeof StepActionSchema>;

export const StepOutputSchema = z.object({
  narrative: z.string().min(50),
  log_entries: z.array(z.string()).min(1),
  top_3_findings: z.array(FindingSchema).min(1).max(3),
  status: StepStatusEnum,
  actions: z.array(StepActionSchema).max(2),
  step_conclusion: z.string().min(10),
});
export type StepOutput = z.infer<typeof StepOutputSchema>;

// ── Recommendation schema (step 8 output — recommendations part) ──────────

export const RecommendationSchema = z.object({
  finding_index: z.number().int().nullable(),
  cluster_id: z.string().min(1).default("cluster_unknown"),
  thread_id: z.string().nullable().default(null),
  source: RecommendationSourceEnum,
  hypothesis: z.string().min(1),
  expected_result: z.string().min(1),
  measurement_metric: z.string().min(1),
  timeframe: z.string().min(1),
  rationale: z.string().min(1),
  ice_impact: z.number().min(1).max(10),
  ice_confidence: z.number().min(1).max(10),
  ice_ease: z.number().min(1).max(10),
  ice_total: z.number().min(1).max(10),
  // Action gating (optional for backward compatibility)
  action_readiness: ActionReadinessEnum.optional(),
  evidence_level: EvidenceLevelEnum.optional(),
  confidence: ConfidenceEnum.optional(),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

// ── Task schema (step 8 output — tasks part) ──────────────────────────────

export const TaskSchema = z.object({
  recommendation_index: z.number().int(),
  cluster_id: z.string().min(1).default("cluster_unknown"),
  thread_id: z.string().nullable().default(null),
  title: z.string().min(1).max(80),
  description: z.string().min(1),
  action_type: ActionTypeEnum,
  owner: OwnerEnum,
  affected_campaign: z.string().nullable(),
  affected_adgroup: z.string().nullable(),
  affected_keyword: z.string().nullable(),
  current_value: z.string().nullable(),
  target_value: z.string().nullable(),
  priority: PriorityEnum,
  frequency: FrequencyEnum,
  due_date_days: z.number().int().min(1).max(365),
});

export type Task = z.infer<typeof TaskSchema>;

// ── Combined step 8 output schema ─────────────────────────────────────────

export const RecommendationsOutputSchema = z.object({
  recommendations: z.array(RecommendationSchema),
  tasks: z.array(TaskSchema),
});

export type RecommendationsOutput = z.infer<typeof RecommendationsOutputSchema>;

// ── Parse helpers ──────────────────────────────────────────────────────────

/**
 * Strips markdown code fences and extracts JSON from LLM text output.
 * Returns the cleaned string, or null if no JSON-like content found.
 */
export function extractJson(raw: string): string | null {
  let text = raw.trim();

  // Strip markdown code fences
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  // If it looks like JSON, return it
  if (text.startsWith("[") || text.startsWith("{")) {
    return text;
  }

  // Try to find a JSON array or object embedded in the text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];

  return null;
}

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; raw: string };

function inferIssueCluster(raw: Record<string, unknown>): IssueCluster {
  const provided = typeof raw.issue_cluster === "string" ? raw.issue_cluster.trim().toLowerCase() : "";
  const entityType = typeof raw.entity_type === "string" ? raw.entity_type.toLowerCase() : "";
  const metric = typeof raw.metric === "string" ? raw.metric.toLowerCase() : "";
  const cause = typeof raw.cause === "string" ? raw.cause.toLowerCase() : "";
  const combined = `${provided} ${entityType} ${metric} ${cause}`.trim();

  if (/tracking|measurement/.test(combined)) return "tracking_cvr_drop";
  if (/lost is|budget/.test(combined)) return "search_budget_cap";
  if (/troas|bid|cpc|inflation/.test(combined)) return "search_bidding_inflation";
  if (/desktop/.test(combined)) return "desktop_inefficiency";
  if (/creative|copy|rsa/.test(combined)) return "creative_mismatch";
  if (/pmax|performance max|cannibal/.test(combined)) return "pmax_cannibalization";
  if (/search.?term|waste|negative|keyword|searchterm/.test(combined) || entityType === "searchterm") return "search_term_waste";
  if (/geo|country|land|region|belg|nederland|germany|duitsland|france|frankrijk/.test(combined) || entityType === "country") return "geo_allocation";
  if (/audience/.test(combined) || entityType === "audience") return "audience_inefficiency";
  if (/schedule|hour|daypart|dag|uur/.test(combined) || entityType === "schedule") return "schedule_waste";
  if (/network|youtube|partner/.test(combined) || entityType === "network") return "network_quality";
  if (/product|shopping|asset group|asset_group/.test(combined) || entityType === "creative") return "product_mix";
  if (/mobile/.test(combined) || (entityType === "device" && /mobile/.test(combined))) return "mobile_opportunity";
  if (/brand/.test(combined)) return "brand_leakage";
  if (/partner/.test(combined)) return "search_partner_waste";
  return "uncategorized";
}

function enrichRawFinding(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const record = { ...(raw as Record<string, unknown>) };
  if (typeof record.issue_cluster !== "string" || !record.issue_cluster.trim()) {
    const inferred = inferIssueCluster(record);
    record.issue_cluster = inferred;
  if (inferred === "uncategorized" && !record.issue_cluster_explanation) {
    record.issue_cluster_explanation = "Deterministische fallback omdat geen standaardcluster duidelijk toepasbaar was.";
  }
  }
  return record;
}

/**
 * Parse and validate findings from LLM output (step 7).
 * Returns validated findings array or error details.
 */
export function parseFindings(raw: string): ParseResult<Finding[]> {
  const json = extractJson(raw);
  if (!json) {
    return { success: false, error: "No JSON found in LLM output", raw };
  }

  try {
    const parsed = JSON.parse(json);
    const arr = (Array.isArray(parsed) ? parsed : (parsed.findings ?? parsed.insights ?? [])).map(enrichRawFinding);
    const result = FindingsArraySchema.safeParse(arr);

    if (result.success) {
      return { success: true, data: result.data };
    }

    // Partial recovery: keep items that validate individually
    const validItems: Finding[] = [];
    for (const item of arr) {
      const single = FindingSchema.safeParse(item);
      if (single.success) validItems.push(single.data);
    }

    if (validItems.length > 0) {
      return { success: true, data: validItems };
    }

    return {
      success: false,
      error: `Zod validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      raw,
    };
  } catch (e) {
    return { success: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`, raw };
  }
}

/**
 * Parse and validate recommendations + tasks from LLM output (step 8).
 * Returns validated output or error details.
 */
export function parseRecommendations(raw: string): ParseResult<RecommendationsOutput> {
  const json = extractJson(raw);
  if (!json) {
    return { success: false, error: "No JSON found in LLM output", raw };
  }

  try {
    const parsed = JSON.parse(json);
    const result = RecommendationsOutputSchema.safeParse(parsed);

    if (result.success) {
      return { success: true, data: result.data };
    }

    // Partial recovery: validate each array individually
    const validRecs: Recommendation[] = [];
    const validTasks: Task[] = [];

    for (const rec of (parsed.recommendations ?? [])) {
      const single = RecommendationSchema.safeParse(rec);
      if (single.success) validRecs.push(single.data);
    }
    for (const task of (parsed.tasks ?? [])) {
      const single = TaskSchema.safeParse(task);
      if (single.success) validTasks.push(single.data);
    }

    if (validRecs.length > 0 || validTasks.length > 0) {
      return { success: true, data: { recommendations: validRecs, tasks: validTasks } };
    }

    return {
      success: false,
      error: `Zod validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      raw,
    };
  } catch (e) {
    return { success: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`, raw };
  }
}
