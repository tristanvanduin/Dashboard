// Cross-channel funnel-detectors: de funnel OVER de kanalen heen, op de fasen die elk kanaal
// deelt (vertoning -> klik -> conversie/lead). Drie verhalen die geen kanaal alleen kan
// vertellen: (1) de blended totaal-funnel verslechtert, (2) een kanaal is de fase-achterblijver
// (klikken die nergens landen zijn een ander probleem dan geen klikken), en (3) divergentie:
// een kanaal zakt op een fase terwijl de rest stabiel is — dan is het kanaal-specifiek, niet
// marktbreed. Zelfde attributie-regel als de andere cross-detectors: nooit "bewezen" over
// kanalen heen. Werkt op VOLLE maanden (de route sluit de lopende maand al uit).

import { mergeDetections, type DetectionResult, type SignalStory } from "./types";
import type { ChannelMonthlyInput } from "./cross-channel";

export const BLENDED_RATE_DROP = 0.15;   // 15% relatieve daling van een blended fase-rate is materieel
export const LAGGARD_FRAC = 0.4;         // een kanaal onder 40% van de beste klik->conversie-rate is achterblijver
export const DIVERGENCE_DROP = -0.20;    // het zakkende kanaal: minstens -20% op de fase-rate
export const DIVERGENCE_STABLE = 0.10;   // de overige kanalen: binnen +/-10% is "stabiel"
export const MIN_CLICKS = 200;           // onder dit klikvolume is een conversie-rate ruis
export const MIN_MONTHS = 3;

const VOETNOOT = "elk kanaal meet zijn eigen attributie; deze vergelijking is richtinggevend, geen exacte verdeling";

const mkey = (m: string) => m.slice(0, 7);
const r1 = (n: number) => Math.round(n * 10) / 10;
const pctS = (v: number | null) => (v == null ? "n.v.t." : `${Math.round(v * 1000) / 10}%`);

// Conversie-teller per kanaal: leadgen-kanalen tellen leads, de rest conversies.
function convOf(r: ChannelMonthlyInput): number {
  return r.conversions > 0 ? r.conversions : r.leads;
}

interface MonthAgg { impressions: number; clicks: number; conv: number }

function aggByMonth(rows: ChannelMonthlyInput[]): Map<string, MonthAgg> {
  const out = new Map<string, MonthAgg>();
  for (const r of rows) {
    const a = out.get(mkey(r.month)) ?? { impressions: 0, clicks: 0, conv: 0 };
    a.impressions += r.impressions; a.clicks += r.clicks; a.conv += convOf(r);
    out.set(mkey(r.month), a);
  }
  return out;
}

function lastVsPrior(byMonth: Map<string, MonthAgg>): { lastMonth: string; last: MonthAgg; prior: MonthAgg } | null {
  const months = [...byMonth.keys()].sort();
  if (months.length < MIN_MONTHS) return null;
  const lastMonth = months[months.length - 1];
  const priorMonths = months.slice(-3, -1);
  const prior = priorMonths.reduce<MonthAgg>((acc, m) => {
    const a = byMonth.get(m)!;
    return { impressions: acc.impressions + a.impressions, clicks: acc.clicks + a.clicks, conv: acc.conv + a.conv };
  }, { impressions: 0, clicks: 0, conv: 0 });
  // gemiddelde van de prior-maanden, zodat de vergelijking maand-tegen-maand blijft
  const f = priorMonths.length || 1;
  return { lastMonth, last: byMonth.get(lastMonth)!, prior: { impressions: prior.impressions / f, clicks: prior.clicks / f, conv: prior.conv / f } };
}

const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);
const relDrop = (cur: number | null, base: number | null): number | null =>
  cur != null && base != null && base > 0 ? (cur - base) / base : null;

// ── 1. Blended totaal-funnel ───────────────────────────────────────────────
export function detectBlendedFunnelDrop(channels: ChannelMonthlyInput[]): DetectionResult {
  const id = "cross_funnel_blended";
  const cmp = lastVsPrior(aggByMonth(channels));
  if (!cmp || cmp.last.clicks < MIN_CLICKS) return { triggered: [], checked: [id] };

  const stages: { label: string; cur: number | null; base: number | null }[] = [
    { label: "vertoning → klik", cur: rate(cmp.last.clicks, cmp.last.impressions), base: rate(cmp.prior.clicks, cmp.prior.impressions) },
    { label: "klik → conversie", cur: rate(cmp.last.conv, cmp.last.clicks), base: rate(cmp.prior.conv, cmp.prior.clicks) },
  ];
  const worst = stages
    .map((s) => ({ ...s, drop: relDrop(s.cur, s.base) }))
    .filter((s) => s.drop != null && s.drop <= -BLENDED_RATE_DROP)
    .sort((a, b) => (a.drop ?? 0) - (b.drop ?? 0))[0];
  if (!worst) return { triggered: [], checked: [id] };

  const story: SignalStory = {
    id, category: "cross_channel", scope: `blended, maand ${cmp.lastMonth}`,
    story: `De blended funnel-fase ${worst.label} verslechterde ${r1((worst.drop ?? 0) * 100)}% (${pctS(worst.cur)} vs ${pctS(worst.base)} prior); de totale funnel lekt op deze overgang (${VOETNOOT}).`,
    actionDirection: "kijk eerst per kanaal welke fase het lek draagt (achterblijver- en divergentie-detectie hieronder) voordat account-breed wordt bijgestuurd",
    certainty: "indicatie",
    evidence: [
      { metric: worst.label, value: pctS(worst.cur), prev: pctS(worst.base) },
      { metric: "klikvolume laatste maand", value: Math.round(cmp.last.clicks) },
    ],
  };
  return { triggered: [story], checked: [id] };
}

