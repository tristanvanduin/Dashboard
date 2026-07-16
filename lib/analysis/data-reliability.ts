/**
 * Data Reliability & Confidence Layer.
 *
 * Assesses data quality BEFORE analysis begins.
 * Determines:
 *   1. Overall confidence (high / medium / low / critical)
 *   2. Per-metric trust (which metrics are reliable vs questionable)
 *   3. Reconciliation issues (account vs campaign totals)
 *   4. Impossible value detection
 *   5. Recommended analysis mode (full / restricted / diagnostic)
 *
 * This is purely deterministic — no LLM involved.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type OverallConfidence = "high" | "medium" | "low" | "critical";
export type MetricTrust = "reliable" | "directional" | "unreliable" | "unavailable";
export type AnalysisMode = "full" | "restricted" | "diagnostic";

export interface MetricReliability {
  metric: string;
  trust: MetricTrust;
  reason: string;
}

export interface ReliabilityFlag {
  type: "tracking" | "reconciliation" | "impossible_value" | "lag" | "regime_shift" | "data_gap";
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  affectedMetrics: string[];
}

export interface DataReliabilityAssessment {
  overallConfidence: OverallConfidence;
  overallExplanation: string;
  analysisMode: AnalysisMode;
  modeExplanation: string;
  metricReliability: MetricReliability[];
  flags: ReliabilityFlag[];
  /** Concise text block to inject into LLM prompts */
  promptContext: string;
}

// ── Input types ────────────────────────────────────────────────────────────

interface MonthRow {
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

interface CampaignRow {
  campaign_name: string;
  month: string;
  cost: number;
  conversions: number;
  conversions_value: number;
}

interface ReliabilityInput {
  accountMonthly: MonthRow[];
  campaignMonthly: CampaignRow[];
  conversionLagDays: number;
  lastCompleteMonth: number;
  hasKpiTargets: boolean;
}

// ── Core computation ───────────────────────────────────────────────────────

export function computeDataReliability(input: ReliabilityInput): DataReliabilityAssessment {
  const flags: ReliabilityFlag[] = [];
  const metricReliability: MetricReliability[] = [];

  const data = input.accountMonthly;
  if (data.length === 0) {
    return {
      overallConfidence: "critical",
      overallExplanation: "Geen accountdata beschikbaar. Analyse niet mogelijk.",
      analysisMode: "diagnostic",
      modeExplanation: "Geen data — alleen diagnostische modus beschikbaar.",
      metricReliability: [],
      flags: [{ type: "data_gap", severity: "critical", description: "Geen maandelijkse accountdata gevonden.", affectedMetrics: ["all"] }],
      promptContext: buildPromptContext("critical", "diagnostic", [], [{ type: "data_gap", severity: "critical", description: "Geen data.", affectedMetrics: ["all"] }]),
    };
  }

  const sorted = [...data].sort((a, b) => a.month.localeCompare(b.month));
  const recent = sorted.slice(-3); // last 3 months
  const older = sorted.slice(0, -3);

  // ── Check 1: Tracking anomalies (conversion efficiency crashes) ──

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = sorted[i - 1];

    // Efficiency = conversions / cost
    const curEff = cur.cost > 0 ? cur.conversions / cur.cost : 0;
    const prevEff = prev.cost > 0 ? prev.conversions / prev.cost : 0;

    if (prevEff > 0 && curEff > 0) {
      const effChange = (curEff - prevEff) / prevEff;

      // Efficiency crashed >75% while cost didn't drop proportionally
      const costChange = prev.cost > 0 ? (cur.cost - prev.cost) / prev.cost : 0;
      if (effChange < -0.75 && costChange > -0.3) {
        flags.push({
          type: "tracking",
          severity: "high",
          description: `Conversie-efficientie crashte ${Math.round(effChange * 100)}% in ${cur.month} terwijl spend slechts ${Math.round(costChange * 100)}% veranderde. Mogelijke tracking break.`,
          affectedMetrics: ["conversions", "conversion_value", "roas", "cpa", "conversion_rate"],
        });
      }
    }

    // Zero conversions after stable period
    if (prev.conversions > 5 && cur.conversions === 0 && cur.clicks > 10) {
      flags.push({
        type: "tracking",
        severity: "critical",
        description: `${cur.month}: 0 conversies bij ${cur.clicks} clicks, terwijl vorige maand ${prev.conversions} conversies had. Zeer waarschijnlijk tracking break.`,
        affectedMetrics: ["conversions", "conversion_value", "roas", "cpa", "conversion_rate"],
      });
    }
  }

