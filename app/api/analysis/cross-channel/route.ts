// =====================================================================
// Cross-channel-analyse: het verhaal TUSSEN de kanalen. Bedraadt twee bestaande kernen:
// (1) de cross-channel signaal-detectors (zaai-oogst, CPL-arbitrage, mix-shift) op de
// blended maandview plus de Google-brand-campagnes, en (2) de doelgroep-samenhang-check
// (lib/cross-channel/audience-coherence) op de LinkedIn-demografie tegen het gedeclareerde
// doelprofiel (client_settings.audience_profile, migratie 026). Volledig deterministisch,
// geen LLM. Ontbrekende bronnen degraderen EXPLICIET in de output; de getriggerde verhalen
// landen als voorstel in de goedkeuringswachtrij (SI8).
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { buildCrossChannelSignals, type ChannelMonthlyInput, type BrandMonthlyInput } from "@/lib/signals/cross-channel";
import { buildCrossChannelFunnelSignals } from "@/lib/signals/cross-channel-funnel";
import { buildCrossChannelKpiRelations } from "@/lib/analysis/cross-channel-kpi";
import type { KpiWindow } from "@/lib/analysis/kpi-relations";
import { renderSignalSection } from "@/lib/signals/render-section";
import { audienceContradiction, type ConvertingSegment, type TargetProfile, type AudienceDimension } from "@/lib/cross-channel/audience-coherence";
import type { ChannelKey } from "@/lib/cross-channel/lens-facts";
import type { SignalStory } from "@/lib/signals/types";
import { saveSignalHypotheses } from "@/lib/analysis/signals-to-hypotheses";
import { fetchGa4Dataset, type Ga4SupabaseLike } from "@/lib/ga4/data-access";
import { buildGa4CroSignals, buildGa4DeviceCroSignals } from "@/lib/ga4/signals";
import { mergeDetections } from "@/lib/signals/types";

const SECTION = "cross_channel_v1";
const SOP_TYPE = "cross_channel";
const MONTHS_BACK = 6;
const DEMO_DAYS = 90;
const BRAND_NAME_RE = /brand|merk/i;