// ── 2. Fase-achterblijver tussen kanalen ───────────────────────────────────
export function detectFunnelLaggard(channels: ChannelMonthlyInput[]): DetectionResult {
  const id = "cross_funnel_achterblijver";
  const byChannel = new Map<string, MonthAgg>();
  for (const r of channels) {
    const a = byChannel.get(r.channel) ?? { impressions: 0, clicks: 0, conv: 0 };
    a.impressions += r.impressions; a.clicks += r.clicks; a.conv += convOf(r);
    byChannel.set(r.channel, a);
  }
  const rated = [...byChannel.entries()]
    .filter(([, a]) => a.clicks >= MIN_CLICKS)
    .map(([channel, a]) => ({ channel, convRate: rate(a.conv, a.clicks), clicks: a.clicks }))
    .filter((c) => c.convRate != null)
    .sort((a, b) => (b.convRate ?? 0) - (a.convRate ?? 0));
  if (rated.length < 2) return { triggered: [], checked: [id] };

  const best = rated[0];
  const worst = rated[rated.length - 1];
  if ((worst.convRate ?? 0) > (best.convRate ?? 0) * LAGGARD_FRAC) return { triggered: [], checked: [id] };

  const story: SignalStory = {
    id, category: "cross_channel", scope: `${worst.channel} vs ${best.channel}`,
    story: `${worst.channel} zet klikken het slechtst om: ${pctS(worst.convRate)} klik→conversie tegenover ${pctS(best.convRate)} bij ${best.channel} — de klikken landen nergens, wat een ander probleem is dan te weinig klikken (${VOETNOOT}; conversie-definities verschillen per kanaal).`,
    actionDirection: `onderzoek bij ${worst.channel} de post-klik-keten (landingservaring, doelgroep-kwaliteit, conversie-meting) in plaats van meer klikvolume in te kopen`,
    certainty: "indicatie",
    evidence: rated.map((c) => ({ metric: `klik→conversie ${c.channel}`, value: `${pctS(c.convRate)} (${Math.round(c.clicks)} klikken)` })),
  };
  return { triggered: [story], checked: [id] };
}

// ── 3. Divergentie: één kanaal zakt, de rest is stabiel ────────────────────
export function detectFunnelDivergence(channels: ChannelMonthlyInput[]): DetectionResult {
  const id = "cross_funnel_divergentie";
  const chNames = [...new Set(channels.map((r) => r.channel))];
  if (chNames.length < 2) return { triggered: [], checked: [id] };

  const perChannel = chNames.map((ch) => {
    const cmp = lastVsPrior(aggByMonth(channels.filter((r) => r.channel === ch)));
    if (!cmp || cmp.last.clicks < MIN_CLICKS) return null;
    return { channel: ch, lastMonth: cmp.lastMonth, drop: relDrop(rate(cmp.last.conv, cmp.last.clicks), rate(cmp.prior.conv, cmp.prior.clicks)) };
  }).filter((c): c is NonNullable<typeof c> => c != null && c.drop != null);
  if (perChannel.length < 2) return { triggered: [], checked: [id] };

  const droppers = perChannel.filter((c) => (c.drop ?? 0) <= DIVERGENCE_DROP);
  const others = (dropCh: string) => perChannel.filter((c) => c.channel !== dropCh);
  const diverging = droppers.find((d) => others(d.channel).every((o) => Math.abs(o.drop ?? 0) <= DIVERGENCE_STABLE));
  if (!diverging) return { triggered: [], checked: [id] };

  const stable = others(diverging.channel).map((o) => `${o.channel} ${r1((o.drop ?? 0) * 100)}%`).join("; ");
  const story: SignalStory = {
    id, category: "cross_channel", scope: `${diverging.channel}, maand ${diverging.lastMonth}`,
    story: `De klik→conversie-rate van ${diverging.channel} zakte ${r1((diverging.drop ?? 0) * 100)}% terwijl de andere kanalen stabiel bleven (${stable}); de verslechtering is kanaal-specifiek, niet marktbreed (${VOETNOOT}).`,
    actionDirection: `zoek de oorzaak binnen ${diverging.channel} (creative, targeting, landing, meting) en schrijf dit niet af als "de markt wordt duurder"`,
    certainty: "indicatie",
    evidence: [
      { metric: `rate-verandering ${diverging.channel}`, value: `${r1((diverging.drop ?? 0) * 100)}%` },
      { metric: "overige kanalen", value: stable },
    ],
  };
  return { triggered: [story], checked: [id] };
}

export function buildCrossChannelFunnelSignals(channels: ChannelMonthlyInput[]): DetectionResult {
  return mergeDetections([
    detectBlendedFunnelDrop(channels),
    detectFunnelLaggard(channels),
    detectFunnelDivergence(channels),
  ]);
}