  // ── Check 2: Reconciliation (account vs campaign totals) ──

  if (input.campaignMonthly.length > 0) {
    const accountByMonth = new Map<string, MonthRow>();
    for (const row of sorted) accountByMonth.set(row.month, row);

    const campaignByMonth = new Map<string, { cost: number; conversions: number; value: number }>();
    for (const row of input.campaignMonthly) {
      const existing = campaignByMonth.get(row.month) ?? { cost: 0, conversions: 0, value: 0 };
      existing.cost += row.cost;
      existing.conversions += row.conversions;
      existing.value += row.conversions_value;
      campaignByMonth.set(row.month, existing);
    }

    for (const [month, acct] of accountByMonth) {
      const camp = campaignByMonth.get(month);
      if (!camp || acct.cost === 0) continue;

      const costDiff = Math.abs(acct.cost - camp.cost) / acct.cost;
      const convDiff = acct.conversions > 0 ? Math.abs(acct.conversions - camp.conversions) / acct.conversions : 0;

      if (costDiff > 0.1) {
        flags.push({
          type: "reconciliation",
          severity: "medium",
          description: `${month}: Account spend (${Math.round(acct.cost)}) wijkt ${Math.round(costDiff * 100)}% af van campagne-totaal (${Math.round(camp.cost)}). Mogelijke data-inconsistentie.`,
          affectedMetrics: ["cost", "cpa", "roas"],
        });
      }
      if (convDiff > 0.15 && acct.conversions > 5) {
        flags.push({
          type: "reconciliation",
          severity: "high",
          description: `${month}: Account conversies (${Math.round(acct.conversions)}) wijkt ${Math.round(convDiff * 100)}% af van campagne-totaal (${Math.round(camp.conversions)}).`,
          affectedMetrics: ["conversions", "conversion_value", "roas", "cpa"],
        });
      }
    }
  }

  // ── Check 3: Impossible values ──

  for (const row of sorted) {
    if (row.cost < 0) {
      flags.push({ type: "impossible_value", severity: "critical", description: `${row.month}: Negatieve spend (${row.cost}).`, affectedMetrics: ["cost"] });
    }
    if (row.conversions < 0) {
      flags.push({ type: "impossible_value", severity: "critical", description: `${row.month}: Negatieve conversies (${row.conversions}).`, affectedMetrics: ["conversions"] });
    }
    const roas = row.cost > 0 ? row.conversions_value / row.cost : 0;
    if (roas > 50 && row.cost > 100) {
      flags.push({ type: "impossible_value", severity: "medium", description: `${row.month}: ROAS ${roas.toFixed(1)}x is ongebruikelijk hoog. Controleer conversie-attributie.`, affectedMetrics: ["roas", "conversion_value"] });
    }
    if (row.cost_per_conversion && row.cost_per_conversion < 0) {
      flags.push({ type: "impossible_value", severity: "critical", description: `${row.month}: Negatieve CPA.`, affectedMetrics: ["cpa"] });
    }
  }

  // ── Check 4: Regime shifts (suspicious zeros after stable data) ──

  if (older.length >= 3 && recent.length >= 1) {
    const olderAvgConv = older.reduce((s, r) => s + r.conversions, 0) / older.length;
    const recentAvgConv = recent.reduce((s, r) => s + r.conversions, 0) / recent.length;

    if (olderAvgConv > 10 && recentAvgConv < olderAvgConv * 0.15) {
      flags.push({
        type: "regime_shift",
        severity: "high",
        description: `Conversies daalden van gem. ${Math.round(olderAvgConv)}/maand naar ${Math.round(recentAvgConv)}/maand. Dit kan wijzen op tracking-degradatie of fundamentele verandering.`,
        affectedMetrics: ["conversions", "conversion_value", "roas", "cpa"],
      });
    }
  }