const PIVOT_TO_DIMENSION: Record<string, AudienceDimension> = {
  MEMBER_JOB_FUNCTION: "job_function",
  MEMBER_SENIORITY: "seniority",
  MEMBER_INDUSTRY: "industry",
  MEMBER_COMPANY_SIZE: "company_size",
  COMPANY_SIZE: "company_size",
};

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

  const monthsAgo = new Date();
  monthsAgo.setMonth(monthsAgo.getMonth() - MONTHS_BACK);
  const sinceMonth = monthsAgo.toISOString().slice(0, 10);
  const sinceDemo = new Date(Date.now() - DEMO_DAYS * 86_400_000).toISOString().slice(0, 10);
  // De lopende kalendermaand is per definitie onvolledig en vertekent elke
  // maand-op-maand-detector; alleen volle maanden gaan de vergelijking in.
  const currentMonthStart = new Date().toISOString().slice(0, 8) + "01";

  const [blendedRes, campaignRes, demoRes, labelRes, settingsRes] = await Promise.all([
    supabase
      .from("blended_account_monthly")
      .select("month, channel, impressions, clicks, spend, conversions, leads")
      .eq("client_id", clientId)
      .gte("month", sinceMonth)
      .lt("month", currentMonthStart),
    supabase
      .from("ads_campaign_monthly")
      .select("campaign_name, month, clicks")
      .eq("client_id", clientId)
      .gte("month", sinceMonth)
      .lt("month", currentMonthStart),
    supabase
      .from("linkedin_demographic_daily")
      .select("pivot_type, pivot_value_urn, leads, conversions")
      .eq("client_id", clientId)
      .gte("date", sinceDemo),
    supabase.from("linkedin_urn_labels").select("urn, label"),
    supabase.from("client_settings").select("audience_profile").eq("client_id", clientId).maybeSingle(),
  ]);

  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const channels: ChannelMonthlyInput[] = (blendedRes.data ?? []).map((r) => ({
    channel: String(r.channel),
    month: String(r.month),
    impressions: n(r.impressions),
    clicks: n(r.clicks),
    spend: n(r.spend),
    conversions: n(r.conversions),
    leads: n(r.leads),
  }));
  if (channels.length === 0) {
    return Response.json({ error: "Geen cross-channel maanddata (blended view leeg); minstens een kanaal moet gesynct zijn" }, { status: 404 });
  }

  // Brand-reeks: Google-campagnes met brand/merk in de naam, klikken per maand gesommeerd.
  const brandByMonth = new Map<string, number>();
  for (const r of campaignRes.data ?? []) {
    if (!BRAND_NAME_RE.test(String(r.campaign_name ?? ""))) continue;
    const m = String(r.month);
    brandByMonth.set(m, (brandByMonth.get(m) ?? 0) + n(r.clicks));
  }
  const brand: BrandMonthlyInput[] = [...brandByMonth.entries()].map(([month, clicks]) => ({ month, clicks }));

  const degradations: string[] = [];
  if (brand.length === 0) degradations.push("zaai-oogst: geen Google-campagnes met 'brand'/'merk' in de naam gevonden; de merkvraag-kant is niet meetbaar");

  // ── Doelgroep-samenhang: LinkedIn-conversiesegmenten vs het gedeclareerde profiel. ──
  const audienceStories: SignalStory[] = [];
  const demoRows = demoRes.data ?? [];
  const profileCfg = (settingsRes.data?.audience_profile ?? null) as Partial<Record<ChannelKey, Partial<Record<AudienceDimension, string[]>>>> | null;

  if (demoRows.length === 0) {
    degradations.push("doelgroep-samenhang: geen LinkedIn-demografiedata; de converterende-segmenten-kant ontbreekt");
  } else if (!profileCfg || Object.keys(profileCfg).length === 0) {
    degradations.push("doelgroep-samenhang: geen doelgroep-profiel ingesteld (client_settings.audience_profile); vul het profiel om de tegenspraak-check te activeren");
  } else {
    const labels = new Map((labelRes.data ?? []).map((l) => [String(l.urn), String(l.label)]));
    // Leads per dimensie+waarde sommeren en omzetten in conversie-aandelen.
    const byDim = new Map<AudienceDimension, Map<string, number>>();
    for (const r of demoRows) {
      const dim = PIVOT_TO_DIMENSION[String(r.pivot_type)];
      if (!dim) continue;
      const urn = String(r.pivot_value_urn ?? "");
      if (!urn || urn === "TOTAL") continue;
      const value = labels.get(urn) ?? urn;
      const weight = n(r.leads) > 0 ? n(r.leads) : n(r.conversions);
      if (weight <= 0) continue;
      const m = byDim.get(dim) ?? new Map<string, number>();
      m.set(value, (m.get(value) ?? 0) + weight);
      byDim.set(dim, m);
    }
    const segments: ConvertingSegment[] = [];
    for (const [dimension, values] of byDim) {
      const total = [...values.values()].reduce((s, v) => s + v, 0);
      if (total <= 0) continue;
      for (const [value, w] of values) segments.push({ dimension, value, conversionShare: w / total });
    }
    if (segments.length === 0) {
      degradations.push("doelgroep-samenhang: LinkedIn-demografie zonder converterende segmenten; geen vergelijking mogelijk");
    } else {
      for (const [profileChannel, byDimension] of Object.entries(profileCfg) as [ChannelKey, Partial<Record<AudienceDimension, string[]>>][]) {
        if (profileChannel === "linkedin_ads") continue; // cross-check: tegen de ANDERE kanalen
        const profile: TargetProfile = { channel: profileChannel, byDimension };
        const result = audienceContradiction({ channel: "linkedin_ads", segments }, profile);
        for (const flag of result.flags) {
          audienceStories.push({
            id: `cross_audience_${flag.dimension}_${profileChannel}`,
            category: "cross_channel",
            scope: `linkedin_ads vs ${profileChannel} (${flag.dimension})`,
            story: `${flag.detail} (${result.attributionFootnote}).`,
            actionDirection: "leg de doelgroep-strategie van de kanalen naast elkaar: of het profiel is verouderd, of de targeting converteert buiten het ICP en verdient een bewuste keuze",
            certainty: "indicatie",
            evidence: [
              { metric: "aandeel buiten profiel", value: `${flag.outsideProfileSharePct}%` },
              { metric: "top-segmenten", value: flag.convertingSegments.slice(0, 3).map((s) => `${s.value} ${Math.round(s.conversionShare * 100)}%`).join("; ") },
              { metric: "profiel", value: flag.profileValues.join(", ") },
            ],
          });
        }
        for (const skipped of result.skippedDimensions) {
          degradations.push(`doelgroep-samenhang (${profileChannel}): ${skipped.dimension} overgeslagen — ${skipped.reason}`);
        }
      }
    }
  }

  // ── KPI-verhoudingen over de kanalen: per kanaal het laatste volle maandvenster vs het
  // vorige, geblend en geplafonneerd op indicatie (attributie verschilt per platform). De
  // conversie-actie is conversies + leads samen, zodat lead-gen- en sale-kanalen samentellen. ──
  const byChannel = new Map<string, ChannelMonthlyInput[]>();
  for (const c of channels) {
    const arr = byChannel.get(c.channel) ?? [];
    arr.push(c);
    byChannel.set(c.channel, arr);
  }
  const kpiRecentWindows: KpiWindow[] = [];
  const kpiPriorWindows: KpiWindow[] = [];
  let kpiRecentLabel = "recent";
  let kpiPriorLabel = "vorige";
  for (const [channel, rows] of byChannel) {
    const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
    if (sorted.length < 2) continue;
    const recent = sorted[sorted.length - 1];
    const prior = sorted[sorted.length - 2];
    kpiRecentLabel = recent.month.slice(0, 7);
    kpiPriorLabel = prior.month.slice(0, 7);
    kpiRecentWindows.push({ label: channel, impressions: recent.impressions, clicks: recent.clicks, cost: recent.spend, conversions: recent.conversions + recent.leads });
    kpiPriorWindows.push({ label: channel, impressions: prior.impressions, clicks: prior.clicks, cost: prior.spend, conversions: prior.conversions + prior.leads });
  }
  const kpiRelations = buildCrossChannelKpiRelations(kpiRecentWindows, kpiPriorWindows, { recent: kpiRecentLabel, prior: kpiPriorLabel });
  if (kpiRecentWindows.length < 2) {
    degradations.push("KPI-verhoudingen: minder dan twee kanalen met twee volle maanden; de blended CPA-decompositie/verzadiging kan niet over de mix worden gelegd");
  }

  // ── GA4 CRO-signaal: welk paid-kanaal stuurt verkeer dat op de site slechter converteert dan
  // gemiddeld (landingpage-fit)? Verklarende website-laag; leeg zonder GA4-config → degradeert
  // expliciet. De getriggerde verhalen landen net als de andere in de goedkeuringswachtrij. ──
  const ga4Cro = await (async () => {
    try {
      const dataset = await fetchGa4Dataset(clientId, { supabase: supabase as unknown as Ga4SupabaseLike });
      if (dataset.availability === "absent") {
        degradations.push(`GA4 CRO: ${dataset.limitations[0] ?? "geen GA4-data"}; de kanaal- en device-conversie-kloof op de site zijn niet meetbaar`);
        return { triggered: [] as SignalStory[], checked: ["ga4_cro_channel_gap", "ga4_cro_device_gap"] };
      }
      // Twee CRO-detectoren: kanaal-conversie-kloof en device-kloof (mobiel vs desktop).
      return mergeDetections([buildGa4CroSignals(dataset.rows), buildGa4DeviceCroSignals(dataset.rows)]);
    } catch {
      return { triggered: [] as SignalStory[], checked: ["ga4_cro_channel_gap", "ga4_cro_device_gap"] };
    }
  })();

  // ── Detectors + samenvoegen + renderen. ──
  const detected = buildCrossChannelSignals({ channels, brand });
  // Funnel over de kanalen heen: blended totaal-funnel, fase-achterblijver en divergentie.
  const funnel = buildCrossChannelFunnelSignals(channels);
  const merged = {
    triggered: [...detected.triggered, ...funnel.triggered, ...kpiRelations.triggered, ...audienceStories, ...ga4Cro.triggered],
    checked: [...detected.checked, ...funnel.checked, ...kpiRelations.checked, "cross_audience_samenhang", ...ga4Cro.checked],
  };
  const { section, triggeredCount, checkedIds } = renderSignalSection(merged, "Cross-channel");

  const lines: string[] = [];
  lines.push(section || `## Cross-channel-signalen\n\nGeen signalen getriggerd. Gecontroleerd: ${checkedIds.join(", ")}.`);
  if (degradations.length > 0) {
    lines.push("", "### Expliciet gedegradeerd (geen stil gokken)", ...degradations.map((d) => `- ${d}`));
  }
  const output = lines.join("\n");

  const analysisDate = new Date().toISOString().split("T")[0];
  const months = channels.map((c) => c.month).sort();

  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId,
      sop_type: SOP_TYPE,
      analysis_date: analysisDate,
      period_start: months[0].slice(0, 10),
      period_end: months[months.length - 1].slice(0, 10),
      section: SECTION,
      output,
      model_used: "deterministisch",
      tokens_used: 0,
      step_number: 1,
      step_name: "Cross-channel-signalen",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  await saveSignalHypotheses(supabase, merged.triggered, "cross_channel", { clientId, analysisId: null });

  return Response.json({
    analysis: output,
    signals: triggeredCount,
    checked: checkedIds.length,
    degradations,
    channelsActive: [...new Set(channels.map((c) => c.channel))],
  });
}
