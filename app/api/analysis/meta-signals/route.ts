// =====================================================================
// Meta-signalen: de deterministische signaal-detectors (lib/signals/meta-creative) bedraad.
// Geen LLM: de detectors rekenen, de renderer verwoordt in het vaste signaal-format. De dag-
// data van de laatste twee 28-dagen-vensters voedt fatigue/saturatie/ranking/hook-detecties;
// de getriggerde verhalen landen als een voorstel in de goedkeuringswachtrij (SI8) en de
// sectie wordt opgeslagen zodat het maandwerk en de UI dezelfde bevinding zien.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { buildMetaCreativeSignals } from "@/lib/signals/meta-creative";
import { buildMetaBreakdownSignals, metaBreakdownTypeLabel, type MetaBreakdownRow } from "@/lib/signals/meta-breakdown";
import { buildBudgetConcentrationSignals, type BudgetEntityRow } from "@/lib/signals/budget-concentration";
import { buildDemographicDriftSignals, type DemographicDriftRow } from "@/lib/signals/demographic-drift";
import { buildSpendVelocitySignals, type SpendDailyRow } from "@/lib/signals/spend-velocity";
import { buildWeekdayEfficiencySignals, type WeekdayRow } from "@/lib/signals/weekday-efficiency";
import { renderSignalSection } from "@/lib/signals/render-section";
import { mergeDetections } from "@/lib/signals/types";
import { shapeMetaAdInputs, shapeMetaLevelInputs, type MetaDailyRow } from "@/lib/analysis/channel-signal-data";
import { saveSignalHypotheses } from "@/lib/analysis/signals-to-hypotheses";

const SECTION = "meta_signals_v1";
const SOP_TYPE = "meta_signals";
const FETCH_DAYS = 70; // twee vensters van 28 plus marge voor sync-lag

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
  const [adRes, campRes, adNamesRes, campNamesRes, breakdownRes, accountRes] = await Promise.all([
    supabase
      .from("meta_ad_daily")
      .select("entity_id, date, impressions, link_clicks, spend, conversions, conversion_value, frequency, hook_rate, hold_rate, quality_ranking, engagement_rate_ranking, conversion_rate_ranking")
      .eq("client_id", clientId)
      .gte("date", since),
    supabase
      .from("meta_campaign_daily")
      .select("entity_id, date, impressions, frequency, spend, conversions")
      .eq("client_id", clientId)
      .gte("date", since),
    supabase.from("meta_ads").select("ad_id, name, campaign_id").eq("client_id", clientId),
    supabase.from("meta_campaigns").select("campaign_id, name").eq("client_id", clientId),
    supabase
      .from("meta_breakdown_daily")
      .select("breakdown_type, breakdown_value, date, impressions, link_clicks, spend, conversions")
      .eq("client_id", clientId)
      .gte("date", since),
    supabase
      .from("meta_account_daily")
      .select("date, spend, conversions")
      .eq("client_id", clientId)
      .gte("date", since),
  ]);

  const adRows = (adRes.data ?? []) as MetaDailyRow[];
  if (adRows.length === 0) {
    return Response.json({ error: "Geen Meta-dagdata voor deze klant; draai eerst de Meta-sync" }, { status: 404 });
  }

  const campName = new Map((campNamesRes.data ?? []).map((c) => [c.campaign_id as string, c.name as string]));
  const adNames = new Map(
    (adNamesRes.data ?? []).map((a) => [a.ad_id as string, { adName: (a.name as string) ?? (a.ad_id as string), campaignName: campName.get(a.campaign_id as string) ?? null }])
  );
  const levelNames = new Map([...campName.entries()].map(([id, name]) => [id, { adName: name }]));

  const ads = shapeMetaAdInputs(adRows, adNames);
  const levels = shapeMetaLevelInputs((campRes.data ?? []) as MetaDailyRow[], levelNames);
  // Structuur naast creative: waar landt het budget binnen plaatsing/leeftijd/device en
  // converteert dat mee (segment-waste + schaalkansen).
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const breakdownRows: MetaBreakdownRow[] = (breakdownRes.data ?? []).map((r) => ({
    breakdownType: String(r.breakdown_type ?? ""),
    breakdownValue: String(r.breakdown_value ?? ""),
    impressions: num(r.impressions),
    clicks: num(r.link_clicks),
    spend: num(r.spend),
    conversions: num(r.conversions),
  }));
  // Budget-concentratie per campagne: stapelt het budget in één (onderpresterende) campagne?
  const campTotals = new Map<string, { spend: number; conversions: number }>();
  for (const r of (campRes.data ?? []) as Record<string, unknown>[]) {
    const eid = String(r.entity_id);
    const t = campTotals.get(eid) ?? { spend: 0, conversions: 0 };
    t.spend += num(r.spend); t.conversions += num(r.conversions);
    campTotals.set(eid, t);
  }
  const budgetEntities: BudgetEntityRow[] = [...campTotals.entries()].map(([eid, t]) => ({ name: campName.get(eid) ?? eid, spend: t.spend, conversions: t.conversions }));

  // Meta demografie-/segment-drift over de tijd + spend-velocity op accountniveau.
  const asOfDate = new Date().toISOString().slice(0, 10);
  const metaDriftRows: DemographicDriftRow[] = breakdownRows.length > 0
    ? (breakdownRes.data ?? [])
        .filter((r) => r.breakdown_type && r.breakdown_value && r.date)
        .map((r) => ({ dimension: metaBreakdownTypeLabel(String(r.breakdown_type)), value: String(r.breakdown_value), date: String(r.date), leads: num(r.conversions) }))
    : [];
  const metaSpendDaily: SpendDailyRow[] = (accountRes.data ?? []).map((r) => ({ date: String(r.date), spend: num(r.spend) }));
  const metaWeekdayRows: WeekdayRow[] = (accountRes.data ?? []).map((r) => ({ date: String(r.date), spend: num(r.spend), conversions: num(r.conversions) }));

  const merged = mergeDetections([
    buildMetaCreativeSignals({ ads, levels }),
    buildMetaBreakdownSignals(breakdownRows),
    buildBudgetConcentrationSignals(budgetEntities, { channelLabel: "Meta", idPrefix: "meta_budget" }),
    buildDemographicDriftSignals(metaDriftRows, asOfDate, { outcomeLabel: "conversie", idPrefix: "meta_demographic_drift" }),
    buildSpendVelocitySignals(metaSpendDaily, { channelLabel: "Meta", idPrefix: "meta_budget" }),
    buildWeekdayEfficiencySignals(metaWeekdayRows, { channelLabel: "Meta", idPrefix: "meta_budget" }),
  ]);
  const { section, triggeredCount, checkedIds } = renderSignalSection(merged, "Meta");

  const output = section || `## Meta-signalen\n\nGeen signalen getriggerd. Gecontroleerd: ${checkedIds.join(", ")}.`;
  const analysisDate = new Date().toISOString().split("T")[0];
  const dates = adRows.map((r) => r.date).sort();

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
      step_name: "Meta-signalen",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  // Voed de goedkeuringswachtrij (vervangt alleen de eigen pending; leeg = verversen).
  await saveSignalHypotheses(supabase, merged.triggered, "meta_signals", { clientId, analysisId: null });

  return Response.json({ analysis: output, signals: triggeredCount, checked: checkedIds.length, adsAnalysed: ads.length });
}