  // ── Check 5: Conversion lag risk ──

  if (input.conversionLagDays > 0) {
    flags.push({
      type: "lag",
      severity: "low",
      description: `Conversielag van ${input.conversionLagDays} dagen actief. Recente conversiedata is mogelijk onvolledig.`,
      affectedMetrics: ["conversions", "conversion_value", "roas", "cpa", "conversion_rate"],
    });
  }

  // ── Compute metric-level trust ──

  const trackingFlags = flags.filter((f) => f.type === "tracking" || f.type === "regime_shift");
  const reconcFlags = flags.filter((f) => f.type === "reconciliation");
  const impossibleFlags = flags.filter((f) => f.type === "impossible_value");

  const conversionAffected = trackingFlags.length > 0 || reconcFlags.some((f) => f.affectedMetrics.includes("conversions"));
  const costAffected = impossibleFlags.some((f) => f.affectedMetrics.includes("cost"));

  metricReliability.push(
    { metric: "impressions", trust: "reliable", reason: "Impressies zijn direct gemeten door Google Ads." },
    { metric: "clicks", trust: "reliable", reason: "Clicks zijn direct gemeten door Google Ads." },
    { metric: "cost", trust: costAffected ? "directional" : "reliable", reason: costAffected ? "Spend-data bevat inconsistenties." : "Spend is direct gemeten." },
    { metric: "conversions", trust: conversionAffected ? "unreliable" : "reliable", reason: conversionAffected ? "Conversiedata is onbetrouwbaar door tracking/reconciliatie issues." : "Conversiedata is consistent." },
    { metric: "conversion_value", trust: conversionAffected ? "unreliable" : "reliable", reason: conversionAffected ? "Conversiewaarde is onbetrouwbaar (afhankelijk van conversiedata)." : "Conversiewaarde is consistent." },
    { metric: "roas", trust: conversionAffected ? "unreliable" : "reliable", reason: conversionAffected ? "ROAS is onbetrouwbaar (afhankelijk van conversie + spend)." : "ROAS is betrouwbaar." },
    { metric: "cpa", trust: conversionAffected ? "unreliable" : "reliable", reason: conversionAffected ? "CPA is onbetrouwbaar (afhankelijk van conversiedata)." : "CPA is betrouwbaar." },
    { metric: "conversion_rate", trust: conversionAffected ? "unreliable" : "reliable", reason: conversionAffected ? "Conversieratio onbetrouwbaar." : "Conversieratio is consistent." },
  );

  // ── Overall confidence ──

  const criticalFlags = flags.filter((f) => f.severity === "critical");
  const highFlags = flags.filter((f) => f.severity === "high");

  let overallConfidence: OverallConfidence;
  let overallExplanation: string;

  if (criticalFlags.length > 0) {
    overallConfidence = "critical";
    overallExplanation = `Kritieke dataproblemen gedetecteerd (${criticalFlags.length}). Conversie-gebaseerde conclusies zijn niet betrouwbaar.`;
  } else if (highFlags.length >= 2) {
    overallConfidence = "low";
    overallExplanation = `Meerdere significante dataproblemen (${highFlags.length}). Conclusies moeten voorzichtig worden geinterpreteerd.`;
  } else if (highFlags.length === 1 || conversionAffected) {
    overallConfidence = "medium";
    overallExplanation = `Datakwaliteit is gemiddeld. Spend/click-analyses zijn betrouwbaar; conversie-conclusies zijn indicatief.`;
  } else {
    overallConfidence = "high";
    overallExplanation = `Data is consistent en betrouwbaar. Alle metrics kunnen met vertrouwen worden geanalyseerd.`;
  }

  // ── Analysis mode ──

  const { mode: analysisMode, explanation: modeExplanation } = selectAnalysisMode(overallConfidence, flags);

  // ── Prompt context ──

  const promptContext = buildPromptContext(overallConfidence, analysisMode, metricReliability, flags);

  return {
    overallConfidence,
    overallExplanation,
    analysisMode,
    modeExplanation,
    metricReliability,
    flags,
    promptContext,
  };
}

// ── Analysis mode selection ────────────────────────────────────────────────

