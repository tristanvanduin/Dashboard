/**
 * Pre-aggregates raw ad group monthly rows into compact summaries
 * for the monthly analysis pipeline step 3.
 *
 * Input:  raw rows from ads_adgroup_monthly (13 months)
 * Output: per-adgroup summary + per-campaign summary
 */

// ── Types ───────────────────────────────────────────────────────────────────

interface RawAdGroupRow {
  ad_group_id: string;
  ad_group_name: string;
  campaign_name: string;
  month: string;       // YYYY-MM-DD
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  cpa: number;
  roas: number;
}

export interface AdGroupSummary {
  ad_group_name: string;
  campaign_name: string;
  months_with_data: number;
  avg_conversions_last_3m: number;
  avg_conversions_prev_3m: number;
  conversions_trend_pct: number | null;
  avg_cpa_last_3m: number;
  avg_cpa_prev_3m: number;
  cpa_trend_pct: number | null;
  avg_roas_last_3m: number;
  avg_roas_prev_3m: number;
  roas_trend_pct: number | null;
  avg_cost_last_3m: number;
  vs_campaign_avg_conversions_pct: number;
  vs_campaign_avg_roas_pct: number;
  vs_campaign_avg_cpa_pct: number;
  has_breakpoint: boolean;
  breakpoint_month: string | null;
  performance_label: "overperformer" | "underperformer" | "gemiddeld";
}

export interface CampaignAdGroupSummary {
  campaign_name: string;
  total_ad_groups: number;
  overperformers: number;
  underperformers: number;
  gemiddeld: number;
  best_ad_group: string;
  best_ad_group_avg_conv: number;
  worst_ad_group: string;
  worst_ad_group_avg_conv: number;
}

