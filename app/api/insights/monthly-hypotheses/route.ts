import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { decideTransition } from "@/lib/learning/hypothesis-status";
import type { MonthlyStructuredOutput, OperatingHypothesisTrace } from "@/lib/analysis/monthly-structured";
import {
  buildMonthlyHypothesesInsightsPayload,
  buildSprintItemDraftsForHypothesis,
  planHypothesisSprintSync,
  type PersistedSprintHypothesisRow,
  type PersistedSprintItemRow,
  encodeHypothesisPersistenceMetadata,
  decodeHypothesisPersistenceMetadata,
} from "@/lib/analysis/monthly-hypotheses-insights";

type StructuredMonthlyRow = {
  id: string;
  created_at: string;
  output: string | Record<string, unknown>;
};

type FullMonthlyRow = {
  id: string;
  created_at: string;
  output: string;
};

function parseStructuredOutput(row: StructuredMonthlyRow | null): MonthlyStructuredOutput | null {
  if (!row) return null;
  const raw = typeof row.output === "string" ? JSON.parse(row.output) : row.output;
  return raw && typeof raw === "object" ? raw as MonthlyStructuredOutput : null;
}

// Workflow per kanaal: de SOP-engine bewaart full/structured per adapter-sopTypeKey, dus de
// workflow werkt voor elk kanaal met een maand-SOP. Google blijft de default.
const CHANNEL_TO_SOP_TYPE: Record<string, string> = { google: "monthly", meta: "meta_monthly", linkedin: "linkedin_monthly" };
function resolveSopType(channel: string | null | undefined): string {
  return CHANNEL_TO_SOP_TYPE[(channel ?? "google").toLowerCase()] ?? "monthly";
}

