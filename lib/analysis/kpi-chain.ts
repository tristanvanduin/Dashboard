export interface KpiChainLink {
  metric: string;
  currentValue: number;
  previousValue: number;
  changePct: number;
  contribution: "positive" | "negative" | "neutral";
  rank: number;
}

export interface KpiChain {
  resultMetric: string;
  resultDelta: number;
  chain: KpiChainLink[];
  primaryDriver: string;
  formattedChain: string;
}

type ResultMetric = "conversion_value" | "conversions";

function num(value: unknown): number {
  return Number(value || 0);
}

function pct(cur: number, prev: number): number {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Number((((cur - prev) / prev) * 100).toFixed(1));
}

function inferContribution(metric: string, changePct: number, resultDelta: number): "positive" | "negative" | "neutral" {
  if (changePct === 0 || resultDelta === 0) return "neutral";
  const higherHelps = new Set(["conversion_value", "conversions", "aov", "conversion_rate", "clicks", "ctr", "impressions"]);
  const helps = higherHelps.has(metric) ? changePct > 0 : changePct < 0;
  const resultPositive = resultDelta > 0;
  return helps === resultPositive ? "positive" : "negative";
}

function buildMetricChain(
  currentMonth: Record<string, number>,
  previousMonth: Record<string, number>,
  resultMetric: ResultMetric
): Array<Omit<KpiChainLink, "rank">> {
  const currentConversions = num(currentMonth.conversions);
  const previousConversions = num(previousMonth.conversions);
  const currentValue = num(currentMonth.conversion_value ?? currentMonth.conversions_value);
  const previousValue = num(previousMonth.conversion_value ?? previousMonth.conversions_value);
  const currentClicks = num(currentMonth.clicks);
  const previousClicks = num(previousMonth.clicks);
  const currentImpressions = num(currentMonth.impressions);
  const previousImpressions = num(previousMonth.impressions);
  const currentCtr = num(currentMonth.ctr) || (currentImpressions > 0 ? currentClicks / currentImpressions : 0);
  const previousCtr = num(previousMonth.ctr) || (previousImpressions > 0 ? previousClicks / previousImpressions : 0);
  const currentCvr = num(currentMonth.conversion_rate) || (currentClicks > 0 ? currentConversions / currentClicks : 0);
  const previousCvr = num(previousMonth.conversion_rate) || (previousClicks > 0 ? previousConversions / previousClicks : 0);
  const currentAov = currentConversions > 0 ? currentValue / currentConversions : 0;
  const previousAov = previousConversions > 0 ? previousValue / previousConversions : 0;
  const currentCpc = num(currentMonth.avg_cpc) || (currentClicks > 0 ? num(currentMonth.cost) / currentClicks : 0);
  const previousCpc = num(previousMonth.avg_cpc) || (previousClicks > 0 ? num(previousMonth.cost) / previousClicks : 0);
  const resultDelta = pct(
    resultMetric === "conversion_value" ? currentValue : currentConversions,
    resultMetric === "conversion_value" ? previousValue : previousConversions
  );

  const base: Array<{ metric: string; currentValue: number; previousValue: number }> = resultMetric === "conversion_value"
    ? [
        { metric: "conversions", currentValue: currentConversions, previousValue: previousConversions },
        { metric: "aov", currentValue: currentAov, previousValue: previousAov },
        { metric: "conversion_rate", currentValue: currentCvr, previousValue: previousCvr },
        { metric: "clicks", currentValue: currentClicks, previousValue: previousClicks },
        { metric: "ctr", currentValue: currentCtr, previousValue: previousCtr },
        { metric: "impressions", currentValue: currentImpressions, previousValue: previousImpressions },
      ]
    : [
        { metric: "conversion_rate", currentValue: currentCvr, previousValue: previousCvr },
        { metric: "clicks", currentValue: currentClicks, previousValue: previousClicks },
        { metric: "ctr", currentValue: currentCtr, previousValue: previousCtr },
        { metric: "impressions", currentValue: currentImpressions, previousValue: previousImpressions },
        { metric: "avg_cpc", currentValue: currentCpc, previousValue: previousCpc },
      ];

  return base.map((item) => {
    const changePct = pct(item.currentValue, item.previousValue);
    return {
      metric: item.metric,
      currentValue: item.currentValue,
      previousValue: item.previousValue,
      changePct,
      contribution: inferContribution(item.metric, changePct, resultDelta),
    };
  });
}

