// =====================================================================
// Beursanalyse per geo-clone (fase 4). Deterministisch, geen LLM: de route haalt de
// campagne-maanddata, de per-beurs-instellingen (cadans/edities/doelen met account-fallback)
// en laat lib/rai/geo-clone-analysis de event-relatieve vergelijking en projectie doen.
// De uitkomst wordt per beurs opgeslagen (sectie per afkorting) en een materiele achterstand
// of gemiste doel-projectie landt als voorstel in de goedkeuringswachtrij (bron geo_clone).
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { analyzeGeoClone } from "@/lib/rai/geo-clone-analysis";
import { RAI_GEO_CLONES } from "@/lib/rai/geo-clone-catalog";
import { resolveEvent, resolveGoals, type Edition, type Cadence } from "@/lib/rai/geo-clone-settings";
import type { CampaignMonthlyRow } from "@/lib/rai/geo-clone-aggregate";
import { saveProposalsReplacingPending, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";

const SOP_TYPE = "geo_clone";
const sectionFor = (geoClone: string) => `geo_clone_${geoClone.toLowerCase()}_v1`;

interface RaiEventCfg { abbrev?: string; cadence?: Cadence; editions?: Edition[] }

function parseParams(clientId: string | null, geoClone: string | null): { clientId: string; geoClone: string } | null {
  if (!clientId || !geoClone || !geoClone.trim()) return null;
  return { clientId, geoClone: geoClone.trim().toUpperCase() };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = parseParams(url.searchParams.get("client_id"), url.searchParams.get("geo_clone"));
  if (!params) return Response.json({ error: "client_id en geo_clone zijn verplicht" }, { status: 400 });
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date")
    .eq("client_id", params.clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", sectionFor(params.geoClone))
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  let params: { clientId: string; geoClone: string } | null = null;
  try {
    const body = await request.json();
    params = parseParams(body.client_id ?? null, body.geo_clone ?? null);
  } catch { /* onder afgehandeld */ }
  if (!params) return Response.json({ error: "client_id en geo_clone zijn verplicht" }, { status: 400 });
  const { clientId, geoClone } = params;

  const [rowsRes, settingsRes, gcRes] = await Promise.all([
    supabase
      .from("ads_campaign_monthly")
      .select("campaign_name, month, impressions, clicks, cost, conversions, conversions_value")
      .eq("client_id", clientId)
      .order("month", { ascending: true }),
    supabase.from("client_settings").select("rai_events, kpi_targets").eq("client_id", clientId).maybeSingle(),
    supabase.from("geo_clone_settings").select("goals, event").eq("client_id", clientId).eq("geo_clone", geoClone).maybeSingle(),
  ]);

  const rows = (rowsRes.data ?? []) as CampaignMonthlyRow[];
  if (rows.length === 0) return Response.json({ error: "Geen campagne-maanddata voor deze klant" }, { status: 404 });

  const variant = RAI_GEO_CLONES.find((v) => v.abbreviation === geoClone) ?? null;
  const fairLabel = variant ? `${variant.brand} ${variant.location}` : geoClone;

  // Account-niveau event-config: de rai_events-entry met deze afkorting.
  const events = ((settingsRes.data?.rai_events as { events?: RaiEventCfg[] } | null)?.events ?? []);
  const accountEvent = events.find((e) => (e.abbrev ?? "").trim().toUpperCase() === geoClone) ?? null;
  const kpi = (settingsRes.data?.kpi_targets ?? null) as Record<string, unknown> | null;

  // Per-beurs-instellingen met account-fallback (fase 2-resolver).
  const event = resolveEvent(
    { cadence: accountEvent?.cadence ?? variant?.cadence ?? null, editions: accountEvent?.editions ?? [] },
    (gcRes.data?.event as { cadence?: Cadence | null; editions?: Edition[] | null } | null) ?? null
  );
  const goals = resolveGoals(
    { conversionsAbsolute: typeof kpi?.conversionsAbsolute === "number" && kpi.conversionsAbsolute > 0 ? kpi.conversionsAbsolute : null },
    (gcRes.data?.goals as { conversionsAbsolute?: number | null } | null) ?? null
  );

  const asOfDate = new Date().toISOString().slice(0, 10);
  const result = analyzeGeoClone({
    geoClone,
    fairLabel,
    rows,
    cadence: (event.effective.cadence ?? "annual") as Cadence,
    editions: event.effective.editions ?? [],
    conversionsTarget: goals.effective.conversionsAbsolute ?? null,
    asOfDate,
  });

  const months = rows.map((r) => r.month).sort();
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId,
      sop_type: SOP_TYPE,
      analysis_date: asOfDate,
      period_start: months[0].slice(0, 10),
      period_end: months[months.length - 1].slice(0, 10),
      section: sectionFor(geoClone),
      output: result.markdown,
      model_used: "deterministisch",
      tokens_used: 0,
      step_number: 1,
      step_name: `Beursanalyse ${geoClone}`,
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  // Wachtrij: alleen bij een materiele achterstand of gemiste doel-projectie. Per beurs een
  // eigen "vervang mijn pending"-scope zou per abbreviation moeten; we houden de bron
  // geo_clone en zetten de beurs in de hypothese, zodat een nieuwe run de oude ververst.
  const proposals: SprintHypothesisRow[] = result.actionNeeded
    ? [{
        client_id: clientId,
        analysis_id: null,
        hypothesis: `Beursaanloop ${fairLabel} (${geoClone}) vraagt bijsturing richting editie ${result.currentEditionId}`,
        expected_result: "De aanloop komt terug op het tempo van de vorige editie en de projectie haalt het doel.",
        measurement_metric: "Editie-over-editie-delta en doel-projectie in de volgende beursanalyse.",
        timeframe: "2 weken",
        rationale: [
          result.conversions?.comparable && result.conversions.deltaPct != null
            ? `Conversie-opbouw ${Math.round(result.conversions.deltaPct * 100)}% t.o.v. de vorige editie op gelijke afstand tot de beurs.`
            : null,
          result.forecast?.willHitTarget === false && result.forecast.projectedVsTargetPct != null
            ? `Projectie komt uit op ${Math.round(result.forecast.projectedVsTargetPct * 100)}% van het doel (${result.forecast.method}, zekerheid ${result.forecast.confidence}).`
            : null,
        ].filter(Boolean).join(" "),
        ice_impact: 7,
        ice_confidence: result.forecast?.confidence === "hoog" ? 8 : 5,
        ice_ease: 5,
        ice_total: Math.round(((7 + (result.forecast?.confidence === "hoog" ? 8 : 5) + 5) / 3) * 10) / 10,
        status: "pending",
        source: "geo_clone",
      }]
    : [];
  await saveProposalsReplacingPending(supabase, clientId, "geo_clone", proposals);

  return Response.json({
    analysis: result.markdown,
    actionNeeded: result.actionNeeded,
    currentEdition: result.currentEditionId,
    previousEdition: result.previousEditionId,
    degradations: result.degradations,
  });
}
