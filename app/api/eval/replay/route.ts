/**
 * POST /api/eval/replay (X3): speelt een gecapturede fixture-set opnieuw af met een expliciet
 * opgegeven model en scoort het resultaat.
 *
 * Isolatie (spec-eis): deze route importeert BEWUST niets van de productie-opslag
 * (saveAnalysisOutputSection en verwanten ontbreken hier); er wordt uitsluitend naar
 * eval_runs en eval_outputs geschreven.
 *
 * Auth: fail-closed op CRON_SECRET. Bewust strikter dan de sync-cron (die bij een ontbrekend
 * secret doorlaat): een eval-run kost geld, dus zonder geconfigureerd secret weigert deze
 * route.
 *
 * Kosten-rem (spec-eis): zonder confirm: true draait er niets en komt alleen de schatting
 * terug. De schatting is eerlijk null zolang MODEL_PRICES (O2) leeg is.
 *
 * Model-keuze: bewust callOpenRouter direct met het opgegeven model op temperatuur 0, NIET
 * callRouted: de keten-fallback zou model A stiekem model B kunnen maken en dat corrumpeert
 * de vergelijking.
 */
import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey } from "@/lib/analysis/helpers";
import { callOpenRouter } from "@/lib/analysis/openrouter-client";
import { replayFixtures, buildRunInputFromReplay, runJudge, filterFixturesForReplay, type EvalFixtureRecord, type ReplayCallFn, type JudgeCallFn } from "@/lib/eval/replay-core";
import { buildScorecard, estimateEvalCost } from "@/lib/eval/scorecard";
import { DEFAULT_REQUIRED_SECTIONS } from "@/lib/eval/output-checks";

