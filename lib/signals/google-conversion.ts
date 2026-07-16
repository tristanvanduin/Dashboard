// Categorie E: LP-breuk versus kanaalprobleem. Dit is de EIGENAARSVRAAG, en dat is het
// hele punt: zakt de conversieratio bij vrijwel ALLE campagnes tegelijk terwijl de
// klikbereidheid (CTR) stabiel blijft, dan kan het geen kanaalprobleem zijn. Campagnes met
// eigen advertenties, eigen zoektermen en eigen doelgroepen verslechteren niet spontaan
// gelijktijdig; wat ze delen is de bestemming en de meting. Het probleem ligt dus achter de
// klik, en de eigenaar is de website of de tracking, niet de accountbeheerder.
//
// DE TWEEDE SPLITSING maakt het pas bruikbaar: zakt het op ALLE apparaten, dan is het
// sitewide of de meting. Zakt het op EEN apparaat, dan is het een ervaringskloof op dat
// apparaat (een formulier dat op mobiel breekt). Dat zijn twee heel verschillende
// eigenaren en twee heel verschillende gesprekken.
//
// De zekerheid blijft INDICATIE: de data toont het patroon hard, maar of het de pagina of
// de meting is, is van buiten het kanaal niet te zien. Die vraag hoort in de actie.

import { type DetectionResult, pct } from "./types";

export const CVR_DROP_MATERIAL = 0.2; // twintig procent relatieve daling telt
export const CTR_STABLE_BAND = 0.1; // binnen tien procent heet de CTR stabiel
export const BREACH_MIN_CAMPAIGNS = 3; // met minder is "alle campagnes" geen patroon
export const BREACH_SHARE = 0.8; // tachtig procent van de campagnes moet meedoen
export const BREACH_MIN_CLICKS = 100; // per campagne per maand, anders is de conversieratio ruis
export const DEVICE_CONCENTRATION = 0.75; // zoveel van de conversiedaling op een apparaat heet geconcentreerd

export interface PeriodPair {
  clicks: number;
  impressions: number;
  conversions: number;
  prevClicks: number;
  prevImpressions: number;
  prevConversions: number;
}

export interface BreachCampaignInput extends PeriodPair {
  campaignName: string;
}

export interface BreachDeviceInput extends PeriodPair {
  device: string;
}

function rates(p: PeriodPair): { ctr: number; prevCtr: number; cvr: number; prevCvr: number } | null {
  if (p.impressions <= 0 || p.prevImpressions <= 0 || p.clicks <= 0 || p.prevClicks <= 0) return null;
  return {
    ctr: p.clicks / p.impressions,
    prevCtr: p.prevClicks / p.prevImpressions,
    cvr: p.conversions / p.clicks,
    prevCvr: p.prevConversions / p.prevClicks,
  };
}

// Welk apparaat draagt de daling? Null als het over de apparaten verspreid zit.
export function concentratedDevice(devices: BreachDeviceInput[]): { device: string; share: number } | null {
  const drops = devices
    .map((d) => {
      const r = rates(d);
      if (!r || r.prevCvr <= 0) return null;
      // De gemiste conversies bij de huidige klikken, als het oude niveau was gehaald.
      const missed = (r.prevCvr - r.cvr) * d.clicks;
      return missed > 0 ? { device: d.device, missed } : null;
    })
    .filter((d): d is { device: string; missed: number } => d != null);
  const total = drops.reduce((s, d) => s + d.missed, 0);
  if (total <= 0 || drops.length === 0) return null;
  const top = drops.sort((a, b) => b.missed - a.missed)[0];
  const share = top.missed / total;
  return share >= DEVICE_CONCENTRATION ? { device: top.device, share } : null;
}

export function detectLpBreukVersusKanaal(input: { campaigns: BreachCampaignInput[]; devices: BreachDeviceInput[] }): DetectionResult {
  const checked = ["lp_breuk_versus_kanaal"];

  const usable = input.campaigns.filter((c) => c.clicks >= BREACH_MIN_CLICKS && c.prevClicks >= BREACH_MIN_CLICKS);
  if (usable.length < BREACH_MIN_CAMPAIGNS) return { triggered: [], checked };

  let dropped = 0;
  let ctrStable = 0;
  for (const campaign of usable) {
    const r = rates(campaign);
    if (!r || r.prevCvr <= 0 || r.prevCtr <= 0) continue;
    if ((r.cvr - r.prevCvr) / r.prevCvr <= -CVR_DROP_MATERIAL) dropped += 1;
    if (Math.abs((r.ctr - r.prevCtr) / r.prevCtr) <= CTR_STABLE_BAND) ctrStable += 1;
  }

  const dropShare = dropped / usable.length;
  const stableShare = ctrStable / usable.length;
  // Beide voorwaarden: bijna overal een conversiedaling, EN de klikbereidheid bleef staan.
  // Zakt de CTR mee, dan is er iets met de advertenties of de veiling aan de hand en is dit
  // wel degelijk een kanaalverhaal.
  if (dropShare < BREACH_SHARE || stableShare < BREACH_SHARE) return { triggered: [], checked };

  const device = concentratedDevice(input.devices);
  const scope = device ? `alle campagnes, geconcentreerd op ${device.device}` : "alle campagnes en alle apparaten";
  const story = device
    ? `De conversieratio zakte bij ${dropped} van de ${usable.length} campagnes terwijl de CTR stabiel bleef, en ${pct(device.share)} van de gemiste conversies zit op ${device.device}. Campagnes met eigen advertenties en doelgroepen verslechteren niet spontaan gelijktijdig; wat ze delen is de bestemming. Dit wijst op een ervaringskloof op ${device.device}, niet op de campagnes.`
    : `De conversieratio zakte bij ${dropped} van de ${usable.length} campagnes terwijl de CTR stabiel bleef, en de daling zit niet op een enkel apparaat. Campagnes met eigen advertenties en doelgroepen verslechteren niet spontaan gelijktijdig; wat ze delen is de bestemming en de meting. Dit wijst op iets sitewide of op de meting, niet op het kanaal.`;

  return {
    triggered: [
      {
        id: "lp_breuk_versus_kanaal",
        category: "conversie_meting" as const,
        scope,
        story,
        actionDirection: device
          ? `laat de bestemmingspagina op ${device.device} testen (formulier, snelheid, weergave) voordat er aan biedingen of advertenties wordt gesleuteld`
          : "toets eerst of de conversiemeting nog werkt (tag, doel, consent) en daarna de pagina zelf; sleutel niet aan de campagnes voordat dit uitgesloten is",
        certainty: "indicatie" as const,
        evidence: [
          { metric: "campagnes met conversiedaling", value: dropped, prev: usable.length },
          { metric: "campagnes met stabiele ctr", value: ctrStable, prev: usable.length },
          ...(device ? [{ metric: `aandeel gemiste conversies op ${device.device}`, value: Math.round(device.share * 1000) / 1000 }] : []),
        ],
      },
    ],
    checked,
  };
}
