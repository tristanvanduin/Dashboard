// Demografie-drift: verschuift de CONVERTERENDE mix over de tijd? De segment-efficiëntie is een
// momentopname; dit is de beweging — welk demografisch segment een groter of kleiner aandeel van
// de leads is gaan dragen tussen de vorige en de recente 28 dagen. Een wegzakkend segment dat
// eerder de leads droeg (doelgroep-uitputting of een targeting-wijziging) of een opkomend segment
// (de mix kantelt) is stuurbaar nieuws dat een snapshot niet toont. Aandelen uit venstertotalen,
// drempels op volume; een mix-verschuiving is een indicatie, geen bewijs van oorzaak. Puur, los getest.

import { mergeDetections, type DetectionResult, type SignalStory, type SignalEvidence } from "./types";

export interface DemographicDriftRow {
  dimension: string; // "functie" | "seniority" | "industrie" | "bedrijfsgrootte"
  value: string;
  date: string;      // ISO
  leads: number;
}

export const DRIFT_WINDOW_DAYS = 28;
export const DRIFT_MIN_WINDOW_LEADS = 10;  // minimaal leads per venster per dimensie om aandelen te vergelijken
export const DRIFT_MIN_SEGMENT_LEADS = 5;  // een segment moet in minstens één venster dit halen
export const DRIFT_SHARE_SHIFT = 0.15;     // materiële verschuiving in lead-aandeel (procentpunt/100)

const pctI = (v: number): string => `${Math.round(v * 100)}%`;
const ptS = (v: number): string => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}pt`;
const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });

interface Win { recent: number; prior: number }

function analyzeDimension(dimension: string, segs: Map<string, Win>): SignalStory[] {
  let recTotal = 0, priorTotal = 0;
  for (const w of segs.values()) { recTotal += w.recent; priorTotal += w.prior; }
  if (recTotal < DRIFT_MIN_WINDOW_LEADS || priorTotal < DRIFT_MIN_WINDOW_LEADS) return [];

  const shifts = [...segs.entries()]
    .filter(([, w]) => Math.max(w.recent, w.prior) >= DRIFT_MIN_SEGMENT_LEADS)
    .map(([value, w]) => {
      const shareRecent = w.recent / recTotal;
      const sharePrior = w.prior / priorTotal;
      return { value, shareRecent, sharePrior, shift: shareRecent - sharePrior };
    })
    .filter((s) => Math.abs(s.shift) >= DRIFT_SHARE_SHIFT);

  const stories: SignalStory[] = [];
  const riser = [...shifts].filter((s) => s.shift > 0).sort((a, b) => b.shift - a.shift)[0];
  const decliner = [...shifts].filter((s) => s.shift < 0).sort((a, b) => a.shift - b.shift)[0];

  if (decliner) {
    stories.push({
      id: `demographic_drift_daling_${dimension}`,
      category: "conversie_meting",
      scope: `${dimension}: ${decliner.value}`,
      story: `Binnen ${dimension} zakte het lead-aandeel van '${decliner.value}' van ${pctI(decliner.sharePrior)} → ${pctI(decliner.shareRecent)} (${ptS(decliner.shift)}) tussen de vorige en de recente ${DRIFT_WINDOW_DAYS} dagen: het segment dat eerder de leads droeg, droogt op.`,
      actionDirection: `onderzoek of dit doelgroep-uitputting, creative-fatigue of een targeting-wijziging is; leun niet op een audience die wegzakt`,
      certainty: "indicatie",
      evidence: [ev("segment", decliner.value), ev("aandeel vorige", pctI(decliner.sharePrior)), ev("aandeel recent", pctI(decliner.shareRecent)), ev("verschuiving", ptS(decliner.shift))],
    });
  }
  if (riser) {
    stories.push({
      id: `demographic_drift_stijging_${dimension}`,
      category: "conversie_meting",
      scope: `${dimension}: ${riser.value}`,
      story: `Binnen ${dimension} steeg het lead-aandeel van '${riser.value}' van ${pctI(riser.sharePrior)} → ${pctI(riser.shareRecent)} (${ptS(riser.shift)}): de converterende mix kantelt hiernaartoe.`,
      actionDirection: `check of dit bewust is (targeting/creative-wijziging) of organisch; is het je ICP, overweeg dan het budget mee te laten bewegen`,
      certainty: "indicatie",
      evidence: [ev("segment", riser.value), ev("aandeel vorige", pctI(riser.sharePrior)), ev("aandeel recent", pctI(riser.shareRecent)), ev("verschuiving", ptS(riser.shift))],
    });
  }
  return stories;
}

export function buildDemographicDriftSignals(rows: DemographicDriftRow[], asOfDate: string): DetectionResult {
  const asOf = Date.parse(asOfDate);
  const ageOf = (date: string): number => (asOf - Date.parse(date)) / 86_400_000;

  const byDim = new Map<string, Map<string, Win>>();
  for (const r of rows) {
    if (!r.dimension || !r.value) continue;
    const age = ageOf(r.date);
    if (!Number.isFinite(age) || age < 0 || age >= DRIFT_WINDOW_DAYS * 2) continue;
    const window: keyof Win = age < DRIFT_WINDOW_DAYS ? "recent" : "prior";
    const segs = byDim.get(r.dimension) ?? new Map<string, Win>();
    const cur = segs.get(r.value) ?? { recent: 0, prior: 0 };
    cur[window] += r.leads;
    segs.set(r.value, cur);
    byDim.set(r.dimension, segs);
  }

  const results: DetectionResult[] = [];
  for (const [dimension, segs] of byDim) {
    results.push({ triggered: analyzeDimension(dimension, segs), checked: [`demographic_drift_${dimension}`] });
  }
  if (results.length === 0) return { triggered: [], checked: ["demographic_drift"] };
  return mergeDetections(results);
}
