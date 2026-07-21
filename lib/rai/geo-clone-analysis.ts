// Fase 4 van de geo-clone-projecten: de beursanalyse. Verbindt drie bestaande, geteste kernen
// die tot nu toe los van elkaar leefden: de per-beurs-aggregatie uit campagnedata (fase 1c),
// de per-beurs-instellingen met account-fallback (fase 2: cadans, editie-datums, doelen) en de
// event-relatieve vergelijking/forecast (event-time-axis + event-comparison + event-forecast).
// Het resultaat is de event-relatieve vervanging van MoM/YoY voor een beurs: waar staat de
// aanloop naar DEZE editie ten opzichte van dezelfde afstand tot de VORIGE editie, en haalt
// de projectie het doel. Puur en los getest; de route levert alleen rijen en instellingen.
//
// Eerlijkheidsgrenzen, expliciet:
// - De fijnste per-campagne granulariteit is MAANDdata; week-tempo wordt daarom bewust
//   overgeslagen (gedegradeerd), nooit uit maandpunten geveinsd.
// - Beursvensters worden afgeleid uit de editie-datums (venster = na de vorige editie tot en
//   met de beursdag); dat is een benadering en staat als aanname in de output.

import { aggregateCampaignMonthlyByGeoClone, type CampaignMonthlyRow } from "./geo-clone-aggregate";
import { previousEditionFor, type RaiEdition, type FairCadence } from "./event-comparison";
import { alignEditionsAtEqualDaysOut, isWithinWindow, type DailyPoint, type Edition as AxisEdition, type EditionComparison } from "./event-time-axis";
import { forecastStream, type StreamForecast } from "./event-forecast";
import { forecastAllChannels, type ChannelForecastInput, type ChannelForecastResult, type BlendedForecast } from "./multi-channel-forecast";
import type { Edition as SettingsEdition } from "./geo-clone-settings";

export const FAIR_DURATION_DAYS = 3; // aanname: een beurs duurt enkele dagen; alleen de startdag is geconfigureerd
const WINDOW_FALLBACK_DAYS: Record<FairCadence, number> = { annual: 365, biennial: 730, custom: 365 };

export interface GeoCloneAnalysisInput {
  geoClone: string;
  fairLabel: string;
  rows: CampaignMonthlyRow[];
  cadence: FairCadence;
  editions: SettingsEdition[]; // uit de per-beurs-instellingen (met account-fallback)
  conversionsTarget: number | null; // doel voor deze beurs (resolved, account-fallback)
  asOfDate: string; // ISO
  // Optionele extra kanalen (Meta/LinkedIn) als dag-conversiepunten, al gefilterd op deze beurs.
  // Google komt uit `rows`; deze kanalen krijgen dezelfde event-relatieve forecast en tellen mee
  // in het blended beursbeeld ("hoeveel verwachten we in totaal op de beurs"). Elk kanaal even
  // belangrijk: dezelfde kern, dezelfde tijdas (dagen-tot-beurs).
  channelConvPoints?: { channel: string; points: DailyPoint[]; target?: number | null }[];
}

export interface GeoCloneAnalysisResult {
  geoClone: string;
  currentEditionId: string | null;
  previousEditionId: string | null;
  previousEditionGapDays: number | null;
  cadenceMatches: boolean;
  conversions: EditionComparison | null;
  cost: EditionComparison | null;
  forecast: StreamForecast | null;
  perChannelForecast: ChannelForecastResult[]; // event-relatieve forecast per kanaal (incl. Google)
  blendedForecast: BlendedForecast | null; // totaal over de kanalen; null bij één kanaal
  degradations: string[];
  /** true als de projectie het doel mist of de aanloop materieel achterligt: wachtrij-waardig */
  actionNeeded: boolean;
  markdown: string;
}

const ACTION_BEHIND_PCT = -0.15; // 15% achter op de vorige editie bij gelijke afstand is materieel

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Bouwt RaiEditions uit de geconfigureerde editie-datums: venster loopt van net na de vorige
 * editie tot en met de beursdag (of een cadans-lengte terug voor de eerste editie). */
