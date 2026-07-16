// RSA-insights: de deterministische copy-analyse op asset-niveau (het Google-equivalent
// van M3/M4). De MEETVALKUIL zit vooraan in het ontwerp: een RSA toont meerdere assets
// tegelijk, dus impressies, klikken en conversies tellen DUBBEL over assets heen. Een asset
// dat alleen in slechte combinaties draaide krijgt anders de schuld van de combinatie.
// Daarom de bronnen-hierarchie: (1) Googles eigen performance_label (de enige bron die
// binnen-advertentie vergelijkt), (2) het serving-aandeel als relatieve maat, (3) klik- en
// conversiecijfers uitsluitend als indicatie. De note reist verplicht naar de prompt, zoals
// de QS-componenten-note dat doet. IO-vrij en los getest; de sync-query op
// ad_group_ad_asset_view is een benoemde sync-taak (migratie 020 draagt de tabellen).

export const RSA_ATTRIBUTION_NOTE =
  "Asset-metrics tellen dubbel: een RSA toont meerdere headlines en descriptions tegelijk, dus impressies, klikken en conversies per asset zijn GEEN optelbare ad-cijfers. Googles performance_label is de enige bron die assets binnen de advertentie vergelijkt en is daarom leidend; serving-aandeel is context; conversiecijfers per asset zijn indicatief en mogen nooit als hard bewijs worden opgevoerd.";

export const BLEEDER_MIN_IMPRESSIONS = 5000; // onder dit volume geen bleeder-oordeel
export const PIN_DOMINANCE_SHARE = 0.6; // een gepind asset boven dit serving-aandeel domineert de rotatie
export const MIN_HEADLINE_VARIANTS = 8; // de RSA-vuistregel voor voldoende rotatie-materiaal
export const TOP_LIST_SIZE = 10;

export interface RsaAssetRow {
  month: string;
  campaign_name: string | null;
  ad_group_name: string | null;
  ad_id: string;
  asset_id: string;
  field_type: "HEADLINE" | "DESCRIPTION";
  asset_text: string;
  pinned_field: string | null;
  performance_label: "BEST" | "GOOD" | "LOW" | "LEARNING" | "PENDING" | "UNKNOWN" | null;
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number;
}

export interface AssetInsight {
  assetText: string;
  fieldType: "HEADLINE" | "DESCRIPTION";
  adCount: number; // in hoeveel ads dit asset draait
  impressions: number; // som over ad-instanties (dubbeltelling-eigenschap geldt)
  servingSharePct: number; // impressie-aandeel binnen field_type over de ads waar het in zit
  labelShares: { best: number; good: number; low: number; overig: number }; // impressie-gewogen
  dominantLabel: "BEST" | "GOOD" | "LOW" | "overig";
  pinnedAnywhere: boolean;
  indicative: { clicks: number; conversions: number; ctrPct: number | null }; // indicatief, nooit bewijs
}

export interface RsaActionItem {
  kind: "vervang_bleeder" | "unpin_dominante_pin" | "schaal_trekker_op" | "vul_varianten_aan";
  fieldType: "HEADLINE" | "DESCRIPTION";
  assetText: string | null;
  adGroupName: string | null;
  detail: string;
}

