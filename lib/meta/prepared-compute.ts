// M2 data-laag (pre-compute): pure, deterministische functies die Meta daily-rijen omzetten
// in de voorgerekende feiten die de SOP-stappen nodig hebben. Het model rekent zo met
// aangeleverde getallen in plaats van zelf te rekenen. Geen Supabase, geen IO: dit is de
// rekenkern en is volledig op fixtures te testen.
//
// De route-integratie (rijen ophalen uit de M1-tabellen, de prepared-context-rij vullen en
// opslaan, en kanaal-bewust kiezen tussen Google en Meta) is een aparte plumbing-laag die
// deze functies aanroept; die is pas tegen live Meta-data te verifieren.

// De velden die de rekenkern nodig heeft. De route mapt DB-rijen (snake_case) naar deze vorm.
export interface MetaComputeRow {
  date: string; // YYYY-MM-DD
  entity_id: string;
  entity_name?: string;
  impressions: number;
  spend: number;
  link_clicks: number;
  conversions: number;
  conversion_value: number;
  reach?: number | null;
  frequency?: number | null;
  // Video-numerators voor hook/hold (alleen ad-niveau relevant).
  video_3s_views?: number | null;
  video_thruplays?: number | null;
  // Funnelfasen voor stap 8 (account/campaign-niveau); afwezig telt als 0.
  landing_page_views?: number | null;
  add_to_cart?: number | null;
  initiate_checkout?: number | null;
}

export function safeDiv(num: number, den: number): number | null {
  return den > 0 && Number.isFinite(num) && Number.isFinite(den) ? num / den : null;
}

