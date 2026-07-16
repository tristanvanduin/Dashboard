// X4 lens 4 en 5, pure kern. Lens 4 is de hygiene-pijler: een kanaal zonder target of
// tracking ondermijnt elke blended conclusie, en dat wordt hard benoemd. Lens 5 beschermt
// tegen de optelsom-illusie: kanalen claimen elk hun eigen conversies, dus de blended som
// overtelt; de voetnoot is het hoofdproduct en de marge is een kanttekening, nooit een hard
// getal. IO-vrij en los getest; de datalaag (O2-targets, connecties) komt op de build-kant.

import { ATTRIBUTION_FOOTNOTE, type ChannelKey } from "./lens-facts";

// ── Lens 4: meet- en trackingconsistentie ──

export interface ChannelMeasurementInput {
  channel: ChannelKey;
  hasTarget: boolean; // is er een O2-target voor dit kanaal?
  targetPlausible: boolean | null; // de O2-plausibiliteitsguard; null als er geen target is
  conversionsTracked: boolean; // registreert het kanaal conversies?
  trackingHealthy: boolean | null; // de Z1/hefboom-4-uitkomst; null als onbekend
  attributionWindow: string | null; // bijv. "click_30d", "click_7d_view_1d"; null als onbekend
}

export type MeasurementIssueKind =
  | "geen_target"
  | "target_niet_plausibel"
  | "geen_tracking"
  | "tracking_ongezond"
  | "vensters_onvergelijkbaar";

export interface MeasurementIssue {
  kind: MeasurementIssueKind;
  channel: ChannelKey | null; // null bij een kanaal-overstijgend punt (vensters)
  severity: "hard" | "zacht";
  detail: string;
}

export interface MeasurementConsistencyResult {
  issues: MeasurementIssue[];
  blindChannels: ChannelKey[]; // kanalen zonder tracking: die vliegen blind
  blendedConclusionsReliable: boolean; // false zodra een kanaal blind vliegt of geen target heeft
  attributionFootnote: string;
}

// Lens 4: de hygiene-checks per kanaal plus de venster-vergelijkbaarheid over kanalen. De
// uitkomst zegt expliciet of blended conclusies uberhaupt betrouwbaar zijn; zo niet, dan is
// dat het eerste dat elke andere lens moet melden.
export function measurementConsistency(channels: ChannelMeasurementInput[]): MeasurementConsistencyResult {
  const issues: MeasurementIssue[] = [];
  const blindChannels: ChannelKey[] = [];

  for (const c of channels) {
    if (!c.hasTarget) {
      issues.push({ kind: "geen_target", channel: c.channel, severity: "hard", detail: `${c.channel} heeft geen target; prestatie is daar niet te beoordelen en elke blended conclusie leunt op een oordeel-loos kanaal` });
    } else if (c.targetPlausible === false) {
      issues.push({ kind: "target_niet_plausibel", channel: c.channel, severity: "zacht", detail: `${c.channel} heeft een target dat de plausibiliteitsguard niet haalt; beoordeel eerst het target voordat je op de uitkomst stuurt` });
    }

    if (!c.conversionsTracked) {
      blindChannels.push(c.channel);
      issues.push({ kind: "geen_tracking", channel: c.channel, severity: "hard", detail: `${c.channel} registreert geen conversies en vliegt blind; dit kanaal kan niet in een blended vergelijking` });
    } else if (c.trackingHealthy === false) {
      issues.push({ kind: "tracking_ongezond", channel: c.channel, severity: "hard", detail: `${c.channel} heeft een ongezonde tracking (breuk of gaten); de cijfers van dit kanaal zijn onbetrouwbaar tot de tracking hersteld is` });
    }
  }

  // Venster-vergelijkbaarheid: alleen te beoordelen over kanalen waarvan het venster bekend is.
  const knownWindows = [...new Set(channels.map((c) => c.attributionWindow).filter((w): w is string => w != null && w.trim() !== ""))];
  if (knownWindows.length > 1) {
    issues.push({ kind: "vensters_onvergelijkbaar", channel: null, severity: "zacht", detail: `de attributievensters verschillen (${knownWindows.join(" versus ")}); kanaal-vergelijkingen zijn daardoor extra indicatief` });
  }

  const hardIssue = issues.some((i) => i.severity === "hard");
  return {
    issues,
    blindChannels,
    blendedConclusionsReliable: !hardIssue,
    attributionFootnote: ATTRIBUTION_FOOTNOTE,
  };
}

// ── Lens 5: blended betrouwbaarheid en over-attributie ──

export interface ChannelConversionsInput {
  channel: ChannelKey;
  conversions: number; // de kanaal-eigen geclaimde conversies over de periode
}

export interface BlendedReliabilityResult {
  blendedSum: number;
  anchor: number | null; // de werkelijke orders of leads uit een primaire bron, indien aanwezig
  // De over-attributie-marge als KANTTEKENING: hoeveel de kanalen samen meer claimen dan het
  // anker. Alleen gevuld met een anker; anders is de som expliciet een bovengrens.
  overAttributionPct: number | null;
  interpretation: "som_is_bovengrens" | "kanalen_overclaimen" | "som_consistent_met_anker" | "anker_boven_som";
  detail: string;
  attributionFootnote: string; // het hoofdproduct van deze lens
}

// Binnen deze marge boven het anker beschouwen we de som als consistent (attributie-ruis).
export const OVERCLAIM_TOLERANCE = 0.1;

// Lens 5: beschermt tegen de optelsom-illusie. Met een sanity-anker (werkelijke orders of
// leads) kwantificeert hij de over-attributie als kanttekening; zonder anker is de blended
// som een bovengrens en wordt dat expliciet gezegd. Nooit een hard de-echte-verdeling-is-X.
export function blendedReliability(channels: ChannelConversionsInput[], anchor: number | null): BlendedReliabilityResult {
  const blendedSum = channels.reduce((s, c) => s + Math.max(c.conversions, 0), 0);
  const base = { blendedSum, anchor, attributionFootnote: ATTRIBUTION_FOOTNOTE };

  if (anchor == null || anchor <= 0) {
    return {
      ...base,
      overAttributionPct: null,
      interpretation: "som_is_bovengrens",
      detail: "er is geen primaire bron van werkelijke orders of leads; de blended som is een bovengrens, geen werkelijkheid",
    };
  }

  const ratio = blendedSum / anchor;
  if (ratio > 1 + OVERCLAIM_TOLERANCE) {
    const overPct = Math.round((ratio - 1) * 1000) / 10;
    return {
      ...base,
      overAttributionPct: overPct,
      interpretation: "kanalen_overclaimen",
      detail: `de kanalen claimen samen ${blendedSum} conversies tegenover ${anchor} werkelijke; dat is circa ${overPct} procent over-attributie, een indicatie van dubbel geclaimde conversies, geen exacte verdeling`,
    };
  }
  if (ratio < 1) {
    return {
      ...base,
      overAttributionPct: null,
      interpretation: "anker_boven_som",
      detail: `de werkelijke aantallen (${anchor}) liggen boven de som van de kanalen (${blendedSum}); er converteert meer dan de kanalen claimen, denk aan organisch of niet-getrackte paden`,
    };
  }
  return {
    ...base,
    overAttributionPct: Math.round((ratio - 1) * 1000) / 10,
    interpretation: "som_consistent_met_anker",
    detail: `de blended som (${blendedSum}) ligt binnen de tolerantie van het anker (${anchor}); geen aanwijzing voor materiele dubbeltelling`,
  };
}
