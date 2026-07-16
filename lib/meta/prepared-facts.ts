// M2 data-laag (fact-assemblage): zet de Meta-rijen om in de compacte voorgerekende feiten
// per SOP-stap, op de rekenkern uit prepared-compute. De route levert de rijen (uit de
// M1-tabellen) en serialiseert facts[stepNumber] in de prepared context van die stap, zodat
// het model rekent met aangeleverde getallen. Pure functies, op fixtures te testen.

import {
  aggregateMonthly,
  computeMoMChain,
  computeVsAverage,
  deriveFromRows,
  detectAdFatigue,
  groupBy,
  safeDiv,
  trendDirection,
  type DerivedMetrics,
  type MetaComputeRow,
} from "./prepared-compute";

// Breakdown-rijen (long-format uit meta_breakdown_daily) voor stap 6 en 7.
export interface MetaBreakdownComputeRow {
  date: string;
  breakdown_type: string; // publisher_platform, platform_position, impression_device, age_gender, country, region
  breakdown_value: string;
  impressions: number;
  spend: number;
  link_clicks: number;
  conversions: number;
  conversion_value: number;
}

export interface MetaPreparedInputs {
  account: MetaComputeRow[]; // meta_account_daily, 13 maanden
  campaigns: MetaComputeRow[]; // meta_campaign_daily (entity_id = campagne)
  adsets: MetaComputeRow[]; // meta_adset_daily
  ads: MetaComputeRow[]; // meta_ad_daily
  breakdowns?: MetaBreakdownComputeRow[];
  targets?: { roasTarget?: number | null; cpaTarget?: number | null };
}

export type MetaStepFacts = Record<number, unknown>;

function round(value: number | null, decimals = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
function pct(value: number | null): number | null {
  return value === null ? null : round(value * 100);
}
function sumField<T>(rows: T[], key: keyof T): number {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}
function avgFrequency(rows: MetaComputeRow[]): number | null {
  const vals = rows.map((r) => r.frequency).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length > 0) return round(vals.reduce((a, b) => a + b, 0) / vals.length);
  return safeDiv(sumField(rows, "impressions"), sumField(rows, "reach"));
}
function latestMonthOf(rows: MetaComputeRow[]): string | null {
  const months = aggregateMonthly(rows).map((m) => m.month);
  return months.length ? months[months.length - 1] : null;
}
function rowsInMonth(rows: MetaComputeRow[], month: string | null): MetaComputeRow[] {
  if (!month) return [];
  return rows.filter((r) => String(r.date || "").slice(0, 7) === month);
}

// Stap 1: account-performance. MoM-keten, trends, en target-gap met status.
function buildAccountFacts(account: MetaComputeRow[], targets?: MetaPreparedInputs["targets"]) {
  const monthly = aggregateMonthly(account);
  const momRes = computeMoMChain(monthly);
  const latest = monthly[monthly.length - 1];
  const trends = (["roas", "cpa", "conversions", "link_ctr_pct"] as const).map((key) => ({
    metric: key,
    trend_2m: trendDirection(monthly, key, 2),
    trend_13m: trendDirection(monthly, key, 13),
  }));

  const roasTarget = Number(targets?.roasTarget || 0);
  const cpaTarget = Number(targets?.cpaTarget || 0);
  const roasActual = latest?.roas ?? null;
  const cpaActual = latest?.cpa ?? null;
  let target: Record<string, unknown> | null = null;
  if (roasTarget > 0 && roasActual !== null) {
    const gap = round(((roasActual - roasTarget) / roasTarget) * 100);
    const status = roasActual >= roasTarget ? "OP SCHEMA" : roasActual >= roasTarget * 0.9 ? "NIET OP SCHEMA" : "KRITIEK";
    target = { type: "ROAS", target: roasTarget, actual: roasActual, gap_pct: gap, status };
  } else if (cpaTarget > 0 && cpaActual !== null) {
    const gap = round(((cpaActual - cpaTarget) / cpaTarget) * 100);
    const status = cpaActual <= cpaTarget ? "OP SCHEMA" : cpaActual <= cpaTarget * 1.1 ? "NIET OP SCHEMA" : "KRITIEK";
    target = { type: "CPA", target: cpaTarget, actual: cpaActual, gap_pct: gap, status };
  }

  return { months_available: monthly.length, latest_month: momRes.latest_month, previous_month: momRes.previous_month, mom_chain: momRes.chain, trends, target };
}