// Bewust GEEN maxDuration-export: de monthly route heeft die ook niet, en een replay van
// een volledige stappenreeks moet dezelfde platform-limieten volgen als de run zelf.

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET is niet geconfigureerd; deze route weigert zonder secret (fail-closed, een eval-run kost geld)" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });
  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OpenRouter niet geconfigureerd" }, { status: 500 });

  let body: { fixture_set?: string; model?: string; judge_model?: string; benchmark?: string; confirm?: boolean; include_kinds?: Array<"step" | "checkpoint" | "repair"> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Verwacht JSON-body" }, { status: 400 });
  }
  const fixtureSet = typeof body.fixture_set === "string" ? body.fixture_set.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!fixtureSet || !model) {
    return Response.json({ error: "Verwacht: { fixture_set: string, model: string, judge_model?, benchmark?, confirm? }" }, { status: 400 });
  }
  const wantsJudge = typeof body.judge_model === "string" && body.judge_model.trim().length > 0 && typeof body.benchmark === "string" && body.benchmark.trim().length > 0;

  const { data: fixtureRows, error: fixtureError } = await supabase
    .from("eval_fixtures")
    .select("step, payload")
    .eq("fixture_set", fixtureSet)
    .order("step", { ascending: true });
  if (fixtureError) return Response.json({ error: `Fixtures laden faalde: ${fixtureError.message}` }, { status: 500 });
  if (!fixtureRows || fixtureRows.length === 0) {
    return Response.json({ error: `Geen fixtures gevonden voor fixture_set "${fixtureSet}"; draai eerst een analyse met capture_fixtures: true` }, { status: 404 });
  }

  const allFixtures: EvalFixtureRecord[] = fixtureRows.map((row) => ({ step: row.step as number, payload: row.payload as EvalFixtureRecord["payload"] }));
  const includeKinds = Array.isArray(body.include_kinds) && body.include_kinds.length > 0 ? body.include_kinds : (["step"] as const);
  const { fixtures: playable, excluded, duplicateSteps } = filterFixturesForReplay(allFixtures, [...includeKinds]);
  if (playable.length === 0) {
    return Response.json({ error: `De fixture_set bevat geen speelbare fixtures van soort ${includeKinds.join(", ")} (${excluded} uitgesloten)` }, { status: 400 });
  }
  if (duplicateSteps.length > 0) {
    return Response.json({ error: `De fixture_set bevat duplicaten voor stap(pen) ${duplicateSteps.join(", ")}; dat maakt de vergelijking dubbelzinnig. Gebruik een verse fixture_set per capture-run.` }, { status: 400 });
  }

  const plannedCalls = playable.length + (wantsJudge ? 2 : 0);

  // De kosten-rem: zonder expliciete bevestiging draait er niets.
  if (body.confirm !== true) {
    const estimate = estimateEvalCost({ fixtureSets: 1, models: 1, callsPerRun: plannedCalls, avgCostPerCallEur: null });
    return Response.json({
      dry_run: true,
      fixture_set: fixtureSet,
      model,
      fixtures: playable.length,
      excluded_non_step: excluded,
      planned_calls: plannedCalls,
      estimated_cost_eur: estimate.estimatedCostEur,
      cost_note: estimate.note,
      instruction: "Stuur dezelfde body met confirm: true om de replay echt te draaien.",
    });
  }

  const sopType = playable[0]?.payload?.sopType ?? "monthly";
  const requiredSections = DEFAULT_REQUIRED_SECTIONS[sopType] ?? [];

  const { data: runRow, error: runInsertError } = await supabase
    .from("eval_runs")
    .insert({ fixture_set: fixtureSet, model, judge_model: wantsJudge ? body.judge_model : null, judge_prompt_version: null })
    .select("id")
    .single();
  if (runInsertError || !runRow) return Response.json({ error: `eval_runs insert faalde: ${runInsertError?.message ?? "onbekend"}` }, { status: 500 });
  const runId = runRow.id as number;

  const callFn: ReplayCallFn = async ({ system, user, jsonMode }) => {
    const response = await callOpenRouter({
      apiKey,
      model,
      systemPrompt: system,
      userMessage: user,
      maxTokens: jsonMode ? 8192 : 4096,
      jsonMode,
      temperature: 0,
      label: `eval-replay-${model}`,
    });
    return { output: response.output, model: response.model, promptTokens: response.promptTokens, completionTokens: response.completionTokens };
  };

  try {
    const run = await replayFixtures({ fixtures: playable, model, callFn });

    for (const stepResult of run.stepResults) {
      const { error: outputError } = await supabase
        .from("eval_outputs")
        .insert({ eval_run_id: runId, step: stepResult.step, output: stepResult.output });
      if (outputError) console.warn(`[eval] eval_outputs insert faalde voor stap ${stepResult.step}: ${outputError.message}`);
    }

    const scorecard = buildScorecard(buildRunInputFromReplay({ model, fixtureSet, run, requiredSections }));

    let judge: Awaited<ReturnType<typeof runJudge>> | null = null;
    if (wantsJudge) {
      const judgeCallFn: JudgeCallFn = async ({ system, user }) => {
        const response = await callOpenRouter({
          apiKey,
          model: body.judge_model!.trim(),
          systemPrompt: system,
          userMessage: user,
          maxTokens: 4096,
          jsonMode: true,
          temperature: 0,
          label: "eval-judge",
        });
        return { output: response.output };
      };
      judge = await runJudge({ callFn: judgeCallFn, deliverable: run.combinedDeliverable, benchmark: body.benchmark!.trim() });
    }

    await supabase
      .from("eval_runs")
      .update({
        finished_at: new Date().toISOString(),
        scorecard,
        judge_result: judge,
        judge_prompt_version: judge?.promptVersion ?? null,
      })
      .eq("id", runId);

    return Response.json({ run_id: runId, fixture_set: fixtureSet, model, scorecard, judge });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from("eval_runs").update({ finished_at: new Date().toISOString(), scorecard: { error: message } }).eq("id", runId);
    return Response.json({ error: `Replay faalde: ${message}`, run_id: runId }, { status: 500 });
  }
}
