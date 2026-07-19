// =====================================================================
// KPI-verhoudingen per kanaal: de acht detectors (lib/analysis/kpi-relations) die twee of
// meer KPI's tegen elkaar afzetten (CPA-decompositie, belofte-kloof, verzadiging, bereik-
// verdunning, waarde-mix, herhaling-vs-bereik, dure zichtbaarheid, vanity-engagement).
// Deterministisch, geen LLM. Vensters per kanaal: Google op de laatste twee VOLLE maanden
// (maanddata + impressie-gewogen IS), Meta/LinkedIn op twee 28-dagen-vensters uit de
// dagdata. Getriggerde verhalen landen in de wachtrij onder de kanaal-eigen bron.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { buildKpiRelations, type KpiWindow } from "@/lib/analysis/kpi-relations";
import { renderSignalSection } from "@/lib/signals/render-section";
import { splitWindows } from "@/lib/analysis/channel-signal-data";
import { saveSignalHypotheses, type SignalSource } from "@/lib/analysis/signals-to-hypotheses";

type Kanaal = "google" | "meta" | "linkedin";
const SOURCES: Record<Kanaal, SignalSource> = { google: "google_kpi", meta: "meta_kpi", linkedin: "linkedin_kpi" };
const LABELS: Record<Kanaal, string> = { google: "Google", meta: "Meta", linkedin: "LinkedIn" };

const sectionFor = (k: Kanaal) => `kpi_relations_${k}_v1`;
const sopTypeFor = (k: Kanaal) => SOURCES[k];

function parseKanaal(v: string | null): Kanaal | null {
  return v === "google" || v === "meta" || v === "linkedin" ? v : null;
}

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  const kanaal = parseKanaal(request.nextUrl.searchParams.get("channel"));
  if (!clientId || !kanaal) return Response.json({ error: "client_id en channel (google|meta|linkedin) zijn verplicht" }, { status: 400 });
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", sopTypeFor(kanaal))
    .eq("section", sectionFor(kanaal))
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

interface DayLike { date: string; [k: string]: unknown }

