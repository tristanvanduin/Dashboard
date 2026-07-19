// =====================================================================
// Losse Google funnel-drop-off-analyse op de gedeelde funnel-kern. Google levert account-
// breed drie fasen (vertoning -> klik -> conversie) op WEEKDATA (ads_account_weekly);
// het venster is 4 weken vs de 4 weken ervoor. Deterministisch, geen LLM.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { analyzeGoogleFunnel, renderGoogleFunnelMarkdown, type GoogleFunnelWeeklyRow } from "@/lib/analysis/google-funnel-facts";
import { saveProposalsReplacingPending, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";

const SECTION = "google_funnel_v1";
const SOP_TYPE = "google_funnel";
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
    .from("ads_account_weekly")
    .select("week_start, impressions, clicks, conversions")
    .eq("client_id", clientId)
    .gte("week_start", since);

  const weekly: GoogleFunnelWeeklyRow[] = (rows ?? []).map((r) => ({
    date: String(r.week_start), impressions: r.impressions, clicks: r.clicks, conversions: r.conversions,
  }));
  if (weekly.length === 0) {
    return Response.json({ error: "Geen Google-weekdata voor deze klant" }, { status: 404 });
  }

  const facts = analyzeGoogleFunnel(weekly);
  const output = renderGoogleFunnelMarkdown(facts);
  const actionNeeded = facts.worst !== null;

  const analysisDate = new Date().toISOString().slice(0, 10);
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId, sop_type: SOP_TYPE, analysis_date: analysisDate,
      period_start: since, period_end: analysisDate, section: SECTION,
      output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: "Google funnel",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  const proposals: SprintHypothesisRow[] = facts.worst
    ? [{
        client_id: clientId, analysis_id: null,
        hypothesis: `Onderzoek de Google-funnelfase ${facts.worst.from} → ${facts.worst.to} (${Math.round((facts.worst.deltaPct ?? 0) * 100)}% verslechterd)`,
        expected_result: "De oorzaak van de fase-verslechtering is gevonden (zoekintentie, landing, meting) en de overgangsrate herstelt richting het prior-venster.",
        measurement_metric: "De overgangsrate van deze fase in de volgende funnel-analyse.",
        timeframe: "2 weken",
        rationale: `Rate zakte van ${Math.round((facts.worst.priorRate ?? 0) * 1000) / 10}% naar ${Math.round((facts.worst.recentRate ?? 0) * 1000) / 10}% bij ${Math.round(facts.worst.recentFromVolume)} instap-volume.`,
        ice_impact: 6, ice_confidence: 7, ice_ease: 5,
        ice_total: Math.round(((6 + 7 + 5) / 3) * 10) / 10,
        status: "pending", source: "google_funnel",
      }]
    : [];
  await saveProposalsReplacingPending(supabase, clientId, "google_funnel", proposals);

  return Response.json({ analysis: output, actionNeeded, stages: facts.stages.length, skipped: facts.skippedStages });
}
