import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { runSecondOpinionAudit } from "@/lib/second-opinion/evaluator";
import { renderSecondOpinionPdf } from "@/lib/second-opinion/pdf-renderer";
import { saveAuditFindingsAsHypotheses } from "@/lib/second-opinion/findings-to-hypotheses";
import type { AuditMode } from "@/lib/second-opinion/template";
import { calculateFinalSummaries, type AuditRowResult, type AuditScore } from "@/lib/second-opinion/types";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";
import { logger } from "@/lib/logger";

/**
 * POST /api/second-opinion — trigger a second opinion audit.
 * Body: { client_id: string, mode: "quick" | "full" }
 *
 * GET /api/second-opinion?client_id=xxx — list previous runs for a client.
 */

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  let clientName: string;
  let mode: AuditMode;
  let jobId = crypto.randomUUID();
  try {
    const body = await request.json();
    clientId = body.client_id;
    clientName = body.client_name || clientId;
    mode = body.mode === "full" ? "full" : "quick";
    jobId = body.job_id || crypto.randomUUID();
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: 'Verwacht: { client_id: string, mode: "quick" | "full" }' }, { status: 400 });
  }

  try {
    await createProgressJob(supabase, {
      jobId,
      clientId,
      jobType: "second_opinion",
      initialMessage: "Second opinion wordt voorbereid...",
      metadata: { mode },
    });
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "init",
      message: "Second opinion run initialiseren...",
    });

    // 1. Create run record with status=running
    const { data: runRow, error: insertErr } = await supabase
      .from("second_opinion_runs")
      .insert({
        client_id: clientId,
        mode,
        status: "running",
      })
      .select("id")
      .single();

    if (insertErr || !runRow) {
      await markProgressFailed(supabase, {
        jobId,
        errorMessage: `Kon run niet aanmaken: ${insertErr?.message}`,
      });
      return Response.json({ error: `Kon run niet aanmaken: ${insertErr?.message}` }, { status: 500 });
    }

    const runId = runRow.id;

    // 2. Run the audit
    const result = await runSecondOpinionAudit(supabase, clientId, mode, async (phaseKey, message) => {
      await updateProgressPhase(supabase, { jobId, phaseKey, message });
    });

    // 2b. Schrijf de Onvoldoende-bevindingen als pending voorstellen naar de goedkeuringswachtrij.
    await saveAuditFindingsAsHypotheses(supabase, result.rows, { clientId, analysisId: runId });

    // 3. Ensure "Second Opinion" folder exists in client_folders
    const { data: existingFolder } = await supabase
      .from("client_folders")
      .select("id")
      .eq("client_id", clientId)
      .eq("name", "Second Opinion")
      .maybeSingle();

    if (!existingFolder) {
      await supabase.from("client_folders").insert({ client_id: clientId, name: "Second Opinion" });
    }

    // 4. Generate PDF and save to Supabase Storage + client_files
    let pdfStoragePath: string | null = null;
    let fileId: string | null = null;
    try {
      await updateProgressPhase(supabase, {
        jobId,
        phaseKey: "build_pdf",
        message: "Second opinion PDF opbouwen...",
      });
      const modeLabel = mode === "quick" ? "Snelle-Audit" : "Volledige-Audit";
      const dateStr = new Date().toISOString().split("T")[0];
      const filename = `Second-Opinion-${modeLabel}-${dateStr}.pdf`;
      const storagePath = `${clientId}/Second Opinion/${Date.now()}-${filename}`;

      const pdfBuffer = await renderSecondOpinionPdf({
        clientName,
        mode,
        rows: result.rows,
        summaries: result.sectionSummaries,
        generatedAt: result.completedAt ?? new Date().toISOString(),
      });

      await supabase.storage.from("client-files").upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

      const { data: fileRow } = await supabase
        .from("client_files")
        .insert({
          client_id: clientId,
          folder: "Second Opinion",
          file_name: filename,
          file_size: pdfBuffer.length,
          content_type: "application/pdf",
          storage_path: storagePath,
        })
        .select("id")
        .single();

      pdfStoragePath = storagePath;
      fileId = fileRow?.id ?? null;
    } catch (pdfErr) {
      logger.error("[second-opinion] PDF generatie mislukt:", pdfErr instanceof Error ? pdfErr.message : pdfErr);
    }

    // 5. Update run with results + PDF reference
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "save_outputs",
      message: "Second opinion resultaten opslaan...",
    });
    await supabase
      .from("second_opinion_runs")
      .update({
        status: result.status,
        completed_at: result.completedAt,
        results: result.rows,
        section_summaries: result.sectionSummaries,
        pdf_storage_path: pdfStoragePath,
        file_id: fileId,
        error: result.error,
      })
      .eq("id", runId);

    await markProgressCompleted(supabase, {
      jobId,
      message: pdfStoragePath
        ? "Second opinion en PDF gereed."
        : "Second opinion gereed. PDF kon niet worden opgeslagen.",
      metadata: {
        run_id: runId,
        mode,
        pdf_saved: pdfStoragePath !== null,
      },
      partialOutputExists: pdfStoragePath === null,
    });

    return Response.json({
      jobId,
      runId,
      mode,
      status: result.status,
      itemsEvaluated: result.rows.length,
      supported: result.rows.filter((r) => r.supportStatus === "supported").length,
      partial: result.rows.filter((r) => r.supportStatus === "partial").length,
      unsupported: result.rows.filter((r) => r.supportStatus === "unsupported").length,
      sectionSummaries: result.sectionSummaries,
      pdfSaved: pdfStoragePath !== null,
    });
  } catch (err) {
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "Onbekende fout",
    });
    return Response.json({ error: err instanceof Error ? err.message : "Onbekende fout" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });

  const { data, error } = await supabase
    .from("second_opinion_runs")
    .select("id, mode, status, created_at, completed_at, section_summaries, pdf_storage_path, file_id, error")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ runs: data ?? [] });
}