const ENTITY_KPIS: Array<{ metric: string; key: keyof DerivedMetrics }> = [
  { metric: "Link CTR", key: "link_ctr_pct" },
  { metric: "CPA", key: "cpa" },
  { metric: "ROAS", key: "roas" },
  { metric: "CVR", key: "cvr_pct" },
];

// Stap 2/3: entiteiten (campagnes of adsets) versus het accountgemiddelde van de laatste maand.
function buildEntityVsAccountFacts(entityRows: MetaComputeRow[], accountBenchmark: DerivedMetrics, latestMonth: string | null) {
  const byEntity = groupBy(entityRows, (r) => r.entity_id);
  const entities = [...byEntity.entries()].map(([entity_id, rows]) => {
    const latestRows = rowsInMonth(rows, latestMonth);
    const d = deriveFromRows(latestRows);
    const vs_average = ENTITY_KPIS.map(({ metric, key }) => computeVsAverage(metric, d[key] as number | null, accountBenchmark[key] as number | null));
    const mom = computeMoMChain(aggregateMonthly(rows));
    return {
      entity_id,
      entity_name: rows.find((r) => r.entity_name)?.entity_name ?? entity_id,
      link_ctr_pct: d.link_ctr_pct,
      cpa: d.cpa,
      roas: d.roas,
      cvr_pct: d.cvr_pct,
      spend: d.spend,
      conversions: d.conversions,
      frequency: avgFrequency(latestRows),
      vs_average,
      mom_link_ctr: mom.chain.find((c) => c.metric === "Link CTR")?.delta_pct ?? null,
    };
  });
  // Sorteer op grootste afwijking van het gemiddelde (Link CTR) zodat de route makkelijk kan trimmen.
  entities.sort((a, b) => Math.abs((b.vs_average[0]?.delta_pct ?? 0)) - Math.abs((a.vs_average[0]?.delta_pct ?? 0)));
  return { account_benchmark: accountBenchmark, latest_month: latestMonth, entities };
}

// Stap 4: creative-performance kwantitatief. Fatigue plus winnaar/bleeder versus accountgemiddelde.
function classifyAd(d: DerivedMetrics, bench: DerivedMetrics, fatigue: boolean): "winnaar" | "bleeder" | "neutraal" {
  if (d.roas !== null && bench.roas !== null && bench.roas > 0) {
    if (d.roas >= bench.roas * 1.1) return "winnaar";
    if (d.roas <= bench.roas * 0.9 || fatigue) return "bleeder";
  } else if (d.cpa !== null && bench.cpa !== null && bench.cpa > 0) {
    if (d.cpa <= bench.cpa * 0.9) return "winnaar";
    if (d.cpa >= bench.cpa * 1.1 || fatigue) return "bleeder";
  }
  return fatigue ? "bleeder" : "neutraal";
}

function buildAdFacts(ads: MetaComputeRow[], accountBenchmark: DerivedMetrics, latestMonth: string | null) {
  const fatigueByAd = new Map(detectAdFatigue(ads).map((f) => [f.entity_id, f]));
  const byAd = groupBy(ads, (r) => r.entity_id);
  const adFacts = [...byAd.entries()].map(([entity_id, rows]) => {
    const latestRows = rowsInMonth(rows, latestMonth);
    const d = deriveFromRows(latestRows.length ? latestRows : rows);
    const fatigue = fatigueByAd.get(entity_id);
    const vs_average = ENTITY_KPIS.map(({ metric, key }) => computeVsAverage(metric, d[key] as number | null, accountBenchmark[key] as number | null));
    return {
      entity_id,
      entity_name: rows.find((r) => r.entity_name)?.entity_name ?? entity_id,
      hook_rate_pct: d.hook_rate_pct,
      hold_rate_pct: d.hold_rate_pct,
      link_ctr_pct: d.link_ctr_pct,
      cpa: d.cpa,
      roas: d.roas,
      vs_average,
      fatigue: fatigue ? { flag: fatigue.fatigue, baseline_link_ctr_pct: fatigue.baseline_link_ctr_pct, recent_link_ctr_pct: fatigue.recent_link_ctr_pct, ctr_change_pct: fatigue.ctr_change_pct, recent_frequency: fatigue.recent_frequency, days_live: fatigue.days_live } : null,
      classification: classifyAd(d, accountBenchmark, Boolean(fatigue?.fatigue)),
    };
  });
  adFacts.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  return { account_benchmark: accountBenchmark, latest_month: latestMonth, ads: adFacts };
}

