import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { renderSecondOpinionPdf } from "@/lib/second-opinion/pdf-renderer";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";

/**
 * GET /api/second-opinion/pdf?run_id=xxx&client_name=yyy
 *
 * Generates and returns a PDF for a completed second opinion run.
 * Also saves the PDF to Supabase Storage and links it to the Second Opinion folder.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const runId = request.nextUrl.searchParams.get("run_id");
  const clientName = request.nextUrl.searchParams.get("client_name") || "Onbekend";
  const jobId = request.nextUrl.searchParams.get("job_id") || crypto.randomUUID();
  if (!runId) return Response.json({ error: "run_id parameter vereist" }, { status: 400 });

  // Fetch the run
  const { data: run, error } = await supabase
    .from("second_opinion_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (error || !run) return Response.json({ error: "Run niet gevonden" }, { status: 404 });
  if (run.status !== "completed") return Response.json({ error: "Run is niet afgerond" }, { status: 400 });

  await createProgressJob(supabase, {
    jobId,
    clientId: run.client_id as string,
    jobType: "pdf_generation",
    initialMessage: "Second opinion PDF wordt voorbereid...",
    metadata: { source: "second_opinion", run_id: runId },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "fetch_inputs",
    message: "Second opinion resultaten ophalen...",
  });

  try {
    // Generate PDF
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "render_pdf",
      message: "Second opinion PDF opbouwen...",
    });
    const pdfBuffer = await renderSecondOpinionPdf({
      clientName,
      mode: run.mode,
      rows: run.results ?? [],
      summaries: run.section_summaries ?? [],
      generatedAt: run.completed_at || run.created_at,
    });

    // Save to Supabase Storage
    const clientId = run.client_id;
    const timestamp = Date.now();
    const modeLabel = run.mode === "quick" ? "Snelle-Audit" : "Volledige-Audit";
    const filename = `Second-Opinion-${modeLabel}-${new Date().toISOString().split("T")[0]}.pdf`;
    const storagePath = `${clientId}/Second Opinion/${timestamp}-${filename}`;

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "store_artifact",
      message: "Second opinion PDF opslaan...",
    });
    await supabase.storage.from("client-files").upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

    // Ensure Second Opinion folder exists
    const { data: existingFolder } = await supabase
      .from("client_folders")
      .select("id")
      .eq("client_id", clientId)
      .eq("name", "Second Opinion")
      .maybeSingle();

    if (!existingFolder) {
      await supabase.from("client_folders").insert({ client_id: clientId, name: "Second Opinion" });
    }

    // Insert file reference
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

    // Update run with PDF reference
    await supabase.from("second_opinion_runs").update({
      pdf_storage_path: storagePath,
      file_id: fileRow?.id ?? null,
    }).eq("id", runId);

    await markProgressCompleted(supabase, {
      jobId,
      message: "Second opinion PDF gereed.",
      metadata: { storage_path: storagePath, run_id: runId },
    });

    // Return PDF
    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "PDF generatie mislukt",
    });
    return Response.json({ error: err instanceof Error ? err.message : "PDF generatie mislukt" }, { status: 500 });
  }
}
