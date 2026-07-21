// Cross-channel KPI-verhoudingen + pacing: het complete beeld TUSSEN de kanalen, niet alleen
// binnen één. De KPI-verhoudingen-kern (kpi-relations.ts) is kanaal-agnostisch, dus we draaien
// hem op een BLENDED venster — de som van de kanalen — en krijgen zo de blended CPA-decompositie,
// verzadiging, bereik-verdunning en waarde-mix over de hele mediamix.
//
// Eén harde epistemische regel, net als bij de cross-channel-signalen: een verhaal over de
// blended totalen kan NOOIT "bewezen_binnen_platform" zijn, want elk kanaal meet zijn eigen
// attributie en de som is geen ontdubbelde telling. We plafonneren daarom elke zekerheid op
// "indicatie" en zetten de attributie-voetnoot in het verhaal. Kanaal-eigen metrics
// (frequentie, impression share, engagement) blenden niet en blijven bewust weg, zodat de
// bijbehorende detectoren (K6/K7/K8) cross-channel niet vals aanslaan.
//
// Pacing: hetzelfde maand-tot-nu-tempo als de per-kanaal-view, maar over de kanalen opgeteld —
// "loopt de hele mix voor of achter t.o.v. vorige maand op dezelfde dag". Puur, geen IO.

import { buildKpiRelations, type KpiWindow } from "./kpi-relations";
import type { DetectionResult, SignalStory, SignalCertainty } from "@/lib/signals/types";

export const CROSS_MIN_CHANNELS = 2; // cross-channel heeft per definitie minstens twee kanalen nodig

const CROSS_ATTRIBUTIE =
  "blended over de kanalen; elk kanaal meet zijn eigen attributie, dus dit is richtinggevend, geen exacte telling";

// Blend: som over de kanalen. Kanaal-eigen ratio-metrics blenden niet (frequentie/IS/engagement
// zijn geen optelbare grootheden) en blijven weg, zodat de kanaal-specifieke detectoren rusten.
export function blendKpiWindows(windows: KpiWindow[], label: string): KpiWindow {
  const sum = (f: (w: KpiWindow) => number) => windows.reduce((s, w) => s + f(w), 0);
  const anyValue = windows.some((w) => w.conversionsValue != null);
  return {
    label,
    impressions: sum((w) => w.impressions),
    clicks: sum((w) => w.clicks),
    cost: sum((w) => w.cost),
    conversions: sum((w) => w.conversions),
    conversionsValue: anyValue ? sum((w) => w.conversionsValue ?? 0) : null,
  };
}

// Zet een binnen-kanaal-verhaal om naar een cross-channel-verhaal: id onderscheiden, scope als
// blended markeren, attributie-voetnoot toevoegen en de zekerheid plafonneren op "indicatie".
function toCrossStory(s: SignalStory): SignalStory {
  const certainty: SignalCertainty = s.certainty === "bewezen_binnen_platform" ? "indicatie" : s.certainty;
  return {
    ...s,
    id: `${s.id}_cross`,
    category: "cross_channel",
    scope: `blended · ${s.scope}`,
    story: `${s.story} (${CROSS_ATTRIBUTIE})`,
    certainty,
  };
}

// Cross-channel KPI-verhoudingen: de detectoren op het blended totaal, geplafonneerd op indicatie.
export function buildCrossChannelKpiRelations(
  recentPerChannel: KpiWindow[],
  priorPerChannel: KpiWindow[],
  labels: { recent: string; prior: string } = { recent: "recent", prior: "vorige" }
): DetectionResult {
  const id = "cross_kpi_relations";
  if (recentPerChannel.length < CROSS_MIN_CHANNELS || priorPerChannel.length < CROSS_MIN_CHANNELS) {
    return { triggered: [], checked: [id] };
  }
  const recent = blendKpiWindows(recentPerChannel, labels.recent);
  const prior = blendKpiWindows(priorPerChannel, labels.prior);
  const base = buildKpiRelations(recent, prior);
  return {
    triggered: base.triggered.map(toCrossStory),
    checked: base.checked.map((c) => `${c}_cross`),
  };
}

// ── Blended pacing ─────────────────────────────────────────────────────────
export interface ChannelPacingInput {
  channel: string;
  mtdSpend: number;      // spend maand-tot-nu
  mtdConv: number;       // conversies/leads maand-tot-nu
  prevMtdSpend: number;  // vorige maand tot dezelfde dag
  prevMtdConv: number;
}

export interface BlendedPacing {
  channels: number;
  mtdSpend: number;
  prevMtdSpend: number;
  mtdConv: number;
  prevMtdConv: number;
  spendPacePct: number | null; // mtd / prevMtd
  convPacePct: number | null;
  runningAhead: boolean | null; // spend-tempo materieel boven vorige maand
  note: string;
}

export const PACING_AHEAD_FACTOR = 1.15; // >15% boven vorige maand op dezelfde dag = loopt voor

const pace = (cur: number, prev: number): number | null => (prev > 0 ? Math.round((cur / prev) * 1000) / 1000 : null);

// Tempo van de hele mix maand-tot-nu vs vorige maand op dezelfde dag, over de kanalen opgeteld.
export function blendedPacing(inputs: ChannelPacingInput[]): BlendedPacing {
  const sum = (f: (i: ChannelPacingInput) => number) => inputs.reduce((s, i) => s + f(i), 0);
  const mtdSpend = sum((i) => i.mtdSpend);
  const prevMtdSpend = sum((i) => i.prevMtdSpend);
  const mtdConv = sum((i) => i.mtdConv);
  const prevMtdConv = sum((i) => i.prevMtdConv);
  const spendPacePct = pace(mtdSpend, prevMtdSpend);
  const convPacePct = pace(mtdConv, prevMtdConv);
  const runningAhead = spendPacePct == null ? null : spendPacePct > PACING_AHEAD_FACTOR;
  const note =
    inputs.length < CROSS_MIN_CHANNELS
      ? "te weinig kanalen met data voor een blended tempo"
      : `blended tempo over ${inputs.length} kanalen; elk kanaal telt zijn eigen conversies`;
  return { channels: inputs.length, mtdSpend, prevMtdSpend, mtdConv, prevMtdConv, spendPacePct, convPacePct, runningAhead, note };
}
