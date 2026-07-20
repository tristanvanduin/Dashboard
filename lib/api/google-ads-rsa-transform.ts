// RSA-sync mappers: de pure transformaties van de Google Ads API-respons naar de rijen voor
// google_ads_rsa_assets en google_ads_ad_meta (migratie 020). De API levert velden zowel in
// camelCase als snake_case (het bestaande sjabloon in google-ads.ts vangt beide); deze
// mappers doen hetzelfde en zijn los getest. De GAQL-functies zelf leven in google-ads.ts
// (de executor is intern) en roepen deze mappers aan.

export interface RsaAssetApiResult {
  month: string; // segments.month, "YYYY-MM-01"
  campaignName: string | null;
  adGroupName: string | null;
  adId: string;
  assetId: string;
  fieldType: "HEADLINE" | "DESCRIPTION";
  assetText: string;
  pinnedField: string | null; // UNSPECIFIED wordt null
  performanceLabel: "BEST" | "GOOD" | "LOW" | "LEARNING" | "PENDING" | "UNKNOWN";
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number; // euro's
}

export interface AdMetaApiResult {
  adId: string;
  campaignName: string | null;
  adGroupName: string | null;
  adType: string | null;
  finalUrl: string | null; // de eerste uit final_urls, null bij leeg
  status: string | null;
}

type ApiRow = Record<string, unknown>;

