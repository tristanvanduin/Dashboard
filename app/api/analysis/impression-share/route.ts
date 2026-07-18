// =====================================================================
// G1: losse impression-share-analyse. Gespiegeld op het search-terms-patroon (GET haalt
// de laatste op, POST draait een nieuwe). De deterministische diagnose komt uit
// impression-share-facts.ts, de interpretatie uit de prompt. LIVE-ONGETEST: de fetches, de
// LLM-call en de save vergen de echte omgeving. Onder viewer- respectievelijk
// specialist-niveau via de O1-middleware zodra die actief is.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callRouted } from "@/lib/analysis/llm-router";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import {
  analyzeCampaignImpressionShare,
  analyzeGeoImpressionShare,
  type CampaignImpressionShareRow,
  type CountryImpressionShareRow,
} from "@/lib/analysis/impression-share-facts";
import { buildImpressionSharePrompt } from "@/lib/prompts/impression-share-prompt";
import { saveImpressionShareHypotheses } from "@/lib/analysis/standalone-to-hypotheses";

const SECTION = "impression_share_v1";
const SOP_TYPE = "impression_share";

// GET: de laatst opgeslagen impression-share-analyse voor een klant.
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

// POST: draai een nieuwe impression-share-analyse.
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

  // Data ophalen: campagne- en landniveau impression share (de sync vult deze al).
  const [campaignRes, countryRes, clientCtx] = await Promise.all([
    supabase
      .from("ads_campaign_impression_share")
      .select("campaign_id, campaign_name, campaign_type, month, conversions, cost, search_impression_share, search_budget_lost_is, search_rank_lost_is, daily_budget, budget_utilization")
      .eq("client_id", clientId)
      .order("month", { ascending: true }),
    supabase
      .from("ads_country_impression_share")
      .select("country_code, month, search_impression_share, search_budget_lost_is, search_rank_lost_is, total_cost")
      .eq("client_id", clientId)
      .order("month", { ascending: true }),
    fetchClientContext(supabase, clientId),
  ]);

  const campaignRows = (campaignRes.data ?? []) as CampaignImpressionShareRow[];
  if (campaignRows.length === 0) {
    return Response.json({ error: "Geen impression-share-data voor deze klant" }, { status: 404 });
  }
  const countryRows = (countryRes.data ?? []) as CountryImpressionShareRow[];

  const { campaigns, summary } = analyzeCampaignImpressionShare(campaignRows);
  const geo = analyzeGeoImpressionShare(countryRows);

  const systemPrompt = buildImpressionSharePrompt({ summary, campaigns, geo, goalsSection: clientCtx.goalsSection });

  const response = await callRouted({
    apiKey,
    systemPrompt,
    userMessage: "Lever de impression-share-analyse met geprioriteerde acties.",
    maxTokens: 8192,
    label: "impression-share",
  });

  const analysisDate = new Date().toISOString().split("T")[0];
  const months = campaignRows.map((r) => r.month).filter(Boolean).sort();
  const periodStart = `${months[0]}-01`;
  const periodEnd = `${months[months.length - 1]}-01`;

  // O2-kostenregistratie: een synthetische run-sleutel, want een losse analyse heeft geen jobId.
  void recordUsage(supabase, {
    runKey: `impression-share-${clientId}-${analysisDate}`,
    clientId,
    channel: "google_ads",
    sopType: SOP_TYPE,
    stepLabel: "Impression Share",
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
      step_name: "Impression Share",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  // Voed de goedkeuringswachtrij: aggregeer het budget-/rang-verlies tot één voorstel.
  await saveImpressionShareHypotheses(supabase, { summary, campaigns }, { clientId, analysisId: null });

  return Response.json({ analysis: response.output, summary, campaigns, geo });
}
