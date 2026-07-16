// De metriek-aggregator voor de H1-evaluator: van weekrijen naar het canonieke
// metric-record waar de predicaten op ingaan.
//
// DE VALKUIL DIE HIER HARD DICHTGEZET IS: ads_account_weekly draagt kant-en-klare ratio's
// per week (ctr, avg_cpc, cost_per_conversion, conversion_rate). Die middelen over weken
// heen is FOUT, precies zoals bij de periode-evaluatie: het gemiddelde van vier weekelijkse
// CPA's weegt een week met 2 conversies even zwaar als een week met 200. Elke ratio wordt
// daarom herberekend uit de TOTALEN. De kolommen uit de tabel worden bewust genegeerd.
//
// WAT ER NIET IN ZIT: impressie-aandeel. De weektabel draagt het niet, dus een hypothese
// over impression_share is op dit niveau onmeetbaar. Deze module verzint dan niets; de
// evaluator ziet een ontbrekende metric en rapporteert eerlijk unmeasurable.

export interface WeeklyRow {
  week_start: string;
  impressions: number | null;
  clicks: number | null;
  cost: number | null;
  conversions: number | null;
  conversions_value: number | null;
}

// De metrics die op accountniveau uit de weekdata afleidbaar zijn.
export const DERIVABLE_METRICS = [
  "impressions",
  "clicks",
  "cost",
  "conversions",
  "conversions_value",
  "cpa",
  "roas",
  "ctr",
  "cpc",
  "conversion_rate",
] as const;

export function isDerivableMetric(metric: string): boolean {
  return (DERIVABLE_METRICS as readonly string[]).includes(metric);
}

function num(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Aggregeert een venster van weken naar het canonieke record. Ratio's uitsluitend uit
// totalen; een ratio waarvan de noemer nul is ontbreekt in plaats van nul te zijn, want
// nul zou een echte meting suggereren.
export function aggregateWeeks(rows: WeeklyRow[]): Record<string, number> {
  if (rows.length === 0) return {};
  const impressions = rows.reduce((s, r) => s + num(r.impressions), 0);
  const clicks = rows.reduce((s, r) => s + num(r.clicks), 0);
  const cost = rows.reduce((s, r) => s + num(r.cost), 0);
  const conversions = rows.reduce((s, r) => s + num(r.conversions), 0);
  const conversionsValue = rows.reduce((s, r) => s + num(r.conversions_value), 0);

  const out: Record<string, number> = { impressions, clicks, cost, conversions, conversions_value: conversionsValue };
  if (conversions > 0) out.cpa = cost / conversions;
  if (cost > 0) out.roas = conversionsValue / cost;
  if (impressions > 0) out.ctr = clicks / impressions;
  if (clicks > 0) {
    out.cpc = cost / clicks;
    out.conversion_rate = conversions / clicks;
  }
  return out;
}

// Selecteert de weken in een half-open venster [from, to). week_start is de maandag; een
// week telt mee als zijn start binnen het venster valt.
export function weeksInWindow(rows: WeeklyRow[], from: Date, to: Date): WeeklyRow[] {
  const fromKey = from.toISOString().slice(0, 10);
  const toKey = to.toISOString().slice(0, 10);
  return rows.filter((r) => {
    const key = String(r.week_start).slice(0, 10);
    return key >= fromKey && key < toKey;
  });
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 3600 * 1000);
}
