// =====================================================================
// Losse Meta funnel-drop-off-analyse (uit stap 8 van de Meta-SOP losgetrokken). De fase-
// overgangen over twee 28-dagen-vensters, deterministisch berekend en verwoord door de
// pure kern (lib/analysis/meta-funnel-facts). Geen LLM. Een materieel verslechterde fase
// landt als voorstel in de goedkeuringswachtrij (bron meta_funnel).
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { analyzeMetaFunnel, renderMetaFunnelMarkdown, type MetaFunnelDailyRow } from "@/lib/analysis/meta-funnel-facts";
import { saveProposalsReplacingPending, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";

const SECTION = "meta_funnel_v1";
const SOP_TYPE = "meta_funnel";
const FETCH_DAYS = 70;

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

  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }

  const since = new Date(Date.now() - FETCH_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data: rows } = await supabase
    .from("meta_account_daily")
    .select("date, impressions, link_clicks, landing_page_views, add_to_cart, initiate_checkout, conversions")
    .eq("client_id", clientId)
    .gte("date", since);

  const daily = (rows ?? []) as MetaFunnelDailyRow[];
  if (daily.length === 0) {
    return Response.json({ error: "Geen Meta-dagdata voor deze klant; draai eerst de Meta-sync" }, { status: 404 });
  }

  const facts = analyzeMetaFunnel(daily);
  const output = renderMetaFunnelMarkdown(facts);
  const actionNeeded = facts.worst !== null;

  const analysisDate = new Date().toISOString().slice(0, 10);
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId, sop_type: SOP_TYPE, analysis_date: analysisDate,
      period_start: since, period_end: analysisDate, section: SECTION,
      output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: "Meta funnel",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  const proposals: SprintHypothesisRow[] = facts.worst
    ? [{
        client_id: clientId, analysis_id: null,
        hypothesis: `Onderzoek de Meta-funnelfase ${facts.worst.from} → ${facts.worst.to} (${Math.round((facts.worst.deltaPct ?? 0) * 100)}% verslechterd)`,
        expected_result: "De oorzaak van de fase-verslechtering is gevonden (creative, doelgroep of landingservaring) en de overgangsrate herstelt richting het prior-venster.",
        measurement_metric: "De overgangsrate van deze fase in de volgende funnel-analyse.",
        timeframe: "2 weken",
        rationale: `Rate zakte van ${Math.round((facts.worst.priorRate ?? 0) * 1000) / 10}% naar ${Math.round((facts.worst.recentRate ?? 0) * 1000) / 10}% bij ${facts.worst.recentFromVolume} instap-volume.`,
        ice_impact: 6, ice_confidence: 7, ice_ease: 5,
        ice_total: Math.round(((6 + 7 + 5) / 3) * 10) / 10,
        status: "pending", source: "meta_funnel",
      }]
    : [];
  await saveProposalsReplacingPending(supabase, clientId, "meta_funnel", proposals);

  return Response.json({ analysis: output, actionNeeded, stages: facts.stages.length, skipped: facts.skippedStages });
}
