import { NextRequest } from "next/server";
import {
  getSupabase,
  getOpenRouterKey,
  fetchClientContext,
  runStep,
  monthsAgo,
  fmt,
  type StepResult,
  saveAnalysisOutputSection,
} from "@/lib/analysis/helpers";
import {
  buildMonthlyStepPrompt,
} from "@/lib/prompts/sop-prompts";
import {
  MONTHLY_STEP7_ACTIONS_INSTRUCTION,
  MONTHLY_STEP7_CLASSIFICATION_INSTRUCTION,
  buildMonthlyCheckpointPrompt,
} from "@/lib/prompts/monthly-v2";
import { getAdapter, type ChannelAdapter } from "@/lib/analysis/channel-adapter";
import "@/lib/analysis/adapters/meta-ads"; // registreert de Meta-adapter zodat getAdapter("meta_ads") resolvet
import { buildMetaAnalysisData, thirteenMonthStart } from "@/lib/meta/analysis-data";
import { buildMetaStepMessage, metaStepName } from "@/lib/meta/step-message";
import "@/lib/analysis/adapters/linkedin-ads"; // registreert de LinkedIn-adapter zodat getAdapter("linkedin_ads") resolvet
import { buildLinkedinAnalysisData } from "@/lib/linkedin/analysis-data";
import { buildLinkedinStepMessage, linkedinStepName } from "@/lib/linkedin/step-message";
import { goalsPlausibilityFromMonthly, resolveTargets, targetActualsFromMonthly, buildConfiguredTargetsBlock, type TargetRow } from "@/lib/analysis/o2-targets-cost";
import { buildGoalsSection } from "@/lib/prompts/sop-prompts";
import type { LinkedInIcp } from "@/lib/linkedin/icp-fit";
import type { SupabaseClient } from "@supabase/supabase-js";
import "@/lib/analysis/adapters/google-ads"; // registreert de Google-adapter in de registry
import { aggregateAdGroups } from "@/lib/analysis/aggregate-adgroups";
import { computeAnalysisTargets } from "@/lib/analysis/compute-targets";
import { buildEnrichmentContext } from "@/lib/analysis/enrichment";
import {
  extractJson,
  FindingSchema,
  StepOutputSchema,
  type StepOutput,
  type Finding,
} from "@/lib/schema/analysis-schema";
import { sanitizeOutput } from "@/lib/analysis/sanitize";
import { computeComparisonFacts, formatComparisonFacts, computeCampaignMomFacts, computeAdGroupMomFacts } from "@/lib/analysis/comparison-facts";
import { computeDataReliability, type DataReliabilityAssessment } from "@/lib/analysis/data-reliability";
import { checkStepDataAvailability } from "@/lib/analysis/data-availability";
import type { StepDataAvailability } from "@/lib/analysis/data-availability";
import { checkDataFreshness } from "@/lib/sync/freshness";
import { canonicalizeFindings, clusterFindings, type CoverageDimension, type NormalizedFinding } from "@/lib/analysis/canonicalize";
import { enforceSopCoverage } from "@/lib/analysis/coverage-enforcer";
import { buildStructuredMonthlyOutput, type ParsedStepOutput } from "@/lib/analysis/monthly-structured";
import {
  buildPreparedContextRow,
  getPreparedContext,
  savePreparedContext,
  type AnalysisPreparedContextRow,
  type MonthlyPreparedInputs,
} from "@/lib/analysis/monthly-prepared-context";
import {
  assessSearchTermAgainstProductContext,
  buildProductContext,
  type ProductTermAssessment,
  summarizeProductContext,
} from "@/lib/analysis/product-context";
import { syncMerchantProductSnapshots } from "@/lib/api/merchant-products";
import { parseCheckpointOutput, type CheckpointOutput } from "@/lib/schema/monthly-pipeline-schema";
import { buildMonthlyQualityGate, validateMonthlyAcceptance } from "@/lib/analysis/monthly-acceptance";
import { validateStepOutput, type StepValidationResult, type StepPurityRule } from "@/lib/analysis/step-validator";
import { buildCanonicalMetricMap, validateFindingClaims, type CanonicalMetricMap } from "@/lib/analysis/claim-consistency";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";
import { logger } from "@/lib/logger";
import { getClientMemory, buildClientMemoryGrounding } from "@/lib/memory/client-memory";
import { buildGoogleSignalsSection, type CampaignIsRow, type CampaignMonthlyRow, type KeywordMonthlyRow, type ChangeHistoryRow, type ScheduleRow, type NetworkMonthlyRow, type DeviceMonthlyRow, type SearchTermMonthlyLite, type NegativeKeywordRow } from "@/lib/analysis/signal-section";

function getCredentials(): GoogleAdsCredentials | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!developerToken || !clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };
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

function searchTermScopeKey(term: string, campaignName: string, adGroupName: string): string {
  return [
    normalizeText(term),
    normalizeText(campaignName),
    normalizeText(adGroupName),
  ].join("::");
}

function rewriteProtectedSearchTermCause(cause: string, assessment: ProductTermAssessment): string {
  const cleaned = cause
    .replace(/\boff[- ]?catalog\b/gi, "routing- of assortimentscheck nodig")
    .replace(/\birrelevant\b/gi, "niet bewezen als irrelevante term")
    .replace(/\bveilig uit te sluiten\b/gi, "eerst routing of landingspagina controleren");

  if (assessment.productContextStatus === "protected_relevant") {
    return `${cleaned}. Beschermde assortiment-term: bespreek routing, bieding, landingspagina of variantmatch in plaats van uitsluiting.`;
  }
  if (assessment.productContextStatus === "review_first") {
    return `${cleaned}. Productevidence is onvoldoende hard voor uitsluiting; review eerst routing, LP, feed en variantmatch.`;
  }
  return cleaned;
}

function applyStep5FindingTruth(
  findings: Finding[],
  assessments: Map<string, ProductTermAssessment>
): Finding[] {
  return findings.map((finding) => {
    if (finding.entity_type !== "searchterm") return finding;
    const key = searchTermScopeKey(
      finding.entity_name,
      finding.parent_campaign || "",
      finding.parent_adgroup || ""
    );
    const assessment = assessments.get(key);
    if (!assessment) return finding;

    const next: Finding = { ...finding };

    if (assessment.productContextStatus === "protected_relevant" || assessment.productContextStatus === "relevant") {
      next.issue_cluster = "search_term_waste";
      next.action_required = true;
      next.evidence_level = "inferred";
      next.confidence = assessment.matchConfidence;
      next.cause = rewriteProtectedSearchTermCause(next.cause || "Routing of intent mismatch", assessment);
    } else if (assessment.productContextStatus === "review_first") {
      next.issue_cluster = "search_term_waste";
      next.action_required = true;
      next.evidence_level = "inferred";
      next.confidence = "low";
      next.cause = rewriteProtectedSearchTermCause(next.cause || "Review productmatch en intent", assessment);
    } else if (assessment.exclusionSafety === "safe_to_exclude_modifier_only") {
      next.issue_cluster = "search_term_waste";
      next.action_required = true;
      next.evidence_level = "inferred";
      next.confidence = assessment.matchConfidence;
      next.cause = `${rewriteProtectedSearchTermCause(next.cause || "Modifier-level mismatch", assessment)} Alleen modifier- of sub-intentuitsluiting is hier verdedigbaar, niet de productstam.`;
    }

    return next;
  });
}

function buildFallbackStepOutput(rawOutput: string, stepNumber: number): ParsedStepOutput {
  return {
    stepNumber,
    stepName: "",
    narrative: rawOutput,
    log_entries: ["Step output degraded - parse fallback toegepast."],
    findings: [],
    status: "NIET OP SCHEMA",
    actions: [],
    step_conclusion: "Parse error - handmatige review nodig.",
    rawOutput,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeStepNarrative(narrative: string): string {
  // F1: de opener-strip-regexes zijn verwijderd. Ze aten decimalen op ("(gem. 4.6)"
  // werd "4." waardoor het narratief begon met "6) ..."), wat de afgekapte stap-7
  // narratives veroorzaakte. De discipline-regel is nu de enige bron van waarheid:
  // het model schrijft geen recap, dus er valt niets te strippen.
  return narrative
    .replace(/^\s*\n+/, "")
    .trim();
}

function sanitizeStepLogEntry(entry: string): string {
  // F1: opener-strip-regexes verwijderd (ze aten decimalen); de discipline-regel voorkomt recaps.
  return entry.trim();
}

export function sanitizeStepActionText(stepNumber: number, action: string): string {
  let cleaned = action.trim();
  if (stepNumber === 2) {
    cleaned = cleaned
      .replace(/\bVoeg\s+(.+?)\s+toe als negatief zoekwoord/gi, "Plaats $1 als negatief zoekwoord")
      .replace(/\bom\s+(.+?)\s+te onderzoeken\b/gi, "voor een gecontroleerde validatie van $1")
      .replace(/\bonderzoe(?:k|kt|ken)\b/gi, "valideer")
      .replace(/\banalysee(?:r|rt|ren)\b/gi, "valideer")
      .replace(/\boptimalisee(?:r|rt|ren)\b/gi, "stuur concreet bij")
      .replace(/\bconsolidee(?:r|rt|ren)\b/gi, "bundel concreet")
      .replace(/\s+/g, " ")
      .trim();
  }
  return cleaned;
}

export function buildStep6NoDataFallback(): ParsedStepOutput {
  return {
    stepNumber: 6,
    stepName: "Product Performance",
    narrative: "Werkwijze A (Custom Labels/Categories): data niet beschikbaar door ontbrekende Merchant Center koppeling. Werkwijze B (SKU-niveau): productdata niet beschikbaar, dus productanalyse is nu niet uitvoerbaar.",
    log_entries: [
      "Werkwijze A (Custom Labels/Categories): data niet beschikbaar door ontbrekende Merchant Center koppeling.",
      "Werkwijze B (SKU-niveau): productdata niet beschikbaar.",
    ],
    findings: [],
    status: "NIET OP SCHEMA",
    actions: [{
      actie: "Herstel Merchant Center koppeling of productfeed-verrijking voordat productsturing live gaat",
      campagne: "Merchant Center / Productfeed",
      deadline: "deze_week",
      verwachte_impact: "Maakt productanalyse en SKU-sturing in de volgende cyclus weer mogelijk.",
    }],
    step_conclusion: "Productanalyse niet uitvoerbaar door ontbrekende product- en Merchant Center data.",
  };
}

export function buildCoverageDimensionAvailability(input: {
  campaignData: Record<string, unknown>[];
  campaignMetaData: Record<string, unknown>[];
  adgroupData: Record<string, unknown>[];
  isData: Record<string, unknown>[];
  searchData: Record<string, unknown>[];
  creativeData: Record<string, unknown>[];
  audienceData: Record<string, unknown>[];
  deviceData: Record<string, unknown>[];
  countryData: Record<string, unknown>[];
  networkData: Record<string, unknown>[];
  scheduleData: Record<string, unknown>[];
  enrichment: { dimensionProfile?: { dimensions: Map<string, { isAvailable?: boolean }> } | null };
  preparedContext?: AnalysisPreparedContextRow | null;
}): Partial<Record<CoverageDimension, boolean>> {
  const preparedCampaignFacts = input.preparedContext?.comparison_facts_campaigns ?? [];
  const preparedAdgroupFacts = input.preparedContext?.comparison_facts_adgroups ?? [];

  return {
    account: true,
    campaign: input.campaignData.length > 0 || input.campaignMetaData.length > 0 || preparedCampaignFacts.length > 0,
    adgroup: input.adgroupData.length > 0 || preparedAdgroupFacts.length > 0,
    competitor: input.isData.length > 0,
    search_term: input.searchData.length > 0,
    creative: input.creativeData.length > 0,
    audience: input.audienceData.length > 0,
    device: input.deviceData.length > 0,
    geography: input.countryData.length > 0,
    network: input.networkData.length > 0,
    schedule: input.scheduleData.length > 0,
    pmax_product_asset_groups: Boolean(
      input.enrichment.dimensionProfile?.dimensions.get("product_performance")?.isAvailable
      || input.enrichment.dimensionProfile?.dimensions.get("asset_group_performance")?.isAvailable
    ),
    hypotheses_sprint_plan: true,
  };
}

const MONTHLY_ACCEPTANCE_FINDING_CAP = 30;

function findingPriorityScore(finding: NormalizedFinding): number {
  let score = 0;
  if (finding.action_required) score += 40;
  if (finding.severity === "critical") score += 30;
  else if (finding.severity === "high") score += 24;
  else if (finding.severity === "medium") score += 12;
  else if (finding.severity === "low") score += 4;
  else score += 2;
  if (finding.evidence_level === "deterministic") score += 10;
  else if (finding.evidence_level === "inferred") score += 6;
  if (finding.confidence === "high") score += 5;
  else if (finding.confidence === "medium") score += 3;
  score += Math.min(8, Math.abs(finding.change_pct ?? 0) / 20);
  if (finding.metric === "Data Availability") score -= 30;
  if (!finding.action_required && (finding.severity === "positive" || finding.severity === "low")) score -= 8;
  return score;
}

export function curateMonthlyStructuredFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const withoutMetaAvailability = findings.filter((finding) => finding.metric !== "Data Availability");
  if (withoutMetaAvailability.length <= MONTHLY_ACCEPTANCE_FINDING_CAP) return withoutMetaAvailability;

  const groups = new Map<string, NormalizedFinding[]>();
  for (const finding of withoutMetaAvailability) {
    const key = `${finding.cluster_family}:::${finding.entity_identity_key}`;
    const existing = groups.get(key) || [];
    existing.push(finding);
    groups.set(key, existing);
  }

  const trimmed: NormalizedFinding[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => findingPriorityScore(b) - findingPriorityScore(a));
    const groupCap = sorted.some((finding) => finding.action_required && ["critical", "high"].includes(finding.severity)) ? 2 : 1;
    trimmed.push(...sorted.slice(0, groupCap));
  }

  const sortedTrimmed = trimmed.sort((a, b) => findingPriorityScore(b) - findingPriorityScore(a));
  return sortedTrimmed.slice(0, MONTHLY_ACCEPTANCE_FINDING_CAP);
}

