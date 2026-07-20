// Curated Supabase-rijen voor de demo-klant "demo-greentech", geserveerd door de mock-client
// in demo-mode. Voedt de tabs die direct uit Supabase lezen: Overzicht-aggregaties per beurs
// (ads_campaign_monthly), Inzichten (sop_*), Creative Performance / diepteanalyse
// (ads_creative_performance, RSA-assets), en de Meta/LinkedIn-views + forecasts (*_daily).
//
// Bewust REALISTISCH: maandreeksen dragen groei + seizoen + lichte ruis (deterministisch, dus
// stabiel), échte conversiewaardes, en de dagseries variëren per dag (trend + weekdag + ruis).
// Geen platte, identieke maanden meer. Alle rijen: client_id = demo-greentech. Puur presentatie.

import { DEMO_GREENTECH_ID as CID } from "./greentech-mock";

type Row = Record<string, unknown>;

const dayISO = (back: number): string => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const monthISO = (back: number): string => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back); return d.toISOString().slice(0, 10); };
const iso = () => new Date().toISOString();

// Deterministische maand-factor: groei (2%/mnd) × voorjaarsseizoen × lichte, per-reeks-unieke ruis.
function monthFactor(idxOldToNew: number, seed: number): number {
  const season = 1 + 0.22 * Math.sin(((idxOldToNew - 2) / 12) * 2 * Math.PI);
  const growth = Math.pow(1.02, idxOldToNew);
  const wobble = 1 + 0.06 * Math.sin(idxOldToNew * 1.7 + seed);
  return season * growth * wobble;
}
// Deterministische dag-factor: langzame trend × weekdag-dip in het weekend × lichte ruis.
function dayFactor(d: number, seed: number): number {
  const trend = 1 + 0.0012 * (150 - d);
  const weekday = new Date(Date.now() - d * 86_400_000).getDay();
  const weekend = weekday === 0 || weekday === 6 ? 0.72 : 1;
  const noise = 1 + 0.12 * Math.sin(d * 0.9 + seed);
  return trend * weekend * noise;
}

const N_MONTHS = 13;

// ── ads_campaign_monthly: per campagne × 13 maanden (voedt o.a. het beurs/geo-clone-overzicht) ──
const CAMPAIGNS = [
  { id: "demo-c-grt", name: "GRT | Search | NL", imp: 42000, clk: 2100, cost: 4200, conv: 60, aov: 130, seed: 0 },
  { id: "demo-c-gra", name: "GRA | Search | US", imp: 30000, clk: 1400, cost: 3000, conv: 42, aov: 110, seed: 1 },
  { id: "demo-c-grn", name: "GRN | Search | Canada", imp: 18000, clk: 900, cost: 1900, conv: 24, aov: 125, seed: 2 },
  { id: "demo-c-grn2", name: "GRN | Display | Canada", imp: 52000, clk: 620, cost: 850, conv: 8, aov: 125, seed: 5 },
  { id: "demo-c-brand", name: "GreenTech | Brand", imp: 15000, clk: 1000, cost: 500, conv: 55, aov: 90, seed: 3 },
];
const adsCampaignMonthly: Row[] = CAMPAIGNS.flatMap((c) =>
  Array.from({ length: N_MONTHS }, (_, i) => {
    const f = monthFactor(i, c.seed);
    const impressions = Math.round(c.imp * f);
    const clicks = Math.round(c.clk * f);
    const cost = Math.round(c.cost * f);
    const conversions = Math.round(c.conv * f);
    const conversionsValue = Math.round(conversions * c.aov);
    return {
      client_id: CID, campaign_id: c.id, campaign_name: c.name, month: monthISO(N_MONTHS - 1 - i),
      impressions, clicks, cost, conversions, conversions_value: conversionsValue,
      ctr: impressions > 0 ? clicks / impressions : 0, avg_cpc: clicks > 0 ? cost / clicks : 0,
      conversion_rate: clicks > 0 ? conversions / clicks : 0, cost_per_conversion: conversions > 0 ? cost / conversions : 0,
      roas: cost > 0 ? conversionsValue / cost : 0,
    };
  })
);
// ads_account_monthly: maandtotalen over alle campagnes.
const adsAccountMonthly: Row[] = Array.from({ length: N_MONTHS }, (_, i) => {
  const month = monthISO(N_MONTHS - 1 - i);
  const inMonth = adsCampaignMonthly.filter((r) => r.month === month);
  const sum = (k: string) => inMonth.reduce((s, r) => s + (r[k] as number), 0);
  const cost = sum("cost"), conversions = sum("conversions"), conversionsValue = sum("conversions_value"), clicks = sum("clicks"), impressions = sum("impressions");
  return { client_id: CID, month, impressions, clicks, cost, conversions, conversions_value: conversionsValue,
    ctr: impressions > 0 ? clicks / impressions : 0, conversion_rate: clicks > 0 ? conversions / clicks : 0,
    cost_per_conversion: conversions > 0 ? cost / conversions : 0, roas: cost > 0 ? conversionsValue / cost : 0 };
});
const adsCampaignImpressionShare: Row[] = [
  { client_id: CID, campaign_id: "demo-c-grt", campaign_name: "GRT | Search | NL", campaign_type: "SEARCH", month: monthISO(0), cost: 4200, conversions: 60, search_impression_share: 0.55, search_budget_lost_is: 0.28, search_rank_lost_is: 0.05, daily_budget: 140, budget_utilization: 0.97 },
  { client_id: CID, campaign_id: "demo-c-grn", campaign_name: "GRN | Search | Canada", campaign_type: "SEARCH", month: monthISO(0), cost: 1900, conversions: 24, search_impression_share: 0.48, search_budget_lost_is: 0.31, search_rank_lost_is: 0.08, daily_budget: 90, budget_utilization: 0.95 },
  { client_id: CID, campaign_id: "demo-c-brand", campaign_name: "GreenTech | Brand", campaign_type: "SEARCH", month: monthISO(0), cost: 500, conversions: 55, search_impression_share: 0.93, search_budget_lost_is: 0.01, search_rank_lost_is: 0.03, daily_budget: 20, budget_utilization: 0.8 },
];

