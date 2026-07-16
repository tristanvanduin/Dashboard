// =====================================================================
// RSA-insights: losse copy-analyse op asset-niveau (het Google-equivalent van M3/M4).
// Gespiegeld op het G-patroon (GET haalt de laatste op, POST draait een nieuwe). De
// deterministische voorcompute komt uit rsa-insights-facts.ts met de dubbeltelling-
// hierarchie hard in de prompt. LIVE-ONGETEST: vergt de sync-taak die google_ads_rsa_assets
// vult (ad_group_ad_asset_view, velden bekend) plus migratie 020.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callRouted } from "@/lib/analysis/llm-router";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import { analyzeRsaInsights, type RsaAssetRow } from "@/lib/analysis/rsa-insights-facts";
import { buildRsaInsightsPrompt } from "@/lib/prompts/rsa-insights-prompt";

const SECTION = "rsa_insights_v1";
const SOP_TYPE = "rsa_insights";

// GET: de laatst opgeslagen RSA-analyse voor een klant.
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

// POST: draai een nieuwe RSA-copy-analyse.
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

  const [assetRes, clientCtx] = await Promise.all([
    supabase
      .from("google_ads_rsa_assets")
      .select("month, campaign_name, ad_group_name, ad_id, asset_id, field_type, asset_text, pinned_field, performance_label, impressions, clicks, conversions, cost")
      .eq("client_id", clientId)
      .order("month", { ascending: true }),
    fetchClientContext(supabase, clientId),
  ]);

  const assetRows = (assetRes.data ?? []) as RsaAssetRow[];
  if (assetRows.length === 0) {
    return Response.json({ error: "Geen RSA-asset-data voor deze klant; de sync op ad_group_ad_asset_view (migratie 020) moet eerst vullen" }, { status: 404 });
  }

  const facts = analyzeRsaInsights(assetRows);
  const systemPrompt = buildRsaInsightsPrompt({ facts, goalsSection: clientCtx.goalsSection });

  const response = await callRouted({
    apiKey,
    systemPrompt,
    userMessage: "Lever de RSA-copy-analyse met de geprioriteerde schrijfopdrachten voor de content-marketeer.",
    maxTokens: 8192,
    label: "rsa-insights",
  });

  const analysisDate = new Date().toISOString().split("T")[0];
  const months = assetRows.map((r) => r.month).filter(Boolean).sort();
  const periodStart = `${String(months[0]).slice(0, 7)}-01`;
  const periodEnd = `${String(months[months.length - 1]).slice(0, 7)}-01`;

  void recordUsage(supabase, {
    runKey: `rsa-insights-${clientId}-${analysisDate}`,
    clientId,
    channel: "google_ads",
    sopType: SOP_TYPE,
    stepLabel: "RSA Copy Insights",
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
      step_name: "RSA Copy Insights",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  return Response.json({ analysis: response.output, summary: facts.summary, actions: facts.actions });
}
