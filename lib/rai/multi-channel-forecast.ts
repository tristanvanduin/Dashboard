// Universele, event-relatieve forecast over ALLE kanalen. De kern (event-forecast.ts) is
// kanaal-agnostisch: hij projecteert een stream op dagen-tot-beurs met de vorige-editie-curve.
// Deze laag draait die kern per kanaal (Google/Meta/LinkedIn) op dezelfde beursdatum en telt de
// projecties op tot één beursbeeld: "hoeveel kunnen we in totaal verwachten op de beurs".
//
// Bewuste principes:
// - Elk kanaal is even belangrijk: geen kanaal wordt bevoorrecht, geen kanaal draait op een
//   ander (zwakker) forecast-model. Iedereen door dezelfde event-relatieve kern.
// - Altijd dagen-tot-beurs. De beursdatum is per kanaal gelijk (het is dezelfde beurs), dus de
//   tijdas klopt over kanalen heen.
// - Het totaal is nooit zekerder dan zijn zwakste schakel: de gecombineerde zekerheid is het
//   minimum over de kanalen die een projectie leveren. Kanalen zonder basis degraderen
//   expliciet in de output i.p.v. stil te verdwijnen.
// - Attributie-eerlijkheid: elk kanaal telt zijn eigen conversies; de som is een beursbeeld,
//   geen exacte ontdubbelde telling. Dat staat als voetnoot in de note.
//
// Puur en los getest, geen IO.

import { forecastStream, type StreamForecast, type ForecastConfidence } from "./event-forecast";
import type { Edition, DailyPoint } from "./event-time-axis";

export interface ChannelForecastInput {
  channel: string; // "google_ads" | "meta_ads" | "linkedin_ads" | ...
  current: { edition: Edition; points: DailyPoint[] };
  previous: { edition: Edition; points: DailyPoint[] } | null;
  target: number | null;
}

export interface ChannelForecastResult {
  channel: string;
  forecast: StreamForecast;
}

export interface BlendedForecast {
  daysToFairNow: number | null;
  currentCumulative: number;
  projectedFinal: number | null;
  target: number | null;
  projectedVsTargetPct: number | null;
  willHitTarget: boolean | null;
  confidence: ForecastConfidence;
  channelsWithProjection: number;
  channelsTotal: number;
  note: string;
}

export interface MultiChannelForecast {
  perChannel: ChannelForecastResult[];
  blended: BlendedForecast;
}

// Zwakste-schakel-ordening: het totaal erft de laagste zekerheid van de bijdragende kanalen.
const CONFIDENCE_RANK: Record<ForecastConfidence, number> = { geen_basis: 0, laag: 1, gemiddeld: 2, hoog: 3 };
const RANK_TO_CONFIDENCE: ForecastConfidence[] = ["geen_basis", "laag", "gemiddeld", "hoog"];

const ATTRIBUTIE_VOETNOOT =
  "elk kanaal telt zijn eigen conversies; dit totaal is een beursbeeld, geen exact ontdubbelde telling";

/**
 * Draait de event-relatieve forecast per kanaal en telt op tot één beursprojectie.
 * De beursdatum (edition.fairStartDate) hoort per kanaal gelijk te zijn; de dagen-tot-beurs
 * komt dan overal op hetzelfde punt uit.
 */
export function forecastAllChannels(inputs: ChannelForecastInput[], asOfDate: string): MultiChannelForecast {
  const perChannel: ChannelForecastResult[] = inputs.map((input) => ({
    channel: input.channel,
    forecast: forecastStream({ current: input.current, previous: input.previous, target: input.target, asOfDate }),
  }));

  // Alleen kanalen met een echte projectie dragen bij aan het totaal; de rest degradeert expliciet.
  const contributing = perChannel.filter((c) => c.forecast.projectedFinal != null);
  const channelsTotal = perChannel.length;
  const channelsWithProjection = contributing.length;

  // Dagen-tot-beurs is event-eigenschap, niet kanaal-eigenschap: pak de eerste die er een heeft.
  const daysToFairNow = perChannel.find((c) => c.forecast.daysToFairNow != null)?.forecast.daysToFairNow ?? null;

  // De huidige stand telt over álle kanalen die een stand rapporteren (ook zonder projectie).
  const currentCumulative = perChannel.reduce((s, c) => s + c.forecast.currentCumulative, 0);

  if (channelsWithProjection === 0) {
    return {
      perChannel,
      blended: {
        daysToFairNow,
        currentCumulative,
        projectedFinal: null,
        target: null,
        projectedVsTargetPct: null,
        willHitTarget: null,
        confidence: "geen_basis",
        channelsWithProjection: 0,
        channelsTotal,
        note: `geen enkel kanaal levert een projectie; ${ATTRIBUTIE_VOETNOOT}`,
      },
    };
  }

  const projectedFinal = contributing.reduce((s, c) => s + (c.forecast.projectedFinal as number), 0);

  // Targets: alleen optellen als élk bijdragend kanaal er een heeft; anders is de som geen
  // eerlijke noemer (een kanaal zonder target zou het percentage kunstmatig gunstig maken).
  const allHaveTarget = contributing.every((c) => c.forecast.target != null);
  const target = allHaveTarget ? contributing.reduce((s, c) => s + (c.forecast.target as number), 0) : null;
  const projectedVsTargetPct = target != null && target > 0 ? Math.round((projectedFinal / target) * 1000) / 1000 : null;

  // Zwakste schakel over de bijdragende kanalen.
  const minRank = Math.min(...contributing.map((c) => CONFIDENCE_RANK[c.forecast.confidence]));
  const confidence = RANK_TO_CONFIDENCE[minRank];

  const missing = channelsTotal - channelsWithProjection;
  const noteParts = [
    `beursprojectie over ${channelsWithProjection} kanaal${channelsWithProjection === 1 ? "" : "en"}`,
    missing > 0 ? `${missing} kanaal${missing === 1 ? "" : "en"} zonder basis (gedegradeerd)` : null,
    !allHaveTarget ? "niet elk kanaal heeft een doel, dus geen totaal-doelpercentage" : null,
    ATTRIBUTIE_VOETNOOT,
  ].filter(Boolean);

  return {
    perChannel,
    blended: {
      daysToFairNow,
      currentCumulative,
      projectedFinal: Math.round(projectedFinal),
      target,
      projectedVsTargetPct,
      willHitTarget: projectedVsTargetPct == null ? null : projectedVsTargetPct >= 1,
      confidence,
      channelsWithProjection,
      channelsTotal,
      note: noteParts.join("; "),
    },
  };
}
