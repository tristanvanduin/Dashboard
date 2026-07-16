// F4 hoofd: claim-consistentie. Toetst door het model geclaimde getallen tegen de canonical
// waarden die de pipeline zelf al in handen heeft (dezelfde rijen die de prompts voeden).
// Vangt de broedservice-bug: een stap die een sub-scope-waarde (productgroep, keyword, device)
// presenteert als campagnewaarde, bijvoorbeeld ROAS 1.40x terwijl de campagne canonical 5.43x is.
//
// Bewust beperkt tot metrics met een eenduidige representatie (ROAS als multiplier; CPA, CPC,
// Spend en Omzet in euro's; Conversies als aantal) om valse positieven door percentage-versus-
// ratio-ambiguiteit (CVR, CTR) te vermijden. Velden geverifieerd tegen ads_campaign_monthly en
// ads_account_monthly: campaign_name, month, cost, conversions, conversions_value, clicks.

import { normalizeEntityName, normalizeMetricName } from "./canonicalize";
import type { Finding } from "../schema/analysis-schema";

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export type CanonicalMetricMap = Map<string, number>;

export function canonicalKey(name: string, entityType: Finding["entity_type"], metric: string): string {
  return `${normalizeEntityName(name, entityType)}::${normalizeMetricName(metric)}`;
}

function addEntityMetrics(map: CanonicalMetricMap, name: string, entityType: Finding["entity_type"], row: Row): void {
  const cost = num(row.cost);
  const conversions = num(row.conversions);
  const value = num(row.conversions_value);
  const clicks = num(row.clicks);
  const set = (metric: string, computed: number) => map.set(canonicalKey(name, entityType, metric), computed);
  if (cost !== null && value !== null && cost > 0) set("ROAS", value / cost);
  if (cost !== null && conversions !== null && conversions > 0) set("CPA", cost / conversions);
  if (cost !== null && clicks !== null && clicks > 0) set("CPC", cost / clicks);
  if (cost !== null) set("Spend", cost);
  if (conversions !== null) set("Conversies", conversions);
  if (value !== null) set("Omzet", value);
}

// Canonical metrics voor de laatste aanwezige maand per campagne en voor het account.
export function buildCanonicalMetricMap(
  campaignRows: Row[],
  accountRows: Row[],
  periodStart: string,
  periodEnd: string
): CanonicalMetricMap {
  const map: CanonicalMetricMap = new Map();
  void periodStart;

  const latestMonth = (rows: Row[]): string => {
    const months = rows.map((row) => String(row.month ?? "")).filter(Boolean).sort();
    return months.length ? months[months.length - 1] : periodEnd;
  };

  const campaignMonth = latestMonth(campaignRows);
  for (const row of campaignRows) {
    if (String(row.month ?? "") !== campaignMonth) continue;
    const name = String(row.campaign_name ?? "");
    if (!name) continue;
    addEntityMetrics(map, name, "campaign", row);
  }

  const accountMonth = latestMonth(accountRows);
  for (const row of accountRows) {
    if (String(row.month ?? "") !== accountMonth) continue;
    addEntityMetrics(map, "account", "account", row);
  }

  return map;
}

export type ClaimIssue = {
  type: "scope_mismatch" | "value_error";
  step: number;
  entity_name: string;
  metric: string;
  claimed: number;
  canonical: number;
  message: string;
};

const SUB_SCOPE_STEPS = new Set([5, 6, 7, 8, 9, 10]);

type ClaimFinding = Pick<Finding, "entity_name" | "entity_type" | "metric" | "current_value">;

// Vlagt findings waarvan de geclaimde waarde meer dan tolerancePct afwijkt van de canonical waarde.
export function validateFindingClaims(
  stepNumber: number,
  findings: ClaimFinding[],
  map: CanonicalMetricMap,
  tolerancePct = 35
): ClaimIssue[] {
  const issues: ClaimIssue[] = [];
  for (const finding of findings) {
    if (finding.entity_type !== "campaign" && finding.entity_type !== "account") continue;
    if (typeof finding.current_value !== "number") continue;
    const metric = normalizeMetricName(finding.metric);
    const canonical = map.get(canonicalKey(finding.entity_name, finding.entity_type, finding.metric));
    if (canonical === undefined) continue;

    const claimed = finding.current_value;
    const absFloor = /spend|omzet|cpa|cpc/i.test(metric) ? 1 : 0.1;
    if (Math.abs(claimed - canonical) < absFloor) continue;
    const denom = Math.abs(canonical) > 1e-9 ? Math.abs(canonical) : 1;
    const deviation = (Math.abs(claimed - canonical) / denom) * 100;
    if (deviation <= tolerancePct) continue;

    const isSubScope = SUB_SCOPE_STEPS.has(stepNumber);
    issues.push({
      type: isSubScope ? "scope_mismatch" : "value_error",
      step: stepNumber,
      entity_name: finding.entity_name,
      metric,
      claimed,
      canonical,
      message: isSubScope
        ? `Claim-consistentie: waarde ${round(claimed)} voor ${finding.entity_name} (${metric}) wijkt af van de canonical campagnewaarde ${round(canonical)}; je kijkt waarschijnlijk naar een sub-scope (productgroep, keyword, device). Hernoem de entiteit naar de sub-scope of corrigeer de waarde.`
        : `Claim-consistentie: waarde ${round(claimed)} voor ${finding.entity_name} (${metric}) wijkt af van de canonical waarde ${round(canonical)}; corrigeer de waarde.`,
    });
  }
  return issues;
}
