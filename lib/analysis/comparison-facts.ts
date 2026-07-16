/**
 * Deterministic comparison facts — precomputed before LLM narration.
 *
 * Produces exact percentage deltas, benchmark status labels, and target comparisons
 * so the LLM does NOT need to compute arithmetic. It only narrates.
 *
 * This prevents:
 * - Conflicting percentages in different steps
 * - Wrong benchmark interpretations (e.g., calling 2.16 "gemiddeld" when median is 3.68)
 * - Inconsistent target status labels
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface MetricComparison {
  metric: string;
  actual: number;
  benchmark: number;
  benchmarkType: string;     // "maandtarget" | "jaardoel" | "sector_mediaan" | "sector_top10" | "vorige_maand" | "vorig_jaar"
  deltaAbs: number;          // actual - benchmark
  deltaPct: number;          // ((actual - benchmark) / benchmark) * 100, rounded
  statusLabel: string;       // "OP SCHEMA" | "NIET OP SCHEMA" | "KRITIEK" | etc.
  direction: "hoger" | "lager" | "gelijk";
}

export interface BenchmarkLabel {
  metric: string;
  value: number;
  sectorLow: number | null;
  sectorMedian: number | null;
  sectorHigh: number | null;
  sectorTop10: number | null;
  label: string;  // "onder sectorgemiddelde" | "gemiddeld" | "goed voor de sector" | "top van de sector" | "top 10%"
  isInverse: boolean;  // true for CPA/CPC (lower is better)
}

export interface ComparisonFacts {
  targetComparisons: MetricComparison[];
  momComparisons: MetricComparison[];
  yoyComparisons: MetricComparison[];
  benchmarkLabels: BenchmarkLabel[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pctChange(actual: number, benchmark: number): number {
  if (benchmark === 0) return actual > 0 ? 100 : 0;
  return Math.round(((actual - benchmark) / benchmark) * 100 * 10) / 10;
}

function safePct(actual: number, benchmark: number): number {
  return pctChange(actual || 0, benchmark || 0);
}

function direction(delta: number): "hoger" | "lager" | "gelijk" {
  if (delta > 0.5) return "hoger";
  if (delta < -0.5) return "lager";
  return "gelijk";
}

function targetStatus(deltaPct: number, isInverse: boolean): string {
  const effective = isInverse ? -deltaPct : deltaPct;
  if (effective >= -5) return "OP SCHEMA";
  if (effective >= -20) return "NIET OP SCHEMA";
  return "KRITIEK";
}

// ── Benchmark labeling ─────────────────────────────────────────────────────

function labelBenchmark(
  value: number,
  low: number | null,
  median: number | null,
  high: number | null,
  top10: number | null,
  isInverse: boolean
): string {
  if (median === null) return "geen benchmark beschikbaar";

  if (isInverse) {
    // For CPA/CPC: lower is better
    if (top10 !== null && value <= top10) return "top 10% van de sector";
    if (high !== null && value <= high) return "goed voor de sector";
    if (value <= median) return "gemiddeld voor de sector";
    if (low !== null && value <= low) return "onder sectorgemiddelde";
    return "ruim onder sectorgemiddelde";
  } else {
    // For CTR/ROAS/Conv Rate: higher is better
    if (top10 !== null && value >= top10) return "top 10% van de sector";
    if (high !== null && value >= high) return "goed voor de sector";
    if (value >= median) return "gemiddeld voor de sector";
    if (low !== null && value >= low) return "onder sectorgemiddelde";
    return "ruim onder sectorgemiddelde";
  }
}

// ── Main computation ───────────────────────────────────────────────────────

interface AccountMonth {
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  avg_cpc: number;
  conversion_rate: number;
  cost_per_conversion: number;
  roas?: number;
}

interface MonthTarget {
  month: number;
  conversions: number;
  revenue: number;
  adSpend: number;
}

interface SectorBenchmarkRow {
  metric: string;
  low: number;
  median: number;
  high: number;
  top10: number;
}

interface KpiTargets {
  roasTarget?: number;
  cpaTarget?: number;
}

/**
 * Compute all deterministic comparison facts for the last complete month.
 * Returns structured text blocks to inject into the LLM context.
 */