// Twee 28-dagen-vensters uit dagdata naar KpiWindows, met veld-mapping per kanaal.
function windowsFromDaily(
  rows: DayLike[],
  map: { clicks: string; conv: string; value?: string; engagement?: string; frequency?: boolean }
): { recent: KpiWindow; prior: KpiWindow } | null {
  const { recent, prior } = splitWindows(rows);
  if (recent.length === 0 || prior.length === 0) return null;
  const agg = (win: DayLike[], label: string): KpiWindow => {
    const w: KpiWindow = { label, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0, engagement: 0 };
    let freqW = 0; let freqSum = 0;
    for (const r of win) {
      const imp = n(r.impressions);
      w.impressions += imp;
      w.clicks += n(r[map.clicks]);
      w.cost += n(r.spend);
      w.conversions += n(r[map.conv]);
      if (map.value) w.conversionsValue = (w.conversionsValue ?? 0) + n(r[map.value]);
      if (map.engagement) w.engagement = (w.engagement ?? 0) + n(r[map.engagement]);
      if (map.frequency && r.frequency != null && imp > 0) { freqSum += n(r.frequency) * imp; freqW += imp; }
    }
    if (map.frequency) w.avgFrequency = freqW > 0 ? freqSum / freqW : null;
    if (!map.engagement) w.engagement = null;
    if (!map.value) w.conversionsValue = null;
    return w;
  };
  return { recent: agg(recent, "laatste 28 dagen"), prior: agg(prior, "de 28 dagen ervoor") };
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  let clientId = ""; let kanaal: Kanaal | null = null;
  try {
    const body = await request.json();
    clientId = String(body.client_id || "");
    kanaal = parseKanaal(String(body.channel || ""));
  } catch { /* onder afgehandeld */ }
  if (!clientId || !kanaal) return Response.json({ error: "client_id en channel (google|meta|linkedin) zijn verplicht" }, { status: 400 });

  let windows: { recent: KpiWindow; prior: KpiWindow } | null = null;

  if (kanaal === "google") {
    // Laatste twee VOLLE maanden uit de maanddata, plus impressie-gewogen impression share.
    const currentMonthStart = new Date().toISOString().slice(0, 8) + "01";
    const [monthlyRes, isRes] = await Promise.all([
      supabase
        .from("ads_account_monthly")
        .select("month, impressions, clicks, cost, conversions, conversions_value")
        .eq("client_id", clientId)
        .lt("month", currentMonthStart)
        .order("month", { ascending: false })
        .limit(2),
      supabase
        .from("ads_campaign_impression_share")
        .select("month, impressions, search_impression_share")
        .eq("client_id", clientId)
        .lt("month", currentMonthStart)
        .order("month", { ascending: false })
        .limit(400),
    ]);
    const months = monthlyRes.data ?? [];
    if (months.length < 2) return Response.json({ error: "Minimaal twee volle maanden Google-data nodig" }, { status: 404 });

    const weightedIs = (month: string): number | null => {
      const rows = (isRes.data ?? []).filter((r) => String(r.month) === month && r.search_impression_share != null);
      const w = rows.reduce((s, r) => s + n(r.impressions), 0);
      if (w <= 0) return null;
      return rows.reduce((s, r) => s + n(r.search_impression_share) * n(r.impressions), 0) / w;
    };
    const toWin = (m: Record<string, unknown>): KpiWindow => ({
      label: String(m.month).slice(0, 7),
      impressions: n(m.impressions), clicks: n(m.clicks), cost: n(m.cost), conversions: n(m.conversions),
      conversionsValue: n(m.conversions_value) > 0 ? n(m.conversions_value) : null,
      impressionShare: weightedIs(String(m.month)),
    });
    windows = { recent: toWin(months[0] as Record<string, unknown>), prior: toWin(months[1] as Record<string, unknown>) };
  } else if (kanaal === "meta") {
    const since = new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10);
    const { data } = await supabase
      .from("meta_account_daily")
      .select("date, impressions, link_clicks, spend, conversions, conversion_value, frequency, post_engagement")
      .eq("client_id", clientId)
      .gte("date", since);
    windows = windowsFromDaily((data ?? []) as DayLike[], { clicks: "link_clicks", conv: "conversions", value: "conversion_value", engagement: "post_engagement", frequency: true });
  } else {
    const since = new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10);
    const { data } = await supabase
      .from("linkedin_account_daily")
      .select("date, impressions, clicks, spend, one_click_leads, conversion_value, total_engagements")
      .eq("client_id", clientId)
      .gte("date", since);
    windows = windowsFromDaily((data ?? []) as DayLike[], { clicks: "clicks", conv: "one_click_leads", value: "conversion_value", engagement: "total_engagements" });
  }

  if (!windows) return Response.json({ error: `Onvoldoende ${LABELS[kanaal]}-data voor twee vergelijkingsvensters` }, { status: 404 });

  const merged = buildKpiRelations(windows.recent, windows.prior);
  const { section, triggeredCount, checkedIds } = renderSignalSection(merged, `KPI-verhoudingen ${LABELS[kanaal]}`);
  const output = section || `## KPI-verhoudingen ${LABELS[kanaal]}\n\nGeen opvallende verhoudingen (${windows.prior.label} → ${windows.recent.label}). Gecontroleerd: ${checkedIds.join(", ")}.`;

  const analysisDate = new Date().toISOString().slice(0, 10);
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId, sop_type: sopTypeFor(kanaal), analysis_date: analysisDate,
      period_start: analysisDate, period_end: analysisDate, section: sectionFor(kanaal),
      output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: `KPI-verhoudingen ${LABELS[kanaal]}`,
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  await saveSignalHypotheses(supabase, merged.triggered, SOURCES[kanaal], { clientId, analysisId: null });

  return Response.json({ analysis: output, signals: triggeredCount, checked: checkedIds.length, window: `${windows.prior.label} → ${windows.recent.label}` });
}
