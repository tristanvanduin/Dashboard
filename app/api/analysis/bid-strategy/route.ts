// =====================================================================
// Hefboom 3: losse biedstrategie-fit-analyse. Haalt per campagne de biedstrategie en
// conversies uit ads_campaign_impression_share, merget de conversiewaarde uit
// ads_campaign_monthly, en leidt het doel af uit kpi_targets. De deterministische
// classificatie bepaalt de mismatches. LIVE-ONGETEST: de fetches, de merge, de LLM-call en
// de save vergen de echte omgeving.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callRouted } from "@/lib/analysis/llm-router";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import { analyzeBidStrategy, type CampaignBidInput, type BidGoal } from "@/lib/analysis/bid-strategy-facts";
import { buildBidStrategyPrompt } from "@/lib/prompts/bid-strategy-prompt";
import { saveBidStrategyHypotheses } from "@/lib/analysis/standalone-to-hypotheses";

const SECTION = "bid_strategy_v1";
const SOP_TYPE = "bid_strategy";

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

  const [isRes, monthlyRes, targetRes, clientCtx] = await Promise.all([
    supabase
      .from("ads_campaign_impression_share")
      .select("campaign_id, campaign_name, month, conversions, bidding_strategy")
      .eq("client_id", clientId)
      .order("month", { ascending: false }),
    supabase
      .from("ads_campaign_monthly")
      .select("campaign_id, month, conversions_value")
      .eq("client_id", clientId)
      .order("month", { ascending: false }),
    supabase.from("client_settings").select("kpi_targets").eq("client_id", clientId).maybeSingle(),
    fetchClientContext(supabase, clientId),
  ]);

  const isRows = isRes.data ?? [];
  if (isRows.length === 0) {
    return Response.json({ error: "Geen campagnedata met biedstrategie voor deze klant" }, { status: 404 });
  }

  const valueByKey = new Map<string, number>();
  for (const row of monthlyRes.data ?? []) {
    const key = `${row.campaign_id}|${row.month}`;
    if (!valueByKey.has(key) && typeof row.conversions_value === "number") valueByKey.set(key, row.conversions_value);
  }

  const seen = new Set<string>();
  const campaigns: CampaignBidInput[] = [];
  for (const row of isRows) {
    if (!row.campaign_id || seen.has(row.campaign_id)) continue;
    seen.add(row.campaign_id);
    campaigns.push({
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      biddingStrategy: row.bidding_strategy,
      conversions: row.conversions,
      conversionsValue: valueByKey.get(`${row.campaign_id}|${row.month}`) ?? null,
    });
  }

  const kpi = (targetRes.data?.kpi_targets ?? null) as Record<string, unknown> | null;
  const goal: BidGoal = {
    hasCpaTarget: typeof kpi?.cpaTarget === "number" && kpi.cpaTarget > 0,
    hasRoasTarget: typeof kpi?.roasTarget === "number" && kpi.roasTarget > 0,
  };

  const { campaigns: facts, summary } = analyzeBidStrategy(campaigns, goal);
  const systemPrompt = buildBidStrategyPrompt({ summary, campaigns: facts, goal, goalsSection: clientCtx.goalsSection });

  const response = await callRouted({
    apiKey,
    systemPrompt,
    userMessage: "Lever de biedstrategie-fit-analyse met concrete adviezen per mismatch.",
    maxTokens: 8192,
    label: "bid-strategy",
  });

  const analysisDate = new Date().toISOString().split("T")[0];
  const months = isRows.map((r) => r.month).filter(Boolean).sort();

  void recordUsage(supabase, {
    runKey: `bid-strategy-${clientId}-${analysisDate}`,
    clientId,
    channel: "google_ads",
    sopType: SOP_TYPE,
    stepLabel: "Biedstrategie-fit",
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
      period_start: `${months[0]}-01`,
      period_end: `${months[months.length - 1]}-01`,
      section: SECTION,
      output: response.output,
      model_used: response.model,
      tokens_used: response.tokensUsed,
      step_number: 1,
      step_name: "Biedstrategie-fit",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  // Voed de goedkeuringswachtrij: aggregeer de biedstrategie-mismatches tot één voorstel.
  await saveBidStrategyHypotheses(supabase, { summary, campaigns: facts }, { clientId, analysisId: null });

  return Response.json({ analysis: response.output, summary, campaigns: facts });
}