export function computeComparisonFacts(opts: {
  accountData: AccountMonth[];
  monthlyTargets: MonthTarget[] | null;
  kpiTargets: KpiTargets | null;
  sectorBenchmarks: SectorBenchmarkRow[];
  lastCompleteMonth: number;
}): ComparisonFacts {
  const { accountData, monthlyTargets, kpiTargets, sectorBenchmarks, lastCompleteMonth } = opts;

  const targetComparisons: MetricComparison[] = [];
  const momComparisons: MetricComparison[] = [];
  const yoyComparisons: MetricComparison[] = [];
  const benchmarkLabels: BenchmarkLabel[] = [];

  // Find last complete month and previous month
  const sorted = [...accountData].sort((a, b) => a.month.localeCompare(b.month));
  const current = sorted.find((m) => parseInt(m.month.split("-")[1]) === lastCompleteMonth);
  const prevIdx = sorted.indexOf(current!) - 1;
  const previous = prevIdx >= 0 ? sorted[prevIdx] : null;

  // YoY: same month previous year
  const currentMonthStr = current?.month;
  const yoyMonth = currentMonthStr
    ? `${parseInt(currentMonthStr.split("-")[0]) - 1}-${currentMonthStr.split("-")[1]}-${currentMonthStr.split("-")[2]}`
    : null;
  const yoyData = yoyMonth ? sorted.find((m) => m.month === yoyMonth) : null;

  if (!current) return { targetComparisons, momComparisons, yoyComparisons, benchmarkLabels };

  const roas = current.cost > 0 ? current.conversions_value / current.cost : 0;
  const prevRoas = previous && previous.cost > 0 ? previous.conversions_value / previous.cost : null;

  // ── Target comparisons ──

  const monthTarget = monthlyTargets?.find((t) => t.month === lastCompleteMonth);

  if (monthTarget) {
    if (monthTarget.conversions > 0) {
      const delta = pctChange(current.conversions, monthTarget.conversions);
      targetComparisons.push({
        metric: "conversies", actual: Math.round(current.conversions),
        benchmark: monthTarget.conversions, benchmarkType: "maandtarget",
        deltaAbs: Math.round(current.conversions - monthTarget.conversions),
        deltaPct: delta, statusLabel: targetStatus(delta, false),
        direction: direction(delta),
      });
    }
    if (monthTarget.revenue > 0) {
      const delta = pctChange(current.conversions_value, monthTarget.revenue);
      targetComparisons.push({
        metric: "omzet", actual: Math.round(current.conversions_value),
        benchmark: monthTarget.revenue, benchmarkType: "maandtarget",
        deltaAbs: Math.round(current.conversions_value - monthTarget.revenue),
        deltaPct: delta, statusLabel: targetStatus(delta, false),
        direction: direction(delta),
      });
    }
    if (monthTarget.adSpend > 0) {
      const delta = pctChange(current.cost, monthTarget.adSpend);
      targetComparisons.push({
        metric: "spend", actual: Math.round(current.cost),
        benchmark: monthTarget.adSpend, benchmarkType: "maandtarget",
        deltaAbs: Math.round(current.cost - monthTarget.adSpend),
        deltaPct: delta, statusLabel: targetStatus(delta, true),
        direction: direction(delta),
      });
    }
  }

  if (kpiTargets?.roasTarget && kpiTargets.roasTarget > 0) {
    const target = kpiTargets.roasTarget;
    const delta = pctChange(roas, target);
    targetComparisons.push({
      metric: "ROAS", actual: Math.round(roas * 100) / 100,
      benchmark: target, benchmarkType: "ROAS target",
      deltaAbs: Math.round((roas - target) * 100) / 100,
      deltaPct: delta, statusLabel: targetStatus(delta, false),
      direction: direction(delta),
    });
  }

  if (kpiTargets?.cpaTarget && kpiTargets.cpaTarget > 0) {
    const cpa = current.cost_per_conversion || 0;
    const delta = pctChange(cpa, kpiTargets.cpaTarget);
    targetComparisons.push({
      metric: "CPA", actual: Math.round(cpa * 100) / 100,
      benchmark: kpiTargets.cpaTarget, benchmarkType: "CPA target",
      deltaAbs: Math.round((cpa - kpiTargets.cpaTarget) * 100) / 100,
      deltaPct: delta, statusLabel: targetStatus(delta, true),
      direction: direction(delta),
    });
  }

  // ── MoM comparisons ──

  if (previous) {
    const metrics: Array<{ name: string; cur: number; prev: number; inverse?: boolean }> = [
      { name: "conversies", cur: current.conversions, prev: previous.conversions },
      { name: "omzet", cur: current.conversions_value, prev: previous.conversions_value },
      { name: "spend", cur: current.cost, prev: previous.cost },
      { name: "CTR", cur: current.ctr, prev: previous.ctr },
      { name: "CPC", cur: current.avg_cpc, prev: previous.avg_cpc, inverse: true },
      { name: "conversieratio", cur: current.conversion_rate, prev: previous.conversion_rate },
      { name: "CPA", cur: current.cost_per_conversion, prev: previous.cost_per_conversion, inverse: true },
    ];
    if (roas !== null && prevRoas !== null) {
      metrics.push({ name: "ROAS", cur: roas, prev: prevRoas });
    }

    for (const m of metrics) {
      if (m.prev === 0 && m.cur === 0) continue;
      const delta = pctChange(m.cur, m.prev);
      momComparisons.push({
        metric: m.name,
        actual: Math.round(m.cur * 100) / 100,
        benchmark: Math.round(m.prev * 100) / 100,
        benchmarkType: "vorige_maand",
        deltaAbs: Math.round((m.cur - m.prev) * 100) / 100,
        deltaPct: delta,
        statusLabel: Math.abs(delta) > 30 ? "SIGNIFICANTE WIJZIGING" : "NORMAAL",
        direction: direction(delta),
      });
    }
  }

  // ── Sector benchmark labels ──

  const INVERSE_METRICS = new Set(["cpa", "avg_cpc"]);

  for (const bm of sectorBenchmarks) {
    const isInverse = INVERSE_METRICS.has(bm.metric);
    let value = 0;

    switch (bm.metric) {
      case "ctr": value = current.ctr; break;
      case "conversion_rate": value = current.conversion_rate; break;
      case "cpa": value = current.cost_per_conversion; break;
      case "roas": value = roas; break;
      case "avg_cpc": value = current.avg_cpc; break;
      default: continue;
    }

    benchmarkLabels.push({
      metric: bm.metric,
      value: Math.round(value * 100) / 100,
      sectorLow: bm.low,
      sectorMedian: bm.median,
      sectorHigh: bm.high,
      sectorTop10: bm.top10,
      label: labelBenchmark(value, bm.low, bm.median, bm.high, bm.top10, isInverse),
      isInverse,
    });
  }

  return { targetComparisons, momComparisons, yoyComparisons, benchmarkLabels };
}

