// Losse Meta funnel-drop-off-analyse: de fase-overgangen (vertoning -> klik -> landing ->
// winkelwagen -> checkout -> conversie) over een recent 28-dagen-venster tegen het venster
// ervoor. Volledig deterministisch; ratio's UIT DE VENSTERTOTALEN (nooit dag-gemiddelden).
// Fasen zonder data (bijv. leadgen zonder e-commerce-events) degraderen expliciet in plaats
// van als 0% mee te tellen. Hergebruikt de venster-splitsing van de signaal-datalaag.

import { splitWindows } from "./channel-signal-data";

export const FUNNEL_DROP_MATERIAL = 0.15; // 15% relatieve verslechtering van een fase-rate is materieel
export const MIN_STAGE_VOLUME = 200;      // onder dit recente instap-volume is een rate ruis

export interface MetaFunnelDailyRow {
  date: string;
  impressions?: number | null;
  link_clicks?: number | null;
  landing_page_views?: number | null;
  add_to_cart?: number | null;
  initiate_checkout?: number | null;
  conversions?: number | null;
}

const STAGES: { key: keyof MetaFunnelDailyRow; label: string }[] = [
  { key: "impressions", label: "vertoningen" },
  { key: "link_clicks", label: "link-klikken" },
  { key: "landing_page_views", label: "landingspagina-views" },
  { key: "add_to_cart", label: "winkelwagen" },
  { key: "initiate_checkout", label: "checkout gestart" },
  { key: "conversions", label: "conversies" },
];

export interface FunnelStageFact {
  from: string;
  to: string;
  recentRate: number | null;  // to/from in het recente venster
  priorRate: number | null;
  deltaPct: number | null;    // relatieve verandering van de rate (negatief = verslechterd)
  recentFromVolume: number;
}

export interface MetaFunnelFacts {
  available: boolean;
  degradedReason: string | null;
  stages: FunnelStageFact[];
  /** De materieel verslechterde fase met het grootste relatieve verval, of null. */
  worst: FunnelStageFact | null;
  skippedStages: string[]; // fasen zonder data, expliciet benoemd
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function sums(rows: MetaFunnelDailyRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of STAGES) out[s.key] = rows.reduce((acc, r) => acc + n(r[s.key] as number | null | undefined), 0);
  return out;
}

export function analyzeMetaFunnel(rows: MetaFunnelDailyRow[]): MetaFunnelFacts {
  if (rows.length === 0) {
    return { available: false, degradedReason: "geen Meta-dagdata", stages: [], worst: null, skippedStages: [] };
  }
  const { recent, prior } = splitWindows(rows);
  const rec = sums(recent);
  const pri = sums(prior);

  // Alleen fasen met data aan minstens een kant van de overgang doen mee.
  const activeStages = STAGES.filter((s) => rec[s.key] > 0 || pri[s.key] > 0);
  const skippedStages = STAGES.filter((s) => !(rec[s.key] > 0 || pri[s.key] > 0)).map((s) => s.label);
  if (activeStages.length < 2) {
    return { available: false, degradedReason: "te weinig funnel-fasen met data (alleen " + (activeStages[0]?.label ?? "geen") + ")", stages: [], worst: null, skippedStages };
  }

  const stages: FunnelStageFact[] = [];
  for (let i = 1; i < activeStages.length; i++) {
    const fromKey = activeStages[i - 1].key;
    const toKey = activeStages[i].key;
    const recentRate = rec[fromKey] > 0 ? rec[toKey] / rec[fromKey] : null;
    const priorRate = pri[fromKey] > 0 ? pri[toKey] / pri[fromKey] : null;
    const deltaPct = recentRate != null && priorRate != null && priorRate > 0 ? (recentRate - priorRate) / priorRate : null;
    stages.push({
      from: activeStages[i - 1].label,
      to: activeStages[i].label,
      recentRate,
      priorRate,
      deltaPct,
      recentFromVolume: rec[fromKey],
    });
  }

  const material = stages.filter((s) => s.deltaPct != null && s.deltaPct <= -FUNNEL_DROP_MATERIAL && s.recentFromVolume >= MIN_STAGE_VOLUME);
  const worst = material.sort((a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0))[0] ?? null;

  return { available: true, degradedReason: null, stages, worst, skippedStages };
}

const fmtPct = (v: number | null): string => (v == null ? "n.v.t." : `${Math.round(v * 1000) / 10}%`);
const fmtDelta = (v: number | null): string => (v == null ? "n.v.t." : `${v >= 0 ? "+" : ""}${Math.round(v * 1000) / 10}%`);

export function renderMetaFunnelMarkdown(facts: MetaFunnelFacts): string {
  const lines: string[] = ["# Meta funnel-drop-off", ""];
  if (!facts.available) {
    lines.push("## Niet uitvoerbaar", `- ${facts.degradedReason}`);
    if (facts.skippedStages.length) lines.push(`- fasen zonder data: ${facts.skippedStages.join(", ")}`);
    return lines.join("\n");
  }
  lines.push("Fase-overgangen: recent 28-dagen-venster vs het venster ervoor (rates uit venstertotalen).", "");
  for (const s of facts.stages) {
    lines.push(`- ${s.from} → ${s.to}: **${fmtPct(s.recentRate)}** (was ${fmtPct(s.priorRate)}, ${fmtDelta(s.deltaPct)})${facts.worst === s ? " ← grootste materiele verslechtering" : ""}`);
  }
  if (facts.worst) {
    lines.push("", `## Duiding`, `De overgang **${facts.worst.from} → ${facts.worst.to}** verslechterde ${fmtDelta(facts.worst.deltaPct)}; onderzoek wat er in die fase veranderde (creative, doelgroep, landingservaring) voordat er aan andere knoppen gedraaid wordt.`);
  } else {
    lines.push("", "Geen materiele verslechtering in de funnel-fasen.");
  }
  if (facts.skippedStages.length) {
    lines.push("", "## Expliciet overgeslagen (geen data)", `- ${facts.skippedStages.join(", ")}`);
  }
  return lines.join("\n");
}