function round(value: number | null, decimals = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function pct(value: number | null, decimals = 2): number | null {
  return value === null ? null : round(value * 100, decimals);
}

function sum(rows: MetaComputeRow[], key: keyof MetaComputeRow): number {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}

export function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

// De afgeleide metrieken, herberekend uit sommen (nooit gemiddelden van ratio's middelen).
export interface DerivedMetrics {
  impressions: number;
  spend: number;
  link_clicks: number;
  conversions: number;
  conversion_value: number;
  link_ctr_pct: number | null; // link clicks / impressions
  cpc: number | null; // spend / link clicks
  cvr_pct: number | null; // conversions / link clicks
  cpa: number | null; // spend / conversions
  roas: number | null; // conversion value / spend
  hook_rate_pct: number | null; // 3s views / impressions
  hold_rate_pct: number | null; // thruplays / impressions
}

export function deriveFromRows(rows: MetaComputeRow[]): DerivedMetrics {
  const impressions = sum(rows, "impressions");
  const spend = sum(rows, "spend");
  const link_clicks = sum(rows, "link_clicks");
  const conversions = sum(rows, "conversions");
  const conversion_value = sum(rows, "conversion_value");
  const video_3s = sum(rows, "video_3s_views");
  const thruplays = sum(rows, "video_thruplays");
  return {
    impressions,
    spend: round(spend) ?? 0,
    link_clicks,
    conversions,
    conversion_value: round(conversion_value) ?? 0,
    link_ctr_pct: pct(safeDiv(link_clicks, impressions)),
    cpc: round(safeDiv(spend, link_clicks)),
    cvr_pct: pct(safeDiv(conversions, link_clicks)),
    cpa: round(safeDiv(spend, conversions)),
    roas: round(safeDiv(conversion_value, spend)),
    hook_rate_pct: pct(safeDiv(video_3s, impressions)),
    hold_rate_pct: pct(safeDiv(thruplays, impressions)),
  };
}

// Maandaggregatie: groepeer op YYYY-MM, sommeer tellingen, herbereken afgeleiden.
export interface MonthlyMetrics extends DerivedMetrics {
  month: string; // YYYY-MM
}

export function aggregateMonthly(rows: MetaComputeRow[]): MonthlyMetrics[] {
  const byMonth = groupBy(rows, (r) => String(r.date || "").slice(0, 7));
  const months = [...byMonth.keys()].filter(Boolean).sort();
  return months.map((month) => ({ month, ...deriveFromRows(byMonth.get(month) ?? []) }));
}

// MoM-keten voor stap 1: per KPI de waarde laatste maand, vorige maand, delta% en richting.
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

// De keten conform de spec: Conversiewaarde -> Conversies -> CVR -> Link clicks -> CPC -> Spend -> Impressions -> Link CTR.
const KPI_CHAIN: Array<{ metric: string; key: keyof DerivedMetrics }> = [
  { metric: "Conversiewaarde", key: "conversion_value" },
  { metric: "Conversies", key: "conversions" },
  { metric: "CVR", key: "cvr_pct" },
  { metric: "Link clicks", key: "link_clicks" },
  { metric: "CPC", key: "cpc" },
  { metric: "Spend", key: "spend" },
  { metric: "Impressions", key: "impressions" },
  { metric: "Link CTR", key: "link_ctr_pct" },
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
  const slopeSign = numr;
  const rel = yMean !== 0 ? slopeSign / Math.abs(yMean) : slopeSign;
  if (rel > 0.01) return "stijgt";
  if (rel < -0.01) return "daalt";
  return "vlak";
}

// Versus-gemiddelde voor stap 2/3/6/7: entiteitswaarde tegen het account-/groepsgemiddelde.
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

// Stap 4: fatigue-detectie per ad. Drempel uit de spec: link CTR minus 30% versus de eigen
// eerste-week baseline bij frequency boven 2.5. Baseline = eerste 7 actieve dagen, recent =
// laatste 7 actieve dagen, frequency = gemiddelde over de recente dagen.
export interface AdFatigueFact {
  entity_id: string;
  entity_name?: string;
  days_live: number;
  baseline_link_ctr_pct: number | null;
  recent_link_ctr_pct: number | null;
  ctr_change_pct: number | null; // negatief = daling
  recent_frequency: number | null;
  fatigue: boolean;
}

const FATIGUE_CTR_DROP = 0.3; // 30%
const FATIGUE_FREQ_THRESHOLD = 2.5;
const FATIGUE_WINDOW = 7;

function avgFrequency(rows: MetaComputeRow[]): number | null {
  const vals = rows.map((r) => r.frequency).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) {
    // Val terug op impressions/reach als frequency niet is meegegeven.
    const impr = sum(rows, "impressions");
    const reach = sum(rows, "reach");
    return safeDiv(impr, reach);
  }
  return round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function detectAdFatigue(adRows: MetaComputeRow[]): AdFatigueFact[] {
  const byAd = groupBy(adRows, (r) => r.entity_id);
  const facts: AdFatigueFact[] = [];
  for (const [entity_id, rows] of byAd) {
    const active = rows.filter((r) => (Number(r.impressions) || 0) > 0).sort((a, b) => a.date.localeCompare(b.date));
    const name = rows.find((r) => r.entity_name)?.entity_name;
    if (active.length === 0) {
      facts.push({ entity_id, entity_name: name, days_live: 0, baseline_link_ctr_pct: null, recent_link_ctr_pct: null, ctr_change_pct: null, recent_frequency: null, fatigue: false });
      continue;
    }
    const baselineRows = active.slice(0, FATIGUE_WINDOW);
    const recentRows = active.slice(-FATIGUE_WINDOW);
    const baseCtr = safeDiv(sum(baselineRows, "link_clicks"), sum(baselineRows, "impressions"));
    const recentCtr = safeDiv(sum(recentRows, "link_clicks"), sum(recentRows, "impressions"));
    const recentFreq = avgFrequency(recentRows);
    const ctrChange = baseCtr !== null && recentCtr !== null && baseCtr > 0 ? round(((recentCtr - baseCtr) / baseCtr) * 100) : null;
    const fatigue =
      baseCtr !== null && recentCtr !== null && baseCtr > 0 &&
      recentCtr <= baseCtr * (1 - FATIGUE_CTR_DROP) &&
      recentFreq !== null && recentFreq > FATIGUE_FREQ_THRESHOLD;
    facts.push({
      entity_id,
      entity_name: name,
      days_live: active.length,
      baseline_link_ctr_pct: pct(baseCtr),
      recent_link_ctr_pct: pct(recentCtr),
      ctr_change_pct: ctrChange,
      recent_frequency: recentFreq,
      fatigue,
    });
  }
  return facts.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}