// ── Format as injectable text ──────────────────────────────────────────────

/**
 * Format comparison facts as a text block to inject into the LLM user message.
 * The LLM must USE these exact numbers and labels — not recompute them.
 */
export function formatComparisonFacts(facts: ComparisonFacts): string {
  const lines: string[] = [];

  lines.push("## VOORBEREKENDE VERGELIJKINGEN (gebruik deze exacte waarden en labels — niet zelf herberekenen)");

  if (facts.targetComparisons.length > 0) {
    lines.push("\n### Doelstellingsstatus");
    for (const c of facts.targetComparisons) {
      lines.push(`- ${c.metric}: ${c.actual} vs ${c.benchmarkType} ${c.benchmark} → ${c.deltaPct > 0 ? "+" : ""}${c.deltaPct}% → ${c.statusLabel}`);
    }
  }

  if (facts.momComparisons.length > 0) {
    lines.push("\n### MoM vergelijking (maand-over-maand)");
    for (const c of facts.momComparisons) {
      lines.push(`- ${c.metric}: ${c.actual} vs vorige maand ${c.benchmark} → ${c.deltaPct > 0 ? "+" : ""}${c.deltaPct}% MoM (${c.direction})${c.statusLabel !== "NORMAAL" ? ` [${c.statusLabel}]` : ""}`);
    }
  }

  if (facts.benchmarkLabels.length > 0) {
    lines.push("\n### Sectorale benchmark status (GEBRUIK DEZE LABELS EXACT)");
    for (const b of facts.benchmarkLabels) {
      lines.push(`- ${b.metric}: ${b.value} → ${b.label} (sector mediaan: ${b.sectorMedian}, top 10%: ${b.sectorTop10})`);
    }
  }

  lines.push("\nKRITIEKE INSTRUCTIE: Gebruik de bovenstaande percentages en labels letterlijk in je analyse. Bereken GEEN eigen percentages — die zijn al correct berekend.");

  return lines.join("\n");
}


