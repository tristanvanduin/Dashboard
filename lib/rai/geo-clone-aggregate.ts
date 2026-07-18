// Fase 1c: her-aggregatie van account-cijfers PER geo-clone uit de campagne-maanddata
// (ads_campaign_monthly draagt campaign_name, de account-tabel niet). Puur en los getest.
// Sommeert per maand de campagnes die bij de gekozen geo-clone horen (via de catalogus) en
// leidt de ratio's UIT TOTALEN af (nooit uit gemiddelde deelwaarden — dezelfde regel als
// period-evaluation/weekly-metrics).

import { matchGeoCloneByCampaignName } from "./geo-clone-catalog";

export interface CampaignMonthlyRow {
  campaign_name: string;
  month: string; // "YYYY-MM-01"
  impressions?: number | null;
  clicks?: number | null;
  cost?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
}

export interface GeoCloneMonthlyPoint {
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  cpa: number | null;   // cost / conversions
  roas: number | null;  // conversionsValue / cost
  ctr: number | null;   // clicks / impressions
}

export interface GeoCloneSummary {
  months: GeoCloneMonthlyPoint[];
  totals: Omit<GeoCloneMonthlyPoint, "month">;
  campaignCount: number;
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ratio = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 10000) / 10000 : null);

function derive(agg: { impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number }) {
  return {
    ...agg,
    cpa: ratio(agg.cost, agg.conversions),
    roas: ratio(agg.conversionsValue, agg.cost),
    ctr: ratio(agg.clicks, agg.impressions),
  };
}

/** Sommeert per maand de campagnes die bij de geo-clone horen; ratio's uit de maandtotalen. */
export function aggregateCampaignMonthlyByGeoClone(rows: CampaignMonthlyRow[], geoClone: string): GeoCloneSummary {
  const matched = rows.filter((r) => matchGeoCloneByCampaignName(r.campaign_name)?.abbreviation === geoClone);
  const byMonth = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number }>();
  const campaigns = new Set<string>();

  for (const r of matched) {
    campaigns.add(r.campaign_name);
    const m = byMonth.get(r.month) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
    m.impressions += n(r.impressions);
    m.clicks += n(r.clicks);
    m.cost += n(r.cost);
    m.conversions += n(r.conversions);
    m.conversionsValue += n(r.conversions_value);
    byMonth.set(r.month, m);
  }

  const months: GeoCloneMonthlyPoint[] = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, agg]) => ({ month, ...derive(agg) }));

  const totalAgg = months.reduce(
    (acc, m) => ({
      impressions: acc.impressions + m.impressions,
      clicks: acc.clicks + m.clicks,
      cost: acc.cost + m.cost,
      conversions: acc.conversions + m.conversions,
      conversionsValue: acc.conversionsValue + m.conversionsValue,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 }
  );

  return { months, totals: derive(totalAgg), campaignCount: campaigns.size };
}
