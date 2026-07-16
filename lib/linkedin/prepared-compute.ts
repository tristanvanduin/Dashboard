// L2 rekenkern: de deterministische pre-compute voor de LinkedIn SOP. Herberekent afgeleide
// metrieken uit SOMMEN (nooit ratio's van ratio's middelen), aggregeert per maand, en levert de
// MoM-keten, trendrichting en versus-gemiddelde die de stappen als voorgerekende feiten krijgen.
// Gespiegeld op de M2-rekenkern (lib/meta/prepared-compute.ts), met de LinkedIn-metrieken en de
// LinkedIn-KPI-keten. Puur, geen I/O, los op fixtures te testen.

export interface LinkedInComputeRow {
  date: string | null;
  entityUrn?: string | null;
  entityName?: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  form_opens: number;
  conversions: number;
  conversion_value: number;
}

function sum(rows: LinkedInComputeRow[], key: keyof LinkedInComputeRow): number {
  return rows.reduce((acc, r) => acc + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
}
function round(v: number | null, dp = 2): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}
function pct(ratio: number | null): number | null {
  return ratio == null ? null : round(ratio * 100);
}

// Deelt veilig: deler 0 geeft null, zodat een metriek nooit Infinity of NaN wordt.
export function safeDiv(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

export function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

// De afgeleide metrieken, herberekend uit sommen. CPL en CTR en de funnel-ratio's leiden bij LinkedIn.
export interface DerivedMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  form_opens: number;
  conversions: number;
  conversion_value: number;
  ctr_pct: number | null; // clicks / impressions
  cpc: number | null; // spend / clicks
  cpm: number | null; // spend / impressions * 1000
  cpl: number | null; // spend / leads
  open_rate_pct: number | null; // form opens / clicks
  form_completion_rate_pct: number | null; // leads / form opens
  cvr_pct: number | null; // conversions / clicks
}

export function deriveFromRows(rows: LinkedInComputeRow[]): DerivedMetrics {
  const impressions = sum(rows, "impressions");
  const clicks = sum(rows, "clicks");
  const spend = sum(rows, "spend");
  const leads = sum(rows, "leads");
  const form_opens = sum(rows, "form_opens");
  const conversions = sum(rows, "conversions");
  const conversion_value = sum(rows, "conversion_value");
  const cpmBase = safeDiv(spend, impressions);
  return {
    impressions,
    clicks,
    spend: round(spend) ?? 0,
    leads,
    form_opens,
    conversions,
    conversion_value: round(conversion_value) ?? 0,
    ctr_pct: pct(safeDiv(clicks, impressions)),
    cpc: round(safeDiv(spend, clicks)),
    cpm: round(cpmBase == null ? null : cpmBase * 1000),
    cpl: round(safeDiv(spend, leads)),
    open_rate_pct: pct(safeDiv(form_opens, clicks)),
    form_completion_rate_pct: pct(safeDiv(leads, form_opens)),
    cvr_pct: pct(safeDiv(conversions, clicks)),
  };
}

// Maandaggregatie: groepeer op YYYY-MM, sommeer tellingen, herbereken afgeleiden.
export interface MonthlyMetrics extends DerivedMetrics {
  month: string;
}

export function aggregateMonthly(rows: LinkedInComputeRow[]): MonthlyMetrics[] {
  const byMonth = groupBy(rows, (r) => String(r.date || "").slice(0, 7));
  const months = [...byMonth.keys()].filter(Boolean).sort();
  return months.map((month) => ({ month, ...deriveFromRows(byMonth.get(month) ?? []) }));
}

export type Direction = "stijgt" | "daalt" | "vlak";

function direction(deltaPct: number | null): Direction {
  if (deltaPct === null) return "vlak";
  if (deltaPct > 1) return "stijgt";
  if (deltaPct < -1) return "daalt";
  return "vlak";
}

export interface MoMFact {
  metric: string;
  latest: number | null;
  previous: number | null;
  delta_pct: number | null;
  direction: Direction;
}

// De keten conform de L2-spec: Leads -> Form completion rate -> Form opens -> Clicks -> CPC -> Spend -> Impressions -> CTR.
const KPI_CHAIN: Array<{ metric: string; key: keyof DerivedMetrics }> = [
  { metric: "Leads", key: "leads" },
  { metric: "Form completion rate", key: "form_completion_rate_pct" },
  { metric: "Form opens", key: "form_opens" },
  { metric: "Clicks", key: "clicks" },
  { metric: "CPC", key: "cpc" },
  { metric: "Spend", key: "spend" },
  { metric: "Impressions", key: "impressions" },
  { metric: "CTR", key: "ctr_pct" },
];

function deltaPct(latest: number | null, previous: number | null): number | null {
  if (latest === null || previous === null || previous === 0) return null;
  return round(((latest - previous) / Math.abs(previous)) * 100);
}

export function computeMoMChain(monthly: MonthlyMetrics[]): { latest_month: string | null; previous_month: string | null; chain: MoMFact[] } {
  if (monthly.length < 1) return { latest_month: null, previous_month: null, chain: [] };
  const latest = monthly[monthly.length - 1];
  const previous = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
  const chain = KPI_CHAIN.map(({ metric, key }) => {
    const latestVal = (latest[key] as number | null) ?? null;
    const prevVal = previous ? ((previous[key] as number | null) ?? null) : null;
    const d = deltaPct(latestVal, prevVal);
    return { metric, latest: latestVal, previous: prevVal, delta_pct: d, direction: direction(d) };
  });
  return { latest_month: latest.month, previous_month: previous?.month ?? null, chain };
}

// Trendrichting over de laatste N maanden via het teken van de lineaire helling.
export function trendDirection(monthly: MonthlyMetrics[], key: keyof DerivedMetrics, window: number): Direction {
  const series = monthly.slice(-window).map((m) => (m[key] as number | null) ?? null).filter((v): v is number => v !== null);
  if (series.length < 2) return "vlak";
  const n = series.length;
  const xMean = (n - 1) / 2;
  const yMean = series.reduce((a, b) => a + b, 0) / n;
  let numr = 0;
  for (let i = 0; i < n; i++) numr += (i - xMean) * (series[i] - yMean);
  const rel = yMean !== 0 ? numr / Math.abs(yMean) : numr;
  if (rel > 0.01) return "stijgt";
  if (rel < -0.01) return "daalt";
  return "vlak";
}

// Versus-gemiddelde voor stap 2/3/4/7: entiteitswaarde tegen het account- of groepsgemiddelde.
export interface VsAverageFact {
  metric: string;
  value: number | null;
  average: number | null;
  delta_pct: number | null;
  position: "boven" | "onder" | "gelijk";
}

export function computeVsAverage(metric: string, value: number | null, average: number | null): VsAverageFact {
  const d = deltaPct(value, average);
  const position = d === null ? "gelijk" : d > 1 ? "boven" : d < -1 ? "onder" : "gelijk";
  return { metric, value, average, delta_pct: d, position };
}
