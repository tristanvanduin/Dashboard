// X4 lens 3: doelgroep- en boodschapsamenhang, pure kern. Twee checks uit de spec. Eerst de
// strategische tegenspraak: wijkt de converterende doelgroep op het ene kanaal materieel af
// van het gedefinieerde doelprofiel (bijv. het LinkedIn-ICP), dan een flag met beide
// bronsegmenten. De dimensies van kanalen matchen niet een-op-een (Meta kent leeftijd en
// geslacht, het ICP kent functie en senioriteit), dus de check werkt ALLEEN op dimensies die
// beide kanten kennen en degradeert expliciet waar dat niet kan: eerlijk, niet gokken. Daarna
// de creatieve overdracht: winnende Meta-patronen (M3) als expliciet gelabelde hypothese voor
// de andere kanalen, nooit als feit, met een degradatiepad zolang M3 niet bestaat (het
// review-verbeterpunt). IO-vrij en los getest.

import { ATTRIBUTION_FOOTNOTE, type ChannelKey } from "./lens-facts";

// Een generieke doelgroep-dimensie, zodat kanalen met verschillende assen toch op gedeelde
// dimensies vergeleken kunnen worden (bijv. industry kent LinkedIn en soms ook Meta-targeting).
export type AudienceDimension = "job_function" | "seniority" | "industry" | "company_size" | "age" | "gender" | "geo";

export interface ConvertingSegment {
  dimension: AudienceDimension;
  value: string;
  conversionShare: number; // aandeel van de kanaal-conversies uit dit segment (0 tot 1)
}

export interface TargetProfile {
  channel: ChannelKey; // het kanaal waarvan dit het gedefinieerde doelprofiel is
  byDimension: Partial<Record<AudienceDimension, string[]>>; // de gewenste waarden per dimensie
}

export interface AudienceContradictionFlag {
  dimension: AudienceDimension;
  convertingChannel: ChannelKey;
  profileChannel: ChannelKey;
  outsideProfileSharePct: number; // deel van de conversies buiten het doelprofiel
  convertingSegments: ConvertingSegment[]; // de bronsegmenten, verplicht bij de flag
  profileValues: string[];
  detail: string;
}

export interface AudienceCoherenceResult {
  flags: AudienceContradictionFlag[];
  comparedDimensions: AudienceDimension[];
  skippedDimensions: Array<{ dimension: AudienceDimension; reason: string }>; // expliciete degradatie
  attributionFootnote: string;
}

// Boven dit aandeel conversies buiten het doelprofiel is er een strategische tegenspraak.
export const CONTRADICTION_THRESHOLD = 0.5;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

// De strategische tegenspraak-check. Vergelijkt per GEDEELDE dimensie het aandeel conversies
// dat buiten het doelprofiel van het andere kanaal valt. Dimensies die maar aan een kant
// bestaan worden expliciet overgeslagen met de reden, nooit stil vergeleken.
export function audienceContradiction(
  converting: { channel: ChannelKey; segments: ConvertingSegment[] },
  profile: TargetProfile
): AudienceCoherenceResult {
  const flags: AudienceContradictionFlag[] = [];
  const comparedDimensions: AudienceDimension[] = [];
  const skippedDimensions: AudienceCoherenceResult["skippedDimensions"] = [];

  const segmentDims = [...new Set(converting.segments.map((s) => s.dimension))];
  const profileDims = Object.keys(profile.byDimension) as AudienceDimension[];

  // Dimensies met converterende data maar zonder profiel: overslaan met reden.
  for (const d of segmentDims) {
    if (!profileDims.includes(d) || !(profile.byDimension[d] ?? []).length) {
      skippedDimensions.push({ dimension: d, reason: `het doelprofiel van ${profile.channel} kent geen ${d}; niet vergelijkbaar` });
    }
  }
  // Profiel-dimensies zonder converterende data: idem.
  for (const d of profileDims) {
    if ((profile.byDimension[d] ?? []).length && !segmentDims.includes(d)) {
      skippedDimensions.push({ dimension: d, reason: `${converting.channel} levert geen converterende segmenten op ${d}; niet vergelijkbaar` });
    }
  }

  // De gedeelde dimensies echt vergelijken.
  for (const d of segmentDims) {
    const profileValues = (profile.byDimension[d] ?? []).map(norm);
    if (!profileValues.length) continue;
    comparedDimensions.push(d);

    const segments = converting.segments.filter((s) => s.dimension === d);
    const outsideShare = segments.filter((s) => !profileValues.includes(norm(s.value))).reduce((sum, s) => sum + s.conversionShare, 0);

    if (outsideShare > CONTRADICTION_THRESHOLD) {
      flags.push({
        dimension: d,
        convertingChannel: converting.channel,
        profileChannel: profile.channel,
        outsideProfileSharePct: Math.round(outsideShare * 1000) / 10,
        convertingSegments: segments,
        profileValues: profile.byDimension[d] ?? [],
        detail: `${Math.round(outsideShare * 100)} procent van de ${converting.channel}-conversies op ${d} valt buiten het ${profile.channel}-doelprofiel; de kanalen vertellen een tegenstrijdig doelgroepverhaal`,
      });
    }
  }

  return { flags, comparedDimensions, skippedDimensions, attributionFootnote: ATTRIBUTION_FOOTNOTE };
}

// ── Creatieve overdracht (M3), met het degradatiepad ──

export interface CreativeWinningPattern {
  pattern: string; // bijv. "ugc boven studio", "mens in beeld", "hook binnen 2 seconden"
  evidence: string; // waarop het binnen Meta bewezen is
}

export interface CreativeTransferHypothesis {
  label: "hypothese"; // hard gelabeld, nooit een feit
  pattern: string;
  fromChannel: ChannelKey;
  toChannels: ChannelKey[];
  statement: string;
}

export interface CreativeTransferResult {
  available: boolean; // false zolang M3-data ontbreekt
  degradedReason: string | null;
  hypotheses: CreativeTransferHypothesis[];
  attributionFootnote: string;
}

// De creatieve-overdracht-check. Met M3-patronen: kandidaat-hypothesen voor de andere
// kanalen, expliciet gelabeld als cross-channel onbewezen. Zonder M3-data: expliciete
// degradatie met een melding, de subcheck blokkeert de lens niet (het review-gat gedicht).
export function creativeTransferCandidates(
  patterns: CreativeWinningPattern[] | null,
  otherChannels: ChannelKey[]
): CreativeTransferResult {
  if (!patterns || patterns.length === 0) {
    return {
      available: false,
      degradedReason: "geen creatieve-patroondata (M3) beschikbaar; de creatieve-overdracht-subcheck is overgeslagen",
      hypotheses: [],
      attributionFootnote: ATTRIBUTION_FOOTNOTE,
    };
  }

  const hypotheses: CreativeTransferHypothesis[] = patterns.map((p) => ({
    label: "hypothese",
    pattern: p.pattern,
    fromChannel: "meta_ads",
    toChannels: otherChannels,
    statement: `Binnen Meta bewezen (${p.evidence}): ${p.pattern}. Cross-channel ONBEWEZEN; test dit als hypothese op ${otherChannels.join(" en ")}, neem het niet als feit over.`,
  }));

  return { available: true, degradedReason: null, hypotheses, attributionFootnote: ATTRIBUTION_FOOTNOTE };
}