async function loadLatestMonthlyContext(clientId: string, sopType: string) {
  const supabase = getSupabase();
  if (!supabase) {
    return { supabase: null, error: Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 }) };
  }

  const [fullRes, structuredRes] = await Promise.all([
    supabase
      .from("sop_analysis_output")
      .select("id, created_at, output")
      .eq("client_id", clientId)
      .eq("sop_type", sopType)
      .eq("section", "full")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sop_analysis_output")
      .select("id, created_at, output")
      .eq("client_id", clientId)
      .eq("sop_type", sopType)
      .eq("section", "structured_monthly_v2")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (fullRes.error || !fullRes.data) {
    return { supabase, error: Response.json({ error: `Geen ${sopType} full output gevonden` }, { status: 404 }) };
  }
  if (structuredRes.error || !structuredRes.data) {
    return { supabase, error: Response.json({ error: `Geen structured_monthly_v2 output (${sopType}) gevonden` }, { status: 404 }) };
  }

  const fullRow = fullRes.data as FullMonthlyRow;
  const structuredRow = structuredRes.data as StructuredMonthlyRow;
  const structuredOutput = parseStructuredOutput(structuredRow);
  if (!structuredOutput) {
    return { supabase, error: Response.json({ error: "Structured monthly output niet parsebaar" }, { status: 500 }) };
  }

  const { data: hypothesisRowsData, error: hypothesisRowsError } = await supabase
    .from("sprint_hypotheses")
    .select("id, client_id, analysis_id, hypothesis, expected_result, measurement_metric, timeframe, rationale, status, accepted_at, created_at")
    .eq("client_id", clientId);

  if (hypothesisRowsError) {
    return { supabase, error: Response.json({ error: hypothesisRowsError.message }, { status: 500 }) };
  }

  const hypothesisRows = (hypothesisRowsData ?? []) as PersistedSprintHypothesisRow[];
  const relevantHypothesisIds = hypothesisRows.map((row) => row.id);
  const sprintItemsData = relevantHypothesisIds.length > 0
    ? await supabase
        .from("sprint_items")
        .select("id, hypothesis_id, task, status, owner, metrics, review_timeframe, created_at, updated_at")
        .in("hypothesis_id", relevantHypothesisIds)
    : { data: [], error: null };

  if (sprintItemsData.error) {
    return { supabase, error: Response.json({ error: sprintItemsData.error.message }, { status: 500 }) };
  }

  const sprintItems = (sprintItemsData.data ?? []) as PersistedSprintItemRow[];
  const payload = buildMonthlyHypothesesInsightsPayload({
    structuredOutput,
    analysisId: fullRow.id,
    structuredRowId: structuredRow.id,
    structuredCreatedAt: structuredRow.created_at,
    persistedHypotheses: hypothesisRows,
    sprintItems,
  });

  return {
    supabase,
    error: null,
    fullRow,
    structuredRow,
    structuredOutput,
    payload,
    hypothesisRows,
    sprintItems,
  };
}

function findPersistedHypothesis(
  rows: PersistedSprintHypothesisRow[],
  analysisId: string,
  hypothesis: OperatingHypothesisTrace,
  structuredCreatedAt: string
): PersistedSprintHypothesisRow | null {
  const bySourceId = rows.find((row) => {
    if (row.analysis_id && row.analysis_id !== analysisId) return false;
    const metadata = decodeHypothesisPersistenceMetadata(row.rationale);
    return metadata?.source_hypothesis_id === hypothesis.id && metadata?.source_structured_created_at === structuredCreatedAt;
  });
  if (bySourceId) return bySourceId;
  return null;
}

async function ensurePersistedHypothesisRow(params: {
  supabase: NonNullable<ReturnType<typeof getSupabase>>;
  source: string;
  clientId: string;
  analysisId: string;
  structuredCreatedAt: string;
  hypothesis: OperatingHypothesisTrace;
}) {
  const existingRowsRes = await params.supabase
    .from("sprint_hypotheses")
    .select("id, client_id, analysis_id, hypothesis, expected_result, measurement_metric, timeframe, rationale, status, accepted_at, created_at")
    .eq("client_id", params.clientId)
    .eq("analysis_id", params.analysisId)
    .eq("hypothesis", params.hypothesis.hypothesis)
    .limit(1)
    .maybeSingle();

  if (existingRowsRes.error) {
    throw new Error(existingRowsRes.error.message);
  }
  const metadata = encodeHypothesisPersistenceMetadata({
    source_hypothesis_id: params.hypothesis.id,
    source_structured_created_at: params.structuredCreatedAt,
    why_we_think_this: params.hypothesis.why_we_think_this,
    validation_or_exploitation_step: params.hypothesis.validation_or_exploitation_step,
    linked_primary_thread: params.hypothesis.linked_primary_thread,
    linked_finding_ids: params.hypothesis.linked_finding_ids,
    linked_recommendation_ids: params.hypothesis.linked_recommendation_ids,
    linked_task_ids: params.hypothesis.linked_task_ids,
    rejected_reason: params.hypothesis.rejected_reason,
  });

  if (existingRowsRes.data) {
    const existingMetadata = decodeHypothesisPersistenceMetadata(existingRowsRes.data.rationale);
    if (existingMetadata?.source_structured_created_at === params.structuredCreatedAt) {
      return existingRowsRes.data as PersistedSprintHypothesisRow;
    }
  }

  if (existingRowsRes.data && !decodeHypothesisPersistenceMetadata(existingRowsRes.data.rationale)) {
    return existingRowsRes.data as PersistedSprintHypothesisRow;
  }

  const { data, error } = await params.supabase
    .from("sprint_hypotheses")
    .insert({
      client_id: params.clientId,
      analysis_id: params.analysisId,
      hypothesis: params.hypothesis.hypothesis,
      expected_result: params.hypothesis.success_next_month,
      measurement_metric: params.hypothesis.linked_recommendation_ids.join(", "),
      timeframe: params.hypothesis.label,
      rationale: metadata,
      status: "pending",
      source: params.source,
    })
    .select("id, client_id, analysis_id, hypothesis, expected_result, measurement_metric, timeframe, rationale, status, accepted_at, created_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Persist hypothesis row insert mislukt");
  }
  return data as PersistedSprintHypothesisRow;
}

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }
  const sopType = resolveSopType(request.nextUrl.searchParams.get("channel"));

  const ctx = await loadLatestMonthlyContext(clientId, sopType);
  if (ctx.error) return ctx.error;

  return Response.json(ctx.payload);
}