// ── Inzichten: sop_* + sprint_hypotheses ──
const sopInsights: Row[] = [
  { id: "demo-i1", client_id: CID, sop_type: "analysis", analysis_date: dayISO(2), insight_type: "risk", title: "GRA | US — CVR gedaald", description: "GRA | Search | US — conversieratio 1,4% (was 2,1%). Oorzaak: bredere zoektermen na budgetverhoging.", severity: "high", affected_entity: "GRA | Search | US", affected_entity_type: "campaign", metric: "conversion_rate", current_value: 0.014, previous_value: 0.021, change_pct: -33, action_required: true, created_at: iso() },
  { id: "demo-i2", client_id: CID, sop_type: "analysis", analysis_date: dayISO(2), insight_type: "opportunity", title: "Brand — budgetcap", description: "GreenTech | Brand haalt target ruim en verliest 1% IS op budget; ruimte om op te schalen.", severity: "medium", affected_entity: "GreenTech | Brand", affected_entity_type: "campaign", metric: "search_impression_share", current_value: 0.93, previous_value: 0.9, change_pct: 3, action_required: true, created_at: iso() },
  { id: "demo-i3", client_id: CID, sop_type: "meta_signals", analysis_date: dayISO(3), insight_type: "trend", title: "Meta — creative fatigue", description: "Awareness EU: 3 creatives onder hun CTR-piek (−38%).", severity: "medium", affected_entity: "GRT | Awareness EU", affected_entity_type: "creative", metric: "ctr", current_value: 0.008, previous_value: 0.013, change_pct: -38, action_required: false, created_at: iso() },
  { id: "demo-i4", client_id: CID, sop_type: "linkedin_signals", analysis_date: dayISO(4), insight_type: "risk", title: "LinkedIn — lead-form drop", description: "Form-open → lead −24% over de recente 4 weken.", severity: "medium", affected_entity: "GRT | Leadgen NL", affected_entity_type: "campaign", metric: "lead_rate", current_value: 0.18, previous_value: 0.24, change_pct: -24, action_required: true, created_at: iso() },
];
const sopRecommendations: Row[] = [
  { id: "demo-r1", client_id: CID, insight_id: "demo-i1", sop_type: "analysis", analysis_date: dayISO(2), hypothesis: "Voeg negatieve zoektermen toe op GRA | US", expected_result: "CVR terug naar ~2%", measurement_metric: "conversion_rate", timeframe: "2 weken", rationale: "Brede termen na budgetverhoging verdunnen de kwaliteit.", ice_impact: 8, ice_confidence: 7, ice_ease: 8, ice_total: 74, status: "open" },
  { id: "demo-r2", client_id: CID, insight_id: "demo-i2", sop_type: "analysis", analysis_date: dayISO(2), hypothesis: "Verhoog dagbudget GreenTech | Brand met 25%", expected_result: "+18 conversies/mnd", measurement_metric: "conversions", timeframe: "1 maand", rationale: "Target ruim gehaald, verliest volume op budget.", ice_impact: 7, ice_confidence: 8, ice_ease: 9, ice_total: 78, status: "open" },
];
const sprintHypotheses: Row[] = [
  { id: "demo-h1", client_id: CID, source: "meta_signals", hypothesis: "Ververs de 3 vermoeide Meta-creatives", expected_result: "CTR terug richting piek (+30%)", measurement_metric: "ctr", timeframe: "2 weken", rationale: "Creative fatigue gedetecteerd (−38%).", ice_impact: 6, ice_confidence: 6, ice_ease: 7, ice_total: 61, status: "pending", created_at: iso() },
  { id: "demo-h2", client_id: CID, source: "linkedin_signals", hypothesis: "Verkort het lead-gen-formulier (LinkedIn)", expected_result: "Meer form-completions", measurement_metric: "one_click_leads", timeframe: "3 weken", rationale: "Form-open → lead −24%.", ice_impact: 7, ice_confidence: 5, ice_ease: 6, ice_total: 58, status: "pending", created_at: iso() },
];
const sopTasks: Row[] = [
  { id: "demo-t1", client_id: CID, title: "Negatieve zoektermen toevoegen GRA | US", description: "Voeg brede-match-vervuilers toe als negative.", action_type: "negative_keywords", priority: "high", due_date: dayISO(-1), status: "open", frequency: "direct", affected_campaign: "GRA | Search | US" },
  { id: "demo-t2", client_id: CID, title: "Dagbudget Brand +25%", description: "Verhoog het budget en monitor IS.", action_type: "budget", priority: "medium", due_date: dayISO(-3), status: "open", frequency: "direct", affected_campaign: "GreenTech | Brand" },
  { id: "demo-t3", client_id: CID, title: "Nieuwe Meta-creatives briefen", description: "Brief 3 nieuwe varianten voor Awareness EU.", action_type: "creative", priority: "medium", due_date: dayISO(4), status: "open", frequency: "direct", affected_campaign: "GRT | Awareness EU" },
];

