/**
 * Expert layers for the analysis pipeline.
 * Each layer fetches/computes enrichment data and formats it for AI consumption.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "../prompts/sop-prompts";

// ── LAAG 1: Strategische context ────────────────────────────────────────────

export async function fetchStrategicContext(
  supabase: SupabaseClient,
  clientId: string,
  analysisDate: string
): Promise<string> {
  const { data } = await supabase
    .from("sop_client_context")
    .select("*")
    .eq("client_id", clientId)
    .lte("valid_from", analysisDate)
    .or(`valid_until.is.null,valid_until.gte.${analysisDate}`)
    .order("valid_from", { ascending: false });

  const rows = data ?? [];
  if (rows.length === 0) return "";

  const lines = rows.map((r: Record<string, unknown>) => {
    const until = r.valid_until ? String(r.valid_until) : "heden";
    const impact = r.impact_on_analysis ? `\n  Impact op analyse: ${r.impact_on_analysis}` : "";
    return `- ${r.valid_from} tot ${until}: ${r.title} — ${r.description}${impact}`;
  });

  return `\n\n## Strategische context voor deze klant\n${lines.join("\n")}`;
}

// ── LAAG 2: Portfolio analyse ───────────────────────────────────────────────

interface CampaignRow {
  campaign_name: string;
  campaign_id: string;
  month: string;
  cost: number;
  conversions: number;
  conversions_value: number;
  roas: number;
}

interface MetaRow {
  campaign_id: string;
  campaign_type: string;
}

function classifyType(type: string): "PMAX" | "SEARCH" | "SHOPPING" | "OTHER" {
  const t = (type || "").toUpperCase();
  if (t.includes("PERFORMANCE_MAX")) return "PMAX";
  if (t.includes("SEARCH")) return "SEARCH";
  if (t.includes("SHOPPING")) return "SHOPPING";
  return "OTHER";
}

export async function calculatePortfolioAnalysis(
  supabase: SupabaseClient,
  clientId: string,
  campaignData: Record<string, unknown>[],
  campaignMetaData: Record<string, unknown>[]
): Promise<string> {
  // Get the last 2 months of data
  const months = [...new Set(campaignData.map((c) => c.month as string))].sort();
  const lastMonth = months[months.length - 1];
  const prevMonth = months.length > 1 ? months[months.length - 2] : null;

  if (!lastMonth) return "";

  const metaMap = new Map<string, string>();
  for (const m of campaignMetaData as unknown as MetaRow[]) {
    metaMap.set(m.campaign_id, m.campaign_type);
  }

  const lastMonthData = campaignData.filter((c) => c.month === lastMonth) as unknown as CampaignRow[];

  // Calculate per type
  const byType = { PMAX: { cost: 0, conv: 0, value: 0 }, SEARCH: { cost: 0, conv: 0, value: 0 }, SHOPPING: { cost: 0, conv: 0, value: 0 }, OTHER: { cost: 0, conv: 0, value: 0 } };
  let totalCost = 0;
  let totalConv = 0;

  for (const c of lastMonthData) {
    const type = classifyType(metaMap.get(c.campaign_id) || "");
    byType[type].cost += c.cost;
    byType[type].conv += c.conversions;
    byType[type].value += c.conversions_value;
    totalCost += c.cost;
    totalConv += c.conversions;
  }

  const pct = (v: number, total: number) => total > 0 ? parseFloat(((v / total) * 100).toFixed(1)) : 0;

  // Concentration risk
  const campCosts = lastMonthData.map((c) => ({ name: c.campaign_name, cost: c.cost })).sort((a, b) => b.cost - a.cost);
  const topCampaign = campCosts[0];
  const topCampaignPct = pct(topCampaign?.cost ?? 0, totalCost);
  const concentrationRisk = topCampaignPct > 70;

  // PMAX/Search overlap
  const pmaxActive = byType.PMAX.cost > 0;
  const searchActive = byType.SEARCH.cost > 0;
  const overlap = pmaxActive && searchActive;

  // Portfolio efficiency (weighted avg ROAS)
  const portfolioRoas = totalCost > 0
    ? parseFloat((lastMonthData.reduce((s, c) => s + c.conversions_value, 0) / totalCost).toFixed(2))
    : 0;

  // MoM change
  let momPct: number | null = null;
  if (prevMonth) {
    const prevData = campaignData.filter((c) => c.month === prevMonth) as unknown as CampaignRow[];
    const prevTotalCost = prevData.reduce((s, c) => s + c.cost, 0);
    const prevTotalValue = prevData.reduce((s, c) => s + c.conversions_value, 0);
    const prevRoas = prevTotalCost > 0 ? prevTotalValue / prevTotalCost : 0;
    if (prevRoas > 0) {
      momPct = parseFloat((((portfolioRoas - prevRoas) / prevRoas) * 100).toFixed(1));
    }
  }

  // Upsert to Supabase
  await supabase.from("ads_portfolio_analysis").upsert({
    client_id: clientId,
    month: lastMonth,
    pmax_cost_pct: pct(byType.PMAX.cost, totalCost),
    search_cost_pct: pct(byType.SEARCH.cost, totalCost),
    shopping_cost_pct: pct(byType.SHOPPING.cost, totalCost),
    other_cost_pct: pct(byType.OTHER.cost, totalCost),
    pmax_conv_pct: pct(byType.PMAX.conv, totalConv),
    search_conv_pct: pct(byType.SEARCH.conv, totalConv),
    shopping_conv_pct: pct(byType.SHOPPING.conv, totalConv),
    other_conv_pct: pct(byType.OTHER.conv, totalConv),
    budget_concentration_risk: concentrationRisk,
    top_campaign_cost_pct: topCampaignPct,
    top_campaign_name: topCampaign?.name ?? null,
    pmax_search_overlap: overlap,
    portfolio_efficiency_score: portfolioRoas,
    portfolio_efficiency_mom_pct: momPct,
  }, { onConflict: "client_id,month" });

  // Format for AI
  const momStr = momPct !== null ? ` (${momPct > 0 ? "+" : ""}${momPct}% MoM)` : "";
  const concRisk = concentrationRisk
    ? `Ja — ${topCampaign?.name} neemt ${topCampaignPct}% van het budget`
    : "Nee — budget is gespreid";

  return `\n\n## Portfolio analyse (${lastMonth})
- Budget verdeling: PMAX ${pct(byType.PMAX.cost, totalCost)}%, Search ${pct(byType.SEARCH.cost, totalCost)}%, Shopping ${pct(byType.SHOPPING.cost, totalCost)}%, Overig ${pct(byType.OTHER.cost, totalCost)}%
- Conversie verdeling: PMAX ${pct(byType.PMAX.conv, totalConv)}%, Search ${pct(byType.SEARCH.conv, totalConv)}%, Shopping ${pct(byType.SHOPPING.conv, totalConv)}%, Overig ${pct(byType.OTHER.conv, totalConv)}%
- Concentratierisico: ${concRisk}
- PMAX/Search overlap: ${overlap ? "Ja — beide actief" : "Nee"}
- Portfolio efficiëntie score: ${portfolioRoas} ROAS${momStr}`;
}

// ── LAAG 3: Hypothese tracking ──────────────────────────────────────────────

export async function fetchHypothesisTracking(
  supabase: SupabaseClient,
  clientId: string
): Promise<string> {
  const { data } = await supabase
    .from("sop_hypothesis_tracking")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "implemented")
    .is("measured_at", null)
    .order("implemented_at", { ascending: false });

  const rows = data ?? [];
  if (rows.length === 0) return "";

  const lines = rows.map((r: Record<string, unknown>) => {
    const notes = r.implementation_notes ? `\n  Notities: ${r.implementation_notes}` : "";
    return `- ${r.implemented_at}: ${r.hypothesis}\n  Verwacht: ${r.expected_result} via ${r.measurement_metric} binnen ${r.timeframe}${notes}`;
  });

  return `\n\n## Uitgevoerde hypotheses — nog niet gemeten\n${lines.join("\n")}`;
}

// ── LAAG 4: Leading indicators ──────────────────────────────────────────────

export async function calculateLeadingIndicators(
  supabase: SupabaseClient,
  clientId: string
): Promise<string> {
  // Fetch conversion lag setting for this client (default: 3 days)
  const { data: settingsRow } = await supabase
    .from("client_settings")
    .select("conversion_lag_days")
    .eq("client_id", clientId)
    .maybeSingle();
  const lagDays = (settingsRow?.conversion_lag_days as number) ?? 3;

  // A week is "immature" if its end date falls within the lag window
  const today = new Date();
  const safeDate = new Date(today);
  safeDate.setDate(safeDate.getDate() - lagDays);
  const safeDateStr = safeDate.toISOString().split("T")[0];

  // Fetch last 6 weeks of weekly data to compute WoW for last 4
  const { data: weeklyData } = await supabase
    .from("ads_account_weekly")
    .select("*")
    .eq("client_id", clientId)
    .order("week_start", { ascending: false })
    .limit(6);

  const weeks = (weeklyData ?? []).reverse() as Record<string, unknown>[];
  if (weeks.length < 2) return "";

  const indicators: Record<string, unknown>[] = [];

  for (let i = 1; i < weeks.length; i++) {
    const cur = weeks[i];
    const prev = weeks[i - 1];

    // Determine if this week's data is immature (conversion data may be incomplete)
    const weekStart = String(cur.week_start || "");
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const isImmature = weekEnd >= safeDate;

    const wow = (curVal: unknown, prevVal: unknown): number | null => {
      const c = Number(curVal) || 0;
      const p = Number(prevVal) || 0;
      if (p === 0) return null;
      return parseFloat((((c - p) / p) * 100).toFixed(1));
    };

    const ctrWow = wow(cur.ctr, prev.ctr);
    const cpcWow = wow(cur.avg_cpc, prev.avg_cpc);
    const crWow = wow(cur.conversion_rate, prev.conversion_rate);
    const cpaWow = wow(cur.cost_per_conversion, prev.cost_per_conversion);

    const flagCtrDropping = ctrWow !== null && ctrWow < -10;
    const flagCpcRising = cpcWow !== null && cpcWow > 10;
    // Conversion-dependent flags are suppressed for immature weeks
    const flagConvRateDropping = !isImmature && crWow !== null && crWow < -10;
    const flagIsDropping = false;
    const flagBudgetPressure = false;
    const flagQualityPressure = false;

    // Tracking break detection — suppressed for immature weeks AND budget contractions
    const clicksWow = wow(cur.clicks, prev.clicks);
    const conversionsWow = wow(cur.conversions, prev.conversions);
    const curClicks = Number(cur.clicks) || 0;
    const curConversions = Number(cur.conversions) || 0;
    const prevConversions = Number(prev.conversions) || 0;
    const curCost = Number(cur.cost) || 0;
    const prevCost = Number(prev.cost) || 0;
    const costWow = wow(cur.cost, prev.cost);

    // Detect budget contraction: spend dropped >25% → conversion drop is likely budget-driven
    const isBudgetContraction = costWow !== null && costWow < -25;

    let flagTrackingBreak = false;
    let flagBudgetContraction = false;

    if (isBudgetContraction && conversionsWow !== null && conversionsWow < -30) {
      // Spend dropped sharply AND conversions dropped → budget contraction, NOT tracking break
      flagBudgetContraction = true;
    } else if (!isImmature) {
      // Only check tracking break if NOT a budget contraction and NOT immature
      const classicTrackingBreak =
        curClicks > 0 &&
        (clicksWow === null || clicksWow > -20) &&
        prevConversions > 0 &&
        (curConversions === 0 || (conversionsWow !== null && conversionsWow < -80));

      const curEfficiency = curCost > 0 ? curConversions / curCost : 0;
      const prevEfficiency = prevCost > 0 ? prevConversions / prevCost : 0;
      const efficiencyBreak =
        prevEfficiency > 0 &&
        curCost > 0 &&
        (curEfficiency / prevEfficiency) < 0.25 &&
        (clicksWow === null || clicksWow > -30) &&
        !isBudgetContraction; // Exclude if spend also crashed

      flagTrackingBreak = classicTrackingBreak || efficiencyBreak;
    }

    const warningCount = [flagIsDropping, flagCtrDropping, flagCpcRising, flagConvRateDropping, flagBudgetPressure, flagQualityPressure, flagTrackingBreak].filter(Boolean).length;

    const row = {
      client_id: clientId,
      week_start: cur.week_start,
      avg_ctr_wow_pct: ctrWow,
      avg_cpc_wow_pct: cpcWow,
      conversion_rate_wow_pct: crWow,
      cost_per_conversion_wow_pct: cpaWow,
      impression_share_wow_pct: null,
      flag_is_dropping: flagIsDropping,
      flag_ctr_dropping: flagCtrDropping,
      flag_cpc_rising: flagCpcRising,
      flag_conv_rate_dropping: flagConvRateDropping,
      flag_budget_pressure: flagBudgetPressure,
      flag_quality_pressure: flagQualityPressure,
      warning_count: warningCount,
    };

    indicators.push({ ...row, flag_tracking_break: flagTrackingBreak, flag_budget_contraction: flagBudgetContraction, is_immature: isImmature });

    // Upsert (without tracking_break/immature flags — not in table schema)
    await supabase.from("ads_leading_indicators").upsert(row, { onConflict: "client_id,week_start" });
  }

  // Format last 4 weeks for AI
  const last4 = indicators.slice(-4);
  if (last4.length === 0) return "";

  const lines = last4.map((w) => {
    const wc = w.warning_count as number;
    const immature = w.is_immature as boolean;
    const flags: string[] = [];
    if (immature) flags.push(`IMMATURE DATA (conversielag ${lagDays} dagen) — conversie-metrics zijn onvolledig, niet alarmerend`);
    if (w.flag_budget_contraction) flags.push(`BUDGETDALING: spend daalde scherp — conversiedaling is waarschijnlijk budget-gerelateerd, GEEN tracking break`);
    if (w.flag_tracking_break) flags.push("TRACKING BREAK WAARSCHIJNLIJK: clicks stabiel maar conversies >80% gedaald — controleer conversietracking!");
    if (w.flag_ctr_dropping) flags.push(`CTR daalt ${w.avg_ctr_wow_pct}% WoW`);
    if (w.flag_cpc_rising) flags.push(`CPC stijgt ${w.avg_cpc_wow_pct}% WoW`);
    if (w.flag_conv_rate_dropping) flags.push(`Conv. rate daalt ${w.conversion_rate_wow_pct}% WoW`);
    if (w.flag_budget_pressure) flags.push("Budget druk: >20% IS verlies door budget");
    const flagStr = flags.length > 0 ? "\n  " + flags.map((f) => `- ${f}`).join("\n  ") : "";
    return `Week ${w.week_start}: ${wc} waarschuwing${wc !== 1 ? "en" : ""}${flagStr}`;
  });

  // Add conversion lag context note for AI
  const lagNote = lagDays > 0
    ? `\nDit account heeft een conversievertraging van ${lagDays} dagen. Interpreteer lichte tot gemiddelde dalingen in conversie-metrics in de meest recente periode voorzichtig, tenzij input-metrics zoals impressies en klikken ook scherp dalen.`
    : "";

  return `\n\n## Early warning signalen (laatste 4 weken)${lagNote}\n${lines.join("\n")}`;
}

// ── LAAG 5: Sectorale benchmarks ────────────────────────────────────────────

const SECTOR_LABELS: Record<string, string> = {
  ecommerce_laag_ticket: "E-commerce (laag ticket, AOV < €50)",
  ecommerce_mid_ticket: "E-commerce (mid ticket, AOV €50-€250)",
  ecommerce_hoog_ticket: "E-commerce (hoog ticket, AOV > €250)",
  ecommerce_fashion: "E-commerce fashion",
  ecommerce_electronics: "E-commerce elektronica",
  ecommerce_huisdieren: "E-commerce huisdieren",
  ecommerce_general: "E-commerce algemeen",
  fysiotherapie: "Fysiotherapie / Physical Therapy",
  zorg_generiek: "Gezondheidszorg",
  b2b_saas: "B2B SaaS / Software",
  b2b_software: "B2B SaaS / Software",
  b2b_leadgen: "B2B dienstverlening",
  leadgen_generiek: "Lokale dienstverlening",
  automotive: "Automotive",
  legal: "Juridische dienstverlening",
  finance: "Finance & Verzekeringen",
  horeca: "Horeca",
  retail_local: "Lokale retail",
  hybrid: "Hybrid (Shopping + Search)",
};

const AOV_MAP: Record<string, string> = {
  low_ticket: "ecommerce_laag_ticket",
  mid_ticket: "ecommerce_mid_ticket",
  high_ticket: "ecommerce_hoog_ticket",
};

function resolveSector(
  sectorFromDb: string | null | undefined,
  aovSegmentFromDb: string | null | undefined,
  accountType: AccountType
): string | null {
  if (sectorFromDb) return sectorFromDb;

  if (accountType === "ecommerce_roas" || accountType === "ecommerce_cpa") {
    return AOV_MAP[aovSegmentFromDb ?? ""] ?? "ecommerce_mid_ticket";
  }
  if (accountType === "leadgen_cpa" || accountType === "leadgen_volume") return "leadgen_generiek";
  if (accountType === "hybrid") return "hybrid";
  return null;
}

export async function fetchSectorBenchmarks(
  supabase: SupabaseClient,
  accountType: AccountType,
  clientId?: string
): Promise<string> {
  // Read sector + aov_segment from client_settings
  let sectorFromDb: string | null = null;
  let aovSegmentFromDb: string | null = null;

  if (clientId) {
    const { data: cs } = await supabase
      .from("client_settings")
      .select("sector, aov_segment")
      .eq("client_id", clientId)
      .maybeSingle();

    if (cs) {
      sectorFromDb = cs.sector as string | null;
      aovSegmentFromDb = cs.aov_segment as string | null;
    }
  }

  const sector = resolveSector(sectorFromDb, aovSegmentFromDb, accountType);
  if (!sector) return "";

  const sectorLabel = SECTOR_LABELS[sector] ?? sector;

  // Try exact match first (sector + accountType), then sector-only fallback
  let { data } = await supabase
    .from("benchmark_sectors")
    .select("*")
    .eq("sector", sector)
    .eq("account_type", accountType);

  // If no results with exact accountType match and sector was explicitly set,
  // fetch any benchmarks for this sector regardless of accountType
  if ((!data || data.length === 0) && sectorFromDb) {
    const fallback = await supabase
      .from("benchmark_sectors")
      .select("*")
      .eq("sector", sector);
    data = fallback.data;
  }

  const rows = data ?? [];
  if (rows.length === 0) return "";

  // Build table rows
  const metricOrder = ["ctr", "conversion_rate", "cpa", "roas", "avg_cpc"];
  const metricLabels: Record<string, string> = {
    ctr: "CTR",
    conversion_rate: "Conv. Rate",
    cpa: "CPA",
    roas: "ROAS",
    avg_cpc: "Avg. CPC",
  };

  const rowMap = new Map<string, Record<string, unknown>>();
  for (const r of rows as Record<string, unknown>[]) {
    rowMap.set(r.metric as string, r);
  }

  const isInverse = (m: string) => m === "cpa" || m === "avg_cpc"; // lower is better

  const fmtVal = (metric: string, value: unknown): string => {
    const v = Number(value);
    if (isNaN(v)) return "-";
    if (metric === "cpa" || metric === "avg_cpc") return `€${v}`;
    if (metric === "ctr" || metric === "conversion_rate") return `${v}%`;
    return `${v}`;
  };

  const tableRows = metricOrder
    .filter((m) => rowMap.has(m))
    .map((m) => {
      const r = rowMap.get(m)!;
      const label = (metricLabels[m] ?? m).padEnd(15);
      if (isInverse(m)) {
        // For CPA/CPC: low = bad (high number), top10 = good (low number)
        return `| ${label} | >${fmtVal(m, r.low).padEnd(8)} | ${fmtVal(m, r.median).padEnd(9)} | ${fmtVal(m, r.high).padEnd(7)} | ${fmtVal(m, r.top10).padEnd(7)} |`;
      }
      return `| ${label} | <${fmtVal(m, r.low).padEnd(8)} | ${fmtVal(m, r.median).padEnd(9)} | ${fmtVal(m, r.high).padEnd(7)} | ${fmtVal(m, r.top10).padEnd(7)} |`;
    });

  const isAov = sector.includes("ecommerce_") && sector.includes("ticket");
  const aovNote = isAov
    ? "\n\nBij een AOV in dit segment: beoordeel ROAS in context van de marge. Een lagere ROAS vereist hogere marges om winstgevend te blijven."
    : "";

  return `\n\n## Sectorale benchmarks: ${sectorLabel}
Bron: WordStream/LocaliQ/Triple Whale 2025 — NL/EU gecorrigeerd

| Metric          | Onder gem. | Gemiddeld | Goed    | Top 10% |
|-----------------|-----------|-----------|---------|---------|
${tableRows.join("\n")}

Let op: CPA en CPC — lager is beter, dus kolommen zijn omgedraaid.${aovNote}`;
}

// ── LAAG 6: Enhanced change history ─────────────────────────────────────────

export async function fetchEnhancedChangeHistory(
  supabase: SupabaseClient,
  clientId: string,
  daysBack: number = 60
): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const { data } = await supabase
    .from("ads_change_history")
    .select("change_datetime, change_type, campaign_name, old_value, new_value, resource_type, user_email")
    .eq("client_id", clientId)
    .gte("change_datetime", since.toISOString())
    .order("change_datetime", { ascending: false })
    .limit(30);

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return "";

  const lines = rows.map((r) => {
    const date = String(r.change_datetime ?? "").split("T")[0] || "onbekend";
    const campaign = r.campaign_name || "onbekend";
    const type = r.change_type || r.resource_type || "wijziging";
    const oldVal = r.old_value && r.old_value !== '""' ? r.old_value : "-";
    const newVal = r.new_value && r.new_value !== '""' ? r.new_value : "-";

    // Detect reason from context (budget changes, bid changes, etc.)
    let reason = "";
    let expectedImpact = "";
    const oldStr = String(oldVal);
    const newStr = String(newVal);

    if (oldStr.includes("budget") || newStr.includes("budget") || type === "CAMPAIGN_BUDGET") {
      reason = "Budgetwijziging";
      expectedImpact = "Direct effect op volume en impressies";
    } else if (type === "CAMPAIGN" && (oldStr.includes("bidding") || newStr.includes("bidding"))) {
      reason = "Biedstrategie wijziging";
      expectedImpact = "Mogelijke leerfase herstart (2-4 weken)";
    }

    const reasonLine = reason ? `\n  Reden: ${reason}\n  Verwacht effect: ${expectedImpact}` : "\n  Reden: ONBEKEND — overweeg reden te documenteren";

    return `- ${date}: ${type} op ${campaign} — van ${oldVal} naar ${newVal}${reasonLine}`;
  });

  return `\n\n## Recente wijzigingen in dit account (laatste ${daysBack} dagen)\n${lines.join("\n")}`;
}


// ── LAAG 7: Geografische context ───────────────────────────────────────────

/**
 * Build geo/country context for SOP analysis.
 * Fetches ads_country_monthly + ads_country_yoy and formats per-country
 * performance summary for AI consumption.
 *
 * Only produces output if the client has data in multiple countries.
 */