export async function POST(request: NextRequest) {
  let clientId = "";
  let action = "";
  let hypothesisId = "";
  let rejectedReason = "";
  let sopType = "monthly";
  try {
    const body = await request.json();
    clientId = String(body.client_id || "");
    sopType = resolveSopType(typeof body.channel === "string" ? body.channel : null);
    action = String(body.action || "");
    hypothesisId = String(body.hypothesis_id || "");
    rejectedReason = String(body.rejected_reason || "");
  } catch {
    return Response.json({ error: "Verwacht JSON body" }, { status: 400 });
  }

  if (!clientId || !action || !hypothesisId) {
    return Response.json({ error: "client_id, action en hypothesis_id zijn verplicht" }, { status: 400 });
  }
  if (!["accept", "reject"].includes(action)) {
    return Response.json({ error: "action moet accept of reject zijn" }, { status: 400 });
  }
  if (action === "reject" && rejectedReason.trim().length === 0) {
    return Response.json({ error: "rejected_reason is verplicht bij reject" }, { status: 400 });
  }

  const ctx = await loadLatestMonthlyContext(clientId, sopType);
  if (ctx.error || !ctx.supabase) return ctx.error ?? Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const hypothesis = ctx.structuredOutput.operating_detail.hypotheses_and_next_month_proof.find((item) => item.id === hypothesisId);
  if (!hypothesis) {
    return Response.json({ error: "Hypothesis niet gevonden in latest structured monthly output" }, { status: 404 });
  }

  const persisted = findPersistedHypothesis(ctx.hypothesisRows, ctx.fullRow.id, hypothesis, ctx.structuredRow.created_at)
    ?? await ensurePersistedHypothesisRow({
      source: sopType === "monthly" ? "analysis" : sopType,
      supabase: ctx.supabase,
      clientId,
      analysisId: ctx.fullRow.id,
      structuredCreatedAt: ctx.structuredRow.created_at,
      hypothesis,
    });

  if (action === "reject") {
    const metadata = encodeHypothesisPersistenceMetadata({
      source_hypothesis_id: hypothesis.id,
      source_structured_created_at: ctx.structuredRow.created_at,
      why_we_think_this: hypothesis.why_we_think_this,
      validation_or_exploitation_step: hypothesis.validation_or_exploitation_step,
      linked_primary_thread: hypothesis.linked_primary_thread,
      linked_finding_ids: hypothesis.linked_finding_ids,
      linked_recommendation_ids: hypothesis.linked_recommendation_ids,
      linked_task_ids: hypothesis.linked_task_ids,
      rejected_reason: rejectedReason.trim(),
    });

    // De statusmachine bewaakt de overgang: een afgeronde of al afgewezen hypothese kan
    // niet zomaar opnieuw beslist worden.
    const rejectDecision = decideTransition({
      current: { status: persisted.status, accepted_at: persisted.accepted_at ?? null },
      next: "rejected",
      reason: rejectedReason.trim(),
      now: new Date().toISOString(),
    });
    if (!rejectDecision.ok) {
      return Response.json({ error: rejectDecision.reason }, { status: 409 });
    }

    const { error: rejectError } = await ctx.supabase
      .from("sprint_hypotheses")
      .update({
        status: "rejected",
        rationale: metadata,
      })
      .eq("id", persisted.id);

    if (rejectError) {
      return Response.json({ error: rejectError.message }, { status: 500 });
    }

    const { error: expireError } = await ctx.supabase
      .from("sprint_items")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("hypothesis_id", persisted.id)
      .neq("status", "done");

    if (expireError) {
      return Response.json({ error: expireError.message }, { status: 500 });
    }

    const refreshed = await loadLatestMonthlyContext(clientId, sopType);
    if (refreshed.error) return refreshed.error;
    const updated = refreshed.payload.hypotheses.find((item) => item.id === hypothesisId) ?? null;
    return Response.json({ ok: true, hypothesis: updated });
  }

  const sprintDrafts = buildSprintItemDraftsForHypothesis(hypothesis, ctx.structuredOutput);
  if (sprintDrafts.length === 0) {
    return Response.json({ error: "Hypothesis heeft geen gekoppelde taken" }, { status: 409 });
  }

  const { data: existingItemsData, error: existingItemsError } = await ctx.supabase
    .from("sprint_items")
    .select("id, hypothesis_id, task, status, owner, metrics, review_timeframe, created_at, updated_at")
    .eq("client_id", clientId)
    .in("task", sprintDrafts.map((draft) => draft.task));

  if (existingItemsError) {
    return Response.json({ error: existingItemsError.message }, { status: 500 });
  }

  const existingItems = (existingItemsData ?? []) as PersistedSprintItemRow[];
  const existingByTask = new Map<string, PersistedSprintItemRow[]>();
  existingItems.forEach((item) => {
    const items = existingByTask.get(item.task) ?? [];
    items.push(item);
    existingByTask.set(item.task, items);
  });
  const canonicalItems = new Map<string, PersistedSprintItemRow>();
  const duplicateItems: PersistedSprintItemRow[] = [];

  existingByTask.forEach((items, task) => {
    const sorted = [...items].sort((a, b) => {
      const aScore = a.hypothesis_id === persisted.id ? 1 : 0;
      const bScore = b.hypothesis_id === persisted.id ? 1 : 0;
      if (aScore !== bScore) return bScore - aScore;
      const aCreated = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      const bCreated = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
      return bCreated - aCreated;
    });
    const [canonical, ...duplicates] = sorted;
    if (canonical) canonicalItems.set(task, canonical);
    duplicateItems.push(...duplicates);
  });

  const reusableItems = Array.from(canonicalItems.values()).filter((item) => item.hypothesis_id !== persisted.id);

  if (reusableItems.length > 0) {
    const { error: relinkError } = await ctx.supabase
      .from("sprint_items")
      .update({
        hypothesis_id: persisted.id,
        updated_at: new Date().toISOString(),
      })
      .in("id", reusableItems.map((item) => item.id));

    if (relinkError) {
      return Response.json({ error: relinkError.message, partial: true }, { status: 409 });
    }
  }

  if (duplicateItems.length > 0) {
    const duplicateIds = duplicateItems.filter((item) => item.status !== "done").map((item) => item.id);
    if (duplicateIds.length > 0) {
      const { error: expireDuplicateError } = await ctx.supabase
        .from("sprint_items")
        .update({
          status: "expired",
          updated_at: new Date().toISOString(),
        })
        .in("id", duplicateIds);

      if (expireDuplicateError) {
        return Response.json({ error: expireDuplicateError.message, partial: true }, { status: 409 });
      }
    }
  }

  const normalizedExistingItems = Array.from(canonicalItems.values()).map((item) =>
    reusableItems.some((candidate) => candidate.id === item.id)
      ? { ...item, hypothesis_id: persisted.id }
      : item
  );
  const syncPlan = planHypothesisSprintSync({
    hypothesis,
    structuredOutput: ctx.structuredOutput,
    existingItems: normalizedExistingItems,
  });
  const missingDrafts = syncPlan.missingDrafts;

  if (missingDrafts.length > 0) {
    const currentWeek = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
    const { error: insertItemsError } = await ctx.supabase
      .from("sprint_items")
      .insert(missingDrafts.map((draft) => ({
        client_id: clientId,
        hypothesis_id: persisted.id,
        week_number: currentWeek,
        task: draft.task,
        status: "todo",
        owner: draft.owner,
        metrics: draft.metrics,
        review_timeframe: draft.review_timeframe,
      })));

    if (insertItemsError) {
      return Response.json({ error: insertItemsError.message, partial: true }, { status: 409 });
    }
  }

  const { data: finalItemsData, error: finalItemsError } = await ctx.supabase
    .from("sprint_items")
    .select("id, hypothesis_id, task, status, owner, metrics, review_timeframe, created_at, updated_at")
    .eq("hypothesis_id", persisted.id);

  if (finalItemsError) {
    return Response.json({ error: finalItemsError.message, partial: true }, { status: 409 });
  }

  const finalItems = (finalItemsData ?? []) as PersistedSprintItemRow[];
  const allTasksPresent = sprintDrafts.every((draft) => finalItems.some((item) => item.task === draft.task));
  if (!allTasksPresent) {
    return Response.json({ error: "Niet alle gekoppelde taken zijn correct doorgeschoten naar sprintplanning", partial: true }, { status: 409 });
  }

  const metadata = encodeHypothesisPersistenceMetadata({
    source_hypothesis_id: hypothesis.id,
    source_structured_created_at: ctx.structuredRow.created_at,
    why_we_think_this: hypothesis.why_we_think_this,
    validation_or_exploitation_step: hypothesis.validation_or_exploitation_step,
    linked_primary_thread: hypothesis.linked_primary_thread,
    linked_finding_ids: hypothesis.linked_finding_ids,
    linked_recommendation_ids: hypothesis.linked_recommendation_ids,
    linked_task_ids: hypothesis.linked_task_ids,
    rejected_reason: null,
  });

  // De statusmachine beslist. Twee dingen die hier eerder misgingen:
  // (1) een al AFGEWEZEN hypothese kon alsnog geaccepteerd worden, want de huidige status
  //     werd niet gelezen;
  // (2) accepted_at werd bij ELKE accept opnieuw geschreven, ook bij de tweede (bewust
  //     idempotente) accept die de taken herpusht. Daardoor verschoof het startpunt van
  //     het meetvenster en meet de H1-evaluator een ander venster dan bedoeld.
  // De kern staat een herhaling toe maar levert accepted_at alleen bij de ECHTE overgang.
  const acceptDecision = decideTransition({
    current: { status: persisted.status, accepted_at: persisted.accepted_at ?? null },
    next: "accepted",
    now: new Date().toISOString(),
  });
  if (!acceptDecision.ok) {
    return Response.json({ error: acceptDecision.reason }, { status: 409 });
  }

  const acceptUpdate: Record<string, unknown> = { status: "accepted", rationale: metadata };
  if (acceptDecision.patch.accepted_at) {
    acceptUpdate.accepted_at = acceptDecision.patch.accepted_at;
  }

  const { error: acceptError } = await ctx.supabase
    .from("sprint_hypotheses")
    .update(acceptUpdate)
    .eq("id", persisted.id);

  if (acceptError) {
    return Response.json({ error: acceptError.message, partial: true }, { status: 409 });
  }

  const refreshed = await loadLatestMonthlyContext(clientId, sopType);
  if (refreshed.error) return refreshed.error;
  const updated = refreshed.payload.hypotheses.find((item) => item.id === hypothesisId) ?? null;
  return Response.json({ ok: true, hypothesis: updated });
}
