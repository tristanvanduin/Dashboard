// Generieke funnel-drop-off-kern, gedeeld door de kanaal-analyses (Meta, LinkedIn, Google).
// Eén bewezen implementatie voor: venster-splitsing (recent vs prior), sommen per fase,
// overgangs-rates UIT VENSTERTOTALEN, materieel-verslechterde fase met ruis-drempels, en
// expliciet overgeslagen fasen (geen data telt nooit stiekem als 0%). De kanaal-modules
// leveren alleen hun fase-definities; de drempels en de semantiek zijn overal gelijk.

import { splitWindows } from "./channel-signal-data";

export const FUNNEL_DROP_MATERIAL = 0.15; // 15% relatieve verslechtering van een fase-rate is materieel
export const MIN_STAGE_VOLUME = 200;      // onder dit recente instap-volume is een rate ruis

export interface FunnelStageDef<R> {
  key: string;
  label: string;
  value: (row: R) => number | null | undefined;
}

export interface FunnelStageFact {
  from: string;
  to: string;
  recentRate: number | null;  // to/from in het recente venster
  priorRate: number | null;
  deltaPct: number | null;    // relatieve verandering van de rate (negatief = verslechterd)
  recentFromVolume: number;
}

export interface FunnelFacts {
  available: boolean;
  degradedReason: string | null;
  stages: FunnelStageFact[];
  /** De materieel verslechterde fase met het grootste relatieve verval, of null. */
  worst: FunnelStageFact | null;
  skippedStages: string[]; // fasen zonder data, expliciet benoemd
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function analyzeFunnel<R extends { date: string }>(
  rows: R[],
  stageDefs: FunnelStageDef<R>[],
  opts?: { windowDays?: number; emptyReason?: string }
): FunnelFacts {
  if (rows.length === 0) {
    return { available: false, degradedReason: opts?.emptyReason ?? "geen dagdata", stages: [], worst: null, skippedStages: [] };
  }
  const { recent, prior } = splitWindows(rows, opts?.windowDays);
  const sum = (win: R[], def: FunnelStageDef<R>) => win.reduce((acc, r) => acc + n(def.value(r)), 0);
  const rec = new Map(stageDefs.map((d) => [d.key, sum(recent, d)]));
  const pri = new Map(stageDefs.map((d) => [d.key, sum(prior, d)]));

  // Alleen fasen met data aan minstens een kant van de overgang doen mee.
  const active = stageDefs.filter((d) => (rec.get(d.key) ?? 0) > 0 || (pri.get(d.key) ?? 0) > 0);
  const skippedStages = stageDefs.filter((d) => !((rec.get(d.key) ?? 0) > 0 || (pri.get(d.key) ?? 0) > 0)).map((d) => d.label);
  if (active.length < 2) {
    return { available: false, degradedReason: `te weinig funnel-fasen met data (alleen ${active[0]?.label ?? "geen"})`, stages: [], worst: null, skippedStages };
  }

  const stages: FunnelStageFact[] = [];
  for (let i = 1; i < active.length; i++) {
    const fromKey = active[i - 1].key;
    const toKey = active[i].key;
    const recFrom = rec.get(fromKey) ?? 0;
    const priFrom = pri.get(fromKey) ?? 0;
    const recentRate = recFrom > 0 ? (rec.get(toKey) ?? 0) / recFrom : null;
    const priorRate = priFrom > 0 ? (pri.get(toKey) ?? 0) / priFrom : null;
    const deltaPct = recentRate != null && priorRate != null && priorRate > 0 ? (recentRate - priorRate) / priorRate : null;
    stages.push({ from: active[i - 1].label, to: active[i].label, recentRate, priorRate, deltaPct, recentFromVolume: recFrom });
  }

  const material = stages.filter((s) => s.deltaPct != null && s.deltaPct <= -FUNNEL_DROP_MATERIAL && s.recentFromVolume >= MIN_STAGE_VOLUME);
  const worst = material.sort((a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0))[0] ?? null;

  return { available: true, degradedReason: null, stages, worst, skippedStages };
}

const fmtPct = (v: number | null): string => (v == null ? "n.v.t." : `${Math.round(v * 1000) / 10}%`);
const fmtDelta = (v: number | null): string => (v == null ? "n.v.t." : `${v >= 0 ? "+" : ""}${Math.round(v * 1000) / 10}%`);

/** Kanaal-agnostische markdown-renderer; de kanaal-routes leveren alleen titel en venster-tekst. */
export function renderFunnelMarkdown(facts: FunnelFacts, opts: { title: string; windowNote: string }): string {
  const lines: string[] = [`# ${opts.title}`, ""];
  if (!facts.available) {
    lines.push("## Niet uitvoerbaar", `- ${facts.degradedReason}`);
    if (facts.skippedStages.length) lines.push(`- fasen zonder data: ${facts.skippedStages.join(", ")}`);
    return lines.join("\n");
  }
  lines.push(opts.windowNote, "");
  for (const s of facts.stages) {
    lines.push(`- ${s.from} → ${s.to}: **${fmtPct(s.recentRate)}** (was ${fmtPct(s.priorRate)}, ${fmtDelta(s.deltaPct)})${facts.worst === s ? " ← grootste materiele verslechtering" : ""}`);
  }
  if (facts.worst) {
    lines.push("", "## Duiding", `De overgang **${facts.worst.from} → ${facts.worst.to}** verslechterde ${fmtDelta(facts.worst.deltaPct)}; onderzoek wat er in die fase veranderde voordat er aan andere knoppen gedraaid wordt.`);
  } else {
    lines.push("", "Geen materiele verslechtering in de funnel-fasen.");
  }
  if (facts.skippedStages.length) {
    lines.push("", "## Expliciet overgeslagen (geen data)", `- ${facts.skippedStages.join(", ")}`);
  }
  return lines.join("\n");
}
