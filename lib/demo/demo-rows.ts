// Curated Supabase-rijen voor de demo-klant "demo-greentech", geserveerd door de mock-client
// in demo-mode. Voedt de tabs die direct uit Supabase lezen: Inzichten (sop_*), Creative
// Performance / diepteanalyse (ads_creative_performance, RSA-assets), en de Meta/LinkedIn-views
// + forecasts (*_daily). Alle rijen dragen client_id = demo-greentech. Puur presentatie.

import { DEMO_GREENTECH_ID as CID } from "./greentech-mock";

type Row = Record<string, unknown>;

const dayISO = (back: number): string => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const monthStart = (back: number): string => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back); return d.toISOString().slice(0, 10); };
const iso = () => new Date().toISOString();

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
  { ad: "demo-gcr-2", grp: "GRT Generiek", camp: "GRT | Search | NL", h: "Tuinbouwtechniek van morgen", d: "Ontdek de innovaties op GreenTech.", url: "https://demo.greentech-fictief.example/bezoek", ctr0: 0.024, fade: 0.5 },
  { ad: "demo-gcr-3", grp: "GRA Search", camp: "GRA | Search | US", h: "GreenTech Americas — Mexico City", d: "The horticulture event for the Americas.", url: "https://demo.greentech-fictief.example/americas", ctr0: 0.047, fade: 0.1 },
  { ad: "demo-gcr-4", grp: "Brand", camp: "GreenTech | Brand", h: "GreenTech — Officiële website", d: "Alles over de beurs, tickets en exposanten.", url: "https://demo.greentech-fictief.example", ctr0: 0.067, fade: 0.0 },
];
const adsCreativePerformance: Row[] = CREATIVES.flatMap((c) =>
  Array.from({ length: 6 }, (_, k) => {
    const monthsBack = 5 - k; // oud → nieuw
    const impressions = 8000 + k * 500;
    const ctr = c.ctr0 * (1 - c.fade * (k / 5)); // fade over de maanden
    const clicks = Math.round(impressions * ctr);
    return {
      client_id: CID, month: monthStart(monthsBack), ad_id: c.ad, ad_group_name: c.grp, campaign_name: c.camp,
      ad_type: "RESPONSIVE_SEARCH_AD", headlines: [c.h, "Boek nu uw plek"], descriptions: [c.d], final_urls: [c.url],
      impressions, clicks, cost: Math.round(clicks * 1.9), conversions: Math.round(clicks * 0.04),
      conversions_value: Math.round(clicks * 0.04 * 120), ctr, conversion_rate: 0.04,
    };
  })
);
const rsaAssets: Row[] = CREATIVES.flatMap((c) => [
  { client_id: CID, month: monthStart(0), ad_id: c.ad, field_type: "HEADLINE", asset_text: c.h, performance_label: c.fade > 0.3 ? "LOW" : "BEST", impressions: 9000, clicks: Math.round(9000 * c.ctr0), conversions: 12, cost: 340 },
  { client_id: CID, month: monthStart(0), ad_id: c.ad, field_type: "DESCRIPTION", asset_text: c.d, performance_label: "GOOD", impressions: 9000, clicks: Math.round(9000 * c.ctr0 * 0.9), conversions: 10, cost: 300 },
]);