// ── Creative: ads_creative_performance (6 mnd per ad, één fatiguet) + RSA-assets ──
const CREATIVES = [
  { ad: "demo-gcr-1", grp: "GRT Generiek", camp: "GRT | Search | NL", h: "GreenTech Amsterdam 2026 — Boek uw stand", d: "Ontmoet 12.000 tuinbouwprofessionals.", url: "https://demo.greentech-fictief.example/beurs", ctr0: 0.052, fade: 0.0 },
  { ad: "demo-gcr-2", grp: "GRT Generiek", camp: "GRT | Search | NL", h: "Tuinbouwtechniek van morgen", d: "Ontdek de innovaties op GreenTech.", url: "https://demo.greentech-fictief.example/bezoek", ctr0: 0.030, fade: 0.5 },
  { ad: "demo-gcr-3", grp: "GRA Search", camp: "GRA | Search | US", h: "GreenTech Americas — Mexico City", d: "The horticulture event for the Americas.", url: "https://demo.greentech-fictief.example/americas", ctr0: 0.047, fade: 0.1 },
  { ad: "demo-gcr-4", grp: "Brand", camp: "GreenTech | Brand", h: "GreenTech — Officiële website", d: "Alles over de beurs, tickets en exposanten.", url: "https://demo.greentech-fictief.example", ctr0: 0.067, fade: 0.0 },
];
const adsCreativePerformance: Row[] = CREATIVES.flatMap((c) =>
  Array.from({ length: 6 }, (_, k) => {
    const f = monthFactor(k + 6, c.ad.charCodeAt(9) % 5);
    const impressions = Math.round((8000 + k * 600) * (0.9 + 0.1 * Math.sin(k)));
    const ctr = c.ctr0 * (1 - c.fade * (k / 5));
    const clicks = Math.round(impressions * ctr);
    const conversions = Math.round(clicks * 0.045 * (f / monthFactor(6, 0)));
    return {
      client_id: CID, month: monthISO(5 - k), ad_id: c.ad, ad_group_name: c.grp, campaign_name: c.camp,
      ad_type: "RESPONSIVE_SEARCH_AD", headlines: [c.h, "Boek nu uw plek"], descriptions: [c.d], final_urls: [c.url],
      impressions, clicks, cost: Math.round(clicks * 1.9), conversions,
      conversions_value: Math.round(conversions * 120), ctr, conversion_rate: clicks > 0 ? conversions / clicks : 0,
    };
  })
);
const rsaAssets: Row[] = CREATIVES.flatMap((c) => [
  { client_id: CID, month: monthISO(0), ad_id: c.ad, field_type: "HEADLINE", asset_text: c.h, performance_label: c.fade > 0.3 ? "LOW" : "BEST", impressions: 9000, clicks: Math.round(9000 * c.ctr0), conversions: 12, cost: 340 },
  { client_id: CID, month: monthISO(0), ad_id: c.ad, field_type: "DESCRIPTION", asset_text: c.d, performance_label: "GOOD", impressions: 9000, clicks: Math.round(9000 * c.ctr0 * 0.9), conversions: 10, cost: 300 },
]);

