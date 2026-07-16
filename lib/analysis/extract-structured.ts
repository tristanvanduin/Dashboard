/**
 * Shared structured extraction pipeline for SOP analyses.
 *
 * Adds Zod-validated findings, recommendations, and tasks extraction
 * to any SOP analysis output. Used by weekly, biweekly, and monthly routes.
 *
 * Flow:
 * 1. Run findings extraction step (JSON mode)
 * 2. Run recommendations+tasks extraction step (JSON mode)
 * 3. Parse with Zod (with partial recovery)
 * 4. Apply deterministic action gating
 * 5. Save to sop_insights, sop_recommendations, sop_tasks, sprint_hypotheses
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { runStep, type StepResult } from "./helpers";
import {
  parseFindings,
  parseRecommendations,
  type Finding,
  type Recommendation,
  type Task,
} from "../schema/analysis-schema";
import { applyActionGating } from "./action-gating";
import { saveProposalsReplacingPending, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";
import { extractGroundedNumbers, gateItemFields } from "./weekly-number-gate";
import type { DataReliabilityAssessment } from "./data-reliability";
import { logger } from "@/lib/logger";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  findings: Finding[];
  recommendations: Recommendation[];
  tasks: Task[];
  findingsParseOk: boolean;
  recsParseOk: boolean;
  saved: boolean;
  steps: StepResult[];
}

interface ExtractionOptions {
  supabase: SupabaseClient;
  apiKey: string;
  clientId: string;
  sopType: "weekly" | "biweekly" | "monthly";
  analysisDate: string;
  periodStart: string;
  periodEnd: string;
  /** The full analysis text output to extract from */
  analysisOutput: string;
  /** System prompt for findings extraction */
  findingsSystemPrompt: string;
  /** System prompt for recommendations extraction */
  recsSystemPrompt: string;
  /** Step number offset (findings step = offset+1, recs step = offset+2) */
  stepOffset: number;
  /** The analysis_id from sop_analysis_output (for FK linking) */
  analysisId: string | null;
  /** Optional data reliability assessment — downgrades direct_actions if low/critical */
  reliability?: DataReliabilityAssessment;
  /** Optional: TOP 3 BEVINDINGEN text extracted from analysis steps */
  topFindings?: string;
  /** Optional progress callback */
  onPhase?: (phaseKey: "extract_findings" | "extract_recommendations" | "save_outputs", message?: string) => Promise<void>;
}

// ── Main extraction function ──────────────────────────────────────────────

