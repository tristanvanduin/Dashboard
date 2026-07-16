// L2 facts-assemblage: combineert de rekenkern (prepared-compute) en de ICP-fit tot de
// voorgerekende feiten per stap. Het model krijgt per stap een compact feitenblok en rekent
// niet zelf. Gespiegeld op de M2 prepared-facts, met de 9 LinkedIn-stappen. Puur, geen I/O.

import {
  aggregateMonthly, deriveFromRows, computeMoMChain, trendDirection, computeVsAverage, groupBy, safeDiv,
  type LinkedInComputeRow, type DerivedMetrics,
} from "./prepared-compute";
import { computeIcpFit, isIcpEmpty, type LinkedInIcp } from "./icp-fit";
import type { LinkedInDemographicRow } from "./types";

export interface LinkedInCampaignMeta {
  entityUrn: string;
  name?: string | null;
  objective?: string | null;
  cost_type?: string | null;
  bid_strategy?: string | null;
  audience_count?: number | null;
}

export interface LinkedInCreativeMeta {
  entityUrn: string;
  format?: string | null;
}

export interface LinkedInPreparedInputs {
  account: LinkedInComputeRow[]; // linkedin_account_daily, 13 maanden
  campaigns: LinkedInComputeRow[]; // linkedin_campaign_daily (entityUrn = campagne)
  creatives: LinkedInComputeRow[]; // linkedin_creative_daily (entityUrn = creative)
  demographics?: LinkedInDemographicRow[]; // linkedin_demographic_daily
  campaignMeta?: LinkedInCampaignMeta[];
  creativeMeta?: LinkedInCreativeMeta[];
  icp?: LinkedInIcp | null;
  targets?: { cplTarget?: number | null; conversionTarget?: number | null };
}

export type LinkedInStepFacts = Record<number, unknown>;