// ── Meta + LinkedIn: entiteiten + dagseries (voor views, fatigue en forecast) ──
const META_ADS = [
  { id: "demo-m-hero", name: "Awareness EU — hero video", creative: "demo-mc-hero", imp: 1100, clk: 22, spend: 55, conv: 3, seed: 0 },
  { id: "demo-m-life", name: "Awareness EU — lifestyle", creative: "demo-mc-life", imp: 1400, clk: 26, spend: 62, conv: 4, seed: 2 },
  { id: "demo-m-banner", name: "Retargeting — banner", creative: "demo-mc-banner", imp: 800, clk: 30, spend: 44, conv: 6, seed: 4 },
];
const metaAds: Row[] = META_ADS.map((a) => ({ client_id: CID, ad_id: a.id, name: a.name, creative_id: a.creative }));
const metaCreatives: Row[] = [
  { client_id: CID, creative_id: "demo-mc-hero", title: "GreenTech in 30 seconden", body: "Beleef de sfeer van de beurs.", thumbnail_url: "https://picsum.photos/seed/greentech-hero/320/200", format: "video", call_to_action_type: "LEARN_MORE", link_url: "https://demo.greentech-fictief.example" },
  { client_id: CID, creative_id: "demo-mc-life", title: "Innovatie in de kas", body: "Lifestyle-beeld met een teler.", thumbnail_url: "https://picsum.photos/seed/greentech-life/320/200", format: "single_image", call_to_action_type: "SIGN_UP", link_url: "https://demo.greentech-fictief.example/bezoek" },
  { client_id: CID, creative_id: "demo-mc-banner", title: "Boek uw stand", body: "Statische banner met CTA.", thumbnail_url: "https://picsum.photos/seed/greentech-banner/320/200", format: "single_image", call_to_action_type: "BOOK_TRAVEL", link_url: "https://demo.greentech-fictief.example/beurs" },
];
const metaAdDaily: Row[] = META_ADS.flatMap((a) =>
  Array.from({ length: 150 }, (_, d) => {
    const f = dayFactor(149 - d, a.seed);
    return { client_id: CID, entity_id: a.id, date: dayISO(149 - d), impressions: Math.round(a.imp * f), link_clicks: Math.round(a.clk * f), spend: Math.round(a.spend * f), conversions: Math.max(0, Math.round(a.conv * f)) };
  })
);
const metaAccountDaily: Row[] = Array.from({ length: 150 }, (_, d) => {
  const day = 149 - d;
  const inDay = METesum(day);
  return { client_id: CID, date: dayISO(day), spend: inDay.spend, conversions: inDay.conv };
});
function METesum(day: number) {
  return META_ADS.reduce((s, a) => { const f = dayFactor(day, a.seed); s.spend += Math.round(a.spend * f); s.conv += Math.max(0, Math.round(a.conv * f)); return s; }, { spend: 0, conv: 0 });
}