/**
 * PATCH /api/second-opinion — update row overrides for a run.
 * Body: { run_id: string, overrides: Array<{ templateId: number, score: AuditScore, comments: string }> }
 */
export async function PATCH(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  let runId: string;
  let overrides: Array<{ templateId: number; score: AuditScore; comments: string }>;
  try {
    const body = await request.json();
    runId = body.run_id;
    overrides = body.overrides;
    if (!runId || !Array.isArray(overrides)) throw new Error("missing");
  } catch {
    return Response.json({ error: 'Verwacht: { run_id: string, overrides: [{ templateId, score, comments }] }' }, { status: 400 });
  }

  try {
    // Fetch current run
    const { data: run, error: fetchErr } = await supabase
      .from("second_opinion_runs")
      .select("results")
      .eq("id", runId)
      .single();

    if (fetchErr || !run) return Response.json({ error: "Run niet gevonden" }, { status: 404 });

    const rows = (run.results ?? []) as AuditRowResult[];
    const now = new Date().toISOString();

    // Apply overrides
    const overrideMap = new Map(overrides.map((o) => [o.templateId, o]));
    const updatedRows = rows.map((row) => {
      const override = overrideMap.get(row.templateId);
      if (!override) return row;

      return {
        ...row,
        overrideScore: override.score,
        overrideComments: override.comments,
        overrideAt: now,
        isOverridden: true,
      };
    });

    // Recalculate summaries using final scores
    const finalSummaries = calculateFinalSummaries(updatedRows);

    // Persist
    const { error: updateErr } = await supabase
      .from("second_opinion_runs")
      .update({
        results: updatedRows,
        section_summaries: finalSummaries,
      })
      .eq("id", runId);

    if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 });

    return Response.json({
      runId,
      rowsUpdated: overrides.length,
      sectionSummaries: finalSummaries,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Onbekende fout" }, { status: 500 });
  }
}
