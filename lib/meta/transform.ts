// Pure transform van een Meta insights-rij naar een getypeerde dagrij. Geen I/O,
// dus los testbaar. Twee aandachtspunten uit de API: numerieke velden komen als
// string, en conversies kunnen onder meerdere action_types verschijnen (purchase,
// omni_purchase, de pixel-variant) wat tot dubbeltelling leidt als je niet oppast.

import type { MetaActionEntry, MetaInsightsRow, MetaDailyRow } from "./types";

// Parseert een Meta-waarde (meestal string) naar een getal. Leeg of niet-numeriek geeft null.
export function parseNum(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Deelt veilig: deler null of 0 geeft null, zodat een metriek nooit Infinity of NaN wordt.
function safeDiv(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

// Expliciete mapping van action_type naar een doelveld. Onbekende types worden
// genegeerd (blijven alleen in raw). Meerdere types kunnen naar hetzelfde veld
// wijzen (purchase, omni_purchase, pixel); we tellen per veld maar EEN bron.
const ACTION_MAP: Record<string, keyof Pick<MetaDailyRow,
  "conversions" | "leads" | "addToCart" | "initiateCheckout" | "landingPageViews" | "postEngagement">> = {
  purchase: "conversions",
  omni_purchase: "conversions",
  "offsite_conversion.fb_pixel_purchase": "conversions",
  lead: "leads",
  omni_lead: "leads",
  "offsite_conversion.fb_pixel_lead": "leads",
  add_to_cart: "addToCart",
  omni_add_to_cart: "addToCart",
  "offsite_conversion.fb_pixel_add_to_cart": "addToCart",
  initiate_checkout: "initiateCheckout",
  omni_initiated_checkout: "initiateCheckout",
  "offsite_conversion.fb_pixel_initiate_checkout": "initiateCheckout",
  landing_page_view: "landingPageViews",
  post_engagement: "postEngagement",
};

// Sommeert de action-waarden per doelveld. Per veld telt alleen de eerste bekende
// bron mee, zodat purchase en omni_purchase niet samen dubbelen.
export function mapActions(actions: MetaActionEntry[] | undefined): Record<string, number> {
  const totals: Record<string, number> = {
    conversions: 0, leads: 0, addToCart: 0, initiateCheckout: 0, landingPageViews: 0, postEngagement: 0,
  };
  if (!Array.isArray(actions)) return totals;
  const countedFields = new Set<string>();
  for (const a of actions) {
    const field = ACTION_MAP[a.action_type];
    if (!field) continue;
    if (countedFields.has(field)) continue; // eerste bekende bron per veld telt
    const value = parseNum(a.value);
    if (value == null) continue;
    countedFields.add(field);
    totals[field] += value;
  }
  return totals;
}

// Haalt EEN waarde uit een action-array voor het eerste matchende action_type.
function firstActionValue(entries: MetaActionEntry[] | undefined, types: string[]): number | null {
  if (!Array.isArray(entries)) return null;
  for (const t of types) {
    const hit = entries.find((e) => e.action_type === t);
    if (hit) {
      const v = parseNum(hit.value);
      if (v != null) return v;
    }
  }
  return null;
}

// Mapt een ruwe insights-rij naar een getypeerde dagrij met afgeleide metrieken.
export function mapInsightsRow(row: MetaInsightsRow, opts: { round?: boolean } = {}): MetaDailyRow {
  const round = opts.round ?? true;
  const r = (v: number | null): number | null => (v == null ? null : round ? Math.round(v * 10000) / 10000 : v);

  const impressions = parseNum(row.impressions);
  const linkClicks = parseNum(row.inline_link_clicks);
  const spend = parseNum(row.spend);
  const actions = mapActions(row.actions);
  const conversions = actions.conversions;
  const conversionValue = firstActionValue(row.action_values, [
    "purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase",
  ]) ?? 0;
  const video3s = firstActionValue(row.video_3sec_watched_actions, ["video_view"]) ?? 0;
  const thruplay = firstActionValue(row.video_thruplay_watched_actions, ["video_view"]) ?? 0;

  return {
    date: row.date_start ?? null,
    entityId: row.ad_id ?? row.adset_id ?? row.campaign_id ?? row.account_id ?? null,
    impressions,
    reach: parseNum(row.reach),
    frequency: r(parseNum(row.frequency)),
    clicksAll: parseNum(row.clicks),
    linkClicks,
    spend,
    cpm: r(parseNum(row.cpm)),
    cpcLink: r(safeDiv(spend, linkClicks)),
    ctrLink: r(safeDiv(linkClicks, impressions)),
    conversions,
    conversionValue,
    purchaseRoas: firstActionValue(row.purchase_roas, ["purchase", "omni_purchase"]),
    cpa: r(safeDiv(spend, conversions > 0 ? conversions : null)),
    roas: r(safeDiv(conversionValue, spend)),
    leads: actions.leads,
    addToCart: actions.addToCart,
    initiateCheckout: actions.initiateCheckout,
    landingPageViews: actions.landingPageViews,
    video3sViews: video3s,
    videoThruplay: thruplay,
    videoP25: firstActionValue(row.video_p25_watched_actions, ["video_view"]) ?? 0,
    videoP50: firstActionValue(row.video_p50_watched_actions, ["video_view"]) ?? 0,
    videoP75: firstActionValue(row.video_p75_watched_actions, ["video_view"]) ?? 0,
    videoP100: firstActionValue(row.video_p100_watched_actions, ["video_view"]) ?? 0,
    postEngagement: actions.postEngagement,
    hookRate: r(safeDiv(video3s, impressions)),
    holdRate: r(safeDiv(thruplay, video3s > 0 ? video3s : null)),
    qualityRanking: row.quality_ranking ?? null,
    engagementRateRanking: row.engagement_rate_ranking ?? null,
    conversionRateRanking: row.conversion_rate_ranking ?? null,
  };
}
