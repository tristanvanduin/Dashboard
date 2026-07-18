// Cross-channel signaal-detectors: het verhaal TUSSEN de kanalen, dat geen enkel kanaal
// alleen kan vertellen. Zelfde frame als de Google/Meta/LinkedIn-detectors (DetectionResult,
// SignalStory, zekerheidslabels), maar met een harde regel extra: elk kanaal meet zijn eigen
// attributie, dus een vergelijking OVER kanalen heen is nooit "bewezen_binnen_platform".
// Maximaal "indicatie" (mix-rekenkunde op eigen cijfers) of "verklaringskandidaat"
// (correlatie tussen kanalen). Pure functies, los getest.

import { mergeDetections, type DetectionResult, type SignalStory } from "./types";

export const SEED_SOCIAL_RISE = 0.30;      // +30% social-vertoningen telt als zaai-golf
export const SEED_BRAND_RISE = 0.15;       // +15% brand-klikken telt als oogst
export const SEED_BRAND_FALL = -0.10;      // -10% brand-klikken bij zaai-golf = zaait-zonder-oogst
export const ARBITRAGE_CPL_FRAC = 0.6;     // kanaal A is arbitrage-kandidaat onder 60% van B's CPL
export const ARBITRAGE_MIN_LEADS = 10;     // onder dit volume per kanaal is CPL ruis
export const ARBITRAGE_MIN_SPEND_SHARE = 0.25; // het dure kanaal moet echt budget dragen
export const MIX_BLENDED_CPA_RISE = 0.20;  // +20% blended CPA is materieel
export const MIX_CHANNEL_CPA_TOLERANCE = 0.05; // per kanaal max +5% om "stabiel" te heten
export const MIN_MONTHS = 3;               // minder historie = geen trend-oordeel

const ATTRIBUTIE_VOETNOOT = "elk kanaal meet zijn eigen attributie; deze vergelijking is richtinggevend, geen exacte verdeling";

export interface ChannelMonthlyInput {
  channel: string;   // "google_ads" | "meta_ads" | "linkedin_ads"
  month: string;     // "YYYY-MM" of "YYYY-MM-01"
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  leads: number;
}

export interface BrandMonthlyInput {
  month: string;
  clicks: number;
}

const mkey = (m: string) => m.slice(0, 7);
const pctChange = (cur: number, base: number): number | null => (base > 0 ? (cur - base) / base : null);
const r1 = (n: number) => Math.round(n * 10) / 10;

// Laatste maand vs gemiddelde van de maximaal 2 maanden ervoor, op een reeks {month,value}.
function lastVsPrior(series: Map<string, number>): { last: number; prior: number; lastMonth: string } | null {
  const months = [...series.keys()].sort();
  if (months.length < MIN_MONTHS) return null;
  const lastMonth = months[months.length - 1];
  const priorMonths = months.slice(-3, -1);
  const prior = priorMonths.reduce((s, m) => s + (series.get(m) ?? 0), 0) / priorMonths.length;
  return { last: series.get(lastMonth) ?? 0, prior, lastMonth };
}

function sumByMonth(rows: { month: string }[], value: (r: never) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(mkey(r.month), (out.get(mkey(r.month)) ?? 0) + value(r as never));
  return out;
}

