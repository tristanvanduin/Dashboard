// R1: target-resolutie voor het RAI-spoor, de pure kern. De spec is streng en dat maakt dit
// eenvoudig en eerlijk: targets horen bij een EDITIE (nooit een kalenderjaar), per stream
// (registraties en exposanten los, nooit samengevoegd), en per geo-clone (elke variant is
// een eigen event met eigen targets: de Amsterdam-targets gelden NIET voor Mexico). Er is
// dus GEEN fallback-ladder over edities of clones: ontbrekend is eerlijk "geen target
// ingesteld" met de reden, en nooit een vergelijking met nul (de O2-nul-guard). De
// tabel-wiring (event_stream_targets) is build-kant achter de platformkeuze; deze kern is de
// volledige logica erachter. IO-vrij en los getest.

import { checkTargetPlausibility } from "@/lib/analysis/o2-targets-cost";
import type { Stream } from "./event-comparison";

// Targets bestaan alleen voor de twee echte stromen; "onbekend" is een rapportage-bucket,
// geen target-dimensie.
export type TargetStream = Exclude<Stream, "onbekend">;
export type TargetMetric = "volume" | "cpa" | "budget";

export interface EventStreamTargetRow {
  geoCloneKey: string; // de abbreviation uit de catalogus (AQM, ICC, ...), de event-sleutel
  editionId: string; // targets horen bij een editie (spec 4b)
  stream: TargetStream;
  volumeTarget: number | null; // het registraties- of exposanten-target
  cpaTarget: number | null;
  budgetPlanned: number | null;
  confirmedByClient: boolean; // mens-in-de-lus: een voorstel is pas een target na bevestiging
}

// ── Validatie van de rijenset (voor de settings-UI en de migratie-checks). ──

export interface TargetValidationIssue {
  level: "error" | "warning";
  detail: string;
}

export function validateTargetRows(rows: EventStreamTargetRow[], knownGeoCloneKeys: string[]): TargetValidationIssue[] {
  const issues: TargetValidationIssue[] = [];
  const seen = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.geoCloneKey}|${row.editionId}|${row.stream}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);

    for (const [metric, value] of [["volume", row.volumeTarget], ["cpa", row.cpaTarget], ["budget", row.budgetPlanned]] as Array<[TargetMetric, number | null]>) {
      if (value != null && value <= 0) {
        issues.push({ level: "error", detail: `${row.geoCloneKey} ${row.editionId} ${row.stream}: ${metric}-target is ${value}; nul of negatief is geen target (nooit een vergelijking met 0)` });
      }
    }
    if (row.volumeTarget == null && row.cpaTarget == null && row.budgetPlanned == null) {
      issues.push({ level: "warning", detail: `${row.geoCloneKey} ${row.editionId} ${row.stream}: lege rij zonder enige metric` });
    }
    if (!knownGeoCloneKeys.includes(row.geoCloneKey)) {
      issues.push({ level: "warning", detail: `${row.geoCloneKey}: onbekende geo-clone-sleutel (niet in de catalogus); controleer de afkorting` });
    }
    if (!row.confirmedByClient) {
      issues.push({ level: "warning", detail: `${row.geoCloneKey} ${row.editionId} ${row.stream}: onbevestigd voorstel; telt niet als target tot de klant bevestigt` });
    }
  }

  for (const [key, count] of seen) {
    if (count > 1) {
      issues.push({ level: "error", detail: `${key.replaceAll("|", " ")}: ${count} rijen voor dezelfde (geo-clone, editie, stream); conflict, de resolutie weigert te kiezen` });
    }
  }

  return issues;
}

// ── De resolutie: exact op (geo-clone, editie, stream, metric), zonder fallback. ──

export type TargetResolution =
  | { status: "resolved"; value: number; row: EventStreamTargetRow }
  | { status: "geen_target"; reason: string }
  | { status: "conflict"; reason: string };

function metricValue(row: EventStreamTargetRow, metric: TargetMetric): number | null {
  if (metric === "volume") return row.volumeTarget;
  if (metric === "cpa") return row.cpaTarget;
  return row.budgetPlanned;
}

