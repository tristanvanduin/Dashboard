import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { renderSopPdf, type SopPdfProps } from "@/lib/analysis/sop-pdf-renderer";
import {
  validateFinalSopSynthesis,
  validateMonthlyDeliverableCompleteness,
  validateRenderedFinalSopMarkdown,
  type FinalSopSynthesis,
  type OperatingDetailLayer,
} from "@/lib/analysis/monthly-structured";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";

/**
 * GET /api/analysis/pdf?client_id=xxx&sop_type=weekly|biweekly|monthly&client_name=yyy
 *
 * Generates and returns a PDF for the most recent SOP analysis.
 * Also saves the PDF to Supabase Storage and links it in client_files.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientId = request.nextUrl.searchParams.get("client_id");
  const sopType = request.nextUrl.searchParams.get("sop_type") as "weekly" | "biweekly" | "monthly" | null;
  const clientName = request.nextUrl.searchParams.get("client_name") || clientId || "Onbekend";
  const jobId = request.nextUrl.searchParams.get("job_id") || crypto.randomUUID();

  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });
  if (!sopType || !["weekly", "biweekly", "monthly"].includes(sopType)) {
    return Response.json({ error: "sop_type parameter vereist (weekly|biweekly|monthly)" }, { status: 400 });
  }

  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "pdf_generation",
    initialMessage: "SOP PDF wordt voorbereid...",
    metadata: { source: "sop", sop_type: sopType },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "fetch_inputs",
    message: "SOP output en structured data ophalen...",
  });

  // Fetch the most recent analysis output
  if (sopType === "monthly") {
    const { data: qualityGateRow } = await supabase
      .from("sop_analysis_output")
      .select("output, analysis_date, created_at")
      .eq("client_id", clientId)
      .eq("sop_type", sopType)
      .eq("section", "quality_gate_monthly_v2")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const parsedQualityGate = (() => {
      if (typeof qualityGateRow?.output !== "string") return qualityGateRow?.output;
      try {
        return JSON.parse(qualityGateRow.output);
      } catch {
        return null;
      }
    })();
    if (parsedQualityGate && typeof parsedQualityGate === "object" && parsedQualityGate !== null && "passed" in parsedQualityGate && parsedQualityGate.passed === false) {
      const blockingReasons = Array.isArray((parsedQualityGate as { blocking_reasons?: unknown }).blocking_reasons)
        ? ((parsedQualityGate as { blocking_reasons: unknown[] }).blocking_reasons.filter((item): item is string => typeof item === "string"))
        : [];
      const errorMessage = blockingReasons.length > 0
        ? `Monthly PDF export geblokkeerd: ${blockingReasons.join("; ")}`
        : "Monthly PDF export geblokkeerd door quality gate.";
      await markProgressFailed(supabase, {
        jobId,
        errorMessage,
      });
      return Response.json({ error: errorMessage }, { status: 409 });
    }
  }

  const { data: analysis, error: analysisErr } = await supabase
    .from("sop_analysis_output")
    .select("*")
    .eq("client_id", clientId)
    .eq("sop_type", sopType)
    .eq("section", "full")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (analysisErr || !analysis) {
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: `Geen ${sopType} analyse gevonden voor deze client`,
    });
    return Response.json({ error: `Geen ${sopType} analyse gevonden voor deze client` }, { status: 404 });
  }

  try {
    // Build PDF props
    const pdfProps: SopPdfProps = {
      clientName,
      clientId,
      sopType,
      analysisDate: analysis.analysis_date,
      periodStart: analysis.period_start || analysis.analysis_date,
      periodEnd: analysis.period_end || analysis.analysis_date,
      fullOutput: analysis.output || "",
    };

    // For monthly: also fetch structured data (findings, recommendations, tasks)
    if (sopType === "monthly") {
      const [structuredRes, findingsRes, recsRes, tasksRes] = await Promise.all([
        supabase
          .from("sop_analysis_output")
          .select("output")
          .eq("client_id", clientId)
          .eq("sop_type", sopType)
          .eq("section", "structured_monthly_v2")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("sop_insights")
          .select("title, description, severity, insight_type, affected_entity, affected_entity_type, metric, current_value, previous_value, change_pct, action_required")
          .eq("client_id", clientId)
          .eq("analysis_date", analysis.analysis_date)
          .order("severity"),
        supabase
          .from("sop_recommendations")
          .select("hypothesis, expected_result, measurement_metric, timeframe, rationale, ice_impact, ice_confidence, ice_ease, ice_total, status")
          .eq("client_id", clientId)
          .eq("analysis_date", analysis.analysis_date)
          .order("ice_total", { ascending: false }),
        supabase
          .from("sop_tasks")
          .select("title, description, action_type, priority, frequency, due_date, affected_campaign, status")
          .eq("client_id", clientId)
          .eq("analysis_date", analysis.analysis_date)
          .order("priority"),
      ]);

      const rawStructuredOutput = structuredRes.data?.output;
      const parsedStructuredOutput =
        typeof rawStructuredOutput === "string"
          ? JSON.parse(rawStructuredOutput)
          : rawStructuredOutput;
      const structuredPayload = parsedStructuredOutput && typeof parsedStructuredOutput === "object"
        ? parsedStructuredOutput as {
            final_sop?: FinalSopSynthesis;
            operating_detail?: OperatingDetailLayer;
            deliverable_markdown?: string;
            coverage_markdown?: string;
            appendix_markdown?: string;
            consistency_counts?: {
              display_findings_count?: number;
              critical_or_high_findings_count?: number;
            };
          }
        : null;
      const finalSop = structuredPayload?.final_sop;
      const operatingDetail = structuredPayload?.operating_detail;
      const deliverableMarkdown = structuredPayload?.deliverable_markdown || [finalSop?.markdown, operatingDetail?.markdown].filter(Boolean).join("\n\n");
      if (!finalSop) {
        throw new Error("Structured monthly final_sop ontbreekt; PDF export geweigerd.");
      }
      const deliverableErrors = validateMonthlyDeliverableCompleteness({
        final_sop: finalSop,
        operating_detail: operatingDetail,
        executive_markdown: finalSop.markdown,
        deliverable_markdown: deliverableMarkdown,
      });
      const finalSopErrors = [
        ...validateFinalSopSynthesis(finalSop),
        ...validateRenderedFinalSopMarkdown(finalSop.markdown).errors,
      ];
      if (finalSopErrors.length > 0 || deliverableErrors.length > 0) {
        throw new Error(`Structured monthly deliverable ongeldig voor export: ${[...finalSopErrors, ...deliverableErrors].join("; ")}`);
      }

      pdfProps.fullOutput = deliverableMarkdown || finalSop.markdown;
      pdfProps.finalSop = finalSop;
      pdfProps.operatingDetail = operatingDetail;
      pdfProps.coverageMarkdown = structuredPayload?.coverage_markdown;
      pdfProps.appendixMarkdown = structuredPayload?.appendix_markdown;
      pdfProps.executiveCounts = {
        displayFindingsCount: structuredPayload?.consistency_counts?.display_findings_count ?? finalSop.supporting_evidence.length,
        criticalOrHighCount: structuredPayload?.consistency_counts?.critical_or_high_findings_count ?? 1,
      };
      pdfProps.findings = (findingsRes.data ?? []) as SopPdfProps["findings"];
      pdfProps.recommendations = (recsRes.data ?? []) as SopPdfProps["recommendations"];
      pdfProps.tasks = (tasksRes.data ?? []) as SopPdfProps["tasks"];
    }

    // Generate PDF
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "render_pdf",
      message: "SOP PDF opbouwen...",
    });
    const pdfBuffer = await renderSopPdf(pdfProps);

    // Save to Supabase Storage
    const typeLabel: Record<string, string> = {
      weekly: "Wekelijks",
      biweekly: "Tweewekelijks",
      monthly: "Maandelijks",
    };
    const filename = `SOP-${typeLabel[sopType]}-${analysis.analysis_date}.pdf`;
    const storagePath = `${clientId}/SOP's/${Date.now()}-${filename}`;

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "store_artifact",
      message: "SOP PDF opslaan...",
    });
    await supabase.storage.from("client-files").upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

    // Ensure SOP's folder exists
    const { data: existingFolder } = await supabase
      .from("client_folders")
      .select("id")
      .eq("client_id", clientId)
      .eq("name", "SOP's")
      .maybeSingle();

    if (!existingFolder) {
      await supabase.from("client_folders").insert({ client_id: clientId, name: "SOP's" });
    }

    // Insert file reference
    await supabase.from("client_files").insert({
      client_id: clientId,
      folder: "SOP's",
      file_name: filename,
      file_size: pdfBuffer.length,
      content_type: "application/pdf",
      storage_path: storagePath,
    });

    await markProgressCompleted(supabase, {
      jobId,
      message: "SOP PDF gereed.",
      metadata: { storage_path: storagePath, sop_type: sopType },
    });

    // Return PDF
    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[sop-pdf] Generation failed:", err);
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "PDF generatie mislukt",
    });
    return Response.json({ error: err instanceof Error ? err.message : "PDF generatie mislukt" }, { status: 500 });
  }
}