// ── 1. Zaai-oogst: social zaait, brand-search oogst (of juist niet) ────────────────
// Stijgen de social-vertoningen (Meta+LinkedIn, awareness) fors, dan hoort de merkvraag bij
// Google mee te bewegen. Beweegt hij mee: verklaringskandidaat voor de brand-groei (niet
// zomaar "Google werd beter"). Beweegt hij tegengesteld: de zaai-investering vindt geen
// meetbare oogst — targeting- of merk-capture-vraag.
export function detectSeedHarvest(social: ChannelMonthlyInput[], brand: BrandMonthlyInput[]): DetectionResult {
  const id = "cross_zaai_oogst";
  const socialRows = social.filter((r) => r.channel !== "google_ads");
  const socialSeries = sumByMonth(socialRows, (r: ChannelMonthlyInput) => r.impressions);
  const brandSeries = sumByMonth(brand, (r: BrandMonthlyInput) => r.clicks);

  const s = lastVsPrior(socialSeries);
  const b = lastVsPrior(brandSeries);
  if (!s || !b || s.lastMonth !== b.lastMonth) return { triggered: [], checked: [id] };

  const socialChange = pctChange(s.last, s.prior);
  const brandChange = pctChange(b.last, b.prior);
  if (socialChange == null || brandChange == null || socialChange < SEED_SOCIAL_RISE) {
    return { triggered: [], checked: [id] };
  }

  const evidence = [
    { metric: "social-vertoningen (Meta+LinkedIn)", value: `${Math.round(s.last)} (${r1(socialChange * 100)}% vs prior)`, prev: String(Math.round(s.prior)) },
    { metric: "brand-klikken Google", value: `${Math.round(b.last)} (${r1(brandChange * 100)}%)`, prev: String(Math.round(b.prior)) },
  ];

  if (brandChange >= SEED_BRAND_RISE) {
    const story: SignalStory = {
      id, category: "cross_channel", scope: `maand ${s.lastMonth}`,
      story: `De social-zaai-golf (+${r1(socialChange * 100)}% vertoningen) valt samen met +${r1(brandChange * 100)}% brand-klikken bij Google; de merkvraag beweegt mee met de awareness-druk (${ATTRIBUTIE_VOETNOOT}).`,
      actionDirection: "schrijf de brand-groei niet automatisch aan Google-optimalisatie toe; bewaak de zaai-oogst-keten als geheel voordat social-budget gekort wordt",
      certainty: "verklaringskandidaat", evidence,
    };
    return { triggered: [story], checked: [id] };
  }
  if (brandChange <= SEED_BRAND_FALL) {
    const story: SignalStory = {
      id, category: "cross_channel", scope: `maand ${s.lastMonth}`,
      story: `Social zaait fors (+${r1(socialChange * 100)}% vertoningen) maar de brand-klikken bij Google dalen (${r1(brandChange * 100)}%); de awareness-druk vindt geen meetbare merk-oogst (${ATTRIBUTIE_VOETNOOT}).`,
      actionDirection: "onderzoek de social-targeting (bereikt hij de juiste doelgroep?) en of Google de merkvraag wel afvangt (brand-dekking, budget-cap op brand)",
      certainty: "verklaringskandidaat", evidence,
    };
    return { triggered: [story], checked: [id] };
  }
  return { triggered: [], checked: [id] };
}

// ── 2. CPL-arbitrage: hetzelfde lead-doel, structureel ongelijke prijs ─────────────
// Twee kanalen jagen op leads; is de CPL van kanaal A structureel onder 60% van kanaal B
// terwijl B wezenlijk budget draagt, dan is een verschuiftest de logische volgende euro.
// Indicatie, geen bewijs: de leads zijn binnen elk platform gemeten, de vergelijkbaarheid
// van lead-kwaliteit over kanalen is een aanname.
export function detectCplArbitrage(channels: ChannelMonthlyInput[]): DetectionResult {
  const id = "cross_cpl_arbitrage";
  const byChannel = new Map<string, { spend: number; leads: number }>();
  for (const r of channels) {
    const c = byChannel.get(r.channel) ?? { spend: 0, leads: 0 };
    c.spend += r.spend; c.leads += r.leads;
    byChannel.set(r.channel, c);
  }
  const totalSpend = [...byChannel.values()].reduce((s, c) => s + c.spend, 0);
  const withCpl = [...byChannel.entries()]
    .filter(([, c]) => c.leads >= ARBITRAGE_MIN_LEADS && c.spend > 0)
    .map(([channel, c]) => ({ channel, cpl: c.spend / c.leads, spend: c.spend, leads: c.leads }))
    .sort((a, b) => a.cpl - b.cpl);
  if (withCpl.length < 2) return { triggered: [], checked: [id] };

  const cheap = withCpl[0];
  const expensive = withCpl[withCpl.length - 1];
  const spendShare = totalSpend > 0 ? expensive.spend / totalSpend : 0;
  if (cheap.cpl > expensive.cpl * ARBITRAGE_CPL_FRAC || spendShare < ARBITRAGE_MIN_SPEND_SHARE) {
    return { triggered: [], checked: [id] };
  }

  const story: SignalStory = {
    id, category: "cross_channel", scope: `${cheap.channel} vs ${expensive.channel}`,
    story: `${cheap.channel} levert leads voor €${r1(cheap.cpl)} waar ${expensive.channel} €${r1(expensive.cpl)} betaalt (${Math.round((cheap.cpl / expensive.cpl) * 100)}% van de prijs), terwijl ${expensive.channel} ${Math.round(spendShare * 100)}% van de spend draagt (${ATTRIBUTIE_VOETNOOT}; lead-kwaliteit kan verschillen).`,
    actionDirection: `test een budgetverschuiving van ${expensive.channel} naar ${cheap.channel} en vergelijk de lead-kwaliteit (SQL-rate) voordat structureel geschoven wordt`,
    certainty: "indicatie",
    evidence: [
      { metric: `CPL ${cheap.channel}`, value: `€${r1(cheap.cpl)} (${cheap.leads} leads)` },
      { metric: `CPL ${expensive.channel}`, value: `€${r1(expensive.cpl)} (${expensive.leads} leads)` },
      { metric: "spend-aandeel duur kanaal", value: `${Math.round(spendShare * 100)}%` },
    ],
  };
  return { triggered: [story], checked: [id] };
}

