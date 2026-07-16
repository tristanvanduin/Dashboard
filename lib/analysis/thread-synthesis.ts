import type { IssueCluster } from "@/lib/analysis/canonicalize";
import type { AnalysisThread, Confidence, ProblemClassification } from "@/lib/schema/analysis-schema";
import type { ThreadRecommendation } from "@/lib/analysis/monthly-structured";

export interface ThreadSynthesisContext {
  account_type?: string | null;
  total_spend?: number | null;
  total_revenue?: number | null;
  primary_kpi?: "roas" | "cpa" | null;
  period_label?: string | null;
}

export interface FalsePositiveThread {
  title: string;
  explanation: string;
  related_cluster_ids: string[];
  classification: Extract<ProblemClassification, "contextual_shift" | "measurement_risk" | "false_positive_alert" | "expected_tradeoff">;
}

export interface ThreadSynthesisOutput {
  primary_thread: AnalysisThread | null;
  supporting_threads: AnalysisThread[];
  false_positives: FalsePositiveThread[];
  executive_headline: string;
}

export function rankRecommendationsByIce<T extends Pick<ThreadRecommendation, "ice_impact" | "ice_confidence" | "ice_ease" | "ice_total">>(
  recommendations: T[]
): T[] {
  // Honest ranking. Order recommendations by their genuine ICE total and return
  // them unchanged. We deliberately do NOT floor the top, cap the bottom, or
  // force a minimum spread. The ICE scores come from the grounded rubric
  // (impact = share of spend and primary KPI, confidence = evidence level and
  // confirming steps, ease = effort in the platform). If two recommendations
  // score close together, that is an honest signal they are comparably
  // important; manufacturing a gap would misrepresent the analysis. A genuinely
  // weak top recommendation is allowed to keep its low score. Pure: the input
  // objects are not mutated.
  return [...recommendations].sort((a, b) => b.ice_total - a.ice_total);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
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

export function threadFamily(cluster: IssueCluster): string {
  switch (cluster.issue_cluster) {
    case "geo_allocation":
      return `geo_allocation:${extractGeoRoot(cluster) || cluster.entity_identity_key}`;
    case "search_budget_cap":
      return `demand_capture:${cluster.parent_campaign || cluster.entity_identity_key}`;
    case "tracking_cvr_drop":
      return "measurement_risk";
    case "pmax_cannibalization":
    case "product_mix":
      return `portfolio_mix:${extractGeoRoot(cluster) || cluster.parent_campaign || cluster.entity_identity_key}`;
    case "network_quality":
    case "search_partner_waste":
      return `traffic_quality:${extractGeoRoot(cluster) || cluster.parent_campaign || cluster.canonical_entity_name}`;
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

const ROOT_CAUSE_CLUSTER_BONUS: Partial<Record<IssueCluster["issue_cluster"], number>> = {
  geo_allocation: 18,
  network_quality: 14,
  search_partner_waste: 11,
  pmax_cannibalization: 20,
  product_mix: 15,
  search_budget_cap: 15,
  tracking_cvr_drop: 5,
  search_term_waste: 8,
};

const DERIVATIVE_CLUSTER_PENALTY: Partial<Record<IssueCluster["issue_cluster"], number>> = {
  desktop_inefficiency: 18,
  mobile_opportunity: 22,
  audience_inefficiency: 16,
};

export function scoreCluster(cluster: IssueCluster, allClusters: IssueCluster[]): number {
  const avgSeverity = cluster.severity_score / Math.max(1, cluster.finding_count);
  let score = avgSeverity * 22;
  if (cluster.action_required) score += 18;
  if (cluster.actionability === "direct_action") score += 10;
  if (cluster.dominant_confidence === "high") score += 8;
  const rootCauseBonus = ROOT_CAUSE_CLUSTER_BONUS[cluster.issue_cluster] ?? 0;
  if (cluster.issue_cluster === "tracking_cvr_drop") {
    score += cluster.dominant_severity === "critical" ? rootCauseBonus : 0;
  } else {
    score += rootCauseBonus;
  }
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

function classifyCluster(cluster: IssueCluster): ProblemClassification {
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

function businessImpact(cluster: IssueCluster): string {
  const parts = unique(
    cluster.findings.slice(0, 3).map((finding) => {
      const delta = finding.change_pct != null ? `${finding.change_pct > 0 ? "+" : ""}${finding.change_pct}%` : "geen delta";
      return `${finding.canonical_metric} ${delta}`;
    })
  );
  return `${cluster.display_label} wordt geraakt via ${parts.join(", ")}.`;
}

function monitoringMetrics(cluster: IssueCluster): string[] {
  return unique(cluster.findings.map((finding) => finding.canonical_metric)).slice(0, 5);
}

function threadTitle(cluster: IssueCluster): string {
  switch (cluster.issue_cluster) {
    case "tracking_cvr_drop":
      return "Meetrisico verstoort de interpretatie van de maand";
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
      return `Geo-allocatie rond ${cluster.display_label} is uit balans`;
    case "network_quality":
      return `Netwerkkwaliteit lekt rendement weg via ${cluster.display_label}`;
    case "schedule_waste":
      return `Advertentieplanning bevat inefficiënte uren voor ${cluster.display_label}`;
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

function broaderMonthlyDiagnosisDriverExists(primary: IssueCluster, group: IssueCluster[], allClusters: IssueCluster[]): boolean {
  const groupIds = new Set(group.map((cluster) => cluster.cluster_id));
  return allClusters.some((candidate) => {
    if (groupIds.has(candidate.cluster_id)) return false;
    if (!candidate.action_required || candidate.dominant_severity === "positive") return false;
    if (!["account", "campaign", "adgroup", "country", "product", "network"].includes(candidate.entity_scope)) return false;
    if (candidate.issue_cluster === "search_term_waste") return false;
    return candidate.coverage_dimensions.length >= 2 || candidate.finding_count >= 2;
  });
}

function isNarrowQueryDriver(cluster: IssueCluster): boolean {
  return cluster.issue_cluster === "search_term_waste" || ["keyword", "searchterm"].includes(cluster.entity_scope);
}

function isBroaderBusinessDriver(cluster: IssueCluster): boolean {
  return ["account", "campaign", "adgroup", "country", "product", "network"].includes(cluster.entity_scope)
    && cluster.issue_cluster !== "search_term_waste";
}

function confidenceFromGroup(group: IssueCluster[]): Confidence {
  return group.some((cluster) => cluster.dominant_confidence === "high")
    ? "high"
    : group.some((cluster) => cluster.dominant_confidence === "medium")
      ? "medium"
      : "low";
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

function toThread(group: IssueCluster[], primary: IssueCluster, index: number): AnalysisThread {
  return {
    id: `thread_${index + 1}_${primary.cluster_id}`,
    priority: Math.min(4, index + 1),
    title: threadTitle(primary),
    classification: classifyCluster(primary),
    root_cause_summary: unique(group.map((cluster) => cluster.root_cause_summary).filter(Boolean)).slice(0, 2).join(" / ") || primary.evidence_summary,
    business_impact: unique(group.map((cluster) => businessImpact(cluster))).slice(0, 2).join(" "),
    supporting_cluster_ids: group.map((cluster) => cluster.cluster_id),
    recommended_recommendation_ids: [],
    monitoring_metrics: unique(group.flatMap((cluster) => monitoringMetrics(cluster))).slice(0, 5),
    confidence: confidenceFromGroup(group),
    phase: index === 0 ? "immediate" : index === 1 ? "short_term" : "medium_term",
  };
}

function deterministicFallback(clusters: IssueCluster[]): ThreadSynthesisOutput {
  const ranked = [...clusters].sort((a, b) => scoreCluster(b, clusters) - scoreCluster(a, clusters));
  const primaryCluster = ranked[0] ?? null;
  const threads = ranked.slice(0, 4).map((cluster, index) => toThread([cluster], cluster, index));
  return {
    primary_thread: threads[0] ?? null,
    supporting_threads: threads.slice(1, 4),
    false_positives: [],
    executive_headline: threads[0]
      ? `Hoofdthema van de maand: ${threads[0].title}.`
      : "Geen primaire thread beschikbaar.",
  };
}

export function synthesizeThreads(
  clusters: IssueCluster[],
  _context: ThreadSynthesisContext = {}
): ThreadSynthesisOutput {
  if (clusters.length === 0) return deterministicFallback([]);

  const grouped = new Map<string, IssueCluster[]>();
  for (const cluster of clusters) {
    const key = threadFamily(cluster);
    const existing = grouped.get(key) || [];
    existing.push(cluster);
    grouped.set(key, existing);
  }

  const rankedGroups = Array.from(grouped.values())
    .map((group) => {
      const rankedClusters = [...group].sort((a, b) => scoreCluster(b, clusters) - scoreCluster(a, clusters));
      const primary = selectRepresentativeThreadCluster(rankedClusters, clusters);
      const scores = rankedClusters.map((cluster) => scoreCluster(cluster, clusters));
      const averageScore = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length);
      const primaryWeight = scores[0] * 0.7;
      const breadthBonus = Math.min(18, (group.length - 1) * 4);
      const classification = classifyCluster(primary);
      let groupScore = averageScore + primaryWeight + breadthBonus;
      if ((primary.issue_cluster === "search_term_waste" || ["keyword", "searchterm"].includes(primary.entity_scope)) && broaderMonthlyDiagnosisDriverExists(primary, rankedClusters, clusters)) {
        groupScore -= group.length === 1 ? 110 : 80;
      }
      return {
        group: rankedClusters,
        primary,
        classification,
        groupScore,
      };
    })
    .sort((a, b) => b.groupScore - a.groupScore);

  if (rankedGroups.length > 1 && isNarrowQueryDriver(rankedGroups[0].primary)) {
    const broaderIndex = rankedGroups.findIndex((entry, index) =>
      index > 0 &&
      entry.classification !== "false_positive_alert" &&
      isBroaderBusinessDriver(entry.primary)
    );
    if (broaderIndex > 0) {
      const [broader] = rankedGroups.splice(broaderIndex, 1);
      rankedGroups.unshift(broader);
    }
  }

  if (rankedGroups.length === 0) return deterministicFallback(clusters);

  const selectedGroups = rankedGroups
    .filter(({ classification }) => classification !== "false_positive_alert")
    .slice(0, 4);

  const threads = selectedGroups.map(({ group, primary }, index) => toThread(group, primary, index));
  const selectedClusterIds = new Set(threads.flatMap((thread) => thread.supporting_cluster_ids));
  const falsePositives: FalsePositiveThread[] = clusters
    .filter((cluster) => !selectedClusterIds.has(cluster.cluster_id))
    .filter((cluster) => cluster.dominant_severity === "positive" || cluster.actionability === "monitor")
    .slice(0, 4)
    .map((cluster) => {
      const classification = classifyCluster(cluster);
      return {
        title: threadTitle(cluster),
        explanation: cluster.evidence_summary,
        related_cluster_ids: [cluster.cluster_id],
        classification: classification === "real_problem" ? "expected_tradeoff" : classification,
      } satisfies FalsePositiveThread;
    });

  return {
    primary_thread: threads[0] ?? null,
    supporting_threads: threads.slice(1, 4),
    false_positives: falsePositives,
    executive_headline: threads[0]
      ? `${threads[0].title}. ${threads[0].business_impact}`
      : "Geen primaire thread beschikbaar.",
  };
}
