// ============================================================================
// DEMO-KLANT SEED — "demo-greentech" (volledig fictief, gequarantaineerd)
// ----------------------------------------------------------------------------
// Doel: alle analyses end-to-end testbaar maken (Google, Meta, LinkedIn, cross-channel,
// geo-clones/beursanalyse) zonder echte klanten te vervuilen. Alles hangt aan EEN client_id
// (demo-greentech) en is met scripts/demo/teardown-demo-client.ts in een keer te verwijderen.
//
// De data is deterministisch (geen randomness) en per detector ONTWORPEN:
//   [S1]  Meta creative fatigue      — "Hero Video A": CTR -42% bij frequency 4.2
//   [S2]  Meta frequency-saturatie   — campagne Awareness op frequency 4.6
//   [S3]  Meta ranking-zwakte        — "Static Banner C": BELOW_AVERAGE quality ranking
//   [S4]  Meta hook-zwakte           — "Product Carousel D": hook-rate ver onder de mediaan
//   [S5]  LinkedIn form drop-off     — GRT ABM: 10% completion op 60+ opens
//   [S6]  LinkedIn CPL-druk          — GRT ABM: CPL +25% recent vs prior venster
//   [S7]  Zaai-oogst (cross)         — social-vertoningen juni +40%, brand-klikken +18%
//   [S8]  Mix-shift/Simpson (cross)  — LinkedIn-spend juni x3 (eigen CPA stabiel) => blended CPA stijgt
//   [S9]  Doelgroep-tegenspraak      — LinkedIn-leads 75% uit "Education", buiten het Google-ICP
//   [S10] Beursanalyse GRT           — aanloop 2026 ~35% achter op 2025 bij gelijke spend (effectiviteitsvraag)
//   [S11] Beursanalyse GRA           — op koers (+10%) => geen actie
//   [S12] GRN eerste editie          — degradatiepad "eerste editie" zichtbaar
//   [S13] Impression share           — GRT budget-gelimiteerd, GRA rang-gelimiteerd
//   stil: "GreenTech | Brand" gezond => detectors horen daar te zwijgen
//
// Draaien:
//   npx tsx scripts/demo/seed-demo-client.ts            # insert via supabase-js (env nodig)
//   npx tsx scripts/demo/seed-demo-client.ts --sql      # print SQL (voor de Management API)
//   npx tsx scripts/demo/seed-demo-client.ts --check    # bewijs: draai de detectors op de data
// ============================================================================

import { createClient } from "@supabase/supabase-js";

export const DEMO_CLIENT = "demo-greentech";
const DEMO_NAME = "DEMO — GreenTech (fictief)";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (base: string, days: number) => { const d = new Date(base); d.setDate(d.getDate() + days); return iso(d); };

// Ankerdatum: "vandaag" voor de gegenereerde reeksen. Bewust vast, zodat de scenario's
// stabiel blijven; ruim binnen de 70-dagen-vensters van de signaal-routes.
const TODAY = new Date().toISOString().slice(0, 10);
const monthsBack = (n: number) => { const d = new Date(TODAY); d.setDate(1); d.setMonth(d.getMonth() - n); return iso(d); };

// ── Google: maanddata per campagne met event-cycli ─────────────────────────
// GRT-edities: vorig jaar juni en dit jaar juni (jaarlijks). De 2026-aanloop ligt bewust
// ~35% achter op 2025 bij vrijwel gelijke spend [S10].
interface GMonth { campaign: string; monthIdx: number; imp: number; clicks: number; cost: number; conv: number; value: number }