// ── 3. Mix-shift: blended CPA verslechtert terwijl elk kanaal stabiel is ───────────
// De Simpson-detector: stijgt de blended CPA materieel terwijl geen enkel kanaal zelf
// verslechtert, dan verschuift het budget-gewicht naar een structureel duurder kanaal. Zonder
// deze check krijgt ten onrechte "de optimalisatie" de schuld.
export function detectBlendedMixShift(channels: ChannelMonthlyInput[]): DetectionResult {
  const id = "cross_mix_shift";
  const activeChannels = [...new Set(channels.filter((r) => r.spend > 0).map((r) => r.channel))];
  if (activeChannels.length < 2) return { triggered: [], checked: [id] };

  const blendedSpend = sumByMonth(channels, (r: ChannelMonthlyInput) => r.spend);
  const blendedConv = sumByMonth(channels, (r: ChannelMonthlyInput) => r.conversions);
  const months = [...blendedSpend.keys()].sort();
  if (months.length < MIN_MONTHS) return { triggered: [], checked: [id] };

  const lastMonth = months[months.length - 1];
  const priorMonths = months.slice(-3, -1);
  const cpaOf = (spend: number, conv: number): number | null => (conv > 0 ? spend / conv : null);

  const blendedLast = cpaOf(blendedSpend.get(lastMonth) ?? 0, blendedConv.get(lastMonth) ?? 0);
  const blendedPrior = cpaOf(
    priorMonths.reduce((s, m) => s + (blendedSpend.get(m) ?? 0), 0),
    priorMonths.reduce((s, m) => s + (blendedConv.get(m) ?? 0), 0)
  );
  if (blendedLast == null || blendedPrior == null) return { triggered: [], checked: [id] };
  const blendedChange = pctChange(blendedLast, blendedPrior);
  if (blendedChange == null || blendedChange < MIX_BLENDED_CPA_RISE) return { triggered: [], checked: [id] };

  // Per kanaal dezelfde vergelijking; iedereen stabiel of beter = mix-effect.
  const perChannelStable: string[] = [];
  for (const ch of activeChannels) {
    const rows = channels.filter((r) => r.channel === ch);
    const sp = sumByMonth(rows, (r: ChannelMonthlyInput) => r.spend);
    const cv = sumByMonth(rows, (r: ChannelMonthlyInput) => r.conversions);
    const chLast = cpaOf(sp.get(lastMonth) ?? 0, cv.get(lastMonth) ?? 0);
    const chPrior = cpaOf(
      priorMonths.reduce((s, m) => s + (sp.get(m) ?? 0), 0),
      priorMonths.reduce((s, m) => s + (cv.get(m) ?? 0), 0)
    );
    if (chLast == null || chPrior == null) return { triggered: [], checked: [id] }; // kanaal zonder conversies: geen mix-oordeel
    const change = pctChange(chLast, chPrior);
    if (change == null || change > MIX_CHANNEL_CPA_TOLERANCE) return { triggered: [], checked: [id] };
    perChannelStable.push(`${ch} ${r1(change * 100)}%`);
  }

  const story: SignalStory = {
    id, category: "cross_channel", scope: `maand ${lastMonth}`,
    story: `De blended CPA steeg ${r1(blendedChange * 100)}% terwijl elk kanaal afzonderlijk stabiel bleef (${perChannelStable.join("; ")}); de verslechtering is een mix-verschuiving naar een duurder kanaal, geen prestatie-probleem binnen een kanaal.`,
    actionDirection: "beoordeel de budget-mix (bewust duurder kanaal ingekocht, of gedreven?) in plaats van binnen kanalen te sleutelen",
    certainty: "indicatie",
    evidence: [
      { metric: "blended CPA", value: `€${r1(blendedLast)} (+${r1(blendedChange * 100)}%)`, prev: `€${r1(blendedPrior)}` },
      { metric: "kanalen afzonderlijk", value: perChannelStable.join("; ") },
    ],
  };
  return { triggered: [story], checked: [id] };
}

// ── Bundel ─────────────────────────────────────────────────────────────────────────
export function buildCrossChannelSignals(input: {
  channels: ChannelMonthlyInput[];
  brand: BrandMonthlyInput[];
}): DetectionResult {
  return mergeDetections([
    detectSeedHarvest(input.channels, input.brand),
    detectCplArbitrage(input.channels),
    detectBlendedMixShift(input.channels),
  ]);
}