export interface RsaInsightsFacts {
  analysisMonth: string | null;
  adCount: number;
  assetRowCount: number;
  trekkers: AssetInsight[]; // dominant BEST of GOOD, gesorteerd op serving-gewicht
  bleeders: AssetInsight[]; // dominant LOW met substantieel volume
  pinDominance: Array<{ adId: string; adGroupName: string | null; assetText: string; servingSharePct: number; label: string }>;
  lowVariantAds: Array<{ adId: string; adGroupName: string | null; headlineCount: number }>;
  actions: RsaActionItem[];
  attributionNote: string;
  summary: string;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function monthKey(month: string): string {
  return month.slice(0, 7);
}

export function analyzeRsaInsights(rows: RsaAssetRow[]): RsaInsightsFacts {
  const months = [...new Set(rows.map((r) => monthKey(r.month)))].sort();
  const analysisMonth = months.length > 0 ? months[months.length - 1] : null;
  const current = rows.filter((r) => monthKey(r.month) === analysisMonth);
  const adIds = new Set(current.map((r) => r.ad_id));

  // Serving-basis per (ad, field_type): de som van de asset-impressies binnen die groep.
  // Dat is een RELATIEVE rotatie-maat; door de dubbeltelling geen absolute waarheid, maar
  // binnen dezelfde advertentie wel een eerlijke vergelijking van hoe vaak Google elk asset
  // meeneemt.
  const groupTotals = new Map<string, number>();
  for (const row of current) {
    const key = `${row.ad_id}|${row.field_type}`;
    groupTotals.set(key, (groupTotals.get(key) ?? 0) + Math.max(row.impressions, 0));
  }

  // Aggregeer per unieke assettekst binnen field_type.
  const byAsset = new Map<string, { rows: RsaAssetRow[]; fieldType: "HEADLINE" | "DESCRIPTION"; text: string }>();
  for (const row of current) {
    const key = `${row.field_type}|${normalizeText(row.asset_text)}`;
    const entry = byAsset.get(key) ?? { rows: [], fieldType: row.field_type, text: row.asset_text };
    entry.rows.push(row);
    byAsset.set(key, entry);
  }

  const insights: AssetInsight[] = [...byAsset.values()].map(({ rows: assetRows, fieldType, text }) => {
    const impressions = assetRows.reduce((s, r) => s + Math.max(r.impressions, 0), 0);
    const clicks = assetRows.reduce((s, r) => s + Math.max(r.clicks, 0), 0);
    const conversions = assetRows.reduce((s, r) => s + Math.max(r.conversions, 0), 0);
    const servingBase = assetRows.reduce((s, r) => s + (groupTotals.get(`${r.ad_id}|${r.field_type}`) ?? 0), 0);

    const labelWeights = { best: 0, good: 0, low: 0, overig: 0 };
    for (const r of assetRows) {
      const w = Math.max(r.impressions, 0);
      if (r.performance_label === "BEST") labelWeights.best += w;
      else if (r.performance_label === "GOOD") labelWeights.good += w;
      else if (r.performance_label === "LOW") labelWeights.low += w;
      else labelWeights.overig += w;
    }
    const totalWeight = labelWeights.best + labelWeights.good + labelWeights.low + labelWeights.overig;
    const share = (v: number) => (totalWeight > 0 ? Math.round((v / totalWeight) * 1000) / 10 : 0);
    const labelShares = { best: share(labelWeights.best), good: share(labelWeights.good), low: share(labelWeights.low), overig: share(labelWeights.overig) };
    const dominantEntry = (Object.entries(labelWeights) as Array<[keyof typeof labelWeights, number]>).sort((a, b) => b[1] - a[1])[0];
    const dominantLabel = dominantEntry[1] === 0 ? "overig" : dominantEntry[0] === "best" ? "BEST" : dominantEntry[0] === "good" ? "GOOD" : dominantEntry[0] === "low" ? "LOW" : "overig";

    return {
      assetText: text,
      fieldType,
      adCount: new Set(assetRows.map((r) => r.ad_id)).size,
      impressions,
      servingSharePct: servingBase > 0 ? Math.round((impressions / servingBase) * 1000) / 10 : 0,
      labelShares,
      dominantLabel,
      pinnedAnywhere: assetRows.some((r) => r.pinned_field != null && r.pinned_field !== ""),
      indicative: { clicks, conversions, ctrPct: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : null },
    };
  });

  const trekkers = insights
    .filter((i) => (i.dominantLabel === "BEST" || i.dominantLabel === "GOOD") && i.impressions > 0)
    .sort((a, b) => (b.dominantLabel === "BEST" ? 1 : 0) - (a.dominantLabel === "BEST" ? 1 : 0) || b.impressions - a.impressions)
    .slice(0, TOP_LIST_SIZE);

  const bleeders = insights
    .filter((i) => i.dominantLabel === "LOW" && i.impressions >= BLEEDER_MIN_IMPRESSIONS)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, TOP_LIST_SIZE);