// maandIdx 0 = huidige maand, 1 = vorige, ... 23 = 2 jaar terug.
function googleMonthly(): GMonth[] {
  const rows: GMonth[] = [];
  // Eventcyclus-vorm: aanloop piekt richting de beursmaand (juni voor GRT, sept voor GRA).
  const grtCycle = (mIdx: number, factor: number) => {
    const month = new Date(monthsBack(mIdx)).getMonth() + 1; // 1..12
    const dist = Math.min(Math.abs(month - 6), 12 - Math.abs(month - 6)); // afstand tot juni
    const ramp = dist <= 5 ? (6 - dist) / 6 : 0.15;
    return Math.round(factor * (0.25 + ramp));
  };
  for (let m = 23; m >= 0; m--) {
    const thisYear = m < 12; // jongste 12 maanden = het "achterliggende" jaar [S10]
    const grtConvFactor = thisYear ? 26 : 40; // 2026-aanloop ~35% lager dan 2025
    rows.push({ campaign: "GRT | Search | NL", monthIdx: m, imp: 42000, clicks: 2100, cost: 4150 + (m % 3) * 50, conv: grtCycle(m, grtConvFactor), value: 0 });
    rows.push({ campaign: "GRT | Performance Max", monthIdx: m, imp: 61000, clicks: 1500, cost: 2600, conv: grtCycle(m, thisYear ? 12 : 18), value: 0 });
    // GRA: beurs in september, beide jaren op koers (+10% dit jaar) [S11]
    const graMonth = new Date(monthsBack(m)).getMonth() + 1;
    const graDist = Math.min(Math.abs(graMonth - 9), 12 - Math.abs(graMonth - 9));
    const graRamp = graDist <= 5 ? (6 - graDist) / 6 : 0.15;
    rows.push({ campaign: "GRA | Search | US", monthIdx: m, imp: 30000, clicks: 1400, cost: 3000, conv: Math.round((thisYear ? 33 : 30) * (0.25 + graRamp)), value: 0 });
    // GRN: dunne, jonge reeks (alleen laatste 8 maanden) [S12]
    if (m < 8) rows.push({ campaign: "GRN | Search | NA", monthIdx: m, imp: 9000, clicks: 380, cost: 900, conv: 8, value: 0 });
    // Brand: stabiel, +18% klikken in de golf-maanden (oogst van de social-golf) [S7].
    // m<=1: de laatste volle maand en de lopende maand (detectors sluiten de lopende uit).
    const brandClicks = m <= 1 ? 1180 : 1000;
    rows.push({ campaign: "GreenTech | Brand", monthIdx: m, imp: 15000, clicks: brandClicks, cost: 500, conv: 45, value: 0 });
    rows.push({ campaign: "GreenTech | Display | Prospecting", monthIdx: m, imp: 90000, clicks: 700, cost: 800, conv: 2, value: 0 });
  }
  return rows;
}

// ── Meta: dag-data met de creative-scenario's [S1-S4, S7, S8] ─────────────
interface MetaDaily { entity: string; date: string; imp: number; linkClicks: number; spend: number; conv: number; freq: number | null; hook: number | null; hold: number | null; qr?: string | null; er?: string | null; cr?: string | null; lpv?: number; atc?: number; ic?: number }

const META_ADS = [
  { id: "demo-ad-hero-a", name: "Hero Video A", campaign: "demo-mc-awareness" },
  { id: "demo-ad-lifestyle-b", name: "Lifestyle Video B", campaign: "demo-mc-awareness" },
  { id: "demo-ad-banner-c", name: "Static Banner C", campaign: "demo-mc-retargeting" },
  { id: "demo-ad-carousel-d", name: "Product Carousel D", campaign: "demo-mc-retargeting" },
];
const META_CAMPAIGNS = [
  { id: "demo-mc-awareness", name: "GreenTech Awareness EU" },
  { id: "demo-mc-retargeting", name: "GreenTech Retargeting" },
];

function metaAdDaily(): MetaDaily[] {
  const rows: MetaDaily[] = [];
  for (let d = 63; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const recent = d < 28; // recent venster vs prior venster
    // [S1] Hero A: CTR zakt van 1.2% naar 0.7% terwijl frequency op 4.2 staat; blijft converteren.
    rows.push({ entity: "demo-ad-hero-a", date, imp: 1600, linkClicks: recent ? 11 : 19, spend: 55, conv: 2, freq: recent ? 4.2 : 3.1, hook: 0.42, hold: 0.3 });
    // Lifestyle B: gezond en stabiel (moet stil blijven).
    rows.push({ entity: "demo-ad-lifestyle-b", date, imp: 1400, linkClicks: 17, spend: 45, conv: 2, freq: 2.2, hook: 0.5, hold: 0.35 });
    // [S3] Banner C: recent BELOW_AVERAGE quality ranking.
    rows.push({ entity: "demo-ad-banner-c", date, imp: 900, linkClicks: 8, spend: 25, conv: 1, freq: 2.6, hook: 0.44, hold: 0.3, qr: recent ? "BELOW_AVERAGE_10" : "AVERAGE", er: "AVERAGE", cr: "AVERAGE" });
    // [S4] Carousel D: hook-rate ver onder de account-mediaan.
    rows.push({ entity: "demo-ad-carousel-d", date, imp: 1100, linkClicks: 10, spend: 30, conv: 1, freq: 2.4, hook: 0.12, hold: 0.1 });
  }
  return rows;
}

function metaCampaignDaily(): MetaDaily[] {
  const rows: MetaDaily[] = [];
  for (let d = 63; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const recent = d < 28;
    // [S2] Awareness-campagne zit recent op frequency 4.6.
    rows.push({ entity: "demo-mc-awareness", date, imp: 3000, linkClicks: 28, spend: 100, conv: 4, freq: recent ? 4.6 : 3.0, hook: null, hold: null });
    rows.push({ entity: "demo-mc-retargeting", date, imp: 2000, linkClicks: 18, spend: 55, conv: 2, freq: 2.5, hook: null, hold: null });
  }
  return rows;
}