export function resolveStreamTarget(
  rows: EventStreamTargetRow[],
  query: { geoCloneKey: string; editionId: string; stream: TargetStream; metric: TargetMetric }
): TargetResolution {
  const exact = rows.filter((r) => r.geoCloneKey === query.geoCloneKey && r.editionId === query.editionId && r.stream === query.stream);

  if (exact.length === 0) {
    return { status: "geen_target", reason: `geen target-rij voor ${query.geoCloneKey} ${query.editionId} ${query.stream}; stel het target in (targets gelden per editie en per geo-clone, er is bewust geen fallback)` };
  }
  if (exact.length > 1) {
    return { status: "conflict", reason: `${exact.length} rijen voor ${query.geoCloneKey} ${query.editionId} ${query.stream}; los het conflict op in de settings, de resolutie kiest niet` };
  }

  const row = exact[0];
  if (!row.confirmedByClient) {
    return { status: "geen_target", reason: `er ligt een ONBEVESTIGD voorstel voor ${query.stream} ${query.metric}; bevestig het in de settings, een voorstel telt niet als target` };
  }
  const value = metricValue(row, query.metric);
  if (value == null || value <= 0) {
    return { status: "geen_target", reason: `de rij voor ${query.geoCloneKey} ${query.editionId} ${query.stream} heeft geen ${query.metric}-target ingesteld` };
  }
  return { status: "resolved", value, row };
}

// ── De event-matrix: beide streams maal drie metrics, apart en compleet benoemd. ──

export interface EventTargetsMatrix {
  geoCloneKey: string;
  editionId: string;
  cells: Array<{ stream: TargetStream; metric: TargetMetric; resolution: TargetResolution }>;
  missing: Array<{ stream: TargetStream; metric: TargetMetric; reason: string }>;
  complete: boolean; // alle zes cellen resolved
}

export const TARGET_STREAMS: TargetStream[] = ["registraties", "exposanten"];
export const TARGET_METRICS: TargetMetric[] = ["volume", "cpa", "budget"];

export function resolveEventTargets(rows: EventStreamTargetRow[], event: { geoCloneKey: string; editionId: string }): EventTargetsMatrix {
  const cells: EventTargetsMatrix["cells"] = [];
  const missing: EventTargetsMatrix["missing"] = [];

  for (const stream of TARGET_STREAMS) {
    for (const metric of TARGET_METRICS) {
      const resolution = resolveStreamTarget(rows, { ...event, stream, metric });
      cells.push({ stream, metric, resolution });
      if (resolution.status !== "resolved") missing.push({ stream, metric, reason: resolution.reason });
    }
  }

  return { ...event, cells, missing, complete: missing.length === 0 };
}

// ── De voorstel-generator: de vorige-editie-realisatie als ONBEVESTIGD voorstel. Dit is de
// pure kiem van de actie-laag (mens-in-de-lus): de settings-UI kan het voorstel tonen, de
// klant bevestigt, en pas dan is het een target. ──

export function suggestTargetsFromPreviousEdition(input: {
  geoCloneKey: string;
  newEditionId: string;
  previousRealized: Array<{ stream: TargetStream; volumeRealized: number | null; cpaRealized: number | null }>;
}): EventStreamTargetRow[] {
  return input.previousRealized
    .filter((p) => (p.volumeRealized != null && p.volumeRealized > 0) || (p.cpaRealized != null && p.cpaRealized > 0))
    .map((p) => ({
      geoCloneKey: input.geoCloneKey,
      editionId: input.newEditionId,
      stream: p.stream,
      volumeTarget: p.volumeRealized != null && p.volumeRealized > 0 ? Math.round(p.volumeRealized) : null,
      cpaTarget: p.cpaRealized != null && p.cpaRealized > 0 ? Math.round(p.cpaRealized * 100) / 100 : null,
      budgetPlanned: null, // budget is een keuze, geen extrapolatie
      confirmedByClient: false,
    }));
}

// ── Plausibiliteit: het bevestigde CPA-target tegen de vorige-editie-CPA, via hergebruik
// van de O2-guard (symmetrisch, beide richtingen). De guard verwacht twee referenties;
// met een editie als referentie geven we die dubbel door, wat semantisch een referentie is. ──

export function checkEditionCpaPlausibility(
  cpaTarget: number,
  previousEditionCpa: number | null
): { implausible: boolean; detail?: string } {
  if (previousEditionCpa == null || previousEditionCpa <= 0) return { implausible: false };
  return checkTargetPlausibility("CPA", cpaTarget, [previousEditionCpa, previousEditionCpa]);
}