function buildStep12AvailabilityInstruction(stepAvailability?: { dimensions: Array<{ name: string; available: boolean }> } | null): string {
  const dimensions = stepAvailability?.dimensions ?? [];
  if (dimensions.length === 0) return "";
  const available = dimensions.filter((dimension) => dimension.available).map((dimension) => dimension.name);
  const missing = dimensions.filter((dimension) => !dimension.available).map((dimension) => dimension.name);
  return [
    "## Strikte stap-12 datadiscipline",
    available.length > 0 ? `Beschikbare werkwijzen: ${available.join(", ")}.` : "Geen werkwijzen met data beschikbaar.",
    missing.length > 0 ? `Ontbrekende werkwijzen: ${missing.join(", ")}.` : "Geen ontbrekende werkwijzen.",
    "Als slechts een deel ontbreekt, benoem ALLEEN die specifieke werkwijze als data niet beschikbaar.",
    "Zeg NIET dat de hele stap geen data heeft zolang schedule of network wel data bevat.",
    "Maak alleen deterministic findings voor werkwijzen met echte data.",
  ].join("\n");
}

export function shouldRepairStep12Runtime(step: StepResult, validation: StepValidationResult): boolean {
  if (step.stepNumber !== 12) return false;
  const trimmedOutput = step.output.trim();
  return trimmedOutput.length === 0 || validation.errors.includes("Geen JSON-object gevonden in step output");
}

function buildStep12RepairUserMessage(message: string, runningContext: string, promptNote?: string): string {
  return `${message}

## Herstelinstructie Step 12
De vorige output voor stap 12 was leeg of niet parsebaar. Antwoord nu met EXACT één JSON-object conform het afgesproken schema.
- Geen markdown code fence
- Geen toelichting buiten JSON
- Benoem alleen checkout als niet beschikbaar als checkout-data echt ontbreekt
- Laat schedule en network findings staan als daar data voor is

## Data beschikbaarheid voor deze stap
${promptNote || "Geen extra data-opmerking."}

## Running context uit laatste checkpoint
${runningContext}`;
}

const HEAVY_WARNING_MATCHERS = [
  "Wiskundige inconsistentie",
  "Verwacht 3 findings",
  "Narratief bevat geen concrete cijfers",
  "AC-08",
  "Claim-consistentie",
  "Wereldkennis",
];

function countHeavyWarnings(validation: StepValidationResult): number {
  return validation.warnings.filter((warning) => HEAVY_WARNING_MATCHERS.some((matcher) => warning.includes(matcher))).length;
}

// F3 4a: generieke repair-trigger. True bij een error, of bij minimaal twee zware warnings.
// errorsOnly forceert (na de kostenrem) repair alleen nog op errors.
function shouldRepairStep(validation: StepValidationResult, errorsOnly: boolean): boolean {
  if (validation.errors.length > 0) return true;
  if (errorsOnly) return false;
  return countHeavyWarnings(validation) >= 2;
}

function buildStepRepairUserMessage(
  message: string,
  validation: StepValidationResult,
  runningContext: string,
  promptNote?: string
): string {
  const feedbackLines = [...validation.errors, ...validation.warnings].slice(0, 12);
  return `${message}

## REPAIR FEEDBACK
Je vorige output is afgekeurd. Los exact deze punten op en lever opnieuw volledig JSON:
${feedbackLines.map((line) => `- ${line}`).join("\n")}

## Data beschikbaarheid voor deze stap
${promptNote || "Geen extra data-opmerking."}

## Running context uit laatste checkpoint
${runningContext}`;
}

type StepAttempt = { step: StepResult; parsed: ParsedStepOutput; validation: StepValidationResult };

// F3 4a: kies het beste van origineel en repair (minste errors, dan minste zware warnings).
// Bij gelijke kwaliteit houdt dit het origineel, zodat een repair het nooit slechter maakt.
function pickBetterStepAttempt(original: StepAttempt, repaired: StepAttempt): StepAttempt {
  if (repaired.validation.errors.length !== original.validation.errors.length) {
    return repaired.validation.errors.length < original.validation.errors.length ? repaired : original;
  }
  const repairedHeavy = countHeavyWarnings(repaired.validation);
  const originalHeavy = countHeavyWarnings(original.validation);
  if (repairedHeavy !== originalHeavy) {
    return repairedHeavy < originalHeavy ? repaired : original;
  }
  return original;
}

function reconcileStep12Output(
  parsed: ParsedStepOutput,
  stepAvailability?: StepDataAvailability | null
): ParsedStepOutput {
  if (!stepAvailability) return parsed;
  const unavailableScopes = new Set(
    stepAvailability.dimensions
      .filter((dimension) => !dimension.available)
      .map((dimension) => dimension.name.toLowerCase().includes("checkout")
        ? "checkout"
        : dimension.name.toLowerCase().includes("schedule")
          ? "schedule"
          : dimension.name.toLowerCase().includes("network")
            ? "network"
            : dimension.name.toLowerCase())
  );
  const allUnavailable = stepAvailability.dimensions.length > 0 && stepAvailability.dimensions.every((dimension) => !dimension.available);
  if (allUnavailable) {
    return {
      ...parsed,
      narrative: "Checkout, schedule en network data niet beschikbaar. Deze stap kan alleen als datagap worden gelogd.",
      log_entries: ["Checkout funnel data niet beschikbaar.", "Schedule data niet beschikbaar.", "Network data niet beschikbaar."],
      findings: [],
      actions: [],
      step_conclusion: "Stap 12 is niet uitvoerbaar door ontbrekende checkout-, schedule- en networkdata.",
    };
  }

  const findingScope = (finding: ParsedStepOutput["findings"][number]): string | null => {
    if (finding.entity_type === "schedule" || finding.issue_cluster === "schedule_waste") return "schedule";
    if (finding.entity_type === "network" || finding.issue_cluster === "network_quality" || finding.issue_cluster === "search_partner_waste") return "network";
    if (/checkout|funnel|purchase|add to cart|begin checkout/i.test(`${finding.issue_cluster} ${finding.metric} ${finding.cause || ""}`)) return "checkout";
    return null;
  };

  return {
    ...parsed,
    findings: parsed.findings.filter((finding) => {
      const scope = findingScope(finding);
      return !scope || !unavailableScopes.has(scope);
    }),
  };
}

function collectJsonCandidates(value: unknown, depth = 0, seen = new Set<unknown>()): unknown[] {
  if (value == null || depth > 4 || seen.has(value)) return [];
  seen.add(value);

  const candidates: unknown[] = [value];
  if (typeof value === "string") {
    const extracted = extractJson(value);
    if (extracted && extracted !== value) candidates.push(extracted);
    try {
      candidates.push(JSON.parse(value));
    } catch {}
    return candidates;
  }

  if (Array.isArray(value)) {
    for (const item of value) candidates.push(...collectJsonCandidates(item, depth + 1, seen));
    return candidates;
  }

  if (isRecord(value)) {
    for (const key of ["output", "result", "data", "content", "payload", "response", "message"]) {
      if (key in value) candidates.push(...collectJsonCandidates(value[key], depth + 1, seen));
    }
    for (const nested of Object.values(value)) {
      candidates.push(...collectJsonCandidates(nested, depth + 1, seen));
    }
  }

  return candidates;
}

function coerceSafeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function coerceSafeStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return strings.length > 0 ? strings : fallback;
}

function coerceSafeStepPayload(candidate: unknown, stepNumber: number): StepOutput | null {
  const direct = StepOutputSchema.safeParse(candidate);
  if (direct.success) {
    return {
      ...direct.data,
      top_3_findings: direct.data.top_3_findings.map((finding) => ({ ...finding, step: stepNumber })),
    };
  }

  if (!isRecord(candidate)) return null;

  const nestedCandidates = collectJsonCandidates(candidate);
  for (const nested of nestedCandidates) {
    if (nested === candidate) continue;
    const nestedDirect = StepOutputSchema.safeParse(nested);
    if (nestedDirect.success) {
      return {
        ...nestedDirect.data,
        top_3_findings: nestedDirect.data.top_3_findings.map((finding) => ({ ...finding, step: stepNumber })),
      };
    }
  }

  const narrative = coerceSafeString(
    candidate.narrative,
    coerceSafeString(candidate.summary, coerceSafeString(candidate.analysis, "Step-output gedegradeerd: narratief onvolledig beschikbaar."))
  );
  const logEntries = coerceSafeStringArray(candidate.log_entries, ["Degraded parse fallback toegepast."]);
  const stepConclusion = coerceSafeString(candidate.step_conclusion, "Step-output gedegradeerd; handmatige review nodig.");
  const findings = Array.isArray(candidate.top_3_findings)
    ? candidate.top_3_findings
        .map((item) => FindingSchema.safeParse(item))
        .filter((result): result is { success: true; data: Finding } => result.success)
        .map((result) => ({ ...result.data, step: stepNumber }))
        .slice(0, 3)
    : [];
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item) => ({
          actie: coerceSafeString(item.actie, ""),
          campagne: typeof item.campagne === "string" ? item.campagne : null,
          deadline: (["direct", "deze_week", "volgende_week", "deze_maand"].includes(String(item.deadline)) ? item.deadline : "deze_week") as "direct" | "deze_week" | "volgende_week" | "deze_maand",
          verwachte_impact: coerceSafeString(item.verwachte_impact, ""),
        }))
        .filter((item) => item.actie.length >= 5 && item.verwachte_impact.length >= 5)
        .slice(0, 2)
    : [];

  return {
    narrative,
    log_entries: logEntries,
    top_3_findings: findings.length > 0 ? findings : [{
      step: stepNumber,
      issue_cluster: "uncategorized",
      entity_type: "account",
      entity_name: "Account",
      metric: "Parse Reliability",
      current_value: null,
      previous_value: null,
      change_pct: null,
      severity: "low",
      insight_type: "risk",
      is_seasonal: false,
      is_structural: false,
      cause: "Step-output was gedeeltelijk corrupt en is gedegradeerd gesalvaged.",
      action_required: false,
      evidence_level: "unknown",
      confidence: "low",
      benchmark_type: undefined,
    }],
    status: "NIET OP SCHEMA",
    actions,
    step_conclusion: stepConclusion,
  };
}

export function salvageStructuredStepOutput(rawOutput: string, stepNumber: number): { output: StepOutput | null; degraded: boolean } {
  const seedCandidates: unknown[] = [];
  const extracted = extractJson(rawOutput);
  if (extracted) seedCandidates.push(extracted);
  seedCandidates.push(rawOutput);

  for (const seed of seedCandidates) {
    for (const candidate of collectJsonCandidates(seed)) {
      const parsedValue = typeof candidate === "string"
        ? (() => { try { return JSON.parse(candidate); } catch { return candidate; } })()
        : candidate;
      const safe = coerceSafeStepPayload(parsedValue, stepNumber);
      if (!safe) continue;
      const direct = StepOutputSchema.safeParse(parsedValue);
      return { output: safe, degraded: !direct.success };
    }
  }

  return { output: null, degraded: true };
}

function parseStructuredStepOutput(
  step: StepResult,
  priorStepConclusion?: string,
  stepAvailability?: StepDataAvailability | null,
  canonicalMap?: CanonicalMetricMap,
  liveTerms?: string[],
  channelValidation?: { purityRules?: Partial<Record<number, StepPurityRule>>; logFormatSkeletons?: Record<number, RegExp[]> }
): { parsed: ParsedStepOutput; validation: StepValidationResult } {
  const salvaged = salvageStructuredStepOutput(step.output, step.stepNumber);
  if (!salvaged.output) {
    return {
      parsed: { ...buildFallbackStepOutput(step.output, step.stepNumber), stepName: step.stepName },
      validation: {
        stepNumber: step.stepNumber,
        valid: false,
        warnings: [],
        errors: ["Geen JSON-object gevonden in step output"],
      },
    };
  }

  try {
    const normalized: StepOutput = salvaged.output;
    const parsedStep: ParsedStepOutput = {
      stepNumber: step.stepNumber,
      stepName: step.stepName,
      narrative: sanitizeStepNarrative(normalized.narrative),
      log_entries: normalized.log_entries
        .map((entry) => sanitizeStepLogEntry(entry))
        .filter((entry) => entry.length > 0),
      findings: normalized.top_3_findings,
      status: normalized.status,
      actions: normalized.actions.map((action) => ({
        ...action,
        actie: sanitizeStepActionText(step.stepNumber, action.actie),
      })),
      step_conclusion: normalized.step_conclusion,
      rawOutput: step.output,
    };
    const reconciledStep = step.stepNumber === 12
      ? reconcileStep12Output(parsedStep, stepAvailability)
      : parsedStep;
    const validationPayload: StepOutput = {
      narrative: reconciledStep.narrative,
      log_entries: reconciledStep.log_entries,
      top_3_findings: reconciledStep.findings,
      status: reconciledStep.status,
      actions: reconciledStep.actions,
      step_conclusion: reconciledStep.step_conclusion,
    };
    const scopedValidation = validateStepOutput(step.stepNumber, validationPayload, priorStepConclusion, { availability: stepAvailability, liveTerms, purityRules: channelValidation?.purityRules, logFormatSkeletons: channelValidation?.logFormatSkeletons });
    const claimWarnings = canonicalMap
      ? validateFindingClaims(step.stepNumber, reconciledStep.findings, canonicalMap).map((issue) => issue.message)
      : [];
    const baseWarnings = salvaged.degraded
      ? ["Step-output was gedegradeerd of nested JSON; parse salvage toegepast.", ...scopedValidation.warnings]
      : scopedValidation.warnings;
    return {
      parsed: reconciledStep,
      validation: { ...scopedValidation, warnings: [...baseWarnings, ...claimWarnings] },
    };
  } catch (error) {
    return {
      parsed: { ...buildFallbackStepOutput(step.output, step.stepNumber), stepName: step.stepName },
      validation: {
        stepNumber: step.stepNumber,
        valid: false,
        warnings: [],
        errors: [`JSON parse failed: ${error instanceof Error ? error.message : "onbekende fout"}`],
      },
    };
  }
}

function severityScore(severity: Finding["severity"]): number {
  switch (severity) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "positive":
      return 1;
  }
}