export async function calculateGeoContext(
  supabase: SupabaseClient,
  clientId: string
): Promise<string> {
  // Fetch last 3 months of country data
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const startDate = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: countryData }, { data: yoyData }, { data: campaignCountryData }] = await Promise.all([
    supabase
      .from("ads_country_monthly")
      .select("country_code, month, impressions, clicks, cost, conversions, conversions_value, ctr, avg_cpc, cost_per_conversion, conversion_rate, roas, campaign_count, spend_share")
      .eq("client_id", clientId)
      .gte("month", startDate)
      .order("month", { ascending: false }),
    supabase
      .from("ads_country_yoy")
      .select("country_code, month, conversions_yoy_pct, conversions_value_yoy_pct, cost_yoy_pct, roas_yoy_pct, cost_per_conversion_yoy_pct")
      .eq("client_id", clientId)
      .gte("month", startDate),
    supabase
      .from("ads_campaign_country_monthly")
      .select("campaign_name, country_code, cost, conversions, conversions_value, campaign_spend_share")
      .eq("client_id", clientId)
      .gte("month", startDate)
      .gt("cost", 0),
  ]);

  if (!countryData || countryData.length === 0) return "";

  // Check how many countries — if only 1, minimal context needed
  const countries = [...new Set(countryData.map((r) => r.country_code as string))];
  if (countries.length <= 1) return "";

  const COUNTRY_NAMES: Record<string, string> = {
    NL: "Nederland", DE: "Duitsland", BE: "België", FR: "Frankrijk",
    GB: "Verenigd Koninkrijk", AT: "Oostenrijk", CH: "Zwitserland",
    ES: "Spanje", IT: "Italië", US: "Verenigde Staten", PT: "Portugal",
    PL: "Polen", SE: "Zweden", DK: "Denemarken", IE: "Ierland",
  };

  // Get latest month's data per country
  const latestMonth = countryData[0]?.month as string;
  const latestData = countryData.filter((r) => r.month === latestMonth);

  // Previous month
  const prevMonth = new Date(latestMonth);
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const prevData = countryData.filter((r) => (r.month as string).startsWith(prevMonthStr.slice(0, 7)));

  const lines: string[] = [];

  for (const cc of countries) {
    const cur = latestData.find((r) => r.country_code === cc);
    const prev = prevData.find((r) => r.country_code === cc);
    const yoy = (yoyData ?? []).find((r) => r.country_code === cc && r.month === latestMonth);
    if (!cur) continue;

    const name = COUNTRY_NAMES[cc] ?? cc;
    const cost = Number(cur.cost ?? 0);
    const conv = Number(cur.conversions ?? 0);
    const revenue = Number(cur.conversions_value ?? 0);
    const roasVal = Number(cur.roas ?? 0);
    const cpa = Number(cur.cost_per_conversion ?? 0);
    const share = Number(cur.spend_share ?? 0);

    let line = `### ${name} (${cc}) — ${(share * 100).toFixed(1)}% van totale spend`;
    line += `\n  Kosten: €${cost.toFixed(0)} | Conversies: ${conv.toFixed(0)} | Omzet: €${revenue.toFixed(0)} | ROAS: ${roasVal.toFixed(2)}x | CPA: €${cpa.toFixed(2)}`;

    // MoM comparison
    if (prev) {
      const prevConv = Number(prev.conversions ?? 0);
      const prevCost = Number(prev.cost ?? 0);
      const convMom = prevConv > 0 ? (((conv - prevConv) / prevConv) * 100).toFixed(1) : "n.v.t.";
      const costMom = prevCost > 0 ? (((cost - prevCost) / prevCost) * 100).toFixed(1) : "n.v.t.";
      line += `\n  m/m: conversies ${convMom}% | kosten ${costMom}%`;
    }

    // YoY comparison
    if (yoy) {
      const parts: string[] = [];
      if (yoy.conversions_yoy_pct != null) parts.push(`conversies ${yoy.conversions_yoy_pct}%`);
      if (yoy.roas_yoy_pct != null) parts.push(`ROAS ${yoy.roas_yoy_pct}%`);
      if (yoy.cost_yoy_pct != null) parts.push(`kosten ${yoy.cost_yoy_pct}%`);
      if (parts.length > 0) line += `\n  j/j: ${parts.join(" | ")}`;
    }

    lines.push(line);
  }

  // Multi-country campaign analysis
  const multiCountryCampaigns: string[] = [];
  if (campaignCountryData && campaignCountryData.length > 0) {
    const campCountries = new Map<string, Set<string>>();
    for (const r of campaignCountryData) {
      const camp = r.campaign_name as string;
      if (!campCountries.has(camp)) campCountries.set(camp, new Set());
      campCountries.get(camp)!.add(r.country_code as string);
    }
    for (const [camp, ccSet] of campCountries) {
      if (ccSet.size > 1) {
        multiCountryCampaigns.push(`- ${camp}: actief in ${[...ccSet].join(", ")}`);
      }
    }
  }

  let output = `\n\n## BONUS DIMENSIE: Geografische spreiding (${countries.length} landen)\nDit account is actief in meerdere landen. Dit is AANVULLENDE context — niet de hoofdanalyse.\nGebruik deze data als extra dimensie bij je bevindingen: als een KPI daalt, check of het door een specifiek land komt.\nDoe NIET een aparte geo-analyse — integreer geo-inzichten in de relevante bevindingen.\n\n${lines.join("\n\n")}`;

  if (multiCountryCampaigns.length > 0) {
    output += `\n\n### Multi-country campagnes\n${multiCountryCampaigns.join("\n")}`;
  }

  return output;
}