// Account-dagniveau voedt de blended view. 160 dagen => 4+ VOLLE maanden. De boosts zijn
// op kalendermaand uitgelijnd (de detectors sluiten de lopende, halve maand uit): de golf
// [S7] zit in de laatste volle maand en loopt door in de lopende maand.
const CUR_MONTH = TODAY.slice(0, 7);
const PREV_FULL_MONTH = monthsBack(1).slice(0, 7);
const isSurgeMonth = (date: string) => { const m = date.slice(0, 7); return m === CUR_MONTH || m === PREV_FULL_MONTH; };

function metaAccountDaily(): MetaDaily[] {
  const rows: MetaDaily[] = [];
  for (let d = 159; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const surge = isSurgeMonth(date);
    // Funnel-fasen: landing->winkelwagen zakt in de laatste 28 dagen van 20% naar 12%
    // (materiele drop-off voor de losse funnel-analyse), de rest blijft stabiel.
    const recent28 = d < 28;
    rows.push({ entity: "demo-meta-account", date, imp: surge ? 7000 : 5000, linkClicks: surge ? 63 : 45, spend: 150, conv: 6, freq: null, hook: null, hold: null, lpv: 30, atc: recent28 ? 3.6 : 6, ic: recent28 ? 2.4 : 4 });
  }
  return rows;
}

// ── LinkedIn: dag-data [S5, S6, S7, S8, S9] ────────────────────────────────
interface LiDaily { urn: string; date: string; imp: number; clicks: number; spend: number; leads: number; opens: number; conv: number; vidStart: number; vidDone: number }

const LI_CAMPAIGNS = [
  { urn: "urn:li:sponsoredCampaign:demo1", name: "GRT ABM Benelux" },
  { urn: "urn:li:sponsoredCampaign:demo2", name: "GreenTech Lead Gen EU" },
];

function liCampaignDaily(): LiDaily[] {
  const rows: LiDaily[] = [];
  for (let d = 63; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const recent = d < 28;
    // [S5]+[S6] GRT ABM: 10% form-completion op ruime opens; spend recent hoger bij gelijke leads => CPL +25%.
    rows.push({ urn: LI_CAMPAIGNS[0].urn, date, imp: 1500, clicks: 30, spend: recent ? 125 : 100, leads: recent ? 0.25 : 0.25, opens: recent ? 2.5 : 2.2, conv: 0.3, vidStart: 40, vidDone: 22 });
    // Lead Gen EU: gezond (completion ~30%, stabiele CPL) — hoort stil te blijven.
    rows.push({ urn: LI_CAMPAIGNS[1].urn, date, imp: 1200, clicks: 26, spend: 90, leads: 0.9, opens: 3, conv: 0.5, vidStart: 35, vidDone: 20 });
  }
  return rows;
}

function liAccountDaily(): LiDaily[] {
  const rows: LiDaily[] = [];
  for (let d = 159; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const surge = isSurgeMonth(date);
    // [S8] Golf-maand: spend x3 met evenredig meer conversies => eigen CPA stabiel (~150),
    // maar het blended gewicht verschuift naar het dure kanaal (mix-druk zichtbaar).
    // [S7] Vertoningen mee omhoog: onderdeel van de zaai-golf.
    rows.push({ urn: "demo-li-account", date, imp: surge ? 3400 : 2400, clicks: surge ? 62 : 45, spend: surge ? 300 : 100, leads: surge ? 1.4 : 1.1, opens: 5, conv: surge ? 2.0 : 0.66, vidStart: 70, vidDone: 40 });
  }
  return rows;
}

// [S9] Demografie: 75% van de leads uit "Education", buiten het Google-ICP (Operations/Growers).
const LI_DEMO_FUNCTIONS = [
  { urn: "urn:li:function:demo-edu", label: "Education", leadsPerDay: 0.9 },
  { urn: "urn:li:function:demo-ops", label: "Operations", leadsPerDay: 0.3 },
];