function mergeParsedStepOutputs(parts: ParsedStepOutput[], stepNumber: number, stepName: string): ParsedStepOutput {
  const findingsByKey = new Map<string, Finding>();
  for (const part of parts) {
    for (const finding of part.findings) {
      const key = `${finding.entity_name}::${finding.metric}`;
      const existing = findingsByKey.get(key);
      if (!existing || severityScore(finding.severity) > severityScore(existing.severity)) {
        findingsByKey.set(key, { ...finding, step: stepNumber });
      }
    }
  }

  const mergedFindings = Array.from(findingsByKey.values())
    .sort((a, b) => severityScore(b.severity) - severityScore(a.severity) || Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0))
    .slice(0, 3);

  const mergedActions = parts
    .flatMap((part) => part.actions)
    .map((action) => ({
      ...action,
      deadline: (["direct", "deze_week", "volgende_week", "deze_maand"].includes(action.deadline)
        ? action.deadline
        : "deze_week") as "direct" | "deze_week" | "volgende_week" | "deze_maand",
    }))
    .slice(0, 2);

  const statusRank = { "KRITIEK": 3, "NIET OP SCHEMA": 2, "OP SCHEMA": 1 } as const;
  const mergedStatus = parts
    .map((part) => part.status)
    .sort((a, b) => statusRank[b] - statusRank[a])[0] ?? "OP SCHEMA";

  const stepConclusion = parts[parts.length - 1]?.step_conclusion
    || parts[0]?.step_conclusion
    || "Samengevoegde stapconclusie ontbreekt.";

  return {
    stepNumber,
    stepName,
    narrative: parts.length > 1
      ? parts[parts.length - 1].narrative.trim()
      : parts[0]?.narrative.trim() || "",
    log_entries: [
      ...(parts.length > 1 ? [`Classificatie (7A): ${parts[0]?.step_conclusion || "geen classificatieconclusie beschikbaar."}`] : []),
      ...parts.flatMap((part) => part.log_entries),
    ],
    findings: mergedFindings,
    status: mergedStatus,
    actions: mergedActions,
    step_conclusion: stepConclusion,
    rawOutput: JSON.stringify({
      narrative: parts.map((part) => part.narrative),
      log_entries: parts.flatMap((part) => part.log_entries),
      top_3_findings: mergedFindings,
      status: mergedStatus,
      actions: mergedActions,
      step_conclusion: stepConclusion,
    }),
  };
}

interface AssessedSearchTermRow {
  term: string;
  campaign: string;
  adGroup: string;
  clicks: number;
  cost: number;
  conversions: number;
  assessment: ProductTermAssessment;
}

// ── Route handler ───────────────────────────────────────────────────────────

// M2 route-wiring: het additieve Meta-pad. Draait de 11-staps Meta SOP op de gedeelde route-helpers
// met de Meta-datalaag, en laat het Google-pad volledig ongemoeid via de vroege branch in POST.
// LIVE-ONGETEST: de Supabase-fetch in buildMetaAnalysisData en de end-to-end run zijn pas met echte
// Meta-data te verifieren. Bewust nog zonder checkpoints, acceptance-rapport en de volledige
// structured_monthly_v2-aggregatie; dat zijn verfijningen op deze runnende kern.
async function runMetaMonthlyAnalysis(
  supabase: SupabaseClient,
  adapter: ChannelAdapter,
  clientId: string,
  jobId: string
, evalCapture: { fixtureSet: string } | null = null): Promise<Response> {
  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const analysisYear = currentMonth === 1 ? now.getFullYear() - 1 : now.getFullYear();
  const lastCompleteMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const periodEnd = fmt(new Date(analysisYear, lastCompleteMonth, 0));
  const periodStart = thirteenMonthStart(periodEnd);

  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "monthly_sop",
    initialMessage: "Meta-analyse wordt voorbereid...",
    metadata: { sop_type: adapter.sopTypeKey },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "load_meta_data",
    message: "Meta-data en voorgerekende feiten laden...",
  });

  const clientCtx = await fetchClientContext(supabase, clientId);
  const { goalsSection, accountType } = clientCtx;

  const { canonicalMetricMap, stepFacts } = await buildMetaAnalysisData(supabase, clientId, periodEnd);

  // E1-wiring (Meta): het client-geheugen eenmalig ophalen, zelfde patroon als Google.
  const clientMemorySection = buildClientMemoryGrounding(await getClientMemory(supabase, clientId));

  const shared = { supabase, apiKey, clientId, sopType: adapter.sopTypeKey, periodStart, periodEnd, runKey: jobId, channel: adapter.channel, evalCapture };
  const parsedSteps: ParsedStepOutput[] = [];
  const allSteps: StepResult[] = [];
  const conclusions: string[] = [];
  const analysisDate = new Date().toISOString().split("T")[0];

  for (let stepNumber = 1; stepNumber <= adapter.stepCount; stepNumber++) {
    const stepName = metaStepName(stepNumber);
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: `run_step_${stepNumber}`,
      message: `Stap ${stepNumber} uitvoeren: ${stepName}...`,
    });
    const systemPrompt = buildMonthlyStepPrompt(
      goalsSection,
      accountType,
      adapter.stepInstructions[stepNumber],
      conclusions.slice(-2).join("\n\n"),
      adapter,
      clientMemorySection
    );
    const userMessage = buildMetaStepMessage(stepNumber, stepFacts[stepNumber], clientId);
    const step = await runStep({ ...shared, stepNumber, stepName, systemPrompt, userMessage });
    allSteps.push(step);
    const priorStepConclusion = conclusions.at(-1);
    const { parsed } = parseStructuredStepOutput(
      step,
      priorStepConclusion,
      undefined,
      canonicalMetricMap,
      undefined,
      { purityRules: adapter.purityRules, logFormatSkeletons: adapter.logFormatSkeletons }
    );
    parsedSteps.push(parsed);
    if (parsed.step_conclusion) conclusions.push(parsed.step_conclusion);
    await saveAnalysisOutputSection({
      supabase,
      row: {
        client_id: clientId,
        sop_type: adapter.sopTypeKey,
        analysis_date: analysisDate,
        period_start: periodStart,
        period_end: periodEnd,
        section: stepName,
        output: step.output,
        model_used: step.model,
        tokens_used: step.tokensUsed,
        step_number: stepNumber,
        step_name: stepName,
      },
    });
  }

  const rawStepFindings = parsedSteps.flatMap((step) => step.findings);
  const canonical = canonicalizeFindings(rawStepFindings, {}, {
    entityAliases: adapter.entityAliases,
    metricAliases: adapter.metricAliases,
    validClusters: adapter.issueClusters,
  });
  const curatedFindings = curateMonthlyStructuredFindings(canonical.findings);
  const curatedClusters = clusterFindings(curatedFindings);

  return Response.json({
    ok: true,
    channel: adapter.channel,
    period: { start: periodStart, end: periodEnd },
    steps: parsedSteps.length,
    findings: curatedFindings.length,
    clusters: curatedClusters.length,
    tokensUsed: allSteps.reduce((sum, current) => sum + (current.tokensUsed || 0), 0),
  });
}