export function buildEditions(geoClone: string, cadence: FairCadence, editions: SettingsEdition[]): RaiEdition[] {
  const sorted = editions
    .filter((e) => e.date)
    .map((e) => ({ date: e.date.slice(0, 10), label: e.label || e.date.slice(0, 10) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return sorted.map((e, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const campaignStartDate = prev ? addDays(prev.date, FAIR_DURATION_DAYS + 1) : addDays(e.date, -WINDOW_FALLBACK_DAYS[cadence]);
    return {
      editionId: e.label,
      campaignStartDate,
      fairStartDate: e.date,
      fairEndDate: addDays(e.date, FAIR_DURATION_DAYS),
      fairId: geoClone,
      geoClone,
      cadence,
    };
  });
}

/** De editie waar we nu naartoe werken: de eerstvolgende vanaf de peildatum, anders de laatste
 * (evaluatie na afloop). */
export function pickCurrentEdition(editions: RaiEdition[], asOfDate: string): RaiEdition | null {
  const upcoming = editions.filter((e) => e.fairStartDate >= asOfDate).sort((a, b) => a.fairStartDate.localeCompare(b.fairStartDate));
  if (upcoming.length > 0) return upcoming[0];
  const past = [...editions].sort((a, b) => b.fairStartDate.localeCompare(a.fairStartDate));
  return past[0] ?? null;
}

function pointsWithin(points: DailyPoint[], edition: AxisEdition): DailyPoint[] {
  return points.filter((p) => isWithinWindow(p.date, edition));
}

export function analyzeGeoClone(input: GeoCloneAnalysisInput): GeoCloneAnalysisResult {
  const degradations: string[] = [
    "week-tempo overgeslagen: de fijnste per-campagne granulariteit is maanddata; tempo wordt niet uit maandpunten geveinsd",
    `beursvenster is een benadering: van net na de vorige editie tot en met de beursdag (+${FAIR_DURATION_DAYS} dagen beursduur)`,
  ];

  const summary = aggregateCampaignMonthlyByGeoClone(input.rows, input.geoClone);
  if (summary.months.length === 0) {
    return emptyResult(input, [...degradations, `geen campagnedata voor ${input.geoClone}; niets te vergelijken`]);
  }

  const editions = buildEditions(input.geoClone, input.cadence, input.editions);
  if (editions.length === 0) {
    return emptyResult(input, [
      ...degradations,
      "geen editie-datums geconfigureerd voor deze beurs; stel de edities in bij Instellingen (beurs-scope) om de event-relatieve vergelijking te activeren",
    ]);
  }

  const current = pickCurrentEdition(editions, input.asOfDate);
  if (!current) return emptyResult(input, [...degradations, "geen bruikbare editie gevonden"]);

  const prev = previousEditionFor(editions, current.editionId);

  // Maandpunten -> dagpunten op de maand-datum, per metriek.
  const convPoints: DailyPoint[] = summary.months.map((m) => ({ date: m.month.slice(0, 10), value: m.conversions }));
  const costPoints: DailyPoint[] = summary.months.map((m) => ({ date: m.month.slice(0, 10), value: m.cost }));

  const curConv = pointsWithin(convPoints, current);
  const prevConv = prev.edition ? pointsWithin(convPoints, prev.edition) : [];
  const curCost = pointsWithin(costPoints, current);
  const prevCost = prev.edition ? pointsWithin(costPoints, prev.edition) : [];

  const conversions = alignEditionsAtEqualDaysOut(
    { edition: current, points: curConv },
    prev.edition ? { edition: prev.edition, points: prevConv } : null,
    input.asOfDate
  );
  const cost = alignEditionsAtEqualDaysOut(
    { edition: current, points: curCost },
    prev.edition ? { edition: prev.edition, points: prevCost } : null,
    input.asOfDate
  );

  // Universele, event-relatieve forecast over alle kanalen. Google uit de campagne-maanddata,
  // Meta/LinkedIn uit hun (al beurs-gefilterde) dag-conversiepunten. Dezelfde kern, dezelfde
  // tijdas; het blended totaal is "hoeveel verwachten we in totaal op de beurs".
  const channelInputs: ChannelForecastInput[] = [
    {
      channel: "google_ads",
      current: { edition: current, points: curConv },
      previous: prev.edition ? { edition: prev.edition, points: prevConv } : null,
      target: input.conversionsTarget,
    },
  ];
  for (const cs of input.channelConvPoints ?? []) {
    channelInputs.push({
      channel: cs.channel,
      current: { edition: current, points: pointsWithin(cs.points, current) },
      previous: prev.edition ? { edition: prev.edition, points: pointsWithin(cs.points, prev.edition) } : null,
      target: cs.target ?? null,
    });
  }
  const multi = forecastAllChannels(channelInputs, input.asOfDate);
  // Behoud het bestaande Google-gedrag exact: forecast blijft de Google-stream.
  const forecast = multi.perChannel.find((c) => c.channel === "google_ads")!.forecast;
  const blendedForecast = channelInputs.length > 1 ? multi.blended : null;

  if (input.conversionsTarget == null) {
    degradations.push("geen conversie-doel voor deze beurs (beurs- noch account-niveau); de projectie heeft geen doel om tegen af te zetten");
  }

  const behindMaterially = conversions.comparable && conversions.deltaPct != null && conversions.deltaPct <= ACTION_BEHIND_PCT;
  const missesTarget = forecast.willHitTarget === false;
  const actionNeeded = Boolean(behindMaterially || missesTarget);

  const markdown = renderMarkdown(input, current, prev.edition?.editionId ?? null, prev.gapDays, prev.cadenceMatches, conversions, cost, forecast, multi.perChannel, blendedForecast, degradations);

  return {
    geoClone: input.geoClone,
    currentEditionId: current.editionId,
    previousEditionId: prev.edition?.editionId ?? null,
    previousEditionGapDays: prev.gapDays,
    cadenceMatches: prev.cadenceMatches,
    conversions,
    cost,
    forecast,
    perChannelForecast: multi.perChannel,
    blendedForecast,
    degradations,
    actionNeeded,
    markdown,
  };
}

function emptyResult(input: GeoCloneAnalysisInput, degradations: string[]): GeoCloneAnalysisResult {
  return {
    geoClone: input.geoClone,
    currentEditionId: null,
    previousEditionId: null,
    previousEditionGapDays: null,
    cadenceMatches: false,
    conversions: null,
    cost: null,
    forecast: null,
    perChannelForecast: [],
    blendedForecast: null,
    degradations,
    actionNeeded: false,
    markdown: [`# Beursanalyse ${input.fairLabel} (${input.geoClone})`, "", "## Niet uitvoerbaar", ...degradations.map((d) => `- ${d}`)].join("\n"),
  };
}

const fmtPct = (v: number | null): string => (v == null ? "n.v.t." : `${v >= 0 ? "+" : ""}${Math.round(v * 1000) / 10}%`);
const fmtNum = (v: number | null): string => (v == null ? "n.v.t." : String(Math.round(v)));

const CHANNEL_LABEL: Record<string, string> = { google_ads: "Google", meta_ads: "Meta", linkedin_ads: "LinkedIn" };
const channelLabel = (c: string): string => CHANNEL_LABEL[c] ?? c;

function renderMarkdown(
  input: GeoCloneAnalysisInput,
  current: RaiEdition,
  prevId: string | null,
  gapDays: number | null,
  cadenceMatches: boolean,
  conversions: EditionComparison,
  cost: EditionComparison,
  forecast: StreamForecast,
  perChannel: ChannelForecastResult[],
  blended: BlendedForecast | null,
  degradations: string[]
): string {
  const lines: string[] = [
    `# Beursanalyse ${input.fairLabel} (${input.geoClone})`,
    "",
    `Editie: **${current.editionId}** (beursdag ${current.fairStartDate}). Peildatum ${input.asOfDate}${forecast.daysToFairNow != null ? `, ${forecast.daysToFairNow} dagen tot de beurs` : ""}.`,
    prevId
      ? `Vorige editie: **${prevId}**${gapDays != null ? ` (${gapDays} dagen terug${cadenceMatches ? ", past bij de cadans" : "; LET OP: past niet bij de opgegeven cadans"})` : ""}.`
      : "Geen vorige editie bekend: dit is de eerste geconfigureerde editie (alleen de projectie, geen vergelijking).",
    "",
    "## Editie-over-editie (gelijke afstand tot de beurs)",
  ];

  if (conversions.comparable) {
    lines.push(
      `- Conversies opgebouwd tot nu: **${fmtNum(conversions.currentCumulative)}** vs **${fmtNum(conversions.previousCumulativeAtSameDaysOut)}** op hetzelfde punt voor de vorige editie: **${fmtPct(conversions.deltaPct)}**.`,
      `- Spend opgebouwd tot nu: **${fmtNum(cost.currentCumulative)}** vs **${fmtNum(cost.previousCumulativeAtSameDaysOut)}**: **${fmtPct(cost.deltaPct)}**.`
    );
    if (conversions.deltaPct != null && cost.deltaPct != null && conversions.deltaPct < 0 && cost.deltaPct >= 0) {
      lines.push("- De aanloop ligt achter TERWIJL de spend gelijk of hoger ligt: de achterstand is geen investeringskwestie maar een effectiviteitsvraag.");
    }
  } else {
    lines.push(`- Niet vergelijkbaar: ${conversions.reason ?? "onbekend"}.`);
  }

  lines.push(
    "",
    "## Projectie richting de beursdag",
    `- Methode: **${forecast.method}** (zekerheid: ${forecast.confidence}). ${forecast.note}`,
    `- Opgebouwd: **${fmtNum(forecast.currentCumulative)}** conversies${forecast.projectedFinal != null ? `; geprojecteerde eindstand: **${fmtNum(forecast.projectedFinal)}**` : ""}.`
  );
  if (forecast.target != null) {
    lines.push(
      `- Doel: **${fmtNum(forecast.target)}**${forecast.projectedVsTargetPct != null ? ` — projectie komt uit op **${Math.round(forecast.projectedVsTargetPct * 100)}%** van het doel (${forecast.willHitTarget ? "haalt het doel" : "MIST het doel"})` : ""}.`
    );
  }

  // Universeel beursbeeld: per kanaal + het totaal, allemaal event-relatief (dagen-tot-beurs).
  if (blended && perChannel.length > 1) {
    lines.push("", "## Beursprojectie over alle kanalen (dagen-tot-beurs)");
    for (const { channel, forecast: f } of perChannel) {
      lines.push(
        `- **${channelLabel(channel)}**: opgebouwd ${fmtNum(f.currentCumulative)}${f.projectedFinal != null ? `, projectie ${fmtNum(f.projectedFinal)}` : " (geen projectie)"} (${f.method}, zekerheid ${f.confidence}).`
      );
    }
    lines.push(
      `- **Totaal**: opgebouwd **${fmtNum(blended.currentCumulative)}**${blended.projectedFinal != null ? `, geprojecteerd op **${fmtNum(blended.projectedFinal)}** op de beurs` : " (geen totaalprojectie)"}${blended.target != null && blended.projectedVsTargetPct != null ? ` — **${Math.round(blended.projectedVsTargetPct * 100)}%** van het totaal-doel (${blended.willHitTarget ? "haalt het" : "MIST het"})` : ""}.`,
      `- Zekerheid van het totaal: **${blended.confidence}** (zwakste schakel); ${blended.note}.`
    );
  }

  lines.push("", "## Aannames en degradaties (geen stil gokken)", ...degradations.map((d) => `- ${d}`));
  return lines.join("\n");
}
