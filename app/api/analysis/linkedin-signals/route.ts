// =====================================================================
// LinkedIn-signalen: de deterministische signaal-detectors (lib/signals/linkedin-signals)
// bedraad. Geen LLM. Campagne-dagdata over twee 28-dagen-vensters voedt de form-drop-off-,
// CPL-druk-, engagement- en video-detecties; de getriggerde verhalen landen als voorstel in
// de goedkeuringswachtrij (SI8) en de sectie wordt opgeslagen voor UI en analyse-context.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { buildLinkedInSignals } from "@/lib/signals/linkedin-signals";
import { buildLinkedInDemographicSignals, type LinkedInDemographicRow } from "@/lib/signals/linkedin-demographic";
import { buildBudgetConcentrationSignals, type BudgetEntityRow } from "@/lib/signals/budget-concentration";
import { buildDemographicDriftSignals, type DemographicDriftRow } from "@/lib/signals/demographic-drift";
import { renderSignalSection } from "@/lib/signals/render-section";
import { shapeLinkedInInputs, type LinkedInDailyRow } from "@/lib/analysis/channel-signal-data";
import { saveSignalHypotheses } from "@/lib/analysis/signals-to-hypotheses";
import { mergeDetections } from "@/lib/signals/types";

// LinkedIn-pivot → leesbare demografische dimensie voor de segment-efficiëntie-detector.
const PIVOT_TO_DIM: Record<string, string> = {
  MEMBER_JOB_FUNCTION: "functie",
  MEMBER_SENIORITY: "seniority",
  MEMBER_INDUSTRY: "industrie",
  MEMBER_COMPANY_SIZE: "bedrijfsgrootte",
  COMPANY_SIZE: "bedrijfsgrootte",
};

const SECTION = "linkedin_signals_v1";
const SOP_TYPE = "linkedin_signals";
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
  const [dailyRes, namesRes, demoRes, labelRes] = await Promise.all([
    supabase
      .from("linkedin_campaign_daily")
      .select("entity_urn, date, impressions, clicks, spend, one_click_leads, one_click_lead_form_opens, video_completions, video_starts")
      .eq("client_id", clientId)
      .gte("date", since),
    supabase.from("linkedin_campaigns").select("campaign_urn, name").eq("client_id", clientId),
    supabase
      .from("linkedin_demographic_daily")
      .select("pivot_type, pivot_value_urn, date, spend, leads")
      .eq("client_id", clientId)
      .gte("date", since),
    supabase.from("linkedin_urn_labels").select("urn, label"),
  ]);

  const rows = (dailyRes.data ?? []) as LinkedInDailyRow[];
  if (rows.length === 0) {
    return Response.json({ error: "Geen LinkedIn-dagdata voor deze klant; draai eerst de LinkedIn-sync" }, { status: 404 });
  }

  const names = new Map((namesRes.data ?? []).map((c) => [c.campaign_urn as string, (c.name as string) ?? (c.campaign_urn as string)]));
  const entities = shapeLinkedInInputs(rows, names);

  // Structuur naast entiteit-signalen: kosten-efficiëntie per demografisch segment (CPL per
  // functie/seniority/industrie/bedrijfsgrootte) — waste + schaalkansen.
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const urnLabel = new Map((labelRes.data ?? []).map((l) => [String(l.urn), String(l.label)]));
  const demoRows: LinkedInDemographicRow[] = (demoRes.data ?? [])
    .map((r) => {
      const dimension = PIVOT_TO_DIM[String(r.pivot_type ?? "")];
      const urn = String(r.pivot_value_urn ?? "");
      if (!dimension || !urn || urn === "TOTAL") return null;
      return { dimension, value: urnLabel.get(urn) ?? urn, spend: num(r.spend), leads: num(r.leads) };
    })
    .filter((r): r is LinkedInDemographicRow => r !== null);

  // Budget-concentratie per campagne: hangt het gros van het budget aan één (dure) campagne?
  const liTotals = new Map<string, { spend: number; conversions: number }>();
  for (const r of (dailyRes.data ?? []) as Record<string, unknown>[]) {
    const urn = String(r.entity_urn);
    const t = liTotals.get(urn) ?? { spend: 0, conversions: 0 };
    t.spend += num(r.spend); t.conversions += num(r.one_click_leads);
    liTotals.set(urn, t);
  }
  const liBudgetEntities: BudgetEntityRow[] = [...liTotals.entries()].map(([urn, t]) => ({ name: names.get(urn) ?? urn, spend: t.spend, conversions: t.conversions }));

  // Demografie-drift: verschuift de converterende mix over de tijd?
  const driftRows: DemographicDriftRow[] = (demoRes.data ?? [])
    .map((r) => {
      const dimension = PIVOT_TO_DIM[String(r.pivot_type ?? "")];
      const urn = String(r.pivot_value_urn ?? "");
      if (!dimension || !urn || urn === "TOTAL" || !r.date) return null;
      return { dimension, value: urnLabel.get(urn) ?? urn, date: String(r.date), leads: num(r.leads) };
    })
    .filter((r): r is DemographicDriftRow => r !== null);
  const asOfDate = new Date().toISOString().slice(0, 10);

  const merged = mergeDetections([
    buildLinkedInSignals({ entities }),
    buildLinkedInDemographicSignals(demoRows),
    buildBudgetConcentrationSignals(liBudgetEntities, { channelLabel: "LinkedIn", idPrefix: "linkedin_budget" }),
    buildDemographicDriftSignals(driftRows, asOfDate),
  ]);
  const { section, triggeredCount, checkedIds } = renderSignalSection(merged, "LinkedIn");

  const output = section || `## LinkedIn-signalen\n\nGeen signalen getriggerd. Gecontroleerd: ${checkedIds.join(", ")}.`;
  const analysisDate = new Date().toISOString().split("T")[0];
  const dates = rows.map((r) => r.date).sort();

  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId,
      sop_type: SOP_TYPE,
      analysis_date: analysisDate,
      period_start: dates[0],
      period_end: dates[dates.length - 1],
      section: SECTION,
      output,
      model_used: "deterministisch",
      tokens_used: 0,
      step_number: 1,
      step_name: "LinkedIn-signalen",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  await saveSignalHypotheses(supabase, merged.triggered, "linkedin_signals", { clientId, analysisId: null });

  return Response.json({ analysis: output, signals: triggeredCount, checked: checkedIds.length, campaignsAnalysed: entities.length });
}