const LI_CAMPAIGNS = [{ urn: "urn:li:demo:1", name: "GRT | Leadgen NL" }, { urn: "urn:li:demo:2", name: "GRT | Thought Leadership" }];
const linkedinCampaigns: Row[] = LI_CAMPAIGNS.map((c) => ({ client_id: CID, campaign_urn: c.urn, name: c.name, status: "ACTIVE", objective_type: "LEAD_GENERATION" }));
const linkedinCreatives: Row[] = [
  { client_id: CID, creative_urn: "urn:li:demo:cr1", headline: "Ontmoet de tuinbouwsector op GreenTech", post_text: "Registreer uw team voor de vakbeurs.", image_storage_path: "https://picsum.photos/seed/li-greentech-1/320/200", cta_label: "Registreren", landing_url: "https://demo.greentech-fictief.example/li", format: "single_image" },
  { client_id: CID, creative_urn: "urn:li:demo:cr2", headline: "Whitepaper: kas-innovatie 2026", post_text: "Download de trendgids.", image_storage_path: "https://picsum.photos/seed/li-greentech-2/320/200", cta_label: "Download", landing_url: "https://demo.greentech-fictief.example/li-wp", format: "single_image" },
];
const LI_META = [{ urn: "urn:li:demo:cr1", imp: 620, clk: 11, spend: 34, leads: 3, seed: 1 }, { urn: "urn:li:demo:cr2", imp: 780, clk: 14, spend: 40, leads: 4, seed: 3 }];
const linkedinCreativeDaily: Row[] = LI_META.flatMap((c) =>
  Array.from({ length: 150 }, (_, d) => {
    const f = dayFactor(149 - d, c.seed);
    return { client_id: CID, entity_urn: c.urn, date: dayISO(149 - d), impressions: Math.round(c.imp * f), clicks: Math.round(c.clk * f), spend: Math.round(c.spend * f), external_website_conversions: Math.round(f), one_click_leads: Math.max(0, Math.round(c.leads * f)) };
  })
);
const linkedinAccountDaily: Row[] = Array.from({ length: 150 }, (_, d) => {
  const day = 149 - d;
  const agg = LI_META.reduce((s, c) => { const f = dayFactor(day, c.seed); s.spend += Math.round(c.spend * f); s.leads += Math.max(0, Math.round(c.leads * f)); return s; }, { spend: 0, leads: 0 });
  return { client_id: CID, date: dayISO(day), spend: agg.spend, one_click_leads: agg.leads };
});

const clientNotes: Row[] = [
  { id: "demo-note-1", client_id: CID, title: "Beursweek", content: "Piek verwacht rond de beursweek — budgetten tijdig ophogen.", created_at: iso(), updated_at: iso() },
];
const clientSyncStatus: Row[] = [{ client_id: CID, channel: "google_ads", status: "ok", last_sync_at: iso(), rows_synced: 1240 }];

// De volledige map; tabellen die hier niet in staan → passthrough naar de echte client.
export function demoRows(): Record<string, Row[]> {
  return {
    ads_campaign_monthly: adsCampaignMonthly,
    ads_account_monthly: adsAccountMonthly,
    ads_campaign_impression_share: adsCampaignImpressionShare,
    sop_insights: sopInsights,
    sop_recommendations: sopRecommendations,
    sprint_hypotheses: sprintHypotheses,
    sop_tasks: sopTasks,
    task_completions: [],
    ads_creative_performance: adsCreativePerformance,
    google_ads_rsa_assets: rsaAssets,
    google_ads_ad_meta: [],
    meta_ads: metaAds,
    meta_creatives: metaCreatives,
    meta_ad_daily: metaAdDaily,
    meta_account_daily: metaAccountDaily,
    linkedin_campaigns: linkedinCampaigns,
    linkedin_creatives: linkedinCreatives,
    linkedin_creative_daily: linkedinCreativeDaily,
    linkedin_account_daily: linkedinAccountDaily,
    client_notes: clientNotes,
    client_sync_status: clientSyncStatus,
  };
}
