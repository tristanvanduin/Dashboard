import type {
  DisplayFinding,
  FinalSopRecommendation,
  FinalSopTask,
  MonthlyStructuredOutput,
  OperatingHypothesisTrace,
} from "@/lib/analysis/monthly-structured";
import type { NormalizedFinding } from "@/lib/analysis/canonicalize";

const HYPOTHESIS_METADATA_PREFIX = "__RM_MONTHLY_HYPOTHESIS_WORKFLOW__:";

export interface PersistedSprintHypothesisRow {
  id: string;
  client_id: string;
  analysis_id: string | null;
  hypothesis: string;
  expected_result: string | null;
  measurement_metric: string | null;
  timeframe: string | null;
  rationale: string | null;
  status: string;
  accepted_at?: string | null;
  created_at?: string | null;
}

export interface PersistedSprintItemRow {
  id: string;
  hypothesis_id: string | null;
  task: string;
  status: string;
  owner?: string | null;
  metrics?: string | null;
  review_timeframe?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MonthlyHypothesisPersistenceMetadata {
  source_hypothesis_id: string;
  source_structured_created_at: string;
  why_we_think_this: string;
  validation_or_exploitation_step: string;
  linked_primary_thread: string;
  linked_finding_ids: string[];
  linked_recommendation_ids: string[];
  linked_task_ids: string[];
  rejected_reason: string | null;
}

export interface HypothesisLinkedFinding {
  id: string;
  title: string;
  summary: string;
  severity: string;
  metric: string;
  entity_name: string;
}

export interface HypothesisLinkedRecommendation {
  id: string;
  route: string;
  object: string;
  handeling: string;
  meet_via: string;
}

export interface HypothesisLinkedTask {
  id: string;
  linked_recommendation_id: string;
  object: string;
  handeling: string;
  meet_via: string;
}

export interface HypothesisLinkedSprintItem {
  id: string;
  task: string;
  status: string;
  owner: string | null;
  metrics: string | null;
  review_timeframe: string | null;
}

export interface MonthlyInsightsHypothesisItem extends OperatingHypothesisTrace {
  linked_findings: HypothesisLinkedFinding[];
  linked_recommendations: HypothesisLinkedRecommendation[];
  linked_tasks: HypothesisLinkedTask[];
  sprint_items: HypothesisLinkedSprintItem[];
}

export interface MonthlyHypothesesInsightsPayload {
  analysis_id: string | null;
  structured_row_id: string | null;
  structured_created_at: string | null;
  hypotheses: MonthlyInsightsHypothesisItem[];
}

export interface SprintItemDraft {
  source_task_id: string;
  task: string;
  owner: string;
  metrics: string | null;
  review_timeframe: string | null;
}

export interface HypothesisSprintSyncPlan {
  drafts: SprintItemDraft[];
  missingDrafts: SprintItemDraft[];
  allLinkedTasksPresent: boolean;
}

function structuredRecommendationId(index: number): string {
  return `recommendation-${index + 1}`;
}

function structuredTaskId(index: number): string {
  return `task-${index + 1}`;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function encodeHypothesisPersistenceMetadata(metadata: MonthlyHypothesisPersistenceMetadata): string {
  return `${HYPOTHESIS_METADATA_PREFIX}${JSON.stringify(metadata)}`;
}

export function decodeHypothesisPersistenceMetadata(value: string | null | undefined): MonthlyHypothesisPersistenceMetadata | null {
  if (!value) return null;
  const raw = value.startsWith(HYPOTHESIS_METADATA_PREFIX)
    ? value.slice(HYPOTHESIS_METADATA_PREFIX.length)
    : value.trim().startsWith("{")
      ? value.trim()
      : null;
  if (!raw) return null;
  const parsed = parseJson(raw);
  if (!parsed) return null;
  const source_hypothesis_id = safeString(parsed.source_hypothesis_id);
  if (!source_hypothesis_id) return null;
  return {
    source_hypothesis_id,
    source_structured_created_at: safeString(parsed.source_structured_created_at),
    why_we_think_this: safeString(parsed.why_we_think_this),
    validation_or_exploitation_step: safeString(parsed.validation_or_exploitation_step),
    linked_primary_thread: safeString(parsed.linked_primary_thread),
    linked_finding_ids: Array.isArray(parsed.linked_finding_ids) ? parsed.linked_finding_ids.filter((item): item is string => typeof item === "string") : [],
    linked_recommendation_ids: Array.isArray(parsed.linked_recommendation_ids) ? parsed.linked_recommendation_ids.filter((item): item is string => typeof item === "string") : [],
    linked_task_ids: Array.isArray(parsed.linked_task_ids) ? parsed.linked_task_ids.filter((item): item is string => typeof item === "string") : [],
    rejected_reason: typeof parsed.rejected_reason === "string" && parsed.rejected_reason.trim().length > 0 ? parsed.rejected_reason.trim() : null,
  };
}

function findPersistedHypothesisRow(
  hypothesis: OperatingHypothesisTrace,
  rows: PersistedSprintHypothesisRow[],
  analysisId: string | null,
  structuredCreatedAt: string | null
): PersistedSprintHypothesisRow | null {
  const bySourceId = rows.find((row) => {
    if (analysisId && row.analysis_id && row.analysis_id !== analysisId) return false;
    const metadata = decodeHypothesisPersistenceMetadata(row.rationale);
    return (
      metadata?.source_hypothesis_id === hypothesis.id &&
      Boolean(metadata?.source_structured_created_at) &&
      metadata?.source_structured_created_at === structuredCreatedAt
    );
  });
  if (bySourceId) return bySourceId;
  return null;
}

function normalizeHypothesisStatus(value: string | null | undefined): "pending" | "accepted" | "rejected" {
  if (value === "accepted" || value === "completed") return "accepted";
  if (value === "rejected") return "rejected";
  return "pending";
}

function buildFindingLookup(findings: Array<Record<string, unknown> | NormalizedFinding | DisplayFinding>): Map<string, HypothesisLinkedFinding> {
  const lookup = new Map<string, HypothesisLinkedFinding>();
  findings.forEach((rawFinding, index) => {
    const finding = rawFinding as Record<string, unknown>;
    const id = safeString(finding.finding_id) || safeString(finding.display_key) || `display-finding-${index + 1}`;
    const entityName =
      safeString(finding.display_label)
      || safeString(finding.canonical_entity_name)
      || safeString(finding.entity_name)
      || safeString(finding.title)
      || "Finding";
    const metric = safeString(finding.metric) || safeString(finding.primary_metric) || "Metric";
    const summary =
      safeString(finding.summary)
      || safeString(finding.cause)
      || (Array.isArray(finding.supporting_evidence) && typeof finding.supporting_evidence[0] === "string"
        ? finding.supporting_evidence[0]
        : `${entityName} op ${metric}`);
    lookup.set(id, {
      id,
      title: safeString(finding.title) || `${entityName}: ${metric}`,
      summary,
      severity: safeString(finding.severity) || "medium",
      metric,
      entity_name: entityName,
    });
  });
  return lookup;
}

function buildRecommendationLookup(recommendations: FinalSopRecommendation[]): Map<string, HypothesisLinkedRecommendation> {
  return new Map(
    recommendations.map((recommendation, index) => [
      structuredRecommendationId(index),
      {
        id: structuredRecommendationId(index),
        route: recommendation.route,
        object: recommendation.object,
        handeling: recommendation.handeling,
        meet_via: recommendation.meet_via,
      },
    ])
  );
}

function buildTaskLookup(tasks: FinalSopTask[]): Map<string, HypothesisLinkedTask> {
  return new Map(
    tasks.map((task, index) => [
      structuredTaskId(index),
      {
        id: structuredTaskId(index),
        linked_recommendation_id: `recommendation-${task.linked_recommendation}`,
        object: task.object,
        handeling: task.handeling,
        meet_via: task.meet_via,
      },
    ])
  );
}

export function buildSprintItemDraftsForHypothesis(
  hypothesis: OperatingHypothesisTrace,
  structuredOutput: Pick<MonthlyStructuredOutput, "final_sop">
): SprintItemDraft[] {
  const taskLookup = buildTaskLookup(structuredOutput.final_sop.tasks);
  return hypothesis.linked_task_ids
    .map((taskId) => taskLookup.get(taskId))
    .filter((task): task is HypothesisLinkedTask => Boolean(task))
    .map((task) => ({
      source_task_id: task.id,
      task: task.handeling,
      owner: "Ranking Masters",
      metrics: task.meet_via || null,
      review_timeframe: "Deze sprint",
    }));
}

export function planHypothesisSprintSync(opts: {
  hypothesis: OperatingHypothesisTrace;
  structuredOutput: Pick<MonthlyStructuredOutput, "final_sop">;
  existingItems: PersistedSprintItemRow[];
}): HypothesisSprintSyncPlan {
  const drafts = buildSprintItemDraftsForHypothesis(opts.hypothesis, opts.structuredOutput);
  const missingDrafts = drafts.filter((draft) => !opts.existingItems.some((item) => item.task === draft.task));
  const allLinkedTasksPresent = drafts.every((draft) => opts.existingItems.some((item) => item.task === draft.task));
  return {
    drafts,
    missingDrafts,
    allLinkedTasksPresent,
  };
}

export function buildMonthlyHypothesesInsightsPayload(opts: {
  structuredOutput: Pick<MonthlyStructuredOutput, "final_sop" | "operating_detail"> & {
    findings?: MonthlyStructuredOutput["findings"];
    display_findings?: MonthlyStructuredOutput["display_findings"] | Array<Record<string, unknown>>;
  };
  analysisId: string | null;
  structuredRowId: string | null;
  structuredCreatedAt: string | null;
  persistedHypotheses: PersistedSprintHypothesisRow[];
  sprintItems: PersistedSprintItemRow[];
}): MonthlyHypothesesInsightsPayload {
  const storedFindings = (
    opts.structuredOutput.findings
    ?? opts.structuredOutput.display_findings
    ?? []
  ) as Array<Record<string, unknown> | NormalizedFinding | DisplayFinding>;
  const findingLookup = buildFindingLookup(
    storedFindings
  );
  const recommendationLookup = buildRecommendationLookup(opts.structuredOutput.final_sop.recommendations);
  const taskLookup = buildTaskLookup(opts.structuredOutput.final_sop.tasks);
  const fallbackFindingIds = Array.from(findingLookup.keys()).slice(0, 3);

  const hypotheses = opts.structuredOutput.operating_detail.hypotheses_and_next_month_proof.map((rawHypothesis, index) => {
    const linkedRecommendationIds = Array.isArray(rawHypothesis.linked_recommendation_ids) && rawHypothesis.linked_recommendation_ids.length > 0
      ? rawHypothesis.linked_recommendation_ids
      : [`recommendation-${index + 1}`];
    const linkedTaskIds = Array.isArray(rawHypothesis.linked_task_ids) && rawHypothesis.linked_task_ids.length > 0
      ? rawHypothesis.linked_task_ids
      : opts.structuredOutput.final_sop.tasks
          .map((task, taskIndex) => ({ task, taskId: structuredTaskId(taskIndex) }))
          .filter(({ task }) => task.linked_recommendation === index + 1)
          .map(({ taskId }) => taskId);
    const linkedFindingIds = Array.isArray(rawHypothesis.linked_finding_ids) && rawHypothesis.linked_finding_ids.length > 0
      ? rawHypothesis.linked_finding_ids
      : fallbackFindingIds;
    const hypothesis: OperatingHypothesisTrace = {
      id: rawHypothesis.id || `hypothesis-${index + 1}`,
      title: rawHypothesis.title || `Hypothesis ${index + 1}`,
      label: rawHypothesis.label || safeString(rawHypothesis.route) || `hypothesis-${index + 1}`,
      hypothesis_number: rawHypothesis.hypothesis_number ?? index + 1,
      route: rawHypothesis.route,
      hypothesis: rawHypothesis.hypothesis,
      why_we_think_this: rawHypothesis.why_we_think_this,
      validation_or_exploitation_step: rawHypothesis.validation_or_exploitation_step,
      success_next_month: rawHypothesis.success_next_month,
      expected_change: rawHypothesis.expected_change || rawHypothesis.success_next_month,
      success_metrics: Array.isArray(rawHypothesis.success_metrics) ? rawHypothesis.success_metrics : [],
      guardrail_metrics: Array.isArray(rawHypothesis.guardrail_metrics) ? rawHypothesis.guardrail_metrics : [],
      evaluation_window: rawHypothesis.evaluation_window || rawHypothesis.label || "",
      accept_if: rawHypothesis.accept_if || "",
      reject_if: rawHypothesis.reject_if || "",
      linked_primary_thread: rawHypothesis.linked_primary_thread || opts.structuredOutput.final_sop.primary_thread,
      linked_finding_ids: linkedFindingIds,
      linked_recommendation_ids: linkedRecommendationIds,
      linked_task_ids: linkedTaskIds,
      status: rawHypothesis.status ?? "pending",
      rejected_reason: rawHypothesis.rejected_reason ?? null,
      accepted_into_sprint: rawHypothesis.accepted_into_sprint ?? false,
    };
    const persisted = findPersistedHypothesisRow(hypothesis, opts.persistedHypotheses, opts.analysisId, opts.structuredCreatedAt);
    const metadata = decodeHypothesisPersistenceMetadata(persisted?.rationale);
    const hypothesisSprintItems = persisted
      ? opts.sprintItems.filter((item) => item.hypothesis_id === persisted.id)
      : [];
    const linkedFindings = hypothesis.linked_finding_ids
      .map((findingId) => findingLookup.get(findingId))
      .filter((finding): finding is HypothesisLinkedFinding => Boolean(finding));
    const linkedRecommendations = hypothesis.linked_recommendation_ids
      .map((recommendationId) => recommendationLookup.get(recommendationId))
      .filter((recommendation): recommendation is HypothesisLinkedRecommendation => Boolean(recommendation));
    const linkedTasks = hypothesis.linked_task_ids
      .map((taskId) => taskLookup.get(taskId))
      .filter((task): task is HypothesisLinkedTask => Boolean(task));
    const status = normalizeHypothesisStatus(persisted?.status ?? "pending");
    const acceptedIntoSprint = status === "accepted" && linkedTasks.every((task) =>
      hypothesisSprintItems.some((item) => item.task === task.handeling)
    );

    return {
      ...hypothesis,
      status,
      rejected_reason: metadata?.rejected_reason ?? hypothesis.rejected_reason,
      accepted_into_sprint: acceptedIntoSprint,
      linked_findings: linkedFindings,
      linked_recommendations: linkedRecommendations,
      linked_tasks: linkedTasks,
      sprint_items: hypothesisSprintItems.map((item) => ({
        id: item.id,
        task: item.task,
        status: item.status,
        owner: item.owner ?? null,
        metrics: item.metrics ?? null,
        review_timeframe: item.review_timeframe ?? null,
      })),
    };
  });

  return {
    analysis_id: opts.analysisId,
    structured_row_id: opts.structuredRowId,
    structured_created_at: opts.structuredCreatedAt,
    hypotheses,
  };
}
