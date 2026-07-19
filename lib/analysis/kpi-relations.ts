// KPI-verhoudingen: hoe twee of meer KPI's zich TOT ELKAAR verhouden, als deterministische
// detectors in het signaal-frame. Elke detector combineert minstens twee KPI's met een
// conditie; een losse KPI-beweging is nooit genoeg. De acht verhoudingen:
//
//   [K1] CPA-decompositie      — CPA = CPC / CVR: werd de klik duurder of converteert hij
//                                slechter? (log-decompositie, benoemt de dominante driver)
//   [K2] Belofte-kloof         — CTR stijgt TERWIJL de conversieratio daalt: de advertentie
//                                belooft meer dan de landing waarmaakt (clickbait-patroon)
//   [K3] Verzadiging           — spend-delta vs conversie-delta: marginale CPA ver boven de
//                                gemiddelde CPA = de volgende euro koopt bijna niets meer
//   [K4] Bereik-verdunning     — vertoningen stijgen TERWIJL CTR zakt: verbreding verwatert
//                                de relevantie (targeting-vraag, geen creative-vraag)
//   [K5] Waarde-mix            — conversies stabiel TERWIJL waarde-per-conversie zakt:
//                                mix/AOV-verschuiving, geen volumeprobleem
//   [K6] Herhaling vs bereik   — (Meta) vertoningsgroei gedragen door frequentie, niet door
//                                nieuw bereik: budget koopt herhaling (dag-gemiddelde proxy)
//   [K7] Dure zichtbaarheid    — (Google) impression share stijgt TERWIJL CPC hard stijgt:
//                                zichtbaarheid wordt tegen een premie gekocht
//   [K8] Vanity-engagement     — engagement stijgt TERWIJL conversies/leads dalen: het
//                                publiek klapt, maar koopt niet
//
// Ratio's UIT PERIODETOTALEN; ruis-drempels op volume; arithmetiek op eigen kanaal-data is
// bewezen_binnen_platform, de causale duiding is hoogstens indicatie. Puur en los getest.

import type { DetectionResult, SignalStory, SignalEvidence } from "@/lib/signals/types";
import { mergeDetections } from "@/lib/signals/types";

export const MIN_CLICKS = 200;
export const MIN_CONVERSIONS = 10;
export const CPA_MOVE_MATERIAL = 0.15;
export const DOMINANT_SHARE = 0.6;
export const CTR_UP = 0.10;
export const CVR_DOWN = -0.10;
export const SPEND_UP = 0.20;
export const MARGINAL_FACTOR = 2;
export const IMP_UP = 0.20;
export const CTR_DILUTION = -0.15;
export const VALUE_STABLE_BAND = 0.10;
export const VALUE_PER_CONV_DOWN = -0.15;
export const FREQ_SHARE_DOMINANT = 0.6;
export const IS_UP_PT = 0.05;
export const CPC_UP = 0.15;
export const ENGAGEMENT_UP = 0.20;
export const CONV_DOWN = -0.10;

