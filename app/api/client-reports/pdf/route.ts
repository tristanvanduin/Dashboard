import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { renderReportPdf, type ReportPdfProps } from "@/lib/client-reports/pdf-renderer";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";
import { logger } from "@/lib/logger";

/**
 * GET /api/client-reports/pdf?report_id=xxx&client_name=yyy
 *
 * Generates PDF for a saved client report, saves to Rapportages folder.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const reportId = request.nextUrl.searchParams.get("report_id");
  const clientName = request.nextUrl.searchParams.get("client_name") || "Onbekend";
  const jobId = request.nextUrl.searchParams.get("job_id") || crypto.randomUUID();
  if (!reportId) return Response.json({ error: "report_id parameter vereist" }, { status: 400 });

  const { data: report, error } = await supabase
    .from("client_reports")
    .select("*")
    .eq("id", reportId)
    .single();

  if (error || !report) return Response.json({ error: "Rapport niet gevonden" }, { status: 404 });

  const clientId = report.client_id as string;
  const reportMonth = report.report_month as number;
  const reportYear = report.report_year as number;
  const MONTH_NAMES = ["Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"];
  const monthLabel = MONTH_NAMES[reportMonth - 1] ?? `Maand ${reportMonth}`;

  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "pdf_generation",
    initialMessage: "Rapport PDF wordt voorbereid...",
    metadata: { source: "client_report", report_id: reportId },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "fetch_inputs",
    message: "Rapport, logo's en metadata ophalen...",
  });

  try {
    // Fetch logo URLs
    let rmLogoUrl: string | undefined;
    let clientLogoUrl: string | undefined;

    // RM logo from public directory
    const rmLogoPath = process.cwd() + "/public/images/ranking-masters-logo.png";
    try {
      const fs = await import("fs");
      if (fs.existsSync(rmLogoPath)) {
        const buf = fs.readFileSync(rmLogoPath);
        rmLogoUrl = `data:image/png;base64,${buf.toString("base64")}`;
      }
    } catch { /* no logo file */ }

    // Client logo from Supabase Storage
    const { data: logoData } = await supabase.storage
      .from("client-files")
      .createSignedUrl(`${clientId}/logo.png`, 300);
    if (logoData?.signedUrl) clientLogoUrl = logoData.signedUrl;

    // The sections column contains the full ReportData structure
    const rd = report.sections as Record<string, unknown>;

    const pdfProps: ReportPdfProps = {
      clientName,
      title: (rd.title as string) ?? report.title as string,
      reportMonth: monthLabel,
      reportYear,
      generatedAt: report.created_at as string,
      kpiCards: (rd.kpiCards as ReportPdfProps["kpiCards"]) ?? [],
      metricSections: (rd.metricSections as ReportPdfProps["metricSections"]) ?? [],
      actionSection: (rd.actionSection as ReportPdfProps["actionSection"]) ?? { heading: "", body: "" },
      planningSection: (rd.planningSection as ReportPdfProps["planningSection"]) ?? { heading: "", body: "" },
      summaryHeadline: rd.summaryHeadline as string | undefined,
      summarySubtitle: rd.summarySubtitle as string | undefined,
      countrySections: rd.countrySections as ReportPdfProps["countrySections"],
      rmLogoUrl,
      clientLogoUrl,
    };

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "render_pdf",
      message: "Rapport PDF opbouwen...",
    });
    const pdfBuffer = await renderReportPdf(pdfProps);

    // Save to Rapportages folder
    const safeName = clientName.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").toLowerCase();
    const filename = `${safeName}-rapport-${reportYear}-${String(reportMonth).padStart(2, "0")}.pdf`;
    const storagePath = `${clientId}/Rapportages/${Date.now()}-${filename}`;

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "store_artifact",
      message: "Rapport PDF opslaan...",
    });
    await supabase.storage.from("client-files").upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

    // Ensure folder exists
    const { data: existingFolder } = await supabase
      .from("client_folders")
      .select("id")
      .eq("client_id", clientId)
      .eq("name", "Rapportages")
      .maybeSingle();

    if (!existingFolder) {
      await supabase.from("client_folders").insert({ client_id: clientId, name: "Rapportages" });
    }

    // Insert file reference
    await supabase.from("client_files").insert({
      client_id: clientId,
      folder: "Rapportages",
      file_name: filename,
      file_size: pdfBuffer.length,
      content_type: "application/pdf",
      storage_path: storagePath,
    });

    await markProgressCompleted(supabase, {
      jobId,
      message: "Rapport PDF gereed.",
      metadata: { storage_path: storagePath, report_id: reportId },
    });

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    logger.error("[client-reports/pdf] Failed:", err);
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "PDF mislukt",
    });
    return Response.json({ error: err instanceof Error ? err.message : "PDF mislukt" }, { status: 500 });
  }
}