// Stap 6/7: breakdown-segmenten versus het accountgemiddelde, met waste- en volume-vlaggen.
function buildBreakdownFacts(rows: MetaBreakdownComputeRow[] | undefined, types: string[], accountBenchmark: DerivedMetrics, minConversions: number) {
  if (!rows || rows.length === 0) return { available: false, segments: [] as unknown[] };
  const filtered = rows.filter((r) => types.includes(r.breakdown_type));
  if (filtered.length === 0) return { available: false, segments: [] as unknown[] };
  const byValue = groupBy(filtered, (r) => `${r.breakdown_type}~~${r.breakdown_value}`);
  const segments = [...byValue.values()].map((segRows) => {
    const asCompute: MetaComputeRow[] = segRows.map((r) => ({ date: r.date, entity_id: r.breakdown_value, impressions: r.impressions, spend: r.spend, link_clicks: r.link_clicks, conversions: r.conversions, conversion_value: r.conversion_value }));
    const d = deriveFromRows(asCompute);
    return {
      breakdown_type: segRows[0].breakdown_type,
      breakdown_value: segRows[0].breakdown_value,
      spend: d.spend,
      conversions: d.conversions,
      link_ctr_pct: d.link_ctr_pct,
      cpa: d.cpa,
      roas: d.roas,
      vs_average: [computeVsAverage("Link CTR", d.link_ctr_pct, accountBenchmark.link_ctr_pct), computeVsAverage("CPA", d.cpa, accountBenchmark.cpa), computeVsAverage("ROAS", d.roas, accountBenchmark.roas)],
      waste: d.spend > 0 && d.conversions === 0,
      volume_ok: d.conversions >= minConversions,
    };
  });
  segments.sort((a, b) => b.spend - a.spend);
  return { available: true, segments };
}

// Stap 8: funnel-drop-offs per fase, laatste maand versus de 3-maands lijn.
const FUNNEL_STAGES: Array<{ from: string; to: string; label: string }> = [
  { from: "impressions", to: "landing_page_views", label: "Impressions naar Landing page views" },
  { from: "landing_page_views", to: "add_to_cart", label: "Landing page views naar Add to cart" },
  { from: "add_to_cart", to: "initiate_checkout", label: "Add to cart naar Initiate checkout" },
  { from: "initiate_checkout", to: "conversions", label: "Initiate checkout naar Conversies" },
];

function funnelSumsByMonth(account: MetaComputeRow[]): Map<string, Record<string, number>> {
  const byMonth = groupBy(account, (r) => String(r.date || "").slice(0, 7));
  const out = new Map<string, Record<string, number>>();
  for (const [month, rows] of byMonth) {
    out.set(month, {
      impressions: sumField(rows, "impressions"),
      landing_page_views: sumField(rows, "landing_page_views"),
      add_to_cart: sumField(rows, "add_to_cart"),
      initiate_checkout: sumField(rows, "initiate_checkout"),
      conversions: sumField(rows, "conversions"),
    });
  }
  return out;
}

function buildFunnelFacts(account: MetaComputeRow[]) {
  const byMonth = funnelSumsByMonth(account);
  const months = [...byMonth.keys()].filter(Boolean).sort();
  if (months.length === 0) return { available: false, stages: [] as unknown[] };
  const hasFunnel = months.some((m) => (byMonth.get(m)?.landing_page_views || 0) > 0 || (byMonth.get(m)?.add_to_cart || 0) > 0);
  if (!hasFunnel) return { available: false, stages: [] as unknown[] };
  const latest = byMonth.get(months[months.length - 1])!;
  const prior3 = months.slice(-4, -1).map((m) => byMonth.get(m)!).filter(Boolean);
  const dropoff = (s: Record<string, number>, from: string, to: string): number | null => {
    const f = s[from] || 0;
    const t = s[to] || 0;
    return f > 0 ? round((1 - t / f) * 100) : null;
  };
  const stages = FUNNEL_STAGES.map(({ from, to, label }) => {
    const latestDrop = dropoff(latest, from, to);
    const priorDrops = prior3.map((s) => dropoff(s, from, to)).filter((v): v is number => v !== null);
    const priorAvg = priorDrops.length ? round(priorDrops.reduce((a, b) => a + b, 0) / priorDrops.length) : null;
    return { stage: label, latest_dropoff_pct: latestDrop, prior3_dropoff_pct: priorAvg, flag_high: latestDrop !== null && latestDrop > 50 };
  });
  return { available: true, latest_month: months[months.length - 1], stages };
}