function round(value: number | null, decimals = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
function pct(value: number | null): number | null {
  return value === null ? null : round(value * 100);
}
function sumField(rows: LinkedInComputeRow[], key: keyof LinkedInComputeRow): number {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}
function rowsInMonth(rows: LinkedInComputeRow[], month: string | null): LinkedInComputeRow[] {
  if (!month) return rows;
  return rows.filter((r) => String(r.date || "").slice(0, 7) === month);
}
function latestMonthOf(rows: LinkedInComputeRow[]): string | null {
  const months = aggregateMonthly(rows).map((m) => m.month);
  return months.length ? months[months.length - 1] : null;
}

// Stap 1: account-MoM-keten, trends over 2 en 13 maanden, en de CPL-target-gap (lager is beter).
function buildAccountFacts(account: LinkedInComputeRow[], targets?: LinkedInPreparedInputs["targets"]): unknown {
  const monthly = aggregateMonthly(account);
  const mom = computeMoMChain(monthly);
  const latest = monthly[monthly.length - 1];
  const cpl = latest?.cpl ?? null;
  const cplTarget = targets?.cplTarget ?? null;
  const targetGap =
    cpl != null && cplTarget != null
      ? { cpl, target: cplTarget, status: cpl <= cplTarget ? "OP SCHEMA" : cpl <= cplTarget * 1.2 ? "NIET OP SCHEMA" : "KRITIEK" }
      : null;
  return {
    latest_month: mom.latest_month,
    previous_month: mom.previous_month,
    mom_chain: mom.chain,
    trend_2m: { leads: trendDirection(monthly, "leads", 2), cpl: trendDirection(monthly, "cpl", 2), ctr: trendDirection(monthly, "ctr_pct", 2) },
    trend_13m: { leads: trendDirection(monthly, "leads", 13), cpl: trendDirection(monthly, "cpl", 13) },
    target_gap: targetGap,
    months_available: monthly.length,
  };
}

// Stap 2/3: entiteiten (campagnes) versus het accountgemiddelde in de laatste maand.
function buildEntityVsAccountFacts(
  entities: LinkedInComputeRow[],
  accountBenchmark: DerivedMetrics,
  latestMonth: string | null,
  meta?: LinkedInCampaignMeta[]
): unknown {
  const byEntity = groupBy(rowsInMonth(entities, latestMonth), (r) => r.entityUrn ?? "unknown");
  const metaByUrn = new Map((meta ?? []).map((m) => [m.entityUrn, m]));
  const facts = [...byEntity.entries()].map(([urn, rows]) => {
    const d = deriveFromRows(rows);
    const m = metaByUrn.get(urn);
    return {
      entity: urn,
      name: rows[0]?.entityName ?? m?.name ?? null,
      objective: m?.objective ?? null,
      cost_type: m?.cost_type ?? null,
      leads: d.leads,
      spend: d.spend,
      cpl: computeVsAverage("CPL", d.cpl, accountBenchmark.cpl),
      ctr: computeVsAverage("CTR", d.ctr_pct, accountBenchmark.ctr_pct),
    };
  });
  return { latest_month: latestMonth, entities: facts };
}

// CTR-verval per creative als slijtage-proxy: eerste actieve dagen versus recente actieve dagen.
function ctrDecay(rows: LinkedInComputeRow[]): unknown {
  const active = rows.filter((r) => (r.impressions ?? 0) > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (active.length < 6) return null;
  const window = Math.min(7, Math.floor(active.length / 2));
  const first = active.slice(0, window);
  const last = active.slice(-window);
  const firstCtr = safeDiv(sumField(first, "clicks"), sumField(first, "impressions"));
  const lastCtr = safeDiv(sumField(last, "clicks"), sumField(last, "impressions"));
  if (firstCtr === null || lastCtr === null) return null;
  return {
    first_ctr_pct: pct(firstCtr),
    last_ctr_pct: pct(lastCtr),
    decline_pct: firstCtr === 0 ? null : round(((lastCtr - firstCtr) / firstCtr) * 100),
    days_live: active.length,
  };
}

// Stap 4: creatives per format versus format- en accountgemiddelde, winnaars/bleeders, CTR-verval.
function buildCreativeFacts(
  creatives: LinkedInComputeRow[],
  accountBenchmark: DerivedMetrics,
  latestMonth: string | null,
  creativeMeta?: LinkedInCreativeMeta[]
): unknown {
  const formatByUrn = new Map((creativeMeta ?? []).map((m) => [m.entityUrn, m.format ?? "onbekend"]));
  const monthRows = rowsInMonth(creatives, latestMonth);
  const byCreative = groupBy(monthRows, (r) => r.entityUrn ?? "unknown");

  // Formatgemiddelden over de laatste maand.
  const byFormat = groupBy(monthRows, (r) => formatByUrn.get(r.entityUrn ?? "") ?? "onbekend");
  const formatAverages: Record<string, DerivedMetrics> = {};
  for (const [format, rows] of byFormat) formatAverages[format] = deriveFromRows(rows);

  const creativesFacts = [...byCreative.entries()].map(([urn, rows]) => {
    const d = deriveFromRows(rows);
    const format = formatByUrn.get(urn) ?? "onbekend";
    const fmtAvg = formatAverages[format];
    const vsAccountCtr = computeVsAverage("CTR", d.ctr_pct, accountBenchmark.ctr_pct);
    const winner = vsAccountCtr.position === "boven" && (d.cpl == null || accountBenchmark.cpl == null || d.cpl <= accountBenchmark.cpl);
    const bleeder = vsAccountCtr.position === "onder";
    return {
      creative: urn,
      format,
      label: winner ? "winnaar" : bleeder ? "bleeder" : "gemiddeld",
      ctr_vs_account: vsAccountCtr,
      ctr_vs_format: computeVsAverage("CTR", d.ctr_pct, fmtAvg?.ctr_pct ?? null),
      cpl: d.cpl,
      leads: d.leads,
      ctr_decay: ctrDecay(rows),
    };
  });
  return { latest_month: latestMonth, creatives: creativesFacts, format_averages: formatAverages, note: "Tijdsverval is de slijtage-proxy; LinkedIn geeft geen frequency per creative." };
}

// Stap 5 (kernstap): de ICP-fit per pivot, met de lege-ICP-degradatie.
function buildIcpFacts(demographics?: LinkedInDemographicRow[], icp?: LinkedInIcp | null): unknown {
  if (!demographics || demographics.length === 0) {
    return { available: false, note: "Geen demografie-data beschikbaar voor deze periode." };
  }
  const empty = isIcpEmpty(icp);
  return {
    available: true,
    icp_defined: !empty,
    degraded: empty,
    note: empty ? "Geen ICP-definitie: beschrijvend, geen fit-score." : undefined,
    pivots: computeIcpFit(demographics, icp),
  };
}

// Stap 6: de lead-gen funnel op accountniveau (open rate, completion rate, CPL).
function buildFunnelFacts(account: LinkedInComputeRow[]): unknown {
  const monthly = aggregateMonthly(account);
  const latest = monthly[monthly.length - 1];
  if (!latest) return { available: false };
  return {
    latest_month: latest.month,
    open_rate_pct: latest.open_rate_pct,
    completion_rate_pct: latest.form_completion_rate_pct,
    cpl: latest.cpl,
    form_opens: latest.form_opens,
    leads: latest.leads,
    has_leadgen: latest.form_opens > 0,
    note: latest.form_opens > 0 ? undefined : "Geen leadgen-campagnes in deze periode.",
  };
}

// Stap 7: audience-omvang en verzadiging (CPM-trend stijgt terwijl CTR-trend daalt over 3 maanden).
function buildAudienceFacts(account: LinkedInComputeRow[], meta?: LinkedInCampaignMeta[]): unknown {
  const monthly = aggregateMonthly(account);
  const cpmTrend = trendDirection(monthly, "cpm", 3);
  const ctrTrend = trendDirection(monthly, "ctr_pct", 3);
  const last3 = monthly.slice(-3);
  const audienceSizes = (meta ?? [])
    .filter((m) => m.audience_count != null)
    .map((m) => ({ campaign: m.entityUrn, audience_count: m.audience_count }));
  return {
    cpm_trend_3m: cpmTrend,
    ctr_trend_3m: ctrTrend,
    saturation_signal: cpmTrend === "stijgt" && ctrTrend === "daalt",
    cpm_series: last3.map((m) => ({ month: m.month, cpm: m.cpm })),
    ctr_series: last3.map((m) => ({ month: m.month, ctr: m.ctr_pct })),
    audience_sizes: audienceSizes,
  };
}

// Stap 8: bidding en pacing per campagne (uit metadata; degradeert netjes zonder).
function buildBiddingFacts(meta?: LinkedInCampaignMeta[]): unknown {
  if (!meta || meta.length === 0) {
    return { available: false, note: "Bidding en pacing vereisen campagne-metadata (cost_type, bid_strategy)." };
  }
  return {
    available: true,
    campaigns: meta.map((m) => ({ campaign: m.entityUrn, name: m.name ?? null, cost_type: m.cost_type ?? null, bid_strategy: m.bid_strategy ?? null })),
  };
}

export function buildLinkedinStepFacts(inputs: LinkedInPreparedInputs): LinkedInStepFacts {
  const latestMonth = latestMonthOf(inputs.account);
  const accountBenchmark = deriveFromRows(rowsInMonth(inputs.account, latestMonth));

  return {
    1: buildAccountFacts(inputs.account, inputs.targets),
    2: buildEntityVsAccountFacts(inputs.campaigns, accountBenchmark, latestMonth, inputs.campaignMeta),
    3: buildEntityVsAccountFacts(inputs.campaigns, accountBenchmark, latestMonth, inputs.campaignMeta),
    4: buildCreativeFacts(inputs.creatives, accountBenchmark, latestMonth, inputs.creativeMeta),
    5: buildIcpFacts(inputs.demographics, inputs.icp),
    6: buildFunnelFacts(inputs.account),
    7: buildAudienceFacts(inputs.account, inputs.campaignMeta),
    8: buildBiddingFacts(inputs.campaignMeta),
    9: { note: "Synthese uit stap 1 tot en met 8 en de canonical claim-set; geen nieuwe pre-compute.", account_months: aggregateMonthly(inputs.account).length },
  };
}
