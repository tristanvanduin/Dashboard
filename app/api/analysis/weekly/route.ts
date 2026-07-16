import { NextRequest } from "next/server";
import { buildWeeklyPrompt, WEEKLY_FINDINGS_SYSTEM, WEEKLY_RECS_SYSTEM } from "@/lib/prompts/sop-prompts";
import {
  getSupabase,
  getOpenRouterKey,
  fetchClientContext,
  runAnalysis,
  daysAgo,
  fmt,
} from "@/lib/analysis/helpers";
import { buildEnrichmentContext } from "@/lib/analysis/enrichment";
import { computeAnalysisTargets } from "@/lib/analysis/compute-targets";
import { sanitizeOutput } from "@/lib/analysis/sanitize";
import { computeDataReliability } from "@/lib/analysis/data-reliability";
import { checkDataFreshness } from "@/lib/sync/freshness";
import { extractStructuredData } from "@/lib/analysis/extract-structured";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  let jobId = crypto.randomUUID();
  try {
    const body = await request.json();
    clientId = body.client_id;
    jobId = body.job_id || crypto.randomUUID();
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 });
  }

  try {
    await createProgressJob(supabase, {
      jobId,
      clientId,
      jobType: "weekly_sop",
      initialMessage: "Wekelijkse analyse wordt voorbereid...",
      metadata: { sop_type: "weekly" },
    });
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "fetch_data",
      message: "Wekelijkse performance- en waste-data ophalen...",
    });
    const periodStart = daysAgo(14);
    const periodEnd = fmt(new Date());

    // Phase 1: Fetch data + client context + forecast targets in parallel
    const [
      weeklyResult, searchResult, campaignResult, accountMonthlyResult,
      clientCtx, targetResult,
    ] = await Promise.all([
      supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).gte("week_start", periodStart).order("week_start"),
      supabase.from("ads_search_terms_wasteful").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(500),
      supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).gte("month", daysAgo(60)).order("month"),
      supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).gte("month", daysAgo(90)).order("month"),
      fetchClientContext(supabase, clientId),
      computeAnalysisTargets(supabase, clientId),
    ]);

    const { goalsSection, accountType } = clientCtx;

    const weeklyData = weeklyResult.data ?? [];
    if (weeklyData.length === 0) {
      const freshness = await checkDataFreshness(supabase, clientId, ["ads_account_weekly"]);
      await markProgressFailed(supabase, {
        jobId,
        errorMessage: freshness.message,
      });
      return Response.json({
        error: freshness.message,
        freshnessStatus: freshness.freshnessStatus,
        lastSyncAt: freshness.lastSyncAt,
        action: "Sync de data via POST /api/sync",
      }, { status: 404 });
    }

    // Phase 2: Build enrichment context via matrix (parallel)
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "enrich_context",
      message: "Enrichment en databetrouwbaarheid opbouwen...",
    });
    const enrichment = await buildEnrichmentContext({
      supabase,
      clientId,
      accountType,
      sopType: "weekly",
      analysisDate: periodEnd,
    });

    // Format monthly targets from forecast engine
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const targetText = targetResult
      ? `\n\n## Maandtargets (berekend door forecast engine)
Huidige maand (${["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"][currentMonth - 1]}): verwacht ${targetResult.monthlyExpected[currentMonth - 1]?.conversions ?? "?"} conversies, €${targetResult.monthlyExpected[currentMonth - 1]?.revenue ?? "?"} omzet
BELANGRIJK: Gebruik dit maandtarget als benchmark, NIET het jaardoel.`
      : "";

    // Compute data reliability using CORRECT account monthly data
    const { data: lagSettings } = await supabase.from("client_settings").select("conversion_lag_days").eq("client_id", clientId).maybeSingle();
    const accountMonthlyData = accountMonthlyResult.data ?? [];
    const weeklyReliability = computeDataReliability({
      accountMonthly: accountMonthlyData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }>,
      campaignMonthly: (campaignResult.data ?? []) as Array<{ campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number }>,
      conversionLagDays: (lagSettings?.conversion_lag_days as number) ?? 3,
      lastCompleteMonth: new Date().getMonth() === 0 ? 12 : new Date().getMonth(),
      hasKpiTargets: !!goalsSection,
    });
    const reliabilityText = `\n\n${weeklyReliability.promptContext}`;

    const systemPrompt = buildWeeklyPrompt(goalsSection, accountType);

    const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";

    const userMessage = `Voer een wekelijkse health check uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}

## Account Performance (wekelijks, laatste 14 dagen)
\`\`\`json
${JSON.stringify(weeklyData, null, 2)}
\`\`\`

## Wasteful Search Terms (laatste 30 dagen, top 30 op cost)
\`\`\`json
${JSON.stringify(searchResult.data ?? [], null, 2)}
\`\`\`

## Campaign Performance (laatste 2 maanden, voor budget/spend check)
\`\`\`json
${JSON.stringify(campaignResult.data ?? [], null, 2)}
\`\`\`${enrichment.leadingIndicators}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}

Voer nu de wekelijkse health check uit. Focus alleen op anomalies en bleeders die directe actie vereisen.`;

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "run_analysis",
      message: "Wekelijkse SOP-analyse uitvoeren...",
    });
    const result = await runAnalysis({
      supabase,
      apiKey,
      clientId,
      sopType: "weekly",
      systemPrompt,
      userMessage,
      periodStart,
      periodEnd,
    });

    // Sanitize final output (heading dedup + whitespace cleanup)
    result.output = sanitizeOutput(result.output);

    // ── Structured extraction (findings + recommendations + tasks) ──
    const extraction = await extractStructuredData({
      supabase,
      apiKey,
      clientId,
      sopType: "weekly",
      analysisDate: result.analysisDate,
      periodStart,
      periodEnd,
      analysisOutput: result.output,
      findingsSystemPrompt: WEEKLY_FINDINGS_SYSTEM,
      recsSystemPrompt: WEEKLY_RECS_SYSTEM,
      stepOffset: 1, // findings = step 2, recs = step 3
      analysisId: null, // weekly uses runAnalysis, not tracked by analysis_id
      reliability: weeklyReliability,
      onPhase: async (phaseKey, message) => {
        await updateProgressPhase(supabase, { jobId, phaseKey, message });
      },
    });

    await markProgressCompleted(supabase, {
      jobId,
      message: "Wekelijkse SOP-analyse gereed.",
      metadata: {
        analysis_date: result.analysisDate,
        sop_type: "weekly",
        findings: extraction.findings.length,
        recommendations: extraction.recommendations.length,
        tasks: extraction.tasks.length,
      },
    });

    return Response.json({
      jobId,
      ...result,
      structured: {
        findings: extraction.findings.length,
        recommendations: extraction.recommendations.length,
        tasks: extraction.tasks.length,
        saved: extraction.saved,
        findingsParseOk: extraction.findingsParseOk,
        recsParseOk: extraction.recsParseOk,
      },
    });
  } catch (err) {
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "Onbekende fout",
    });
    return Response.json({ error: err instanceof Error ? err.message : "Onbekende fout" }, { status: 500 });
  }
}
