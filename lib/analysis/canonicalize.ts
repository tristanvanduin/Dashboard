/**
 * Canonical monthly finding normalization, clustering, and coverage helpers.
 *
 * The monthly pipeline uses these utilities before any synthesis or
 * recommendation generation so that entity names, metrics, issue clusters,
 * and coverage are deterministic.
 */

import type { Finding } from "@/lib/schema/analysis-schema";
import { deriveEntityIdentity, normalizeScopedEntityName, type EntityScope } from "@/lib/analysis/entity-identity";

export type CoverageDimension =
  | "account"
  | "campaign"
  | "adgroup"
  | "competitor"
  | "search_term"
  | "creative"
  | "audience"
  | "device"
  | "geography"
  | "network"
  | "schedule"
  | "pmax_product_asset_groups"
  | "hypotheses_sprint_plan";

export interface NormalizedFinding extends Finding {
  finding_id: string;
  canonical_entity_name: string;
  canonical_entity_key: string;
  entity_scope: EntityScope;
  canonical_geo_id: string | null;
  parent_campaign: string | null;
  parent_adgroup: string | null;
  display_label: string;
  entity_identity_key: string;
  canonical_metric: string;
  canonical_metric_key: string;
  cluster_family: string;
  dedup_key: string;
}

export interface IssueCluster {
  cluster_id: string;
  issue_cluster: string;
  canonical_entity_name: string;
  display_label: string;
  entity_scope: EntityScope;
  entity_identity_key: string;
  canonical_geo_id: string | null;
  parent_campaign: string | null;
  parent_adgroup: string | null;
  canonical_metric: string;
  related_finding_ids: string[];
  dominant_severity: Finding["severity"];
  dominant_confidence: "high" | "medium" | "low";
  root_cause_summary: string;
  evidence_summary: string;
  actionability: "direct_action" | "investigate_first" | "monitor";
  coverage_dimensions: CoverageDimension[];
  findings: NormalizedFinding[];
  action_required: boolean;
  finding_count: number;
  severity_score: number;
}

export interface SopCoverage {
  dimension: CoverageDimension;
  data_available: boolean;
  findings_surfaced: number;
  surfaced_cluster_ids: string[];
  status: "covered" | "no_signal" | "data_unavailable";
  note: string;
}

export interface CanonicalizedOutput {
  findings: NormalizedFinding[];
  clusters: IssueCluster[];
  coverage: SopCoverage[];
  stats: {
    raw_count: number;
    after_dedup: number;
    cluster_count: number;
  };
}

export interface DisplayGroupIdentity {
  issue_cluster: string;
  canonical_entity_name: string;
  canonical_geo_id?: string | null;
  parent_campaign?: string | null;
  entity_identity_key?: string;
  canonical_metric?: string;
  root_cause_summary?: string | null;
  actionability?: string;
}

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  positive: 1,
};

const CONFIDENCE_RANK: Record<"high" | "medium" | "low", number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const EVIDENCE_RANK: Record<"deterministic" | "inferred" | "hypothesis" | "unknown", number> = {
  deterministic: 3,
  inferred: 2,
  hypothesis: 1,
  unknown: 0,
};

const ENTITY_ALIASES: Array<[RegExp, string]> = [
  [/^account(\s*:\s*account)?(\s*(totaal|overall|performance|wide|level|breed))?$/i, "Account"],
  [/^account(\s+(overall|performance|wide|level))?$/i, "Account"],
  [/^account overall$/i, "Account"],
  [/^account performance$/i, "Account"],
  [/^account wide$/i, "Account"],
  [/^account totaal$/i, "Account"],
  [/^account breed$/i, "Account"],
  [/^account level$/i, "Account"],
  [/^gads-\d+$/i, "Account"],
  [/^belgi[eë](\s*\(be\))?$/i, "België"],
  [/^belgium(\s*\(be\))?$/i, "België"],
  [/^nederland(\s*\(nl\))?$/i, "Nederland"],
  [/^netherlands(\s*\(nl\))?$/i, "Nederland"],
  [/^duitsland(\s*\(de\))?$/i, "Duitsland"],
  [/^de(\s*\(duitsland\))?$/i, "Duitsland"],
  [/^germany(\s*\(de\))?$/i, "Duitsland"],
  [/^land:\s*duitsland$/i, "Duitsland"],
  [/^search partners$/i, "Search Partners"],
  [/^youtube(\s*\(pmax\))?$/i, "YouTube"],
];

