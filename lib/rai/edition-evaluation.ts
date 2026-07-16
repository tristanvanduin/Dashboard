// SI3 voor RAI: de editie-evaluatie. Waar de agency-variant een periode tegen zijn plan
// afrekent op kalendermaanden, doet deze dat op de EVENT-RELATIEVE tijdas: een beurs draait
// niet in maanden maar in dagen-tot-de-beurs, en de eerlijke vergelijking is de vorige
// editie op HETZELFDE dagen-uit-punt.
//
// Dit is bewust een AGGREGATOR: het rekenwerk zit al in de kernen (resolveEventTargets,
// buildEventComparison, forecastStream). Hier komt alleen het oordeel bij, plus de
// eerlijkheid over wat wel en niet te zeggen valt.
//
// HET ONDERSCHEID DAT ALLES BEPAALT: voor de beurs is elke uitspraak een PROJECTIE en hoort
// er voorwaardelijke taal bij ("koerst op"); na afloop is het een FEIT ("haalde"). Een
// evaluatie die dat verschil niet maakt, verkoopt een verwachting als een uitkomst.

import { buildEventComparison, type RaiDataPoint, type RaiEdition, type Stream } from "./event-comparison";
import { forecastStream, type StreamForecast } from "./event-forecast";
import { resolveEventTargets, type EventStreamTargetRow } from "./target-resolution";
import { daysToFair } from "./event-time-axis";
import type { EventComparison } from "./event-comparison";

export const EVALUATION_STREAMS: Stream[] = ["registraties", "exposanten"];

export type StreamVerdict = "op_koers" | "achter" | "voor" | "gehaald" | "gemist" | "geen_target" | "niet_bepaalbaar";

export interface StreamEvaluation {
  stream: Stream;
  verdict: StreamVerdict;
  detail: string;
  forecast: StreamForecast;
  comparison: EventComparison;
}

export interface EditionEvaluation {
  editionId: string;
  geoClone: string;
  daysToFair: number | null;
  afgelopen: boolean; // de beurs is geweest, dus de cijfers zijn een uitkomst en geen projectie
  streams: StreamEvaluation[];
  ontbrekendeTargets: string[];
  summary: string;
}

function volumeTargetFor(rows: EventStreamTargetRow[], geoCloneKey: string, editionId: string, stream: Stream): number | null {
  if (stream === "onbekend") return null;
  const matrix = resolveEventTargets(rows, { geoCloneKey, editionId });
  const cell = matrix.cells.find((c) => c.stream === stream && c.metric === "volume");
  return cell && cell.resolution.status === "resolved" ? cell.resolution.value : null;
}

function verdictFor(forecast: StreamForecast, afgelopen: boolean): { verdict: StreamVerdict; detail: string } {
  if (forecast.target == null) {
    return {
      verdict: "geen_target",
      detail: `geen volume-target vastgelegd voor deze stream en editie, dus geen oordeel; de stand is ${forecast.currentCumulative}`,
    };
  }
  if (forecast.projectedFinal == null || forecast.willHitTarget == null) {
    return { verdict: "niet_bepaalbaar", detail: `geen betrouwbare projectie mogelijk: ${forecast.note}` };
  }
  const pct = forecast.projectedVsTargetPct;
  const pctText = pct == null ? "onbekend" : `${pct > 0 ? "plus" : "min"} ${Math.abs(pct).toFixed(1)} procent`;

  // Na de beurs is het een uitkomst; ervoor een projectie. Andere taal, ander gewicht.
  if (afgelopen) {
    return forecast.willHitTarget
      ? { verdict: "gehaald", detail: `eindstand ${forecast.currentCumulative} tegen target ${forecast.target} (${pctText})` }
      : { verdict: "gemist", detail: `eindstand ${forecast.currentCumulative} tegen target ${forecast.target} (${pctText})` };
  }
  if (forecast.willHitTarget) {
    // Ruim voor betekent voor; net aan betekent op koers. Het verschil is of er nog wat mag misgaan.
    return pct != null && pct >= 10
      ? { verdict: "voor", detail: `koerst op ${forecast.projectedFinal} tegen target ${forecast.target} (${pctText}), met marge` }
      : { verdict: "op_koers", detail: `koerst op ${forecast.projectedFinal} tegen target ${forecast.target} (${pctText}), zonder veel marge` };
  }
  return { verdict: "achter", detail: `koerst op ${forecast.projectedFinal} tegen target ${forecast.target} (${pctText})` };
}

