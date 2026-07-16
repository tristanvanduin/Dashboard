// =====================================================================
// De H1 cron-evaluator: de stap die de lerende loop sluit. Per klant worden de aangenomen
// hypotheses waarvan het meetvenster verstreken is tegen de realisatie gelegd, en het
// verdict wordt weggeschreven zodat het via de memory-laag terug de prompts in reist.
//
// GEEN SNAPSHOT NODIG: de baseline wordt RETROACTIEF gereconstrueerd uit de weken voor
// accepted_at, en de realisatie uit de weken erna. Dat is beter dan een persist-haak bij
// acceptatie: geen race-condities, en het werkt ook voor hypotheses die eerder zijn
// aangenomen.
//
// EERLIJKE BEPERKING, in elke uitkomst vermeld: sprint_hypotheses draagt geen
// entiteit-referentie en er bestaat geen campagne-weekdata (alleen ads_account_weekly en
// ads_country_weekly). Evalueren kan daarom UITSLUITEND op accountniveau. Een hypothese
// over een enkele campagne afmeten aan het accountgemiddelde is ruis; dat staat in de
// verdict_reason zodat niemand het verdict zwaarder weegt dan het verdient.
//
// LIVE-ONGETEST: vergt migratie 021 en aangenomen hypotheses met een verstreken venster.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { parseHypothesis, resolvePredicate } from "@/lib/learning/hypothesis-parser";
import { evaluateHypothesisOutcome } from "@/lib/learning/hypothesis-evaluator";
import { aggregateWeeks, weeksInWindow, addDays, isDerivableMetric, type WeeklyRow } from "@/lib/learning/weekly-metrics";

export const maxDuration = 300;

const DEFAULT_WINDOW_DAYS = 28; // als de hypothese geen bruikbaar tijdvenster noemt
const ACCOUNT_SCOPE_NOTE =
  "Gemeten op accountniveau: de hypothese draagt geen entiteit-referentie en er is geen campagne-weekdata, dus een effect op een enkele campagne kan in het accountgemiddelde wegvallen.";

interface HypothesisRow {
  id: string;
  client_id: string;
  hypothesis: string;
  expected_result: string | null;
  measurement_metric: string | null;
  timeframe: string | null;
  accepted_at: string | null;
}