// ── Meta + LinkedIn: entiteiten + dagseries (voor views, fatigue en forecast) ──
const META_ADS = [
  { id: "demo-m-hero", name: "Awareness EU — hero video", creative: "demo-mc-hero" },
  { id: "demo-m-life", name: "Awareness EU — lifestyle", creative: "demo-mc-life" },
  { id: "demo-m-banner", name: "Retargeting — banner", creative: "demo-mc-banner" },
];
const metaAds: Row[] = META_ADS.map((a) => ({ client_id: CID, ad_id: a.id, name: a.name, creative_id: a.creative }));
const metaCreatives: Row[] = [
  { client_id: CID, creative_id: "demo-mc-hero", title: "GreenTech in 30 seconden", body: "Beleef de sfeer van de beurs.", thumbnail_url: "https://picsum.photos/seed/greentech-hero/320/200", format: "video", call_to_action_type: "LEARN_MORE", link_url: "https://demo.greentech-fictief.example" },
  { client_id: CID, creative_id: "demo-mc-life", title: "Innovatie in de kas", body: "Lifestyle-beeld met een teler.", thumbnail_url: "https://picsum.photos/seed/greentech-life/320/200", format: "single_image", call_to_action_type: "SIGN_UP", link_url: "https://demo.greentech-fictief.example/bezoek" },
  { client_id: CID, creative_id: "demo-mc-banner", title: "Boek uw stand", body: "Statische banner met CTA.", thumbnail_url: "https://picsum.photos/seed/greentech-banner/320/200", format: "single_image", call_to_action_type: "BOOK_TRAVEL", link_url: "https://demo.greentech-fictief.example/beurs" },
];
const metaAdDaily: Row[] = META_ADS.flatMap((a, idx) =>
  Array.from({ length: 150 }, (_, d) => ({ client_id: CID, entity_id: a.id, date: dayISO(149 - d), impressions: 900 + idx * 200, link_clicks: 18 + idx * 3, spend: 40 + idx * 8, conversions: 2 + idx }))
);
const metaAccountDaily: Row[] = Array.from({ length: 150 }, (_, d) => ({ client_id: CID, date: dayISO(149 - d), spend: 180 + Math.round(30 * Math.sin(d / 12)), conversions: 9 + (d % 4) }));

const LI_CAMPAIGNS = [{ urn: "urn:li:demo:1", name: "GRT | Leadgen NL" }, { urn: "urn:li:demo:2", name: "GRT | Thought Leadership" }];
const linkedinCampaigns: Row[] = LI_CAMPAIGNS.map((c) => ({ client_id: CID, campaign_urn: c.urn, name: c.name, status: "ACTIVE", objective_type: "LEAD_GENERATION" }));
const linkedinCreatives: Row[] = [
  { client_id: CID, creative_urn: "urn:li:demo:cr1", headline: "Ontmoet de tuinbouwsector op GreenTech", post_text: "Registreer uw team voor de vakbeurs.", image_storage_path: "https://picsum.photos/seed/li-greentech-1/320/200", cta_label: "Registreren", landing_url: "https://demo.greentech-fictief.example/li", format: "single_image" },
  { client_id: CID, creative_urn: "urn:li:demo:cr2", headline: "Whitepaper: kas-innovatie 2026", post_text: "Download de trendgids.", image_storage_path: "https://picsum.photos/seed/li-greentech-2/320/200", cta_label: "Download", landing_url: "https://demo.greentech-fictief.example/li-wp", format: "single_image" },
];
const linkedinCreativeDaily: Row[] = linkedinCreatives.flatMap((c, idx) =>
  Array.from({ length: 150 }, (_, d) => ({ client_id: CID, entity_urn: c.creative_urn, date: dayISO(149 - d), impressions: 500 + idx * 150, clicks: 9 + idx * 2, spend: 30 + idx * 6, external_website_conversions: 1, one_click_leads: 2 + idx }))
);
const linkedinAccountDaily: Row[] = Array.from({ length: 150 }, (_, d) => ({ client_id: CID, date: dayISO(149 - d), spend: 70 + Math.round(15 * Math.sin(d / 10)), one_click_leads: 3 + (d % 3) }));

const clientNotes: Row[] = [
  { id: "demo-note-1", client_id: CID, title: "Beursweek", content: "Piek verwacht rond de beursweek — budgetten tijdig ophogen.", created_at: iso(), updated_at: iso() },
];
const clientSyncStatus: Row[] = [
  { client_id: CID, channel: "google_ads", status: "ok", last_sync_at: iso(), rows_synced: 1240 },
];

// De volledige map; tabellen die hier niet in staan → passthrough naar de echte client.
export function demoRows(): Record<string, Row[]> {
  return {
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