export function buildEditionEvaluation(input: {
  points: RaiDataPoint[];
  editions: RaiEdition[];
  targetRows: EventStreamTargetRow[];
  currentEditionId: string;
  geoClone: string;
  asOfDate: string;
}): EditionEvaluation {
  const edition = input.editions.find((e) => e.editionId === input.currentEditionId);
  const days = edition ? daysToFair(edition.fairStartDate, input.asOfDate) : null;
  // Op de beursdag zelf (x = 0) telt de aanloop als afgerond: er valt niets meer bij te sturen.
  const afgelopen = days != null && days <= 0;

  const streams: StreamEvaluation[] = EVALUATION_STREAMS.map((stream) => {
    const comparison = buildEventComparison({
      allPoints: input.points,
      editions: input.editions,
      currentEditionId: input.currentEditionId,
      geoClone: input.geoClone,
      stream,
      asOfDate: input.asOfDate,
    });
    const currentPoints = input.points.filter((p) => p.editionId === input.currentEditionId && p.geoClone === input.geoClone && p.stream === stream);
    const prevEdition = input.editions.find((e) => e.editionId !== input.currentEditionId && comparison.previousEditionGapDays != null);
    const forecast = edition
      ? forecastStream({
          current: { edition, points: currentPoints },
          previous: prevEdition
            ? { edition: prevEdition, points: input.points.filter((p) => p.editionId === prevEdition.editionId && p.geoClone === input.geoClone && p.stream === stream) }
            : null,
          target: volumeTargetFor(input.targetRows, input.geoClone, input.currentEditionId, stream),
          asOfDate: input.asOfDate,
        })
      : ({ method: "geen_basis", daysToFairNow: null, currentCumulative: 0, projectedFinal: null, target: null, projectedVsTargetPct: null, willHitTarget: null, confidence: "geen_basis", note: "editie niet gevonden" } as StreamForecast);

    const { verdict, detail } = verdictFor(forecast, afgelopen);
    return { stream, verdict, detail, forecast, comparison };
  });

  const matrix = resolveEventTargets(input.targetRows, { geoCloneKey: input.geoClone, editionId: input.currentEditionId });
  const ontbrekendeTargets = matrix.missing.map((m) => `${m.stream} ${m.metric}: ${m.reason}`);

  const summary = edition
    ? `${input.geoClone} editie ${input.currentEditionId}: ${afgelopen ? "afgelopen" : `nog ${days} dagen tot de beurs`}. ` +
      streams.map((s) => `${s.stream} ${s.verdict}`).join(", ") +
      (ontbrekendeTargets.length > 0 ? `. ${ontbrekendeTargets.length} van de zes targets ontbreekt.` : ". Alle targets zijn vastgelegd.")
    : `Editie ${input.currentEditionId} niet gevonden in de editie-lijst; geen evaluatie mogelijk.`;

  return { editionId: input.currentEditionId, geoClone: input.geoClone, daysToFair: days, afgelopen, streams, ontbrekendeTargets, summary };
}

// De prompt-sectie, in dezelfde vorm als de agency-variant: deterministisch voorgerekend,
// het model formuleert alleen.
export function renderEditionEvaluationSection(evaluation: EditionEvaluation): string {
  const lines: string[] = [];
  lines.push("## Editie-evaluatie: plan tegen realisatie op de event-tijdas");
  lines.push("");
  lines.push(evaluation.summary);
  lines.push("");
  for (const s of evaluation.streams) {
    lines.push(`### ${s.stream}`);
    lines.push(`- [${s.verdict}] ${s.detail}`);
    const eoe = s.comparison.editionOverEdition;
    lines.push(
      eoe.comparable && eoe.deltaPct != null
        ? `- Editie over editie op gelijke dagen-uit: ${eoe.currentCumulative} tegen ${eoe.previousCumulativeAtSameDaysOut} (${eoe.deltaPct > 0 ? "plus" : "min"} ${Math.abs(eoe.deltaPct * 100).toFixed(1)} procent)`
        : `- Editie over editie: niet vergelijkbaar (${eoe.reason ?? "onbekende reden"})`
    );
    lines.push(`- Projectiemethode: ${s.forecast.method}, betrouwbaarheid ${s.forecast.confidence}. ${s.forecast.note}`);
    lines.push("");
  }
  if (evaluation.ontbrekendeTargets.length > 0) {
    lines.push("### Ontbrekende targets");
    for (const m of evaluation.ontbrekendeTargets) lines.push(`- ${m}`);
    lines.push("");
  }
  lines.push(
    evaluation.afgelopen
      ? "De beurs is geweest: deze cijfers zijn een UITKOMST. Schrijf in de verleden tijd en vel een oordeel over wat er gebeurd is."
      : "De beurs moet nog komen: elke uitspraak over de eindstand is een PROJECTIE. Schrijf voorwaardelijk en presenteer geen verwachting als uitkomst."
  );
  lines.push("Neem de cijfers en de labels letterlijk over; herbereken niets.");
  return lines.join("\n");
}