const METRIC_ALIASES: Array<[RegExp, string]> = [
  [/^search lost is \(budget\)$/i, "Search Lost IS (Budget)"],
  [/^search impression share \(budget\)$/i, "Search Lost IS (Budget)"],
  [/^search impression share \(budget\)\s*$/i, "Search Lost IS (Budget)"],
  [/^search lost is \(rank\)$/i, "Search Lost IS (Rank)"],
  [/^search impression share \(rank\)$/i, "Search Lost IS (Rank)"],
  [/^search impression share$/i, "Impression Share"],
  [/^conversion rate$/i, "CVR"],
  [/^cvr$/i, "CVR"],
  [/^cost per conversion$/i, "CPA"],
  [/^marginal cpa$/i, "CPA"],
  [/^wasteful spend$/i, "Wasteful Spend"],
  [/^efficiency ratio$/i, "Efficiency Ratio"],
  [/^revenue$/i, "Omzet"],
  [/^conversion value$/i, "Conversiewaarde"],
  [/^conversion$/i, "Conversies"],
  [/^conversions?$/i, "Conversies"],
  [/^kosten$/i, "Spend"],
  [/^cost$/i, "Spend"],
  [/^spend$/i, "Spend"],
  [/^volume$/i, "Volume"],
  [/^clicks?$/i, "Clicks"],
  [/^impressions?$/i, "Impressies"],
];

const CLUSTER_ALIASES: Array<[RegExp, string]> = [
  [/tracking|measurement/i, "tracking_cvr_drop"],
  [/desktop/i, "desktop_inefficiency"],
  [/mobile/i, "mobile_opportunity"],
  [/audience/i, "audience_inefficiency"],
  [/creative|copy|rsa/i, "creative_mismatch"],
  [/schedule|hour|daypart/i, "schedule_waste"],
  [/network|youtube|partner/i, "network_quality"],
  [/geo|country|belgi|nederland|duitsland/i, "geo_allocation"],
  [/search[_\s]?term|negative|waste/i, "search_term_waste"],
  [/budget|lost[_\s]?is/i, "search_budget_cap"],
  [/troas|bid|inflation|cpc/i, "search_bidding_inflation"],
  [/pmax|cannibal/i, "pmax_cannibalization"],
  [/product|asset_group|shopping/i, "product_mix"],
  [/brand/i, "brand_leakage"],
  [/partner/i, "search_partner_waste"],
];

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
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