// ── Instellingen: edities, doelen, ICP ─────────────────────────────────────
const year = Number(TODAY.slice(0, 4));
const RAI_EVENTS = {
  events: [
    { id: "demo-grt", name: "GreenTech Amsterdam", abbrev: "GRT", cadence: "annual", editions: [
      { date: `${year - 1}-06-11`, label: `${year - 1}` },
      { date: `${year}-06-10`, label: `${year}` },
    ] },
    { id: "demo-gra", name: "GreenTech Americas", abbrev: "GRA", cadence: "annual", editions: [
      { date: `${year - 1}-09-16`, label: `${year - 1}` },
      { date: `${year}-09-15`, label: `${year}` },
    ] },
    { id: "demo-grn", name: "GreenTech North America", abbrev: "GRN", cadence: "custom", editions: [
      { date: `${year}-11-04`, label: `${year}` },
    ] },
  ],
};
const KPI_TARGETS = { conversionsMode: "absolute", conversionsAbsolute: 2600, conversionsGrowthPct: 0, revenueMode: "absolute", revenueAbsolute: 0, revenueGrowthPct: 0, roasTarget: 0, cpaTarget: 45 };
const AUDIENCE_PROFILE = { google_ads: { job_function: ["Operations", "Grower", "Horticulture Manager"], seniority: ["Senior", "Owner"] } };
const GEO_CLONE_SETTINGS = [
  { geo_clone: "GRT", goals: { conversionsAbsolute: 320 }, event: null, branding: { brandName: "GreenTech Amsterdam (demo)" } },
  { geo_clone: "GRA", goals: { conversionsAbsolute: 200 }, event: null, branding: null },
];

// ── Rijen bouwen per tabel ─────────────────────────────────────────────────
type Row = Record<string, unknown>;