// L2 route-wiring: het additieve LinkedIn-pad. Draait de 9-staps LinkedIn SOP op de gedeelde
// route-helpers met de LinkedIn-datalaag, en laat het Google- en Meta-pad ongemoeid via de vroege
// branch. LIVE-ONGETEST: de Supabase-fetch in buildLinkedinAnalysisData en de end-to-end run zijn
// pas met echte L1-data via MDP te verifieren. Bewust nog zonder checkpoints, acceptance en de
// volledige synthese; dat zijn verfijningen op deze runnende kern, net als bij Meta.
async function runLinkedinMonthlyAnalysis(
  supabase: SupabaseClient,
  adapter: ChannelAdapter,
  clientId: string,
  jobId: string
, evalCapture: { fixtureSet: string } | null = null): Promise<Response> {
  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const analysisYear = currentMonth === 1 ? now.getFullYear() - 1 : now.getFullYear();
  const lastCompleteMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const periodEnd = fmt(new Date(analysisYear, lastCompleteMonth, 0));
  const periodStart = thirteenMonthStart(periodEnd);

  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "monthly_sop",
    initialMessage: "LinkedIn-analyse wordt voorbereid...",
    metadata: { sop_type: adapter.sopTypeKey },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "load_linkedin_data",
    message: "LinkedIn-data en voorgerekende feiten laden...",
  });

  const clientCtx = await fetchClientContext(supabase, clientId);
  const { goalsSection, accountType } = clientCtx;

  // De ICP-definitie voedt de kernstap (stap 5); zonder degradeert die netjes naar beschrijvend.
  const { data: settings } = await supabase.from("client_settings").select("linkedin_icp").eq("client_id", clientId).maybeSingle();
  const icp = (settings as { linkedin_icp?: LinkedInIcp } | null)?.linkedin_icp ?? null;

  const { canonicalMetricMap, stepFacts } = await buildLinkedinAnalysisData(supabase, clientId, periodEnd, { icp });

  // E1-wiring (LinkedIn): het client-geheugen eenmalig ophalen, zelfde patroon als Google.
  const clientMemorySection = buildClientMemoryGrounding(await getClientMemory(supabase, clientId));

  const shared = { supabase, apiKey, clientId, sopType: adapter.sopTypeKey, periodStart, periodEnd, runKey: jobId, channel: adapter.channel, evalCapture };
  const parsedSteps: ParsedStepOutput[] = [];
  const allSteps: StepResult[] = [];
  const conclusions: string[] = [];
  const analysisDate = new Date().toISOString().split("T")[0];

  for (let stepNumber = 1; stepNumber <= adapter.stepCount; stepNumber++) {
    const stepName = linkedinStepName(stepNumber);
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: `run_step_${stepNumber}`,
      message: `Stap ${stepNumber} uitvoeren: ${stepName}...`,
    });
    const systemPrompt = buildMonthlyStepPrompt(
      goalsSection,
      accountType,
      adapter.stepInstructions[stepNumber],
      conclusions.slice(-2).join("\n\n"),
      adapter,
      clientMemorySection
    );
    const userMessage = buildLinkedinStepMessage(stepNumber, stepFacts[stepNumber], clientId);
    const step = await runStep({ ...shared, stepNumber, stepName, systemPrompt, userMessage });
    allSteps.push(step);
    const priorStepConclusion = conclusions.at(-1);
    const { parsed } = parseStructuredStepOutput(
      step,
      priorStepConclusion,
      undefined,
      canonicalMetricMap,
      undefined,
      { purityRules: adapter.purityRules, logFormatSkeletons: adapter.logFormatSkeletons }
    );
    parsedSteps.push(parsed);
    if (parsed.step_conclusion) conclusions.push(parsed.step_conclusion);
    await saveAnalysisOutputSection({
      supabase,
      row: {
        client_id: clientId,
        sop_type: adapter.sopTypeKey,
        analysis_date: analysisDate,
        period_start: periodStart,
        period_end: periodEnd,
        section: stepName,
        output: step.output,
        model_used: step.model,
        tokens_used: step.tokensUsed,
        step_number: stepNumber,
        step_name: stepName,
      },
    });
  }

  const rawStepFindings = parsedSteps.flatMap((step) => step.findings);
  const canonical = canonicalizeFindings(rawStepFindings, {}, {
    entityAliases: adapter.entityAliases,
    metricAliases: adapter.metricAliases,
    validClusters: adapter.issueClusters,
  });
  const curatedFindings = curateMonthlyStructuredFindings(canonical.findings);
  const curatedClusters = clusterFindings(curatedFindings);

  return Response.json({
    ok: true,
    channel: adapter.channel,
    period: { start: periodStart, end: periodEnd },
    steps: parsedSteps.length,
    findings: curatedFindings.length,
    clusters: curatedClusters.length,
    tokensUsed: allSteps.reduce((sum, current) => sum + (current.tokensUsed || 0), 0),
  });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });
  const googleAdsCredentials = getCredentials();

  let clientId: string;
  let jobId = crypto.randomUUID();
  let adapter: ChannelAdapter;
  let evalCapture: { fixtureSet: string } | null = null;
  try {
    const body = await request.json();
    clientId = body.client_id;
    jobId = body.job_id || crypto.randomUUID();
    adapter = getAdapter(body.channel || "google_ads");
    evalCapture = body.capture_fixtures === true
      ? { fixtureSet: typeof body.fixture_set === "string" && body.fixture_set.trim() ? body.fixture_set.trim() : `${clientId}:${jobId}` }
      : null;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 });
  }

  try {
    if (adapter.channel === "meta_ads") {
      return await runMetaMonthlyAnalysis(supabase, adapter, clientId, jobId, evalCapture);
    }
    if (adapter.channel === "linkedin_ads") {
      return await runLinkedinMonthlyAnalysis(supabase, adapter, clientId, jobId, evalCapture);
    }
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const analysisYear = currentMonth === 1 ? now.getFullYear() - 1 : now.getFullYear();
    const lastCompleteMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const periodEndDate = new Date(analysisYear, lastCompleteMonth, 0);
    const periodEnd = fmt(periodEndDate);
    const periodStart = monthsAgo(13);
    let preparedContext = await getPreparedContext(supabase, clientId, periodEnd);
    const usePreparedSummary = Boolean(preparedContext);

    await createProgressJob(supabase, {
      jobId,
      clientId,
      jobType: "monthly_sop",
      initialMessage: "Analyse wordt voorbereid...",
      metadata: { sop_type: adapter.sopTypeKey },
    });
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "init",
      message: "Analyseperiode en context initialiseren...",
    });

    // Phase 1: Fetch all Supabase data + client context + forecast targets in parallel
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "fetch_data",
      message: "Analyse-data voor account, campagnes en dimensies ophalen...",
    });
    const [
      accountRes, weeklyRes, campaignRes, adgroupRes, isRes, searchRes,
      accountYoyRes, campaignYoyRes, campaignMetaRes,
      creativeRes, audienceRes, deviceRes, countryRes, countryYoyRes, networkRes, scheduleRes, productRes,
      keywordRes, enrichedProductRes, checkoutRes,
      clientCtx, targetResult,
    ] = await Promise.all([
      usePreparedSummary
        ? Promise.resolve({ data: [] as Record<string, unknown>[] })
        : supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).lte("month", periodEnd).order("month"),
      usePreparedSummary
        ? Promise.resolve({ data: [] as Record<string, unknown>[] })
        : supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).gte("week_start", monthsAgo(2)).lte("week_start", periodEnd).order("week_start"),
      usePreparedSummary
        ? Promise.resolve({ data: [] as Record<string, unknown>[] })
        : supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).lte("month", periodEnd).order("month"),
      supabase.from("ads_adgroup_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).lte("month", periodEnd).order("month"),
      supabase.from("ads_campaign_impression_share").select("*").eq("client_id", clientId).gte("month", monthsAgo(6)).lte("month", periodEnd).order("month"),
      supabase.from("ads_search_terms_wasteful").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(500),
      usePreparedSummary
        ? Promise.resolve({ data: [] as Record<string, unknown>[] })
        : supabase.from("ads_account_yoy").select("*").eq("client_id", clientId).lte("month", periodEnd).order("month"),
      usePreparedSummary
        ? Promise.resolve({ data: [] as Record<string, unknown>[] })
        : supabase.from("ads_campaign_yoy").select("*").eq("client_id", clientId).lte("month", periodEnd).order("month"),
      supabase.from("ads_campaign_metadata").select("*").eq("client_id", clientId),
      // Dimensional data for new steps
      supabase.from("ads_creative_performance").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("impressions", { ascending: false }).limit(100),
      supabase.from("ads_audience_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(100),
      supabase.from("ads_device_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("month"),
      supabase.from("ads_country_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(6)).lte("month", periodEnd).order("month"),
      supabase.from("ads_country_yoy").select("*").eq("client_id", clientId).lte("month", periodEnd),
      supabase.from("ads_network_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(100),
      supabase.from("ads_ad_schedule_performance").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(200),
      supabase.from("ads_product_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(200),
      supabase.from("ads_keyword_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(300),
      supabase.from("google_ads_product_performance").select("*").eq("client_id", clientId).gte("date", monthsAgo(3)).lte("date", periodEnd).order("cost", { ascending: false }).limit(300),
      supabase.from("google_ads_checkout_funnel").select("*").eq("client_id", clientId).gte("date", monthsAgo(3)).lte("date", periodEnd).order("date"),
      fetchClientContext(supabase, clientId),
      computeAnalysisTargets(supabase, clientId),
    ]);

    const { accountType } = clientCtx;
    let goalsSection = clientCtx.goalsSection;
    // E1-wiring: het client-geheugen eenmalig ophalen voor de lus (niet per step) en
    // naar een grounding-blok formatteren; leeg blok bij een klant zonder historie.
    const clientMemory = await getClientMemory(supabase, clientId);
    const clientMemorySection = buildClientMemoryGrounding(clientMemory);

    // A-track: de deterministisch gedetecteerde signalen en cross-checks, eenmalig voor de
    // lus. Zelfde principe als het geheugenblok: een lege sectie geeft byte-identieke
    // prompts, dus een account zonder signalen merkt niets.
    const analysisMonth = periodEnd.slice(0, 7);
    const prevMonthDate = new Date(periodEndDate.getFullYear(), periodEndDate.getMonth() - 1, 1);
    const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;

    // De wijzigingshistorie bepaalt of concurrentiedruk bewezen mag heten. CONSERVATIEVE
    // REGEL: nul rijen in de analysemaand telt als bron-onbekend (null), niet als "geen
    // wijzigingen". Een actief account zonder enige wijziging is onwaarschijnlijker dan een
    // niet-gevulde bron, en over-claimen is de duurdere fout.
    const negativesRes = await supabase
      .from("ads_negative_keywords")
      .select("level, campaign_name, ad_group_name, list_name, keyword_text, match_type")
      .eq("client_id", clientId);

    const changeHistoryRes = await supabase
      .from("ads_change_history")
      .select("resource_type, campaign_name")
      .eq("client_id", clientId)
      .gte("change_datetime", `${analysisMonth}-01`)
      .lte("change_datetime", `${periodEnd}T23:59:59`);
    const changeHistoryRows = (changeHistoryRes.data ?? []) as ChangeHistoryRow[];

    // De zoektermvolumes: de DERDE onafhankelijke bron voor de marktshift-bevestiging.
    // ads_search_terms_monthly wordt wel gesynct maar werd door deze route niet geladen
    // (searchRes haalt de wasteful-tabel op, een andere bron met een ander doel).
    const termsRes = await supabase
      .from("ads_search_terms_monthly")
      .select("month, impressions, match_type, cost, clicks, conversions")
      .eq("client_id", clientId)
      .gte("month", `${prevMonth}-01`)
      .lte("month", periodEnd);
    const volumeFor = (m: string): number | null => {
      const rows = (termsRes.data ?? []).filter((r) => String(r.month ?? "").slice(0, 7) === m);
      return rows.length > 0 ? rows.reduce((acc, r) => acc + Number(r.impressions ?? 0), 0) : null;
    };

    const yoyRowForMonth = (accountYoyRes.data ?? []).find((r) => String(r.month ?? "").slice(0, 7) === analysisMonth) as { impressions_yoy_pct?: number | null } | undefined;
    const signalsSection = buildGoogleSignalsSection({
      periodMonth: analysisMonth,
      prevMonth,
      campaignIs: (isRes.data ?? []) as unknown as CampaignIsRow[],
      campaignMonthly: (campaignRes.data ?? []) as unknown as CampaignMonthlyRow[],
      keywords: (keywordRes.data ?? []) as unknown as KeywordMonthlyRow[],
      schedule: (scheduleRes.data ?? []) as unknown as ScheduleRow[],
      networks: (networkRes.data ?? []) as unknown as NetworkMonthlyRow[],
      devices: (deviceRes.data ?? []) as unknown as DeviceMonthlyRow[],
      pmaxCampaignNames: (campaignMetaRes.data ?? [])
        .filter((m) => String((m as { campaign_type?: string }).campaign_type ?? "").toUpperCase().includes("PERFORMANCE_MAX"))
        .map((m) => String((m as { campaign_name?: string }).campaign_name ?? ""))
        .filter((n) => n.length > 0),
      // De sync schrijft *_yoy_pct als PROCENT; de detector verwacht een relatieve fractie.
      yoyImpressionsDeltaFraction: yoyRowForMonth?.impressions_yoy_pct != null ? Number(yoyRowForMonth.impressions_yoy_pct) / 100 : null,
      searchTermsVolume: volumeFor(analysisMonth),
      prevSearchTermsVolume: volumeFor(prevMonth),
      searchTerms: (termsRes.data ?? []) as unknown as SearchTermMonthlyLite[],
      negatives: (negativesRes.data ?? []) as unknown as NegativeKeywordRow[],
      changeHistory: changeHistoryRows.length > 0 ? changeHistoryRows : null,
      hasPmaxCampaign: (campaignMetaRes.data ?? []).some((m) => String((m as { campaign_type?: string }).campaign_type ?? "").toUpperCase().includes("PERFORMANCE_MAX")),
    }).section;

    const accountData = accountRes.data ?? [];
    // W1.1 (O2): plausibiliteits-flag op de goals-targets tegen de laatste twee afgesloten
    // maanden. Zonder flag geen herbouw, dus byte-identiek aan het bestaande pad.
    let goalsTargetsImplausible = false;
    if (clientCtx.goalsConfig) {
      const goalsPlausibility = goalsPlausibilityFromMonthly(
        clientCtx.goalsConfig as { cpaTarget?: number; roasTarget?: number },
        accountData as Array<{ month?: string; cost?: number; conversions?: number; conversions_value?: number }>
      );
      if (goalsPlausibility?.target_implausible) {
        goalsSection = buildGoalsSection({
          ...(clientCtx.goalsConfig as unknown as Parameters<typeof buildGoalsSection>[0]),
          plausibility: { target_implausible: true, detail: goalsPlausibility.detail },
        });
        goalsTargetsImplausible = true;
      }
    }
    if (!usePreparedSummary && accountData.length === 0) {
      const freshness = await checkDataFreshness(supabase, clientId);
      await markProgressFailed(supabase, {
        jobId,
        errorMessage: freshness.message,
      });
      return Response.json({
        error: freshness.message,
        freshnessStatus: freshness.freshnessStatus,
        lastSyncAt: freshness.lastSyncAt,
        action: freshness.freshnessStatus === "missing"
          ? "Sync de data via POST /api/sync met { client_id: \"...\", }"
          : "Data is aanwezig maar leeg voor de gevraagde periode.",
      }, { status: 404 });
    }

    const weeklyData = weeklyRes.data ?? [];
    const campaignData = campaignRes.data ?? [];
    // F4: canonical metric map uit dezelfde rijen die de prompts voeden, voor claim-consistentie.
    const canonicalMetricMap = buildCanonicalMetricMap(
      campaignData as Record<string, unknown>[],
      accountData as Record<string, unknown>[],
      periodStart,
      periodEnd
    );
    const adgroupData = adgroupRes.data ?? [];
    const isData = isRes.data ?? [];
    const searchData = searchRes.data ?? [];
    const accountYoyData = accountYoyRes.data ?? [];
    const campaignYoyData = campaignYoyRes.data ?? [];
    const campaignMetaData = campaignMetaRes.data ?? [];
    // Dimensional data
    const creativeData = creativeRes.data ?? [];
    const audienceData = audienceRes.data ?? [];
    const deviceData = deviceRes.data ?? [];
    const countryData = countryRes.data ?? [];
    const countryYoyData = countryYoyRes.data ?? [];
    const networkData = networkRes.data ?? [];
    const scheduleData = scheduleRes.data ?? [];
    const productData = productRes.data ?? [];
    const keywordData = keywordRes.data ?? [];
    const enrichedProductData = enrichedProductRes.data ?? [];
    // G4: live-termenset (campagnenamen, zoektermen, productnamen) voor de wereldkennis-check.
    const liveTermSet = Array.from(new Set([
      ...campaignData.map((row: Record<string, unknown>) => String(row.campaign_name || "")),
      ...searchData.map((row: Record<string, unknown>) => String(row.search_term || "")),
      ...productData.map((row: Record<string, unknown>) => String(row.product_title || "")),
    ].map((term) => term.toLowerCase().trim()).filter((term) => term.length >= 3)));
    const checkoutData = checkoutRes.data ?? [];
    const merchantSync = await syncMerchantProductSnapshots({
      supabase,
      clientId,
      credentials: googleAdsCredentials,
    });

    // Phase 2: Build enrichment context via enrichment matrix (parallel)
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "enrich_context",
      message: "Strategische context, benchmarks en enrichment laden...",
    });
    const enrichment = await buildEnrichmentContext({
      supabase,
      clientId,
      accountType,
      sopType: "monthly",
      analysisDate: periodEnd,
      campaignData,
      campaignMetaData,
    });

    // W1.1c: ingestelde targets (client_targets) voor deze maand. UITSLUITEND uit
    // client_targets (no-go: geen kpiTargets in dit pad); leeg in productie tot WL.2,
    // dus zonder targets blijft het pad byte-identiek.
    // LIVE-ONGETEST tot migratie 002 draait.
    const { data: configuredTargetRows } = await supabase
      .from("client_targets")
      .select("channel, metric, target_value, valid_from, valid_to")
      .eq("client_id", clientId)
      .eq("channel", "google_ads");
    const configuredTargets = resolveTargets(
      ((configuredTargetRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        channel: String(row.channel),
        metric: String(row.metric),
        targetValue: Number(row.target_value),
        validFrom: String(row.valid_from),
        validTo: row.valid_to == null ? null : String(row.valid_to),
      })) as TargetRow[],
      "google_ads",
      periodEnd
    );
    const configuredBlock = buildConfiguredTargetsBlock(
      configuredTargets,
      targetActualsFromMonthly(accountData as Array<{ month?: string; cost?: number; conversions?: number; conversions_value?: number }>)
    );
    const configuredTargetsText = configuredBlock ? `\n\n${configuredBlock.text}` : "";
    if (configuredBlock?.anyImplausible) goalsTargetsImplausible = true;

    // Format monthly targets from forecast engine
    const targetText = targetResult
      ? `\n\n## Maandtargets (berekend door forecast engine, zelfde als dashboard)
${targetResult.monthlyExpected.map((t) => `- Maand ${t.month}: verwacht ${t.conversions} conversies, €${t.revenue} omzet, €${t.adSpend} spend`).join("\n")}
Analyse maand: ${lastCompleteMonth} (${["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"][lastCompleteMonth - 1]} ${analysisYear})
Verwacht deze maand: ${targetResult.monthlyExpected[lastCompleteMonth - 1]?.conversions ?? "?"} conversies` + configuredTargetsText
      : configuredTargetsText;

    // Format campaign metadata for user message
    const activeCampaigns = campaignMetaData.filter((cm: Record<string, unknown>) => {
      const status = String(cm.serving_status || "").toUpperCase();
      return status === "ELIGIBLE" || status === "SERVING" || status === "ENABLED";
    });
    const pausedCampaigns = campaignMetaData.filter((cm: Record<string, unknown>) => {
      const status = String(cm.serving_status || "").toUpperCase();
      return status !== "ELIGIBLE" && status !== "SERVING" && status !== "ENABLED";
    });

    const campaignMetaText = campaignMetaData.length > 0
      ? "\n\n## Campaign Metadata\n" + campaignMetaData.map((cm: Record<string, unknown>) =>
          `- ${cm.campaign_name}: type=${cm.campaign_type}, bidding=${cm.bidding_strategy}, target=${cm.bidding_strategy_target}, budget=€${cm.budget_amount}/dag, status=${cm.serving_status}`
        ).join("\n")
        + (pausedCampaigns.length > 0 ? `\n\nBELANGRIJK: ${pausedCampaigns.length} campagne(s) zijn GEPAUZEERD of VERWIJDERD: ${pausedCampaigns.map((c: Record<string, unknown>) => c.campaign_name).join(", ")}. Doe GEEN aanbevelingen voor gepauzeerde/verwijderde campagnes. Vermeld ze alleen als historische context.` : "")
      : "";

    const shared = { supabase, apiKey, clientId, sopType: "monthly", periodStart, periodEnd, runKey: jobId, channel: "google_ads", evalCapture };
    const steps: StepResult[] = [];
    const machineSteps: StepResult[] = [];
    const parsedSteps: ParsedStepOutput[] = [];
    const conclusions: string[] = [];
    const stepValidations: StepValidationResult[] = [];
    const checkpointSteps: StepResult[] = [];
    const checkpointOutputs: Array<{ name: string; parsed: CheckpointOutput | null; raw: string }> = [];
    let partialOutputExists = false;
    let runningContext = "Nog geen checkpoint-context beschikbaar.";

    let step5TruthMap = new Map<string, ProductTermAssessment>();
    let assessedSearchTerms: AssessedSearchTermRow[] = [];

    async function runCheckpoint(name: string, clusterStepNumbers: number[]): Promise<void> {
      const clusterSteps = parsedSteps.filter((step) => clusterStepNumbers.includes(step.stepNumber));
      const checkpointStep = await runStep({
        evalKind: "checkpoint",
        ...shared,
        stepNumber: 200 + checkpointSteps.length + 1,
        stepName: name,
        systemPrompt: buildMonthlyCheckpointPrompt(name),
        jsonMode: true,
        userMessage: `Stap-outputs uit ${name}:

${JSON.stringify(clusterSteps.map((step) => ({
  stepNumber: step.stepNumber,
  stepName: step.stepName,
  narrative: step.narrative,
  log_entries: step.log_entries,
  findings: step.findings,
  status: step.status,
  actions: step.actions,
  step_conclusion: step.step_conclusion,
})), null, 2)}

Vorige running context:
${runningContext}`,
      });
      checkpointSteps.push(checkpointStep);
      machineSteps.push(checkpointStep);

      let parsed = parseCheckpointOutput(checkpointStep.output);
      let parsedOutput = checkpointStep.output;
      if (!parsed.success) {
        // F3 4b: een jsonMode-repair met de parse-fout als feedback voordat de tekstuele fallback wordt gebruikt.
        const repairStep = await runStep({
          evalKind: "repair",
          ...shared,
          stepNumber: 200 + checkpointSteps.length + 1,
          stepName: name,
          systemPrompt: buildMonthlyCheckpointPrompt(name),
          jsonMode: true,
          userMessage: `Je vorige checkpoint-output voor ${name} kon niet als JSON worden geparsed (${parsed.error}). Antwoord nu met EXACT een JSON-object conform het checkpoint-schema, zonder markdown code fence en zonder toelichting buiten JSON.

Stap-outputs uit ${name}:

${JSON.stringify(clusterSteps.map((step) => ({
  stepNumber: step.stepNumber,
  stepName: step.stepName,
  narrative: step.narrative,
  log_entries: step.log_entries,
  findings: step.findings,
  status: step.status,
  actions: step.actions,
  step_conclusion: step.step_conclusion,
})), null, 2)}

Vorige running context:
${runningContext}`,
        });
        checkpointSteps.push(repairStep);
        machineSteps.push(repairStep);
        const reparsed = parseCheckpointOutput(repairStep.output);
        if (reparsed.success) {
          parsed = reparsed;
          parsedOutput = repairStep.output;
        }
      }
      if (parsed.success) {
        runningContext = parsed.data.running_context;
        checkpointOutputs.push({ name, parsed: parsed.data, raw: parsedOutput });
        // W1.3 (pump, ontwerpbesluit 1): persisteer het GELDIGE checkpoint zodat een
        // hervatte run de runningContext kan herstellen; een gefaalde parse wordt bewust
        // niet opgeslagen zodat resume het checkpoint opnieuw draait. Upsert, dus
        // idempotent. LIVE-ONGETEST tot de eerste onderbroken run.
        if (supabase) {
          const { error: checkpointSaveError } = await saveAnalysisOutputSection({
            supabase,
            row: {
              client_id: clientId,
              sop_type: "monthly",
              analysis_date: new Date().toISOString().split("T")[0],
              period_start: periodStart,
              period_end: periodEnd,
              section: name,
              output: parsedOutput,
              model_used: checkpointStep.model,
              tokens_used: checkpointStep.tokensUsed,
              step_number: 0,
              step_name: name,
            },
          });
          if (checkpointSaveError) {
            logger.error(`[monthly] Checkpoint-sectie opslaan faalde voor ${name}:`, checkpointSaveError);
          }
        }
        return;
      }

      runningContext = clusterSteps
        .slice(-2)
        .map((step) => `Stap ${step.stepNumber} (${step.stepName}) bevestigt: ${step.findings.slice(0, 2).map((finding) => `${finding.entity_name} ${finding.metric}`).join(", ") || "geen materieel signaal"}.`)
        .join(" ");
      checkpointOutputs.push({ name, parsed: null, raw: parsedOutput });
      logger.error(`[monthly] Checkpoint parse failed for ${name}:`, parsed.error);
    }

    const accountYoySection = accountYoyData.length > 0
      ? `\n\n## Account YoY Vergelijking (% verschil t.o.v. dezelfde maand vorig jaar)\n\`\`\`json\n${JSON.stringify(accountYoyData, null, 2)}\n\`\`\``
      : "\n\n## Account YoY Vergelijking\nGeen YoY data beschikbaar (minder dan 12 maanden historie).";
    const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";
    const kpiTargetsRaw = clientCtx.goalsSection ? {
      roasTarget: (await supabase.from("client_settings").select("kpi_targets").eq("client_id", clientId).maybeSingle()).data?.kpi_targets as Record<string, number> | null,
    } : null;
    const roasTarget = (kpiTargetsRaw?.roasTarget as unknown as Record<string, number>)?.roasTarget ?? 0;
    const cpaTarget = (kpiTargetsRaw?.roasTarget as unknown as Record<string, number>)?.cpaTarget ?? 0;
    const { data: clientSectorData } = await supabase
      .from("client_settings")
      .select("sector, aov_segment")
      .eq("client_id", clientId)
      .maybeSingle();
    const sectorKey = clientSectorData?.sector || (accountType.startsWith("ecommerce") ? "ecommerce_mid_ticket" : accountType.startsWith("leadgen") ? "leadgen_generiek" : null);
    let benchmarkRows: Array<{ metric: string; low: number; median: number; high: number; top10: number }> = [];
    if (sectorKey) {
      const { data: bmData } = await supabase.from("benchmark_sectors").select("metric, low, median, high, top10").eq("sector", sectorKey);
      benchmarkRows = (bmData ?? []) as typeof benchmarkRows;
    }
    const comparisonFacts = accountData.length > 0
      ? computeComparisonFacts({
          accountData: accountData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; ctr: number; avg_cpc: number; conversion_rate: number; cost_per_conversion: number; roas?: number }>,
          monthlyTargets: targetResult?.monthlyExpected ?? null,
          kpiTargets: { roasTarget, cpaTarget },
          sectorBenchmarks: benchmarkRows,
          lastCompleteMonth,
        })
      : null;
    const comparisonFactsText = comparisonFacts
      ? formatComparisonFacts(comparisonFacts)
      : "## Deterministische accountfacts\nPrepared monthly context geladen; account- en campagnedelta's komen uit de voorberekende context.";
    const { data: settingsForLag } = await supabase
      .from("client_settings")
      .select("conversion_lag_days")
      .eq("client_id", clientId)
      .maybeSingle();
    const reliability = accountData.length > 0 && campaignData.length > 0
      ? computeDataReliability({
          accountMonthly: accountData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; ctr?: number; avg_cpc?: number; conversion_rate?: number; cost_per_conversion?: number; roas?: number }>,
          campaignMonthly: campaignData as Array<{ campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number }>,
          conversionLagDays: (settingsForLag?.conversion_lag_days as number) ?? 3,
          lastCompleteMonth,
          hasKpiTargets: !!clientCtx.goalsSection,
        })
      : ({ promptContext: "## Data reliability\nPrepared monthly context geladen; account- en campagnebetrouwbaarheid is vooraf berekend." } as DataReliabilityAssessment);
    const reliabilityText = reliability.promptContext;
    const preparedInputs: MonthlyPreparedInputs = {
      analysisYear,
      lastCompleteMonth,
      periodStart,
      periodEnd,
      accountData: accountData as Record<string, unknown>[],
      weeklyData: weeklyData as Record<string, unknown>[],
      campaignData: campaignData as Record<string, unknown>[],
      adgroupData: adgroupData as Record<string, unknown>[],
      isData: isData as Record<string, unknown>[],
      searchData: searchData as Record<string, unknown>[],
      accountYoyData: accountYoyData as Record<string, unknown>[],
      campaignYoyData: campaignYoyData as Record<string, unknown>[],
      campaignMetaData: campaignMetaData as Record<string, unknown>[],
      creativeData: creativeData as Record<string, unknown>[],
      audienceData: audienceData as Record<string, unknown>[],
      deviceData: deviceData as Record<string, unknown>[],
      countryData: countryData as Record<string, unknown>[],
      countryYoyData: countryYoyData as Record<string, unknown>[],
      networkData: networkData as Record<string, unknown>[],
      scheduleData: scheduleData as Record<string, unknown>[],
      productData: productData as Record<string, unknown>[],
      keywordData: keywordData as Record<string, unknown>[],
      enrichedProductData: enrichedProductData as Record<string, unknown>[],
      checkoutData: checkoutData as Record<string, unknown>[],
      goalsSection,
      accountType,
      targetResult,
    };
    if (!preparedContext) {
      const built = await buildPreparedContextRow(supabase, clientId, preparedInputs);
      preparedContext = built.prepared;
      await savePreparedContext(supabase, preparedContext);
    }
    const stepAvailabilityByStep = new Map(
      (preparedContext?.data_availability ?? checkStepDataAvailability({
        audienceData,
        deviceData,
        checkoutData,
        creativeData,
        keywordData,
        productData,
        countryData,
        networkData,
        scheduleData,
      })).map((entry) => [entry.step, entry])
    );

    const monthlyProductContext = buildProductContext({
      productTitles: productData.map((row: Record<string, unknown>) => String(row.product_title || "")).filter(Boolean),
      productTypes: merchantSync.products.flatMap((product) => [
        product.product_type,
        product.product_type_l1,
        product.product_type_l2,
        product.product_type_l3,
        product.product_type_l4,
        product.product_type_l5,
      ].filter(Boolean) as string[]),
      productBrands: merchantSync.products.map((product) => product.brand).filter(Boolean) as string[],
      customLabels: merchantSync.products.flatMap((product) => [
        product.custom_label_0,
        product.custom_label_1,
        product.custom_label_2,
        product.custom_label_3,
        product.custom_label_4,
      ].filter(Boolean) as string[]),
      customAttributes: merchantSync.products.flatMap((product) =>
        Object.values(product.custom_attributes_jsonb ?? {}).filter((value): value is string => typeof value === "string")
      ),
      merchantProducts: merchantSync.products.map((product) => ({
        offerId: product.offer_id,
        title: product.title,
        brand: product.brand,
        productType: product.product_type,
        customLabels: [
          product.custom_label_0,
          product.custom_label_1,
          product.custom_label_2,
          product.custom_label_3,
          product.custom_label_4,
        ].filter(Boolean) as string[],
        customAttributes: Object.values(product.custom_attributes_jsonb ?? {}).filter((value): value is string => typeof value === "string"),
        link: product.link,
      })),
      adCopyPhrases: creativeData.flatMap((row: Record<string, unknown>) => [
        ...((row.headlines as string[] | null) ?? []),
        ...((row.descriptions as string[] | null) ?? []),
        ...((row.final_urls as string[] | null) ?? []),
      ]),
      strategicContextText: `${goalsSection}\n${enrichment.strategicContext}`,
      targetedCountries: Array.from(new Set(countryData.map((row: Record<string, unknown>) => String(row.country_code || "")).filter(Boolean))),
    });

    const searchTermContextSummary = searchData.length > 0
      ? (() => {
          const assessedTerms = searchData.map((term: Record<string, unknown>) => {
            const assessment = assessSearchTermAgainstProductContext({
              searchTerm: String(term.search_term || ""),
              campaignName: String(term.campaign_name || ""),
              adGroupName: String(term.ad_group_name || ""),
              clicks: Number(term.clicks || 0),
              cost: Number(term.cost || 0),
              conversions: Number(term.conversions || 0),
            }, monthlyProductContext);
            const key = searchTermScopeKey(
              String(term.search_term || ""),
              String(term.campaign_name || ""),
              String(term.ad_group_name || ""),
            );
            step5TruthMap.set(key, assessment);
            return {
              term: String(term.search_term || ""),
              campaign: String(term.campaign_name || ""),
              adGroup: String(term.ad_group_name || ""),
              clicks: Number(term.clicks || 0),
              cost: Number(term.cost || 0),
              conversions: Number(term.conversions || 0),
              assessment,
            };
          });
          assessedSearchTerms = assessedTerms;

          const rankedTerms = [...assessedTerms].sort((a, b) => b.cost - a.cost);
          const protectedTerms = rankedTerms.filter(({ assessment }) => assessment.productContextStatus === "protected_relevant");
          const reviewTerms = rankedTerms.filter(({ assessment }) => assessment.productContextStatus === "review_first" || assessment.productContextStatus === "relevant");
          const safeTerms = rankedTerms.filter(({ assessment }) => assessment.exclusionSafety === "safe_to_exclude");

          return [
            summarizeProductContext(monthlyProductContext),
            "",
            "## Merchant snapshot status",
            merchantSync.message,
            "",
            "## Bindende product-truth buckets voor zoektermen",
            ...protectedTerms.slice(0, 10).map(({ term, campaign, adGroup, assessment }) => `- PROTECTED | ${term} | ${campaign} | ${adGroup} | evidence=${assessment.matchedContext.join("; ") || "context"}`),
            ...reviewTerms.slice(0, 10).map(({ term, campaign, adGroup, assessment }) => `- REVIEW_FIRST | ${term} | ${campaign} | ${adGroup} | evidence=${assessment.matchedContext.join("; ") || "context"}`),
            ...safeTerms.slice(0, 10).map(({ term, campaign, adGroup, assessment }) => `- SAFE_TO_EXCLUDE | ${term} | ${campaign} | ${adGroup} | reason=${assessment.reasoningLabel}`),
          ].join("\n");
        })()
      : summarizeProductContext(monthlyProductContext);

    let repairCount = 0;
    const runNarrativeStep = async (stepNumber: number, stepName: string, message: string) => {
      await updateProgressPhase(supabase, {
        jobId,
        phaseKey: `run_step_${stepNumber}`,
        message: `Stap ${stepNumber} uitvoeren: ${stepName}...`,
      });
      let step = await runStep({
        ...shared,
        stepNumber,
        stepName,
        systemPrompt: buildMonthlyStepPrompt(
          goalsSection,
          accountType,
          adapter.stepInstructions[stepNumber],
          `${runningContext}\n\n${conclusions.slice(-2).join("\n\n")}`,
          adapter,
          clientMemorySection,
          signalsSection
        ),
        userMessage: `${message}\n\n## Data beschikbaarheid voor deze stap\n${stepAvailabilityByStep.get(stepNumber)?.promptNote || "Geen extra data-opmerking."}\n\n## Running context uit laatste checkpoint\n${runningContext}`,
      });
      const priorStepConclusion = conclusions.at(-1);
      let { parsed, validation } = parseStructuredStepOutput(step, priorStepConclusion, stepAvailabilityByStep.get(stepNumber), canonicalMetricMap, liveTermSet, { purityRules: adapter.purityRules, logFormatSkeletons: adapter.logFormatSkeletons });
      const step12Repair = shouldRepairStep12Runtime(step, validation);
      const genericRepair = shouldRepairStep(validation, repairCount > 5);
      if (step12Repair || genericRepair) {
        logger.warn(`[monthly] Step ${stepNumber} repair triggered`, {
          errors: validation.errors,
          heavyWarnings: countHeavyWarnings(validation),
        });
        repairCount++;
        const repairMessage = step12Repair
          ? buildStep12RepairUserMessage(message, runningContext, stepAvailabilityByStep.get(stepNumber)?.promptNote)
          : buildStepRepairUserMessage(message, validation, runningContext, stepAvailabilityByStep.get(stepNumber)?.promptNote);
        const repairedStep = await runStep({
          ...shared,
          stepNumber,
          stepName,
          jsonMode: true,
          systemPrompt: buildMonthlyStepPrompt(
            goalsSection,
            accountType,
            adapter.stepInstructions[stepNumber],
            `${runningContext}\n\n${conclusions.slice(-2).join("\n\n")}`,
            adapter,
            clientMemorySection,
            signalsSection
          ),
          userMessage: repairMessage,
        });
        const repairedParse = parseStructuredStepOutput(repairedStep, priorStepConclusion, stepAvailabilityByStep.get(stepNumber), canonicalMetricMap, liveTermSet, { purityRules: adapter.purityRules, logFormatSkeletons: adapter.logFormatSkeletons });
        const best = pickBetterStepAttempt(
          { step, parsed, validation },
          { step: repairedStep, parsed: repairedParse.parsed, validation: repairedParse.validation }
        );
        step = best.step;
        parsed = best.parsed;
        validation = best.validation;
        step.retries = (step.retries ?? 0) + 1;
      }
      steps.push(step);
      if (stepNumber === 7 && step5TruthMap.size > 0) {
        parsed.findings = applyStep5FindingTruth(parsed.findings, step5TruthMap);
      }
      parsedSteps.push(parsed);
      stepValidations.push(validation);
      if (!validation.valid || validation.warnings.length > 0) {
        logger.warn(`[monthly] Step ${stepNumber} validation`, validation);
      }
      conclusions.push(parsed.step_conclusion);

      // W1.3 (pump, extractie stap 1): persisteer ELKE reguliere stap direct, de basis
      // van hervatbaarheid. De stappen 6, 7 en 9 hebben verderop hun eigen expliciete
      // sectie-save en worden hier overgeslagen. Upsert op de bestaande conflict-sleutel,
      // dus een herdraai op dezelfde dag overschrijft zijn eigen sectie.
      // LIVE-ONGETEST tot de eerste onderbroken run.
      if (![6, 7, 9].includes(stepNumber)) {
        const { error: stepSaveError } = await saveAnalysisOutputSection({
          supabase,
          row: {
            client_id: clientId,
            sop_type: "monthly",
            analysis_date: new Date().toISOString().split("T")[0],
            period_start: periodStart,
            period_end: periodEnd,
            section: stepName,
            output: step.output,
            model_used: step.model,
            tokens_used: step.tokensUsed,
            step_number: stepNumber,
            step_name: stepName,
          },
        });
        if (stepSaveError) {
          logger.error(`[monthly] Stap-sectie opslaan faalde voor stap ${stepNumber}:`, stepSaveError);
        }
      }
      return step;
    };

    const runSplitSearchTermStep = async (baseInstruction: string) => {
      await updateProgressPhase(supabase, {
        jobId,
        phaseKey: "run_step_7a",
        message: "Stap 7A uitvoeren: Search Term Classification...",
      });

      const uniqueTermRows = (rows: AssessedSearchTermRow[]): AssessedSearchTermRow[] => {
        const seen = new Set<string>();
        const picked: AssessedSearchTermRow[] = [];
        for (const row of rows) {
          const key = searchTermScopeKey(row.term, row.campaign, row.adGroup);
          if (seen.has(key)) continue;
          seen.add(key);
          picked.push(row);
        }
        return picked;
      };
      const serializeTermRows = (rows: AssessedSearchTermRow[]) => rows.map((row) => ({
        search_term: row.term,
        campaign_name: row.campaign,
        ad_group_name: row.adGroup,
        clicks: row.clicks,
        cost: row.cost,
        conversions: row.conversions,
        product_context_status: row.assessment.productContextStatus,
        exclusion_safety: row.assessment.exclusionSafety,
        match_confidence: row.assessment.matchConfidence,
        reasoning_label: row.assessment.reasoningLabel,
        matched_context: row.assessment.matchedContext,
      }));

      const protectedRows = uniqueTermRows(
        assessedSearchTerms
          .filter((row) => row.assessment.productContextStatus === "protected_relevant")
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 5)
      );
      const reviewRows = uniqueTermRows(
        assessedSearchTerms
          .filter((row) => row.assessment.productContextStatus === "review_first" || row.assessment.productContextStatus === "relevant")
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 5)
      );
      const safeRows = uniqueTermRows(
        assessedSearchTerms
          .filter((row) => row.assessment.exclusionSafety === "safe_to_exclude" || row.assessment.exclusionSafety === "safe_to_exclude_modifier_only")
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 5)
      );

      const classificationRows = uniqueTermRows([...protectedRows, ...reviewRows, ...safeRows]).slice(0, 15);
      const actionRows = uniqueTermRows(
        assessedSearchTerms
          .filter((row) =>
            row.cost > 0 &&
            (
              row.assessment.exclusionSafety === "safe_to_exclude" ||
              row.assessment.exclusionSafety === "safe_to_exclude_modifier_only" ||
              row.assessment.productContextStatus === "review_first" ||
              row.assessment.productContextStatus === "protected_relevant"
            )
          )
          .sort((a, b) => b.cost - a.cost)
      ).slice(0, 12);

      const classificationTermsJson = `\`\`\`json\n${JSON.stringify(serializeTermRows(classificationRows), null, 2)}\n\`\`\``;
      const actionTermsJson = `\`\`\`json\n${JSON.stringify(serializeTermRows(actionRows), null, 2)}\n\`\`\``;
      const classificationSummary = [
        "## Deel A dataset-samenvatting",
        `- Protected relevant: ${protectedRows.length}`,
        `- Review first/relevant: ${reviewRows.length}`,
        `- Safe to exclude: ${safeRows.length}`,
        `- Totaal meegenomen in classificatie: ${classificationRows.length}`,
      ].join("\n");
      const actionSummary = [
        "## Deel B dataset-samenvatting",
        `- Actiegerichte termen geselecteerd: ${actionRows.length}`,
        `- Hoogste cost in set: €${actionRows[0]?.cost?.toFixed(2) ?? "0.00"}`,
        `- Focus: uitsluitingen, modifier-acties, routing en LP/feed checks`,
      ].join("\n");
      const priorStepConclusion = conclusions.at(-1);

      const step7a = await runStep({
        ...shared,
        stepNumber: 71,
        stepName: "Search Term Performance A",
        systemPrompt: buildMonthlyStepPrompt(
          goalsSection,
          accountType,
          `${adapter.stepInstructions[7]}\n\n${MONTHLY_STEP7_CLASSIFICATION_INSTRUCTION}`,
          `${runningContext}\n\n${conclusions.slice(-2).join("\n\n")}`,
          adapter,
          clientMemorySection,
          signalsSection
        ),
        userMessage: `${baseInstruction}

${classificationSummary}

## Deel A focus
Classificeer alleen de belangrijkste zoektermen en hun bewijsniveau. Houd het compact en zoekterm-specifiek.

## Search Term classificatie-set
${classificationTermsJson}

## Data beschikbaarheid voor deze stap
${stepAvailabilityByStep.get(7)?.promptNote || "Geen extra data-opmerking."}

## Running context uit laatste checkpoint
${runningContext}`,
      });
      machineSteps.push(step7a);
      const parsed7aResult = parseStructuredStepOutput(step7a, priorStepConclusion, stepAvailabilityByStep.get(7), canonicalMetricMap, liveTermSet);
      const parsed7a = parsed7aResult.parsed;
      if (step5TruthMap.size > 0) {
        parsed7a.findings = applyStep5FindingTruth(parsed7a.findings, step5TruthMap);
      }

      await updateProgressPhase(supabase, {
        jobId,
        phaseKey: "run_step_7b",
        message: "Stap 7B uitvoeren: Search Term Actions & Savings...",
      });

      const step7b = await runStep({
        ...shared,
        stepNumber: 72,
        stepName: "Search Term Performance B",
        systemPrompt: buildMonthlyStepPrompt(
          goalsSection,
          accountType,
          `${adapter.stepInstructions[7]}\n\n${MONTHLY_STEP7_ACTIONS_INSTRUCTION}`,
          `${runningContext}\n\n${conclusions.slice(-2).join("\n\n")}\n\n## Uitkomst deel A\n${parsed7a.step_conclusion}`,
          adapter,
          clientMemorySection,
          signalsSection
        ),
        userMessage: `${baseInstruction}

${actionSummary}

## Deel B focus
Gebruik de classificatie uit deel A als uitgangspunt en vertaal dit naar maximaal 2 concrete acties en de definitieve stapconclusie.

## Geclassificeerde signalen uit deel A
\`\`\`json
${JSON.stringify({
  narrative: parsed7a.narrative,
  findings: parsed7a.findings,
  actions: parsed7a.actions,
  step_conclusion: parsed7a.step_conclusion,
}, null, 2)}
\`\`\`

## Search Term actie-set
${actionTermsJson}

## Data beschikbaarheid voor deze stap
${stepAvailabilityByStep.get(7)?.promptNote || "Geen extra data-opmerking."}

## Running context uit laatste checkpoint
${runningContext}`,
      });
      machineSteps.push(step7b);
      const parsed7bResult = parseStructuredStepOutput(step7b, parsed7a.step_conclusion, stepAvailabilityByStep.get(7), canonicalMetricMap, liveTermSet);
      const parsed7b = parsed7bResult.parsed;
      if (step5TruthMap.size > 0) {
        parsed7b.findings = applyStep5FindingTruth(parsed7b.findings, step5TruthMap);
      }

      const mergedParsed = mergeParsedStepOutputs([parsed7a, parsed7b], 7, "Search Term Performance");
      const mergedValidation = validateStepOutput(7, {
        narrative: mergedParsed.narrative,
        log_entries: mergedParsed.log_entries,
        top_3_findings: mergedParsed.findings,
        status: mergedParsed.status,
        actions: mergedParsed.actions,
        step_conclusion: mergedParsed.step_conclusion,
      }, priorStepConclusion, { availability: stepAvailabilityByStep.get(7) });

      const mergedStepOutput = JSON.stringify({
        narrative: mergedParsed.narrative,
        log_entries: mergedParsed.log_entries,
        top_3_findings: mergedParsed.findings,
        status: mergedParsed.status,
        actions: mergedParsed.actions,
        step_conclusion: mergedParsed.step_conclusion,
      }, null, 2);

      const saveResult = await saveAnalysisOutputSection({
        supabase,
        row: {
          client_id: clientId,
          sop_type: adapter.sopTypeKey,
          analysis_date: new Date().toISOString().split("T")[0],
          period_start: periodStart,
          period_end: periodEnd,
          section: "Search Term Performance",
          output: mergedStepOutput,
          model_used: step7b.model,
          tokens_used: step7a.tokensUsed + step7b.tokensUsed,
          step_number: 7,
          step_name: "Search Term Performance",
        },
      });

      const mergedStep: StepResult = {
        stepNumber: 7,
        stepName: "Search Term Performance",
        output: mergedStepOutput,
        model: step7b.model,
        tokensUsed: step7a.tokensUsed + step7b.tokensUsed,
        saved: !saveResult.error,
        latencyMs: step7a.latencyMs + step7b.latencyMs,
        retries: step7a.retries + step7b.retries,
      };

      steps.push(mergedStep);
      parsedSteps.push(mergedParsed);
      stepValidations.push(parsed7aResult.validation, parsed7bResult.validation, mergedValidation);
      if (!mergedValidation.valid || mergedValidation.warnings.length > 0) {
        logger.warn("[monthly] Step 7 validation", mergedValidation);
      }
      conclusions.push(mergedParsed.step_conclusion);
      return mergedStep;
    };

    const campaignYoySection = campaignYoyData.length > 0
      ? `\n\n## Campaign YoY Vergelijking (% verschil t.o.v. dezelfde maand vorig jaar, per campagne)\n\`\`\`json\n${JSON.stringify(campaignYoyData, null, 2)}\n\`\`\``
      : "";
    const campaignMomText = computeCampaignMomFacts(
      campaignData as Array<{ campaign_name: string; month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }>,
      lastCompleteMonth,
      analysisYear
    );

    await runNarrativeStep(1, "Account Performance", `Analyseer de account performance voor client "${clientId}".
De analyse draait op de laatste volledige maand (${["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"][lastCompleteMonth - 1]} ${analysisYear}).${enrichment.strategicContext}${targetText}${dimAvailText}

${reliabilityText}

${comparisonFactsText}

${preparedContext?.binding_facts_text || ""}

${preparedContext?.kpi_chain_text || ""}

Gebruik de voorberekende keten en bindende actierichtingen als basis. Reken de account-keten niet opnieuw uit.${accountYoySection}${enrichment.sectorBenchmarks}${enrichment.leadingIndicators}${enrichment.changeHistory}${enrichment.geoContext}`);

    const allCampaignNames = campaignData.length > 0
      ? [...new Set(campaignData.map((c: Record<string, unknown>) => c.campaign_name as string))]
      : [
          ...new Set([
            ...campaignMetaData.map((c: Record<string, unknown>) => String(c.campaign_name || "")).filter(Boolean),
            ...(preparedContext?.comparison_facts_campaigns ?? []).map((item) => item.campaignName),
          ]),
        ];
    await runNarrativeStep(2, "Campaign Performance", `Analyseer de campagne performance voor client "${clientId}".${enrichment.strategicContext}

${preparedContext?.binding_facts_text || ""}

${preparedContext?.campaign_table_text || campaignMomText}

Gebruik de voorberekende campagne-vergelijkingen als bindende feiten. Herbereken MoM-verschillen niet.${campaignMetaText}${campaignYoySection}${enrichment.portfolioAnalysis}${enrichment.pmaxContext}${enrichment.sectorBenchmarks}${enrichment.changeHistory}`);

    const mentionedCampaigns = allCampaignNames.filter((name) => steps[1]?.output.includes(name));
    const adgroupAggregation = aggregateAdGroups(adgroupData as never[], mentionedCampaigns);
    const adgroupMomText = computeAdGroupMomFacts(
      adgroupData as Array<{ ad_group_name: string; campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number; clicks: number; impressions: number }>,
      lastCompleteMonth,
      analysisYear
    );
    await runNarrativeStep(3, "Ad Group Performance", adgroupAggregation.ad_group_details.length > 0
      ? `Analyseer de ad group performance voor client "${clientId}".
Data is pre-geaggregeerd: ${adgroupAggregation.ad_group_details.length} ad groups over ${mentionedCampaigns.length} campagnes.

${preparedContext?.campaign_table_text || ""}

${adgroupMomText}

## Campaign Overzicht
\`\`\`json
${JSON.stringify(adgroupAggregation.campaign_summaries, null, 2)}
\`\`\`

## Ad Group Details (pre-geaggregeerd)
\`\`\`json
${JSON.stringify(adgroupAggregation.ad_group_details, null, 2)}
\`\`\`${enrichment.changeHistory}`
      : `Er is geen ad group data beschikbaar voor client "${clientId}". Benoem expliciet dat deze stap data-arm is en welke verklaring hierdoor open blijft.`);
    await runCheckpoint("Checkpoint A", [1, 2, 3]);

    await runNarrativeStep(4, "Competitor & Auction Insights", isData.length > 0
      ? `Analyseer de impression share data voor client "${clientId}".

${preparedContext?.binding_facts_text || ""}

${preparedContext?.campaign_table_text || ""}

## Campaign Impression Share (laatste 6 maanden)
\`\`\`json
${JSON.stringify(isData, null, 2)}
\`\`\`${enrichment.changeHistory}`
      : `Er is geen impression share data beschikbaar voor client "${clientId}". Noteer welke hypothese hierdoor onbewezen blijft.`);

    await runNarrativeStep(5, "Keyword Performance", keywordData.length > 0
      ? `Analyseer de keyword performance voor client "${clientId}".

## Keyword Performance (laatste 3 maanden)
\`\`\`json
${JSON.stringify(keywordData, null, 2)}
\`\`\`${enrichment.changeHistory}`
      : `Er is geen keyword performance data beschikbaar voor client "${clientId}". Benoem expliciet dat werkwijze A/B/C hierdoor beperkt is.`);

    const hasProductDataForStep6 = (stepAvailabilityByStep.get(6)?.dimensions ?? []).some((dimension) => dimension.available);
    if (!hasProductDataForStep6) {
      const productFallback = buildStep6NoDataFallback();
      const productFallbackOutput = JSON.stringify({
        narrative: productFallback.narrative,
        log_entries: productFallback.log_entries,
        top_3_findings: productFallback.findings,
        status: productFallback.status,
        actions: productFallback.actions,
        step_conclusion: productFallback.step_conclusion,
      }, null, 2);
      await saveAnalysisOutputSection({
        supabase,
        row: {
          client_id: clientId,
          sop_type: adapter.sopTypeKey,
          analysis_date: new Date().toISOString().split("T")[0],
          period_start: periodStart,
          period_end: periodEnd,
          section: "Product Performance",
          output: productFallbackOutput,
          model_used: "runtime-fallback",
          tokens_used: 0,
          step_number: 6,
          step_name: "Product Performance",
        },
      });
      steps.push({
        stepNumber: 6,
        stepName: "Product Performance",
        output: productFallbackOutput,
        model: "runtime-fallback",
        tokensUsed: 0,
        saved: true,
        latencyMs: 0,
        retries: 0,
      });
      parsedSteps.push(productFallback);
      conclusions.push(productFallback.step_conclusion);
    } else {
      await runNarrativeStep(6, "Product Performance", enrichedProductData.length > 0
        ? `Analyseer de product performance voor client "${clientId}" met Merchant Center verrijking.

## Merchant snapshot status
${merchantSync.message}

## Product Performance (verrijkt, laatste 3 maanden)
\`\`\`json
${JSON.stringify(enrichedProductData, null, 2)}
\`\`\``
        : `Analyseer de product performance voor client "${clientId}" op basis van ruwe productdata. Merchant Center verrijking ontbreekt, dus benoem EXPLICIET dat Werkwijze A (Custom Labels/Categories) data niet beschikbaar is door ontbrekende Merchant Center koppeling, maar voer Werkwijze B (SKU-niveau) wel uit op de beschikbare productdata.

## Merchant snapshot status
${merchantSync.message}

## Product Performance (ruw, laatste 3 maanden)
\`\`\`json
${JSON.stringify(productData, null, 2)}
\`\`\``);
    }

    if (searchData.length > 0) {
      await runSplitSearchTermStep(`Analyseer de wasteful search terms voor client "${clientId}".

## Wasteful Search Terms (top 30 op cost, 0 conversies)
\`\`\`json
${JSON.stringify(searchData, null, 2)}
\`\`\`${enrichment.changeHistory}`);
    } else {
      await runNarrativeStep(7, "Search Term Performance", `Er zijn geen wasteful search terms gevonden voor client "${clientId}". Noteer dit als potentieel positief signaal, maar benoem ook dat de afwezigheid van wasteful termen geen bewijs is dat routing goed staat.`);
    }
    await runCheckpoint("Checkpoint B", [4, 5, 6, 7]);

    await runNarrativeStep(8, "Creative Performance", creativeData.length > 0
      ? `Analyseer de creative performance voor client "${clientId}".

## Creative Performance (laatste 3 maanden)
\`\`\`json
${JSON.stringify(creativeData, null, 2)}
\`\`\``
      : `Er is geen creative performance data beschikbaar voor client "${clientId}". Benoem dat creative-signalen niet gevalideerd kunnen worden.`);

    if (audienceData.length === 0) {
      const audienceFallback: ParsedStepOutput = {
        stepNumber: 9,
        stepName: "Audience Performance",
        narrative: "Audience data niet beschikbaar. Aanbeveling: activeer observatie-modus voor In-market en Affinity segmenten in alle Search-campagnes.",
        log_entries: ["Audience dimensies niet beschikbaar in de dataset."],
        findings: [{
          step: 9,
          issue_cluster: "uncategorized",
          entity_type: "account",
          entity_name: "Account",
          metric: "Data Availability",
          current_value: null,
          previous_value: null,
          change_pct: null,
          severity: "low",
          insight_type: "risk",
          is_seasonal: false,
          is_structural: true,
          cause: "Audience-segmenten niet geconfigureerd of niet beschikbaar.",
          action_required: true,
          evidence_level: "deterministic",
          confidence: "high",
          benchmark_type: undefined,
        }],
        status: "NIET OP SCHEMA",
        actions: [{
          actie: "Activeer observatie-modus voor In-market en Affinity doelgroepen in alle Search-campagnes",
          campagne: "Alle Search campagnes",
          deadline: "deze_week",
          verwachte_impact: "Data-beschikbaarheid voor audience-analyse in de volgende cyclus",
        }],
        step_conclusion: "Audience analyse niet uitvoerbaar door ontbrekende data.",
      };
      const audienceFallbackOutput = JSON.stringify({
        narrative: audienceFallback.narrative,
        log_entries: audienceFallback.log_entries,
        top_3_findings: audienceFallback.findings,
        status: audienceFallback.status,
        actions: audienceFallback.actions,
        step_conclusion: audienceFallback.step_conclusion,
      }, null, 2);
      await saveAnalysisOutputSection({
        supabase,
        row: {
          client_id: clientId,
          sop_type: adapter.sopTypeKey,
          analysis_date: new Date().toISOString().split("T")[0],
          period_start: periodStart,
          period_end: periodEnd,
          section: "Audience Performance",
          output: audienceFallbackOutput,
          model_used: "runtime-fallback",
          tokens_used: 0,
          step_number: 9,
          step_name: "Audience Performance",
        },
      });
      steps.push({
        stepNumber: 9,
        stepName: "Audience Performance",
        output: audienceFallbackOutput,
        model: "runtime-fallback",
        tokensUsed: 0,
        saved: true,
        latencyMs: 0,
        retries: 0,
      });
      parsedSteps.push(audienceFallback);
      conclusions.push(audienceFallback.step_conclusion);
    } else {
      await runNarrativeStep(9, "Audience Performance", `Analyseer de audience performance voor client "${clientId}".

## Audience Performance (laatste 3 maanden)
\`\`\`json
${JSON.stringify(audienceData, null, 2)}
\`\`\``);
    }

    await runNarrativeStep(10, "Device & Engagement Performance", deviceData.length > 0
      ? `Analyseer de device performance voor client "${clientId}".

## Device Performance (laatste 3 maanden)
\`\`\`json
${JSON.stringify(deviceData, null, 2)}
\`\`\``
      : `Er is geen device performance data beschikbaar voor client "${clientId}". Benoem dat device-hypothesen hierdoor onbewezen blijven.`);

    const countryYoySection = countryYoyData.length > 0
      ? `\n\n## Land YoY Vergelijking\n\`\`\`json\n${JSON.stringify(countryYoyData, null, 2)}\n\`\`\``
      : "";
    await runNarrativeStep(11, "Geografische Performance", countryData.length > 0
      ? `Analyseer de geografische performance voor client "${clientId}".

## Land Performance (maandelijks, tot 6 maanden)
\`\`\`json
${JSON.stringify(countryData, null, 2)}
\`\`\`${countryYoySection}`
      : `Er is geen geografische performance data beschikbaar voor client "${clientId}". Benoem dat geo-allocatie hierdoor niet hard kan worden getoetst.`);

    const networkSection = networkData.length > 0
      ? `\n\n## Network Performance (laatste 3 maanden)\n\`\`\`json\n${JSON.stringify(networkData, null, 2)}\n\`\`\``
      : "\n\nGeen network data beschikbaar.";
    const scheduleSection = scheduleData.length > 0
      ? `\n\n## Ad Schedule Performance (dag/uur verdeling)\n\`\`\`json\n${JSON.stringify(scheduleData, null, 2)}\n\`\`\``
      : "\n\nGeen schedule data beschikbaar.";
    const checkoutSection = checkoutData.length > 0
      ? `\n\n## Checkout Funnel (laatste 3 maanden)\n\`\`\`json\n${JSON.stringify(checkoutData, null, 2)}\n\`\`\``
      : "\n\nGeen checkout funnel data beschikbaar.";
    await runNarrativeStep(12, "Checkout, Schedule & Network Performance", `Analyseer checkout funnel, schedule en network performance voor client "${clientId}".${checkoutSection}${scheduleSection}${networkSection}

${buildStep12AvailabilityInstruction(stepAvailabilityByStep.get(12))}`);
    await runCheckpoint("Checkpoint C", [8, 9, 10, 11, 12]);

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "finalize_conclusion",
      message: "Synthese en sprintplanning bouwen...",
    });
    const conclusion = await runStep({
      ...shared,
      stepNumber: 13,
      stepName: "Hypotheses & Sprintplanning",
      systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, adapter.stepInstructions[13], runningContext, adapter, clientMemorySection, signalsSection),
      userMessage: `Bouw de synthese voor client "${clientId}" op basis van checkpoint C en alle voorgaande analyse-stappen.

## Checkpoints
\`\`\`json
${JSON.stringify(checkpointOutputs, null, 2)}
\`\`\`

## Stapconclusies
${conclusions.join("\n\n---\n\n")}`,
    });
    steps.push(conclusion);
    const conclusionPrior = conclusions.at(-1);
    const { parsed: parsedConclusion, validation: conclusionValidation } = parseStructuredStepOutput(conclusion, conclusionPrior, stepAvailabilityByStep.get(13), canonicalMetricMap, liveTermSet);
    parsedSteps.push(parsedConclusion);
    stepValidations.push(conclusionValidation);
    if (!conclusionValidation.valid || conclusionValidation.warnings.length > 0) {
      logger.warn("[monthly] Step 13 validation", conclusionValidation);
    }

    const analysisDate = new Date().toISOString().split("T")[0];
    const dimensionAvailability = buildCoverageDimensionAvailability({
      campaignData: campaignData as Record<string, unknown>[],
      campaignMetaData: campaignMetaData as Record<string, unknown>[],
      adgroupData: adgroupData as Record<string, unknown>[],
      isData: isData as Record<string, unknown>[],
      searchData: searchData as Record<string, unknown>[],
      creativeData: creativeData as Record<string, unknown>[],
      audienceData: audienceData as Record<string, unknown>[],
      deviceData: deviceData as Record<string, unknown>[],
      countryData: countryData as Record<string, unknown>[],
      networkData: networkData as Record<string, unknown>[],
      scheduleData: scheduleData as Record<string, unknown>[],
      enrichment,
      preparedContext,
    });

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "structure_findings",
      message: "Step findings clusteren en SOP-coverage borgen...",
    });
    const rawStepFindings = parsedSteps.flatMap((step) => step.findings);
    const canonical = canonicalizeFindings(rawStepFindings, dimensionAvailability, { entityAliases: adapter.entityAliases, metricAliases: adapter.metricAliases, validClusters: adapter.channel === "google_ads" ? undefined : adapter.issueClusters });
    const curatedFindings = curateMonthlyStructuredFindings(canonical.findings);
    const curatedClusters = clusterFindings(curatedFindings);
    const enforcedCoverage = enforceSopCoverage(curatedClusters, dimensionAvailability);
    const findingIndexById = new Map(curatedFindings.map((finding, index) => [finding.finding_id, index]));
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "build_recommendations",
      message: "Threads, aanbevelingen en taakladder opbouwen...",
    });
    const structured = buildStructuredMonthlyOutput({
      parsedSteps,
      extraQaRedFlags: goalsTargetsImplausible
        ? ["Ingestelde of goals-targets lijken niet realistisch geconfigureerd (zie stap 1); target-gap en toon zijn pas te vertrouwen na herijking."]
        : undefined,
      findings: curatedFindings,
      clusters: curatedClusters,
      coverage: enforcedCoverage.coverage,
      conclusionText: parsedConclusion.narrative,
    });
    const officialStepValidations = stepValidations.filter((validation) => validation.stepNumber >= 1 && validation.stepNumber <= 13);
    const acceptanceReport = validateMonthlyAcceptance({
      stepCount: adapter.stepCount,
      narrativeSteps: parsedSteps.map((step) => ({
        stepNumber: step.stepNumber,
        stepName: step.stepName,
        output: step.narrative,
        model: steps.find((candidate) => candidate.stepNumber === step.stepNumber)?.model ?? steps[0]?.model ?? "unknown",
        tokensUsed: steps.find((candidate) => candidate.stepNumber === step.stepNumber)?.tokensUsed ?? 0,
        saved: false,
        latencyMs: steps.find((candidate) => candidate.stepNumber === step.stepNumber)?.latencyMs ?? 0,
        retries: steps.find((candidate) => candidate.stepNumber === step.stepNumber)?.retries ?? 0,
      })),
      recommendations: structured.recommendations,
      tasks: structured.tasks,
      finalSop: { recommendations: structured.final_sop.recommendations, tasks: structured.final_sop.tasks },
      coverage: structured.coverage,
      findings: curatedFindings,
      checkpointsRun: checkpointSteps.length,
      stepValidations: officialStepValidations,
    });
    const qualityGate = buildMonthlyQualityGate({
      stepValidations: officialStepValidations,
      acceptance: acceptanceReport,
    });

    const fullOutput = sanitizeOutput(structured.deliverable_markdown);

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "save_outputs",
      message: "Analyse, findings en taken opslaan...",
    });
    const qualityGatePayload = {
      analysis_date: analysisDate,
      passed: qualityGate.passed,
      state: qualityGate.state,
      invalid_steps: qualityGate.invalid_steps,
      blocking_reasons: qualityGate.blocking_reasons,
      acceptance: acceptanceReport,
      step_validations: officialStepValidations,
      candidate_counts: {
        findings: canonical.findings.length,
        curated_findings: curatedFindings.length,
        recommendations: structured.recommendations.length,
        tasks: structured.tasks.length,
        threads: structured.threads.length,
      },
    };
    const { data: qualityGateRow, error: qualityGateErr } = await saveAnalysisOutputSection({
      supabase,
      row: {
        client_id: clientId,
        sop_type: adapter.sopTypeKey,
        analysis_date: analysisDate,
        period_start: periodStart,
        period_end: periodEnd,
        section: "quality_gate_monthly_v2",
        output: JSON.stringify(qualityGatePayload),
        model_used: steps[0].model,
        tokens_used: 0,
        step_number: 0,
        step_name: "quality_gate_monthly_v2",
      },
      select: "id, created_at",
      refreshCreatedAt: true,
    });
    if (qualityGateErr) {
      throw new Error(`Opslaan quality_gate_monthly_v2 mislukt: ${qualityGateErr.message}`);
    }
    const qualityGateReceipt = qualityGateRow && typeof qualityGateRow === "object" && "id" in qualityGateRow
      ? {
          id: String((qualityGateRow as { id: string }).id),
          created_at: String((qualityGateRow as { created_at?: string | null }).created_at ?? ""),
          section: "quality_gate_monthly_v2" as const,
        }
      : null;

    if (!qualityGate.passed) {
      partialOutputExists = true;
      await markProgressFailed(supabase, {
        jobId,
        errorMessage: qualityGate.blocking_reasons.join(" | "),
        metadata: {
          analysis_date: analysisDate,
          sop_type: adapter.sopTypeKey,
          quality_gate: qualityGate,
          structured_saved: false,
        },
        partialOutputExists: true,
      });

      return Response.json({
        jobId,
        clientId,
        sopType: "monthly",
        analysisDate,
        period: { start: periodStart, end: periodEnd },
        model: steps[0].model,
        totalTokens: [...steps, ...machineSteps].reduce((sum, step) => sum + step.tokensUsed, 0),
        totalLatencyMs: [...steps, ...machineSteps].reduce((sum, step) => sum + step.latencyMs, 0),
        qualityGate,
        steps: steps.map((step) => ({
          step: step.stepNumber,
          name: step.stepName,
          tokens: step.tokensUsed,
          latencyMs: step.latencyMs,
          retries: step.retries,
          saved: step.saved,
          output: step.output,
        })),
        internalPipeline: {
          structuredSteps: parsedSteps.length,
          checkpoints: checkpointSteps.length,
        },
        structured: {
          findings: curatedFindings.length,
          recommendations: structured.recommendations.length,
          tasks: structured.tasks.length,
          saved: false,
          findingsParseOk: parsedSteps.every((step) => Array.isArray(step.findings)),
          recsParseOk: true,
          clusters: structured.clusters.length,
          displayFindings: structured.display_findings.length,
          threads: structured.threads.length,
          coverage: structured.coverage,
          stepValidations,
          acceptance: acceptanceReport,
        },
        fullOutput: null,
      }, { status: 422 });
    }

    const { data: fullRow, error: fullErr } = await saveAnalysisOutputSection({
      supabase,
      row: {
        client_id: clientId,
        sop_type: adapter.sopTypeKey,
        analysis_date: analysisDate,
        period_start: periodStart,
        period_end: periodEnd,
        section: "full",
        output: fullOutput,
        model_used: steps[0].model,
        tokens_used: [...steps, ...machineSteps].reduce((sum, step) => sum + step.tokensUsed, 0),
        step_number: 0,
        step_name: "full",
      },
      select: "id, created_at",
      refreshCreatedAt: true,
    });

    if (fullErr) {
      throw new Error(`Opslaan full output mislukt: ${fullErr.message}`);
    }
    const analysisId = fullRow && typeof fullRow === "object" && "id" in fullRow
      ? String((fullRow as { id: string }).id)
      : null;
    const fullReceipt = fullRow && typeof fullRow === "object" && "id" in fullRow
      ? {
          id: String((fullRow as { id: string }).id),
          created_at: String((fullRow as { created_at?: string | null }).created_at ?? ""),
          section: "full" as const,
        }
      : null;
    if (!analysisId || !fullReceipt) {
      throw new Error("Opslaan full output leverde geen save receipt op.");
    }
    partialOutputExists = Boolean(analysisId);

    const { data: structuredRow, error: structuredErr } = await saveAnalysisOutputSection({
      supabase,
      row: {
        client_id: clientId,
        sop_type: adapter.sopTypeKey,
        analysis_date: analysisDate,
        period_start: periodStart,
        period_end: periodEnd,
        section: "structured_monthly_v2",
        output: JSON.stringify({
          stats: {
            ...canonical.stats,
            curated_count: curatedFindings.length,
          },
          findings: structured.findings,
          final_sop: structured.final_sop,
          operating_detail: structured.operating_detail,
          display_findings: structured.display_findings,
          canonical_metric_snapshot: structured.canonical_metric_snapshot,
          threads: structured.threads,
          clusters: structured.clusters.map((cluster) => ({
            cluster_id: cluster.cluster_id,
            issue_cluster: cluster.issue_cluster,
            canonical_entity_name: cluster.canonical_entity_name,
            display_label: cluster.display_label,
            canonical_metric: cluster.canonical_metric,
            related_finding_ids: cluster.related_finding_ids,
            dominant_severity: cluster.dominant_severity,
            dominant_confidence: cluster.dominant_confidence,
            root_cause_summary: cluster.root_cause_summary,
            evidence_summary: cluster.evidence_summary,
            actionability: cluster.actionability,
          coverage_dimensions: cluster.coverage_dimensions,
          })),
          coverage: enforcedCoverage.coverage,
          recommendations: structured.recommendations,
          tasks: structured.tasks,
          executive_markdown: structured.executive_markdown,
          deliverable_markdown: structured.deliverable_markdown,
          coverage_markdown: structured.coverage_markdown,
          appendix_markdown: structured.appendix_markdown,
          checkpoints: checkpointOutputs,
          parsed_steps: parsedSteps.map((step) => ({
            stepNumber: step.stepNumber,
            stepName: step.stepName,
            narrative: step.narrative,
            log_entries: step.log_entries,
            findings: step.findings,
            status: step.status,
            actions: step.actions,
            step_conclusion: step.step_conclusion,
          })),
          step_validations: stepValidations,
          acceptance: acceptanceReport,
          quality_gate: qualityGate,
          success_next_month: structured.success_next_month,
          what_is_not_the_problem: structured.what_is_not_the_problem,
        }),
        model_used: steps[0].model,
        tokens_used: 0,
        step_number: 0,
        step_name: "structured_monthly_v2",
      },
      select: "id, created_at",
      refreshCreatedAt: true,
    });
    if (structuredErr) {
      throw new Error(`Opslaan structured_monthly_v2 mislukt: ${structuredErr.message}`);
    }
    const structuredReceipt = structuredRow && typeof structuredRow === "object" && "id" in structuredRow
      ? {
          id: String((structuredRow as { id: string }).id),
          created_at: String((structuredRow as { created_at?: string | null }).created_at ?? ""),
          section: "structured_monthly_v2" as const,
        }
      : null;
    if (!structuredReceipt) {
      throw new Error("Opslaan structured_monthly_v2 leverde geen save receipt op.");
    }

    let structuredSaved = Boolean(qualityGateReceipt && fullReceipt && structuredReceipt);
    const recs = structured.recommendations.map((recommendation) => ({
      ...recommendation,
      finding_index: findingIndexById.get(structured.clusters.find((cluster) => cluster.cluster_id === recommendation.cluster_id)?.related_finding_ids[0] || "") ?? null,
    }));
    const tasks = structured.tasks;
    const findings = curatedFindings;

    if (findings.length > 0) {
      try {
        const insightRows = findings.map((finding) => ({
          client_id: clientId,
          analysis_id: analysisId,
          sop_type: adapter.sopTypeKey,
          analysis_date: analysisDate,
          insight_type: finding.insight_type,
          title: `[Stap ${finding.step}][${finding.issue_cluster}] ${finding.display_label ?? finding.entity_name}: ${finding.metric}`.slice(0, 80),
          description: `${finding.display_label ?? finding.entity_name} — ${finding.metric}: ${finding.current_value ?? "n.v.t."}${finding.previous_value != null ? ` (was ${finding.previous_value})` : ""}. Cluster: ${finding.issue_cluster}. Oorzaak: ${finding.cause}`,
          severity: finding.severity,
          affected_entity: finding.display_label ?? finding.entity_name,
          affected_entity_type: finding.entity_type,
          metric: finding.metric,
          current_value: finding.current_value ?? null,
          previous_value: finding.previous_value ?? null,
          change_pct: finding.change_pct ?? null,
          is_seasonal: finding.is_seasonal,
          is_structural: finding.is_structural,
          action_required: finding.action_required,
        }));

        const { data: insertedInsights } = await supabase
          .from("sop_insights")
          .insert(insightRows)
          .select("id");

        const insightIds = (insertedInsights ?? []).map((row: { id: string }) => row.id);

        const recRows = recs.map((rec) => ({
          client_id: clientId,
          analysis_id: analysisId,
          insight_id: rec.finding_index !== null ? (insightIds[rec.finding_index] ?? null) : null,
          sop_type: adapter.sopTypeKey,
          analysis_date: analysisDate,
          hypothesis: rec.hypothesis,
          expected_result: rec.expected_result,
          measurement_metric: rec.measurement_metric,
          timeframe: rec.timeframe,
          rationale: `${rec.rationale} Thread: ${rec.thread_id ?? "geen"}. Phase: ${rec.phase}.`,
          ice_impact: rec.ice_impact,
          ice_confidence: rec.ice_confidence,
          ice_ease: rec.ice_ease,
          ice_total: rec.ice_total,
          status: "open",
        }));

        const { data: insertedRecs } = await supabase
          .from("sop_recommendations")
          .insert(recRows)
          .select("id");

        const recIds = (insertedRecs ?? []).map((row: { id: string }) => row.id);

        const taskRows = tasks.map((task) => {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + task.due_date_days);
          return {
            client_id: clientId,
            recommendation_id: recIds[task.recommendation_index] ?? null,
            analysis_date: analysisDate,
            title: task.title,
            description: `${task.description} Thread: ${task.thread_id ?? "geen"}. Phase: ${task.phase}.`,
            action_type: task.action_type,
            affected_campaign: task.affected_campaign,
            affected_adgroup: task.affected_adgroup,
            affected_keyword: task.affected_keyword,
            current_value: task.current_value,
            target_value: task.target_value,
            priority: task.priority,
            frequency: task.frequency,
            status: "open",
            due_date: dueDate.toISOString().split("T")[0],
          };
        });

        await supabase.from("sop_tasks").insert(taskRows);
        structuredSaved = structuredSaved && true;
      } catch (e) {
        logger.error("Failed to save structured data:", e instanceof Error ? e.message : e);
      }
    }

    const totalTokens = [...steps, ...machineSteps].reduce((sum, step) => sum + step.tokensUsed, 0);
    const totalLatency = [...steps, ...machineSteps].reduce((sum, step) => sum + step.latencyMs, 0);

    await markProgressCompleted(supabase, {
      jobId,
      message: "Maandelijkse SOP-analyse gereed.",
      metadata: {
        analysis_date: analysisDate,
        sop_type: adapter.sopTypeKey,
        structured_saved: structuredSaved,
        save_receipts: {
          quality_gate_monthly_v2: qualityGateReceipt,
          full: fullReceipt,
          structured_monthly_v2: structuredReceipt,
        },
      },
      partialOutputExists,
    });

    return Response.json({
      jobId,
      clientId,
      sopType: "monthly",
      analysisDate,
      period: { start: periodStart, end: periodEnd },
      model: steps[0].model,
      totalTokens,
      totalLatencyMs: totalLatency,
      steps: steps.map((step) => ({
        step: step.stepNumber,
        name: step.stepName,
        tokens: step.tokensUsed,
        latencyMs: step.latencyMs,
        retries: step.retries,
        saved: step.saved,
        output: step.output,
      })),
      internalPipeline: {
        structuredSteps: parsedSteps.length,
        checkpoints: checkpointSteps.length,
      },
      structured: {
        findings: findings.length,
        recommendations: recs.length,
        tasks: tasks.length,
        saved: structuredSaved,
        findingsParseOk: parsedSteps.every((step) => Array.isArray(step.findings)),
        recsParseOk: true,
        clusters: structured.clusters.length,
        displayFindings: structured.display_findings.length,
        threads: structured.threads.length,
        coverage: structured.coverage,
        stepValidations,
        acceptance: acceptanceReport,
        qualityGate,
        saveReceipts: {
          quality_gate_monthly_v2: qualityGateReceipt,
          full: fullReceipt,
          structured_monthly_v2: structuredReceipt,
        },
      },
      fullOutput,
    });
  } catch (err) {
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "Onbekende fout",
    });
    return Response.json({ error: err instanceof Error ? err.message : "Onbekende fout" }, { status: 500 });
  }
}