function selectAnalysisMode(
  confidence: OverallConfidence,
  flags: ReliabilityFlag[]
): { mode: AnalysisMode; explanation: string } {
  if (confidence === "critical") {
    return {
      mode: "diagnostic",
      explanation: "Diagnostische modus: datakwaliteit is onvoldoende voor performance-conclusies. Focus op tracking-validatie en data-herstel.",
    };
  }

  if (confidence === "low") {
    const hasTrackingIssues = flags.some((f) => f.type === "tracking" && f.severity !== "low");
    if (hasTrackingIssues) {
      return {
        mode: "diagnostic",
        explanation: "Diagnostische modus: tracking-issues domineren. Performance-conclusies zijn onbetrouwbaar tot tracking is gevalideerd.",
      };
    }
    return {
      mode: "restricted",
      explanation: "Beperkte modus: alleen spend/click-analyses zijn betrouwbaar. Conversie-conclusies zijn indicatief.",
    };
  }

  if (confidence === "medium") {
    return {
      mode: "restricted",
      explanation: "Beperkte modus: core-analyses zijn mogelijk maar conversie-metrics moeten voorzichtig worden geinterpreteerd.",
    };
  }

  return {
    mode: "full",
    explanation: "Volledige modus: data is betrouwbaar genoeg voor uitgebreide analyse.",
  };
}

// ── Prompt context builder ─────────────────────────────────────────────────

function buildPromptContext(
  confidence: OverallConfidence,
  mode: AnalysisMode,
  metrics: MetricReliability[],
  flags: ReliabilityFlag[]
): string {
  const lines: string[] = [];

  lines.push("## DATABETROUWBAARHEID (vooraf beoordeeld — gebruik deze instructies)");
  lines.push("");

  // Overall
  const confLabel = { high: "HOOG", medium: "GEMIDDELD", low: "LAAG", critical: "KRITIEK" }[confidence];
  lines.push(`Algeheel vertrouwen: ${confLabel}`);

  // Mode instructions
  if (mode === "diagnostic") {
    lines.push("");
    lines.push("DIAGNOSTISCHE MODUS ACTIEF:");
    lines.push("- Maak GEEN harde performance-conclusies op basis van conversie-metrics");
    lines.push("- Focus op: wat is betrouwbaar (spend, clicks, impressies) en wat niet (conversies, ROAS, CPA)");
    lines.push("- Prioriteer tracking-validatie als eerste actie");
    lines.push("- Geef WEL analyse van spend-patronen, click-trends, en budget-verdeling");
    lines.push("- Markeer alle conversie-gebaseerde uitspraken als INDICATIEF");
  } else if (mode === "restricted") {
    lines.push("");
    lines.push("BEPERKTE MODUS ACTIEF:");
    lines.push("- Spend/click/impressie-analyses zijn betrouwbaar — analyseer deze normaal");
    lines.push("- Conversie/ROAS/CPA-conclusies zijn INDICATIEF — voeg voorbehoud toe");
    lines.push("- Formuleer conversie-uitspraken als: 'Op basis van beschikbare (indicatieve) conversiedata...'");
    lines.push("- Geef GEEN harde budget-schaal aanbevelingen op basis van onbetrouwbare ROAS/CPA");
  }

  // Metric trust
  const unreliable = metrics.filter((m) => m.trust === "unreliable");
  const directional = metrics.filter((m) => m.trust === "directional");
  if (unreliable.length > 0 || directional.length > 0) {
    lines.push("");
    lines.push("Metric betrouwbaarheid:");
    for (const m of metrics) {
      if (m.trust === "unreliable") lines.push(`- ${m.metric}: ONBETROUWBAAR — ${m.reason}`);
      else if (m.trust === "directional") lines.push(`- ${m.metric}: INDICATIEF — ${m.reason}`);
    }
  }

  // Active flags
  const significantFlags = flags.filter((f) => f.severity === "critical" || f.severity === "high");
  if (significantFlags.length > 0) {
    lines.push("");
    lines.push("Gedetecteerde dataproblemen:");
    for (const f of significantFlags) {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.description}`);
    }
  }

  return lines.join("\n");
}
