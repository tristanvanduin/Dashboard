// =====================================================================
// SI3: de standalone periode-evaluatie. De maand-SOP concludeert per maand; deze route
// rekent een HELE periode (kwartaal, campagne, beurseditie) af tegen zijn plan over de tijd.
// De rekenlaag is volledig deterministisch (lib/analysis/period-evaluation.ts); de LLM
// FORMULEERT alleen. LIVE-ONGETEST: vergt gesyncte maanddata en vastgelegde targets.
//
// De H1-seam: zolang de hypothese-evaluator niet gewired is, levert deze route geen
// outcomes mee en zegt de evaluatie zelf dat de beloftes niet afgerekend zijn. Dat is de
// eerlijke stand, en de dag dat H1 wel draait hoeft hier alleen de outcomes-map gevuld.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callRouted } from "@/lib/analysis/llm-router";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import { buildPeriodEvaluation, renderPeriodEvaluationSection, type PeriodHypothesis, type PeriodMonthRow } from "@/lib/analysis/period-evaluation";

const SECTION = "period_evaluation_v1";
const SOP_TYPE = "period_evaluation";

// GET: de laatst opgeslagen periode-evaluatie.
export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date, period_start, period_end")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ evaluation: data ?? null });
}

// POST: draai een nieuwe periode-evaluatie. Body: client_id plus from en to (YYYY-MM), of
// months (een aantal maanden terug vanaf de laatste volle maand).
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });
  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  let body: { client_id?: string; from?: string; to?: string; months?: number; label?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Verwacht JSON-body" }, { status: 400 });
  }
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });

  // De periode: expliciet from en to, of een aantal maanden terug (default een kwartaal).
  const today = new Date();
  const lastCompleteEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const toMonth = typeof body.to === "string" && /^\d{4}-\d{2}$/.test(body.to) ? body.to : lastCompleteEnd.toISOString().slice(0, 7);
  let fromMonth: string;
  if (typeof body.from === "string" && /^\d{4}-\d{2}$/.test(body.from)) {
    fromMonth = body.from;
  } else {
    const count = typeof body.months === "number" && body.months > 0 ? Math.floor(body.months) : 3;
    const [y, m] = toMonth.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1 - (count - 1), 1));
    fromMonth = start.toISOString().slice(0, 7);
  }
  if (fromMonth > toMonth) return Response.json({ error: "from ligt na to" }, { status: 400 });

  const periodStart = `${fromMonth}-01`;
  const periodEndExclusive = `${toMonth}-31`; // maandkolom is een datum; deze bovengrens dekt elke maandlengte

  const [monthlyRes, hypothesisRes, clientCtx] = await Promise.all([
    supabase
      .from("ads_account_monthly")
      .select("month, cost, conversions, conversions_value")
      .eq("client_id", clientId)
      .gte("month", periodStart)
      .lte("month", periodEndExclusive)
      .order("month"),
    supabase
      .from("sprint_hypotheses")
      .select("id, hypothesis, measurement_metric, status, created_at, accepted_at")
      .eq("client_id", clientId)
      .gte("created_at", periodStart)
      .lte("created_at", `${periodEndExclusive}T23:59:59`),
    fetchClientContext(supabase, clientId),
  ]);

  if (monthlyRes.error) return Response.json({ error: `Maanddata laden faalde: ${monthlyRes.error.message}` }, { status: 500 });
  const months: PeriodMonthRow[] = (monthlyRes.data ?? []).map((r) => ({
    month: String(r.month).slice(0, 7),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    conversionsValue: Number(r.conversions_value ?? 0), // Google: conversions_value (meervoud)
  }));
  if (months.length === 0) {
    return Response.json({ error: `Geen maanddata tussen ${fromMonth} en ${toMonth} voor deze klant` }, { status: 404 });
  }

  const hypotheses: PeriodHypothesis[] = (hypothesisRes.data ?? []).map((h) => ({
    id: String(h.id),
    hypothesis: String(h.hypothesis ?? ""),
    measurementMetric: (h.measurement_metric as string | null) ?? null,
    status: (h.status as string | null) ?? null,
    createdAt: (h.created_at as string | null) ?? null,
    acceptedAt: (h.accepted_at as string | null) ?? null,
  }));

  const goals = (clientCtx.goalsConfig ?? {}) as { cpaTarget?: number; roasTarget?: number };
  const evaluation = buildPeriodEvaluation({
    periodLabel: typeof body.label === "string" && body.label ? body.label : `${fromMonth} tot ${toMonth}`,
    months,
    targets: { cpaTarget: goals.cpaTarget ?? null, roasTarget: goals.roasTarget ?? null },
    hypotheses,
    // De H1-seam blijft leeg tot de evaluator gewired is; de kern zegt dat er eerlijk bij.
  });

  const factsSection = renderPeriodEvaluationSection(evaluation);
  const systemPrompt = `Je bent een senior performance-strateeg. Je schrijft de EINDEVALUATIE van een periode voor de klant: hoe deed deze periode het ten opzichte van wat er beloofd en gepland was.

## Klantdoelen en context
${clientCtx.goalsSection}

${factsSection}

## Regels
1. Gebruik ALLEEN de cijfers hierboven. Herbereken niets en verzin niets.
2. Dit is een PERIODE-oordeel, geen maandmomentopname: schrijf over de ontwikkeling binnen de periode (de trend tussen de helften), niet alleen over het eindpunt.
3. Neem de verdict-labels letterlijk over. Bij geen_target of te_weinig_volume vel je GEEN oordeel; benoem dan expliciet dat het niet af te rekenen viel en wat er nodig is om dat volgende periode wel te kunnen.
4. Als hypotheses niet afgerekend zijn, benoem dat als een gat in het proces, niet als een succes of een mislukking.
5. Schrijf in het Nederlands, mobiel leesbaar, conclusies boven datadumps.

## Gevraagde output
Kort: (1) het oordeel over de periode in twee zinnen, (2) wat het plan was en wat ervan terechtkwam, (3) de ontwikkeling binnen de periode, (4) wat dit betekent voor de volgende periode, (5) wat er ontbrak om scherper te kunnen oordelen.`;

  const response = await callRouted({
    apiKey,
    systemPrompt,
    userMessage: `Schrijf de eindevaluatie voor client "${clientId}" over de periode ${evaluation.periodLabel}.`,
    maxTokens: 4096,
    temperature: 0,
    label: "period-evaluation",
  });

  const analysisDate = new Date().toISOString().split("T")[0];
  void recordUsage(supabase, {
    runKey: `period-evaluation-${clientId}-${analysisDate}`,
    clientId,
    channel: "google_ads",
    sopType: SOP_TYPE,
    stepLabel: "Periode-evaluatie",
    model: response.model,
    promptTokens: response.promptTokens ?? 0,
    completionTokens: response.completionTokens ?? 0,
  });

  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId,
      sop_type: SOP_TYPE,
      analysis_date: analysisDate,
      period_start: periodStart,
      period_end: `${toMonth}-01`,
      section: SECTION,
      output: response.output,
      model_used: response.model,
      tokens_used: response.tokensUsed,
      step_number: 1,
      step_name: "Periode-evaluatie",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  return Response.json({ evaluation: response.output, facts: evaluation });
}
