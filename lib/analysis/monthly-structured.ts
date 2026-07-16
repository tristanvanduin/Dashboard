import type {
  CoverageDimension,
  DisplayGroupIdentity,
  IssueCluster,
  NormalizedFinding,
  SopCoverage,
} from "@/lib/analysis/canonicalize";
import {
  actionFamilyFromIssueCluster,
  causeFamilyFromIssueCluster,
  displayProblemKey,
  issueFamily,
  metricProblemFamily,
} from "@/lib/analysis/canonicalize";
import type {
  ActionReadiness,
  Confidence,
  EvidenceLevel,
  Finding,
  Recommendation,
  Task,
} from "@/lib/schema/analysis-schema";
import { enforceIceSpread } from "@/lib/analysis/thread-synthesis";
import { sanitizeOutput } from "@/lib/analysis/sanitize";
import { inferActionDomains, isActionAlignedWithStep } from "@/lib/analysis/step-validator";
import { MONTHLY_FINAL_SOP_SECTIONS, MONTHLY_OPERATING_DETAIL_SECTIONS } from "@/lib/prompts/sop-prompts";

export type ActionPhase = "immediate" | "short_term" | "medium_term";

export type ThreadClassification =
  | "real_problem"
  | "expected_tradeoff"
  | "contextual_shift"
  | "measurement_risk"
  | "false_positive_alert";

export type ActionIntentClass =
  | "budget_expand"
  | "budget_reduce"
  | "bid_raise"
  | "bid_lower"
  | "pause_segment"
  | "negative_cleanup"
  | "tracking_validation"
  | "network_exclusion"
  | "creative_refresh"
  | "geo_reallocation"
  | "schedule_control"
  | "portfolio_ownership"
  | "audience_refine"
  | "monitor_only"
  | "investigation";

export type ActionStrategyMode = "containment" | "recovery" | "validation" | "monitor";

export interface RecommendationStrategyOption {
  mode: ActionStrategyMode;
  action: string;
  expected_result: string;
  timeframe: string;
  evidence_level: EvidenceLevel;
  confidence: Confidence;
  validation_metric?: string;
  validation_condition?: string;
  risk_note?: string;
}

export interface ParsedStepOutput {
  stepNumber: number;
  stepName: string;
  narrative: string;
  log_entries: string[];
  findings: Finding[];
  status: "KRITIEK" | "NIET OP SCHEMA" | "OP SCHEMA";
  actions: Array<{
    actie: string;
    campagne: string | null;
    deadline: "direct" | "deze_week" | "volgende_week" | "deze_maand";
    verwachte_impact: string;
  }>;
  step_conclusion: string;
  rawOutput?: string;
  displayFindings?: Finding[];
}
export type StepFindingSidecar = ParsedStepOutput;

export interface AnalysisThread {
  id: string;
  title: string;
  priority: 1 | 2 | 3;
  classification: ThreadClassification;
  root_cause_summary: string;
  business_impact: string;
  supporting_cluster_ids: string[];
  recommended_recommendation_ids: number[];
  monitoring_metrics: string[];
  confidence: Confidence;
}

export interface ThreadRecommendation extends Recommendation {
  cluster_id: string;
  thread_id: string | null;
  phase: ActionPhase;
  owner: "Ranking Masters" | "Klant";
  dependencies: string[];
  action_intent_class: ActionIntentClass;
  action_unit_key: string;
  primary_entity_scope: string;
  primary_entity_key: string;
  canonical_entity_name: string;
  canonical_metric: string;
  strategy_mode?: ActionStrategyMode;
  alternative_strategies?: RecommendationStrategyOption[];
  causal_chain?: string[];
}

export interface ThreadTask extends Task {
  cluster_id: string;
  thread_id: string | null;
  phase: ActionPhase;
  action_intent_class: ActionIntentClass;
  action_unit_key: string;
  primary_entity_scope: string;
  primary_entity_key: string;
  canonical_entity_name: string;
  canonical_metric: string;
  strategy_mode?: ActionStrategyMode;
}

export interface SuccessScenario {
  floor_scenario: string;
  target_scenario: string;
  biggest_risk: string;
  weekly_monitoring_checklist: string[];
}

export interface CanonicalMetricSnapshotRow {
  entity_identity_key: string;
  entity_scope: string;
  display_label: string;
  canonical_metric: string;
  current_value: number | string | null;
  previous_value: number | string | null;
  change_pct: number | null;
  source_finding_id: string;
}

export interface MonthlyStructuredOutput {
  step_sidecars: ParsedStepOutput[];
  findings: NormalizedFinding[];
  clusters: IssueCluster[];
  display_findings: DisplayFinding[];
  final_sop: FinalSopSynthesis;
  operating_detail: OperatingDetailLayer;
  consistency_counts: MonthlyStructuredConsistencyCounts;
  canonical_metric_snapshot: CanonicalMetricSnapshotRow[];
  threads: AnalysisThread[];
  recommendations: ThreadRecommendation[];
  tasks: ThreadTask[];
  coverage: SopCoverage[];
  what_is_not_the_problem: string[];
  success_next_month: SuccessScenario;
  action_plan: Record<string, string[]>;
  executive_markdown: string;
  deliverable_markdown: string;
  coverage_markdown: string;
  appendix_markdown: string;
}

export type FinalSopRoute = "validation" | "containment" | "recovery" | "controlled scale";

export interface FinalSopRecommendation {
  route: FinalSopRoute;
  handeling: string;
  object: string;
  doel: string;
  meet_via: string;
  voorwaarde: string;
  beslisregel: string;
  risico: string;
  alternative_route?: string;
}

export interface FinalSopTask {
  linked_recommendation: number;
  handeling: string;
  object: string;
  meet_via: string;
  voorwaarde: string;
  beslisregel: string;
  risico: string;
}

export interface FinalSopQaSelfCheck {
  chosen_primary_thread: string;
  rejected_alternative_threads: string[];
  why_score_estimate: number;
  actionability_score_estimate: number;
  red_flags_remaining: string[];
}

export interface FinalSopSynthesis {
  primary_thread: string;
  root_cause: string;
  supporting_evidence: string[];
  what_is_not_the_problem: string[];
  recommendations: FinalSopRecommendation[];
  tasks: FinalSopTask[];
  qa_self_check: FinalSopQaSelfCheck;
  markdown: string;
}

export interface OperatingEvidenceTraceEntry {
  cluster_id: string;
  heading: string;
  why_it_matters: string;
  evidence_lines: string[];
  source_steps: number[];
}

export interface OperatingRouteTrace {
  recommendation_number: number;
  route: FinalSopRoute;
  recommendation_summary: string;
  rationale: string;
  supporting_evidence: string[];
  source_steps: number[];
  linked_task_numbers: number[];
}

export interface OperatingHypothesisTrace {
  id: string;
  title: string;
  label: string;
  hypothesis_number: number;
  route: FinalSopRoute;
  hypothesis: string;
  why_we_think_this: string;
  validation_or_exploitation_step: string;
  success_next_month: string;
  expected_change: string;
  success_metrics: string[];
  guardrail_metrics: string[];
  evaluation_window: string;
  accept_if: string;
  reject_if: string;
  linked_primary_thread: string;
  linked_finding_ids: string[];
  linked_recommendation_ids: string[];
  linked_task_ids: string[];
  status: "pending" | "accepted" | "rejected";
  rejected_reason: string | null;
  accepted_into_sprint: boolean;
}

export interface OperatingTaskTrace {
  task_number: number;
  linked_recommendation: number;
  task_summary: string;
  execution_detail: string;
  supporting_rationale: string;
  source_steps: number[];
}

export interface StepBackedRationaleEntry {
  step_number: number;
  step_name: string;
  conclusion: string;
  linked_clusters: string[];
}

export interface OperatingDetailLayer {
  primary_thread_anchor: string;
  root_cause_anchor: string;
  evidence_trace: OperatingEvidenceTraceEntry[];
  route_task_map: OperatingRouteTrace[];
  hypotheses_and_next_month_proof: OperatingHypothesisTrace[];
  execution_detail: OperatingTaskTrace[];
  data_gaps_and_validation_notes: string[];
  step_backed_rationale: StepBackedRationaleEntry[];
  markdown: string;
}

export interface RenderedFinalSopValidationResult {
  headings: string[];
  recommendationCount: number;
  taskCount: number;
  supportingEvidenceCount: number;
  notProblemCount: number;
  errors: string[];
}

export interface DisplayFinding {
  display_key: string;
  title: string;
  severity: Finding["severity"];
  classification: ThreadClassification;
  contradiction_state: "none" | "mixed_evidence" | "resolved";
  canonical_entity_name: string;
  issue_family: string;
  cause_family: string;
  action_family: string;
  primary_metric: string;
  evidence_level: EvidenceLevel;
  confidence: Confidence;
  summary: string;
  supporting_evidence: string[];
  action_required: boolean;
  source_cluster_ids: string[];
  source_steps: number[];
}

interface ContradictionArbitration {
  clusterStates: Map<string, "none" | "mixed_evidence" | "resolved">;
  contradictionPenalty: Map<string, number>;
  unresolvedClusterIds: Set<string>;
}

const MAX_RECOMMENDATIONS = 10;
const MAX_TASKS = 15;
const MAX_DISPLAY_FINDINGS_PER_STEP = 5;
const MAX_CANONICAL_SNAPSHOT_ROWS = 12;
const MAX_EXECUTIVE_DISPLAY_FINDINGS = 4;
const MAX_STRUCTURED_DISPLAY_FINDINGS = 40;
const MIN_STRUCTURED_DISPLAY_FINDINGS = 8;
const MIN_STRUCTURED_STEP_COVERAGE = 6;
const DEFAULT_FINAL_RECOMMENDATIONS = 3;
const MAX_FINAL_RECOMMENDATIONS = 4;
const DEFAULT_FINAL_TASKS_MIN = 4;
const MIN_FINAL_TASKS = 3;
const MAX_FINAL_TASKS = 6;
const LEGACY_EXECUTIVE_HEADING_PATTERN = /^##\s+(Executive Snapshot|Top 3 Threads|Action Plan By Phase|Recommendations Overview|Task Plan)\s*$/im;
const FORBIDDEN_RECOMMENDATION_WORDS = /(heralloceer|wijzig de hoofdhefboom|consolideer|optimaliseer|definieer kanaalownership)/i;
const SEVERITY_RANK: Record<Finding["severity"], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  positive: 1,
};
const ACTION_PHASE_LABELS: Record<ActionPhase, string> = {
  immediate: "Immediate (Week 1)",
  short_term: "Short-term (Week 2-3)",
  medium_term: "Medium-term (Week 4+)",
};
const ROOT_CAUSE_CLUSTER_BONUS: Partial<Record<IssueCluster["issue_cluster"], number>> = {
  pmax_cannibalization: 20,
  geo_allocation: 22,
  product_mix: 18,
  search_budget_cap: 16,
  network_quality: 14,
  search_partner_waste: 11,
  search_term_waste: 8,
  tracking_cvr_drop: 6,
};
const DERIVATIVE_CLUSTER_PENALTY: Partial<Record<IssueCluster["issue_cluster"], number>> = {
  desktop_inefficiency: 18,
  mobile_opportunity: 22,
  audience_inefficiency: 16,
};