// Stap 9: frequency-trend versus CTR-trend op accountniveau.
function buildFrequencyFacts(account: MetaComputeRow[]) {
  const monthly = aggregateMonthly(account);
  const freqByMonth = groupBy(account, (r) => String(r.date || "").slice(0, 7));
  const freqSeries = [...freqByMonth.keys()].filter(Boolean).sort().map((m) => avgFrequency(freqByMonth.get(m) ?? []));
  const firstFreq = freqSeries.find((v) => v !== null) ?? null;
  const lastFreq = [...freqSeries].reverse().find((v) => v !== null) ?? null;
  return {
    frequency_first: firstFreq,
    frequency_latest: lastFreq,
    frequency_trend: trendDirection(monthly.map((m, i) => ({ ...m, link_ctr_pct: freqSeries[i] ?? null })), "link_ctr_pct", monthly.length),
    link_ctr_trend: trendDirection(monthly, "link_ctr_pct", monthly.length),
    saturation_signal: lastFreq !== null && firstFreq !== null && lastFreq > firstFreq && trendDirection(monthly, "link_ctr_pct", monthly.length) === "daalt",
  };
}

const WEEKDAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

// Stap 10: weekdagpatroon versus het overall gemiddelde.
function buildScheduleFacts(account: MetaComputeRow[]) {
  const byWeekday = groupBy(account.filter((r) => r.date), (r) => String(new Date(r.date + "T00:00:00Z").getUTCDay()));
  const overall = deriveFromRows(account);
  const days = [...byWeekday.entries()].map(([wd, rows]) => {
    const d = deriveFromRows(rows);
    return {
      weekday: WEEKDAYS[Number(wd)] ?? wd,
      link_ctr_pct: d.link_ctr_pct,
      cpa: d.cpa,
      roas: d.roas,
      vs_average: [computeVsAverage("Link CTR", d.link_ctr_pct, overall.link_ctr_pct), computeVsAverage("CPA", d.cpa, overall.cpa)],
    };
  });
  const material = days.some((day) => day.vs_average.some((v) => v.delta_pct !== null && Math.abs(v.delta_pct) > 15));
  return { material_signal: material, days };
}

// De volledige assemblage: facts per stap (1 tot en met 11).
export function buildMetaStepFacts(inputs: MetaPreparedInputs): MetaStepFacts {
  const accountMonthly = aggregateMonthly(inputs.account);
  const latestMonth = latestMonthOf(inputs.account);
  const accountBenchmark = deriveFromRows(rowsInMonth(inputs.account, latestMonth));

  return {
    1: buildAccountFacts(inputs.account, inputs.targets),
    2: buildEntityVsAccountFacts(inputs.campaigns, accountBenchmark, latestMonth),
    3: buildEntityVsAccountFacts(inputs.adsets, accountBenchmark, latestMonth),
    4: buildAdFacts(inputs.ads, accountBenchmark, latestMonth),
    5: { available: false, note: "Visuele deep-dive vereist vision-data uit M3; geen pre-compute in deze laag. Stap degradeert naar 1 regel." },
    6: buildBreakdownFacts(inputs.breakdowns, ["publisher_platform", "platform_position", "impression_device"], accountBenchmark, 0),
    7: buildBreakdownFacts(inputs.breakdowns, ["age_gender", "country", "region", "dma"], accountBenchmark, 10),
    8: buildFunnelFacts(inputs.account),
    9: buildFrequencyFacts(inputs.account),
    10: buildScheduleFacts(inputs.account),
    11: { note: "Synthese uit stap 1 tot en met 10 en de canonical claim-set; geen nieuwe pre-compute.", account_months: accountMonthly.length },
  };
}