function clampConfidence(value?: string): "high" | "medium" | "low" {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function clampEvidence(value?: string): "deterministic" | "inferred" | "hypothesis" | "unknown" {
  if (value === "deterministic" || value === "inferred" || value === "hypothesis" || value === "unknown") return value;
  return "unknown";
}

function cleanCause(cause: string | null): string {
  return (cause || "")
    .replace(/\bnull\b/gi, "")
    .replace(/\bundefined\b/gi, "")
    .replace(/\(was null\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function normalizeEntityName(raw: string, entityType: Finding["entity_type"] = "campaign"): string {
  let name = normalizeScopedEntityName(raw, entityType);

  for (const [pattern, canonical] of ENTITY_ALIASES) {
    if (pattern.test(name) && entityType !== "adgroup") return canonical;
  }

  return name;
}

export function normalizeMetricName(raw: string): string {
  const metric = (raw || "").trim();
  for (const [pattern, canonical] of METRIC_ALIASES) {
    if (pattern.test(metric)) return canonical;
  }
  return metric;
}

export function deduplicationKey(finding: Pick<Finding, "entity_name" | "metric">): string {
  const normalizedEntity = finding.entity_name
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const normalizedMetric = normalizeMetricName(finding.metric)
    .toUpperCase()
    .replace(/CONVERSIES|CONVERSIONS/g, "CONV")
    .replace(/IMPRESSIES|IMPRESSIONS/g, "IMPR")
    .trim();

  return `${normalizedEntity}::${normalizedMetric}`;
}

export function issueFamily(issueCluster: string): string {
  switch (issueCluster) {
    case "geo_allocation":
      return "geo_allocation";
    case "network_quality":
    case "search_partner_waste":
      return "traffic_quality";
    case "pmax_cannibalization":
    case "product_mix":
      return "portfolio_mix";
    case "search_budget_cap":
    case "search_bidding_inflation":
    case "brand_leakage":
      return "demand_capture";
    case "desktop_inefficiency":
    case "mobile_opportunity":
    case "audience_inefficiency":
    case "schedule_waste":
      return "efficiency_control";
    case "search_term_waste":
      return "query_quality";
    case "tracking_cvr_drop":
      return "measurement_risk";
    default:
      return issueCluster || "uncategorized";
  }
}

export function metricProblemFamily(metric: string): string {
  const normalized = normalizeMetricName(metric).toLowerCase();
  if (/roas|efficiency ratio|omzet|conversiewaarde/.test(normalized)) return "value_efficiency";
  if (/cpa|cpc|wasteful spend|spend/.test(normalized)) return "cost_efficiency";
  if (/cvr|ctr/.test(normalized)) return "conversion_quality";
  if (/conversies|clicks|impressies|volume/.test(normalized)) return "volume";
  if (/search lost is|impression share/.test(normalized)) return "demand_capture";
  return "general_performance";
}

export function causeFamilyFromIssueCluster(issueCluster: string, rootCauseSummary?: string | null): string {
  const normalizedCause = normalizeText(rootCauseSummary || "");
  if (issueCluster === "tracking_cvr_drop" || /(tracking|meting|measurement|attribu|funnel|checkout)/.test(normalizedCause)) return "measurement_or_funnel";
  if (issueCluster === "geo_allocation" || /geo|land|country|region/.test(normalizedCause)) return "geo_allocation";
  if (issueCluster === "network_quality" || issueCluster === "search_partner_waste" || /network|youtube|partner|inventory/.test(normalizedCause)) return "network_quality";
  if (issueCluster === "search_term_waste" || /zoekterm|intent|routing|query|modifier/.test(normalizedCause)) return "query_routing";
  if (issueCluster === "product_mix" || issueCluster === "pmax_cannibalization" || /sku|feed|product|asset group|assortiment|portfolio/.test(normalizedCause)) return "portfolio_or_feed";
  if (issueCluster === "search_budget_cap" || issueCluster === "search_bidding_inflation" || /budget|lost is|bied|troas|tcpa|cpc/.test(normalizedCause)) return "bidding_or_budget";
  if (issueCluster === "desktop_inefficiency" || issueCluster === "mobile_opportunity" || /device|desktop|mobile/.test(normalizedCause)) return "device_mix";
  if (issueCluster === "audience_inefficiency" || /audience|doelgroep/.test(normalizedCause)) return "audience_quality";
  if (issueCluster === "schedule_waste" || /dagdeel|uur|schedule|planning/.test(normalizedCause)) return "schedule_control";
  if (issueCluster === "creative_mismatch" || /creative|asset|copy|boodschap/.test(normalizedCause)) return "creative_fit";
  if (/bench|target|status/.test(normalizedCause)) return "status_or_target_gap";
  return issueFamily(issueCluster);
}

export function actionFamilyFromIssueCluster(issueCluster: string): string {
  switch (issueFamily(issueCluster)) {
    case "measurement_risk":
      return "validate_before_change";
    case "geo_allocation":
      return "geo_control";
    case "traffic_quality":
      return "traffic_filtering";
    case "query_quality":
      return "query_filtering_or_routing";
    case "portfolio_mix":
      return "portfolio_or_feed_repair";
    case "demand_capture":
      return "capture_or_bid_control";
    case "efficiency_control":
      return "segment_control";
    default:
      return issueCluster === "creative_mismatch" ? "creative_repair" : "general_control";
  }
}

export function displayProblemKey(identity: DisplayGroupIdentity): string {
  const family = issueFamily(identity.issue_cluster);
  const causeFamily = causeFamilyFromIssueCluster(identity.issue_cluster, identity.root_cause_summary);
  const actionFamily = actionFamilyFromIssueCluster(identity.issue_cluster);
  if (family === "geo_allocation") {
    return `${identity.canonical_geo_id || slugify(identity.canonical_entity_name)}::${family}::${causeFamily}::${actionFamily}`;
  }
  if (family === "traffic_quality" || family === "portfolio_mix" || family === "demand_capture" || family === "query_quality") {
    return `${slugify(identity.parent_campaign || identity.canonical_entity_name)}::${family}::${causeFamily}::${actionFamily}`;
  }
  return `${identity.entity_identity_key || slugify(identity.canonical_entity_name)}::${family}::${causeFamily}::${actionFamily}`;
}

function detectClusterFamily(finding: Finding, canonicalEntity: string, canonicalMetric: string): Finding["issue_cluster"] {
  const provided = (finding.issue_cluster || "").trim();
  if (provided) {
    for (const [pattern, canonical] of CLUSTER_ALIASES) {
      if (pattern.test(provided)) return canonical as Finding["issue_cluster"];
    }
    return "uncategorized";
  }

  const combined = `${canonicalEntity} ${canonicalMetric} ${cleanCause(finding.cause)}`;
  for (const [pattern, canonical] of CLUSTER_ALIASES) {
    if (pattern.test(combined)) return canonical as Finding["issue_cluster"];
  }

  if (/search lost is/i.test(canonicalMetric)) return "search_budget_cap";
  if (/wasteful spend/i.test(canonicalMetric) || finding.entity_type === "searchterm") return "search_term_waste";
  if (finding.entity_type === "device" && /desktop/i.test(canonicalEntity)) return "desktop_inefficiency";
  if (finding.entity_type === "device" && /mobile/i.test(canonicalEntity)) return "mobile_opportunity";
  if (finding.entity_type === "country") return "geo_allocation";
  if (finding.entity_type === "creative") return "creative_mismatch";
  if (finding.entity_type === "audience") return "audience_inefficiency";
  if (finding.entity_type === "network") return "network_quality";
  if (finding.entity_type === "schedule") return "schedule_waste";

  return "uncategorized";
}

function findingCoverageDimensions(finding: Finding, family: string): CoverageDimension[] {
  const dims = new Set<CoverageDimension>();

  switch (finding.entity_type) {
    case "account":
      dims.add("account");
      break;
    case "campaign":
      dims.add("campaign");
      break;
    case "adgroup":
      dims.add("adgroup");
      break;
    case "keyword":
    case "searchterm":
      dims.add("search_term");
      break;
    case "creative":
      dims.add("creative");
      break;
    case "audience":
      dims.add("audience");
      break;
    case "device":
      dims.add("device");
      break;
    case "country":
      dims.add("geography");
      break;
    case "network":
      dims.add("network");
      break;
    case "schedule":
      dims.add("schedule");
      break;
  }

  if (family === "search_budget_cap" || family === "brand_leakage") dims.add("competitor");
  if (family === "pmax_cannibalization" || family === "product_mix") dims.add("pmax_product_asset_groups");

  return Array.from(dims);
}

export function normalizeFindings(findings: Finding[]): NormalizedFinding[] {
  return findings.map((finding, index) => {
    const identity = deriveEntityIdentity(finding);
    const canonicalEntityName = normalizeEntityName(finding.entity_name, finding.entity_type);
    const canonicalMetric = normalizeMetricName(finding.metric);
    const canonicalEntityKey = slugify(canonicalEntityName);
    const canonicalMetricKey = slugify(canonicalMetric);
    const clusterFamily = detectClusterFamily(finding, canonicalEntityName, canonicalMetric);

    return {
      ...finding,
      issue_cluster: clusterFamily,
      entity_name: canonicalEntityName,
      entity_scope: identity.entity_scope,
      canonical_geo_id: identity.canonical_geo_id,
      parent_campaign: identity.parent_campaign,
      parent_adgroup: identity.parent_adgroup,
      display_label: identity.display_label,
      metric: canonicalMetric,
      cause: cleanCause(finding.cause) || "Oorzaak niet gespecificeerd",
      finding_id: `f_${String(index + 1).padStart(3, "0")}_${canonicalEntityKey}_${canonicalMetricKey}`,
      canonical_entity_name: canonicalEntityName,
      canonical_entity_key: canonicalEntityKey,
      entity_identity_key: identity.identity_key,
      canonical_metric: canonicalMetric,
      canonical_metric_key: canonicalMetricKey,
      cluster_family: clusterFamily,
      dedup_key: deduplicationKey({ entity_name: canonicalEntityName, metric: canonicalMetric }),
    };
  });
}

function mergeCauseTexts(primary: string, secondary: string): string {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const normPrimary = primary.toLowerCase();
  const normSecondary = secondary.toLowerCase();
  if (normPrimary.includes(normSecondary) || normSecondary.includes(normPrimary)) return primary;
  return `${primary}; ${secondary}`;
}

export function deduplicateFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const byKey = new Map<string, NormalizedFinding>();

  for (const finding of findings) {
    const existing = byKey.get(finding.dedup_key);
    if (!existing) {
      byKey.set(finding.dedup_key, finding);
      continue;
    }

    const currentRank = SEVERITY_RANK[finding.severity];
    const existingRank = SEVERITY_RANK[existing.severity];
    const keepCurrent =
      currentRank > existingRank ||
      (
        currentRank === existingRank &&
        (
          EVIDENCE_RANK[clampEvidence(finding.evidence_level)] > EVIDENCE_RANK[clampEvidence(existing.evidence_level)] ||
          (
            EVIDENCE_RANK[clampEvidence(finding.evidence_level)] === EVIDENCE_RANK[clampEvidence(existing.evidence_level)] &&
            Math.abs(finding.change_pct ?? 0) > Math.abs(existing.change_pct ?? 0)
          )
        )
      );

    if (keepCurrent) {
      const steps = Array.from(new Set([existing.step, finding.step])).sort((a, b) => a - b);
      byKey.set(finding.dedup_key, {
        ...finding,
        cause: `${mergeCauseTexts(finding.cause || "", existing.cause || "")} [Bevestigd in stap ${steps.join(", ")}]`,
        current_value: finding.current_value ?? existing.current_value,
        previous_value: finding.previous_value ?? existing.previous_value,
        change_pct: finding.change_pct ?? existing.change_pct,
      });
    } else {
      const steps = Array.from(new Set([existing.step, finding.step])).sort((a, b) => a - b);
      existing.cause = mergeCauseTexts(existing.cause || "", finding.cause || "");
      if (!/\[Bevestigd in stap /.test(existing.cause)) {
        existing.cause = `${existing.cause} [Bevestigd in stap ${steps.join(", ")}]`.trim();
      }
      existing.action_required = existing.action_required || finding.action_required;
      existing.is_structural = existing.is_structural || finding.is_structural;
      existing.is_seasonal = existing.is_seasonal || finding.is_seasonal;
      if (CONFIDENCE_RANK[clampConfidence(finding.confidence)] > CONFIDENCE_RANK[clampConfidence(existing.confidence)]) {
        existing.confidence = finding.confidence;
      }
      if (EVIDENCE_RANK[clampEvidence(finding.evidence_level)] > EVIDENCE_RANK[clampEvidence(existing.evidence_level)]) {
        existing.evidence_level = finding.evidence_level;
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDiff !== 0) return severityDiff;
    const changeDiff = Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0);
    if (changeDiff !== 0) return changeDiff;
    return a.finding_id.localeCompare(b.finding_id);
  });
}

function dominantMetric(findings: NormalizedFinding[]): string {
  const weighted = new Map<string, number>();
  for (const finding of findings) {
    const score = (weighted.get(finding.canonical_metric) || 0) + SEVERITY_RANK[finding.severity];
    weighted.set(finding.canonical_metric, score);
  }

  return Array.from(weighted.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || findings[0]?.canonical_metric || "Metric";
}

function clusterActionability(findings: NormalizedFinding[]): IssueCluster["actionability"] {
  const hasLowConfidence = findings.some((finding) => clampConfidence(finding.confidence) === "low");
  const hasHypothesis = findings.some((finding) => finding.evidence_level === "hypothesis");
  const hasOnlyPositive = findings.every((finding) => finding.severity === "positive" || !finding.action_required);

  if (hasOnlyPositive) return "monitor";
  if (hasLowConfidence || hasHypothesis) return "investigate_first";
  if (findings.some((finding) => finding.action_required)) return "direct_action";
  return "monitor";
}

export function clusterFindings(findings: NormalizedFinding[]): IssueCluster[] {
  const groups = new Map<string, NormalizedFinding[]>();

  for (const finding of findings) {
    const clusterKey = `${finding.cluster_family}:::${finding.entity_identity_key}`;
    const group = groups.get(clusterKey) || [];
    group.push(finding);
    groups.set(clusterKey, group);
  }

  const clusters: IssueCluster[] = Array.from(groups.entries()).map(([key, group]) => {
    const sorted = [...group].sort((a, b) => {
      const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0);
    });
    const lead = sorted[0];
    const dominantConfidence = sorted
      .map((finding) => clampConfidence(finding.confidence))
      .sort((a, b) => CONFIDENCE_RANK[b] - CONFIDENCE_RANK[a])[0] || "medium";
    const coverageDimensions = new Set<CoverageDimension>();
    for (const finding of sorted) {
      for (const dimension of findingCoverageDimensions(finding, lead.cluster_family)) {
        coverageDimensions.add(dimension);
      }
    }

    return {
      cluster_id: `cluster_${key}`,
      issue_cluster: lead.cluster_family,
      canonical_entity_name: lead.canonical_entity_name,
      display_label: lead.display_label,
      entity_scope: lead.entity_scope,
      entity_identity_key: lead.entity_identity_key,
      canonical_geo_id: lead.canonical_geo_id,
      parent_campaign: lead.parent_campaign,
      parent_adgroup: lead.parent_adgroup,
      canonical_metric: dominantMetric(sorted),
      related_finding_ids: sorted.map((finding) => finding.finding_id),
      dominant_severity: lead.severity,
      dominant_confidence: dominantConfidence,
      root_cause_summary: sorted
        .map((finding) => finding.cause || "")
        .filter(Boolean)
        .slice(0, 2)
        .reduce((summary, cause) => mergeCauseTexts(summary, cause), ""),
      evidence_summary: sorted
        .map((finding) => {
          const change = finding.change_pct != null ? ` (${finding.change_pct > 0 ? "+" : ""}${finding.change_pct}%)` : "";
          const current = finding.current_value != null ? ` ${finding.current_value}` : "";
          return `${finding.display_label} ${finding.canonical_metric}${current}${change}`;
        })
        .join("; "),
      actionability: clusterActionability(sorted),
      coverage_dimensions: Array.from(coverageDimensions).sort(),
      findings: sorted,
      action_required: sorted.some((finding) => finding.action_required),
      finding_count: sorted.length,
      severity_score: sorted.reduce((sum, finding) => sum + SEVERITY_RANK[finding.severity], 0),
    };
  });

  return clusters.sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.dominant_severity] - SEVERITY_RANK[a.dominant_severity];
    if (severityDiff !== 0) return severityDiff;
    const scoreDiff = b.severity_score - a.severity_score;
    if (scoreDiff !== 0) return scoreDiff;
    const countDiff = b.finding_count - a.finding_count;
    if (countDiff !== 0) return countDiff;
    return a.cluster_id.localeCompare(b.cluster_id);
  });
}