export async function extractStructuredData(opts: ExtractionOptions): Promise<ExtractionResult> {
  const {
    supabase, apiKey, clientId, sopType,
    analysisDate, periodStart, periodEnd,
    analysisOutput, findingsSystemPrompt, recsSystemPrompt,
    stepOffset, analysisId, reliability, topFindings,
    onPhase,
  } = opts;

  const shared = { supabase, apiKey, clientId, sopType, periodStart, periodEnd };
  const steps: StepResult[] = [];

  // ── Step A: Extract findings (JSON mode) ─────────────────────────

  const findingsUserMessage = topFindings
    ? `Extraheer alle significante bevindingen uit deze analyse.

## TOP 3 BEVINDINGEN per stap
${topFindings}

## Volledige analyse
${analysisOutput}`
    : `Extraheer alle significante bevindingen uit deze analyse.

## Volledige analyse
${analysisOutput}`;

  await onPhase?.("extract_findings", "Findings uit de analyse halen...");
  const findingsStep = await runStep({
    ...shared,
    stepNumber: stepOffset + 1,
    stepName: "Findings Extractie",
    systemPrompt: findingsSystemPrompt,
    userMessage: findingsUserMessage,
    jsonMode: true,
  });
  steps.push(findingsStep);

  const findingsResult = parseFindings(findingsStep.output);
  const findings: Finding[] = findingsResult.success ? findingsResult.data : [];
  if (!findingsResult.success) {
    logger.error(`[${sopType}] Findings parse failed:`, findingsResult.error);
  }

  // ── Step B: Extract recommendations + tasks (JSON mode) ──────────

  await onPhase?.("extract_recommendations", "Aanbevelingen en taken genereren...");
  const recsStep = await runStep({
    ...shared,
    stepNumber: stepOffset + 2,
    stepName: "Aanbevelingen & Taken",
    systemPrompt: recsSystemPrompt,
    userMessage: `## Bevindingen (findings JSON)
${JSON.stringify(findings, null, 2)}

## Volledige analyse tekst
${analysisOutput}`,
    jsonMode: true,
  });
  steps.push(recsStep);

  const recsResult = parseRecommendations(recsStep.output);
  let recs: Recommendation[] = recsResult.success ? recsResult.data.recommendations : [];
  let tasks: Task[] = recsResult.success ? recsResult.data.tasks : [];
  if (!recsResult.success) {
    logger.error(`[${sopType}] Recommendations parse failed:`, recsResult.error);
  }

  // ── Apply deterministic action gating ────────────────────────────

  recs = applyActionGating(findings, recs);

  // W2.5 (W2): number-gate voor de korte cadans. Markeert en schrapt percentages en euro's in
  // aanbevelingen en taken die niet herleidbaar zijn tot de gegronde analyse-output. Alleen
  // weekly en biweekly; monthly heeft zijn eigen gate in buildStructuredMonthlyOutput.
  if (sopType === "weekly" || sopType === "biweekly") {
    const allowed = extractGroundedNumbers(analysisOutput + " " + findings.map((f) => JSON.stringify(f)).join(" "));
    let flaggedNumbers = 0;
    recs = recs.map((rec) => {
      const gated = gateItemFields(rec, ["hypothesis", "expected_result"], allowed);
      if (gated.hadUngrounded) flaggedNumbers += gated.ungrounded.length;
      return gated.item;
    });
    tasks = tasks.map((task) => {
      const gated = gateItemFields(task, ["title", "description"], allowed);
      if (gated.hadUngrounded) flaggedNumbers += gated.ungrounded.length;
      return gated.item;
    });
    if (flaggedNumbers > 0) {
      console.warn(`[${sopType}] number-gate markeerde ${flaggedNumbers} ongegronde cijfers in aanbevelingen of taken`);
    }
  }

  // Downgrade direct_actions if data reliability is low/critical
  if (reliability && (reliability.overallConfidence === "critical" || reliability.overallConfidence === "low")) {
    for (const rec of recs) {
      const r = rec as Record<string, unknown>;
      if (r.action_readiness === "direct_action") {
        r.action_readiness = "investigate_first";
      }
    }
  }

  // ── Save to Supabase ─────────────────────────────────────────────

  let saved = false;

  if (findings.length > 0) {
    try {
      await onPhase?.("save_outputs", "Structured output opslaan...");
      // 1. Insert findings → sop_insights
      const insightRows = findings.map((f) => ({
        client_id: clientId,
        analysis_id: analysisId,
        sop_type: sopType,
        analysis_date: analysisDate,
        insight_type: f.insight_type,
        title: `[Stap ${f.step}] ${f.entity_name}: ${f.metric} ${f.change_pct ? `${f.change_pct}%` : ""}`.slice(0, 80),
        description: f.cause
          ? `${f.entity_name} — ${f.metric}: ${f.current_value} (was ${f.previous_value}). Oorzaak: ${f.cause}`
          : `${f.entity_name} — ${f.metric}: ${f.current_value} (was ${f.previous_value})`,
        severity: f.severity,
        affected_entity: f.entity_name,
        affected_entity_type: f.entity_type,
        metric: f.metric,
        current_value: f.current_value ?? null,
        previous_value: f.previous_value ?? null,
        change_pct: f.change_pct ?? null,
        is_seasonal: f.is_seasonal,
        is_structural: f.is_structural,
        action_required: f.action_required,
      }));

      const { data: insertedInsights } = await supabase
        .from("sop_insights")
        .insert(insightRows)
        .select("id");

      const insightIds = (insertedInsights ?? []).map((r: { id: string }) => r.id);

      // 2. Insert recommendations → sop_recommendations
      const recRows = recs.map((rec) => {
        const findingIdx = rec.finding_index;
        return {
          client_id: clientId,
          analysis_id: analysisId,
          insight_id: findingIdx !== null ? (insightIds[findingIdx] ?? null) : null,
          sop_type: sopType,
          analysis_date: analysisDate,
          hypothesis: rec.hypothesis,
          expected_result: rec.expected_result,
          measurement_metric: rec.measurement_metric,
          timeframe: rec.timeframe,
          rationale: rec.rationale,
          ice_impact: rec.ice_impact,
          ice_confidence: rec.ice_confidence,
          ice_ease: rec.ice_ease,
          ice_total: rec.ice_total,
          status: "open",
        };
      });

      const { data: insertedRecs } = await supabase
        .from("sop_recommendations")
        .insert(recRows)
        .select("id");

      const recIds = (insertedRecs ?? []).map((r: { id: string }) => r.id);

      // 3. Insert tasks → sop_tasks
      const taskRows = tasks.map((task) => {
        const recIdx = task.recommendation_index;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + task.due_date_days);

        return {
          client_id: clientId,
          recommendation_id: recIds[recIdx] ?? null,
          analysis_date: analysisDate,
          title: task.title,
          description: task.description,
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

      // 4. Hypothesis-sourced recs naar sprint_hypotheses.
      // SI6: dit liep als enige via een rauwe insert, terwijl second_opinion en
      // search_terms al saveProposalsReplacingPending gebruiken. Nu loopt alles via die
      // ene writer: dezelfde veilige semantiek (nieuwe rijen eerst inserten, oude pending
      // pas daarna opruimen, geaccepteerde voorstellen blijven altijd staan) en een
      // expliciete bron in plaats van de kolomdefault.
      const hypotheseRecs = recs.filter((rec) => rec.source === "hypothesis");
      const hypotheseRows: SprintHypothesisRow[] = hypotheseRecs.map((rec) => ({
        client_id: clientId,
        analysis_id: analysisId,
        hypothesis: rec.hypothesis,
        expected_result: rec.expected_result,
        measurement_metric: rec.measurement_metric,
        timeframe: rec.timeframe,
        rationale: rec.rationale,
        ice_impact: rec.ice_impact,
        ice_confidence: rec.ice_confidence,
        ice_ease: rec.ice_ease,
        ice_total: rec.ice_total,
        status: "pending",
        source: "analysis",
      }));
      await saveProposalsReplacingPending(supabase, clientId, "analysis", hypotheseRows);

      saved = true;
    } catch (e) {
      logger.error(`[${sopType}] Failed to save structured data:`, e instanceof Error ? e.message : e);
    }
  }

  return {
    findings,
    recommendations: recs,
    tasks,
    findingsParseOk: findingsResult.success,
    recsParseOk: recsResult.success,
    saved,
    steps,
  };
}