export interface KpiWindow {
  label: string; // bv. "2026-06" of "laatste 28 dagen"
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue?: number | null;
  avgFrequency?: number | null;    // impressie-gewogen dag-gemiddelde (Meta)
  impressionShare?: number | null; // impressie-gewogen (Google)
  engagement?: number | null;      // post_engagement / total_engagements
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const rel = (cur: number | null, base: number | null): number | null =>
  cur != null && base != null && base > 0 ? (cur - base) / base : null;
const pctS = (v: number | null): string => (v == null ? "n.v.t." : `${Math.round(v * 1000) / 10}%`);
const dS = (v: number | null): string => (v == null ? "n.v.t." : `${v >= 0 ? "+" : ""}${Math.round(v * 1000) / 10}%`);
const eurS = (v: number | null): string => (v == null ? "n.v.t." : `€${Math.round(v * 100) / 100}`);

function ev(metric: string, value: string, prev?: string): SignalEvidence {
  return prev != null ? { metric, value, prev } : { metric, value };
}

// ── [K1] CPA-decompositie ──────────────────────────────────────────────────
export function decomposeCpa(recent: KpiWindow, prior: KpiWindow): DetectionResult {
  const id = "kpi_cpa_decompositie";
  if (recent.clicks < MIN_CLICKS || prior.clicks < MIN_CLICKS || recent.conversions < MIN_CONVERSIONS || prior.conversions < MIN_CONVERSIONS) {
    return { triggered: [], checked: [id] };
  }
  const cpaR = div(recent.cost, recent.conversions)!;
  const cpaP = div(prior.cost, prior.conversions)!;
  const move = rel(cpaR, cpaP);
  if (move == null || Math.abs(move) < CPA_MOVE_MATERIAL) return { triggered: [], checked: [id] };

  // CPA = CPC / CVR => ln(CPA-ratio) = ln(CPC-ratio) - ln(CVR-ratio). De aandelen in de
  // log-ruimte sommen exact tot de beweging; de dominante term is de driver.
  const cpcR = div(recent.cost, recent.clicks)!;
  const cpcP = div(prior.cost, prior.clicks)!;
  const cvrR = div(recent.conversions, recent.clicks)!;
  const cvrP = div(prior.conversions, prior.clicks)!;
  const lnCpa = Math.log(cpaR / cpaP);
  const lnCpc = Math.log(cpcR / cpcP);
  const lnCvr = -Math.log(cvrR / cvrP);
  const cpcShare = lnCpa !== 0 ? lnCpc / lnCpa : 0;
  const cvrShare = lnCpa !== 0 ? lnCvr / lnCpa : 0;

  const richting = move > 0 ? "steeg" : "daalde";
  let driver: string;
  let action: string;
  if (cpcShare >= DOMINANT_SHARE) {
    driver = `vooral doordat de KLIK duurder werd (CPC draagt ${Math.round(cpcShare * 100)}% van de beweging)`;
    action = "dit is een veiling/concurrentie-vraag: kijk naar biedingen, impression-share-verlies en concurrentiedruk, niet naar de landingspagina";
  } else if (cvrShare >= DOMINANT_SHARE) {
    driver = `vooral doordat de klik SLECHTER CONVERTEERT (conversieratio draagt ${Math.round(cvrShare * 100)}% van de beweging)`;
    action = "dit is een landing/doelgroep-vraag: kijk naar de post-klik-keten en verkeerskwaliteit, niet naar de biedingen";
  } else {
    driver = `door een combinatie: CPC draagt ${Math.round(cpcShare * 100)}%, conversieratio ${Math.round(cvrShare * 100)}%`;
    action = "beide knoppen bewegen: adresseer prijs (veiling) en kwaliteit (landing/doelgroep) als aparte sporen";
  }

  const story: SignalStory = {
    id, category: "kwaliteit", scope: `${prior.label} → ${recent.label}`,
    story: `De CPA ${richting} ${dS(move)} (${eurS(cpaP)} → ${eurS(cpaR)}), ${driver}.`,
    actionDirection: action,
    certainty: "bewezen_binnen_platform",
    evidence: [
      ev("CPA", eurS(cpaR), eurS(cpaP)),
      ev("CPC", eurS(cpcR), eurS(cpcP)),
      ev("conversieratio", pctS(cvrR), pctS(cvrP)),
    ],
  };
  return { triggered: [story], checked: [id] };
}

// ── [K2] Belofte-kloof (clickbait) ─────────────────────────────────────────
export function detectPromiseGap(recent: KpiWindow, prior: KpiWindow): DetectionResult {
  const id = "kpi_belofte_kloof";
  if (recent.clicks < MIN_CLICKS || prior.clicks < MIN_CLICKS) return { triggered: [], checked: [id] };
  const ctrMove = rel(div(recent.clicks, recent.impressions), div(prior.clicks, prior.impressions));
  const cvrMove = rel(div(recent.conversions, recent.clicks), div(prior.conversions, prior.clicks));
  if (ctrMove == null || cvrMove == null || ctrMove < CTR_UP || cvrMove > CVR_DOWN) {
    return { triggered: [], checked: [id] };
  }
  const story: SignalStory = {
    id, category: "kwaliteit", scope: `${prior.label} → ${recent.label}`,
    story: `De CTR steeg ${dS(ctrMove)} TERWIJL de conversieratio ${dS(cvrMove)} zakte: de advertentie trekt meer klikken die minder waarmaken — het belofte-kloof-patroon.`,
    actionDirection: "leg de advertentiebelofte naast de landingservaring; een scherpere maar eerlijkere boodschap kost CTR en levert conversies",
    certainty: "indicatie",
    evidence: [
      ev("CTR", pctS(div(recent.clicks, recent.impressions)), pctS(div(prior.clicks, prior.impressions))),
      ev("conversieratio", pctS(div(recent.conversions, recent.clicks)), pctS(div(prior.conversions, prior.clicks))),
    ],
  };
  return { triggered: [story], checked: [id] };
}

// ── [K3] Verzadiging (marginale efficiëntie) ───────────────────────────────
export function detectSaturation(recent: KpiWindow, prior: KpiWindow): DetectionResult {
  const id = "kpi_verzadiging";
  if (prior.cost <= 0 || prior.conversions < MIN_CONVERSIONS) return { triggered: [], checked: [id] };
  const spendMove = rel(recent.cost, prior.cost);
  if (spendMove == null || spendMove < SPEND_UP) return { triggered: [], checked: [id] };

  const dConv = recent.conversions - prior.conversions;
  const dCost = recent.cost - prior.cost;
  const avgCpa = div(recent.cost, recent.conversions);

  if (dConv <= 0) {
    const story: SignalStory = {
      id, category: "budget_pacing", scope: `${prior.label} → ${recent.label}`,
      story: `De spend steeg ${dS(spendMove)} (${eurS(prior.cost)} → ${eurS(recent.cost)}) zonder extra conversies (${Math.round(prior.conversions)} → ${Math.round(recent.conversions)}): de extra euro's kochten niets bij.`,
      actionDirection: "bevries de verhoging tot duidelijk is waar het extra budget landde (duurdere klikken? breder bereik zonder intentie?) — zie de CPA-decompositie",
      certainty: "indicatie",
      evidence: [ev("spend", eurS(recent.cost), eurS(prior.cost)), ev("conversies", String(Math.round(recent.conversions)), String(Math.round(prior.conversions)))],
    };
    return { triggered: [story], checked: [id] };
  }

  const marginalCpa = dCost / dConv;
  if (avgCpa == null || marginalCpa < avgCpa * MARGINAL_FACTOR) return { triggered: [], checked: [id] };
  const story: SignalStory = {
    id, category: "budget_pacing", scope: `${prior.label} → ${recent.label}`,
    story: `De extra spend leverde wel conversies, maar tegen een marginale CPA van ${eurS(marginalCpa)} — ${Math.round(marginalCpa / avgCpa * 10) / 10}× de gemiddelde CPA (${eurS(avgCpa)}): verzadiging, de volgende euro rendeert steeds minder.`,
    actionDirection: "overweeg het extra budget te herverdelen naar een kanaal of campagne met kop-ruimte (zie budgetallocatie) in plaats van dieper in de verzadiging te duwen",
    certainty: "indicatie",
    evidence: [ev("marginale CPA", eurS(marginalCpa)), ev("gemiddelde CPA", eurS(avgCpa)), ev("spend-delta", dS(spendMove))],
  };
  return { triggered: [story], checked: [id] };
}

// ── [K4] Bereik-verdunning ─────────────────────────────────────────────────
export function detectReachDilution(recent: KpiWindow, prior: KpiWindow): DetectionResult {
  const id = "kpi_bereik_verdunning";
  if (prior.impressions <= 0 || recent.clicks < MIN_CLICKS) return { triggered: [], checked: [id] };
  const impMove = rel(recent.impressions, prior.impressions);
  const ctrMove = rel(div(recent.clicks, recent.impressions), div(prior.clicks, prior.impressions));
  if (impMove == null || ctrMove == null || impMove < IMP_UP || ctrMove > CTR_DILUTION) {
    return { triggered: [], checked: [id] };
  }
  const story: SignalStory = {
    id, category: "zichtbaarheid_vraag", scope: `${prior.label} → ${recent.label}`,
    story: `De vertoningen stegen ${dS(impMove)} TERWIJL de CTR ${dS(ctrMove)} zakte: de verbreding bereikt publiek dat de boodschap minder relevant vindt.`,
    actionDirection: "beoordeel of de verbreding bewust was (nieuwe doelgroepen/zoektermen); zo niet, scherp de targeting aan voordat de verwaterde CTR de kwaliteitsscores drukt",
    certainty: "indicatie",
    evidence: [ev("vertoningen", String(Math.round(recent.impressions)), String(Math.round(prior.impressions))), ev("CTR", pctS(div(recent.clicks, recent.impressions)), pctS(div(prior.clicks, prior.impressions)))],
  };
  return { triggered: [story], checked: [id] };
}

// ── [K5] Waarde-mix ────────────────────────────────────────────────────────
export function detectValueMix(recent: KpiWindow, prior: KpiWindow): DetectionResult {
  const id = "kpi_waarde_mix";
  const vR = recent.conversionsValue ?? 0;
  const vP = prior.conversionsValue ?? 0;
  if (vP <= 0 || recent.conversions < MIN_CONVERSIONS || prior.conversions < MIN_CONVERSIONS) {
    return { triggered: [], checked: [id] };
  }
  const convMove = rel(recent.conversions, prior.conversions);
  const vpcMove = rel(div(vR, recent.conversions), div(vP, prior.conversions));
  if (convMove == null || vpcMove == null || Math.abs(convMove) > VALUE_STABLE_BAND || vpcMove > VALUE_PER_CONV_DOWN) {
    return { triggered: [], checked: [id] };
  }
  const story: SignalStory = {
    id, category: "conversie_meting", scope: `${prior.label} → ${recent.label}`,
    story: `Het conversievolume bleef stabiel (${dS(convMove)}) TERWIJL de waarde per conversie ${dS(vpcMove)} zakte (${eurS(div(vP, prior.conversions))} → ${eurS(div(vR, recent.conversions))}): een mix/AOV-verschuiving, geen volumeprobleem.`,
    actionDirection: "kijk naar de product/dienst-mix en de conversie-actie-mix voordat op volume wordt bijgestuurd; het volume is niet het probleem",
    certainty: "indicatie",
    evidence: [ev("waarde per conversie", eurS(div(vR, recent.conversions)), eurS(div(vP, prior.conversions))), ev("conversies", dS(convMove))],
  };
  return { triggered: [story], checked: [id] };
}

// ── [K6] Herhaling vs bereik (Meta, dag-gemiddelde proxy) ──────────────────
export function detectFrequencyDrivenGrowth(recent: KpiWindow, prior: KpiWindow): DetectionResult {
  const id = "kpi_herhaling_vs_bereik";
  const fR = recent.avgFrequency ?? null;
  const fP = prior.avgFrequency ?? null;
  if (fR == null || fP == null || fP <= 0 || prior.impressions <= 0) return { triggered: [], checked: [id] };
  const impMove = rel(recent.impressions, prior.impressions);
  if (impMove == null || impMove < IMP_UP) return { triggered: [], checked: [id] };
  // vertoningen = bereik x frequentie => ln-aandeel van de frequentie in de groei.
  const lnImp = Math.log(recent.impressions / prior.impressions);
  const lnFreq = Math.log(fR / fP);
  const freqShare = lnImp !== 0 ? lnFreq / lnImp : 0;
  if (freqShare < FREQ_SHARE_DOMINANT) return { triggered: [], checked: [id] };
  const story: SignalStory = {
    id, category: "creative", scope: `${prior.label} → ${recent.label}`,
    story: `De vertoningsgroei (${dS(impMove)}) wordt voor ~${Math.round(freqShare * 100)}% gedragen door hogere frequentie (${Math.round(fP * 10) / 10} → ${Math.round(fR * 10) / 10}), niet door nieuw bereik: het budget koopt herhaling bij hetzelfde publiek (op dag-gemiddelde frequentie; benadering).`,
    actionDirection: "verbreed de doelgroep of roteer creatives voordat de frequentie de fatigue-drempel raakt; meer budget in dezelfde vijver versnelt alleen de verzadiging",
    certainty: "verklaringskandidaat",
    evidence: [ev("dag-frequentie", String(Math.round(fR * 10) / 10), String(Math.round(fP * 10) / 10)), ev("vertoningen", dS(impMove))],
  };
  return { triggered: [story], checked: [id] };
}

// ── [K7] Dure zichtbaarheid (Google) ───────────────────────────────────────
export function detectPaidVisibility(recent: KpiWindow, prior: KpiWindow): DetectionResult {
  const id = "kpi_dure_zichtbaarheid";
  const isR = recent.impressionShare ?? null;
  const isP = prior.impressionShare ?? null;
  if (isR == null || isP == null || recent.clicks < MIN_CLICKS || prior.clicks < MIN_CLICKS) {
    return { triggered: [], checked: [id] };
  }
  const cpcMove = rel(div(recent.cost, recent.clicks), div(prior.cost, prior.clicks));
  if (isR - isP < IS_UP_PT || cpcMove == null || cpcMove < CPC_UP) return { triggered: [], checked: [id] };
  const story: SignalStory = {
    id, category: "veiling_concurrentie", scope: `${prior.label} → ${recent.label}`,
    story: `De impression share steeg ${Math.round((isR - isP) * 1000) / 10} procentpunt TERWIJL de CPC ${dS(cpcMove)} steeg: de extra zichtbaarheid wordt tegen een premie gekocht.`,
    actionDirection: "weeg af of de extra zichtbaarheid het prijskaartje waard is (beurs-aanloop: misschien wel; evergreen: bekijk de rank-verlies-kant en de kwaliteitsroute als goedkoper alternatief)",
    certainty: "indicatie",
    evidence: [ev("impression share", pctS(isR), pctS(isP)), ev("CPC", eurS(div(recent.cost, recent.clicks)), eurS(div(prior.cost, prior.clicks)))],
  };
  return { triggered: [story], checked: [id] };
}

// ── [K8] Vanity-engagement ─────────────────────────────────────────────────
export function detectVanityEngagement(recent: KpiWindow, prior: KpiWindow): DetectionResult {
  const id = "kpi_vanity_engagement";
  const eR = recent.engagement ?? null;
  const eP = prior.engagement ?? null;
  if (eR == null || eP == null || eP <= 0 || prior.conversions < MIN_CONVERSIONS) return { triggered: [], checked: [id] };
  const engMove = rel(eR, eP);
  const convMove = rel(recent.conversions, prior.conversions);
  if (engMove == null || convMove == null || engMove < ENGAGEMENT_UP || convMove > CONV_DOWN) {
    return { triggered: [], checked: [id] };
  }
  const story: SignalStory = {
    id, category: "creative", scope: `${prior.label} → ${recent.label}`,
    story: `Engagement steeg ${dS(engMove)} TERWIJL de conversies ${dS(convMove)} daalden: het publiek reageert, maar koopt niet — de creative optimaliseert richting interactie in plaats van intentie.`,
    actionDirection: "check de campagne-doelstelling en de creative-hook: stuurt die op reacties of op de klik met intentie? engagement is hier geen voorloper van conversie",
    certainty: "indicatie",
    evidence: [ev("engagement", String(Math.round(eR)), String(Math.round(eP))), ev("conversies", dS(convMove))],
  };
  return { triggered: [story], checked: [id] };
}

// ── Bundel per kanaal ──────────────────────────────────────────────────────
export function buildKpiRelations(recent: KpiWindow, prior: KpiWindow): DetectionResult {
  return mergeDetections([
    decomposeCpa(recent, prior),
    detectPromiseGap(recent, prior),
    detectSaturation(recent, prior),
    detectReachDilution(recent, prior),
    detectValueMix(recent, prior),
    detectFrequencyDrivenGrowth(recent, prior),
    detectPaidVisibility(recent, prior),
    detectVanityEngagement(recent, prior),
  ]);
}