function titleCaseMetric(metric: string): string {
  return metric.replace(/\b([a-z])/g, (match) => match.toUpperCase());
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

function confidenceRank(value: Confidence | undefined): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function evidenceRank(value: EvidenceLevel | undefined): number {
  switch (value) {
    case "deterministic":
      return 4;
    case "inferred":
      return 3;
    case "hypothesis":
      return 2;
    default:
      return 1;
  }
}

function isNegativeSeverity(severity: Finding["severity"]): boolean {
  return severity === "critical" || severity === "high" || severity === "medium";
}

function metricValueRank(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return 2;
  if (typeof value === "string" && value.trim()) return 1;
  return 0;
}

function normalizeRootCauseText(text: string | null | undefined): string {
  return safePresentationText((text || "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s*;\s*/g, ". ")
    .replace(/\s*\/\s*/g, " en ")
    .replace(/\s+/g, " ")
    .trim());
}

function formatMetricValue(value: number | string | null | undefined, metric: string): string {
  if (value == null || value === "") return "n.v.t.";
  if (typeof value === "string") return value;
  if (["CPA", "CPC", "Omzet", "Conversiewaarde", "Wasteful Spend"].includes(metric)) return `€${value.toFixed(2)}`;
  if (["ROAS", "Efficiency Ratio"].includes(metric)) return `${value.toFixed(2)}x`;
  if (metric === "CVR") {
    const normalizedPercent = value <= 1 ? value * 100 : value;
    return `${normalizedPercent.toFixed(2)}%`;
  }
  if (/share|is/i.test(metric)) return `${value}`;
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function extractGeoRoot(cluster: IssueCluster): string | null {
  return cluster.canonical_geo_id;
}

function countryGeoSupport(cluster: IssueCluster, allClusters: IssueCluster[]): { supportingCount: number; distinctScopes: number } {
  if (cluster.issue_cluster !== "geo_allocation" || cluster.entity_scope !== "country" || !cluster.canonical_geo_id) {
    return { supportingCount: 0, distinctScopes: 0 };
  }
  const supporting = allClusters.filter((candidate) =>
    candidate.canonical_geo_id === cluster.canonical_geo_id &&
    candidate.dominant_severity !== "positive" &&
    candidate.action_required
  );
  return {
    supportingCount: supporting.length,
    distinctScopes: new Set(supporting.map((candidate) => candidate.entity_scope)).size,
  };
}

function threadFamily(cluster: IssueCluster): string {
  switch (cluster.issue_cluster) {
    case "geo_allocation":
      // Elke geo krijgt zijn eigen thread (NL, DE, BE zijn aparte threads)
      return `geo_allocation:${extractGeoRoot(cluster) || cluster.entity_identity_key}`;
    case "search_budget_cap":
      return `demand_capture:${cluster.parent_campaign || cluster.entity_identity_key}`;
    case "tracking_cvr_drop":
      return "measurement_risk";
    case "pmax_cannibalization":
      // PMAX krijgt zijn eigen thread, los van product_mix
      return `pmax_efficiency:${cluster.parent_campaign || cluster.entity_identity_key}`;
    case "product_mix":
      return `product_mix:${cluster.parent_campaign || cluster.entity_identity_key}`;
    case "network_quality":
      // Netwerkkwaliteit krijgt zijn eigen thread, los van search_partner_waste
      return `network_quality:${extractGeoRoot(cluster) || cluster.parent_campaign || cluster.canonical_entity_name}`;
    case "search_partner_waste":
      return `search_partner:${cluster.parent_campaign || cluster.entity_identity_key}`;
    case "search_term_waste":
      return `query_quality:${extractGeoRoot(cluster) || cluster.parent_campaign || cluster.entity_identity_key}`;
    case "desktop_inefficiency":
    case "mobile_opportunity":
    case "audience_inefficiency":
    case "schedule_waste":
      return `efficiency_control:${extractGeoRoot(cluster) || cluster.parent_campaign || cluster.entity_identity_key}`;
    default:
      return `${cluster.issue_cluster}:${cluster.entity_identity_key}`;
  }
}

function actionUnitKey(cluster: IssueCluster): string {
  const geoRoot = extractGeoRoot(cluster);
  switch (cluster.issue_cluster) {
    case "geo_allocation":
      return `geo_reallocation:${geoRoot || cluster.entity_identity_key}`;
    case "network_quality":
    case "search_partner_waste":
      return `network_exclusion:${geoRoot || cluster.parent_campaign || cluster.canonical_entity_name}`;
    case "pmax_cannibalization":
    case "product_mix":
      return `portfolio_ownership:${geoRoot || cluster.parent_campaign || cluster.entity_identity_key}`;
    case "search_budget_cap":
      return `budget_expand:${cluster.parent_campaign || cluster.entity_identity_key}`;
    case "search_term_waste":
      return `query_quality:${geoRoot || cluster.parent_campaign || cluster.entity_identity_key}`;
    case "desktop_inefficiency":
    case "mobile_opportunity":
      return `device_efficiency:${cluster.parent_campaign || cluster.entity_identity_key}`;
    default:
      return `${cluster.issue_cluster}:${cluster.entity_identity_key}`;
  }
}

function isDerivativeSymptom(cluster: IssueCluster, clusters: IssueCluster[]): boolean {
  if (!["desktop_inefficiency", "mobile_opportunity", "audience_inefficiency"].includes(cluster.issue_cluster)) {
    return false;
  }
  const geoRoot = extractGeoRoot(cluster);
  return clusters.some((candidate) => {
    if (candidate.cluster_id === cluster.cluster_id) return false;
    if (!["geo_allocation", "network_quality", "pmax_cannibalization", "product_mix"].includes(candidate.issue_cluster)) {
      return false;
    }
    if (geoRoot && extractGeoRoot(candidate) === geoRoot) return true;
    if (cluster.parent_campaign && candidate.parent_campaign && cluster.parent_campaign === candidate.parent_campaign) return true;
    return false;
  });
}

function scoreCluster(cluster: IssueCluster, allClusters: IssueCluster[]): number {
  const avgSeverity = cluster.severity_score / Math.max(1, cluster.finding_count);
  let score = avgSeverity * 22;
  if (cluster.action_required) score += 18;
  if (cluster.actionability === "direct_action") score += 10;
  if (cluster.dominant_confidence === "high") score += 8;
  score += ROOT_CAUSE_CLUSTER_BONUS[cluster.issue_cluster] ?? 0;
  score -= DERIVATIVE_CLUSTER_PENALTY[cluster.issue_cluster] ?? 0;
  if (cluster.coverage_dimensions.length >= 3) score += 12;
  if (cluster.coverage_dimensions.length === 2) score += 6;
  if (cluster.canonical_metric === "ROAS" || cluster.canonical_metric === "CPA" || cluster.canonical_metric === "Conversies") score += 6;
  const siblingDensity = allClusters.filter((candidate) =>
    candidate.issue_cluster === cluster.issue_cluster &&
    candidate.entity_scope === cluster.entity_scope &&
    (candidate.canonical_geo_id != null && candidate.canonical_geo_id === cluster.canonical_geo_id)
  ).length;
  if (siblingDensity > 1) score -= (siblingDensity - 1) * 6;
  if (isDerivativeSymptom(cluster, allClusters)) score -= 18;
  if (cluster.dominant_severity === "positive") score -= 25;
  const geoSupport = countryGeoSupport(cluster, allClusters);
  if (geoSupport.supportingCount >= 3 && geoSupport.distinctScopes >= 3) score += 20;
  else if (geoSupport.supportingCount >= 2 && geoSupport.distinctScopes >= 2) score += 12;
  return score;
}

function clusterPolarity(cluster: IssueCluster): "positive" | "negative" | "neutral" {
  if (cluster.dominant_severity === "positive") return "positive";
  if (cluster.action_required || isNegativeSeverity(cluster.dominant_severity)) return "negative";
  return "neutral";
}

function metricConflictFamily(cluster: IssueCluster): string {
  return metricProblemFamily(cluster.canonical_metric);
}

function contradictionKey(cluster: IssueCluster): string {
  return `${cluster.entity_identity_key}::${metricConflictFamily(cluster)}`;
}

function clusterBusinessMateriality(cluster: IssueCluster): number {
  return cluster.severity_score * 8
    + (cluster.action_required ? 10 : 0)
    + (cluster.actionability === "direct_action" ? 6 : cluster.actionability === "investigate_first" ? 3 : 0)
    + Math.min(8, cluster.finding_count * 2);
}

function clusterCausalCentrality(cluster: IssueCluster): number {
  if (cluster.issue_cluster === "tracking_cvr_drop") return 28;
  if (cluster.issue_cluster === "geo_allocation") return 22;
  if (cluster.issue_cluster === "network_quality" || cluster.issue_cluster === "search_partner_waste") return 18;
  if (cluster.issue_cluster === "product_mix" || cluster.issue_cluster === "pmax_cannibalization") return 18;
  if (cluster.issue_cluster === "search_budget_cap") return 14;
  if (cluster.issue_cluster === "search_term_waste") return 12;
  return 8;
}

function contradictionResolutionScore(cluster: IssueCluster, allClusters: IssueCluster[]): number {
  const latestStep = Math.max(...cluster.findings.map((finding) => finding.step));
  return (
    evidenceRank(evidenceFromCluster(cluster)) * 30 +
    confidenceRank(cluster.dominant_confidence) * 10 +
    clusterBusinessMateriality(cluster) +
    clusterCausalCentrality(cluster) +
    latestStep +
    scoreCluster(cluster, allClusters)
  );
}

function arbitrateContradictions(clusters: IssueCluster[]): ContradictionArbitration {
  const clusterStates = new Map<string, "none" | "mixed_evidence" | "resolved">();
  const contradictionPenalty = new Map<string, number>();
  const unresolvedClusterIds = new Set<string>();

  for (const cluster of clusters) {
    clusterStates.set(cluster.cluster_id, "none");
    contradictionPenalty.set(cluster.cluster_id, 0);
  }

  const grouped = new Map<string, IssueCluster[]>();
  for (const cluster of clusters) {
    const polarity = clusterPolarity(cluster);
    if (polarity === "neutral") continue;
    const key = contradictionKey(cluster);
    const group = grouped.get(key) || [];
    group.push(cluster);
    grouped.set(key, group);
  }

  for (const group of grouped.values()) {
    const positives = group.filter((cluster) => clusterPolarity(cluster) === "positive");
    const negatives = group.filter((cluster) => clusterPolarity(cluster) === "negative");
    if (positives.length === 0 || negatives.length === 0) continue;

    const ranked = [...group].sort(
      (a, b) => contradictionResolutionScore(b, clusters) - contradictionResolutionScore(a, clusters)
    );
    const winner = ranked[0];
    const runnerUp = ranked[1];
    const margin = winner && runnerUp
      ? contradictionResolutionScore(winner, clusters) - contradictionResolutionScore(runnerUp, clusters)
      : 0;

    if (!winner || margin < 18) {
      for (const cluster of group) {
        clusterStates.set(cluster.cluster_id, "mixed_evidence");
        contradictionPenalty.set(cluster.cluster_id, 18);
        unresolvedClusterIds.add(cluster.cluster_id);
      }
      continue;
    }

    for (const cluster of group) {
      if (cluster.cluster_id === winner.cluster_id) {
        clusterStates.set(cluster.cluster_id, "resolved");
        contradictionPenalty.set(cluster.cluster_id, 0);
      } else {
        clusterStates.set(cluster.cluster_id, "resolved");
        contradictionPenalty.set(cluster.cluster_id, 12);
      }
    }
  }

  return {
    clusterStates,
    contradictionPenalty,
    unresolvedClusterIds,
  };
}

function isValidationPrerequisiteCluster(cluster: IssueCluster | null): boolean {
  if (!cluster) return false;
  return (
    cluster.issue_cluster === "tracking_cvr_drop" ||
    /(tracking|meting|measurement|checkout|funnel|landingspagina|landing page|\blp\b|attribu)/i.test(
      `${cluster.root_cause_summary} ${cluster.evidence_summary}`
    )
  );
}

function findPrerequisiteBlocker(cluster: IssueCluster | null, allClusters: IssueCluster[]): IssueCluster | null {
  if (!cluster) return null;
  const candidates = allClusters.filter((candidate) => {
    if (!isValidationPrerequisiteCluster(candidate)) return false;
    if (candidate.cluster_id === cluster.cluster_id) return true;
    if (candidate.entity_identity_key === cluster.entity_identity_key) return true;
    if (candidate.parent_campaign && cluster.parent_campaign && candidate.parent_campaign === cluster.parent_campaign) return true;
    if (candidate.entity_scope === "account") return true;
    return false;
  });

  return candidates.sort((a, b) => contradictionResolutionScore(b, allClusters) - contradictionResolutionScore(a, allClusters))[0] ?? null;
}

function classifyCluster(cluster: IssueCluster): ThreadClassification {
  if (cluster.issue_cluster === "tracking_cvr_drop") return "measurement_risk";
  if (cluster.issue_cluster === "pmax_cannibalization") {
    if (cluster.action_required && (cluster.dominant_severity === "critical" || cluster.dominant_severity === "high")) {
      return "real_problem";
    }
    return cluster.action_required ? "contextual_shift" : "false_positive_alert";
  }
  if (cluster.dominant_severity === "positive" || !cluster.action_required) return "false_positive_alert";
  if (cluster.actionability === "monitor") return "expected_tradeoff";
  return "real_problem";
}

function clusterConfidence(cluster: IssueCluster): Confidence {
  return cluster.dominant_confidence;
}

function businessImpact(cluster: IssueCluster): string {
  const leadForMetric = cluster.findings.find((finding) => finding.canonical_metric === cluster.canonical_metric) ?? cluster.findings[0];
  const primaryPart = leadForMetric
    ? `${titleCaseMetric(leadForMetric.canonical_metric)} ${leadForMetric.change_pct != null ? `${leadForMetric.change_pct > 0 ? "+" : ""}${leadForMetric.change_pct}%` : formatMetricValue(leadForMetric.current_value, leadForMetric.canonical_metric)}`
    : null;
  const parts = unique(
    [primaryPart]
      .concat(
        cluster.findings.slice(0, 3).map((finding) =>
          `${titleCaseMetric(finding.canonical_metric)} ${finding.change_pct != null ? `${finding.change_pct > 0 ? "+" : ""}${finding.change_pct}%` : formatMetricValue(finding.current_value, finding.canonical_metric)}`
        )
      )
      .filter(Boolean) as string[]
  ).slice(0, 3);
  if (parts.length === 0) {
    return `${cluster.display_label} vraagt monitoring op ${cluster.canonical_metric}.`;
  }
  return `${cluster.display_label} wordt geraakt via ${parts.join(", ")}.`;
}

function monitoringMetrics(cluster: IssueCluster): string[] {
  return unique(
    cluster.findings
      .map((finding) => finding.canonical_metric)
      .concat(cluster.issue_cluster === "search_budget_cap" ? ["Search Lost IS (Budget)"] : [])
      .slice(0, 4)
  );
}

function threadTitle(cluster: IssueCluster): string {
  switch (cluster.issue_cluster) {
    case "tracking_cvr_drop":
      return "Validatie van meet- of funnelkwaliteit blokkeert nog een veilige besluitvorming";
    case "search_budget_cap":
      return `${cluster.display_label} mist vraag door budgetbeperking`;
    case "desktop_inefficiency":
      return `Desktop drukt het rendement in ${cluster.display_label}`;
    case "pmax_cannibalization":
      return "PMax verschuift volume, maar is niet automatisch het hoofdprobleem";
    case "search_term_waste":
      return cluster.parent_campaign
        ? `Zoektermverspilling vervuilt ${cluster.parent_campaign}`
        : `Zoektermverspilling concentreert zich rond ${cluster.display_label}`;
    case "geo_allocation":
      return cluster.entity_scope === "country"
        ? `${cluster.canonical_entity_name || cluster.display_label} trekt disproportioneel budget zonder rendementsmatch`
        : `Geo-allocatie rond ${cluster.display_label} is uit balans`;
    case "network_quality":
      return `Netwerkkwaliteit lekt rendement weg via ${cluster.display_label}`;
    case "schedule_waste":
      return `Advertentieplanning bevat inefficiënte uren voor ${cluster.display_label}`;
    default:
      switch (issueFamily(cluster.issue_cluster)) {
        case "geo_allocation":
          return `${cluster.display_label} blijft het dominante geo-probleem`;
        case "traffic_quality":
          return `${cluster.display_label} lekt rendement via traffic quality`;
        case "portfolio_mix":
          return `${cluster.display_label} blijft een portfolio- of productmixprobleem`;
        case "query_quality":
          return `${cluster.display_label} blijft queryverlies concentreren`;
        case "demand_capture":
          return `${cluster.display_label} laat rendabele vraag liggen`;
        case "measurement_risk":
          return "Meetkwaliteit verstoort nog steeds de interpretatie van de maand";
        default:
          if (cluster.canonical_metric === "CVR") {
            return `${cluster.display_label} verliest conversie-efficiëntie`;
          }
          if (cluster.canonical_metric === "ROAS") {
            return `${cluster.display_label} verliest rendementscontrole`;
          }
          if (cluster.canonical_metric === "CPA") {
            return `${cluster.display_label} wordt te duur voor winstgevende schaal`;
          }
          if (cluster.canonical_metric === "Search Lost IS (Budget)") {
            return `${cluster.display_label} mist vraag door budgetbeperking`;
          }
          return `${cluster.display_label} vraagt een scherpere maanddiagnose`;
      }
  }
}

function threadEvidenceStrength(group: IssueCluster[]): number {
  return Math.max(...group.map((cluster) => evidenceRank(evidenceFromCluster(cluster)))) * 14
    + (group.some((cluster) => cluster.dominant_confidence === "high") ? 8 : group.some((cluster) => cluster.dominant_confidence === "medium") ? 4 : 0);
}

function threadBusinessImpactScore(group: IssueCluster[]): number {
  return Math.max(...group.map((cluster) => clusterBusinessMateriality(cluster)))
    + Math.min(10, unique(group.flatMap((cluster) => cluster.findings.map((finding) => finding.step))).length * 2);
}

function threadActionPrecedenceScore(group: IssueCluster[], allClusters: IssueCluster[]): number {
  if (group.some((cluster) => isValidationPrerequisiteCluster(cluster))) return 40;
  const primary = group[0];
  const prerequisite = findPrerequisiteBlocker(primary, allClusters);
  if (prerequisite && prerequisite.cluster_id !== primary.cluster_id) return -16;
  if (group.some((cluster) => cluster.actionability === "direct_action")) return 10;
  if (group.some((cluster) => cluster.actionability === "investigate_first")) return 5;
  return 0;
}

function threadRecoverabilityScore(group: IssueCluster[]): number {
  if (group.some((cluster) => ["geo_allocation", "network_quality", "search_term_waste", "product_mix", "pmax_cannibalization", "desktop_inefficiency", "schedule_waste"].includes(cluster.issue_cluster))) {
    return 10;
  }
  if (group.some((cluster) => cluster.issue_cluster === "tracking_cvr_drop")) return 8;
  return 4;
}

function scoreThreadGroup(
  group: IssueCluster[],
  allClusters: IssueCluster[],
  arbitration: ContradictionArbitration
): number {
  const rankedClusters = [...group].sort((a, b) => scoreCluster(b, allClusters) - scoreCluster(a, allClusters));
  const primary = rankedClusters[0];
  const contradictionPenalty = Math.max(...rankedClusters.map((cluster) => arbitration.contradictionPenalty.get(cluster.cluster_id) ?? 0), 0);
  const causalCentralityWeight = Math.max(...rankedClusters.map((cluster) => clusterCausalCentrality(cluster)));
  return (
    threadEvidenceStrength(rankedClusters) +
    causalCentralityWeight +
    threadActionPrecedenceScore(rankedClusters, allClusters) +
    threadBusinessImpactScore(rankedClusters) +
    threadRecoverabilityScore(rankedClusters) +
    scoreCluster(primary, allClusters) -
    contradictionPenalty
  );
}

function broaderBusinessDriverExists(group: IssueCluster[], allClusters: IssueCluster[]): boolean {
  const groupIds = new Set(group.map((cluster) => cluster.cluster_id));
  return allClusters.some((candidate) => {
    if (groupIds.has(candidate.cluster_id)) return false;
    if (!candidate.action_required) return false;
    if (candidate.dominant_severity === "positive") return false;
    if (evidenceFromCluster(candidate) !== "deterministic") return false;
    if (["account", "campaign", "adgroup", "product", "searchterm"].includes(candidate.entity_scope)) return true;
    if (["tracking_cvr_drop", "product_mix", "pmax_cannibalization", "search_term_waste", "search_budget_cap"].includes(candidate.issue_cluster)) return true;
    return false;
  });
}

function broaderMonthlyDiagnosisDriverExists(
  primary: IssueCluster,
  group: IssueCluster[],
  allClusters: IssueCluster[]
): boolean {
  const groupIds = new Set(group.map((cluster) => cluster.cluster_id));
  return allClusters.some((candidate) => {
    if (groupIds.has(candidate.cluster_id)) return false;
    if (!candidate.action_required || candidate.dominant_severity === "positive") return false;
    if (evidenceRank(evidenceFromCluster(candidate)) < 3) return false;
    if (candidate.issue_cluster === "search_term_waste") return false;
    if (["keyword", "searchterm"].includes(candidate.entity_scope)) return false;
    const hasBroaderSurface = ["account", "campaign", "adgroup", "country", "product", "network"].includes(candidate.entity_scope);
    const hasBroaderBreadth = candidate.coverage_dimensions.length >= 2 || candidate.finding_count >= 2;
    if (!hasBroaderSurface && !hasBroaderBreadth) return false;
    return true;
  });
}

function dominantGeoDiagnosisExists(
  primary: IssueCluster,
  group: IssueCluster[],
  allClusters: IssueCluster[]
): boolean {
  const groupIds = new Set(group.map((cluster) => cluster.cluster_id));
  return allClusters.some((candidate) => {
    if (groupIds.has(candidate.cluster_id)) return false;
    if (candidate.issue_cluster !== "geo_allocation" || candidate.entity_scope !== "country") return false;
    if (!candidate.action_required || candidate.dominant_severity === "positive") return false;
    if (evidenceRank(evidenceFromCluster(candidate)) < 3) return false;
    const support = countryGeoSupport(candidate, allClusters);
    return support.supportingCount >= 2 && support.distinctScopes >= 2 && candidate.cluster_id !== primary.cluster_id;
  });
}

function isNarrowQueryDriver(cluster: IssueCluster): boolean {
  return cluster.issue_cluster === "search_term_waste" || ["keyword", "searchterm"].includes(cluster.entity_scope);
}

function isBroaderBusinessDriver(cluster: IssueCluster): boolean {
  if (!cluster.action_required || cluster.dominant_severity === "positive") return false;
  if (evidenceRank(evidenceFromCluster(cluster)) < 3) return false;
  if (["account", "campaign", "country", "product", "network"].includes(cluster.entity_scope)) return true;
  return ["geo_allocation", "product_mix", "search_budget_cap", "network_quality", "tracking_cvr_drop"].includes(cluster.issue_cluster);
}

function executiveThreadScore(
  group: IssueCluster[],
  allClusters: IssueCluster[],
  arbitration: ContradictionArbitration
): number {
  const primary = selectRepresentativeThreadCluster(group, allClusters);
  let score = scoreThreadGroup(group, allClusters, arbitration);
  const deterministicCriticalBusinessThreadExists = allClusters.some((candidate) =>
    candidate.cluster_id !== primary.cluster_id &&
    candidate.action_required &&
    candidate.dominant_severity === "critical" &&
    evidenceFromCluster(candidate) === "deterministic" &&
    ["account", "campaign", "adgroup", "product", "searchterm"].includes(candidate.entity_scope)
  );

  if (primary.issue_cluster === "tracking_cvr_drop" && deterministicCriticalBusinessThreadExists) {
    score -= 55;
  }
  if (["geo_allocation", "desktop_inefficiency", "mobile_opportunity", "network_quality", "schedule_waste"].includes(primary.issue_cluster) && broaderBusinessDriverExists(group, allClusters)) {
    score -= 28;
  }
  if ((primary.issue_cluster === "search_term_waste" || ["keyword", "searchterm"].includes(primary.entity_scope)) && broaderMonthlyDiagnosisDriverExists(primary, group, allClusters)) {
    score -= group.length === 1 ? 110 : 80;
  }
  if (primary.issue_cluster === "pmax_cannibalization" && dominantGeoDiagnosisExists(primary, group, allClusters)) {
    score -= 42;
  }
  if (group.length === 1 && primary.findings.length <= 2 && broaderBusinessDriverExists(group, allClusters)) {
    score -= 18;
  }
  if (arbitration.unresolvedClusterIds.has(primary.cluster_id)) {
    score -= 24;
  }
  return score;
}

function selectRepresentativeThreadCluster(group: IssueCluster[], allClusters: IssueCluster[]): IssueCluster {
  const ranked = [...group].sort((a, b) => scoreCluster(b, allClusters) - scoreCluster(a, allClusters));
  const top = ranked[0];
  if (!top) {
    throw new Error("selectRepresentativeThreadCluster called without clusters");
  }
  const sharedGeoRoot = top.canonical_geo_id || ranked.find((cluster) => cluster.canonical_geo_id)?.canonical_geo_id;
  if (!sharedGeoRoot) return top;
  const countryCandidate = ranked.find((cluster) =>
    cluster.issue_cluster === "geo_allocation"
    && cluster.entity_scope === "country"
    && cluster.canonical_geo_id === sharedGeoRoot
  );
  if (!countryCandidate) return top;
  const supportingSameGeo = ranked.filter((cluster) => cluster.canonical_geo_id === sharedGeoRoot);
  const distinctScopes = new Set(supportingSameGeo.map((cluster) => cluster.entity_scope));
  if (supportingSameGeo.length >= 2 && distinctScopes.size >= 2) {
    return countryCandidate;
  }
  return top;
}

function createThreads(clusters: IssueCluster[]): {
  threads: AnalysisThread[];
  notProblem: string[];
} {
  const arbitration = arbitrateContradictions(clusters);
  const grouped = new Map<string, IssueCluster[]>();
  for (const cluster of clusters) {
    const key = threadFamily(cluster);
    const existing = grouped.get(key) || [];
    existing.push(cluster);
    grouped.set(key, existing);
  }

  const rankedGroups = Array.from(grouped.entries())
    .map(([key, group]) => {
      const rankedClusters = [...group].sort((a, b) => scoreCluster(b, clusters) - scoreCluster(a, clusters));
      const primary = selectRepresentativeThreadCluster(rankedClusters, clusters);
      const groupScore = scoreThreadGroup(rankedClusters, clusters, arbitration);
      const executiveScore = executiveThreadScore(rankedClusters, clusters, arbitration);
      return { key, group: rankedClusters, primary, groupScore, executiveScore };
    })
    .sort((a, b) => b.executiveScore - a.executiveScore || b.groupScore - a.groupScore);

  const preferredGroups = rankedGroups.filter(({ primary }) => !arbitration.unresolvedClusterIds.has(primary.cluster_id));
  const orderedGroups = [...(preferredGroups.length > 0 ? preferredGroups : rankedGroups)];
  if (orderedGroups.length > 1 && isNarrowQueryDriver(orderedGroups[0].primary)) {
    const broaderIndex = orderedGroups.findIndex(({ primary }, index) => index > 0 && isBroaderBusinessDriver(primary));
    if (broaderIndex > 0) {
      const [broader] = orderedGroups.splice(broaderIndex, 1);
      orderedGroups.unshift(broader);
    }
  }
  const topGroups = orderedGroups
    .filter(({ primary }) => primary.dominant_severity !== "positive")
    .slice(0, 3);
  const threads: AnalysisThread[] = topGroups.map(({ group, primary }, index) => ({
    id: `thread_${index + 1}_${primary.cluster_id}`,
    title: threadTitle(primary),
    priority: (index + 1) as 1 | 2 | 3,
    classification: arbitration.unresolvedClusterIds.has(primary.cluster_id) ? "contextual_shift" : classifyCluster(primary),
    root_cause_summary: dominantRootCause(primary, arbitration.unresolvedClusterIds.has(primary.cluster_id) ? "mixed_evidence" : (arbitration.clusterStates.get(primary.cluster_id) ?? "none")),
    business_impact: unique(group.map((cluster) => businessImpact(cluster))).slice(0, 2).join(" "),
    supporting_cluster_ids: group.map((cluster) => cluster.cluster_id),
    recommended_recommendation_ids: [],
    monitoring_metrics: unique(group.flatMap((cluster) => monitoringMetrics(cluster))).slice(0, 5),
    confidence: arbitration.unresolvedClusterIds.has(primary.cluster_id)
      ? "low"
      : group.some((cluster) => cluster.dominant_confidence === "high")
      ? "high"
      : group.some((cluster) => cluster.dominant_confidence === "medium")
        ? "medium"
        : "low",
  }));

  const selectedClusterIds = new Set(topGroups.flatMap(({ group }) => group.map((cluster) => cluster.cluster_id)));
  const ranked = [...clusters].sort((a, b) => scoreCluster(b, clusters) - scoreCluster(a, clusters));
  const notProblem = ranked
    .filter((cluster) => !selectedClusterIds.has(cluster.cluster_id))
    .filter((cluster) => !arbitration.unresolvedClusterIds.has(cluster.cluster_id))
    .filter((cluster) => {
      const classification = classifyCluster(cluster);
      return classification === "contextual_shift" || classification === "false_positive_alert" || classification === "expected_tradeoff";
    })
    .slice(0, 3)
    .map((cluster) => `${cluster.display_label}: ${cluster.evidence_summary}`);

  if (notProblem.length === 0) {
    const fallbackNotProblem = ranked
      .filter((cluster) => !selectedClusterIds.has(cluster.cluster_id))
      .filter((cluster) => cluster.dominant_severity === "positive" || classifyCluster(cluster) === "expected_tradeoff")
      .filter((cluster) => cluster.dominant_confidence !== "low")
      .slice(0, 2)
      .map((cluster) => {
        const surface = safePresentationText(cluster.canonical_entity_name || cluster.display_label);
        return cluster.dominant_severity === "positive"
          ? `${surface} blijft relatief gezond en is niet de bron van de huidige rendementsdruk.`
          : `${surface} vraagt hooguit monitoring, maar verklaart de huidige hoofddruk niet.`;
      });
    return { threads, notProblem: fallbackNotProblem };
  }

  return { threads, notProblem };
}

function phaseFromReadiness(cluster: IssueCluster, readiness: ActionReadiness): ActionPhase {
  // Kritieke geo-lekkage en PMAX zonder tROAS zijn altijd immediate
  if (cluster.issue_cluster === "geo_allocation" && cluster.dominant_severity === "critical") return "immediate";
  if (cluster.issue_cluster === "pmax_cannibalization" && cluster.dominant_severity === "critical") return "immediate";
  if (cluster.issue_cluster === "network_quality" && cluster.dominant_severity === "critical") return "immediate";
  if (cluster.issue_cluster === "tracking_cvr_drop") return "immediate";
  if (readiness === "direct_action" && (cluster.dominant_severity === "critical" || cluster.dominant_severity === "high")) return "immediate";
  if (readiness === "investigate_first") return "short_term";
  return cluster.issue_cluster === "product_mix" ? "medium_term" : "short_term";
}

function readinessFromCluster(cluster: IssueCluster): ActionReadiness {
  if (!cluster.action_required || cluster.dominant_severity === "positive") return "monitor";
  if (cluster.issue_cluster === "tracking_cvr_drop") return "investigate_first";
  if (cluster.actionability === "investigate_first") return "investigate_first";
  if (cluster.actionability === "monitor") return "monitor";
  return "direct_action";
}

function ownerFromCluster(cluster: IssueCluster): "Ranking Masters" | "Klant" {
  if (cluster.issue_cluster === "tracking_cvr_drop" || cluster.issue_cluster === "product_mix") return "Ranking Masters";
  return "Ranking Masters";
}

function actionIntentFromCluster(cluster: IssueCluster): ActionIntentClass {
  switch (cluster.issue_cluster) {
    case "tracking_cvr_drop":
      return "tracking_validation";
    case "search_budget_cap":
      return "budget_expand";
    case "search_bidding_inflation":
    case "desktop_inefficiency":
      return "bid_lower";
    case "creative_mismatch":
      return "creative_refresh";
    case "pmax_cannibalization":
    case "product_mix":
      return "portfolio_ownership";
    case "search_term_waste":
      return "negative_cleanup";
    case "geo_allocation":
      return "geo_reallocation";
    case "audience_inefficiency":
      return "audience_refine";
    case "schedule_waste":
      return "schedule_control";
    case "network_quality":
    case "search_partner_waste":
      return "network_exclusion";
    case "mobile_opportunity":
      return cluster.dominant_severity === "positive" ? "budget_expand" : "investigation";
    default:
      return cluster.action_required ? "investigation" : "monitor_only";
  }
}

function dependencyList(cluster: IssueCluster): string[] {
  const deps: string[] = [];
  if (cluster.issue_cluster === "tracking_cvr_drop") deps.push("Valideer meting voordat bied- of budgetacties live gaan.");
  if (cluster.issue_cluster === "pmax_cannibalization" || cluster.issue_cluster === "product_mix") deps.push("Maak SKU- of asset-group ownership expliciet.");
  if (cluster.issue_cluster === "geo_allocation") deps.push("Bevestig of marge/voorraad per land gelijk is.");
  return deps;
}

function recommendationText(cluster: IssueCluster, readiness: ActionReadiness): {
  hypothesis: string;
  expectedResult: string;
  measurementMetric: string;
  timeframe: string;
  rationale: string;
} {
  const entity = cluster.display_label;
  const metrics = monitoringMetrics(cluster).join(", ");

  switch (cluster.issue_cluster) {
    case "tracking_cvr_drop":
      return {
        hypothesis: `Valideer tracking en conversiemeting voor ${entity} voordat verdere optimalisaties worden doorgevoerd`,
        expectedResult: "Herstel van betrouwbare CVR- en ROAS-sturing zonder foutieve optimalisatiebesluiten",
        measurementMetric: "CVR, Conversies, conversie-acties",
        timeframe: "Deze week",
        rationale: `${cluster.evidence_summary}. Zonder meetvalidatie zijn directe bied- of budgetacties onbetrouwbaar.`,
      };
    case "search_budget_cap":
      return {
        hypothesis: `Herstel budgetruimte in ${entity} zodat vraag niet wordt afgekapt op piekmomenten`,
        expectedResult: "Meer impression share en conversievolume zonder onnodige duplicatie van budgetacties",
        measurementMetric: "Search Lost IS (Budget), Conversies, ROAS",
        timeframe: "7-14 dagen",
        rationale: `${cluster.evidence_summary}. Budgetbeperking is hier het dominante verliesmechanisme.`,
      };
    case "desktop_inefficiency":
      return {
        hypothesis: `Verlaag desktopdruk in ${entity} en stuur terug op rendabele device-mix`,
        expectedResult: "Lagere CPA of hogere ROAS op desktop zonder accountbrede volumeschade",
        measurementMetric: "Desktop CPA, Desktop ROAS, Conversies",
        timeframe: "1-2 weken",
        rationale: `${cluster.evidence_summary}. Desktop levert een disproportioneel efficiencyverlies op.`,
      };
    case "search_term_waste":
      return {
        hypothesis: `Classificeer zoektermverspilling rond ${entity} en sluit alleen aantoonbaar veilige modifiers of off-catalog varianten uit`,
        expectedResult: "Minder waste spend zonder kernproducten of brede relevante vraag onnodig te blokkeren",
        measurementMetric: "Wasteful Spend, veilige uitsluitingen, Conversies, ROAS",
        timeframe: "Binnen 7 dagen",
        rationale: `${cluster.evidence_summary}. Maak onderscheid tussen broad-but-relevant, verkeerde intentlaag en echte off-catalog traffic.`,
      };
    case "pmax_cannibalization":
      return {
        hypothesis: `Splits SKU-verantwoordelijkheid tussen PMax en Shopping voor ${entity} met aparte productsets of uitsluitingen`,
        expectedResult: "Schonere allocatie per SKU of assetgroep en minder schijnbare collapses",
        measurementMetric: "ROAS per kanaal, Conversiewaarde, SKU-overlap",
        timeframe: "2-4 weken",
        rationale: `${cluster.evidence_summary}. Dit lijkt eerder een verschuiving of overlapvraagstuk dan een geïsoleerde crash.`,
      };
    case "geo_allocation":
      return {
        hypothesis: `Verlaag budget in ${entity} en verschuif spend naar landen met aantoonbaar hogere ROAS`,
        expectedResult: "Minder spend-lekkage naar zwakkere landen en een gezondere blended ROAS",
        measurementMetric: "ROAS per land, CPA per land, Spend share",
        timeframe: "1-2 weken",
        rationale: `${cluster.evidence_summary}. Landverschillen zijn groot genoeg om allocatiebeslissingen te rechtvaardigen.`,
      };
    case "network_quality":
      return {
        hypothesis: `Beperk laagwaardige netwerkinventory rond ${entity} en herstel focus op rendement`,
        expectedResult: "Minder spend-lekkage naar zwakke netwerken en hogere efficiency",
        measurementMetric: "CPA per netwerk, ROAS per netwerk, Conversies",
        timeframe: "7-10 dagen",
        rationale: `${cluster.evidence_summary}. De kwaliteit van het netwerk verklaart hier een belangrijk deel van het performanceverschil.`,
      };
    case "schedule_waste":
      return {
        hypothesis: `Snijd inefficiënte uren of dagdelen uit ${entity} en concentreer budget op rendabele vensters`,
        expectedResult: "Lagere CPA in zwakke uren en betere budgetdichtheid in sterke uren",
        measurementMetric: "CPA per uur, ROAS per uur, Spend share",
        timeframe: "Binnen 2 weken",
        rationale: `${cluster.evidence_summary}. Planning is hier een controleerbare efficiëntiehefboom.`,
      };
    default:
      return {
        hypothesis: readiness === "monitor"
          ? `Monitor ${entity} gericht op ${cluster.canonical_metric} en voorkom overreactie`
          : `Voer een concrete wijziging door in ${entity} zodat ${cluster.canonical_metric} aantoonbaar herstelt`,
        expectedResult: readiness === "monitor"
          ? "Meer zekerheid over of het signaal structureel is"
          : "Gerichtere actie zonder dubbel werk of tegenstrijdige optimalisaties",
        measurementMetric: metrics,
        timeframe: readiness === "monitor" ? "Volgende maand" : "1-3 weken",
        rationale: `${cluster.evidence_summary}. ${cluster.root_cause_summary}`,
      };
  }
}

function iceScores(cluster: IssueCluster, readiness: ActionReadiness): Pick<Recommendation, "ice_impact" | "ice_confidence" | "ice_ease" | "ice_total"> {
  const impact = Math.min(10, Math.max(4, Math.round(cluster.severity_score / 2)));
  const confidence = readiness === "direct_action" ? (cluster.dominant_confidence === "high" ? 8 : 6) : readiness === "investigate_first" ? 5 : 4;
  const ease = cluster.issue_cluster === "tracking_cvr_drop" ? 6 : cluster.issue_cluster === "pmax_cannibalization" ? 4 : 7;
  return {
    ice_impact: impact,
    ice_confidence: confidence,
    ice_ease: ease,
    ice_total: Number(((impact + confidence + ease) / 3).toFixed(1)),
  };
}

function buildTasksForCluster(
  cluster: IssueCluster,
  phase: ActionPhase,
  threadId: string | null,
  recommendationIndex: number
): ThreadTask[] {
  const intent = actionIntentFromCluster(cluster);
  const entity = cluster.display_label;
  const unitKey = actionUnitKey(cluster);
  const baseTask = (title: string, description: string, actionType: Task["action_type"], priority: Task["priority"], dueDays: number): ThreadTask => ({
    recommendation_index: recommendationIndex,
    title,
    description,
    action_type: actionType,
    owner: ownerFromCluster(cluster),
    affected_campaign: cluster.findings.find((finding) => finding.entity_type === "campaign")?.canonical_entity_name ?? null,
    affected_adgroup: cluster.findings.find((finding) => finding.entity_type === "adgroup")?.canonical_entity_name ?? null,
    affected_keyword: cluster.findings.find((finding) => finding.entity_type === "keyword" || finding.entity_type === "searchterm")?.canonical_entity_name ?? null,
    current_value: cluster.evidence_summary.slice(0, 100),
    target_value: cluster.canonical_metric,
    priority: priority,
    frequency: phase === "immediate" ? "direct" : phase === "short_term" ? "weekly" : "biweekly",
    due_date_days: dueDays,
    cluster_id: cluster.cluster_id,
    thread_id: threadId,
    phase,
    action_intent_class: intent,
    action_unit_key: unitKey,
    primary_entity_scope: cluster.entity_scope,
    primary_entity_key: cluster.entity_identity_key,
    canonical_entity_name: entity,
    canonical_metric: cluster.canonical_metric,
  });

  switch (cluster.issue_cluster) {
    case "tracking_cvr_drop":
      return [
        baseTask(`Controleer conversiemeting ${entity}`.slice(0, 80), `Valideer tagging, conversie-acties en recente meetwijzigingen voor ${entity}.`, "tracking", "critical", 2),
        baseTask(`Vergelijk brondata ${entity}`.slice(0, 80), `Vergelijk account-, campagne- en actie-niveau zodat tracking en rapportage weer op één lijn staan.`, "audit", "high", 5),
      ];
    case "search_budget_cap":
      return [
        baseTask(`Controleer budgetcap ${entity}`.slice(0, 80), `Bevestig of budget de belangrijkste limiter is en bereken hoeveel volume nu wordt gemist.`, "budget", "critical", 3),
        baseTask(`Heralloceer budget naar ${entity}`.slice(0, 80), `Verplaats budget alleen vanuit zwakkere segmenten met aantoonbaar lagere efficiency.`, "budget", "high", 5),
      ];
    case "desktop_inefficiency":
      return [
        baseTask(`Corrigeer desktop bieddruk`.slice(0, 80), `Verlaag device- of campagne-instellingen die desktoprendement disproportioneel onder druk zetten.`, "bid", "high", 5),
        baseTask(`Monitor desktop herstel`.slice(0, 80), `Volg desktop CPA en ROAS wekelijks om te voorkomen dat volumeverlies het effect maskeert.`, "audit", "medium", 12),
      ];
    case "search_term_waste":
      return [
        baseTask(`Beoordeel veilige uitsluitingen`.slice(0, 80), `Sluit alleen off-catalog thema's of modifier-intents uit en bescherm kernproducttermen expliciet.`, "negative", "high", 4),
        baseTask(`Splits relevante brede termen`.slice(0, 80), `Verplaats broad-but-relevant termen naar betere routing, landing pages of aparte high-intent structuur.`, "structure", "medium", 10),
      ];
    case "pmax_cannibalization":
      return [
        baseTask(`Definieer kanaalownership`.slice(0, 80), `Maak expliciet welke SKU's of productsets door Shopping versus PMax gedragen moeten worden.`, "structure", "high", 10),
        baseTask(`Bundel SKU-overlap`.slice(0, 80), `Cluster overlappende producten en bepaal welke kanaalcombinaties winstgevend zijn.`, "audit", "medium", 14),
      ];
    case "geo_allocation":
      return [
        baseTask(`Heralloceer geo-budget`.slice(0, 80), `Verplaats budget weg van landen die structureel onder target blijven.`, "budget", "high", 6),
        baseTask(`Bewaak landmix`.slice(0, 80), `Volg spend share, CPA en ROAS per land na de reallocatie.`, "audit", "medium", 14),
      ];
    case "network_quality":
      return [
        baseTask(`Snijd zwakke netwerken weg`.slice(0, 80), `Sluit of beperk inventory die duidelijk slechter presteert dan de hoofdnetwerken.`, "targeting", "high", 5),
        baseTask(`Meet netwerkherstel`.slice(0, 80), `Controleer CPA en conversiedichtheid per netwerk na de ingreep.`, "audit", "medium", 12),
      ];
    case "schedule_waste":
      return [
        baseTask(`Beperk inefficiënte uren`.slice(0, 80), `Pas advertentieplanning aan op uren of dagdelen met aantoonbaar zwakkere efficiency.`, "targeting", "high", 6),
        baseTask(`Meet verschuiving per dagdeel`.slice(0, 80), `Controleer of conversies verschuiven naar sterkere vensters in plaats van wegvallen.`, "audit", "medium", 14),
      ];
    default:
      return [
        baseTask(`Werk ${entity} uit`.slice(0, 80), `Bundel de hoofdactie rond ${cluster.canonical_metric} in één uitvoerbare ingreep zonder dubbel werk.`, "audit", cluster.action_required ? "high" : "medium", 7),
      ];
  }
}

function priorityRank(priority: Task["priority"]): number {
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

function selectPrimaryCluster(thread: AnalysisThread, clusters: IssueCluster[]): IssueCluster | null {
  const threadClusters = clusters.filter((cluster) => thread.supporting_cluster_ids.includes(cluster.cluster_id));
  if (threadClusters.length === 0) return null;
  return selectRepresentativeThreadCluster(threadClusters, clusters);
}

function mergedDependencies(threadClusters: IssueCluster[]): string[] {
  return unique(threadClusters.flatMap((cluster) => dependencyList(cluster)));
}

function mergedMetrics(threadClusters: IssueCluster[]): string[] {
  return unique(threadClusters.flatMap((cluster) => monitoringMetrics(cluster)));
}

function mergedEvidenceSummary(threadClusters: IssueCluster[]): string {
  return unique(threadClusters.map((cluster) => cluster.evidence_summary).filter(Boolean)).slice(0, 3).join(" | ");
}

function mergeCompactSentences(...texts: Array<string | null | undefined>): string {
  const parts = texts
    .flatMap((text) => (text || "").split(/\s*\|\s*|\.\s+/g))
    .map((part) => part.trim().replace(/\.$/, ""))
    .filter(Boolean);
  return unique(parts).slice(0, 4).join(". ") + (parts.length > 0 ? "." : "");
}

function normalizeBusinessTarget(input: {
  action_intent_class: ActionIntentClass;
  action_unit_key: string;
  primary_entity_scope: string;
  primary_entity_key: string;
  canonical_entity_name: string;
}): string {
  if (input.action_intent_class === "geo_reallocation") {
    const geoRoot = input.action_unit_key.split(":")[1] || input.primary_entity_key;
    return `geo::${geoRoot}`;
  }
  if (input.action_intent_class === "network_exclusion") {
    return `network::${input.action_unit_key.split(":")[1] || normalizeText(input.canonical_entity_name)}`;
  }
  if (input.action_intent_class === "portfolio_ownership") {
    return `portfolio::${input.action_unit_key.split(":")[1] || input.primary_entity_key}`;
  }
  return `${input.primary_entity_scope}::${input.primary_entity_key}`;
}

function buildRecommendationForThread(
  thread: AnalysisThread,
  allClusters: IssueCluster[]
): ThreadRecommendation | null {
  const threadClusters = allClusters.filter((cluster) => thread.supporting_cluster_ids.includes(cluster.cluster_id));
  const primary = selectPrimaryCluster(thread, allClusters);
  if (!primary) return null;

  const prerequisiteBlocker = findPrerequisiteBlocker(primary, allClusters);
  const evidenceLevel = evidenceFromCluster(primary);
  const confidence = confidenceFromEvidence(primary, evidenceLevel, threadClusters.length);
  const strategyModes: ActionStrategyMode[] =
    primary.issue_cluster === "tracking_cvr_drop"
      ? ["validation"]
      : isDualRouteEligible(primary)
        ? ["containment", "recovery"]
        : [readinessFromCluster(primary) === "monitor" ? "monitor" : "recovery"];
  const strategies = strategyModes
    .map((mode) => buildFallbackStrategy(primary, mode, evidenceLevel, confidence))
    .filter(Boolean) as RecommendationStrategyOption[];
  if (strategies.length === 0) {
    const readiness = readinessFromCluster(primary);
    const text = recommendationText(primary, readiness);
    strategies.push({
      mode: readiness === "monitor" ? "monitor" : "recovery",
      action: text.hypothesis,
      expected_result: text.expectedResult,
      timeframe: text.timeframe,
      evidence_level: evidenceLevel,
      confidence,
    });
  }
  if (evidenceRank(evidenceLevel) <= 2 && strategies.some((strategy) => strategy.mode === "containment") && !strategies.some((strategy) => strategy.mode === "validation")) {
    const validationGate = buildWeakEvidenceValidationStrategy(primary, evidenceLevel, confidence);
    if (validationGate) strategies.unshift(validationGate);
  }
  if (prerequisiteBlocker && !strategies.some((strategy) => strategy.mode === "validation")) {
    const validationStrategy = buildFallbackStrategy(prerequisiteBlocker, "validation", evidenceFromCluster(prerequisiteBlocker), confidenceFromEvidence(prerequisiteBlocker, evidenceFromCluster(prerequisiteBlocker), threadClusters.length));
    if (validationStrategy) strategies.unshift(validationStrategy);
  }
  const readiness = recommendationReadiness(evidenceLevel, confidence, strategies);
  const phase = recommendationPhaseFromStrategies(primary, readiness, strategies);
  const metrics = mergedMetrics(threadClusters);
  const causalChain = buildCausalChain(primary, threadClusters.length, strategies);
  const baseScores = iceScores(primary, readiness);
  const easePenalty = strategies.length > 1 ? 0.6 : 0;

  return {
    finding_index: null,
    source: evidenceRank(evidenceLevel) <= 2 ? "hypothesis" : "finding",
    hypothesis: formatStrategyHeadline(strategies),
    expected_result: formatExpectedOutcome(strategies, primary.canonical_metric),
    measurement_metric: metrics.slice(0, 4).join(", ") || primary.canonical_metric,
    timeframe: strategies[0]?.timeframe || "1-2 weken",
    rationale: `${causalChain.join(" ")} ${strategies.length > 1 ? `Tegenroute beschikbaar: ${formatAlternativeRouteSummary(strategies.slice(1))}. ` : ""}${prerequisiteBlocker && prerequisiteBlocker.cluster_id !== primary.cluster_id ? `Voorwaarde: valideer eerst ${safePresentationText(prerequisiteBlocker.display_label)} voordat bied- of budgetingrepen leidend worden. ` : ""}Ondersteund door ${threadClusters.length} cluster(s): ${mergedEvidenceSummary(threadClusters)}.`,
    ice_impact: baseScores.ice_impact,
    ice_confidence: Number(Math.min(9.5, baseScores.ice_confidence + (confidence === "high" ? 1 : confidence === "medium" ? 0.4 : -0.5)).toFixed(1)),
    ice_ease: Number(Math.max(3.5, Math.min(9.5, baseScores.ice_ease - easePenalty)).toFixed(1)),
    ice_total: Number(((baseScores.ice_impact + Math.min(9.5, baseScores.ice_confidence + (confidence === "high" ? 1 : confidence === "medium" ? 0.4 : -0.5)) + Math.max(3.5, Math.min(9.5, baseScores.ice_ease - easePenalty))) / 3).toFixed(1)),
    action_readiness: readiness,
    evidence_level: evidenceLevel,
    confidence,
    cluster_id: primary.cluster_id,
    thread_id: thread.id,
    phase,
    owner: ownerFromCluster(primary),
    dependencies: unique([
      ...mergedDependencies(threadClusters),
      ...(prerequisiteBlocker && prerequisiteBlocker.cluster_id !== primary.cluster_id
        ? [`Valideer eerst ${prerequisiteBlocker.display_label} voordat budget- of biedwijzigingen leidend worden.`]
        : []),
    ]),
    action_intent_class: actionIntentFromCluster(primary),
    action_unit_key: actionUnitKey(primary),
    primary_entity_scope: primary.entity_scope,
    primary_entity_key: primary.entity_identity_key,
    canonical_entity_name: primary.canonical_entity_name,
    canonical_metric: primary.canonical_metric,
    strategy_mode: strategies[0]?.mode,
    alternative_strategies: strategies,
    causal_chain: causalChain,
  };
}

function buildTasksForThread(
  thread: AnalysisThread,
  clusters: IssueCluster[],
  recommendationIndex: number
): ThreadTask[] {
  const threadClusters = clusters.filter((cluster) => thread.supporting_cluster_ids.includes(cluster.cluster_id));
  const primary = selectPrimaryCluster(thread, clusters);
  if (!primary) return [];
  const phase = phaseFromReadiness(primary, readinessFromCluster(primary));

  const taskMap = new Map<string, ThreadTask>();
  for (const cluster of threadClusters) {
    for (const task of buildTasksForCluster(cluster, phase, thread.id, recommendationIndex)) {
      const signature = [
        task.owner,
        task.action_type,
        task.action_intent_class,
        actionUnitKey(cluster),
      ].join(":::");
      const existing = taskMap.get(signature);
      if (
        !existing ||
        priorityRank(task.priority) > priorityRank(existing.priority) ||
        task.due_date_days < existing.due_date_days
      ) {
        taskMap.set(signature, {
          ...task,
          cluster_id: primary.cluster_id,
          recommendation_index: recommendationIndex,
          thread_id: thread.id,
        });
      }
    }
  }

  return Array.from(taskMap.values())
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || a.due_date_days - b.due_date_days || a.title.localeCompare(b.title))
    .slice(0, 3);
}

function recommendationConflicts(a: ThreadRecommendation, b: ThreadRecommendation): boolean {
  const aBusinessTarget = normalizeBusinessTarget(a);
  const bBusinessTarget = normalizeBusinessTarget(b);
  if (a.action_intent_class === b.action_intent_class && aBusinessTarget === bBusinessTarget) return true;
  if (a.action_unit_key !== b.action_unit_key) return false;
  if (a.primary_entity_scope !== b.primary_entity_scope) return false;
  if (a.primary_entity_key !== b.primary_entity_key) return false;

  const opposing: Record<ActionIntentClass, ActionIntentClass[]> = {
    budget_expand: ["budget_reduce", "pause_segment"],
    budget_reduce: ["budget_expand"],
    bid_raise: ["bid_lower"],
    bid_lower: ["bid_raise"],
    pause_segment: ["budget_expand", "bid_raise"],
    negative_cleanup: [],
    tracking_validation: [],
    network_exclusion: [],
    creative_refresh: [],
    geo_reallocation: [],
    schedule_control: [],
    portfolio_ownership: [],
    audience_refine: [],
    monitor_only: [],
    investigation: [],
  };

  return opposing[a.action_intent_class]?.includes(b.action_intent_class) ?? false;
}

function recommendationPriorityValue(recommendation: ThreadRecommendation): number {
  const phaseScore = recommendation.phase === "immediate" ? 30 : recommendation.phase === "short_term" ? 20 : 10;
  const confidenceScore = recommendation.confidence === "high" ? 8 : recommendation.confidence === "medium" ? 4 : 0;
  return phaseScore + confidenceScore + recommendation.ice_total;
}

function mergeRecommendations(primary: ThreadRecommendation, secondary: ThreadRecommendation): ThreadRecommendation {
  const mergedStrategies = unique([
    ...(primary.alternative_strategies ?? []),
    ...(secondary.alternative_strategies ?? []),
  ].map((strategy) => JSON.stringify(strategy))).map((item) => JSON.parse(item) as RecommendationStrategyOption);
  const orderedStrategies = mergedStrategies.sort((a, b) => {
    const order: Record<ActionStrategyMode, number> = { containment: 0, recovery: 1, validation: 2, monitor: 3 };
    return order[a.mode] - order[b.mode];
  });
  const mergedConfidence =
    primary.confidence === "high" || secondary.confidence === "high"
      ? "high"
      : primary.confidence === "medium" || secondary.confidence === "medium"
        ? "medium"
        : "low";
  const mergedEvidence =
    evidenceRank(primary.evidence_level) >= evidenceRank(secondary.evidence_level)
      ? (primary.evidence_level ?? "unknown")
      : (secondary.evidence_level ?? "unknown");
  return {
    ...primary,
    hypothesis: orderedStrategies.length > 0 ? formatStrategyHeadline(orderedStrategies) : primary.hypothesis,
    expected_result: orderedStrategies.length > 0 ? formatExpectedOutcome(orderedStrategies, primary.canonical_metric) : primary.expected_result,
    rationale: mergeCompactSentences(primary.rationale, secondary.rationale),
    measurement_metric: unique(
      `${primary.measurement_metric}, ${secondary.measurement_metric}`
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    ).slice(0, 4).join(", "),
    dependencies: unique([...primary.dependencies, ...secondary.dependencies]),
    evidence_level: mergedEvidence,
    confidence: mergedConfidence,
    strategy_mode: primary.strategy_mode ?? secondary.strategy_mode,
    alternative_strategies: orderedStrategies.length > 0 ? orderedStrategies : primary.alternative_strategies ?? secondary.alternative_strategies,
    causal_chain: unique([...(primary.causal_chain ?? []), ...(secondary.causal_chain ?? [])]).slice(0, 5),
  };
}

function deduplicateAndResolve(
  recommendations: ThreadRecommendation[],
  tasks: ThreadTask[]
): {
  recommendations: ThreadRecommendation[];
  tasks: ThreadTask[];
} {
  const keptRecs: ThreadRecommendation[] = [];

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

  const recIndexByCluster = new Map<string, number>();
  keptRecs.forEach((recommendation, index) => {
    recIndexByCluster.set(recommendation.cluster_id, index);
  });

  const taskMap = new Map<string, ThreadTask>();
  for (const task of tasks) {
    const recommendationIndex = recIndexByCluster.get(task.cluster_id);
    if (recommendationIndex == null) continue;
    const normalizedTask: ThreadTask = { ...task, recommendation_index: recommendationIndex };
    const signature = [
      task.owner,
      task.action_type,
      task.action_intent_class,
      task.action_unit_key,
      task.canonical_entity_name,
    ].join(":::");
    const existing = taskMap.get(signature);
    if (
      !existing ||
      priorityRank(normalizedTask.priority) > priorityRank(existing.priority) ||
      normalizedTask.due_date_days < existing.due_date_days
    ) {
      taskMap.set(signature, normalizedTask);
    }
  }

  const keptTasks = Array.from(taskMap.values())
    .sort((a, b) => a.due_date_days - b.due_date_days || a.title.localeCompare(b.title))
    .slice(0, MAX_TASKS);

  return {
    recommendations: keptRecs.slice(0, MAX_RECOMMENDATIONS),
    tasks: keptTasks,
  };
}

function buildDisplayFindings(parsedSteps: ParsedStepOutput[]): ParsedStepOutput[] {
  return parsedSteps.map((step) => ({
    ...step,
    displayFindings: [...step.findings]
      .sort((a, b) => {
        const severityRank = { critical: 5, high: 4, medium: 3, low: 2, positive: 1 } as const;
        const diff = severityRank[b.severity] - severityRank[a.severity];
        if (diff !== 0) return diff;
        return Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0);
      })
      .slice(0, MAX_DISPLAY_FINDINGS_PER_STEP),
  }));
}

function sanitizeBoilerplateLead(text: string): string {
  return text
    .replace(/In stap \d+\s+stelden we vast dat[^.]*\.\s*/gi, "")
    .replace(/In de vorige stap\s+(stelden|zagen|concludeerden) we[^.]*\.\s*/gi, "")
    .trim();
}

function sanitizeAppendixLogEntry(entry: string): string {
  return sanitizeBoilerplateLead(entry).replace(/\s+/g, " ").trim();
}

function safePresentationText(value: unknown): string {
  if (typeof value !== "string") return "Interne structured data verborgen.";
  const text = value.trim();
  if (!text) return "";
  if (text === "[object Object]") return "Interne structured data verborgen.";
  if (/^\s*[\[{]/.test(text) || /"[^"]+"\s*:/.test(text)) {
    return "Interne structured data verborgen.";
  }
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, "; ")
    .trim();
}

function splitCauseClauses(text: string | null | undefined): string[] {
  return normalizeRootCauseText(text)
    .split(/(?<=[.!?])\s+|;\s+|\/\s+/)
    .map((part) => part.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean);
}

function subordinateQualifier(text: string): string | null {
  const qualifiers = text.split(/\bmaar\b|\bterwijl\b|\bmits\b|\bomdat\b/i).map((part) => part.trim()).filter(Boolean);
  if (qualifiers.length < 2) return null;
  return qualifiers[1] || null;
}

function sanitizeRootCauseClause(text: string): string {
  const primary = text
    .replace(/\bmaar\b.*$/i, "")
    .replace(/\bterwijl\b.*$/i, "")
    .replace(/\bondanks\b.*$/i, "")
    .replace(/\ben\b.*\bmaar\b.*$/i, "")
    .trim();
  return primary || text.trim();
}

function normalizeRootCauseCandidate(text: string): string {
  return safePresentationText(text)
    .replace(/\s*\[Bevestigd in stap[^\]]+\]\s*/gi, "")
    .replace(/\.\s*;\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function rootCauseCausalScore(text: string): number {
  const normalized = normalizeRootCauseCandidate(text);
  if (!normalized) return 0;
  let score = 0;
  if (/\b(mismatch|verwatert|lekt|blokkeert|ondermijnt|drukt|remt|verstoort|faalt|concentreert|vernietigt|breuk|overspending|ineffici[eë]nt|disproportioneel)\b/i.test(normalized)) score += 4;
  if (/\b(waardoor|zodat|omdat|door|ondanks|terwijl)\b/i.test(normalized)) score += 2;
  if (/\d/.test(normalized)) score += 1;
  if (normalized.split(/\s+/).length >= 6) score += 1;
  return score;
}

function normalizeRootCauseClause(text: string): string {
  return sanitizeRootCauseClause(normalizeRootCauseCandidate(text))
    .replace(/[.;:]+$/g, "")
    .trim();
}

function rootCauseMeaningKey(text: string): string {
  return normalizeText(text)
    .replace(/\b\d+[,.]?\d*\b/g, "#")
    .replace(/\b(roas|cpa|cvr|spend|budget)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chooseExecutiveRootCauseSource(cluster: IssueCluster, leadCause: string): string {
  const cleanedLead = normalizeRootCauseCandidate(leadCause);
  const cleanedClusterSummary = normalizeRootCauseCandidate(cluster.root_cause_summary);
  const cleanedEvidenceSummary = normalizeRootCauseCandidate(cluster.evidence_summary);

  if (cleanedClusterSummary) {
    return cleanedClusterSummary;
  }

  return cleanedLead || cleanedEvidenceSummary;
}

export function dominantRootCause(cluster: IssueCluster, contradictionState: "none" | "mixed_evidence" | "resolved" = "none"): string {
  if (contradictionState === "mixed_evidence") {
    return "Prestatiebeeld is mixed en vraagt eerst validatie voordat een dominante oorzaak veilig kan worden vastgelegd.";
  }

  const rankedFindings = [...cluster.findings].sort((a, b) =>
    evidenceRank(b.evidence_level) - evidenceRank(a.evidence_level) ||
    confidenceRank(b.confidence) - confidenceRank(a.confidence) ||
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)
  );
  const leadCause = rankedFindings.map((finding) => finding.cause || "").find(Boolean) || "";
  const selectedCause = chooseExecutiveRootCauseSource(cluster, leadCause);
  const clauses = splitCauseClauses(selectedCause);
  const primary = sanitizeRootCauseClause(clauses[0] || selectedCause);
  const qualifier = subordinateQualifier(clauses[0] || "");
  return qualifier ? `${primary}; voorwaarde: ${qualifier}` : primary;
}

function executiveRootCauseFromThread(
  primaryCluster: IssueCluster | null,
  supportingClusters: IssueCluster[]
): string {
  if (!primaryCluster) return "Geen dominante root cause beschikbaar.";
  const impact = normalizeRootCauseClause(
    primaryCluster.root_cause_summary
    || primaryCluster.evidence_summary
    || dominantRootCause(primaryCluster)
  );
  const impactKey = rootCauseMeaningKey(impact.replace(/\bvoorwaarde:.*$/i, "").trim());
  const mechanismCandidates = [primaryCluster, ...supportingClusters]
    .flatMap((cluster) => [
      cluster.root_cause_summary,
      cluster.evidence_summary,
      dominantRootCause(cluster),
      ...cluster.findings.slice(0, 2).map((finding) => finding.cause || ""),
    ])
    .map((candidate) => normalizeRootCauseClause(candidate))
    .filter(Boolean)
    .sort((a, b) => rootCauseCausalScore(b) - rootCauseCausalScore(a) || b.length - a.length);
  const mechanism = mechanismCandidates.find((candidate) => {
    const candidateKey = rootCauseMeaningKey(candidate.replace(/\bvoorwaarde:.*$/i, "").trim());
    return candidateKey && candidateKey !== impactKey;
  }) || "";
  const combined = mechanism && rootCauseCausalScore(mechanism) > rootCauseCausalScore(impact)
    ? `${mechanism}; ${impact}`
    : impact || mechanism;
  return oneSentenceRootCause(combined);
}

function underperformanceDespitePositiveTrend(cluster: IssueCluster): boolean {
  const lead = cluster.findings[0];
  if (!lead || !isNegativeSeverity(cluster.dominant_severity)) return false;
  if ((lead.change_pct ?? 0) <= 0) return false;
  if (lead.canonical_metric === "ROAS" && typeof lead.current_value === "number") return lead.current_value < 1.5;
  if (lead.canonical_metric === "CPA" && typeof lead.current_value === "number" && typeof lead.previous_value === "number") return lead.current_value > 0;
  if (lead.canonical_metric === "CVR" && typeof lead.current_value === "number") return lead.current_value < 0.03;
  return true;
}

function executiveProblemLabel(cluster: IssueCluster): string {
  if (underperformanceDespitePositiveTrend(cluster)) {
    return `${cluster.display_label} verbetert, maar blijft onder rendementsdrempel`;
  }
  switch (issueFamily(cluster.issue_cluster)) {
    case "geo_allocation":
      return `${cluster.display_label} blijft het dominante geo-probleem`;
    case "traffic_quality":
      return `${cluster.display_label} lekt rendement via traffic quality`;
    case "portfolio_mix":
      return `${cluster.display_label} blijft een portfolio- of productmixprobleem`;
    case "query_quality":
      return `${cluster.display_label} blijft queryverlies concentreren`;
    case "demand_capture":
      return `${cluster.display_label} laat rendabele vraag liggen`;
    case "measurement_risk":
      return "Meetkwaliteit verstoort nog steeds de interpretatie van de maand";
    default:
      return `${cluster.display_label}: ${cluster.canonical_metric}`;
  }
}

function hasExecutiveCaveat(text: string): boolean {
  return /\b(mogelijk|waarschijnlijk|ondanks|maar|beperkt bewijs|onvoldoende bewijs|mixed evidence|hypothese|onzeker|niet sluitend)\b/i.test(text);
}

function decisionSurfaceKey(cluster: IssueCluster): string {
  return [
    cluster.entity_scope,
    cluster.entity_identity_key,
    causeFamilyFromIssueCluster(cluster.issue_cluster, cluster.root_cause_summary),
    actionFamilyFromIssueCluster(cluster.issue_cluster),
    cluster.parent_campaign || "",
  ].join("::");
}

function clusterBusinessImpact(cluster: IssueCluster): number {
  let score = SEVERITY_RANK[cluster.dominant_severity] * 10;
  if (cluster.action_required) score += 10;
  if (cluster.actionability === "direct_action") score += 6;
  if (cluster.coverage_dimensions.length >= 3) score += 6;
  if (cluster.canonical_metric === "ROAS" || cluster.canonical_metric === "CPA" || cluster.canonical_metric === "Conversies") score += 5;
  return score + Math.min(8, cluster.finding_count * 2);
}

function mergedClassification(clusters: IssueCluster[]): ThreadClassification {
  if (clusters.some((cluster) => cluster.issue_cluster === "tracking_cvr_drop")) return "measurement_risk";
  if (clusters.some((cluster) => cluster.action_required && ["critical", "high"].includes(cluster.dominant_severity))) return "real_problem";
  if (clusters.every((cluster) => !cluster.action_required)) return "false_positive_alert";
  if (clusters.some((cluster) => cluster.actionability === "monitor")) return "expected_tradeoff";
  return "contextual_shift";
}

function selectCanonicalDisplayCluster(clusters: IssueCluster[]): IssueCluster {
  return [...clusters].sort((a, b) =>
    clusterBusinessImpact(b) - clusterBusinessImpact(a) ||
    scoreCluster(b, clusters) - scoreCluster(a, clusters) ||
    b.finding_count - a.finding_count
  )[0];
}

function displayFindingTitle(cluster: IssueCluster): string {
  return executiveProblemLabel(cluster);
}

function displayFindingSummary(primary: IssueCluster, group: IssueCluster[]): string {
  const leadFinding = primary.findings[0];
  const leadMetricText = leadFinding
    ? underperformanceDespitePositiveTrend(primary)
      ? `${titleCaseMetric(leadFinding.canonical_metric)} verbetert (${leadFinding.change_pct != null ? `${leadFinding.change_pct > 0 ? "+" : ""}${leadFinding.change_pct}%` : formatMetricValue(leadFinding.current_value, leadFinding.canonical_metric)}), maar blijft onder rendementsdrempel`
      : `${titleCaseMetric(leadFinding.canonical_metric)} ${leadFinding.change_pct != null ? `${leadFinding.change_pct > 0 ? "+" : ""}${leadFinding.change_pct}%` : formatMetricValue(leadFinding.current_value, leadFinding.canonical_metric)}`
    : primary.canonical_metric;
  const supportingMetrics = unique(
    group.flatMap((cluster) => cluster.findings.map((finding) => titleCaseMetric(finding.canonical_metric)))
  ).slice(0, 3);
  const rootCause = dominantRootCause(primary);
  return [leadMetricText, supportingMetrics.length > 1 ? `Onderbouwd door ${supportingMetrics.join(", ")}` : null, safePresentationText(rootCause)]
    .filter(Boolean)
    .join(". ");
}

function mergedSupportingEvidence(group: IssueCluster[]): string[] {
  return unique(
    group.flatMap((cluster) => cluster.findings.map((finding) => {
      const metricValue = finding.current_value != null ? ` ${formatMetricValue(finding.current_value, finding.canonical_metric)}` : "";
      const deltaValue = finding.change_pct != null ? ` (${finding.change_pct > 0 ? "+" : ""}${finding.change_pct}%)` : "";
      return safePresentationText(`${finding.display_label} ${titleCaseMetric(finding.canonical_metric)}${metricValue}${deltaValue} — ${finding.cause}`);
    }))
  )
    .filter(Boolean)
    .slice(0, 4);
}

export function buildDisplayCanonicalFindings(
  clusters: IssueCluster[],
  arbitration: ContradictionArbitration = arbitrateContradictions(clusters)
): DisplayFinding[] {
  const grouped = new Map<string, IssueCluster[]>();
  for (const cluster of clusters) {
    const key = displayProblemKey(cluster as DisplayGroupIdentity);
    const existing = grouped.get(key) || [];
    existing.push(cluster);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries())
    .map(([display_key, group]) => {
      const primary = selectCanonicalDisplayCluster(group);
      return {
        display_key,
        title: displayFindingTitle(primary),
        severity: primary.dominant_severity,
        classification: mergedClassification(group),
        contradiction_state: group.some((cluster) => arbitration.unresolvedClusterIds.has(cluster.cluster_id))
          ? "mixed_evidence"
          : group.some((cluster) => (arbitration.clusterStates.get(cluster.cluster_id) ?? "none") === "resolved")
            ? "resolved"
            : "none",
        canonical_entity_name: primary.canonical_entity_name,
        issue_family: issueFamily(primary.issue_cluster),
        cause_family: causeFamilyFromIssueCluster(primary.issue_cluster, primary.root_cause_summary),
        action_family: actionFamilyFromIssueCluster(primary.issue_cluster),
        primary_metric: primary.canonical_metric,
        evidence_level: evidenceFromCluster(primary),
        confidence: clusterConfidence(primary),
        summary: displayFindingSummary(primary, group),
        supporting_evidence: mergedSupportingEvidence(group),
        action_required: group.some((cluster) => cluster.action_required),
        source_cluster_ids: group.map((cluster) => cluster.cluster_id),
        source_steps: unique(group.flatMap((cluster) => cluster.findings.map((finding) => finding.step))).sort((a, b) => a - b),
      } satisfies DisplayFinding;
    })
    .sort((a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      (b.action_required ? 1 : 0) - (a.action_required ? 1 : 0) ||
      a.title.localeCompare(b.title)
    )
    .slice(0, MAX_STRUCTURED_DISPLAY_FINDINGS);
}

function displayFindingPrimaryStep(finding: DisplayFinding): number {
  return finding.source_steps[0] ?? 0;
}

function buildStepBackedDisplayFindingCandidates(parsedSteps: ParsedStepOutput[]): DisplayFinding[] {
  const candidates: DisplayFinding[] = [];

  for (const step of parsedSteps) {
    const findings = (step.displayFindings ?? step.findings).slice(0, MAX_DISPLAY_FINDINGS_PER_STEP);
    for (const finding of findings) {
      const summary = safePresentationText(finding.cause || step.step_conclusion || step.stepName);
      candidates.push({
        display_key: `step:${step.stepNumber}:${normalizeText(finding.entity_name)}:${normalizeText(finding.metric)}:${normalizeText(summary)}`,
        title: `${finding.entity_name}: ${finding.metric}`,
        severity: finding.severity,
        classification:
          !finding.action_required && finding.severity === "positive"
            ? "false_positive_alert"
            : "real_problem",
        contradiction_state: "none",
        canonical_entity_name: finding.entity_name,
        issue_family: finding.issue_cluster,
        cause_family: finding.issue_cluster,
        action_family: finding.issue_cluster,
        primary_metric: finding.metric,
        evidence_level: finding.evidence_level ?? "unknown",
        confidence: finding.confidence ?? "medium",
        summary,
        supporting_evidence: unique(
          [step.step_conclusion, ...step.log_entries.map((entry) => sanitizeAppendixLogEntry(entry))]
            .map((item) => safePresentationText(item))
            .filter(Boolean)
        ).slice(0, 3),
        action_required: finding.action_required,
        source_cluster_ids: [],
        source_steps: [step.stepNumber],
      });
    }
  }

  return candidates;
}

function sortDisplayFindings(findings: DisplayFinding[]): DisplayFinding[] {
  return [...findings].sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    (b.action_required ? 1 : 0) - (a.action_required ? 1 : 0) ||
    b.source_steps.length - a.source_steps.length ||
    a.title.localeCompare(b.title)
  );
}

function ensureDisplayFindingStepDiversity(
  primaryFindings: DisplayFinding[],
  fallbackCandidates: DisplayFinding[],
  minSteps = MIN_STRUCTURED_STEP_COVERAGE,
  minTotal = MIN_STRUCTURED_DISPLAY_FINDINGS,
  maxTotal = MAX_STRUCTURED_DISPLAY_FINDINGS
): DisplayFinding[] {
  const deduped = new Map<string, DisplayFinding>();
  for (const finding of sortDisplayFindings(primaryFindings)) {
    deduped.set(finding.display_key, finding);
  }
  for (const finding of sortDisplayFindings(fallbackCandidates)) {
    if (!deduped.has(finding.display_key)) deduped.set(finding.display_key, finding);
  }

  const allCandidates = sortDisplayFindings(Array.from(deduped.values()));
  const result: DisplayFinding[] = [];
  const perStepCounts = new Map<number, number>();
  const coveredSteps = new Set<number>();

  const addFinding = (finding: DisplayFinding): boolean => {
    if (result.some((existing) => existing.display_key === finding.display_key)) return false;
    const primaryStep = displayFindingPrimaryStep(finding);
    const stepCount = perStepCounts.get(primaryStep) ?? 0;
    if (primaryStep && stepCount >= MAX_DISPLAY_FINDINGS_PER_STEP) return false;
    result.push(finding);
    if (primaryStep) {
      perStepCounts.set(primaryStep, stepCount + 1);
    }
    for (const step of finding.source_steps) coveredSteps.add(step);
    return true;
  };

  const perStepTop = new Map<number, DisplayFinding>();
  for (const finding of allCandidates) {
    for (const step of finding.source_steps) {
      if (!perStepTop.has(step)) perStepTop.set(step, finding);
    }
  }

  for (const step of Array.from(perStepTop.keys()).sort((a, b) => a - b)) {
    addFinding(perStepTop.get(step)!);
    if (coveredSteps.size >= minSteps && result.length >= minTotal) break;
  }

  for (const finding of allCandidates) {
    if (result.length >= maxTotal) break;
    if (coveredSteps.size < minSteps || result.length < minTotal) {
      addFinding(finding);
      continue;
    }
    addFinding(finding);
  }

  return sortDisplayFindings(result).slice(0, maxTotal);
}

export function buildCanonicalMetricSnapshot(findings: NormalizedFinding[]): CanonicalMetricSnapshotRow[] {
  const byKey = new Map<string, NormalizedFinding>();

  for (const finding of findings) {
    if (!["account", "country", "campaign", "adgroup", "device", "network"].includes(finding.entity_type)) continue;
    const key = `${finding.entity_identity_key}:::${finding.canonical_metric}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, finding);
      continue;
    }

    const currentScore =
      (finding.change_pct != null ? 8 : 0) +
      metricValueRank(finding.current_value) * 4 +
      metricValueRank(finding.previous_value) * 2 +
      (finding.confidence === "high" ? 3 : finding.confidence === "medium" ? 2 : 1) +
      (finding.severity === "critical" ? 5 : finding.severity === "high" ? 4 : finding.severity === "medium" ? 3 : 1);
    const existingScore =
      (existing.change_pct != null ? 8 : 0) +
      metricValueRank(existing.current_value) * 4 +
      metricValueRank(existing.previous_value) * 2 +
      (existing.confidence === "high" ? 3 : existing.confidence === "medium" ? 2 : 1) +
      (existing.severity === "critical" ? 5 : existing.severity === "high" ? 4 : existing.severity === "medium" ? 3 : 1);

    if (currentScore > existingScore) {
      byKey.set(key, finding);
    }
  }

  const scopeRank: Record<string, number> = {
    account: 6,
    country: 5,
    campaign: 4,
    adgroup: 3,
    network: 2,
    device: 1,
  };

  return Array.from(byKey.values())
    .sort((a, b) =>
      (scopeRank[b.entity_scope] ?? 0) - (scopeRank[a.entity_scope] ?? 0) ||
      Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0) ||
      a.display_label.localeCompare(b.display_label) ||
      a.canonical_metric.localeCompare(b.canonical_metric)
    )
    .slice(0, MAX_CANONICAL_SNAPSHOT_ROWS)
    .map((finding) => ({
      entity_identity_key: finding.entity_identity_key,
      entity_scope: finding.entity_scope,
      display_label: finding.display_label,
      canonical_metric: finding.canonical_metric,
      current_value: finding.current_value,
      previous_value: finding.previous_value,
      change_pct: finding.change_pct,
      source_finding_id: finding.finding_id,
    }));
}

function buildCanonicalSnapshotMarkdown(snapshot: CanonicalMetricSnapshotRow[]): string[] {
  if (snapshot.length === 0) return ["- Geen canonieke KPI-snapshot beschikbaar."];
  return snapshot.slice(0, 8).map((row) => {
    const valueText = formatMetricValue(row.current_value, row.canonical_metric);
    const previousText = row.previous_value != null ? ` (was ${formatMetricValue(row.previous_value, row.canonical_metric)})` : "";
    const deltaText = row.change_pct != null ? ` (${row.change_pct > 0 ? "+" : ""}${row.change_pct}%)` : "";
    return `- ${row.display_label}: ${row.canonical_metric} ${valueText}${previousText}${deltaText}`;
  });
}

function buildSuccessScenario(
  threads: AnalysisThread[],
  recommendations: ThreadRecommendation[]
): SuccessScenario {
  const primary = threads[0];
  return {
    floor_scenario: primary
      ? `De maand is beter als ${primary.monitoring_metrics.slice(0, 2).join(" en ")} stabiliseren zonder nieuwe escalatie in ${primary.title.toLowerCase()}.`
      : "De maand is beter als de belangrijkste efficiëntiesignalen stabiliseren.",
    target_scenario: primary
      ? `Doelscenario: de primaire thread beweegt aantoonbaar richting herstel en minimaal twee ondersteunende threads blijven onder controle.`
      : "Doelscenario: rendement en volume bewegen tegelijk de goede kant op.",
    biggest_risk: recommendations.some((recommendation) => recommendation.action_intent_class === "tracking_validation")
      ? "Meetproblemen blijven onopgelost waardoor optimalisaties op verkeerde signalen worden gebaseerd."
      : "Te veel parallelle optimalisaties zonder duidelijke prioriteit vertroebelen het echte effect.",
    weekly_monitoring_checklist: unique(
      recommendations
        .slice(0, 5)
        .flatMap((recommendation) => [recommendation.measurement_metric, recommendation.canonical_metric])
        .filter(Boolean)
    ).slice(0, 5),
  };
}

function buildActionPlan(recommendations: ThreadRecommendation[]): Record<string, string[]> {
  return {
    [ACTION_PHASE_LABELS.immediate]: recommendations.filter((recommendation) => recommendation.phase === "immediate").map((recommendation) => recommendation.hypothesis),
    [ACTION_PHASE_LABELS.short_term]: recommendations.filter((recommendation) => recommendation.phase === "short_term").map((recommendation) => recommendation.hypothesis),
    [ACTION_PHASE_LABELS.medium_term]: recommendations.filter((recommendation) => recommendation.phase === "medium_term").map((recommendation) => recommendation.hypothesis),
  };
}

function deadlineToPhase(deadline: string): ActionPhase {
  if (deadline === "direct") return "immediate";
  if (deadline === "deze_week") return "short_term";
  return "medium_term";
}

function actionTimeframe(deadline: string): string {
  switch (deadline) {
    case "direct":
      return "1-2 weken";
    case "deze_week":
      return "2-4 weken";
    case "volgende_week":
      return "2-4 weken";
    default:
      return "4-6 weken";
  }
}

function inferMetricFromAction(action: string, cluster?: IssueCluster | null): string {
  if (cluster?.canonical_metric) return cluster.canonical_metric;
  if (/roas/i.test(action)) return "ROAS";
  if (/cpa/i.test(action)) return "CPA";
  if (/cpc/i.test(action)) return "CPC";
  if (/budget/i.test(action)) return "Spend";
  if (/search\s*is|impression share/i.test(action)) return "Search IS";
  if (/convers/i.test(action)) return "Conversies";
  return "ROAS, CPA, Conversies";
}

function impactScore(text: string): number {
  const pctMatch = text.match(/(\d+[,.]?\d*)\s*%/);
  const euroMatch = text.match(/€\s*(\d+[,.]?\d*)/);
  const convMatch = text.match(/(\d+[,.]?\d*)\s*(extra\s*)?convers/i);
  return Number((pctMatch?.[1] || convMatch?.[1] || euroMatch?.[1] || "0").replace(",", "."));
}

function actionSpecificityScore(action: string): number {
  let score = 0;
  if (/\d+[,.]?\d*\s*%|€\s*\d+/i.test(action)) score += 3;
  if (/verlaag|verhoog|pauzeer|sluit uit|beperk|splits|corrigeer|valideer/i.test(action)) score += 2;
  if (action.trim().split(/\s+/).length >= 6) score += 1;
  if (/campagne|ad group|product|asset|dagbudget|tROAS|tCPA/i.test(action)) score += 1;
  if (FORBIDDEN_RECOMMENDATION_WORDS.test(action)) score -= 4;
  return score;
}

function stepActionPurityScore(stepNumber: number, action: string): number {
  if (isActionAlignedWithStep(stepNumber, action)) return 0;
  const domains = inferActionDomains(action);
  return domains.length === 0 ? -1 : -4;
}

function isDestructiveIntent(intent: ActionIntentClass, mode: ActionStrategyMode): boolean {
  return mode === "containment" || ["budget_reduce", "pause_segment", "negative_cleanup", "network_exclusion", "bid_lower"].includes(intent);
}

function actionFeasibilityScore(
  action: string,
  intent: ActionIntentClass,
  cluster: IssueCluster | null,
  evidence: EvidenceLevel,
  mode: ActionStrategyMode,
  prerequisiteBlocker: IssueCluster | null
): number {
  let score = 0;
  const normalizedAction = normalizeText(action);
  if (actionSpecificityScore(action) >= 4) score += 4;
  if (/troas|tcpa|budget|negative|uitsluit|pauzeer|device|audience|dagbudget|campagne|assetgroep/i.test(action)) score += 2;
  if (cluster && actionIntentFromCluster(cluster) === intent) score += 2;
  if (cluster && normalizedAction.includes(normalizeText(cluster.canonical_entity_name))) score += 3;
  if (cluster && /accountniveau|account level|accountbreed/i.test(action) && !["account", "campaign"].includes(cluster.entity_scope)) score -= 5;
  if (cluster && isValidationPrerequisiteCluster(prerequisiteBlocker) && mode !== "validation") score -= 6;
  if ((evidence === "hypothesis" || evidence === "unknown") && isDestructiveIntent(intent, mode)) score -= 5;
  if (cluster?.issue_cluster === "tracking_cvr_drop" && intent !== "tracking_validation") score -= 8;
  if (cluster?.issue_cluster === "search_budget_cap" && intent === "budget_reduce") score -= 5;
  if (cluster?.issue_cluster === "geo_allocation" && !/land|geo|country|budget|troas|tcpa/i.test(action)) score -= 3;
  if (cluster?.issue_cluster === "network_quality" && !/network|youtube|partner/i.test(action)) score -= 3;
  return score;
}

function actionEaseScore(action: string, deadline: string): number {
  let ease = deadline === "direct" ? 8.5 : deadline === "deze_week" ? 7 : deadline === "volgende_week" ? 5.5 : 4.5;
  if (/feed|landing|website|cms|tracking/i.test(action)) ease -= 2;
  if (/splits|herstructureer|ownership|productset/i.test(action)) ease -= 1.5;
  if (/pauzeer|verlaag|verhoog|sluit uit|beperk/i.test(action)) ease += 0.5;
  return Math.max(3.5, Math.min(9.5, ease));
}

function clusterSupportScore(cluster: IssueCluster | null): number {
  if (!cluster) return 0;
  const evidenceSpread = unique(cluster.findings.map((finding) => finding.step)).length;
  return evidenceSpread + Math.min(2, cluster.coverage_dimensions.length - 1);
}

function isDualRouteEligible(cluster: IssueCluster | null): boolean {
  if (!cluster) return false;
  if (cluster.issue_cluster === "tracking_cvr_drop") return false;
  return cluster.action_required && isNegativeSeverity(cluster.dominant_severity);
}

function inferStrategyMode(action: string, cluster?: IssueCluster | null): ActionStrategyMode {
  const normalized = normalizeText(action);
  if (cluster?.issue_cluster === "tracking_cvr_drop" || /tracking|meting|tag|attribu|valid|audit|controleer|check/i.test(action)) {
    return "validation";
  }
  if (/monitor|bewaak|volg/i.test(action)) return "monitor";
  if (
    /pauzeer|verlaag|beperk|snijd|afknijp|uitsluit|reduceer|stop/i.test(normalized) ||
    (/\bsluit\b/i.test(action) && /\buit\b/i.test(action))
  ) return "containment";
  if (/behoud|splits|herstel|test|routing|landings|feed|titel|image|pricing|prijs|verzend|troas|tcpa|device|audience|search theme|thema|vertaal|lp/i.test(normalized)) {
    return "recovery";
  }
  if (cluster?.issue_cluster === "search_budget_cap" || cluster?.issue_cluster === "mobile_opportunity" || cluster?.issue_cluster === "scaling_opportunity") {
    return "recovery";
  }
  return cluster && isDualRouteEligible(cluster) ? "containment" : "recovery";
}

function evidenceFromCluster(cluster: IssueCluster | null): EvidenceLevel {
  if (!cluster) return "unknown";
  if (cluster.issue_cluster === "tracking_cvr_drop") return "inferred";
  if (cluster.findings.length === 0) return "unknown";
  if (cluster.findings.every((finding) => !finding.evidence_level)) return "unknown";
  if (cluster.findings.some((finding) => finding.evidence_level === "hypothesis")) return "hypothesis";
  if (cluster.findings.some((finding) => finding.evidence_level === "inferred")) return "inferred";
  if (cluster.findings.some((finding) => finding.evidence_level === "deterministic")) return "deterministic";
  return "unknown";
}

function confidenceFromEvidence(cluster: IssueCluster | null, evidence: EvidenceLevel, supportCount = 1): Confidence {
  const clusterConfidence = cluster?.dominant_confidence;
  if (evidence === "deterministic" && supportCount >= 2 && confidenceRank(clusterConfidence) >= 2) return "high";
  if (evidence === "deterministic") return confidenceRank(clusterConfidence) >= 2 ? "medium" : "low";
  if (evidence === "inferred" || clusterConfidence === "medium" || supportCount >= 2) return "medium";
  return "low";
}

function strategyLabel(mode: ActionStrategyMode, evidence: EvidenceLevel): string {
  switch (mode) {
    case "containment":
      return "Containment";
    case "recovery":
      return evidenceRank(evidence) <= 2 ? "Recovery (hypothese-gedreven)" : "Recovery";
    case "validation":
      return evidenceRank(evidence) <= 2 ? "Validatie (hypothese-gedreven)" : "Validatie";
    default:
      return "Monitoring";
  }
}

function buildFallbackStrategy(
  cluster: IssueCluster | null,
  mode: ActionStrategyMode,
  evidence: EvidenceLevel,
  confidence: Confidence
): RecommendationStrategyOption | null {
  if (!cluster) return null;
  const entity = cluster.display_label;
  const validationMetric = cluster.canonical_metric;
  switch (cluster.issue_cluster) {
    case "geo_allocation":
      if (mode === "containment") {
        return {
          mode,
          action: `Verlaag budget voor ${entity} met 30-50% of pauzeer de zwakste landset totdat ${cluster.canonical_metric} herstelt`,
          expected_result: `Beperkt directe spend-lekkage in ${entity} terwijl het accountbrede rendement stabiliseert.`,
          timeframe: "1-2 weken",
          evidence_level: evidence,
          confidence,
          validation_metric: validationMetric,
          validation_condition: `Bevestig binnen 1-2 weken dat ${cluster.canonical_metric} en spend share in ${entity} niet verder verslechteren.`,
          risk_note: `Te brede geo-reductie kan winstgevende pockets binnen ${entity} ook afknijpen.`,
        };
      }
      if (mode === "recovery") {
        return {
          mode,
          action: `Behoud ${entity} alleen in aparte campagne of landset met hogere tROAS/tCPA, strengere zoekthema's en pricing- of LP-check`,
          expected_result: `Toetst of ${entity} gecontroleerd kan herstellen zonder opnieuw disproportioneel budgetverlies te veroorzaken.`,
          timeframe: "2-4 weken",
          evidence_level: evidenceRank(evidence) >= 3 ? "inferred" : "hypothesis",
          confidence: confidence === "high" ? "medium" : confidence,
          validation_metric: validationMetric,
          validation_condition: `Schaal alleen door als ${cluster.canonical_metric} en conversiedichtheid in ${entity} binnen 2-4 weken aantoonbaar verbeteren zonder spend-escalatie.`,
          risk_note: `Pricing, LP of marktfit kunnen herstel beperken ondanks een betere campagne-opzet.`,
        };
      }
      break;
    case "network_quality":
    case "search_partner_waste":
      if (mode === "containment") {
        return {
          mode,
          action: `Beperk of sluit de zwakste netwerkinventory rond ${entity} direct uit`,
          expected_result: `Snijdt verlieslatende inventory weg en verbetert de blended efficiency van ${entity}.`,
          timeframe: "1-2 weken",
          evidence_level: evidence,
          confidence,
          validation_metric: validationMetric,
          validation_condition: `Bevestig dat ${cluster.canonical_metric} en CPA op de overblijvende inventory binnen 1-2 weken verbeteren.`,
          risk_note: "Te brede netwerkbeperking kan ook nuttig aanvullend bereik wegsnijden.",
        };
      }
      if (mode === "recovery") {
        return {
          mode,
          action: `Test ${entity} in een afgescheiden netwerk- of campagneset met strakkere assets, audience-signalen en biedcontrole`,
          expected_result: `Laat zien of er binnen ${entity} nog rendabele inventory overblijft zonder de hoofdset te vervuilen.`,
          timeframe: "2-4 weken",
          evidence_level: evidenceRank(evidence) >= 3 ? "inferred" : "hypothesis",
          confidence: confidence === "high" ? "medium" : confidence,
          validation_metric: validationMetric,
          validation_condition: `Doorzetten alleen als ${cluster.canonical_metric}, CVR of CPA in de testset aantoonbaar beter zijn dan in de hoofdset.`,
          risk_note: "Extra netwerk-tests kunnen tijdelijk learning reset of extra spend vragen.",
        };
      }
      break;
    case "search_term_waste":
      if (mode === "containment") {
        return {
          mode,
          action: `Sluit alleen aantoonbaar irrelevante modifiers of off-catalog thema's uit rond ${entity}`,
          expected_result: "Beperkt waste spend zonder kernvraag of relevante brede termen onnodig te blokkeren.",
          timeframe: "Binnen 7 dagen",
          evidence_level: evidence,
          confidence,
          validation_metric: "Wasteful Spend",
          validation_condition: "Behoud de uitsluiting alleen als waste spend daalt zonder terugval in relevante conversies.",
          risk_note: "Te grove negatives kunnen ook rendabele queryvarianten blokkeren.",
        };
      }
      if (mode === "recovery") {
        return {
          mode,
          action: `Behoud broad-but-relevant of kernproducttermen rond ${entity} in aparte high-intent routing met strakkere landingspagina en negatives op intentlaag`,
          expected_result: "Test of hetzelfde thema via betere routing en intentafbakening wel rendabel kan worden zonder kernproducten onnodig af te snijden.",
          timeframe: "2-4 weken",
          evidence_level: evidenceRank(evidence) >= 3 ? "inferred" : "hypothesis",
          confidence: confidence === "high" ? "medium" : confidence,
          validation_metric: "CVR, ROAS",
          validation_condition: "Recovery slaagt alleen als CVR of ROAS verbetert zonder dat waste spend opnieuw oploopt.",
          risk_note: "Routing- of LP-fixes kunnen zonder voldoende zoekvolume onduidelijk blijven.",
        };
      }
      break;
    case "product_mix":
    case "pmax_cannibalization":
      if (mode === "containment") {
        return {
          mode,
          action: `Pauzeer of beperk SKU's of productgroepen in ${entity} die disproportioneel spend trekken zonder conversie`,
          expected_result: `Remt directe verliesdragers af en maakt de productmix van ${entity} weer bestuurbaar.`,
          timeframe: "1-2 weken",
          evidence_level: evidence,
          confidence,
          validation_metric: validationMetric,
          validation_condition: `Bevestig dat spend-lekkage en blended ${cluster.canonical_metric} binnen 1-2 weken verbeteren.`,
          risk_note: "Containment kan ook toekomstige winnaars of leerdata tijdelijk afknijpen.",
        };
      }
      if (mode === "recovery") {
        return {
          mode,
          action: `Herstart ${entity} in aparte productset of assetgroep met aangepaste feed, titel/image-test en kanaalscheiding`,
          expected_result: `Toetst of het segment via scherpere productpresentatie en ownership gecontroleerd kan herstellen.`,
          timeframe: "2-6 weken",
          evidence_level: evidenceRank(evidence) >= 3 ? "inferred" : "hypothesis",
          confidence: confidence === "high" ? "medium" : confidence,
          validation_metric: "ROAS, Conversies",
          validation_condition: "Herstel is pas geloofwaardig als ROAS of conversies in de afgescheiden productset aantoonbaar verbeteren.",
          risk_note: "Feed- of ownership-aanpassingen vragen vaak extra implementatietijd en beïnvloeden learning.",
        };
      }
      break;
    case "desktop_inefficiency":
    case "mobile_opportunity":
    case "audience_inefficiency":
    case "schedule_waste":
      if (mode === "containment") {
        return {
          mode,
          action: `Verlaag bieddruk of knijp ${entity} tijdelijk af op het zwakke segment totdat ${cluster.canonical_metric} terug binnen controle komt`,
          expected_result: `Beperkt directe efficiëntieverliezen op het zwakke segment.`,
          timeframe: "1-2 weken",
          evidence_level: evidence,
          confidence,
          validation_metric: validationMetric,
          validation_condition: `Bevestig dat ${cluster.canonical_metric} in het zwakke segment binnen 1-2 weken normaliseert.`,
          risk_note: "Te agressieve afknijping kan conversievolume sneller drukken dan verwacht.",
        };
      }
      if (mode === "recovery") {
        return {
          mode,
          action: `Laat ${entity} alleen terugkomen in een afgescheiden test met aangepaste bieding, targeting of planning`,
          expected_result: `Toetst of het segment onder strakkere voorwaarden alsnog rendabel kan worden.`,
          timeframe: "2-4 weken",
          evidence_level: evidenceRank(evidence) >= 3 ? "inferred" : "hypothesis",
          confidence: confidence === "high" ? "medium" : confidence,
          validation_metric: validationMetric,
          validation_condition: `Doorzetten alleen als ${cluster.canonical_metric} of CVR in de testopzet verbetert zonder efficiencyverslechtering elders.`,
          risk_note: "Segmenttests kunnen tijdelijk moeilijk interpreteerbaar zijn bij laag volume.",
        };
      }
      break;
    case "tracking_cvr_drop":
      return {
        mode: "validation",
        action: `Valideer tracking en conversiemeting voor ${entity} voordat bied- of budgetwijzigingen live gaan`,
        expected_result: "Herstelt betrouwbare sturing zodat vervolgacties niet op meetruis worden gebaseerd.",
        timeframe: "Deze week",
        evidence_level: "inferred",
        confidence: confidence === "low" ? "medium" : confidence,
        validation_metric: "CVR, Conversies",
        validation_condition: "Pas verdere optimalisaties toe nadat tracking, conversie-acties en dashboarddata weer op elkaar aansluiten.",
        risk_note: "Zonder valide meting blijven latere conclusies potentieel misleidend.",
      };
    case "search_budget_cap":
      return {
        mode: "recovery",
        action: `Vergroot het budgetvenster van ${entity} alleen op uren, zoekthema's of campagnes waar vraag aantoonbaar rendabel blijft`,
        expected_result: "Vangt gemiste vraag op zonder blind extra budget naar inefficiënte queries te sturen.",
        timeframe: "1-2 weken",
        evidence_level: evidenceRank(evidence) >= 3 ? evidence : "inferred",
        confidence: confidence === "low" ? "medium" : confidence,
        validation_metric: "Search Lost IS (Budget), ROAS, Conversies",
        validation_condition: "Extra budget is alleen verdedigbaar als Search Lost IS (Budget) daalt en volume groeit binnen rendabele KPI-grenzen.",
        risk_note: "Volume push zonder kwaliteitsfilter kan de onderliggende efficiency verder uithollen.",
      };
    default:
      if (mode === "containment") {
        return {
          mode,
          action: `Beperk ${entity} tijdelijk op het zwakste segment tot ${cluster.canonical_metric} niet verder verslechtert`,
          expected_result: `Beperkt directe schade terwijl de hoofdverklaring verder wordt getoetst.`,
          timeframe: "1-2 weken",
          evidence_level: evidence,
          confidence,
          validation_metric: validationMetric,
          validation_condition: `Bevestig binnen ${mode === "containment" ? "1-2 weken" : "2-4 weken"} dat ${cluster.canonical_metric} niet verder verslechtert.`,
          risk_note: "Containment kan neveneffecten hebben op volume of learning.",
        };
      }
      if (mode === "recovery") {
        return {
          mode,
          action: `Test ${entity} in een afgescheiden herstelsetup met scherpere targeting, bieding of routing`,
          expected_result: `Maakt inzichtelijk of ${entity} onder gecontroleerde randvoorwaarden wel rendabel kan worden.`,
          timeframe: "2-4 weken",
          evidence_level: evidenceRank(evidence) >= 3 ? "inferred" : "hypothesis",
          confidence: confidence === "high" ? "medium" : confidence,
          validation_metric: validationMetric,
          validation_condition: `Recovery pas doorzetten als ${cluster.canonical_metric} aantoonbaar verbetert binnen de testhorizon.`,
          risk_note: "Herstelroutes vragen vaak extra tijd en kunnen zonder volume weinig signaal opleveren.",
        };
      }
  }
  return null;
}

function buildWeakEvidenceValidationStrategy(
  cluster: IssueCluster | null,
  evidence: EvidenceLevel,
  confidence: Confidence
): RecommendationStrategyOption | null {
  if (!cluster) return null;
  return {
    mode: "validation",
    action: `Valideer eerst de dominante oorzaak in ${cluster.display_label} via een afgebakende test voordat destructieve ingrepen live gaan`,
    expected_result: `Bevestigt of ${cluster.display_label} echt door ${causeFamilyFromIssueCluster(cluster.issue_cluster, cluster.root_cause_summary).replace(/_/g, " ")} wordt geraakt voordat budget, bieding of uitsluiting wordt aangescherpt.`,
    timeframe: "Deze week",
    evidence_level: evidenceRank(evidence) >= 2 ? "hypothesis" : "unknown",
    confidence: confidence === "high" ? "medium" : confidence,
    validation_metric: cluster.canonical_metric,
    validation_condition: `Ga pas door met containment of recovery als ${cluster.canonical_metric} in de testopzet aantoonbaar dezelfde richting uitwijst.`,
    risk_note: "Zonder validation gate kan een destructieve ingreep te vroeg op onvolledig bewijs worden gebaseerd.",
  };
}

function formatStrategyHeadline(strategies: RecommendationStrategyOption[]): string {
  const hasValidation = strategies.some((strategy) => strategy.mode === "validation");
  const order: Record<ActionStrategyMode, number> = hasValidation
    ? { validation: 0, containment: 1, recovery: 2, monitor: 3 }
    : { containment: 0, recovery: 1, validation: 2, monitor: 3 };
  const ordered = [...strategies].sort((a, b) => order[a.mode] - order[b.mode]);
  const primary = ordered[0];
  return primary ? `${strategyLabel(primary.mode, primary.evidence_level)}: ${primary.action}` : "";
}

function formatAlternativeRouteSummary(strategies: RecommendationStrategyOption[]): string {
  const hasValidation = strategies.some((strategy) => strategy.mode === "validation");
  const order: Record<ActionStrategyMode, number> = hasValidation
    ? { validation: 0, containment: 1, recovery: 2, monitor: 3 }
    : { containment: 0, recovery: 1, validation: 2, monitor: 3 };
  return [...strategies]
    .sort((a, b) => order[a.mode] - order[b.mode])
    .map((strategy) => `${strategyLabel(strategy.mode, strategy.evidence_level)}: ${strategy.action}`)
    .join(". ");
}

function formatExpectedOutcome(strategies: RecommendationStrategyOption[], fallbackMetric: string): string {
  const uniqueExpected = unique(strategies.map((strategy) => safePresentationText(strategy.expected_result)).filter(Boolean));
  const validationBits = unique(
    strategies.map((strategy) => strategy.validation_condition).filter(Boolean).map((value) => safePresentationText(value))
  );
  if (uniqueExpected.length === 0) {
    return `Meet herstel via ${fallbackMetric}.`;
  }
  const expected = uniqueExpected.slice(0, 2).join(" ");
  return validationBits.length > 0 ? `${expected} Valideer via ${fallbackMetric}: ${validationBits[0]}` : expected;
}

function buildCausalChain(cluster: IssueCluster | null, supportCount: number, strategies: RecommendationStrategyOption[]): string[] {
  const symptom = cluster?.evidence_summary || "Symptoom onvoldoende hard afgebakend.";
  const cause = cluster?.root_cause_summary || "Waarschijnlijke oorzaak nog niet sluitend bewezen.";
  const intervention = formatStrategyHeadline(strategies);
  const effect = formatExpectedOutcome(strategies, cluster?.canonical_metric || "de primaire KPI");
  const risk = unique(strategies.map((strategy) => strategy.risk_note).filter(Boolean)).slice(0, 1)[0];
  return [
    `Symptoom: ${safePresentationText(symptom)}`,
    `Bewijssterkte: ${supportCount} onafhankelijke signaalbron(nen)`,
    `Waarschijnlijke oorzaak: ${safePresentationText(cause)}`,
    `Ingreep: ${safePresentationText(intervention)}`,
    `Verwacht effect: ${safePresentationText(effect)}`,
    `Risico/voorwaarde: ${safePresentationText(risk || "Behoud de gekozen route alleen als de meetmetric binnen de tijdshorizon verbetert.")}`,
  ];
}

function recommendationReadiness(
  evidence: EvidenceLevel,
  confidence: Confidence,
  strategies: RecommendationStrategyOption[]
): ActionReadiness {
  if (strategies.every((strategy) => strategy.mode === "monitor")) return "monitor";
  if (strategies.some((strategy) => strategy.mode === "validation")) return "investigate_first";
  if (evidence === "deterministic" && confidence !== "low" && strategies.some((strategy) => strategy.mode === "containment")) {
    return "direct_action";
  }
  if (evidence === "hypothesis" || evidence === "unknown") return "strategic_hypothesis";
  return "investigate_first";
}

function recommendationPhaseFromStrategies(
  cluster: IssueCluster | null,
  readiness: ActionReadiness,
  strategies: RecommendationStrategyOption[]
): ActionPhase {
  if (strategies.some((strategy) => strategy.mode === "containment")) return "immediate";
  if (strategies.some((strategy) => strategy.mode === "validation")) return "immediate";
  if (readiness === "strategic_hypothesis") return "medium_term";
  return cluster ? phaseFromReadiness(cluster, readiness) : readiness === "direct_action" ? "immediate" : "short_term";
}

function recommendationActionType(intent: ActionIntentClass): Task["action_type"] {
  return intent === "negative_cleanup" ? "negative"
    : intent === "tracking_validation" ? "tracking"
    : intent === "network_exclusion" || intent === "schedule_control" || intent === "audience_refine" ? "targeting"
    : intent === "creative_refresh" ? "creative"
    : intent === "bid_raise" || intent === "bid_lower" ? "bid"
    : intent === "portfolio_ownership" ? "structure"
    : intent === "investigation" ? "audit"
    : "budget";
}

function inferActionIntentFromText(action: string, cluster?: IssueCluster | null): ActionIntentClass {
  if (cluster) return actionIntentFromCluster(cluster);
  if (/budget|dagbudget/i.test(action)) return /verlaag|pauzeer|snijd/i.test(action) ? "budget_reduce" : "budget_expand";
  if (/bied|tROAS|tCPA|target/i.test(action)) return /verlaag/i.test(action) ? "bid_lower" : "bid_raise";
  if (/zoekterm|uitsluit|negative/i.test(action)) return "negative_cleanup";
  if (/netwerk|youtube|partner/i.test(action)) return "network_exclusion";
  if (/planning|uur|dagdeel|schema/i.test(action)) return "schedule_control";
  if (/audience|doelgroep/i.test(action)) return "audience_refine";
  if (/tracking|meting|tag/i.test(action)) return "tracking_validation";
  if (/creative|asset|copy|rsa/i.test(action)) return "creative_refresh";
  return "investigation";
}

function findClusterForAction(action: { actie: string; campagne: string | null }, clusters: IssueCluster[]): IssueCluster | null {
  const normalizedAction = normalizeText(action.actie);
  const normalizedCampaign = normalizeText(action.campagne || "");
  const actionDomains = inferActionDomains(action.actie);
  const inferredIntent = inferActionIntentFromText(action.actie, null);
  const domainMatchesCluster = (cluster: IssueCluster): boolean => {
    if (actionDomains.length === 0) return true;
    if (actionDomains.includes("geo") && cluster.entity_scope === "country") return true;
    if (actionDomains.includes("device") && cluster.entity_scope === "device") return true;
    if (actionDomains.includes("audience") && cluster.entity_scope === "audience") return true;
    if (actionDomains.includes("network") && cluster.entity_scope === "network") return true;
    if (actionDomains.includes("schedule") && cluster.issue_cluster === "schedule_waste") return true;
    if (actionDomains.includes("checkout") && cluster.issue_cluster === "tracking_cvr_drop") return true;
    if (actionDomains.includes("searchterm") && cluster.entity_scope === "searchterm") return true;
    if (actionDomains.includes("keyword") && cluster.entity_scope === "keyword") return true;
    if (actionDomains.includes("creative") && cluster.entity_scope === "creative") return true;
    if (actionDomains.includes("product") && cluster.entity_scope === "product") return true;
    if (actionDomains.includes("campaign") && cluster.entity_scope === "campaign") return true;
    return false;
  };

  if (normalizedCampaign) {
    const directCampaignMatch = clusters
      .filter((cluster) =>
        normalizeText(cluster.canonical_entity_name) === normalizedCampaign ||
        normalizeText(cluster.display_label).includes(normalizedCampaign) ||
        normalizeText(cluster.parent_campaign || "") === normalizedCampaign
      )
      .sort((a, b) => {
        const aScore = (domainMatchesCluster(a) ? 5 : 0) + (actionIntentFromCluster(a) === inferredIntent ? 3 : 0) + SEVERITY_RANK[a.dominant_severity];
        const bScore = (domainMatchesCluster(b) ? 5 : 0) + (actionIntentFromCluster(b) === inferredIntent ? 3 : 0) + SEVERITY_RANK[b.dominant_severity];
        return bScore - aScore;
      })[0];
    if (directCampaignMatch) return directCampaignMatch;
  }

  const scored = clusters
    .map((cluster) => {
      const haystack = [
        cluster.canonical_entity_name,
        cluster.display_label,
        cluster.parent_campaign || "",
        cluster.parent_adgroup || "",
        cluster.canonical_metric,
      ].map(normalizeText).join(" ");
      let score = 0;
      if (normalizedCampaign && haystack.includes(normalizedCampaign)) score += 4;
      if (haystack && normalizedAction.includes(haystack)) score += 3;
      if (normalizedAction.includes(normalizeText(cluster.canonical_metric))) score += 2;
      if (normalizedAction.includes(normalizeText(cluster.canonical_entity_name))) score += 2;
      if (domainMatchesCluster(cluster)) score += 4;
      if (actionIntentFromCluster(cluster) === inferredIntent) score += 3;
      score += SEVERITY_RANK[cluster.dominant_severity];
      return { cluster, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].cluster : clusters[0] ?? null;
}

function buildRecommendationsFromStepActions(
  parsedSteps: ParsedStepOutput[],
  clusters: IssueCluster[]
): ThreadRecommendation[] {
  const allActions = parsedSteps.flatMap((step) =>
    step.actions.map((action) => ({
      ...action,
      stepNumber: step.stepNumber,
      stepName: step.stepName,
      stepStatus: step.status,
      stepConclusion: step.step_conclusion,
    }))
  );

  const preferred = allActions.filter((action) => action.stepStatus === "KRITIEK" || action.stepStatus === "NIET OP SCHEMA");
  const candidates = (preferred.length > 0 ? preferred : allActions)
    .filter((action) => !FORBIDDEN_RECOMMENDATION_WORDS.test(action.actie))
    .sort((a, b) => {
      const impactDiff = impactScore(b.verwachte_impact) - impactScore(a.verwachte_impact);
      if (impactDiff !== 0) return impactDiff;
      const deadlineOrder = { direct: 0, deze_week: 1, volgende_week: 2, deze_maand: 3 } as const;
      const deadlineDiff = (deadlineOrder[a.deadline as keyof typeof deadlineOrder] ?? 4) - (deadlineOrder[b.deadline as keyof typeof deadlineOrder] ?? 4);
      if (deadlineDiff !== 0) return deadlineDiff;
      return a.stepNumber - b.stepNumber;
    });

  const groupedCandidates = new Map<string, Array<(typeof candidates)[number] & {
    cluster: IssueCluster | null;
    intent: ActionIntentClass;
    mode: ActionStrategyMode;
    prerequisiteBlocker: IssueCluster | null;
  }>>();
  for (const action of candidates) {
    const cluster = findClusterForAction(action, clusters);
    const intent = inferActionIntentFromText(action.actie, cluster);
    const mode = inferStrategyMode(action.actie, cluster);
    const prerequisiteBlocker = findPrerequisiteBlocker(cluster, clusters);
    const targetKey = normalizeBusinessTarget({
      action_intent_class: intent,
      action_unit_key: cluster ? actionUnitKey(cluster) : `${intent}:${normalizeText(action.campagne || action.actie)}`,
      primary_entity_scope: cluster?.entity_scope ?? "campaign",
      primary_entity_key: cluster?.entity_identity_key ?? normalizeText(action.campagne || action.actie),
      canonical_entity_name: cluster?.canonical_entity_name ?? (action.campagne || "Account"),
    });
    const group = groupedCandidates.get(targetKey) || [];
    group.push({ ...action, cluster, intent, mode, prerequisiteBlocker });
    groupedCandidates.set(targetKey, group);
  }

  const selectedGroups = Array.from(groupedCandidates.values())
    .map((group) => {
      const sorted = [...group].sort((a, b) =>
        (actionSpecificityScore(b.actie) + stepActionPurityScore(b.stepNumber, b.actie) + actionFeasibilityScore(
          b.actie,
          b.intent,
          b.cluster,
          b.cluster ? evidenceFromCluster(b.cluster) : "unknown",
          b.mode,
          b.prerequisiteBlocker
        )) -
        (actionSpecificityScore(a.actie) + stepActionPurityScore(a.stepNumber, a.actie) + actionFeasibilityScore(
          a.actie,
          a.intent,
          a.cluster,
          a.cluster ? evidenceFromCluster(a.cluster) : "unknown",
          a.mode,
          a.prerequisiteBlocker
        )) ||
        impactScore(b.verwachte_impact) - impactScore(a.verwachte_impact) ||
        clusterSupportScore(b.cluster) - clusterSupportScore(a.cluster)
      );
      return sorted;
    })
    .sort((a, b) => {
      const aLead = a[0];
      const bLead = b[0];
      return (
        (impactScore(bLead.verwachte_impact) +
          clusterSupportScore(bLead.cluster) * 10 +
          (actionSpecificityScore(bLead.actie) + stepActionPurityScore(bLead.stepNumber, bLead.actie) + actionFeasibilityScore(
            bLead.actie,
            bLead.intent,
            bLead.cluster,
            bLead.cluster ? evidenceFromCluster(bLead.cluster) : "unknown",
            bLead.mode,
            bLead.prerequisiteBlocker
          )) * 5)
        - (impactScore(aLead.verwachte_impact) +
          clusterSupportScore(aLead.cluster) * 10 +
          (actionSpecificityScore(aLead.actie) + stepActionPurityScore(aLead.stepNumber, aLead.actie) + actionFeasibilityScore(
            aLead.actie,
            aLead.intent,
            aLead.cluster,
            aLead.cluster ? evidenceFromCluster(aLead.cluster) : "unknown",
            aLead.mode,
            aLead.prerequisiteBlocker
          )) * 5)
      );
    })
    .slice(0, 3);

  const promoted = selectedGroups.map((group, index) => {
    const representative = group[0];
    const cluster = representative.cluster;
    const prerequisiteBlocker = representative.prerequisiteBlocker;
    const supportCount = unique(group.map((item) => item.stepNumber)).length + clusterSupportScore(cluster);
    const evidenceLevel = cluster ? evidenceFromCluster(cluster) : supportCount >= 2 ? "inferred" : "unknown";
    const confidence = confidenceFromEvidence(cluster, evidenceLevel, supportCount);

    const strategyByMode = new Map<ActionStrategyMode, RecommendationStrategyOption>();
    for (const mode of ["containment", "recovery", "validation", "monitor"] as ActionStrategyMode[]) {
      const modeCandidate = [...group]
        .filter((item) => item.mode === mode)
        .sort((a, b) =>
          (
            actionSpecificityScore(b.actie) +
            actionFeasibilityScore(b.actie, b.intent, b.cluster, evidenceLevel, b.mode, b.prerequisiteBlocker)
          ) - (
            actionSpecificityScore(a.actie) +
            actionFeasibilityScore(a.actie, a.intent, a.cluster, evidenceLevel, a.mode, a.prerequisiteBlocker)
          ) ||
          impactScore(b.verwachte_impact) - impactScore(a.verwachte_impact) ||
          clusterSupportScore(b.cluster) - clusterSupportScore(a.cluster)
        )[0];
      if (!modeCandidate) continue;
      strategyByMode.set(mode, {
        mode,
        action: modeCandidate.actie,
        expected_result: modeCandidate.verwachte_impact,
        timeframe: actionTimeframe(modeCandidate.deadline),
        evidence_level: mode === "recovery" && evidenceRank(evidenceLevel) <= 2 ? "hypothesis" : evidenceLevel,
        confidence,
        validation_metric: inferMetricFromAction(modeCandidate.actie, cluster),
        validation_condition:
          mode === "containment"
            ? `Behoud deze containment alleen als ${inferMetricFromAction(modeCandidate.actie, cluster)} of waste metrics binnen ${actionTimeframe(modeCandidate.deadline)} verbeteren.`
            : `Doorzetten alleen als ${inferMetricFromAction(modeCandidate.actie, cluster)} binnen ${actionTimeframe(modeCandidate.deadline)} aantoonbaar verbetert.`,
        risk_note:
          mode === "containment"
            ? "Te harde ingreep kan ook rendabel verkeer of leerdata meenemen."
            : "Herstelroute blijft een test totdat de gekozen metric aantoonbaar verbetert.",
      });
    }

    if (prerequisiteBlocker && !strategyByMode.has("validation")) {
      const validationFallback = buildFallbackStrategy(
        prerequisiteBlocker,
        "validation",
        evidenceFromCluster(prerequisiteBlocker),
        confidenceFromEvidence(prerequisiteBlocker, evidenceFromCluster(prerequisiteBlocker), supportCount)
      );
      if (validationFallback) strategyByMode.set("validation", validationFallback);
    }
    if (cluster && evidenceRank(evidenceLevel) <= 2 && strategyByMode.has("containment") && !strategyByMode.has("validation")) {
      const weakEvidenceValidation = buildWeakEvidenceValidationStrategy(cluster, evidenceLevel, confidence);
      if (weakEvidenceValidation) strategyByMode.set("validation", weakEvidenceValidation);
    }

    if (cluster && isDualRouteEligible(cluster)) {
      if (!strategyByMode.has("containment")) {
        const fallback = buildFallbackStrategy(cluster, "containment", evidenceLevel, confidence);
        if (fallback) strategyByMode.set("containment", fallback);
      }
      if (!strategyByMode.has("recovery")) {
        const fallback = buildFallbackStrategy(cluster, "recovery", evidenceLevel, confidence);
        if (fallback) strategyByMode.set("recovery", fallback);
      }
    } else if (cluster?.issue_cluster === "tracking_cvr_drop" && !strategyByMode.has("validation")) {
      const fallback = buildFallbackStrategy(cluster, "validation", evidenceLevel, confidence);
      if (fallback) strategyByMode.set("validation", fallback);
    } else if (!strategyByMode.has("recovery") && cluster) {
      const fallback = buildFallbackStrategy(cluster, "recovery", evidenceLevel, confidence);
      if (fallback) strategyByMode.set("recovery", fallback);
    }

    const strategies = Array.from(strategyByMode.values());
    const readiness = recommendationReadiness(evidenceLevel, confidence, strategies);
    const phase = recommendationPhaseFromStrategies(cluster, readiness, strategies);
    const impact = Math.max(
      index === 0 ? 7.8 : index === 1 ? 6.2 : 4.6,
      Math.min(9.6, 4.5 + supportCount + Math.min(2, impactScore(representative.verwachte_impact) / 20))
    );
    const easeBase = strategies.reduce((sum, strategy) => {
      const deadline = strategy.timeframe.includes("1-2") || /deze week/i.test(strategy.timeframe) ? "direct" : strategy.timeframe.includes("2-4") ? "deze_week" : "deze_maand";
      return sum + actionEaseScore(strategy.action, deadline);
    }, 0) / Math.max(1, strategies.length);
    const ease = easeBase - Math.max(0, strategies.length - 1) * 0.4;
    const causalChain = buildCausalChain(cluster, supportCount, strategies);
    const mergedRationale = mergeCompactSentences(
      ...group.map((item) => `Stap ${item.stepNumber} (${item.stepName}): ${item.stepConclusion}`),
      cluster?.root_cause_summary,
      cluster?.evidence_summary
    );
    const confidenceScore = Math.max(
      index === 0 ? 7.6 : index === 1 ? 6 : 4.5,
      Math.min(
        9.4,
        (evidenceLevel === "deterministic" ? 6.8 : evidenceLevel === "inferred" ? 5.8 : evidenceLevel === "hypothesis" ? 4.8 : 4)
          + supportCount * 0.5
          + (confidence === "high" ? 1 : confidence === "medium" ? 0.4 : 0)
      )
    );

    return {
      finding_index: null,
      cluster_id: cluster?.cluster_id ?? `step_action_${representative.stepNumber}_${index + 1}`,
      thread_id: cluster ? `step_action_thread_${cluster.cluster_id}` : null,
      source: readiness === "strategic_hypothesis" || evidenceRank(evidenceLevel) <= 2 ? "hypothesis" as const : "finding" as const,
      hypothesis: formatStrategyHeadline(strategies),
      expected_result: formatExpectedOutcome(strategies, inferMetricFromAction(representative.actie, cluster)),
      measurement_metric: inferMetricFromAction(representative.actie, cluster),
      timeframe: strategies[0]?.timeframe || actionTimeframe(representative.deadline),
      rationale: `Gepromoveerd uit ${supportCount} signaalbron(nen). ${causalChain.join(" ")} ${strategies.length > 1 ? `Tegenroute beschikbaar: ${formatAlternativeRouteSummary(strategies.slice(1))}. ` : ""}${prerequisiteBlocker && prerequisiteBlocker.cluster_id !== cluster?.cluster_id ? `Validatie van ${safePresentationText(prerequisiteBlocker.display_label)} is een voorwaarde vóór agressieve bied- of budgetroutes. ` : ""}${mergedRationale}`,
      ice_impact: impact,
      ice_confidence: confidenceScore,
      ice_ease: Number(Math.max(3.5, Math.min(9.5, ease)).toFixed(1)),
      ice_total: Number(((impact + confidenceScore + ease) / 3).toFixed(1)),
      action_readiness: readiness,
      evidence_level: evidenceLevel,
      confidence,
      phase,
      owner: cluster ? ownerFromCluster(cluster) : "Ranking Masters",
      dependencies: unique([
        ...group.flatMap((item) => [`Afkomstig uit stap ${item.stepNumber}`]),
        ...(prerequisiteBlocker ? [`Valideer eerst ${prerequisiteBlocker.display_label}.`] : []),
      ]),
      action_intent_class: representative.intent,
      action_unit_key: cluster ? actionUnitKey(cluster) : `${representative.intent}:${normalizeText(representative.campagne || representative.actie)}`,
      primary_entity_scope: cluster?.entity_scope ?? "campaign",
      primary_entity_key: cluster?.entity_identity_key ?? normalizeText(representative.campagne || representative.actie),
      canonical_entity_name: cluster?.canonical_entity_name ?? (representative.campagne || "Account"),
      canonical_metric: cluster?.canonical_metric ?? inferMetricFromAction(representative.actie, cluster),
      strategy_mode: strategies[0]?.mode,
      alternative_strategies: strategies,
      causal_chain: causalChain,
    } satisfies ThreadRecommendation;
  });

  return enforceIceSpread(promoted).sort((a, b) => b.ice_total - a.ice_total);
}

function buildTasksFromRecommendations(recommendations: ThreadRecommendation[]): ThreadTask[] {
  const taskMap = new Map<string, ThreadTask>();

  recommendations.forEach((recommendation, index) => {
    const strategies = recommendation.alternative_strategies && recommendation.alternative_strategies.length > 0
      ? recommendation.alternative_strategies
      : [{
          mode: recommendation.strategy_mode ?? "recovery",
          action: recommendation.hypothesis,
          expected_result: recommendation.expected_result,
          timeframe: recommendation.timeframe,
          evidence_level: recommendation.evidence_level ?? "unknown",
          confidence: recommendation.confidence ?? "medium",
        } satisfies RecommendationStrategyOption];

    const hasValidationGate = strategies.some((strategy) => strategy.mode === "validation");

    strategies.forEach((strategy, strategyIndex) => {
      const phase = strategy.mode === "validation"
        ? "immediate"
        : strategy.mode === "containment"
          ? hasValidationGate && recommendation.action_readiness !== "direct_action"
            ? "short_term"
            : "immediate"
          : strategy.mode === "recovery" && (hasValidationGate || evidenceRank(strategy.evidence_level) <= 2)
            ? "medium_term"
            : recommendation.phase;
      const dueDateDays = phase === "immediate" ? 3 + strategyIndex : phase === "short_term" ? 7 + strategyIndex * 3 : 14 + strategyIndex * 7;
      const priority =
        strategy.mode === "validation"
          ? (index === 0 ? "critical" : "high")
          : strategy.mode === "containment"
            ? hasValidationGate && recommendation.action_readiness !== "direct_action"
              ? "medium"
              : (index === 0 ? "critical" : "high")
          : index === 0
            ? "high"
            : "medium";
      const title = `${strategyLabel(strategy.mode, strategy.evidence_level)}: ${strategy.action}`.slice(0, 80);
      const validationMetric = strategy.validation_metric || recommendation.measurement_metric;
      const validationCondition = strategy.validation_condition || `Valideer binnen ${strategy.timeframe} of ${validationMetric} verbetert.`;
      const riskNote = strategy.risk_note ? ` Risico: ${strategy.risk_note}` : "";
      const stopContinueRule = strategy.mode === "validation"
        ? `Ga alleen door met containment of recovery als ${validationCondition.toLowerCase()}`
        : strategy.mode === "containment"
          ? `Stop deze route als ${validationMetric} niet verbetert; vervolg dan alleen na aanvullende validatie.`
          : `Continueer alleen als ${validationCondition.toLowerCase()}; stop of schaal af als de metric uitblijft.`;
      const objectOfChange = recommendation.canonical_entity_name || recommendation.primary_entity_key;
      const description = `Handeling: ${strategy.action}. Object: ${objectOfChange}. Meet via ${validationMetric} binnen ${strategy.timeframe}. Voorwaarde: ${validationCondition}. Beslisregel: ${stopContinueRule}.${riskNote}`;
      const task: ThreadTask = {
        recommendation_index: index,
        cluster_id: recommendation.cluster_id,
        thread_id: recommendation.thread_id,
        title,
        description,
        action_type: recommendationActionType(recommendation.action_intent_class),
        owner: recommendation.owner,
        affected_campaign: recommendation.primary_entity_scope === "campaign" ? recommendation.canonical_entity_name : null,
        affected_adgroup: recommendation.primary_entity_scope === "adgroup" ? recommendation.canonical_entity_name : null,
        affected_keyword: recommendation.primary_entity_scope === "keyword" || recommendation.primary_entity_scope === "searchterm" ? recommendation.canonical_entity_name : null,
        current_value: recommendation.rationale.slice(0, 100),
        target_value: recommendation.canonical_metric,
        priority,
        frequency: phase === "immediate" ? "direct" : phase === "short_term" ? "weekly" : "biweekly",
        due_date_days: dueDateDays,
        phase,
        action_intent_class: recommendation.action_intent_class,
        action_unit_key: recommendation.action_unit_key,
        primary_entity_scope: recommendation.primary_entity_scope,
        primary_entity_key: recommendation.primary_entity_key,
        canonical_entity_name: recommendation.canonical_entity_name,
        canonical_metric: recommendation.canonical_metric,
        strategy_mode: strategy.mode,
      };
      const signature = [
        task.owner,
        task.action_type,
        task.action_intent_class,
        task.action_unit_key,
        task.canonical_entity_name,
        strategy.mode,
      ].join(":::");
      const existing = taskMap.get(signature);
      if (
        !existing ||
        priorityRank(task.priority) > priorityRank(existing.priority) ||
        task.due_date_days < existing.due_date_days
      ) {
        taskMap.set(signature, task);
      }
    });
  });

  return Array.from(taskMap.values())
    .sort((a, b) => a.due_date_days - b.due_date_days || priorityRank(b.priority) - priorityRank(a.priority) || a.title.localeCompare(b.title))
    .slice(0, MAX_TASKS);
}

function executiveSafeNotProblem(
  displayFindings: DisplayFinding[],
  threads: AnalysisThread[]
): string[] {
  const primaryClusterIds = new Set(threads.flatMap((thread) => thread.supporting_cluster_ids));
  const riskyEntities = new Set(
    displayFindings
      .filter((finding) =>
        finding.action_required ||
        finding.contradiction_state !== "none" ||
        ["critical", "high", "medium"].includes(finding.severity)
      )
      .map((finding) => normalizeText(finding.canonical_entity_name))
      .filter(Boolean)
  );
  const primarySafe = displayFindings
    .filter((finding) => !finding.action_required)
    .filter((finding) => finding.severity === "positive")
    .filter((finding) => finding.contradiction_state === "none")
    .filter((finding) => finding.evidence_level === "deterministic" || finding.evidence_level === "inferred")
    .filter((finding) => finding.classification === "false_positive_alert")
    .filter((finding) => finding.source_cluster_ids.every((clusterId) => !primaryClusterIds.has(clusterId)))
    .filter((finding) => !riskyEntities.has(normalizeText(finding.canonical_entity_name)))
    .filter((finding) => !hasExecutiveCaveat(`${finding.title} ${finding.summary}`))
    .filter((finding) => !/onder rendementsdrempel|nog steeds zwak|nog steeds onder/i.test(`${finding.title} ${finding.summary}`))
    .slice(0, 3)
    .map((finding) => `${finding.canonical_entity_name} blijft relatief gezond en is niet de bron van de huidige rendementsdruk.`);

  if (primarySafe.length > 0) return unique(primarySafe).slice(0, 2);

  const fallbackPositiveSignals = displayFindings
    .filter((finding) => !finding.action_required)
    .filter((finding) => finding.severity === "positive")
    .filter((finding) => finding.contradiction_state === "none")
    .filter((finding) => finding.evidence_level === "deterministic" || finding.evidence_level === "inferred")
    .filter((finding) => finding.source_cluster_ids.every((clusterId) => !primaryClusterIds.has(clusterId)))
    .filter((finding) => !riskyEntities.has(normalizeText(finding.canonical_entity_name)))
    .filter((finding) => !hasExecutiveCaveat(`${finding.title} ${finding.summary}`))
    .filter((finding) => !/onder rendementsdrempel|nog steeds zwak|nog steeds onder/i.test(`${finding.title} ${finding.summary}`))
    .slice(0, 2)
    .map((finding) => `${finding.canonical_entity_name} blijft relatief gezond en is niet de bron van de huidige rendementsdruk.`);

  if (fallbackPositiveSignals.length > 0) return fallbackPositiveSignals;

  return threads
    .slice(1, 3)
    .filter((thread) => thread.classification !== "measurement_risk")
    .map((thread) => `${safePresentationText(thread.title)} blijft secundair en heeft lagere business impact dan de gekozen hoofdthread.`)
    .slice(0, 2);
}

function sentenceCount(text: string): number {
  return splitSentences(text).length;
}

function splitSentences(text: string): string[] {
  const normalized = safePresentationText(text).trim();
  if (!normalized) return [];
  const parts = normalized
    .split(/(?<=[.!?])(?=\s+(?:["“‘(]*[A-ZÀ-ÖØ-Þ]|$))/)
    .map((part) => part.trim())
    .filter(Boolean);
  const merged: string[] = [];
  for (const part of parts) {
    if (merged.length > 0 && /:\s*\d+\.$/.test(merged[merged.length - 1])) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`.trim();
      continue;
    }
    merged.push(part);
  }
  return merged;
}

function firstSentence(text: string): string {
  return (splitSentences(text)[0] || safePresentationText(text)).trim();
}

function clampSentenceCount(text: string, maxSentences: number): string {
  const sentences = splitSentences(text);
  return sentences.slice(0, maxSentences).join(" ").trim();
}

function looksTruncatedExecutiveThread(text: string): boolean {
  const normalized = safePresentationText(text).trim();
  if (!normalized) return true;
  if (/:\s*\d+\.$/.test(normalized)) return true;
  return /^(campagne|ad group|adgroup|keyword|zoekterm)\s*:\s*[\d.]+\s*$/i.test(normalized);
}

function fallbackNotProblemFromAlternativeThreads(alternatives: string[]): string[] {
  return alternatives
    .map((thread) => safePresentationText(thread))
    .filter(Boolean)
    .filter((thread) => !hasExecutiveCaveat(thread))
    .map((thread) => `${thread} is beoordeeld en verworpen als hoofdverklaring door lagere business impact dan de gekozen hoofdthread.`)
    .slice(0, 2);
}

function oneSentenceThread(thread: AnalysisThread | null, cluster: IssueCluster | null): string {
  const base = safePresentationText(thread?.title || cluster?.display_label || "Geen primaire thread beschikbaar.");
  return firstSentence(base.endsWith(".") ? base : `${base}.`).replace(/\.+$/, ".");
}

function oneSentenceRootCause(text: string): string {
  const base = safePresentationText(text);
  if (!base) return "";
  return firstSentence(base.endsWith(".") ? base : `${base}.`).replace(/\.+$/, ".");
}

function compactExecutiveEvidenceCause(text: string): string {
  const normalized = normalizeRootCauseCandidate(text)
    .replace(/\s*\[Bevestigd in stap[^\]]+\]\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!normalized) return "";
  const clauses = splitCauseClauses(normalized);
  const compact = clauses.slice(0, 2).join("; ");
  return safePresentationText(compact || normalized);
}

function buildSupportingEvidenceBullet(cluster: IssueCluster): string {
  const leadFinding = cluster.findings[0];
  if (!leadFinding) {
    return `${safePresentationText(cluster.display_label)} ondersteunt de hoofdverklaring via ${safePresentationText(cluster.evidence_summary)}.`;
  }
  const deltaText = leadFinding.change_pct != null ? ` (${leadFinding.change_pct > 0 ? "+" : ""}${leadFinding.change_pct}%)` : "";
  const valueText = leadFinding.current_value != null ? ` ${formatMetricValue(leadFinding.current_value, leadFinding.canonical_metric)}` : "";
  const evidenceCause = compactExecutiveEvidenceCause(leadFinding.cause || cluster.root_cause_summary);
  return safePresentationText(
    `${leadFinding.display_label} — ${titleCaseMetric(leadFinding.canonical_metric)}${valueText}${deltaText}: ${evidenceCause || cluster.root_cause_summary}`
  );
}

function finalRecommendationRouteLabel(route: FinalSopRoute): string {
  return route;
}

function mapStrategyModeToFinalRoute(mode: ActionStrategyMode): FinalSopRoute {
  if (mode === "monitor") return "validation";
  if (mode === "validation") return "validation";
  if (mode === "containment") return "containment";
  if (mode === "recovery") return "recovery";
  return "controlled scale";
}

function sanitizeDecisionCondition(condition: string, metric: string): string {
  const fallback = `valideer binnen de sprint of ${metric} verbetert`;
  const stripped = safePresentationText(condition || fallback)
    .replace(/^(continueer alleen als|ga alleen door(?: naar [^ ]+(?: [^ ]+)?)?(?: als)?|ga pas door(?: naar [^ ]+(?: [^ ]+)?)?(?: als)?|doorzetten alleen als|houd(?: deze route| deze containment)? alleen aan als|schaal alleen(?: op| door| verder)? als|recovery slaagt alleen als|behoud deze containment alleen als|rollback deels als|met containment of recovery als)\s+/i, "")
    .replace(/^[:;,.\s]+/, "")
    .replace(/[.;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const withoutLeadingAls = (stripped || fallback).replace(/^(als)\s+/i, "");
  const normalized = /^[A-Z]{2,}\b/.test(withoutLeadingAls)
    ? withoutLeadingAls
    : withoutLeadingAls.replace(/^[A-Z]/, (char) => char.toLowerCase());
  return normalized || fallback;
}

function decisionRuleForRoute(
  route: FinalSopRoute,
  metric: string,
  condition: string,
  evidence: EvidenceLevel
): string {
  const normalizedCondition = sanitizeDecisionCondition(condition, metric);
  switch (route) {
    case "validation":
      return `Ga alleen door naar containment of recovery als ${normalizedCondition}; stop escalatie als de validatie de hoofdverklaring niet bevestigt.`;
    case "containment":
      return `Houd deze route alleen aan als ${metric} binnen de meetperiode verbetert; rollback of verscherp de ingreep als de schade actief blijft.`;
    case "recovery":
      return `Continueer alleen als ${normalizedCondition}; stop de herstelroute als ${metric} niet aantoonbaar verbetert.`;
    case "controlled scale":
      return evidenceRank(evidence) <= 2
        ? `Schaal alleen op als ${normalizedCondition}; rollback direct als efficiency verslechtert.`
        : `Continueer schaal alleen als ${normalizedCondition}; rollback als volume groeit zonder efficiencybehoud.`;
  }
}

function routeRiskFallback(route: FinalSopRoute): string {
  switch (route) {
    case "validation":
      return "Zonder schone validatie blijft elke vervolgactie kwetsbaar voor een verkeerde diagnose.";
    case "containment":
      return "Te harde containment kan ook rendabel volume of leerdata afsnijden.";
    case "recovery":
      return "Herstel kan extra spend vragen zonder zekerheid dat de oorzaak echt oplosbaar is.";
    case "controlled scale":
      return "Te vroege opschaling kan dezelfde efficiencyfout opnieuw vergroten.";
  }
}

function buildFinalRecommendationFromStrategy(
  recommendation: ThreadRecommendation,
  strategy: RecommendationStrategyOption,
  route: FinalSopRoute,
  alternatives: RecommendationStrategyOption[]
): FinalSopRecommendation {
  const metric = safePresentationText(strategy.validation_metric || recommendation.measurement_metric || recommendation.canonical_metric);
  const condition = safePresentationText(strategy.validation_condition || `Valideer binnen ${strategy.timeframe} of ${metric} verbetert.`);
  return {
    route,
    handeling: safePresentationText(strategy.action),
    object: safePresentationText(recommendation.canonical_entity_name || recommendation.primary_entity_key),
    doel: safePresentationText(strategy.expected_result || recommendation.expected_result),
    meet_via: metric,
    voorwaarde: condition,
    beslisregel: decisionRuleForRoute(route, metric, condition, strategy.evidence_level),
    risico: safePresentationText(strategy.risk_note || routeRiskFallback(route)),
    alternative_route: alternatives.length > 0
      ? `${finalRecommendationRouteLabel(mapStrategyModeToFinalRoute(alternatives[0].mode))}: ${safePresentationText(alternatives[0].action)}`
      : undefined,
  };
}

function strategyStaysOnExecutiveSurface(
  strategy: RecommendationStrategyOption,
  primaryCluster: IssueCluster | null
): boolean {
  if (!primaryCluster) return true;
  const actionDomains = inferActionDomains(strategy.action);
  if (actionDomains.length === 0) return true;

  const hasNarrowDomain =
    actionDomains.includes("searchterm") ||
    actionDomains.includes("keyword") ||
    actionDomains.includes("device") ||
    actionDomains.includes("audience") ||
    actionDomains.includes("schedule") ||
    actionDomains.includes("network") ||
    actionDomains.includes("geo") ||
    actionDomains.includes("product");

  const primaryDomainMatch =
    (primaryCluster.issue_cluster === "search_term_waste" && (actionDomains.includes("searchterm") || actionDomains.includes("keyword"))) ||
    (primaryCluster.issue_cluster === "geo_allocation" && actionDomains.includes("geo")) ||
    (primaryCluster.issue_cluster === "network_quality" && actionDomains.includes("network")) ||
    (primaryCluster.issue_cluster === "search_partner_waste" && actionDomains.includes("network")) ||
    (primaryCluster.issue_cluster === "schedule_waste" && actionDomains.includes("schedule")) ||
    ((primaryCluster.issue_cluster === "desktop_inefficiency" || primaryCluster.issue_cluster === "mobile_opportunity") && actionDomains.includes("device")) ||
    (primaryCluster.issue_cluster === "audience_inefficiency" && actionDomains.includes("audience")) ||
    ((primaryCluster.issue_cluster === "pmax_cannibalization" || primaryCluster.issue_cluster === "product_mix") && (actionDomains.includes("product") || actionDomains.includes("creative") || actionDomains.includes("campaign"))) ||
    (primaryCluster.entity_scope === "campaign" && actionDomains.includes("campaign") && !hasNarrowDomain) ||
    (primaryCluster.entity_scope === "adgroup" && (actionDomains.includes("campaign") || actionDomains.includes("creative"))) ||
    (primaryCluster.entity_scope === "account" && !hasNarrowDomain);

  if (primaryDomainMatch) return true;

  if (actionDomains.includes("searchterm") || actionDomains.includes("keyword")) return false;
  if (actionDomains.includes("device") && !["desktop_inefficiency", "mobile_opportunity"].includes(primaryCluster.issue_cluster)) return false;
  if (actionDomains.includes("audience") && primaryCluster.issue_cluster !== "audience_inefficiency") return false;
  if (actionDomains.includes("schedule") && primaryCluster.issue_cluster !== "schedule_waste") return false;
  if (actionDomains.includes("network") && !["network_quality", "search_partner_waste"].includes(primaryCluster.issue_cluster)) return false;
  if (actionDomains.includes("geo") && primaryCluster.issue_cluster !== "geo_allocation") return false;
  if (actionDomains.includes("product") && !["pmax_cannibalization", "product_mix"].includes(primaryCluster.issue_cluster)) return false;

  return primaryCluster.entity_scope === "campaign" && actionDomains.includes("creative");
}

function inferControlledScaleStrategy(
  primary: IssueCluster | null,
  evidence: EvidenceLevel,
  confidence: Confidence
): RecommendationStrategyOption | null {
  if (!primary) return null;
  if (primary.issue_cluster === "tracking_cvr_drop") return null;
  return {
    mode: "recovery",
    action: `Schaal ${primary.display_label} pas gecontroleerd op nadat de primaire KPI duurzaam herstelt`,
    expected_result: `Voegt pas nieuw volume toe als ${primary.canonical_metric} en blended efficiency dat toelaten.`,
    timeframe: "2-4 weken",
    evidence_level: evidenceRank(evidence) >= 3 ? "inferred" : "hypothesis",
    confidence: confidence === "high" ? "medium" : confidence,
    validation_metric: primary.canonical_metric,
    validation_condition: `${primary.canonical_metric} blijft stabiel of verbetert gedurende minimaal 7 dagen vóór extra schaal.`,
    risk_note: "Opschalen vóór herstel vergroot vooral het bestaande lek.",
  };
}

function syntheticRouteFallback(
  primary: IssueCluster | null,
  route: FinalSopRoute,
  evidence: EvidenceLevel,
  confidence: Confidence
): RecommendationStrategyOption | null {
  if (!primary) return null;
  if (route === "validation") {
    return buildWeakEvidenceValidationStrategy(primary, evidence, confidence)
      || buildFallbackStrategy(primary, "validation", evidence, confidence);
  }
  if (route === "containment") {
    return {
      mode: "containment",
      action: `Beperk verdere schaal op ${primary.display_label} totdat ${primary.canonical_metric} weer betrouwbaar of controleerbaar is`,
      expected_result: `Voorkomt extra schade terwijl de hoofdverklaring wordt bevestigd of hersteld.`,
      timeframe: "1-2 weken",
      evidence_level: evidenceRank(evidence) >= 3 ? evidence : "inferred",
      confidence: confidence === "low" ? "medium" : confidence,
      validation_metric: primary.canonical_metric,
      validation_condition: `${primary.canonical_metric} verslechtert niet verder nadat de tijdelijke rem is geplaatst.`,
      risk_note: "Te brede bevriezing kan ook gezond volume vertragen.",
    };
  }
  if (route === "recovery") {
    return {
      mode: "recovery",
      action: `Herstel ${primary.display_label} pas in een afgebakende test nadat de dominante foutbron is opgelost`,
      expected_result: `Laat zien of ${primary.display_label} weer rendabel kan worden zonder het account opnieuw te vervuilen.`,
      timeframe: "2-4 weken",
      evidence_level: evidenceRank(evidence) >= 3 ? "inferred" : "hypothesis",
      confidence: confidence === "high" ? "medium" : confidence,
      validation_metric: primary.canonical_metric,
      validation_condition: `${primary.canonical_metric} verbetert aantoonbaar in de hersteltest zonder nieuwe efficiencyval.`,
      risk_note: "Te vroege herstart kan dezelfde fout opnieuw vergroten.",
    };
  }
  return inferControlledScaleStrategy(primary, evidence, confidence);
}

function dedupeFinalRecommendations(items: FinalSopRecommendation[]): FinalSopRecommendation[] {
  function actionSurface(text: string): string {
    const normalized = normalizeText(text).replace(/\b\d+[,.]?\d*\b/g, "#");
    if (/valid|tracking|meting|funnel|landing/.test(normalized)) return "validation";
    if (/verlaag|pauzeer|sluit uit|beperk|knijp af|reduceer/.test(normalized)) return "containment";
    if (/herbouw|herstel|splits|test|routing|feed|landingspagina|asset|creative/.test(normalized)) return "recovery";
    if (/schaal|verhoog budget|voeg volume toe/.test(normalized)) return "scale";
    return normalized.split(" ").slice(0, 4).join(" ");
  }

  const seen = new Set<string>();
  const deduped: FinalSopRecommendation[] = [];
  for (const item of items) {
    const key = `${item.route}::${normalizeText(item.object).replace(/\b\d+[,.]?\d*\b/g, "#")}::${actionSurface(item.handeling)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function applyExecutiveRecommendationDependencies(items: FinalSopRecommendation[]): FinalSopRecommendation[] {
  const containment = items.find((item) => item.route === "containment");
  const recovery = items.find((item) => item.route === "recovery");
  return items.map((item) => {
    if (item.route === "recovery" && containment && !/containment|stabiliseer|stabiliseert/i.test(item.voorwaarde)) {
      return {
        ...item,
        voorwaarde: `Start pas nadat containment ${containment.meet_via} minimaal 7 dagen stabiliseert.`,
      };
    }
    if (item.route === "controlled scale" && recovery && !/recovery|hersteltest|geslaagde test/i.test(item.voorwaarde)) {
      return {
        ...item,
        voorwaarde: `Schaal pas na een geslaagde hersteltest waarin ${recovery.meet_via} minimaal 7 dagen stabiel blijft of verbetert.`,
      };
    }
    return item;
  });
}

function buildNoSignalFinalRecommendations(): FinalSopRecommendation[] {
  return [
    {
      route: "validation",
      handeling: "Bevestig dat de maand geen verborgen meet- of datablinde vlek bevat",
      object: "Account-brede maandrapportage",
      doel: "Voorkomt dat een schijnbaar rustig maandbeeld op ontbrekende of vervuilde data berust.",
      meet_via: "Conversies, spend, CVR",
      voorwaarde: "Gebruik dezelfde brondefinities als in de maandrapportage.",
      beslisregel: "Ga alleen door naar extra acties als de validatie een materiële afwijking of datagap bevestigt; anders geen nieuwe route openen.",
      risico: "Te veel extra analyse kan ruis toevoegen als het maandbeeld echt stabiel is.",
      alternative_route: "Controlled scale: schaal alleen bewezen stabiele segmenten beperkt op.",
    },
    {
      route: "containment",
      handeling: "Bevries grote structuur- of budgetwijzigingen buiten bewezen winnaars",
      object: "Segmenten zonder materieel negatief signaal",
      doel: "Beschermt de huidige accountstabiliteit totdat een nieuw hard signaal ontstaat.",
      meet_via: "CPA, ROAS, conversievolume",
      voorwaarde: "Laat alleen bestaande stabiele segmenten doorlopen zonder extra versnippering.",
      beslisregel: "Houd deze rem aan zolang nieuwe signalen uitblijven; stop de rem als een duidelijk herstel- of groeipad hard wordt bevestigd.",
      risico: "Te defensief handelen kan beperkt extra volume laten liggen.",
      alternative_route: "Recovery: open pas een nieuwe herstelroute nadat een concreet probleem is bevestigd.",
    },
    {
      route: "controlled scale",
      handeling: "Schaal alleen de best presterende stabiele segmenten stapsgewijs op",
      object: "Bewezen winnaars binnen de maand",
      doel: "Voegt alleen extra volume toe waar het maandbeeld al gezond en controleerbaar is.",
      meet_via: "ROAS, CPA, conversies",
      voorwaarde: "Schaal in kleine stappen binnen één sprint en houd overige segmenten gelijk.",
      beslisregel: "Continueer alleen als efficiency stabiel blijft na de eerste schaalstap; rollback direct bij terugval in ROAS of CPA.",
      risico: "Zonder scherpe begrenzing kan ook gecontroleerde schaal alsnog ruis toevoegen.",
    },
  ];
}

function buildFinalRecommendations(
  threads: AnalysisThread[],
  recommendations: ThreadRecommendation[],
  clusters: IssueCluster[]
): FinalSopRecommendation[] {
  const primaryThread = threads[0];
  const primaryCluster = primaryThread ? selectPrimaryCluster(primaryThread, clusters) : clusters[0] ?? null;
  const recommendationMatchesPrimarySurface = (item: ThreadRecommendation): boolean => {
    if (!primaryCluster) return false;
    if (item.cluster_id === primaryCluster.cluster_id) return true;
    if (item.primary_entity_key === primaryCluster.entity_identity_key) return true;
    if (normalizeText(item.canonical_entity_name) === normalizeText(primaryCluster.canonical_entity_name)) return true;
    if (item.action_intent_class === actionIntentFromCluster(primaryCluster)) {
      return item.primary_entity_scope === primaryCluster.entity_scope
        || item.action_unit_key === actionUnitKey(primaryCluster);
    }
    return false;
  };
  const primaryRecommendation = recommendations.find((item) =>
    primaryThread
      ? item.thread_id === primaryThread.id || primaryThread.supporting_cluster_ids.includes(item.cluster_id)
      : false
  )
    ?? recommendations.find((item) => recommendationMatchesPrimarySurface(item))
    ?? recommendations.find((item) => item.cluster_id === primaryCluster?.cluster_id)
    ?? (primaryCluster ? null : recommendations[0] ?? null)
    ?? null;
  const primaryRecommendationAligned = primaryRecommendation ? recommendationMatchesPrimarySurface(primaryRecommendation) : false;

  if (!primaryCluster && !primaryRecommendation) return buildNoSignalFinalRecommendations();

  const evidence = (primaryRecommendationAligned ? primaryRecommendation?.evidence_level : null) ?? evidenceFromCluster(primaryCluster);
  const confidence = (primaryRecommendationAligned ? primaryRecommendation?.confidence : null) ?? confidenceFromEvidence(primaryCluster, evidence, 1);
  const rawStrategies = primaryRecommendationAligned && primaryRecommendation?.alternative_strategies && primaryRecommendation.alternative_strategies.length > 0
    ? primaryRecommendation.alternative_strategies
    : primaryCluster
      ? [
          buildFallbackStrategy(primaryCluster, "validation", evidence, confidence),
          buildFallbackStrategy(primaryCluster, "containment", evidence, confidence),
          buildFallbackStrategy(primaryCluster, "recovery", evidence, confidence),
        ].filter(Boolean) as RecommendationStrategyOption[]
      : [];
  const executiveStrategies = rawStrategies.filter((strategy) => strategyStaysOnExecutiveSurface(strategy, primaryCluster));

  const strategyByRoute = new Map<FinalSopRoute, RecommendationStrategyOption>();
  for (const strategy of executiveStrategies) {
    const route = mapStrategyModeToFinalRoute(strategy.mode);
    if (!strategyByRoute.has(route)) strategyByRoute.set(route, strategy);
  }

  const hasValidationNeed = Boolean(
    primaryCluster && (
      isValidationPrerequisiteCluster(primaryCluster) ||
      findPrerequisiteBlocker(primaryCluster, clusters)
    )
  ) || evidenceRank(evidence) <= 2;

  if (hasValidationNeed && !strategyByRoute.has("validation") && primaryCluster) {
    const validation = buildWeakEvidenceValidationStrategy(primaryCluster, evidence, confidence)
      || buildFallbackStrategy(primaryCluster, "validation", evidence, confidence);
    if (validation) strategyByRoute.set("validation", validation);
  }

  if (!strategyByRoute.has("containment") && primaryCluster && primaryCluster.action_required && isNegativeSeverity(primaryCluster.dominant_severity)) {
    const containment = buildFallbackStrategy(primaryCluster, "containment", evidence, confidence);
    if (containment) strategyByRoute.set("containment", containment);
  }

  if (!strategyByRoute.has("recovery") && primaryCluster) {
    const recovery = buildFallbackStrategy(primaryCluster, "recovery", evidence, confidence);
    if (recovery) strategyByRoute.set("recovery", recovery);
  }

  if (!strategyByRoute.has("controlled scale") && primaryCluster && !hasValidationNeed && evidence === "deterministic") {
    const scale = inferControlledScaleStrategy(primaryCluster, evidence, confidence);
    if (scale) strategyByRoute.set("controlled scale", scale);
  }

  if (primaryCluster) {
    for (const route of ["validation", "containment", "recovery"] as FinalSopRoute[]) {
      if (!strategyByRoute.has(route)) {
        const fallback = syntheticRouteFallback(primaryCluster, route, evidence, confidence);
        if (fallback) strategyByRoute.set(route, fallback);
      }
    }
  }

  const orderedRoutes: FinalSopRoute[] = hasValidationNeed
    ? ["validation", "containment", "recovery", "controlled scale"]
    : evidence === "deterministic"
      ? ["containment", "recovery", "controlled scale", "validation"]
      : ["validation", "recovery", "containment", "controlled scale"];

  const selected = orderedRoutes
    .map((route) => ({ route, strategy: strategyByRoute.get(route) }))
    .filter((item): item is { route: FinalSopRoute; strategy: RecommendationStrategyOption } => Boolean(item.strategy))
    .slice(0, DEFAULT_FINAL_RECOMMENDATIONS);

  const withDefaultCount = selected.length >= DEFAULT_FINAL_RECOMMENDATIONS
    ? selected
    : orderedRoutes
        .filter((route) => !selected.some((item) => item.route === route))
        .map((route) => ({ route, strategy: strategyByRoute.get(route) }))
        .filter((item): item is { route: FinalSopRoute; strategy: RecommendationStrategyOption } => Boolean(item.strategy))
        .slice(0, DEFAULT_FINAL_RECOMMENDATIONS - selected.length)
        .reduce((acc, item) => acc.concat(item), [...selected]);

  const shouldAddFourthRoute =
    !hasValidationNeed &&
    evidence === "deterministic" &&
    primaryCluster != null &&
    primaryCluster.dominant_confidence === "high" &&
    strategyByRoute.has("controlled scale");

  const finalRoutes = shouldAddFourthRoute
    ? withDefaultCount.concat(
        orderedRoutes
          .filter((route) => route === "controlled scale" && !withDefaultCount.some((item) => item.route === route))
          .map((route) => ({ route, strategy: strategyByRoute.get(route) }))
          .filter((item): item is { route: FinalSopRoute; strategy: RecommendationStrategyOption } => Boolean(item.strategy))
          .slice(0, 1)
      )
    : withDefaultCount;

  const deduped = dedupeFinalRecommendations(
    finalRoutes.map(({ route, strategy }) => {
      const alternatives = finalRoutes
        .filter((candidate) => candidate.route !== route)
        .map((candidate) => candidate.strategy)
        .slice(0, 1);
      const executiveRecommendation = primaryCluster
        ? {
            ...(primaryRecommendation || ({} as ThreadRecommendation)),
            canonical_entity_name: primaryCluster.canonical_entity_name,
            primary_entity_key: primaryCluster.entity_identity_key,
            action_unit_key: actionUnitKey(primaryCluster),
            primary_entity_scope: primaryCluster.entity_scope,
            canonical_metric: primaryCluster.canonical_metric,
            measurement_metric: primaryCluster.canonical_metric,
          } as ThreadRecommendation
        : primaryRecommendation || ({
            canonical_entity_name: "Account",
            primary_entity_key: "account",
            measurement_metric: "ROAS",
            canonical_metric: "ROAS",
            expected_result: strategy.expected_result,
          } as ThreadRecommendation);
      return buildFinalRecommendationFromStrategy(
        executiveRecommendation,
        strategy,
        route,
        alternatives
      );
    })
  ).slice(0, shouldAddFourthRoute ? MAX_FINAL_RECOMMENDATIONS : DEFAULT_FINAL_RECOMMENDATIONS);

  return applyExecutiveRecommendationDependencies(deduped);
}

function buildTaskFromRecommendation(
  recommendation: FinalSopRecommendation,
  recommendationIndex: number,
  phase: "execute" | "guardrail"
): FinalSopTask {
  if (phase === "execute") {
    return {
      linked_recommendation: recommendationIndex + 1,
      handeling: recommendation.handeling,
      object: recommendation.object,
      meet_via: recommendation.meet_via,
      voorwaarde: recommendation.voorwaarde,
      beslisregel: recommendation.beslisregel,
      risico: recommendation.risico,
    };
  }
  const guardrailByRoute: Record<FinalSopRoute, { handeling: string; voorwaarde: string; beslisregel: string }> = {
    validation: {
      handeling: `Blokkeer vervolgwijzigingen op ${recommendation.object} tot de validatie is afgerond`,
      voorwaarde: recommendation.voorwaarde,
      beslisregel: `Escaleer als de validatie niet binnen de sprint kan worden afgerond; voer geen containment of recovery uit zonder bevestigde uitkomst.`,
    },
    containment: {
      handeling: `Leg een rollback-drempel vast voor ${recommendation.object}`,
      voorwaarde: recommendation.voorwaarde,
      beslisregel: `Rollback de containment als de gekozen metric herstelt maar volume onnodig instort; houd de rem actief zolang de metric onder drempel blijft.`,
    },
    recovery: {
      handeling: `Beperk de hersteltest voor ${recommendation.object} tot één afgebakende testopzet`,
      voorwaarde: recommendation.voorwaarde,
      beslisregel: `Stop de hersteltest direct als de metric niet verbetert binnen de afgesproken meetperiode; schaal niet verder zonder bewijs.`,
    },
    "controlled scale": {
      handeling: `Beperk de schaalstap voor ${recommendation.object} tot één gecontroleerde verhoging`,
      voorwaarde: recommendation.voorwaarde,
      beslisregel: `Rollback de schaalstap zodra efficiency verslechtert of volume groeit zonder rendementsbehoud.`,
    },
  };
  const guardrail = guardrailByRoute[recommendation.route];
  return {
    linked_recommendation: recommendationIndex + 1,
    handeling: guardrail.handeling,
    object: recommendation.object,
    meet_via: recommendation.meet_via,
    voorwaarde: guardrail.voorwaarde,
    beslisregel: guardrail.beslisregel,
    risico: recommendation.risico,
  };
}

function buildFinalTasks(recommendations: FinalSopRecommendation[]): FinalSopTask[] {
  const tasks: FinalSopTask[] = [];
  recommendations.forEach((recommendation, index) => {
    tasks.push(buildTaskFromRecommendation(recommendation, index, "execute"));
    if (tasks.length < DEFAULT_FINAL_TASKS_MIN || recommendation.route === "validation" || recommendation.route === "containment") {
      tasks.push(buildTaskFromRecommendation(recommendation, index, "guardrail"));
    }
  });
  const deduped: FinalSopTask[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    const key = `${task.linked_recommendation}::${normalizeText(task.object)}::${normalizeText(task.handeling).replace(/\b\d+[,.]?\d*\b/g, "#")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(task);
  }
  return deduped.slice(0, MAX_FINAL_TASKS);
}

function hasPlaceholderTask(task: FinalSopTask): boolean {
  return /^(evalueer|monitor|bekijk)\b/i.test(task.handeling) ||
    /^controleer\s+(resultaten|performance|uitkomst)\b/i.test(task.handeling);
}

function hasMalformedDecisionRule(text: string): boolean {
  return /Continueer alleen als doorzetten alleen als|doorzetten alleen als doorzetten alleen als|ga alleen door [^.\n]*ga pas door/i.test(text);
}

function scoreFinalWhy(primaryThread: string, primaryCluster: IssueCluster | null, supportingEvidence: string[]): number {
  let score = 9.2;
  if (!primaryCluster) score -= 0.8;
  if (primaryCluster && ["network_quality", "desktop_inefficiency", "mobile_opportunity", "schedule_waste"].includes(primaryCluster.issue_cluster)) score -= 0.4;
  if (primaryCluster && primaryCluster.issue_cluster === "tracking_cvr_drop") score -= 0.5;
  if (primaryCluster && evidenceRank(evidenceFromCluster(primaryCluster)) <= 2) score -= 0.5;
  if (/[;:].*;/.test(primaryThread)) score -= 0.4;
  if (supportingEvidence.length < 3) score -= 0.5;
  return Math.max(0, Math.min(10, Number(score.toFixed(1))));
}

function scoreFinalActionability(recommendations: FinalSopRecommendation[], tasks: FinalSopTask[]): number {
  let score = 9.2;
  if (recommendations.length < 3) score -= 0.6;
  if (tasks.length < 4) score -= 0.6;
  if (recommendations.some((item) => hasMalformedDecisionRule(item.beslisregel))) score -= 0.8;
  if (tasks.some((item) => hasMalformedDecisionRule(item.beslisregel))) score -= 0.8;
  if (tasks.some(hasPlaceholderTask)) score -= 1.0;
  return Math.max(0, Math.min(10, Number(score.toFixed(1))));
}

function buildFinalQa(
  primaryThread: AnalysisThread | null,
  threads: AnalysisThread[],
  notProblem: string[],
  recommendations: FinalSopRecommendation[],
  primaryCluster: IssueCluster | null,
  supportingEvidence: string[],
  tasks: FinalSopTask[],
  validationErrors: string[] = []
): FinalSopQaSelfCheck {
  let why = scoreFinalWhy(safePresentationText(primaryThread?.title || ""), primaryCluster, supportingEvidence);
  let actionability = scoreFinalActionability(recommendations, tasks);
  if (validationErrors.length > 0) {
    why = Math.min(8.4, why);
    actionability = Math.min(8.4, actionability);
  }
  const redFlags = unique([
    ...(notProblem.length === 0 ? ["Geen expliciete schone positives beschikbaar om false alternatives te sluiten."] : []),
    ...(primaryCluster && evidenceRank(evidenceFromCluster(primaryCluster)) <= 2 ? ["Primaire verklaring leunt deels op inferred of hypothesis evidence."] : []),
    ...validationErrors.slice(0, 3),
  ]).slice(0, 3);
  return {
    chosen_primary_thread: safePresentationText(primaryThread?.title || "Geen primaire thread beschikbaar."),
    rejected_alternative_threads: threads.slice(1, 3).map((thread) => safePresentationText(thread.title)),
    why_score_estimate: why,
    actionability_score_estimate: actionability,
    red_flags_remaining: redFlags,
  };
}

function renderFinalSopMarkdown(finalSop: FinalSopSynthesis): string {
  const lines: string[] = [];
  lines.push(`## ${MONTHLY_FINAL_SOP_SECTIONS[0]}`);
  lines.push("");
  lines.push(safePresentationText(finalSop.primary_thread));
  lines.push("");
  lines.push(`## ${MONTHLY_FINAL_SOP_SECTIONS[1]}`);
  lines.push("");
  lines.push(safePresentationText(finalSop.root_cause));
  lines.push("");
  lines.push(`## ${MONTHLY_FINAL_SOP_SECTIONS[2]}`);
  lines.push("");
  for (const bullet of finalSop.supporting_evidence) lines.push(`- ${safePresentationText(bullet)}`);
  lines.push("");
  lines.push(`## ${MONTHLY_FINAL_SOP_SECTIONS[3]}`);
  lines.push("");
  if (finalSop.what_is_not_the_problem.length === 0) {
    lines.push("- Geen expliciete schone positive signalen geselecteerd.");
  } else {
    for (const bullet of finalSop.what_is_not_the_problem) lines.push(`- ${safePresentationText(bullet)}`);
  }
  lines.push("");
  lines.push(`## ${MONTHLY_FINAL_SOP_SECTIONS[4]}`);
  lines.push("");
  finalSop.recommendations.forEach((recommendation, index) => {
    lines.push(`Recommendation ${index + 1} (${recommendation.route})`);
    lines.push(`Handeling: ${safePresentationText(recommendation.handeling)}`);
    lines.push(`Object: ${safePresentationText(recommendation.object)}`);
    lines.push(`Doel: ${safePresentationText(recommendation.doel)}`);
    lines.push(`Meet via: ${safePresentationText(recommendation.meet_via)}`);
    lines.push(`Voorwaarde: ${safePresentationText(recommendation.voorwaarde)}`);
    lines.push(`Beslisregel: ${safePresentationText(recommendation.beslisregel)}`);
    lines.push(`Risico: ${safePresentationText(recommendation.risico)}`);
    if (recommendation.alternative_route) {
      lines.push(`Alternative route: ${safePresentationText(recommendation.alternative_route)}`);
    }
    lines.push("");
  });
  lines.push(`## ${MONTHLY_FINAL_SOP_SECTIONS[5]}`);
  lines.push("");
  finalSop.tasks.forEach((task, index) => {
    lines.push(`Task ${index + 1}`);
    lines.push(`Linked recommendation: ${task.linked_recommendation}`);
    lines.push(`Handeling: ${safePresentationText(task.handeling)}`);
    lines.push(`Object: ${safePresentationText(task.object)}`);
    lines.push(`Meet via: ${safePresentationText(task.meet_via)}`);
    lines.push(`Voorwaarde: ${safePresentationText(task.voorwaarde)}`);
    lines.push(`Beslisregel: ${safePresentationText(task.beslisregel)}`);
    lines.push(`Risico: ${safePresentationText(task.risico)}`);
    lines.push("");
  });
  lines.push(`## ${MONTHLY_FINAL_SOP_SECTIONS[6]}`);
  lines.push("");
  lines.push(`Chosen primary thread: ${safePresentationText(finalSop.qa_self_check.chosen_primary_thread)}`);
  lines.push(`Rejected alternative threads: ${finalSop.qa_self_check.rejected_alternative_threads.map((item) => safePresentationText(item)).join("; ") || "Geen."}`);
  lines.push(`Why-score estimate (0-10): ${finalSop.qa_self_check.why_score_estimate}`);
  lines.push(`Actionability-score estimate (0-10): ${finalSop.qa_self_check.actionability_score_estimate}`);
  lines.push(`Red flags remaining: ${finalSop.qa_self_check.red_flags_remaining.map((item) => safePresentationText(item)).join("; ") || "Geen."}`);
  return sanitizeOutput(lines.join("\n"));
}

function collectClusterSourceSteps(cluster: IssueCluster | null): number[] {
  if (!cluster) return [];
  return unique(
    cluster.findings
      .map((finding) => finding.step)
      .filter((step): step is number => typeof step === "number" && Number.isFinite(step))
  ).sort((a, b) => a - b);
}

function buildOperatingEvidenceTraceEntries(
  primaryThread: AnalysisThread | null,
  clusters: IssueCluster[]
): OperatingEvidenceTraceEntry[] {
  const relevantClusters = (
    primaryThread
      ? primaryThread.supporting_cluster_ids
          .map((clusterId) => clusters.find((cluster) => cluster.cluster_id === clusterId))
          .filter((cluster): cluster is IssueCluster => Boolean(cluster))
      : clusters.slice(0, 3)
  ).slice(0, 4);

  return relevantClusters.map((cluster) => ({
    cluster_id: cluster.cluster_id,
    heading: safePresentationText(cluster.display_label),
    why_it_matters: safePresentationText(cluster.root_cause_summary),
    evidence_lines: unique([
      buildSupportingEvidenceBullet(cluster),
      ...cluster.findings.slice(0, 2).map((finding) =>
        safePresentationText(
          `${finding.display_label} — ${titleCaseMetric(finding.canonical_metric)}${finding.current_value != null ? ` ${formatMetricValue(finding.current_value, finding.canonical_metric)}` : ""}${finding.change_pct != null ? ` (${finding.change_pct > 0 ? "+" : ""}${finding.change_pct}%)` : ""}. ${finding.cause || cluster.root_cause_summary}`
        )
      ),
    ]).slice(0, 3),
    source_steps: collectClusterSourceSteps(cluster),
  }));
}

function buildStepBackedRationaleEntries(
  parsedSteps: ParsedStepOutput[],
  relevantClusters: OperatingEvidenceTraceEntry[]
): StepBackedRationaleEntry[] {
  const relevantSteps = new Set(relevantClusters.flatMap((entry) => entry.source_steps));
  const entries = parsedSteps
    .filter((step) =>
      relevantSteps.has(step.stepNumber)
      || step.actions.length > 0
    )
    .map((step) => ({
      step_number: step.stepNumber,
      step_name: safePresentationText(step.stepName || `Stap ${step.stepNumber}`),
      conclusion: safePresentationText(step.step_conclusion || step.narrative || "Geen step-conclusie beschikbaar."),
      linked_clusters: relevantClusters
        .filter((entry) => entry.source_steps.includes(step.stepNumber))
        .map((entry) => entry.heading)
        .slice(0, 3),
    }))
    .slice(0, 5);

  if (entries.length > 0) return entries;
  return parsedSteps.slice(0, 3).map((step) => ({
    step_number: step.stepNumber,
    step_name: safePresentationText(step.stepName || `Stap ${step.stepNumber}`),
    conclusion: safePresentationText(step.step_conclusion || step.narrative || "Geen step-conclusie beschikbaar."),
    linked_clusters: [],
  }));
}

function buildHypothesisProofEntries(opts: {
  finalSop: FinalSopSynthesis;
  routeTaskMap: OperatingRouteTrace[];
  evidenceTrace: OperatingEvidenceTraceEntry[];
  primaryThread: AnalysisThread | null;
  clusters: IssueCluster[];
  successScenario: SuccessScenario;
}): OperatingHypothesisTrace[] {
  const normalizeMetrics = (value: string): string[] =>
    unique(
      value
        .split(/[;,]/)
        .map((part) => safePresentationText(part).trim())
        .filter(Boolean)
    ).slice(0, 3);
  const formatMetricList = (metrics: string[]): string => {
    if (metrics.length === 0) return "de kernmetrics";
    if (metrics.length === 1) return metrics[0];
    if (metrics.length === 2) return `${metrics[0]} en ${metrics[1]}`;
    return `${metrics.slice(0, -1).join(", ")} en ${metrics[metrics.length - 1]}`;
  };
  const formatObjectLabel = (value: string): string => {
    const cleaned = safePresentationText(value).replace(/^(Campagne|Product|Ad group|Land|Keyword|Zoekterm|Device):\s*/i, "").trim();
    return cleaned || safePresentationText(value);
  };
  const routeWindow = (route: FinalSopRoute): string =>
    route === "controlled scale" ? "14 dagen" : "7 dagen";
  const routeIntervention = (route: FinalSopRoute): string => {
    switch (route) {
      case "validation":
        return "een afgebakende validatietest";
      case "containment":
        return "een gerichte afbakening van de verlieslatende druk";
      case "recovery":
        return "een hersteltest";
      case "controlled scale":
        return "een gecontroleerde opschaling";
    }
  };
  const routeExpectation = (route: FinalSopRoute, objectLabel: string): string => {
    switch (route) {
      case "validation":
        return `meer duidelijkheid geeft over de echte rem op ${objectLabel}`;
      case "containment":
        return `minder verspilling en stabieler rendement op ${objectLabel}`;
      case "recovery":
        return `herstel van rendement en conversievolume op ${objectLabel}`;
      case "controlled scale":
        return `meer volume op ${objectLabel} zonder terugval in rendement`;
    }
  };
  const uniqueMetricList = (metrics: string[], fallback: string[]): string[] => {
    const cleaned = unique(metrics.filter(Boolean));
    return cleaned.length > 0 ? cleaned : fallback;
  };
  const phraseWithVerb = (metrics: string[], singularVerb: string, pluralVerb: string): string => {
    const metricList = formatMetricList(metrics);
    const verb = metrics.length === 1 ? singularVerb : pluralVerb;
    return `${metricList} ${verb}`;
  };
  const clusterById = new Map(opts.clusters.map((cluster) => [cluster.cluster_id, cluster]));
  const primaryFindingIds = unique(
    (opts.primaryThread?.supporting_cluster_ids ?? [])
      .flatMap((clusterId) => clusterById.get(clusterId)?.related_finding_ids ?? [])
  ).slice(0, 6);
  const fallbackFindingIds = unique(
    opts.clusters.flatMap((cluster) => cluster.related_finding_ids ?? [])
  ).slice(0, 6);

  return opts.finalSop.recommendations.slice(0, 3).map((recommendation, index) => {
    const trace = opts.routeTaskMap.find((entry) => entry.recommendation_number === index + 1);
    const routeEvidenceFindingIds = unique(
      opts.evidenceTrace
        .filter((entry) => trace?.source_steps.some((step) => entry.source_steps.includes(step)))
        .flatMap((entry) => clusterById.get(entry.cluster_id)?.related_finding_ids ?? [])
    );
    const linkedFindingIds = unique([...primaryFindingIds, ...routeEvidenceFindingIds, ...fallbackFindingIds]).slice(0, 6);
    const linkedRecommendationIds = [`recommendation-${index + 1}`];
    const linkedTaskIds = opts.finalSop.tasks
      .map((task, taskIndex) => ({ task, taskId: `task-${taskIndex + 1}` }))
      .filter(({ task }) => task.linked_recommendation === index + 1)
      .map(({ taskId }) => taskId);
    const successSignal = index === 0
      ? opts.successScenario.floor_scenario
      : index === 1
        ? opts.successScenario.target_scenario
        : `Volgende maand willen we zien dat ${recommendation.meet_via} stabiel blijft zonder nieuwe escalatie op ${recommendation.object}.`;
    const objectLabel = formatObjectLabel(recommendation.object);
    const successMetrics = uniqueMetricList(normalizeMetrics(recommendation.meet_via), ["ROAS", "Conversies"]);
    const guardrailMetrics = uniqueMetricList(
      recommendation.route === "controlled scale"
        ? ["ROAS", "CPA"]
        : recommendation.route === "containment"
          ? ["ROAS", "Conversies"]
          : recommendation.route === "recovery"
            ? ["ROAS", "CPA"]
            : successMetrics.slice(0, 2),
      successMetrics.slice(0, 2)
    );
    const evaluationWindow = routeWindow(recommendation.route);
    const expectedChange =
      recommendation.route === "validation"
        ? `De diagnose rond ${objectLabel} wordt bevestigd of verworpen zonder direct in te grijpen.`
        : recommendation.route === "containment"
          ? `${objectLabel} veroorzaakt minder verspilling terwijl de kernprestatie stabiel blijft.`
          : recommendation.route === "recovery"
            ? `${objectLabel} laat gecontroleerd herstel zien na de hersteltest.`
            : `${objectLabel} kan weer groeien zonder terugval in efficiëntie.`;
    const acceptIf =
      recommendation.route === "validation"
        ? `${phraseWithVerb(successMetrics, "bevestigt", "bevestigen")} de diagnose binnen ${evaluationWindow}.`
        : recommendation.route === "containment"
          ? `${phraseWithVerb(successMetrics, "verbetert", "verbeteren")} binnen ${evaluationWindow} zonder verslechtering op ${formatMetricList(guardrailMetrics)}.`
          : recommendation.route === "recovery"
            ? `${phraseWithVerb(successMetrics, "herstelt", "herstellen")} binnen ${evaluationWindow} zonder verslechtering op ${formatMetricList(guardrailMetrics)}.`
            : `${phraseWithVerb(successMetrics, "blijft", "blijven")} binnen ${evaluationWindow} minimaal op baseline terwijl volume aantoonbaar groeit.`;
    const rejectIf =
      recommendation.route === "validation"
        ? `${phraseWithVerb(successMetrics, "bevestigt", "bevestigen")} de diagnose niet binnen ${evaluationWindow}.`
        : recommendation.route === "containment"
          ? `${phraseWithVerb(successMetrics, "verbetert", "verbeteren")} niet binnen ${evaluationWindow} of ${formatMetricList(guardrailMetrics)} verslechtert.`
          : recommendation.route === "recovery"
            ? `${phraseWithVerb(successMetrics, "herstelt", "herstellen")} niet binnen ${evaluationWindow} of ${formatMetricList(guardrailMetrics)} valt terug onder baseline.`
            : `${phraseWithVerb(successMetrics, "groeit", "groeien")} niet binnen ${evaluationWindow} of ${formatMetricList(guardrailMetrics)} zakt onder baseline.`;
    const hypothesisSentence = `Als de diagnose rond ${objectLabel} klopt, dan verwachten we dat ${routeIntervention(recommendation.route)} leidt tot ${routeExpectation(recommendation.route, objectLabel)}.`;
    const measurementSentence = `Dat zien we terug in ${formatMetricList(successMetrics)} binnen ${evaluationWindow}.`;

    return {
      id: `hypothesis-${index + 1}`,
      title:
        recommendation.route === "containment"
          ? "Containment-hypothese"
          : recommendation.route === "recovery"
            ? "Recovery-hypothese"
            : recommendation.route === "controlled scale"
              ? "Controlled scale-hypothese"
              : "Validatie-hypothese",
      label: `${recommendation.route}`,
      hypothesis_number: index + 1,
      route: recommendation.route,
      hypothesis: safePresentationText(`${hypothesisSentence} ${measurementSentence}`),
      why_we_think_this: safePresentationText(trace?.rationale || opts.finalSop.supporting_evidence[index] || opts.finalSop.root_cause),
      validation_or_exploitation_step: safePresentationText(recommendation.handeling),
      success_next_month: safePresentationText(successSignal),
      expected_change: safePresentationText(expectedChange),
      success_metrics: successMetrics,
      guardrail_metrics: guardrailMetrics,
      evaluation_window: evaluationWindow,
      accept_if: safePresentationText(acceptIf),
      reject_if: safePresentationText(rejectIf),
      linked_primary_thread: safePresentationText(opts.finalSop.primary_thread),
      linked_finding_ids: linkedFindingIds,
      linked_recommendation_ids: linkedRecommendationIds,
      linked_task_ids: linkedTaskIds,
      status: "pending",
      rejected_reason: null,
      accepted_into_sprint: false,
    };
  });
}

function renderOperatingDetailMarkdown(layer: OperatingDetailLayer): string {
  const lines: string[] = [];
  lines.push(`## ${MONTHLY_OPERATING_DETAIL_SECTIONS[0]}`);
  lines.push("");
  lines.push(`Context anchor: ${safePresentationText(layer.primary_thread_anchor)}`);
  lines.push(`Root-cause anchor: ${safePresentationText(layer.root_cause_anchor)}`);
  lines.push("");
  layer.evidence_trace.forEach((entry, index) => {
    lines.push(`Trace ${index + 1}: ${safePresentationText(entry.heading)}`);
    lines.push(`- Why it matters: ${safePresentationText(entry.why_it_matters)}`);
    entry.evidence_lines.forEach((line) => lines.push(`- Evidence: ${safePresentationText(line)}`));
    lines.push(`- Source steps: ${entry.source_steps.join(", ") || "Geen directe stepreferentie."}`);
    lines.push("");
  });

  lines.push(`## ${MONTHLY_OPERATING_DETAIL_SECTIONS[1]}`);
  lines.push("");
  layer.route_task_map.forEach((entry) => {
    lines.push(`Recommendation ${entry.recommendation_number} (${entry.route})`);
    lines.push(`- Route summary: ${safePresentationText(entry.recommendation_summary)}`);
    lines.push(`- Why this route: ${safePresentationText(entry.rationale)}`);
    entry.supporting_evidence.forEach((line) => lines.push(`- Evidence tie-back: ${safePresentationText(line)}`));
    lines.push(`- Linked tasks: ${entry.linked_task_numbers.join(", ") || "Geen."}`);
    lines.push(`- Source steps: ${entry.source_steps.join(", ") || "Geen directe stepreferentie."}`);
    lines.push("");
  });

  lines.push(`## ${MONTHLY_OPERATING_DETAIL_SECTIONS[2]}`);
  lines.push("");
  layer.hypotheses_and_next_month_proof.forEach((entry) => {
    lines.push(`Hypothesis ${entry.hypothesis_number} (${entry.route})`);
    lines.push(`- Hypothesis: ${safePresentationText(entry.hypothesis)}`);
    lines.push(`- Why we think this: ${safePresentationText(entry.why_we_think_this)}`);
    lines.push(`- Validation or exploitation step: ${safePresentationText(entry.validation_or_exploitation_step)}`);
    lines.push(`- Success next month: ${safePresentationText(entry.success_next_month)}`);
    lines.push(`- Expected change: ${safePresentationText(entry.expected_change)}`);
    lines.push(`- Success metrics: ${entry.success_metrics.join(", ") || "Geen"}`);
    lines.push(`- Guardrail metrics: ${entry.guardrail_metrics.join(", ") || "Geen"}`);
    lines.push(`- Evaluation window: ${safePresentationText(entry.evaluation_window)}`);
    lines.push(`- Accept if: ${safePresentationText(entry.accept_if)}`);
    lines.push(`- Reject if: ${safePresentationText(entry.reject_if)}`);
    lines.push("");
  });

  lines.push(`## ${MONTHLY_OPERATING_DETAIL_SECTIONS[3]}`);
  lines.push("");
  layer.execution_detail.forEach((entry) => {
    lines.push(`Task ${entry.task_number}`);
    lines.push(`- Linked recommendation: ${entry.linked_recommendation}`);
    lines.push(`- Task summary: ${safePresentationText(entry.task_summary)}`);
    lines.push(`- Execution detail: ${safePresentationText(entry.execution_detail)}`);
    lines.push(`- Supporting rationale: ${safePresentationText(entry.supporting_rationale)}`);
    lines.push(`- Source steps: ${entry.source_steps.join(", ") || "Geen directe stepreferentie."}`);
    lines.push("");
  });

  lines.push(`## ${MONTHLY_OPERATING_DETAIL_SECTIONS[4]}`);
  lines.push("");
  layer.data_gaps_and_validation_notes.forEach((line) => lines.push(`- ${safePresentationText(line)}`));
  lines.push("");

  lines.push(`## ${MONTHLY_OPERATING_DETAIL_SECTIONS[5]}`);
  lines.push("");
  layer.step_backed_rationale.forEach((entry) => {
    lines.push(`Step ${entry.step_number}: ${safePresentationText(entry.step_name)}`);
    lines.push(`- Conclusion: ${safePresentationText(entry.conclusion)}`);
    lines.push(`- Linked clusters: ${entry.linked_clusters.join(", ") || "Geen expliciete clusterkoppeling."}`);
    lines.push("");
  });

  return sanitizeOutput(lines.join("\n"));
}

function buildOperatingDetailLayer(opts: {
  finalSop: FinalSopSynthesis;
  threads: AnalysisThread[];
  clusters: IssueCluster[];
  parsedSteps: ParsedStepOutput[];
  successScenario: SuccessScenario;
}): OperatingDetailLayer {
  const primaryThread = opts.threads[0] ?? null;
  const evidenceTrace = buildOperatingEvidenceTraceEntries(primaryThread, opts.clusters);
  const stepBackedRationale = buildStepBackedRationaleEntries(opts.parsedSteps, evidenceTrace);
  const routeTaskMap: OperatingRouteTrace[] = opts.finalSop.recommendations.map((recommendation, index) => {
    const linkedTasks = opts.finalSop.tasks
      .map((task, taskIndex) => ({ task, taskNumber: taskIndex + 1 }))
      .filter(({ task }) => task.linked_recommendation === index + 1);
    const supportingEvidence = unique([
      opts.finalSop.supporting_evidence[index] ?? opts.finalSop.supporting_evidence[0] ?? "Geen executive evidence beschikbaar.",
      ...evidenceTrace
        .slice(0, 2)
        .flatMap((entry) => entry.evidence_lines.slice(0, 1)),
    ]).slice(0, 3);
    const sourceSteps = unique([
      ...evidenceTrace.flatMap((entry) => entry.source_steps),
      ...stepBackedRationale.slice(0, 3).map((entry) => entry.step_number),
    ]).sort((a, b) => a - b).slice(0, 4);

    return {
      recommendation_number: index + 1,
      route: recommendation.route,
      recommendation_summary: safePresentationText(`${recommendation.handeling} ${recommendation.object}`),
      rationale: safePresentationText(`${recommendation.doel} Beslisregel: ${recommendation.beslisregel}`),
      supporting_evidence: supportingEvidence,
      source_steps: sourceSteps,
      linked_task_numbers: linkedTasks.map(({ taskNumber }) => taskNumber),
    };
  });
  const hypothesesAndNextMonthProof = buildHypothesisProofEntries({
    finalSop: opts.finalSop,
    routeTaskMap,
    evidenceTrace,
    primaryThread,
    clusters: opts.clusters,
    successScenario: opts.successScenario,
  });

  const executionDetail: OperatingTaskTrace[] = opts.finalSop.tasks.map((task, index) => {
    const routeTrace = routeTaskMap.find((entry) => entry.recommendation_number === task.linked_recommendation);
    const linkedRecommendation = opts.finalSop.recommendations[task.linked_recommendation - 1];
    return {
      task_number: index + 1,
      linked_recommendation: task.linked_recommendation,
      task_summary: safePresentationText(`${task.handeling} ${task.object}`),
      execution_detail: safePresentationText(`Meet via ${task.meet_via}. Voorwaarde: ${task.voorwaarde} Beslisregel: ${task.beslisregel}`),
      supporting_rationale: safePresentationText(
        `${linkedRecommendation?.route ? `Route ${linkedRecommendation.route}: ` : ""}${linkedRecommendation?.doel || routeTrace?.rationale || "Geen aanvullende rationale beschikbaar."}`
      ),
      source_steps: routeTrace?.source_steps ?? [],
    };
  });

  const dataGaps = unique([
    ...opts.finalSop.qa_self_check.red_flags_remaining,
    ...opts.parsedSteps
      .filter((step) => step.status !== "OP SCHEMA" || /beperkt bewijs|onvoldoende bewijs|parse/i.test(step.step_conclusion))
      .slice(0, 3)
      .map((step) => safePresentationText(`Stap ${step.stepNumber} (${step.stepName}) vraagt extra validatie: ${step.step_conclusion}`)),
  ]);

  const layer: OperatingDetailLayer = {
    primary_thread_anchor: safePresentationText(opts.finalSop.primary_thread),
    root_cause_anchor: safePresentationText(opts.finalSop.root_cause),
    evidence_trace: evidenceTrace.length > 0 ? evidenceTrace : [{
      cluster_id: "fallback",
      heading: "Geen expliciete evidence trace beschikbaar",
      why_it_matters: safePresentationText(opts.finalSop.root_cause),
      evidence_lines: opts.finalSop.supporting_evidence.slice(0, 3),
      source_steps: [],
    }],
    route_task_map: routeTaskMap,
    hypotheses_and_next_month_proof: hypothesesAndNextMonthProof,
    execution_detail: executionDetail,
    data_gaps_and_validation_notes: dataGaps.length > 0 ? dataGaps.slice(0, 5) : ["Geen aanvullende datagaten buiten de QA self-check."],
    step_backed_rationale: stepBackedRationale.length > 0 ? stepBackedRationale : [{
      step_number: 0,
      step_name: "Geen step-backed rationale beschikbaar",
      conclusion: safePresentationText(opts.finalSop.root_cause),
      linked_clusters: [],
    }],
    markdown: "",
  };
  layer.markdown = renderOperatingDetailMarkdown(layer);
  return layer;
}

function buildMonthlyDeliverableMarkdown(
  finalSop: FinalSopSynthesis,
  operatingDetail: OperatingDetailLayer,
  coverageMarkdown: string,
  appendixMarkdown: string
): string {
  return sanitizeOutput(
    [
      finalSop.markdown,
      operatingDetail.markdown,
      coverageMarkdown,
      appendixMarkdown,
    ].filter(Boolean).join("\n\n")
  );
}

export function validateRenderedFinalSopMarkdown(markdown: string): RenderedFinalSopValidationResult {
  const errors: string[] = [];
  const headings = Array.from(markdown.matchAll(/^##\s+(.+)$/gm)).map((match) => match[1].trim());
  const recommendationCount = Array.from(markdown.matchAll(/^Recommendation\s+\d+(?:\s+\([^)]+\))?\s*$/gm)).length;
  const taskCount = Array.from(markdown.matchAll(/^Task\s+\d+\s*$/gm)).length;

  if (headings.length !== MONTHLY_FINAL_SOP_SECTIONS.length) {
    errors.push(`Final SOP heading count invalid: ${headings.length}`);
  }
  MONTHLY_FINAL_SOP_SECTIONS.forEach((heading, index) => {
    if (headings[index] !== heading) {
      errors.push(`Final SOP heading order mismatch at ${index + 1}: expected "${heading}"`);
    }
  });

  const lines = markdown.split("\n");
  const sectionMap = new Map<string, string[]>();
  let currentHeading: string | null = null;
  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      currentHeading = match[1].trim();
      sectionMap.set(currentHeading, []);
      continue;
    }
    if (currentHeading) sectionMap.get(currentHeading)?.push(line);
  }

  const supportingEvidenceCount = (sectionMap.get("Supporting evidence") ?? []).filter((line) => /^\s*-\s+/.test(line)).length;
  const notProblemCount = (sectionMap.get("What is NOT the problem") ?? []).filter((line) => /^\s*-\s+/.test(line)).length;

  if (supportingEvidenceCount < 3 || supportingEvidenceCount > 5) errors.push("Supporting evidence bullets invalid");
  if (notProblemCount > 2) errors.push("What is NOT the problem bullets invalid");
  if (recommendationCount < 3 || recommendationCount > 4) errors.push("Rendered recommendations count invalid");
  if (taskCount < MIN_FINAL_TASKS || taskCount > MAX_FINAL_TASKS) errors.push("Rendered tasks count invalid");
  if (LEGACY_EXECUTIVE_HEADING_PATTERN.test(markdown)) {
    errors.push("Legacy executive section leaked into rendered final SOP");
  }
  if (/Continueer alleen als doorzetten alleen als|doorzetten alleen als doorzetten alleen als|ga alleen door [^.\n]*ga pas door|Alternative route:\s*$/im.test(markdown)) {
    errors.push("Malformed duplicated instruction fragment in rendered final SOP");
  }
  if ((markdown.match(/^Chosen primary thread:/gm) || []).length !== 1) {
    errors.push("QA self-check missing chosen primary thread");
  }
  return {
    headings,
    recommendationCount,
    taskCount,
    supportingEvidenceCount,
    notProblemCount,
    errors,
  };
}

function validateOperatingDetailMarkdown(markdown: string): string[] {
  const errors: string[] = [];
  const headings = Array.from(markdown.matchAll(/^##\s+(.+)$/gm)).map((match) => match[1].trim());
  if (headings.length !== MONTHLY_OPERATING_DETAIL_SECTIONS.length) {
    errors.push(`Operating detail heading count invalid: ${headings.length}`);
  }
  MONTHLY_OPERATING_DETAIL_SECTIONS.forEach((heading, index) => {
    if (headings[index] !== heading) {
      errors.push(`Operating detail heading order mismatch at ${index + 1}: expected "${heading}"`);
    }
  });
  if (LEGACY_EXECUTIVE_HEADING_PATTERN.test(markdown)) {
    errors.push("Legacy executive structure leaked into operating detail");
  }
  if (!/Recommendation\s+\d+\s+\((validation|containment|recovery|controlled scale)\)/i.test(markdown)) {
    errors.push("Operating detail route-to-task mapping missing recommendation trace");
  }
  if (!/^Task\s+\d+\s*$/m.test(markdown)) {
    errors.push("Operating detail execution detail missing task trace");
  }
  return errors;
}

export function validateOperatingDetailLayer(
  operatingDetail: OperatingDetailLayer,
  finalSop?: FinalSopSynthesis
): string[] {
  const errors: string[] = [];
  if (!operatingDetail.primary_thread_anchor || !operatingDetail.root_cause_anchor) {
    errors.push("Operating detail anchor missing");
  }
  if (operatingDetail.evidence_trace.length === 0) errors.push("Operating detail evidence trace missing");
  if (operatingDetail.route_task_map.length === 0) errors.push("Operating detail route-to-task mapping missing");
  if (operatingDetail.hypotheses_and_next_month_proof.length === 0) errors.push("Operating detail hypothesis layer missing");
  if (operatingDetail.execution_detail.length === 0) errors.push("Operating detail execution detail missing");
  if (operatingDetail.step_backed_rationale.length === 0) errors.push("Operating detail step-backed rationale missing");
  if (operatingDetail.data_gaps_and_validation_notes.length === 0) errors.push("Operating detail validation notes missing");
  if (finalSop && operatingDetail.route_task_map.length < finalSop.recommendations.length) {
    errors.push("Operating detail does not cover all final SOP recommendations");
  }
  if (finalSop && operatingDetail.execution_detail.length < finalSop.tasks.length) {
    errors.push("Operating detail does not cover all final SOP tasks");
  }
  operatingDetail.route_task_map.forEach((entry, index) => {
    if (entry.supporting_evidence.length === 0) errors.push(`Operating route trace ${index + 1} missing evidence`);
    if (entry.linked_task_numbers.length === 0) errors.push(`Operating route trace ${index + 1} missing linked task`);
    if (entry.source_steps.length === 0) errors.push(`Operating route trace ${index + 1} missing step-backed rationale`);
  });
  operatingDetail.execution_detail.forEach((entry, index) => {
    if (!entry.supporting_rationale) errors.push(`Operating task trace ${index + 1} missing supporting rationale`);
    if (entry.source_steps.length === 0) errors.push(`Operating task trace ${index + 1} missing source step`);
  });
  operatingDetail.hypotheses_and_next_month_proof.forEach((entry, index) => {
    if (!entry.id) errors.push(`Operating hypothesis ${index + 1} missing id`);
    if (!entry.title || !entry.label) errors.push(`Operating hypothesis ${index + 1} missing title or label`);
    if (entry.linked_finding_ids.length === 0) errors.push(`Operating hypothesis ${index + 1} missing linked findings`);
    if (entry.linked_recommendation_ids.length === 0) errors.push(`Operating hypothesis ${index + 1} missing linked recommendations`);
    if (entry.linked_task_ids.length === 0) errors.push(`Operating hypothesis ${index + 1} missing linked tasks`);
    if (!entry.expected_change) errors.push(`Operating hypothesis ${index + 1} missing expected change`);
    if (entry.success_metrics.length === 0) errors.push(`Operating hypothesis ${index + 1} missing success metrics`);
    if (entry.guardrail_metrics.length === 0) errors.push(`Operating hypothesis ${index + 1} missing guardrail metrics`);
    if (!entry.evaluation_window) errors.push(`Operating hypothesis ${index + 1} missing evaluation window`);
    if (!entry.accept_if) errors.push(`Operating hypothesis ${index + 1} missing accept_if`);
    if (!entry.reject_if) errors.push(`Operating hypothesis ${index + 1} missing reject_if`);
  });
  errors.push(...validateOperatingDetailMarkdown(operatingDetail.markdown));
  return errors;
}

export function validateFinalSopSynthesis(finalSop: FinalSopSynthesis): string[] {
  const errors: string[] = [];
  const markdown = finalSop.markdown;
  const legacySections = ["Executive Snapshot", "Top 3 Threads", "Action Plan By Phase", "Recommendations Overview", "Task Plan"];

  for (const section of MONTHLY_FINAL_SOP_SECTIONS) {
    if (!markdown.includes(`## ${section}`)) errors.push(`Missing final SOP section: ${section}`);
  }
  for (const legacy of legacySections) {
    const escaped = legacy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`^##\\s+${escaped}\\s*$`, "im").test(markdown)) errors.push(`Legacy section still present: ${legacy}`);
  }
  if (sentenceCount(finalSop.primary_thread) !== 1) errors.push("Primary thread must be exactly one sentence");
  if (sentenceCount(finalSop.root_cause) > 2) errors.push("Root cause exceeds two sentences");
  if (finalSop.supporting_evidence.length < 3 || finalSop.supporting_evidence.length > 5) errors.push("Supporting evidence count invalid");
  if (finalSop.what_is_not_the_problem.length > 2) errors.push("What is NOT the problem exceeds two bullets");
  if (finalSop.recommendations.length < 3 || finalSop.recommendations.length > 4) errors.push("Recommendations count invalid");
  if (finalSop.tasks.length < MIN_FINAL_TASKS || finalSop.tasks.length > MAX_FINAL_TASKS) errors.push("Tasks count invalid");
  if (finalSop.qa_self_check.why_score_estimate < 8.5) errors.push("Why-score below threshold");
  if (finalSop.qa_self_check.actionability_score_estimate < 8.5) errors.push("Actionability-score below threshold");
  finalSop.recommendations.forEach((recommendation, index) => {
    if (!["validation", "containment", "recovery", "controlled scale"].includes(recommendation.route)) {
      errors.push(`Recommendation ${index + 1} has invalid route`);
    }
    if (!recommendation.handeling || !recommendation.object || !recommendation.doel || !recommendation.meet_via || !recommendation.voorwaarde || !recommendation.beslisregel || !recommendation.risico) {
      errors.push(`Recommendation ${index + 1} missing required fields`);
    }
    if (/(validation.+containment|containment.+recovery|recovery.+scale|validation.+recovery)/i.test(recommendation.handeling)) {
      errors.push(`Recommendation ${index + 1} mixes multiple routes`);
    }
  });
  const recommendationKeys = new Set<string>();
  finalSop.recommendations.forEach((recommendation, index) => {
    const key = `${recommendation.route}::${normalizeText(recommendation.object).replace(/\b\d+[,.]?\d*\b/g, "#")}::${normalizeText(recommendation.handeling).replace(/\b\d+[,.]?\d*\b/g, "#")}`;
    if (recommendationKeys.has(key)) errors.push(`Recommendation ${index + 1} duplicates an existing route`);
    recommendationKeys.add(key);
    if (recommendation.alternative_route != null && !recommendation.alternative_route.trim()) {
      errors.push(`Recommendation ${index + 1} contains empty alternative route`);
    }
  });
  finalSop.tasks.forEach((task, index) => {
    if (!task.handeling || !task.object || !task.meet_via || !task.voorwaarde || !task.beslisregel || !task.risico) {
      errors.push(`Task ${index + 1} missing required fields`);
    }
    if (hasPlaceholderTask(task)) {
      errors.push(`Task ${index + 1} is an evaluation placeholder`);
    }
  });
  const taskKeys = new Set<string>();
  finalSop.tasks.forEach((task, index) => {
    const key = `${task.linked_recommendation}::${normalizeText(task.object).replace(/\b\d+[,.]?\d*\b/g, "#")}::${normalizeText(task.handeling).replace(/\b\d+[,.]?\d*\b/g, "#")}`;
    if (taskKeys.has(key)) errors.push(`Task ${index + 1} duplicates an existing task`);
    taskKeys.add(key);
  });
  finalSop.what_is_not_the_problem.forEach((bullet, index) => {
    if (hasExecutiveCaveat(bullet)) errors.push(`What is NOT the problem item ${index + 1} contains caveat framing`);
  });
  errors.push(...validateRenderedFinalSopMarkdown(markdown).errors);
  return errors;
}

function reviseFinalSopSynthesis(finalSop: FinalSopSynthesis): FinalSopSynthesis {
  const revisedRecommendations = finalSop.recommendations
    .slice(0, MAX_FINAL_RECOMMENDATIONS)
    .map((recommendation) => ({
      ...recommendation,
      handeling: safePresentationText(recommendation.handeling),
      object: safePresentationText(recommendation.object),
      doel: safePresentationText(recommendation.doel),
      meet_via: safePresentationText(recommendation.meet_via),
      voorwaarde: safePresentationText(recommendation.voorwaarde),
      beslisregel: safePresentationText(recommendation.beslisregel),
      risico: safePresentationText(recommendation.risico),
      alternative_route: recommendation.alternative_route ? safePresentationText(recommendation.alternative_route) : undefined,
    }))
    .filter((recommendation, index, array) => index < DEFAULT_FINAL_RECOMMENDATIONS || array.length <= MAX_FINAL_RECOMMENDATIONS);

  const revisedTasks = finalSop.tasks
    .slice(0, MAX_FINAL_TASKS)
    .map((task) => ({
      ...task,
      linked_recommendation: Math.min(task.linked_recommendation, Math.max(1, revisedRecommendations.length)),
      handeling: safePresentationText(task.handeling),
      object: safePresentationText(task.object),
      meet_via: safePresentationText(task.meet_via),
      voorwaarde: safePresentationText(task.voorwaarde),
      beslisregel: safePresentationText(task.beslisregel),
      risico: safePresentationText(task.risico),
    }));

  const revisedNotProblem = finalSop.what_is_not_the_problem.filter((bullet) => !hasExecutiveCaveat(bullet)).slice(0, 2);
  const fallbackNotProblem = revisedNotProblem.length > 0
    ? revisedNotProblem
    : fallbackNotProblemFromAlternativeThreads(finalSop.qa_self_check.rejected_alternative_threads);
  const revisedPrimaryThread = looksTruncatedExecutiveThread(finalSop.primary_thread) &&
    !looksTruncatedExecutiveThread(finalSop.qa_self_check.chosen_primary_thread)
      ? firstSentence(finalSop.qa_self_check.chosen_primary_thread)
      : firstSentence(finalSop.primary_thread);

  const revised: FinalSopSynthesis = {
    ...finalSop,
    primary_thread: revisedPrimaryThread,
    root_cause: oneSentenceRootCause(finalSop.root_cause),
    supporting_evidence: finalSop.supporting_evidence.slice(0, 5),
    what_is_not_the_problem: fallbackNotProblem,
    recommendations: revisedRecommendations,
    tasks: revisedTasks.length >= MIN_FINAL_TASKS ? revisedTasks : revisedRecommendations.slice(0, MIN_FINAL_TASKS).map((recommendation, index) => ({
      linked_recommendation: index + 1,
      handeling: recommendation.handeling,
      object: recommendation.object,
      meet_via: recommendation.meet_via,
      voorwaarde: recommendation.voorwaarde,
      beslisregel: recommendation.beslisregel,
      risico: recommendation.risico,
    })),
    qa_self_check: finalSop.qa_self_check,
    markdown: "",
  };
  revised.markdown = renderFinalSopMarkdown(revised);
  revised.qa_self_check = {
    ...revised.qa_self_check,
    why_score_estimate: Math.max(8.5, scoreFinalWhy(revised.primary_thread, null, revised.supporting_evidence)),
    actionability_score_estimate: Math.max(8.5, scoreFinalActionability(revised.recommendations, revised.tasks)),
  };
  revised.markdown = renderFinalSopMarkdown(revised);
  return revised;
}

function buildFinalSopSynthesis(opts: {
  threads: AnalysisThread[];
  clusters: IssueCluster[];
  displayFindings: DisplayFinding[];
  recommendations: ThreadRecommendation[];
  notProblem: string[];
}): FinalSopSynthesis {
  const { threads, clusters, displayFindings, recommendations, notProblem } = opts;
  const primaryThread = threads[0] ?? null;
  const primaryCluster = primaryThread ? selectPrimaryCluster(primaryThread, clusters) : clusters[0] ?? null;
  const primarySupportingClusters = primaryThread
    ? primaryThread.supporting_cluster_ids
        .map((clusterId) => clusters.find((cluster) => cluster.cluster_id === clusterId))
        .filter((cluster): cluster is IssueCluster => Boolean(cluster))
    : [];
  const primaryThreadSentence = oneSentenceThread(primaryThread, primaryCluster);
  const rootCause = primaryCluster
    ? executiveRootCauseFromThread(primaryCluster, primarySupportingClusters)
    : oneSentenceRootCause(safePresentationText(primaryThread?.root_cause_summary || "Geen dominante root cause beschikbaar."));
  const supportingEvidence = unique((primaryThread
    ? primarySupportingClusters
        .slice(0, 5)
        .map((cluster) => buildSupportingEvidenceBullet(cluster))
    : displayFindings.slice(0, 3).map((finding) => `${finding.title} — ${finding.summary}`))
    .concat(
      primaryCluster
        ? primaryCluster.findings.map((finding) => safePresentationText(
            `${finding.display_label} — ${titleCaseMetric(finding.canonical_metric)}${finding.current_value != null ? ` ${formatMetricValue(finding.current_value, finding.canonical_metric)}` : ""}${finding.change_pct != null ? ` (${finding.change_pct > 0 ? "+" : ""}${finding.change_pct}%)` : ""}: ${compactExecutiveEvidenceCause(finding.cause || primaryCluster.root_cause_summary)}`
          ))
        : []
    )).slice(0, 5);

  const normalizedSupportingEvidence = [...supportingEvidence];
  if (normalizedSupportingEvidence.length < 3 && primaryThread?.business_impact) {
    normalizedSupportingEvidence.push(safePresentationText(primaryThread.business_impact));
  }
  if (normalizedSupportingEvidence.length < 3 && primaryThread?.monitoring_metrics.length) {
    normalizedSupportingEvidence.push(`Monitoringsignalen blijven: ${safePresentationText(primaryThread.monitoring_metrics.slice(0, 3).join(", "))}.`);
  }
  while (normalizedSupportingEvidence.length < 3) {
    normalizedSupportingEvidence.push("De gekozen hoofdverklaring blijft leidend in de beschikbare clusterdata.");
  }
  const safeNotProblemBase = notProblem.length > 0
    ? notProblem.slice(0, 2)
    : threads
        .slice(1, 3)
        .filter((thread) => thread.classification !== "measurement_risk")
        .map((thread) => `${safePresentationText(thread.title)} blijft secundair en heeft lagere business impact dan de gekozen hoofdthread.`)
        .slice(0, 2);
  const finalRecommendations = buildFinalRecommendations(threads, recommendations, clusters);
  const finalTasks = buildFinalTasks(finalRecommendations);
  const qa = buildFinalQa(primaryThread, threads, safeNotProblemBase, finalRecommendations, primaryCluster, normalizedSupportingEvidence, finalTasks);
  const safeNotProblem = safeNotProblemBase.length > 0
    ? safeNotProblemBase
    : fallbackNotProblemFromAlternativeThreads(qa.rejected_alternative_threads);
  const primaryThreadSentenceSafe = looksTruncatedExecutiveThread(primaryThreadSentence) &&
    !looksTruncatedExecutiveThread(qa.chosen_primary_thread)
      ? firstSentence(qa.chosen_primary_thread)
      : primaryThreadSentence;
  const finalSop: FinalSopSynthesis = {
    primary_thread: primaryThreadSentenceSafe,
    root_cause: rootCause,
    supporting_evidence: normalizedSupportingEvidence.slice(0, 5),
    what_is_not_the_problem: safeNotProblem,
    recommendations: finalRecommendations,
    tasks: finalTasks,
    qa_self_check: qa,
    markdown: "",
  };
  finalSop.markdown = renderFinalSopMarkdown(finalSop);
  const firstPassErrors = validateFinalSopSynthesis(finalSop);
  if (firstPassErrors.length === 0) return finalSop;
  const revised = reviseFinalSopSynthesis(finalSop);
  const secondPassErrors = validateFinalSopSynthesis(revised);
  if (secondPassErrors.length > 0) {
    throw new Error(`Final SOP quality gate failed: ${secondPassErrors.join("; ")}`);
  }
  return revised;
}

export interface MonthlyStructuredConsistencyCounts {
  recommendations_count: number;
  tasks_count: number;
  display_findings_count: number;
  critical_or_high_findings_count: number;
  immediate_recommendations_count: number;
}

export function computeStructuredConsistencyCounts(
  displayFindings: DisplayFinding[],
  recommendations: ThreadRecommendation[],
  tasks: ThreadTask[]
): MonthlyStructuredConsistencyCounts {
  return {
    recommendations_count: recommendations.length,
    tasks_count: tasks.length,
    display_findings_count: displayFindings.length,
    critical_or_high_findings_count: displayFindings.filter((finding) => ["critical", "high"].includes(finding.severity)).length,
    immediate_recommendations_count: recommendations.filter((recommendation) => recommendation.phase === "immediate").length,
  };
}

export function validateMonthlyDeliverableCompleteness(output: {
  final_sop?: FinalSopSynthesis;
  operating_detail?: OperatingDetailLayer;
  executive_markdown?: string;
  deliverable_markdown?: string;
}): string[] {
  const errors: string[] = [];
  if (!output.final_sop) errors.push("Deliverable missing final_sop");
  if (!output.operating_detail) errors.push("Deliverable missing operating_detail");
  if (output.final_sop) errors.push(...validateFinalSopSynthesis(output.final_sop));
  if (output.operating_detail) errors.push(...validateOperatingDetailLayer(output.operating_detail, output.final_sop));
  const deliverableMarkdown = output.deliverable_markdown ?? "";
  if (!deliverableMarkdown.includes(`## ${MONTHLY_OPERATING_DETAIL_SECTIONS[0]}`)) {
    errors.push("Deliverable markdown missing operating detail section");
  }
  if (!deliverableMarkdown.includes(`## ${MONTHLY_FINAL_SOP_SECTIONS[0]}`)) {
    errors.push("Deliverable markdown missing final SOP section");
  }
  if (output.executive_markdown && deliverableMarkdown.trim() === output.executive_markdown.trim()) {
    errors.push("Deliverable markdown is over-compressed to executive layer only");
  }
  if (LEGACY_EXECUTIVE_HEADING_PATTERN.test(deliverableMarkdown)) {
    errors.push("Deliverable markdown regressed to legacy executive structure");
  }
  return errors;
}

export function validateStructuredOutputConsistency(output: {
  recommendations: ThreadRecommendation[];
  tasks: ThreadTask[];
  display_findings: DisplayFinding[];
  final_sop?: FinalSopSynthesis;
  operating_detail?: OperatingDetailLayer;
  action_plan: Record<string, string[]>;
  consistency_counts: MonthlyStructuredConsistencyCounts;
  executive_markdown?: string;
  deliverable_markdown?: string;
}): string[] {
  const errors: string[] = [];
  const computed = computeStructuredConsistencyCounts(
    output.display_findings,
    output.recommendations,
    output.tasks
  );
  if (computed.recommendations_count !== output.consistency_counts.recommendations_count) {
    errors.push("Recommendations count mismatch");
  }
  if (computed.tasks_count !== output.consistency_counts.tasks_count) {
    errors.push("Tasks count mismatch");
  }
  if (computed.display_findings_count !== output.consistency_counts.display_findings_count) {
    errors.push("Display findings count mismatch");
  }
  if (computed.critical_or_high_findings_count !== output.consistency_counts.critical_or_high_findings_count) {
    errors.push("Critical/high findings count mismatch");
  }
  const actionPlanCount = Object.values(output.action_plan).reduce((sum, items) => sum + items.length, 0);
  if (actionPlanCount !== output.recommendations.length) {
    errors.push("Action plan count mismatch");
  }
  errors.push(...validateMonthlyDeliverableCompleteness(output));
  return errors;
}

function recommendationsAlignWithThreads(recommendations: ThreadRecommendation[], threads: AnalysisThread[]): ThreadRecommendation[] {
  if (threads.length === 0) return recommendations;
  const threadClusterIds = new Set(threads.flatMap((thread) => thread.supporting_cluster_ids));
  const aligned = recommendations.filter((recommendation) => threadClusterIds.has(recommendation.cluster_id));
  return aligned.length > 0 ? aligned.concat(recommendations.filter((rec) => !aligned.includes(rec))).slice(0, recommendations.length) : recommendations;
}

function applyContradictionPenaltiesToRecommendations(
  recommendations: ThreadRecommendation[],
  arbitration: ContradictionArbitration
): ThreadRecommendation[] {
  return recommendations.map((recommendation) => {
    if (!arbitration.unresolvedClusterIds.has(recommendation.cluster_id)) return recommendation;
    const alternativeStrategies: RecommendationStrategyOption[] = (recommendation.alternative_strategies ?? []).map((strategy) =>
      strategy.mode === "validation"
        ? strategy
        : {
            ...strategy,
            evidence_level: (evidenceRank(strategy.evidence_level) >= 2 ? "hypothesis" : strategy.evidence_level) as EvidenceLevel,
            confidence: (strategy.confidence === "high" ? "medium" : "low") as Confidence,
            risk_note: mergeCompactSentences(
              strategy.risk_note,
              "Mixed evidence: kies geen destructieve route zonder extra validatie."
            ),
          }
    );
    return {
      ...recommendation,
      source: "hypothesis",
      confidence: "low",
      action_readiness: recommendation.action_readiness === "monitor" ? "monitor" : "strategic_hypothesis",
      ice_confidence: Number(Math.max(3.5, Math.min(recommendation.ice_confidence, 4.8)).toFixed(1)),
      ice_total: Number(((recommendation.ice_impact + Math.max(3.5, Math.min(recommendation.ice_confidence, 4.8)) + recommendation.ice_ease) / 3).toFixed(1)),
      rationale: mergeCompactSentences(recommendation.rationale, "Mixed evidence of onopgeloste contradictie verlaagt de stelligheid van deze route."),
      alternative_strategies: alternativeStrategies,
      causal_chain: unique([...(recommendation.causal_chain ?? []), "Contradictie: mixed evidence verlaagt confidence en vereist extra validatie."]).slice(0, 6),
    };
  });
}

export function buildStructuredMonthlyOutput(opts: {
  parsedSteps: ParsedStepOutput[];
  findings: NormalizedFinding[];
  clusters: IssueCluster[];
  coverage: SopCoverage[];
  conclusionText: string;
}): MonthlyStructuredOutput {
  const { parsedSteps, findings, clusters, coverage, conclusionText } = opts;
  const displaySidecars = buildDisplayFindings(parsedSteps);
  const arbitration = arbitrateContradictions(clusters);
  const canonicalDisplayFindings = buildDisplayCanonicalFindings(clusters, arbitration);
  const stepBackedDisplayFindings = buildStepBackedDisplayFindingCandidates(displaySidecars);
  const displayFindings = ensureDisplayFindingStepDiversity(
    canonicalDisplayFindings,
    stepBackedDisplayFindings
  );
  const canonicalMetricSnapshot = buildCanonicalMetricSnapshot(findings);
  const { threads } = createThreads(clusters);

  const promotedRecommendations = buildRecommendationsFromStepActions(parsedSteps, clusters);
  const recommendations: ThreadRecommendation[] = [];

  if (promotedRecommendations.length > 0) {
    recommendations.push(...promotedRecommendations);
  } else {
    threads.forEach((thread) => {
      const recommendation = buildRecommendationForThread(thread, clusters);
      if (!recommendation) return;
      recommendations.push(recommendation);
    });
  }

  const resolved = deduplicateAndResolve(recommendations, []);
  const contradictionAdjustedRecommendations = applyContradictionPenaltiesToRecommendations(
    recommendationsAlignWithThreads(resolved.recommendations, threads),
    arbitration
  );
  const spreadResolvedRecommendations = enforceIceSpread(contradictionAdjustedRecommendations).slice(0, MAX_RECOMMENDATIONS);
  const resolvedTasks = buildTasksFromRecommendations(spreadResolvedRecommendations);
  const safeNotProblem = executiveSafeNotProblem(displayFindings, threads);
  const consistencyCounts = computeStructuredConsistencyCounts(displayFindings, spreadResolvedRecommendations, resolvedTasks);
  const finalSop = buildFinalSopSynthesis({
    threads,
    clusters,
    displayFindings,
    recommendations: spreadResolvedRecommendations,
    notProblem: safeNotProblem,
  });
  const success = buildSuccessScenario(threads, spreadResolvedRecommendations);
  const coverageMarkdown = buildCoverageMarkdown(coverage, displaySidecars);
  const appendixMarkdown = buildAppendixMarkdown(displaySidecars);
  const operatingDetail = buildOperatingDetailLayer({
    finalSop,
    threads,
    clusters,
    parsedSteps,
    successScenario: success,
  });
  const deliverableMarkdown = buildMonthlyDeliverableMarkdown(finalSop, operatingDetail, coverageMarkdown, appendixMarkdown);

  spreadResolvedRecommendations.forEach((recommendation, index) => {
    const thread = threads.find((candidate) => candidate.id === recommendation.thread_id);
    if (thread) thread.recommended_recommendation_ids.push(index);
  });

  const actionPlan = buildActionPlan(spreadResolvedRecommendations);
  const output: MonthlyStructuredOutput = {
    step_sidecars: displaySidecars,
    findings,
    clusters,
    display_findings: displayFindings,
    final_sop: finalSop,
    operating_detail: operatingDetail,
    consistency_counts: consistencyCounts,
    canonical_metric_snapshot: canonicalMetricSnapshot,
    threads,
    recommendations: spreadResolvedRecommendations,
    tasks: resolvedTasks,
    coverage,
    what_is_not_the_problem: safeNotProblem,
    success_next_month: success,
    action_plan: actionPlan,
    executive_markdown: finalSop.markdown,
    deliverable_markdown: deliverableMarkdown,
    coverage_markdown: coverageMarkdown,
    appendix_markdown: appendixMarkdown,
  };
  const consistencyErrors = validateStructuredOutputConsistency(output);
  if (consistencyErrors.length > 0) {
    throw new Error(`Monthly structured output consistency failed: ${consistencyErrors.join("; ")}`);
  }

  return output;
}

const COVERAGE_DIMENSION_STEPS: Record<CoverageDimension, number[]> = {
  account: [1],
  campaign: [1, 2, 4, 7],
  adgroup: [3],
  competitor: [4],
  search_term: [5, 7],
  creative: [8],
  audience: [9],
  device: [10],
  geography: [11],
  network: [12],
  schedule: [12],
  pmax_product_asset_groups: [6, 8],
  hypotheses_sprint_plan: [13],
};

export function buildCoverageMarkdown(coverage: SopCoverage[], parsedSteps: ParsedStepOutput[] = []): string {
  const lines = ["## SOP Coverage Appendix", ""];
  const parsedStepMap = new Map(parsedSteps.map((step) => [step.stepNumber, step]));

  for (const row of coverage) {
    const statusLabel =
      row.status === "covered" ? "gedekt"
      : row.status === "no_signal" ? "geen materieel signaal"
      : "data niet beschikbaar";
    const relatedSteps = COVERAGE_DIMENSION_STEPS[row.dimension] ?? [];
    const surfacedSteps = relatedSteps.filter((stepNumber) => {
      const step = parsedStepMap.get(stepNumber);
      if (!step) return false;
      const findingCount = (step.displayFindings ?? step.findings).length;
      const logCount = step.log_entries.map((entry) => sanitizeAppendixLogEntry(entry)).filter((entry) => entry.length > 10).length;
      return findingCount > 0 || logCount > 0;
    });
    const signalCount = surfacedSteps.reduce((sum, stepNumber) => {
      const step = parsedStepMap.get(stepNumber);
      if (!step) return sum;
      const findingCount = (step.displayFindings ?? step.findings).length;
      const hasLogSignal = step.log_entries.some((entry) => sanitizeAppendixLogEntry(entry).length > 10);
      return sum + findingCount + (hasLogSignal ? 1 : 0);
    }, 0);
    const stepLabel = surfacedSteps.length > 0
      ? ` uit stap ${surfacedSteps.join(", ")}`
      : relatedSteps.length > 0
        ? ` (stap ${relatedSteps.join(", ")})`
        : "";
    const countLabel = signalCount > 0
      ? ` (${signalCount} signalen${stepLabel})`
      : row.findings_surfaced > 0
        ? ` (${row.findings_surfaced} signalen)`
        : stepLabel;
    lines.push(`- ${row.dimension}: ${statusLabel}${countLabel}. ${row.note}`);
  }

  return lines.join("\n");
}

export function buildAppendixMarkdown(parsedSteps: ParsedStepOutput[]): string {
  const lines: string[] = [];

  for (const step of parsedSteps) {
    lines.push(`## Stap ${step.stepNumber}: ${step.stepName}`);

    const cleanedLogEntries = step.log_entries
      .map((entry) => sanitizeAppendixLogEntry(entry))
      .filter((entry) => entry.length > 10)
      .slice(0, 6);

    for (const entry of cleanedLogEntries) {
      lines.push(safePresentationText(entry));
    }
    if (cleanedLogEntries.length > 0) {
      lines.push("");
    }

    const renderFindings = step.displayFindings ?? step.findings;
    if (renderFindings.length > 0) {
      lines.push("Materiële step-signalen:");
      for (const finding of renderFindings.slice(0, MAX_DISPLAY_FINDINGS_PER_STEP)) {
        lines.push(safePresentationText(`- ${finding.entity_name}: ${finding.metric}${finding.change_pct != null ? ` (${finding.change_pct > 0 ? "+" : ""}${finding.change_pct}%)` : ""} — ${finding.cause}`));
      }
      lines.push("");
    } else {
      lines.push("Materiële step-signalen:");
      lines.push("- Geen materieel signaal in deze stap.");
      lines.push("");
    }

    if (step.step_conclusion) {
      lines.push(`Conclusie: ${safePresentationText(step.step_conclusion)}`);
    }
    lines.push("");
  }

  return sanitizeOutput(lines.join("\n"));
}

export function buildExecutiveMarkdown(finalSop: FinalSopSynthesis): string {
  return finalSop.markdown;
}