const COVERAGE_DIMENSION_DEFINITIONS: Array<{
  dimension: CoverageDimension;
  note: string;
}> = [
  { dimension: "account", note: "Account- of doelstellingsanalyse." },
  { dimension: "campaign", note: "Campagneperformance en portfolio-allocatie." },
  { dimension: "adgroup", note: "Ad group analyse en sub-structuur." },
  { dimension: "competitor", note: "Auction insights / impression share context." },
  { dimension: "search_term", note: "Zoektermen, keyword waste en intentkwaliteit." },
  { dimension: "creative", note: "Advertenties, assets en message-market fit." },
  { dimension: "audience", note: "Doelgroepsegmentatie en efficiency." },
  { dimension: "device", note: "Device performance en allocatie." },
  { dimension: "geography", note: "Land/regio prestaties." },
  { dimension: "network", note: "Search, YouTube, partners en mixed inventory." },
  { dimension: "schedule", note: "Dag/uur performance." },
  { dimension: "pmax_product_asset_groups", note: "PMax, productmix en asset groups." },
  { dimension: "hypotheses_sprint_plan", note: "Sprint-hypotheses en follow-up acties." },
];

export function checkSopCoverage(
  clusters: IssueCluster[],
  dimensionAvailability: Partial<Record<CoverageDimension, boolean>>
): SopCoverage[] {
  return COVERAGE_DIMENSION_DEFINITIONS.map(({ dimension, note }) => {
    const surfaced = clusters.filter((cluster) => cluster.coverage_dimensions.includes(dimension));
    const dataAvailable = dimensionAvailability[dimension] ?? false;

    return {
      dimension,
      data_available: dataAvailable,
      findings_surfaced: surfaced.reduce((sum, cluster) => sum + cluster.finding_count, 0),
      surfaced_cluster_ids: surfaced.map((cluster) => cluster.cluster_id),
      status: !dataAvailable ? "data_unavailable" : surfaced.length > 0 ? "covered" : "no_signal",
      note,
    };
  });
}

export function canonicalizeFindings(
  rawFindings: Finding[],
  dimensionAvailability: Partial<Record<CoverageDimension, boolean>> = {}
): CanonicalizedOutput {
  const normalized = normalizeFindings(rawFindings);
  const deduped = deduplicateFindings(normalized);
  const clusters = clusterFindings(deduped);
  const coverage = checkSopCoverage(clusters, dimensionAvailability);

  return {
    findings: deduped,
    clusters,
    coverage,
    stats: {
      raw_count: rawFindings.length,
      after_dedup: deduped.length,
      cluster_count: clusters.length,
    },
  };
}