  // Pin-dominantie: per (ad, field_type) een gepind asset met een dominant serving-aandeel.
  const pinDominance: RsaInsightsFacts["pinDominance"] = [];
  for (const row of current) {
    if (!row.pinned_field) continue;
    const base = groupTotals.get(`${row.ad_id}|${row.field_type}`) ?? 0;
    if (base <= 0) continue;
    const shareInAd = row.impressions / base;
    if (shareInAd >= PIN_DOMINANCE_SHARE) {
      pinDominance.push({
        adId: row.ad_id,
        adGroupName: row.ad_group_name,
        assetText: row.asset_text,
        servingSharePct: Math.round(shareInAd * 1000) / 10,
        label: row.performance_label ?? "UNKNOWN",
      });
    }
  }

  // Variant-armoede: ads met te weinig unieke headlines om te roteren.
  const headlinesPerAd = new Map<string, { adGroupName: string | null; texts: Set<string> }>();
  for (const row of current) {
    if (row.field_type !== "HEADLINE") continue;
    const entry = headlinesPerAd.get(row.ad_id) ?? { adGroupName: row.ad_group_name, texts: new Set<string>() };
    entry.texts.add(normalizeText(row.asset_text));
    headlinesPerAd.set(row.ad_id, entry);
  }
  const lowVariantAds = [...headlinesPerAd.entries()]
    .filter(([, v]) => v.texts.size < MIN_HEADLINE_VARIANTS)
    .map(([adId, v]) => ({ adId, adGroupName: v.adGroupName, headlineCount: v.texts.size }));

  // De actielijst voor content-marketeers, uit de drie bronnen samengesteld.
  const actions: RsaActionItem[] = [];
  for (const b of bleeders) {
    actions.push({
      kind: "vervang_bleeder",
      fieldType: b.fieldType,
      assetText: b.assetText,
      adGroupName: null,
      detail: `"${b.assetText}" is impressie-gewogen ${b.labelShares.low}% LOW volgens Google (${b.impressions} vertoningen in ${b.adCount} ad(s)); schrijf een vervangende variant op hetzelfde thema`,
    });
  }
  for (const p of pinDominance) {
    if (p.label === "LOW") {
      actions.push({
        kind: "unpin_dominante_pin",
        fieldType: "HEADLINE",
        assetText: p.assetText,
        adGroupName: p.adGroupName,
        detail: `de gepinde "${p.assetText}" pakt ${p.servingSharePct}% van de rotatie in ad ${p.adId} en Google labelt hem LOW; unpin of vervang, de pin blokkeert betere varianten`,
      });
    }
  }
  for (const t of trekkers.filter((t) => t.dominantLabel === "BEST").slice(0, 3)) {
    actions.push({
      kind: "schaal_trekker_op",
      fieldType: t.fieldType,
      assetText: t.assetText,
      adGroupName: null,
      detail: `"${t.assetText}" is impressie-gewogen ${t.labelShares.best}% BEST; schrijf varianten op dit thema voor ad-groepen waar het nog niet draait (nu in ${t.adCount} ad(s))`,
    });
  }
  for (const v of lowVariantAds.slice(0, 5)) {
    actions.push({
      kind: "vul_varianten_aan",
      fieldType: "HEADLINE",
      assetText: null,
      adGroupName: v.adGroupName,
      detail: `ad ${v.adId} heeft ${v.headlineCount} unieke headlines (richtlijn ${MIN_HEADLINE_VARIANTS} plus); te weinig materiaal om te roteren en te leren`,
    });
  }

  const summary =
    analysisMonth == null
      ? "Geen RSA-asset-data aangeleverd."
      : `Analysemaand ${analysisMonth}: ${adIds.size} RSA's, ${insights.length} unieke assets. ${trekkers.length} trekkers (BEST of GOOD dominant), ${bleeders.length} bleeders (LOW met volume), ${pinDominance.length} dominante pin(s), ${lowVariantAds.length} ad(s) met te weinig headline-varianten. ${actions.length} acties voor de content-marketeer.`;

  return {
    analysisMonth,
    adCount: adIds.size,
    assetRowCount: current.length,
    trekkers,
    bleeders,
    pinDominance,
    lowVariantAds,
    actions,
    attributionNote: RSA_ATTRIBUTION_NOTE,
    summary,
  };
}