function field(obj: unknown, camel: string, snake: string): unknown {
  if (obj == null || typeof obj !== "object") return undefined;
  const record = obj as Record<string, unknown>;
  return record[camel] ?? record[snake];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  const n = typeof value === "string" ? Number.parseFloat(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

const KNOWN_LABELS = new Set(["BEST", "GOOD", "LOW", "LEARNING", "PENDING"]);

export function mapRsaAssetApiRow(row: ApiRow): RsaAssetApiResult | null {
  const view = (field(row, "adGroupAdAssetView", "ad_group_ad_asset_view") ?? {}) as ApiRow;
  const asset = (row.asset ?? {}) as ApiRow;
  const adGroupAd = (field(row, "adGroupAd", "ad_group_ad") ?? {}) as ApiRow;
  const ad = (adGroupAd.ad ?? {}) as ApiRow;
  const metrics = (row.metrics ?? {}) as ApiRow;
  const segments = (row.segments ?? {}) as ApiRow;

  const fieldTypeRaw = asString(field(view, "fieldType", "field_type"));
  if (fieldTypeRaw !== "HEADLINE" && fieldTypeRaw !== "DESCRIPTION") return null; // andere veldtypes doen niet mee

  const textAsset = (field(asset, "textAsset", "text_asset") ?? {}) as ApiRow;
  const assetText = asString(textAsset.text);
  const adId = asString(ad.id) ?? String(ad.id ?? "");
  const assetId = asString(asset.id) ?? String(asset.id ?? "");
  const month = asString(segments.month);
  if (!assetText || !adId || !assetId || !month) return null;

  const pinnedRaw = asString(field(view, "pinnedField", "pinned_field"));
  const labelRaw = asString(field(view, "performanceLabel", "performance_label")) ?? "UNKNOWN";

  return {
    month,
    campaignName: asString((row.campaign as ApiRow | undefined)?.name),
    adGroupName: asString((field(row, "adGroup", "ad_group") as ApiRow | undefined)?.name),
    adId,
    assetId,
    fieldType: fieldTypeRaw,
    assetText,
    pinnedField: pinnedRaw && pinnedRaw !== "UNSPECIFIED" && pinnedRaw !== "UNKNOWN" ? pinnedRaw : null,
    performanceLabel: (KNOWN_LABELS.has(labelRaw) ? labelRaw : "UNKNOWN") as RsaAssetApiResult["performanceLabel"],
    impressions: asNumber(metrics.impressions),
    clicks: asNumber(metrics.clicks),
    conversions: asNumber(metrics.conversions),
    cost: asNumber(field(metrics, "costMicros", "cost_micros")) / 1_000_000,
  };
}

export function mapAdMetaApiRow(row: ApiRow): AdMetaApiResult | null {
  const adGroupAd = (field(row, "adGroupAd", "ad_group_ad") ?? {}) as ApiRow;
  const ad = (adGroupAd.ad ?? {}) as ApiRow;
  const adId = asString(ad.id) ?? String(ad.id ?? "");
  if (!adId) return null;

  const finalUrls = field(ad, "finalUrls", "final_urls");
  const finalUrl = Array.isArray(finalUrls) && finalUrls.length > 0 ? asString(finalUrls[0]) : null;

  return {
    adId,
    campaignName: asString((row.campaign as ApiRow | undefined)?.name),
    adGroupName: asString((field(row, "adGroup", "ad_group") as ApiRow | undefined)?.name),
    adType: asString(ad.type),
    finalUrl,
    status: asString(adGroupAd.status),
  };
}

// ── De database-rijen voor de upserts (migratie 020). ──

export function rsaAssetToDbRow(result: RsaAssetApiResult, clientId: string): Record<string, unknown> {
  return {
    client_id: clientId,
    month: result.month,
    campaign_name: result.campaignName,
    ad_group_name: result.adGroupName,
    ad_id: result.adId,
    asset_id: result.assetId,
    field_type: result.fieldType,
    asset_text: result.assetText,
    pinned_field: result.pinnedField,
    performance_label: result.performanceLabel,
    impressions: Math.round(result.impressions),
    clicks: Math.round(result.clicks),
    conversions: Math.round(result.conversions * 100) / 100,
    cost: Math.round(result.cost * 100) / 100,
    synced_at: new Date().toISOString(),
  };
}

export function adMetaToDbRow(result: AdMetaApiResult, clientId: string): Record<string, unknown> {
  return {
    client_id: clientId,
    ad_id: result.adId,
    campaign_name: result.campaignName,
    ad_group_name: result.adGroupName,
    ad_type: result.adType,
    final_url: result.finalUrl,
    status: result.status,
    updated_at: new Date().toISOString(),
  };
}

// ── RSA-tekstverrijking (bekende Google Ads API-beperking) ────────────────────────────────
// Google geeft ad_group_ad.ad.responsive_search_ad.headlines vaak LEEG terug zodra de query op
// segments.month + metrics segmenteert. De betrouwbare oplossing is een APARTE, niet-
// gesegmenteerde query (alleen structuur, geen metrics) die per ad_id de teksten levert; die
// mergen we in de creative-rijen waar de inline-tekst leeg is. Puur en los getest.

export interface AdRsaText {
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
}

// Trekt de tekst uit een responsive_search_ad.headlines/descriptions-array van {text}-objecten
// (camelCase en snake_case afgevangen), lege teksten eruit gefilterd.
export function extractResponsiveTexts(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => (i && typeof i === "object" ? String((i as Record<string, unknown>).text ?? "") : ""))
    .filter((t) => t.trim().length > 0);
}

// Bouwt de ad_id -> teksten-map uit de rijen van de niet-gesegmenteerde structuur-query.
export function buildAdTextMap(rows: Array<Record<string, unknown>>): Map<string, AdRsaText> {
  const map = new Map<string, AdRsaText>();
  for (const row of rows) {
    const aga = (row.adGroupAd ?? row.ad_group_ad) as Record<string, unknown> | undefined;
    const ad = aga?.ad as Record<string, unknown> | undefined;
    const adId = String(ad?.id ?? "");
    if (!adId) continue;
    const rsa = (ad?.responsiveSearchAd ?? ad?.responsive_search_ad) as Record<string, unknown> | undefined;
    map.set(adId, {
      headlines: extractResponsiveTexts(rsa?.headlines),
      descriptions: extractResponsiveTexts(rsa?.descriptions),
      finalUrls: ((ad?.finalUrls ?? ad?.final_urls ?? []) as unknown[]).map(String).filter(Boolean),
    });
  }
  return map;
}

// Vult per creative-rij de lege tekstvelden aan uit de map (op ad_id). Rijen die al tekst
// hebben blijven ongemoeid; ontbreekt de ad in de map, dan blijft het veld leeg.
export function applyAdText<T extends { adId: string; headlines: string[]; descriptions: string[]; finalUrls: string[] }>(
  creatives: T[],
  textByAd: Map<string, AdRsaText>
): T[] {
  return creatives.map((c) => {
    if (c.headlines.length > 0 && c.descriptions.length > 0 && c.finalUrls.length > 0) return c;
    const t = textByAd.get(c.adId);
    if (!t) return c;
    return {
      ...c,
      headlines: c.headlines.length > 0 ? c.headlines : t.headlines,
      descriptions: c.descriptions.length > 0 ? c.descriptions : t.descriptions,
      finalUrls: c.finalUrls.length > 0 ? c.finalUrls : t.finalUrls,
    };
  });
}