// ── Campaign-level MoM comparisons ────────────────────────────────────────

interface CampaignRow {
  campaign_id?: string;
  campaign_name: string;
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr?: number;
  avg_cpc?: number;
  conversion_rate?: number;
  cost_per_conversion?: number;
  roas?: number;
}

export interface CampaignComparisonFact {
  campaignName: string;
  spendMomPct: number;
  conversionsMomPct: number;
  roas: number;
  cpa: number;
  vsAccount: "boven" | "onder" | "gelijk";
  status: string;
  searchBudgetLostIs: number;
}

export interface AdGroupComparisonFact {
  campaignName: string;
  adGroupName: string;
  spendMomPct: number;
  conversionsMomPct: number;
  roas: number;
  cpa: number;
}

/**
 * Pre-compute MoM (month-over-month) changes for each campaign.
 * Returns formatted text block ready for injection into the LLM prompt.
 *
 * Compares the latest complete month with the previous month.
 * Only includes campaigns with meaningful spend (>€10 in either month).
 */
export function computeCampaignMomFacts(
  campaignData: CampaignRow[],
  lastCompleteMonth: number,
  analysisYear: number
): string {
  const facts = computeCampaignComparisonFacts({
    campaignData,
    lastCompleteMonth,
    analysisYear,
    accountType: "hybrid",
    kpiTargets: {},
  });
  if (facts.length === 0) return "";
  const latestMonthStr = `${analysisYear}-${String(lastCompleteMonth).padStart(2, "0")}`;
  const prevDate = new Date(analysisYear, lastCompleteMonth - 2, 1); // month is 0-indexed
  const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // Group by campaign
  const byCampaign = new Map<string, { cur?: CampaignRow; prev?: CampaignRow }>();
  for (const row of campaignData) {
    const ym = row.month.slice(0, 7);
    const name = row.campaign_name;
    if (!byCampaign.has(name)) byCampaign.set(name, {});
    const entry = byCampaign.get(name)!;
    if (ym === latestMonthStr) entry.cur = row;
    else if (ym === prevMonthStr) entry.prev = row;
  }

  const lines: string[] = [];
  lines.push(`## CAMPAGNE MOM VERGELIJKING (${prevMonthStr} → ${latestMonthStr}, voorberekend)`);
  lines.push("Gebruik deze exacte waarden — niet zelf herberekenen.\n");

  const pct = (cur: number, prev: number): string => {
    if (prev === 0) return cur > 0 ? "+∞%" : "0%";
    const p = ((cur - prev) / prev * 100);
    return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
  };

  const fmt = (v: number): string => v < 100 ? v.toFixed(2) : Math.round(v).toString();

  let count = 0;
  for (const [name, { cur, prev }] of byCampaign) {
    // Skip campaigns with negligible spend
    if ((!cur || cur.cost < 10) && (!prev || prev.cost < 10)) continue;

    const c = cur ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 } as CampaignRow;
    const p = prev ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 } as CampaignRow;

    const cRoas = c.cost > 0 ? c.conversions_value / c.cost : 0;
    const pRoas = p.cost > 0 ? p.conversions_value / p.cost : 0;
    const cCpa = c.conversions > 0 ? c.cost / c.conversions : 0;
    const pCpa = p.conversions > 0 ? p.cost / p.conversions : 0;

    lines.push(`### ${name}`);
    lines.push(`  Spend: €${fmt(p.cost)} → €${fmt(c.cost)} (${pct(c.cost, p.cost)})`);
    lines.push(`  Conversies: ${fmt(p.conversions)} → ${fmt(c.conversions)} (${pct(c.conversions, p.conversions)})`);
    lines.push(`  Omzet: €${fmt(p.conversions_value)} → €${fmt(c.conversions_value)} (${pct(c.conversions_value, p.conversions_value)})`);
    lines.push(`  ROAS: ${pRoas.toFixed(2)}x → ${cRoas.toFixed(2)}x (${pct(cRoas, pRoas)})`);
    if (cCpa > 0 || pCpa > 0) {
      lines.push(`  CPA: €${fmt(pCpa)} → €${fmt(cCpa)} (${pct(cCpa, pCpa)})`);
    }
    if (!prev) lines.push(`  ⚡ Nieuwe campagne (niet actief vorige maand)`);
    else if (!cur || c.cost === 0) lines.push(`  ⚠ Gestopt/gepauzeerd deze maand`);
    lines.push("");
    count++;
  }

  if (count === 0) return "";
  return lines.join("\n");
}