function formatValue(metric: string, value: number): string {
  if (metric === "aov" || metric === "avg_cpc") return `€${value.toFixed(2)}`;
  if (metric === "conversion_rate" || metric === "ctr") return `${(value * 100).toFixed(2)}%`;
  return value >= 100 ? Math.round(value).toString() : value.toFixed(2);
}

function metricLabel(metric: string): string {
  switch (metric) {
    case "conversion_value":
      return "Conversiewaarde";
    case "conversions":
      return "Conversies";
    case "conversion_rate":
      return "CVR";
    case "avg_cpc":
      return "CPC";
    case "ctr":
      return "CTR";
    case "impressions":
      return "Impressies";
    case "clicks":
      return "Klikken";
    case "aov":
      return "AOV";
    default:
      return metric;
  }
}

export function computeKpiChain(opts: {
  currentMonth: Record<string, number>;
  previousMonth: Record<string, number>;
  resultMetric: ResultMetric;
}): KpiChain {
  const currentResult = num(opts.currentMonth[opts.resultMetric]) || num(opts.currentMonth[opts.resultMetric === "conversion_value" ? "conversions_value" : opts.resultMetric]);
  const previousResult = num(opts.previousMonth[opts.resultMetric]) || num(opts.previousMonth[opts.resultMetric === "conversion_value" ? "conversions_value" : opts.resultMetric]);
  const resultDelta = pct(currentResult, previousResult);
  const ranked = buildMetricChain(opts.currentMonth, opts.previousMonth, opts.resultMetric)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const primaryDriver = ranked[0]?.metric ?? (opts.resultMetric === "conversion_value" ? "conversions" : "conversion_rate");
  const formattedChain = [
    `${metricLabel(opts.resultMetric)} ${resultDelta >= 0 ? "+" : ""}${resultDelta}% wordt primair verklaard door ${metricLabel(primaryDriver)} (${ranked[0]?.changePct >= 0 ? "+" : ""}${ranked[0]?.changePct ?? 0}%, van ${formatValue(primaryDriver, ranked[0]?.previousValue ?? 0)} naar ${formatValue(primaryDriver, ranked[0]?.currentValue ?? 0)}).`,
    ...ranked.slice(1, 4).map((link) =>
      `${metricLabel(link.metric)} ${link.changePct >= 0 ? "steeg" : "daalde"} ${Math.abs(link.changePct)}% (${formatValue(link.metric, link.previousValue)} → ${formatValue(link.metric, link.currentValue)}).`
    ),
  ].join(" ");

  return {
    resultMetric: opts.resultMetric,
    resultDelta,
    chain: ranked,
    primaryDriver,
    formattedChain,
  };
}

export function computeCampaignKpiChains(opts: {
  campaignData: Record<string, unknown>[];
  lastMonth: string;
  monthBeforeLast: string;
  resultMetric: ResultMetric;
}): KpiChain[] {
  const byCampaign = new Map<string, { current?: Record<string, unknown>; previous?: Record<string, unknown> }>();
  for (const row of opts.campaignData) {
    const name = String(row.campaign_name || "");
    if (!name) continue;
    if (!byCampaign.has(name)) byCampaign.set(name, {});
    const bucket = byCampaign.get(name)!;
    const month = String(row.month || "").slice(0, 7);
    if (month === opts.lastMonth) bucket.current = row;
    if (month === opts.monthBeforeLast) bucket.previous = row;
  }

  return Array.from(byCampaign.entries())
    .map(([campaignName, pair]) => {
      if (!pair.current || !pair.previous) return null;
      const chain = computeKpiChain({
        currentMonth: {
          conversion_value: num(pair.current.conversions_value),
          conversions: num(pair.current.conversions),
          clicks: num(pair.current.clicks),
          impressions: num(pair.current.impressions),
          ctr: num(pair.current.ctr),
          conversion_rate: num(pair.current.conversion_rate),
          avg_cpc: num(pair.current.avg_cpc),
          cost: num(pair.current.cost),
        },
        previousMonth: {
          conversion_value: num(pair.previous.conversions_value),
          conversions: num(pair.previous.conversions),
          clicks: num(pair.previous.clicks),
          impressions: num(pair.previous.impressions),
          ctr: num(pair.previous.ctr),
          conversion_rate: num(pair.previous.conversion_rate),
          avg_cpc: num(pair.previous.avg_cpc),
          cost: num(pair.previous.cost),
        },
        resultMetric: opts.resultMetric,
      });
      return {
        ...chain,
        formattedChain: `${campaignName}: ${chain.formattedChain}`,
      };
    })
    .filter((item): item is KpiChain => Boolean(item))
    .sort((a, b) => Math.abs(b.resultDelta) - Math.abs(a.resultDelta));
}
