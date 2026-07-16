/**
 * POST /api/eval/compare (X3): zet twee eval-runs naast elkaar en levert het
 * vergelijkingsrapport (markdown plus de ruwe vergelijking).
 *
 * Eisen: beide runs moeten een scorekaart hebben en op DEZELFDE fixture-set draaien;
 * verschillende sets vergelijken is appels met peren en wordt geweigerd.
 *
 * Optioneel doet een derde judge-call de drie grootste kwalitatieve verschillen, met
 * citaten uit beide kandidaten (contract: TopDifferencesSchema), maximaal een
 * schema-retry conform de werkwijze.
 */
import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey } from "@/lib/analysis/helpers";
import { callOpenRouter } from "@/lib/analysis/openrouter-client";
import { compareScorecards, type DeterministicScorecard } from "@/lib/eval/scorecard";
import { buildComparisonMarkdown, buildDifferencesPrompt, TopDifferencesSchema, type TopDifference } from "@/lib/eval/comparison-report";
import type { JudgeRunResult } from "@/lib/eval/replay-core";

interface EvalRunRow {
  id: number;
  model: string;
  fixture_set: string;
  scorecard: DeterministicScorecard | null;
  judge_result: JudgeRunResult | null;
}

function stripFences(text: string): string {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET is niet geconfigureerd; deze route weigert zonder secret (fail-closed)" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  let body: { run_id_a?: number; run_id_b?: number; judge_differences?: boolean; judge_model?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Verwacht JSON-body" }, { status: 400 });
  }
  if (typeof body.run_id_a !== "number" || typeof body.run_id_b !== "number") {
    return Response.json({ error: "Verwacht: { run_id_a: number, run_id_b: number, judge_differences?, judge_model? }" }, { status: 400 });
  }

  const { data: runRows, error: runError } = await supabase
    .from("eval_runs")
    .select("id, model, fixture_set, scorecard, judge_result")
    .in("id", [body.run_id_a, body.run_id_b]);
  if (runError) return Response.json({ error: `Runs laden faalde: ${runError.message}` }, { status: 500 });

  const runA = (runRows ?? []).find((r) => r.id === body.run_id_a) as EvalRunRow | undefined;
  const runB = (runRows ?? []).find((r) => r.id === body.run_id_b) as EvalRunRow | undefined;
  if (!runA || !runB) return Response.json({ error: "Een of beide runs bestaan niet" }, { status: 404 });
  if (!runA.scorecard || !runB.scorecard) return Response.json({ error: "Een of beide runs hebben geen scorekaart (nog niet afgerond of gefaald)" }, { status: 400 });
  if (runA.fixture_set !== runB.fixture_set) {
    return Response.json({ error: `De runs draaien op verschillende fixture-sets ("${runA.fixture_set}" en "${runB.fixture_set}"); dat is appels met peren en wordt niet vergeleken` }, { status: 400 });
  }

  const comparison = compareScorecards(runA.scorecard, runB.scorecard);

  // Optioneel: de drie grootste kwalitatieve verschillen via een derde judge-call.
  let differences: TopDifference[] | null = null;
  if (body.judge_differences === true) {
    const judgeModel = typeof body.judge_model === "string" ? body.judge_model.trim() : "";
    const apiKey = getOpenRouterKey();
    if (!judgeModel || !apiKey) {
      return Response.json({ error: "judge_differences vereist judge_model en een geconfigureerde OpenRouter-key" }, { status: 400 });
    }

    const loadDeliverable = async (runId: number): Promise<string> => {
      const { data } = await supabase.from("eval_outputs").select("step, output").eq("eval_run_id", runId).order("step", { ascending: true });
      return (data ?? []).map((row) => `## Stap ${row.step}\n\n${row.output}`).join("\n\n");
    };
    const [deliverableA, deliverableB] = await Promise.all([loadDeliverable(runA.id), loadDeliverable(runB.id)]);
    if (!deliverableA || !deliverableB) {
      return Response.json({ error: "Een of beide runs hebben geen opgeslagen outputs; de verschillen-judge kan niet draaien" }, { status: 400 });
    }

    const prompt = buildDifferencesPrompt({ deliverableA, deliverableB, modelA: runA.model, modelB: runB.model });
    for (let attempt = 0; attempt < 2 && differences === null; attempt += 1) {
      const suffix = attempt === 0 ? "" : "\n\nJe vorige antwoord was geen geldige JSON conform het schema. Antwoord UITSLUITEND met de JSON-array, met per verschil titel, citaat_a, citaat_b en duiding.";
      const response = await callOpenRouter({
        apiKey,
        model: judgeModel,
        systemPrompt: prompt.system,
        userMessage: prompt.user + suffix,
        maxTokens: 2048,
        jsonMode: true,
        temperature: 0,
        label: "eval-differences",
      });
      try {
        const parsed = TopDifferencesSchema.safeParse(JSON.parse(stripFences(response.output)));
        if (parsed.success) differences = parsed.data;
      } catch {
        // de retry-suffix dekt dit
      }
    }
  }

  const markdown = buildComparisonMarkdown({
    comparison,
    scorecardA: runA.scorecard,
    scorecardB: runB.scorecard,
    judgeA: runA.judge_result?.merged ?? null,
    judgeB: runB.judge_result?.merged ?? null,
    differences,
  });

  return Response.json({ markdown, comparison, differences });
}