export function computeCampaignComparisonFacts(opts: {
  campaignData: CampaignRow[];
  lastCompleteMonth: number;
  analysisYear: number;
  accountType: string;
  kpiTargets: { roasTarget?: number; cpaTarget?: number };
}): CampaignComparisonFact[] {
  const latestMonthStr = `${opts.analysisYear}-${String(opts.lastCompleteMonth).padStart(2, "0")}`;
  const prevDate = new Date(opts.analysisYear, opts.lastCompleteMonth - 2, 1);
  const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const currentRows = opts.campaignData.filter((row) => row.month.slice(0, 7) === latestMonthStr);
  const previousRows = new Map(
    opts.campaignData
      .filter((row) => row.month.slice(0, 7) === prevMonthStr)
      .map((row) => [row.campaign_name, row])
  );
  const accountRoas = currentRows.reduce((sum, row) => sum + (row.conversions_value || 0), 0) / Math.max(1, currentRows.reduce((sum, row) => sum + (row.cost || 0), 0));

  return currentRows
    .filter((row) => (row.cost || 0) > 0)
    .map((row) => {
      const prev = previousRows.get(row.campaign_name);
      const spendMomPct = safePct(row.cost || 0, prev?.cost || 0);
      const conversionsMomPct = safePct(row.conversions || 0, prev?.conversions || 0);
      const roas = row.roas ?? ((row.cost || 0) > 0 ? (row.conversions_value || 0) / (row.cost || 1) : 0);
      const cpa = row.cost_per_conversion ?? ((row.conversions || 0) > 0 ? (row.cost || 0) / (row.conversions || 1) : 0);
      const vsAccount: "boven" | "onder" | "gelijk" = roas > accountRoas * 1.15 ? "boven" : roas < accountRoas * 0.85 ? "onder" : "gelijk";
      const status = opts.kpiTargets.roasTarget && opts.kpiTargets.roasTarget > 0
        ? (roas >= opts.kpiTargets.roasTarget ? "OP SCHEMA" : roas >= opts.kpiTargets.roasTarget * 0.8 ? "NIET OP SCHEMA" : "KRITIEK")
        : opts.kpiTargets.cpaTarget && opts.kpiTargets.cpaTarget > 0
          ? (cpa <= opts.kpiTargets.cpaTarget ? "OP SCHEMA" : cpa <= opts.kpiTargets.cpaTarget * 1.3 ? "NIET OP SCHEMA" : "KRITIEK")
          : "MONITOR";
      return {
        campaignName: row.campaign_name,
        spendMomPct,
        conversionsMomPct,
        roas: Math.round(roas * 100) / 100,
        cpa: Math.round(cpa * 100) / 100,
        vsAccount,
        status,
        searchBudgetLostIs: 0,
      };
    })
    .sort((a, b) => Math.abs(b.spendMomPct) - Math.abs(a.spendMomPct));
}

export function formatCampaignComparisonTable(facts: CampaignComparisonFact[]): string {
  if (facts.length === 0) return "";
  const lines = [
    "## Pre-computed campagne-vergelijkingen (reken NIET zelf, gebruik deze waarden)",
    "",
    "| Campagne | Spend MoM | Conv MoM | ROAS | CPA | vs Account | Status |",
    "|----------|-----------|----------|------|-----|------------|--------|",
  ];
  facts.slice(0, 15).forEach((fact) => {
    lines.push(`| ${fact.campaignName} | ${fact.spendMomPct >= 0 ? "+" : ""}${fact.spendMomPct}% | ${fact.conversionsMomPct >= 0 ? "+" : ""}${fact.conversionsMomPct}% | ${fact.roas.toFixed(2)}x | €${fact.cpa.toFixed(2)} | ${fact.vsAccount} | ${fact.status} |`);
  });
  return lines.join("\n");
}

/**
 * Pre-compute ad group MoM changes for the most relevant ad groups.
 * Only includes ad groups mentioned by the AI in step 2, or top spenders.
 */