export interface AggregatedAdGroupData {
  campaign_summaries: CampaignAdGroupSummary[];
  ad_group_details: AdGroupSummary[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
}

function r2(n: number): number {
  return parseFloat(n.toFixed(2));
}

function sortMonths(months: string[]): string[] {
  return [...months].sort();
}

// ── Main aggregation ────────────────────────────────────────────────────────

export function aggregateAdGroups(
  rawRows: RawAdGroupRow[],
  mentionedCampaigns: string[]
): AggregatedAdGroupData {
  // Filter to mentioned campaigns
  const filtered = mentionedCampaigns.length > 0
    ? rawRows.filter((r) => mentionedCampaigns.includes(r.campaign_name))
    : rawRows;

  if (filtered.length === 0) {
    return { campaign_summaries: [], ad_group_details: [] };
  }

  // Get all months sorted, determine last 3 and prev 3
  const allMonths = sortMonths([...new Set(filtered.map((r) => r.month))]);
  const last3Months = allMonths.slice(-3);
  const prev3Months = allMonths.slice(-6, -3);

  // Group by ad_group_id
  const byAdGroup = new Map<string, RawAdGroupRow[]>();
  for (const row of filtered) {
    const key = `${row.campaign_name}::${row.ad_group_id}`;
    if (!byAdGroup.has(key)) byAdGroup.set(key, []);
    byAdGroup.get(key)!.push(row);
  }

  // Compute campaign averages (last 3 months) for relative comparison
  const byCampaign = new Map<string, RawAdGroupRow[]>();
  for (const row of filtered) {
    if (!byCampaign.has(row.campaign_name)) byCampaign.set(row.campaign_name, []);
    byCampaign.get(row.campaign_name)!.push(row);
  }

  const campaignAvgs = new Map<string, { avgConv: number; avgRoas: number; avgCpa: number }>();
  for (const [campName, rows] of byCampaign) {
    const last3 = rows.filter((r) => last3Months.includes(r.month));
    const adGroupIds = [...new Set(last3.map((r) => r.ad_group_id))];
    // Per-adgroup averages, then average of those
    const adGroupConvAvgs: number[] = [];
    const adGroupRoasAvgs: number[] = [];
    const adGroupCpaAvgs: number[] = [];
    for (const agId of adGroupIds) {
      const agRows = last3.filter((r) => r.ad_group_id === agId);
      adGroupConvAvgs.push(avg(agRows.map((r) => r.conversions)));
      adGroupRoasAvgs.push(avg(agRows.map((r) => r.roas)));
      const costs = agRows.map((r) => r.cost);
      const convs = agRows.map((r) => r.conversions);
      const totalCost = costs.reduce((s, v) => s + v, 0);
      const totalConv = convs.reduce((s, v) => s + v, 0);
      adGroupCpaAvgs.push(totalConv > 0 ? totalCost / totalConv : totalCost);
    }
    campaignAvgs.set(campName, {
      avgConv: avg(adGroupConvAvgs),
      avgRoas: avg(adGroupRoasAvgs),
      avgCpa: avg(adGroupCpaAvgs),
    });
  }

  // Build per-adgroup summaries
  const adGroupDetails: AdGroupSummary[] = [];

  for (const [, rows] of byAdGroup) {
    const first = rows[0];
    const campAvg = campaignAvgs.get(first.campaign_name)!;

    const last3 = rows.filter((r) => last3Months.includes(r.month));
    const prev3 = rows.filter((r) => prev3Months.includes(r.month));

    const avgConvLast = avg(last3.map((r) => r.conversions));
    const avgConvPrev = avg(prev3.map((r) => r.conversions));

    const totalCostLast = last3.reduce((s, r) => s + r.cost, 0);
    const totalConvLast = last3.reduce((s, r) => s + r.conversions, 0);
    const avgCpaLast = totalConvLast > 0 ? totalCostLast / totalConvLast : totalCostLast;

    const totalCostPrev = prev3.reduce((s, r) => s + r.cost, 0);
    const totalConvPrev = prev3.reduce((s, r) => s + r.conversions, 0);
    const avgCpaPrev = totalConvPrev > 0 ? totalCostPrev / totalConvPrev : totalCostPrev;

    const avgRoasLast = avg(last3.map((r) => r.roas));
    const avgRoasPrev = avg(prev3.map((r) => r.roas));

    const avgCostLast = avg(last3.map((r) => r.cost));

    // Breakpoint detection: any single month >30% deviation from its neighbours
    const sortedRows = [...rows].sort((a, b) => a.month.localeCompare(b.month));
    let hasBreakpoint = false;
    let breakpointMonth: string | null = null;

    for (let i = 1; i < sortedRows.length; i++) {
      const prevConv = sortedRows[i - 1].conversions;
      const currConv = sortedRows[i].conversions;
      if (prevConv > 0) {
        const change = Math.abs((currConv - prevConv) / prevConv);
        if (change > 0.3) {
          hasBreakpoint = true;
          breakpointMonth = sortedRows[i].month;
          break;
        }
      } else if (currConv > 2) {
        // From 0 to something significant
        hasBreakpoint = true;
        breakpointMonth = sortedRows[i].month;
        break;
      }
    }

    // Performance label based on conversions vs campaign average
    const vsConvPct = campAvg.avgConv > 0
      ? ((avgConvLast - campAvg.avgConv) / campAvg.avgConv) * 100
      : 0;
    const label: AdGroupSummary["performance_label"] =
      vsConvPct > 15 ? "overperformer" :
      vsConvPct < -15 ? "underperformer" :
      "gemiddeld";

    const vsRoasPct = campAvg.avgRoas > 0
      ? ((avgRoasLast - campAvg.avgRoas) / campAvg.avgRoas) * 100
      : 0;
    const vsCpaPct = campAvg.avgCpa > 0
      ? ((avgCpaLast - campAvg.avgCpa) / campAvg.avgCpa) * 100
      : 0;

    adGroupDetails.push({
      ad_group_name: first.ad_group_name,
      campaign_name: first.campaign_name,
      months_with_data: rows.length,
      avg_conversions_last_3m: r2(avgConvLast),
      avg_conversions_prev_3m: r2(avgConvPrev),
      conversions_trend_pct: pctChange(avgConvLast, avgConvPrev),
      avg_cpa_last_3m: r2(avgCpaLast),
      avg_cpa_prev_3m: r2(avgCpaPrev),
      cpa_trend_pct: pctChange(avgCpaLast, avgCpaPrev),
      avg_roas_last_3m: r2(avgRoasLast),
      avg_roas_prev_3m: r2(avgRoasPrev),
      roas_trend_pct: pctChange(avgRoasLast, avgRoasPrev),
      avg_cost_last_3m: r2(avgCostLast),
      vs_campaign_avg_conversions_pct: r2(vsConvPct),
      vs_campaign_avg_roas_pct: r2(vsRoasPct),
      vs_campaign_avg_cpa_pct: r2(vsCpaPct),
      has_breakpoint: hasBreakpoint,
      breakpoint_month: breakpointMonth,
      performance_label: label,
    });
  }

  // Sort: underperformers first, then overperformers, then gemiddeld
  const labelOrder = { underperformer: 0, overperformer: 1, gemiddeld: 2 };
  adGroupDetails.sort((a, b) => labelOrder[a.performance_label] - labelOrder[b.performance_label]);

  // Build campaign summaries
  const campaignSummaries: CampaignAdGroupSummary[] = [];
  for (const [campName] of byCampaign) {
    const campAgs = adGroupDetails.filter((ag) => ag.campaign_name === campName);
    if (campAgs.length === 0) continue;

    const over = campAgs.filter((a) => a.performance_label === "overperformer").length;
    const under = campAgs.filter((a) => a.performance_label === "underperformer").length;
    const mid = campAgs.filter((a) => a.performance_label === "gemiddeld").length;

    const sorted = [...campAgs].sort((a, b) => b.avg_conversions_last_3m - a.avg_conversions_last_3m);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    campaignSummaries.push({
      campaign_name: campName,
      total_ad_groups: campAgs.length,
      overperformers: over,
      underperformers: under,
      gemiddeld: mid,
      best_ad_group: best.ad_group_name,
      best_ad_group_avg_conv: best.avg_conversions_last_3m,
      worst_ad_group: worst.ad_group_name,
      worst_ad_group_avg_conv: worst.avg_conversions_last_3m,
    });
  }

  return { campaign_summaries: campaignSummaries, ad_group_details: adGroupDetails };
}