export function buildAllRows(): Record<string, Row[]> {
  const g = googleMonthly();
  const byMonth = new Map<number, { imp: number; clicks: number; cost: number; conv: number; value: number }>();
  for (const r of g) {
    const acc = byMonth.get(r.monthIdx) ?? { imp: 0, clicks: 0, cost: 0, conv: 0, value: 0 };
    acc.imp += r.imp; acc.clicks += r.clicks; acc.cost += r.cost; acc.conv += r.conv; acc.value += r.value;
    byMonth.set(r.monthIdx, acc);
  }

  const campaignIdOf = (name: string) => `demo-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const r2 = (v: number) => Math.round(v * 100) / 100;

  const tables: Record<string, Row[]> = {};

  tables["ads_campaign_monthly"] = g.map((r) => ({
    client_id: DEMO_CLIENT, campaign_id: campaignIdOf(r.campaign), campaign_name: r.campaign, campaign_status: "ENABLED",
    month: monthsBack(r.monthIdx), impressions: r.imp, clicks: r.clicks, cost: r.cost, conversions: r.conv,
    conversions_value: r.value, ctr: r2(r.clicks / r.imp), avg_cpc: r2(r.cost / r.clicks),
    cost_per_conversion: r.conv > 0 ? r2(r.cost / r.conv) : null, conversion_rate: r2(r.conv / r.clicks), roas: 0,
  }));

  tables["ads_account_monthly"] = [...byMonth.entries()].map(([mIdx, a]) => ({
    client_id: DEMO_CLIENT, month: monthsBack(mIdx), impressions: a.imp, clicks: a.clicks, cost: a.cost,
    conversions: a.conv, conversions_value: a.value, ctr: r2(a.clicks / a.imp), avg_cpc: r2(a.cost / a.clicks),
    cost_per_conversion: a.conv > 0 ? r2(a.cost / a.conv) : null, conversion_rate: r2(a.conv / a.clicks), roas: 0,
  }));

  // Weekdata: de laatste 26 weken, kwart van de maandtotalen (deterministische verdeling).
  const weekly: Row[] = [];
  for (let w = 25; w >= 0; w--) {
    const weekStart = addDays(TODAY, -7 * w - ((new Date(TODAY).getDay() + 6) % 7)); // maandagen
    const mIdx = Math.min(23, Math.max(0, Math.floor((new Date(TODAY).getTime() - new Date(weekStart).getTime()) / (30.44 * 86400000))));
    const a = byMonth.get(mIdx)!;
    weekly.push({
      client_id: DEMO_CLIENT, week_start: weekStart, impressions: Math.round(a.imp / 4.33), clicks: Math.round(a.clicks / 4.33),
      cost: r2(a.cost / 4.33), conversions: Math.round(a.conv / 4.33), conversions_value: 0,
      ctr: r2(a.clicks / a.imp), avg_cpc: r2(a.cost / a.clicks), cost_per_conversion: a.conv > 0 ? r2(a.cost / a.conv) : null,
      conversion_rate: r2(a.conv / a.clicks), roas: 0,
    });
  }
  tables["ads_account_weekly"] = weekly;

  // [S13] Impression share, laatste 2 maanden.
  const isRows: Row[] = [];
  for (const mIdx of [1, 0]) {
    const month = monthsBack(mIdx);
    isRows.push(
      { client_id: DEMO_CLIENT, campaign_id: campaignIdOf("GRT | Search | NL"), campaign_name: "GRT | Search | NL", campaign_type: "SEARCH", month, impressions: 42000, clicks: 2100, cost: 4200, conversions: 26, search_impression_share: 0.55, search_budget_lost_is: 0.28, search_rank_lost_is: 0.05, daily_budget: 140, budget_utilization: 0.97 },
      { client_id: DEMO_CLIENT, campaign_id: campaignIdOf("GRA | Search | US"), campaign_name: "GRA | Search | US", campaign_type: "SEARCH", month, impressions: 30000, clicks: 1400, cost: 3000, conversions: 30, search_impression_share: 0.62, search_budget_lost_is: 0.04, search_rank_lost_is: 0.22, daily_budget: 100, budget_utilization: 0.7 },
      { client_id: DEMO_CLIENT, campaign_id: campaignIdOf("GreenTech | Brand"), campaign_name: "GreenTech | Brand", campaign_type: "SEARCH", month, impressions: 15000, clicks: 1000, cost: 500, conversions: 45, search_impression_share: 0.93, search_budget_lost_is: 0.01, search_rank_lost_is: 0.03, daily_budget: 20, budget_utilization: 0.8 },
    );
  }
  tables["ads_campaign_impression_share"] = isRows;

  // Verspillende zoektermen (recent).
  const wasteTerms = ["greenhouse jobs", "tuinbouw vacature", "greentech festival tickets", "gratis kas bouwen", "hydroponics diy home"];
  tables["ads_search_terms_wasteful"] = wasteTerms.map((term, i) => ({
    client_id: DEMO_CLIENT, week_start: addDays(TODAY, -7), search_term: term, campaign_name: "GRT | Search | NL",
    ad_group_name: "GRT Generiek", impressions: 400 + i * 90, clicks: 30 + i * 6, cost: r2(60 + i * 25), match_type: "BROAD",
  }));

  // RSA-assets + ad-meta (fictief domein: de landing-audit toont dan eerlijk het degradatiepad).
  const rsaMonth = monthsBack(0);
  const headlines = ["Ontmoet ons op GreenTech", "Tuinbouwtechniek van morgen", "Boek uw stand nu", "Innovatie in de kas", "GreenTech Amsterdam 2026"];
  tables["google_ads_ad_meta"] = [
    { client_id: DEMO_CLIENT, ad_id: "demo-rsa-1", campaign_name: "GRT | Search | NL", ad_group_name: "GRT Generiek", ad_type: "RESPONSIVE_SEARCH_AD", final_url: "https://demo.greentech-fictief.example/beurs", status: "ENABLED" },
  ];
  tables["google_ads_rsa_assets"] = headlines.map((h, i) => ({
    client_id: DEMO_CLIENT, month: rsaMonth, campaign_name: "GRT | Search | NL", ad_group_name: "GRT Generiek",
    ad_id: "demo-rsa-1", asset_id: `demo-asset-${i}`, field_type: "HEADLINE", asset_text: h, pinned_field: i === 0 ? "HEADLINE_1" : null,
    performance_label: i < 2 ? "BEST" : i < 4 ? "GOOD" : "LOW", impressions: 9000 - i * 1500, clicks: 200 - i * 30, conversions: 5, cost: 300,
  }));

  // Meta-structuur + dagdata.
  // status kent een check-constraint (active/expired/error/disabled); "disabled" markeert
  // eerlijk dat dit geen echte koppeling is, terwijl de currency de blended view voedt.
  tables["meta_connections"] = [{ client_id: DEMO_CLIENT, ad_account_id: "act_demo", token_ref: "demo", currency: "EUR", status: "disabled", last_sync_at: new Date().toISOString() }];
  tables["meta_campaigns"] = META_CAMPAIGNS.map((c) => ({ campaign_id: c.id, client_id: DEMO_CLIENT, name: c.name, objective: "OUTCOME_AWARENESS", status: "ACTIVE", effective_status: "ACTIVE" }));
  tables["meta_ads"] = META_ADS.map((a) => ({ ad_id: a.id, adset_id: `${a.campaign}-as1`, campaign_id: a.campaign, client_id: DEMO_CLIENT, name: a.name, status: "ACTIVE", effective_status: "ACTIVE" }));
  // Alleen meta_ad_daily kent de ranking-kolommen; campagne- en account-niveau niet.
  const metaBase = (r: MetaDaily): Row => ({
    client_id: DEMO_CLIENT, date: r.date, entity_id: r.entity, impressions: r.imp, link_clicks: r.linkClicks,
    spend: r.spend, conversions: r.conv, conversion_value: 0, frequency: r.freq, hook_rate: r.hook, hold_rate: r.hold,
    landing_page_views: r.lpv ?? null, add_to_cart: r.atc ?? null, initiate_checkout: r.ic ?? null,
  });
  tables["meta_ad_daily"] = metaAdDaily().map((r) => ({
    ...metaBase(r), quality_ranking: r.qr ?? null, engagement_rate_ranking: r.er ?? null, conversion_rate_ranking: r.cr ?? null,
  }));
  tables["meta_campaign_daily"] = metaCampaignDaily().map(metaBase);
  tables["meta_account_daily"] = metaAccountDaily().map(metaBase);

  // LinkedIn-structuur + dagdata.
  tables["linkedin_connections"] = [{ client_id: DEMO_CLIENT, ad_account_urn: "urn:li:sponsoredAccount:demo", token_ref: "demo", status: "disabled", currency: "EUR", last_sync_at: new Date().toISOString() }];
  tables["linkedin_campaigns"] = LI_CAMPAIGNS.map((c) => ({ campaign_urn: c.urn, client_id: DEMO_CLIENT, name: c.name, status: "ACTIVE", objective_type: "LEAD_GENERATION" }));
  const liRow = (r: LiDaily): Row => ({
    client_id: DEMO_CLIENT, date: r.date, entity_urn: r.urn, impressions: r.imp, clicks: r.clicks, spend: r.spend,
    one_click_leads: r.leads, one_click_lead_form_opens: r.opens, external_website_conversions: r.conv,
    conversion_value: 0, video_starts: r.vidStart, video_completions: r.vidDone,
  });
  tables["linkedin_campaign_daily"] = liCampaignDaily().map(liRow);
  tables["linkedin_account_daily"] = liAccountDaily().map(liRow);
  tables["linkedin_urn_labels"] = LI_DEMO_FUNCTIONS.map((f) => ({ urn: f.urn, label: f.label, taxonomy: "function" }));
  const demoRows: Row[] = [];
  for (let d = 59; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    for (const f of LI_DEMO_FUNCTIONS) {
      demoRows.push({ client_id: DEMO_CLIENT, date, level: "CAMPAIGN", entity_urn: LI_CAMPAIGNS[0].urn, pivot_type: "MEMBER_JOB_FUNCTION", pivot_value_urn: f.urn, impressions: 400, clicks: 9, spend: 30, leads: f.leadsPerDay, conversions: 0, coverage_pct: 0.9 });
    }
  }
  tables["linkedin_demographic_daily"] = demoRows;

  // Instellingen + sync-status.
  // linkedin_icp: het ICP matcht op URN; alleen Operations is ICP, dus de Education-leads
  // (75%) zijn waste — voedt de losse ICP-fit-analyse met een materiele bevinding.
  tables["client_settings"] = [{
    client_id: DEMO_CLIENT, kpi_targets: KPI_TARGETS, rai_events: RAI_EVENTS, audience_profile: AUDIENCE_PROFILE,
    linkedin_icp: { job_functions: ["urn:li:function:demo-ops"], seniorities: [], industries: [], company_sizes: [] },
  }];
  tables["geo_clone_settings"] = GEO_CLONE_SETTINGS.map((s) => ({ client_id: DEMO_CLIENT, ...s }));
  tables["client_sync_status"] = [{ client_id: DEMO_CLIENT, last_sync_at: new Date().toISOString(), last_sync_status: "demo", last_successful_sync_at: new Date().toISOString(), datasets_available: 10, datasets_total: 10, freshness_status: "fresh" }];

  return tables;
}

// ── Uitvoeren ──────────────────────────────────────────────────────────────
const sqlLit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

function printSql(tables: Record<string, Row[]>) {
  console.log(`-- DEMO-SEED voor ${DEMO_CLIENT} — gegenereerd, niet met de hand bewerken`);
  console.log(`delete from client_settings where client_id='${DEMO_CLIENT}';`);
  for (const [table, rows] of Object.entries(tables)) {
    if (rows.length === 0) continue;
    if (table !== "linkedin_urn_labels") console.log(`delete from ${table} where client_id='${DEMO_CLIENT}';`);
    const cols = Object.keys(rows[0]);
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values = chunk.map((r) => `(${cols.map((c) => sqlLit(r[c])).join(",")})`).join(",\n");
      const conflict = table === "linkedin_urn_labels" ? " on conflict (urn) do update set label=excluded.label" : "";
      console.log(`insert into ${table} (${cols.join(",")}) values\n${values}${conflict};`);
    }
  }
  // Demo-klant in de app-klantenlijst (idempotent).
  console.log(`update app_settings set value = (
    select case when exists (select 1 from jsonb_array_elements(value) e where e->>'id'='${DEMO_CLIENT}')
      then value
      else value || '[{"id":"${DEMO_CLIENT}","name":"${DEMO_NAME}","source":"demo"}]'::jsonb end
  ), updated_at=now() where key='api_clients';`);
}

async function insertViaSupabase(tables: Record<string, Row[]>) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error("Zet NEXT_PUBLIC_SUPABASE_URL en een key in de omgeving (of gebruik --sql)."); process.exit(1); }
  const db = createClient(url, key, { auth: { persistSession: false } });
  for (const [table, rows] of Object.entries(tables)) {
    if (table !== "linkedin_urn_labels") await db.from(table).delete().eq("client_id", DEMO_CLIENT);
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await db.from(table).upsert(rows.slice(i, i + 400));
      if (error) { console.error(`✗ ${table}: ${error.message}`); process.exit(1); }
    }
    console.log(`✓ ${table}: ${rows.length} rijen`);
  }
  // Klantenlijst bijwerken.
  const { data } = await db.from("app_settings").select("value").eq("key", "api_clients").maybeSingle();
  const list = Array.isArray(data?.value) ? (data!.value as Row[]) : [];
  if (!list.some((c) => c.id === DEMO_CLIENT)) {
    list.push({ id: DEMO_CLIENT, name: DEMO_NAME, source: "demo" });
    await db.from("app_settings").upsert({ key: "api_clients", value: list, updated_at: new Date().toISOString() });
    console.log("✓ demo-klant toegevoegd aan de klantenlijst");
  }
  console.log(`\nKlaar. Verwijderen kan met: npx tsx scripts/demo/teardown-demo-client.ts`);
}

// --check: bewijs dat de scenario's de detectors echt triggeren (geen DB nodig).
async function check() {
  const { shapeMetaAdInputs, shapeMetaLevelInputs, shapeLinkedInInputs } = await import("../../lib/analysis/channel-signal-data");
  const { buildMetaCreativeSignals } = await import("../../lib/signals/meta-creative");
  const { buildLinkedInSignals } = await import("../../lib/signals/linkedin-signals");
  const { buildCrossChannelSignals } = await import("../../lib/signals/cross-channel");
  const { analyzeGeoClone } = await import("../../lib/rai/geo-clone-analysis");

  const tables = buildAllRows();
  let failed = 0;
  const expect = (cond: boolean, label: string) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) failed++; };

  // De gegenereerde Row-objecten hebben runtime exact de juiste vorm; de cast via
  // unknown overbrugt alleen het statische verschil met de detector-invoertypes.
  type AnyRow = Record<string, unknown>;
  const rowsAs = <T,>(t: Row[]): T[] => t as unknown as T[];
  const adNames = new Map(META_ADS.map((a) => [a.id, { adName: a.name, campaignName: META_CAMPAIGNS.find((c) => c.id === a.campaign)?.name ?? null }]));
  const meta = buildMetaCreativeSignals({
    ads: shapeMetaAdInputs(rowsAs(tables["meta_ad_daily"]), adNames),
    levels: shapeMetaLevelInputs(rowsAs(tables["meta_campaign_daily"]), new Map(META_CAMPAIGNS.map((c) => [c.id, { adName: c.name }]))),
  });
  const metaIds = meta.triggered.map((s) => s.id).join(",");
  expect(/fatigue/.test(metaIds), `[S1] Meta fatigue getriggerd (${meta.triggered.length} verhalen)`);
  expect(/frequency|saturat/.test(metaIds), "[S2] Meta frequency-saturatie getriggerd");

  const li = buildLinkedInSignals({ entities: shapeLinkedInInputs(rowsAs(tables["linkedin_campaign_daily"]), new Map(LI_CAMPAIGNS.map((c) => [c.urn, c.name]))) });
  const liIds = li.triggered.map((s) => s.id).join(",");
  expect(/form/.test(liIds), `[S5] LinkedIn form drop-off getriggerd (${li.triggered.length} verhalen)`);
  expect(/cpl/.test(liIds), "[S6] LinkedIn CPL-druk getriggerd");

  // Cross: maandreeksen uit de account-dagdata afleiden zoals de blended view dat doet.
  const toMonthly = (rows: AnyRow[], channel: string, map: (r: AnyRow) => { imp: number; clicks: number; spend: number; conv: number; leads: number }) => {
    const acc = new Map<string, { impressions: number; clicks: number; spend: number; conversions: number; leads: number }>();
    for (const r of rows) {
      const m = String((r as Record<string, unknown>).date).slice(0, 7);
      const v = map(r); const a = acc.get(m) ?? { impressions: 0, clicks: 0, spend: 0, conversions: 0, leads: 0 };
      a.impressions += v.imp; a.clicks += v.clicks; a.spend += v.spend; a.conversions += v.conv; a.leads += v.leads;
      acc.set(m, a);
    }
    // Alleen volle maanden: de oudste maand kan partieel zijn en de lopende maand sluiten
    // de detectors (en de cross-route) uit.
    return [...acc.entries()].sort().slice(1).filter(([month]) => month < CUR_MONTH).map(([month, a]) => ({ channel, month, ...a }));
  };
  const gRow = (r: AnyRow) => r as Record<string, number>;
  const channels = [
    ...(tables["ads_account_monthly"] as AnyRow[]).filter((r) => String(gRow(r).month).slice(0, 7) < CUR_MONTH).slice(-4).map((r) => ({ channel: "google_ads", month: String(gRow(r).month).slice(0, 7), impressions: gRow(r).impressions, clicks: gRow(r).clicks, spend: gRow(r).cost, conversions: gRow(r).conversions, leads: 0 })),
    ...toMonthly(tables["meta_account_daily"] as AnyRow[], "meta_ads", (r) => ({ imp: gRow(r).impressions, clicks: gRow(r).link_clicks, spend: gRow(r).spend, conv: gRow(r).conversions, leads: 0 })),
    ...toMonthly(tables["linkedin_account_daily"] as AnyRow[], "linkedin_ads", (r) => ({ imp: gRow(r).impressions, clicks: gRow(r).clicks, spend: gRow(r).spend, conv: gRow(r).external_website_conversions as number, leads: gRow(r).one_click_leads as number })),
  ];
  const brand = (tables["ads_campaign_monthly"] as AnyRow[])
    .filter((r) => /brand/i.test(String(gRow(r).campaign_name)) && String(gRow(r).month).slice(0, 7) < CUR_MONTH)
    .map((r) => ({ month: String(gRow(r).month).slice(0, 7), clicks: gRow(r).clicks }));
  const cross = buildCrossChannelSignals({ channels, brand });
  const crossIds = cross.triggered.map((s) => s.id).join(",");
  expect(/zaai/.test(crossIds), `[S7] zaai-oogst getriggerd (${cross.triggered.length} cross-verhalen)`);

  // [S9] Doelgroep-tegenspraak: LinkedIn-leads vs het Google-ICP.
  const { audienceContradiction } = await import("../../lib/cross-channel/audience-coherence");
  const leadsByFn = new Map<string, number>();
  for (const r of tables["linkedin_demographic_daily"] as AnyRow[]) {
    const rr = r as Record<string, unknown>;
    leadsByFn.set(String(rr.pivot_value_urn), (leadsByFn.get(String(rr.pivot_value_urn)) ?? 0) + Number(rr.leads));
  }
  const totalLeads = [...leadsByFn.values()].reduce((s, v) => s + v, 0);
  const labelOf = new Map(LI_DEMO_FUNCTIONS.map((f) => [f.urn, f.label]));
  const segments = [...leadsByFn.entries()].map(([urn, leads]) => ({ dimension: "job_function" as const, value: labelOf.get(urn) ?? urn, conversionShare: leads / totalLeads }));
  const coherence = audienceContradiction(
    { channel: "linkedin_ads", segments },
    { channel: "google_ads", byDimension: AUDIENCE_PROFILE.google_ads }
  );
  expect(coherence.flags.length === 1 && coherence.flags[0].outsideProfileSharePct > 50, `[S9] doelgroep-tegenspraak geflagd (${coherence.flags[0]?.outsideProfileSharePct}% buiten ICP)`);

  // Beursanalyse GRT: achterstand => actionNeeded; GRA: op koers.
  const grt = analyzeGeoClone({
    geoClone: "GRT", fairLabel: "GreenTech Amsterdam", rows: rowsAs(tables["ads_campaign_monthly"]),
    cadence: "annual", editions: RAI_EVENTS.events[0].editions, conversionsTarget: 320, asOfDate: TODAY,
  });
  expect(grt.actionNeeded === true, `[S10] GRT-beursanalyse: achterstand gedetecteerd (delta ${grt.conversions?.deltaPct})`);
  const gra = analyzeGeoClone({
    geoClone: "GRA", fairLabel: "GreenTech Americas", rows: rowsAs(tables["ads_campaign_monthly"]),
    cadence: "annual", editions: RAI_EVENTS.events[1].editions, conversionsTarget: 200, asOfDate: TODAY,
  });
  expect(gra.conversions?.comparable === true, `[S11] GRA-beursanalyse vergelijkbaar (delta ${gra.conversions?.deltaPct})`);

  console.log(failed > 0 ? `\n${failed} scenario('s) NIET getriggerd` : "\nAlle gecontroleerde scenario's triggeren zoals ontworpen.");
  if (failed > 0) process.exit(1);
}

const mode = process.argv[2];
if (mode === "--sql") printSql(buildAllRows());
else if (mode === "--check") check();
else insertViaSupabase(buildAllRows());