export function computeAdGroupMomFacts(
  adgroupData: Array<{ ad_group_name: string; campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number; clicks: number; impressions: number }>,
  lastCompleteMonth: number,
  analysisYear: number
): string {
  const latestMonthStr = `${analysisYear}-${String(lastCompleteMonth).padStart(2, "0")}`;
  const prevDate = new Date(analysisYear, lastCompleteMonth - 2, 1);
  const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // Group by ad group
  const byGroup = new Map<string, { campaign: string; cur?: typeof adgroupData[0]; prev?: typeof adgroupData[0] }>();
  for (const row of adgroupData) {
    const ym = row.month.slice(0, 7);
    const key = `${row.campaign_name}|||${row.ad_group_name}`;
    if (!byGroup.has(key)) byGroup.set(key, { campaign: row.campaign_name });
    const entry = byGroup.get(key)!;
    if (ym === latestMonthStr) entry.cur = row;
    else if (ym === prevMonthStr) entry.prev = row;
  }

  const lines: string[] = [];
  lines.push(`## AD GROUP MOM VERGELIJKING (${prevMonthStr} → ${latestMonthStr}, voorberekend)`);
  lines.push("Top ad groups op basis van spend. Gebruik deze exacte waarden.\n");

  const pct = (cur: number, prev: number): string => {
    if (prev === 0) return cur > 0 ? "+∞%" : "0%";
    const p = ((cur - prev) / prev * 100);
    return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
  };
  const fmt = (v: number): string => v < 100 ? v.toFixed(2) : Math.round(v).toString();

  // Sort by current spend, take top 20
  const sorted = Array.from(byGroup.entries())
    .sort((a, b) => (b[1].cur?.cost ?? 0) - (a[1].cur?.cost ?? 0))
    .slice(0, 20);

  let count = 0;
  for (const [key, { campaign, cur, prev }] of sorted) {
    if ((!cur || cur.cost < 5) && (!prev || prev.cost < 5)) continue;
    const agName = key.split("|||")[1];
    const c = cur ?? { cost: 0, conversions: 0, conversions_value: 0, clicks: 0, impressions: 0 };
    const p = prev ?? { cost: 0, conversions: 0, conversions_value: 0, clicks: 0, impressions: 0 };

    lines.push(`- **${agName}** (${campaign}): spend €${fmt(p.cost)}→€${fmt(c.cost)} (${pct(c.cost, p.cost)}), conv ${fmt(p.conversions)}→${fmt(c.conversions)} (${pct(c.conversions, p.conversions)})`);
    count++;
  }

  if (count === 0) return "";
  return lines.join("\n");
}

export function computeAdGroupComparisonFacts(opts: {
  adgroupData: Array<{ ad_group_name: string; campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number; clicks: number; impressions: number; cost_per_conversion?: number; roas?: number }>;
  lastCompleteMonth: number;
  analysisYear: number;
}): AdGroupComparisonFact[] {
  const latestMonthStr = `${opts.analysisYear}-${String(opts.lastCompleteMonth).padStart(2, "0")}`;
  const prevDate = new Date(opts.analysisYear, opts.lastCompleteMonth - 2, 1);
  const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const previousRows = new Map(
    opts.adgroupData
      .filter((row) => row.month.slice(0, 7) === prevMonthStr)
      .map((row) => [`${row.campaign_name}|||${row.ad_group_name}`, row])
  );

  return opts.adgroupData
    .filter((row) => row.month.slice(0, 7) === latestMonthStr)
    .map((row) => {
      const prev = previousRows.get(`${row.campaign_name}|||${row.ad_group_name}`);
      const roas = row.roas ?? (row.cost > 0 ? row.conversions_value / row.cost : 0);
      const cpa = row.cost_per_conversion ?? (row.conversions > 0 ? row.cost / row.conversions : 0);
      return {
        campaignName: row.campaign_name,
        adGroupName: row.ad_group_name,
        spendMomPct: safePct(row.cost, prev?.cost || 0),
        conversionsMomPct: safePct(row.conversions, prev?.conversions || 0),
        roas: Math.round(roas * 100) / 100,
        cpa: Math.round(cpa * 100) / 100,
      };
    })
    .filter((row) => Number.isFinite(row.spendMomPct))
    .sort((a, b) => Math.abs(b.spendMomPct) - Math.abs(a.spendMomPct))
    .slice(0, 20);
}
