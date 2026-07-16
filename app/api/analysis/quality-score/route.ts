// =====================================================================
// G2: losse quality-score-analyse. Gespiegeld op het G1-patroon (GET haalt de laatste op,
// POST draait een nieuwe). De deterministische voorcompute komt uit quality-score-facts.ts,
// de interpretatie uit de prompt met de componenten-no-go hard erin. LIVE-ONGETEST: de
// fetches, de LLM-call en de save vergen de echte omgeving. Onder viewer- respectievelijk
// specialist-niveau via de O1-middleware zodra die actief is.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callRouted } from "@/lib/analysis/llm-router";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import { analyzeQualityScore, type KeywordQsPerformanceRow } from "@/lib/analysis/quality-score-facts";
import { buildQualityScorePrompt } from "@/lib/prompts/quality-score-prompt";

const SECTION = "quality_score_v1";
const SOP_TYPE = "quality_score";

// GET: de laatst opgeslagen quality-score-analyse voor een klant.
export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

// POST: draai een nieuwe quality-score-analyse.
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });
  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }

  // Data ophalen: de keyword-maandrijen (de sync vult deze al; 13 maanden waar beschikbaar).
  const [keywordRes, clientCtx] = await Promise.all([
    supabase
      .from("ads_keyword_performance_monthly")
      .select("month, campaign_name, ad_group_name, keyword_text, match_type, impressions, clicks, cost, conversions, quality_score")
      .eq("client_id", clientId)
      .order("month", { ascending: true }),
    fetchClientContext(supabase, clientId),
  ]);

  const keywordRows = (keywordRes.data ?? []) as KeywordQsPerformanceRow[];
  if (keywordRows.length === 0) {
    return Response.json({ error: "Geen keyword-data voor deze klant" }, { status: 404 });
  }

  const facts = analyzeQualityScore(keywordRows);
  const systemPrompt = buildQualityScorePrompt({ facts, goalsSection: clientCtx.goalsSection });

  const response = await callRouted({
    apiKey,
    systemPrompt,
    userMessage: "Lever de quality-score-analyse met geprioriteerde acties.",
    maxTokens: 8192,
    label: "quality-score",
  });

  const analysisDate = new Date().toISOString().split("T")[0];
  const months = keywordRows.map((r) => r.month).filter(Boolean).sort();
  const periodStart = `${String(months[0]).slice(0, 7)}-01`;
  const periodEnd = `${String(months[months.length - 1]).slice(0, 7)}-01`;

  // O2-kostenregistratie: een synthetische run-sleutel, want een losse analyse heeft geen jobId.
  void recordUsage(supabase, {
    runKey: `quality-score-${clientId}-${analysisDate}`,
    clientId,
    channel: "google_ads",
    sopType: SOP_TYPE,
    stepLabel: "Quality Score",
    model: response.model,
    promptTokens: response.promptTokens ?? 0,
    completionTokens: response.completionTokens ?? 0,
  });

  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId,
      sop_type: SOP_TYPE,
      analysis_date: analysisDate,
      period_start: periodStart,
      period_end: periodEnd,
      section: SECTION,
      output: response.output,
      model_used: response.model,
      tokens_used: response.tokensUsed,
      step_number: 1,
      step_name: "Quality Score",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  return Response.json({ analysis: response.output, summary: facts.summary, flags: facts.flags, priorityKeywords: facts.priorityKeywords });
}
