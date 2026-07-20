// Deterministische creative-vermoeidheid: hoe het CTR-traject van een creative zich over de
// maanden ontwikkelt. De quick-scan op Overzicht toont de HUIDIGE prestatie; dit toont de
// BEWEGING — een creative die materieel onder zijn piek is gezakt, is versleten. Puur, geen IO,
// los getest. Ratio's per periode uit periode-totalen; oordeel alleen bij genoeg volume en
// genoeg periodes, anders eerlijk "te weinig data" in plaats van een lijn door twee punten.

export interface CreativePeriodRow {
  id: string;
  name: string;
  period: string; // "YYYY-MM"
  impressions: number;
  clicks: number;
}

export type FatigueStatus = "vermoeid" | "afnemend" | "stabiel" | "te_weinig_data";

export interface CreativeFatigue {
  id: string;
  name: string;
  status: FatigueStatus;
  points: { period: string; ctr: number | null; impressions: number }[];
  peakCtr: number | null;
  latestCtr: number | null;
  declineFromPeak: number | null; // relatief verval van piek naar laatste (negatief = gezakt)
  detail: string;
}

export const MIN_PERIODS_FOR_JUDGEMENT = 3;
export const MIN_IMPRESSIONS_PER_PERIOD = 300;
export const FATIGUE_DROP = 0.30; // >= 30% onder de piek = vermoeid
export const SOFT_DROP = 0.15;    // 15-30% onder de piek = afnemend

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pctText = (v: number | null): string => (v == null ? "n.v.t." : `${Math.round(v * 1000) / 10}%`);

function judgeCreative(name: string, id: string, rows: CreativePeriodRow[]): CreativeFatigue {
  const points = rows
    .slice()
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((r) => ({ period: r.period, ctr: r.impressions > 0 ? r.clicks / r.impressions : null, impressions: r.impressions }));

  const qualifying = points.filter((p) => p.impressions >= MIN_IMPRESSIONS_PER_PERIOD && p.ctr != null);
  if (qualifying.length < MIN_PERIODS_FOR_JUDGEMENT) {
    return {
      id, name, status: "te_weinig_data", points, peakCtr: null, latestCtr: null, declineFromPeak: null,
      detail: `Te weinig maanden met voldoende volume (${qualifying.length}/${MIN_PERIODS_FOR_JUDGEMENT}) voor een vermoeidheidsoordeel.`,
    };
  }

  const latest = qualifying[qualifying.length - 1];
  let peak = qualifying[0];
  for (const p of qualifying) if ((p.ctr ?? 0) > (peak.ctr ?? 0)) peak = p;
  const peakIsLatest = peak === latest;
  const declineFromPeak = peakIsLatest ? 0 : ((latest.ctr! - peak.ctr!) / peak.ctr!);

  let status: FatigueStatus;
  if (peakIsLatest || declineFromPeak > -SOFT_DROP) status = "stabiel";
  else if (declineFromPeak <= -FATIGUE_DROP) status = "vermoeid";
  else status = "afnemend";

  const detail = status === "stabiel"
    ? peakIsLatest
      ? `CTR piekt in de recentste maand (${pctText(latest.ctr)}) — geen vermoeidheid.`
      : `CTR ${pctText(latest.ctr)} zit dicht bij de piek (${pctText(peak.ctr)}) — stabiel.`
    : `CTR zakte van een piek van ${pctText(peak.ctr)} (${peak.period}) naar ${pctText(latest.ctr)} (${latest.period}) — ${pctText(declineFromPeak)} onder de piek.`;

  return { id, name, status, points, peakCtr: peak.ctr, latestCtr: latest.ctr, declineFromPeak, detail };
}

const STATUS_RANK: Record<FatigueStatus, number> = { vermoeid: 0, afnemend: 1, stabiel: 2, te_weinig_data: 3 };

export function analyzeCreativeFatigue(rows: CreativePeriodRow[]): CreativeFatigue[] {
  const byId = new Map<string, CreativePeriodRow[]>();
  const nameById = new Map<string, string>();
  for (const r of rows) {
    const id = String(r.id);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push({ ...r, impressions: num(r.impressions), clicks: num(r.clicks) });
    if (!nameById.has(id)) nameById.set(id, r.name);
  }
  return [...byId.entries()]
    .map(([id, rs]) => judgeCreative(nameById.get(id) ?? id, id, rs))
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.declineFromPeak ?? 0) - (b.declineFromPeak ?? 0));
}
