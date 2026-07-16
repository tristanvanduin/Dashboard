export interface RecommendationLike {
  phase: "immediate" | "short_term" | "medium_term";
  ice_total: number;
  confidence?: "high" | "medium" | "low";
  rationale: string;
  measurement_metric: string;
  dependencies: string[];
  action_intent_class: string;
  action_unit_key: string;
  primary_entity_scope: string;
  primary_entity_key: string;
  canonical_entity_name: string;
  evidence_level?: "deterministic" | "inferred" | "hypothesis" | "unknown";
}

export interface TaskLike {
  owner: string;
  action_type: string;
  action_intent_class: string;
  action_unit_key: string;
  primary_entity_scope: string;
  primary_entity_key: string;
  canonical_entity_name?: string;
  phase: "immediate" | "short_term" | "medium_term";
  due_date_days: number;
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBusinessTarget(input: Pick<RecommendationLike | TaskLike, "action_intent_class" | "action_unit_key" | "primary_entity_scope" | "primary_entity_key">): string {
  if (input.action_intent_class === "geo_reallocation") {
    return `geo::${input.action_unit_key.split(":")[1] || input.primary_entity_key}`;
  }
  if (input.action_intent_class === "network_exclusion") {
    return `network::${input.action_unit_key.split(":")[1] || input.primary_entity_key}`;
  }
  if (input.action_intent_class === "portfolio_ownership") {
    return `portfolio::${input.action_unit_key.split(":")[1] || input.primary_entity_key}`;
  }
  return `${input.primary_entity_scope}::${input.primary_entity_key}`;
}

function recommendationPriorityValue(recommendation: RecommendationLike): number {
  const phaseScore = recommendation.phase === "immediate" ? 30 : recommendation.phase === "short_term" ? 20 : 10;
  const confidenceScore = recommendation.confidence === "high" ? 8 : recommendation.confidence === "medium" ? 4 : 0;
  return phaseScore + confidenceScore + recommendation.ice_total;
}

function mergeCompactSentences(...texts: Array<string | null | undefined>): string {
  const parts = texts
    .flatMap((text) => (text || "").split(/\s*\|\s*|\.\s+/g))
    .map((part) => part.trim().replace(/\.$/, ""))
    .filter(Boolean);
  return unique(parts).slice(0, 4).join(". ") + (parts.length > 0 ? "." : "");
}

function cleanSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function mergedTaskTitle(task: TaskLike): string {
  const entity = (task.canonical_entity_name || task.primary_entity_key.split("::").pop() || "").trim();
  switch (task.action_intent_class) {
    case "geo_reallocation":
      return `Verlaag budget en heralloceer voor ${entity}`.trim();
    case "network_exclusion":
      return `Beperk laagwaardige netwerken voor ${entity}`.trim();
    case "portfolio_ownership":
      return `Scherp kanaal- en productownership aan voor ${entity}`.trim();
    default:
      return task.title;
  }
}

function taskBusinessEntity(task: TaskLike): string {
  if (task.action_intent_class === "geo_reallocation" || task.action_intent_class === "network_exclusion" || task.action_intent_class === "portfolio_ownership") {
    return normalizeBusinessTarget(task);
  }
  return normalizeText(task.canonical_entity_name || task.primary_entity_key);
}

export function recommendationConflicts(a: RecommendationLike, b: RecommendationLike): boolean {
  if (a.action_intent_class === b.action_intent_class && normalizeBusinessTarget(a) === normalizeBusinessTarget(b)) {
    return true;
  }
  if (a.action_unit_key !== b.action_unit_key) return false;
  if (a.primary_entity_scope !== b.primary_entity_scope) return false;
  if (a.primary_entity_key !== b.primary_entity_key) return false;

  const opposing: Record<string, string[]> = {
    budget_expand: ["budget_reduce", "pause_segment"],
    budget_reduce: ["budget_expand"],
    bid_raise: ["bid_lower"],
    bid_lower: ["bid_raise"],
    pause_segment: ["budget_expand", "bid_raise"],
  };

  return opposing[a.action_intent_class]?.includes(b.action_intent_class) ?? false;
}

export function mergeRecommendations<T extends RecommendationLike>(primary: T, secondary: T): T {
  return {
    ...primary,
    rationale: mergeCompactSentences(primary.rationale, secondary.rationale),
    measurement_metric: unique(
      `${primary.measurement_metric}, ${secondary.measurement_metric}`
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    ).slice(0, 4).join(", "),
    dependencies: unique([...primary.dependencies, ...secondary.dependencies]),
    evidence_level:
      primary.evidence_level === "deterministic" || secondary.evidence_level === "deterministic"
        ? "deterministic"
        : primary.evidence_level === "inferred" || secondary.evidence_level === "inferred"
          ? "inferred"
          : primary.evidence_level === "unknown" || secondary.evidence_level === "unknown"
            ? "unknown"
            : "hypothesis",
    confidence:
      primary.confidence === "high" || secondary.confidence === "high"
        ? "high"
        : primary.confidence === "medium" || secondary.confidence === "medium"
          ? "medium"
          : "low",
  };
}

function priorityRank(priority: TaskLike["priority"]): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

export function resolveContradictions<TRec extends RecommendationLike, TTask extends TaskLike>(
  recommendations: TRec[],
  tasks: TTask[],
  limits: { maxRecommendations?: number; maxTasks?: number } = {}
): { recommendations: TRec[]; tasks: TTask[] } {
  const { maxRecommendations = 10, maxTasks = 15 } = limits;
  const keptRecs: TRec[] = [];

  for (const recommendation of recommendations) {
    const conflictingIndex = keptRecs.findIndex((kept) => recommendationConflicts(kept, recommendation));
    if (conflictingIndex === -1) {
      keptRecs.push(recommendation);
      continue;
    }

    const kept = keptRecs[conflictingIndex];
    const keepNew = recommendationPriorityValue(recommendation) > recommendationPriorityValue(kept);
    keptRecs[conflictingIndex] = keepNew
      ? mergeRecommendations(recommendation, kept)
      : mergeRecommendations(kept, recommendation);
  }

  const taskMap = new Map<string, TTask>();
  for (const task of tasks) {
    const signature = [
      task.owner,
      task.action_type,
      task.action_intent_class,
      normalizeBusinessTarget(task),
      taskBusinessEntity(task),
    ].join(":::");
    const existing = taskMap.get(signature);
    if (!existing) {
      taskMap.set(signature, {
        ...task,
        title: mergedTaskTitle(task),
        description: cleanSentence(task.description),
      });
      continue;
    }

    const preferred =
      priorityRank(task.priority) > priorityRank(existing.priority) ||
      task.due_date_days < existing.due_date_days
        ? task
        : existing;

    taskMap.set(signature, {
      ...preferred,
      title: mergedTaskTitle(preferred),
      description: mergeCompactSentences(existing.description, task.description),
      due_date_days: Math.min(existing.due_date_days, task.due_date_days),
      priority: priorityRank(task.priority) > priorityRank(existing.priority) ? task.priority : existing.priority,
      canonical_entity_name: preferred.canonical_entity_name ?? existing.canonical_entity_name,
    } as TTask);
  }

  return {
    recommendations: keptRecs.slice(0, maxRecommendations),
    tasks: Array.from(taskMap.values())
      .map((task) => ({
        ...task,
        description: cleanSentence(task.description),
      }))
      .sort((a, b) => a.due_date_days - b.due_date_days || a.title.localeCompare(b.title))
      .slice(0, maxTasks),
  };
}