export async function GET(request: NextRequest) {
  // Fail-closed, zoals de andere cron- en eval-routes.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET niet geconfigureerd; de evaluator weigert bewust te draaien" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "niet geautoriseerd" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const clientFilter = url.searchParams.get("client_id");

  // De kandidaten: aangenomen, met een acceptatiemoment, nog niet geevalueerd.
  let query = supabase
    .from("sprint_hypotheses")
    .select("id, client_id, hypothesis, expected_result, measurement_metric, timeframe, accepted_at")
    .eq("status", "accepted")
    .not("accepted_at", "is", null)
    .is("evaluated_at", null);
  if (clientFilter) query = query.eq("client_id", clientFilter);
  const { data: candidates, error: readError } = await query.limit(200);
  if (readError) return Response.json({ error: readError.message }, { status: 500 });

  const rows = (candidates ?? []) as HypothesisRow[];
  const now = new Date();
  const results: Array<{ id: string; verdict: string; reason: string }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  // Weekdata per klant, eenmalig geladen.
  const weeklyByClient = new Map<string, WeeklyRow[]>();
  for (const clientId of new Set(rows.map((r) => r.client_id))) {
    const { data } = await supabase
      .from("ads_account_weekly")
      .select("week_start, impressions, clicks, cost, conversions, conversions_value")
      .eq("client_id", clientId)
      .order("week_start");
    weeklyByClient.set(clientId, (data ?? []) as WeeklyRow[]);
  }

  for (const row of rows) {
    const acceptedAt = new Date(row.accepted_at as string);
    const parsed = parseHypothesis({
      expectedResult: row.expected_result,
      measurementMetric: row.measurement_metric,
      timeframe: row.timeframe,
    });

    // Een onparsebare hypothese krijgt geen gegokt verdict maar een eerlijke reden.
    if (!parsed.ok) {
      const outcome = { verdict: "unmeasurable", reason: `niet toetsbaar geformuleerd: ${parsed.reason}`, metrics: [] };
      results.push({ id: row.id, verdict: outcome.verdict, reason: outcome.reason });
      if (!dryRun) await writeVerdict(supabase, row.id, outcome, now);
      continue;
    }

    const windowDays = parsed.parsed.windowDays ?? DEFAULT_WINDOW_DAYS;
    const windowEnd = addDays(acceptedAt, windowDays);
    if (windowEnd > now) {
      skipped.push({ id: row.id, reason: `het meetvenster van ${windowDays} dagen loopt nog tot ${windowEnd.toISOString().slice(0, 10)}` });
      continue;
    }

    const metric = parsed.parsed.predicate.metric;
    if (!isDerivableMetric(metric)) {
      const outcome = { verdict: "unmeasurable", reason: `de metric ${metric} zit niet in de weekdata op accountniveau, dus er is niets om tegen te meten`, metrics: [] };
      results.push({ id: row.id, verdict: outcome.verdict, reason: outcome.reason });
      if (!dryRun) await writeVerdict(supabase, row.id, outcome, now);
      continue;
    }

    const weekly = weeklyByClient.get(row.client_id) ?? [];
    const baseline = aggregateWeeks(weeksInWindow(weekly, addDays(acceptedAt, -windowDays), acceptedAt));
    const measured = aggregateWeeks(weeksInWindow(weekly, acceptedAt, windowEnd));

    // De relatieve eis omzetten met de ECHTE baseline: de evaluator leest de drempel als
    // absolute magnitude, dus zonder deze stap zou vijftien procent als 0,15 euro gelden.
    const predicate = resolvePredicate(parsed.parsed, baseline);
    const outcome = evaluateHypothesisOutcome({
      successPredicates: [predicate],
      guardrailPredicates: [],
      baseline,
      measured,
      windowImpressions: measured.impressions ?? 0,
      entityActive: (measured.cost ?? 0) > 0,
      ageInDays: Math.floor((now.getTime() - acceptedAt.getTime()) / (24 * 3600 * 1000)),
    });

    const reason = `${describeOutcome(outcome.verdict, predicate.metric, baseline[predicate.metric], measured[predicate.metric])} ${ACCOUNT_SCOPE_NOTE}`;
    results.push({ id: row.id, verdict: outcome.verdict, reason });
    if (!dryRun) await writeVerdict(supabase, row.id, { verdict: outcome.verdict, reason, metrics: outcome.metrics }, now);
  }

  return Response.json({
    dry_run: dryRun,
    kandidaten: rows.length,
    geevalueerd: results.length,
    overgeslagen: skipped.length,
    results,
    skipped,
  });
}

function describeOutcome(verdict: string, metric: string, baseline: number | undefined, measured: number | undefined): string {
  const b = typeof baseline === "number" ? baseline.toFixed(2) : "onbekend";
  const m = typeof measured === "number" ? measured.toFixed(2) : "onbekend";
  return `${metric} ging van ${b} in het venster voor acceptatie naar ${m} erna; verdict ${verdict}.`;
}

async function writeVerdict(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  id: string,
  outcome: { verdict: string; reason: string; metrics: unknown },
  now: Date
): Promise<void> {
  await supabase
    .from("sprint_hypotheses")
    .update({
      verdict: outcome.verdict,
      verdict_reason: outcome.reason,
      verdict_metrics: outcome.metrics,
      evaluated_at: now.toISOString(),
    })
    .eq("id", id)
    .is("evaluated_at", null); // idempotent: een tweede cron-run overschrijft geen bestaand verdict
}
