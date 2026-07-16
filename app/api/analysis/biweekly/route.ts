import { NextRequest } from "next/server";
import { buildBiWeeklyPrompt, BIWEEKLY_FINDINGS_SYSTEM, BIWEEKLY_RECS_SYSTEM } from "@/lib/prompts/sop-prompts";
import {
  getSupabase,
  getOpenRouterKey,
  fetchClientContext,
  runAnalysis,
  monthsAgo,
  fmt,
} from "@/lib/analysis/helpers";
import { buildEnrichmentContext } from "@/lib/analysis/enrichment";
import { computeAnalysisTargets } from "@/lib/analysis/compute-targets";
import { computeDataReliability } from "@/lib/analysis/data-reliability";
import { sanitizeOutput } from "@/lib/analysis/sanitize";
import { checkDataFreshness } from "@/lib/sync/freshness";
import { computeComparisonFacts, formatComparisonFacts } from "@/lib/analysis/comparison-facts";
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
      jobType: "biweekly_sop",
      initialMessage: "Bi-weekly analyse wordt voorbereid...",
      metadata: { sop_type: "biweekly" },
    });
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "fetch_data",
      message: "Account-, campagne- en weekdata ophalen...",
    });
    const periodStart = monthsAgo(3);
    const periodEnd = fmt(new Date());

    // Phase 1: Fetch data + client context + forecast targets in parallel
    const [
      accountResult, campaignResult, weeklyResult, adgroupResult,
      monthlyOutputResult, clientCtx, targetResult,
    ] = await Promise.all([
      supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).order("month"),
      supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).order("month"),
      supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).gte("week_start", monthsAgo(1)).order("week_start"),
      supabase.from("ads_adgroup_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).order("month"),
      supabase.from("sop_analysis_output").select("output, analysis_date").eq("client_id", clientId).eq("sop_type", "monthly").order("analysis_date", { ascending: false }).limit(1).maybeSingle(),
      fetchClientContext(supabase, clientId),
      computeAnalysisTargets(supabase, clientId),
    ]);

    const { goalsSection, accountType } = clientCtx;

    const accountData = accountResult.data ?? [];
    if (accountData.length === 0) {
      const freshness = await checkDataFreshness(supabase, clientId);
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
      message: "Context, benchmarks en change history verrijken...",
    });
    const enrichment = await buildEnrichmentContext({
      supabase,
      clientId,
      accountType,
      sopType: "biweekly",
      analysisDate: periodEnd,
    });

    const previousMonthlyOutput = monthlyOutputResult.data?.output
      ?? "Geen eerdere maandelijkse analyse beschikbaar. Voer de analyse uit op basis van de data zonder referentie aan eerdere bevindingen.";

    // Format monthly targets from forecast engine (same as monthly route)
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const targetText = targetResult
      ? `\n\n## Maandtargets (berekend door forecast engine)
${targetResult.monthlyExpected.map((t) => `- Maand ${t.month}: verwacht ${t.conversions} conversies, €${t.revenue} omzet, €${t.adSpend} spend`).join("\n")}
Huidige maand: ${currentMonth} (${["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"][currentMonth - 1]})
Verwacht deze maand: ${targetResult.monthlyExpected[currentMonth - 1]?.conversions ?? "?"} conversies
BELANGRIJK: Gebruik deze maandtargets als benchmark, NIET het jaardoel.`
      : "";

    // Compute data reliability
    const { data: lagSettings } = await supabase.from("client_settings").select("conversion_lag_days").eq("client_id", clientId).maybeSingle();
    const biweeklyReliability = computeDataReliability({
      accountMonthly: accountData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }>,
      campaignMonthly: (campaignResult.data ?? []) as Array<{ campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number }>,
      conversionLagDays: (lagSettings?.conversion_lag_days as number) ?? 3,
      lastCompleteMonth: currentMonth === 1 ? 12 : currentMonth - 1,
      hasKpiTargets: !!goalsSection,
    });
    const reliabilityText = `\n\n${biweeklyReliability.promptContext}`;

    // Compute comparison facts for biweekly (same as monthly — uses account monthly data)
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const { data: bwClientSector } = await supabase.from("client_settings").select("sector, aov_segment, kpi_targets").eq("client_id", clientId).maybeSingle();
    const bwSectorKey = bwClientSector?.sector || (accountType.startsWith("ecommerce") ? "ecommerce_mid_ticket" : accountType.startsWith("leadgen") ? "leadgen_generiek" : null);
    let bwBenchmarkRows: Array<{ metric: string; low: number; median: number; high: number; top10: number }> = [];
    if (bwSectorKey) {
      const { data: bmData } = await supabase.from("benchmark_sectors").select("metric, low, median, high, top10").eq("sector", bwSectorKey);
      bwBenchmarkRows = (bmData ?? []) as typeof bwBenchmarkRows;
    }
    const kpiRaw = bwClientSector?.kpi_targets as Record<string, number> | null;
    const bwComparisonFacts = computeComparisonFacts({
      accountData: accountData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; ctr: number; avg_cpc: number; conversion_rate: number; cost_per_conversion: number; roas?: number }>,
      monthlyTargets: targetResult?.monthlyExpected ?? null,
      kpiTargets: kpiRaw ? { roasTarget: kpiRaw.roasTarget ?? 0, cpaTarget: kpiRaw.cpaTarget ?? 0 } : null,
      sectorBenchmarks: bwBenchmarkRows,
      lastCompleteMonth: lastMonth,
    });
    const bwComparisonText = formatComparisonFacts(bwComparisonFacts);

    const systemPrompt = buildBiWeeklyPrompt(goalsSection, accountType, previousMonthlyOutput);

    const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";

    const userMessage = `Voer een bi-weekly check-in uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}

${bwComparisonText}

## Account Performance (maandelijks, laatste 3 maanden)
\`\`\`json
${JSON.stringify(accountData, null, 2)}
\`\`\`

## Account Performance (wekelijks, laatste 30 dagen)
\`\`\`json
${JSON.stringify(weeklyResult.data ?? [], null, 2)}
\`\`\`

## Campaign Performance (maandelijks, laatste 3 maanden)
\`\`\`json
${JSON.stringify(campaignResult.data ?? [], null, 2)}
\`\`\`

## Ad Group Performance (laatste 3 maanden)
\`\`\`json
${JSON.stringify(adgroupResult.data ?? [], null, 2)}
\`\`\`${enrichment.hypothesisTracking}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}

Voer nu de bi-weekly check-in uit volgens alle stappen. Koppel bevindingen terug aan de maandanalyse.
${enrichment.hypothesisTracking ? "\nAls er uitgevoerde hypotheses zijn die nog niet gemeten zijn, beoordeel dan in stap 2 of het verwachte effect al zichtbaar is. Formuleer: 'Hypothese [X] toont [wel/geen/te vroeg] meetbaar effect: [KPI] [steeg/daalde] met X% sinds implementatie op [datum].'" : ""}`;

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "run_analysis",
      message: "Bi-weekly SOP-analyse uitvoeren...",
    });
    const result = await runAnalysis({
      supabase,
      apiKey,
      clientId,
      sopType: "biweekly",
      systemPrompt,
      userMessage,
      periodStart,
      periodEnd,
    });

    // Sanitize final output (heading dedup + whitespace cleanup)
    result.output = sanitizeOutput(result.output);

    // ── Structured extraction (findings + recommendations + tasks) ──
    // Extract TOP 3 BEVINDINGEN from analysis text
    const topFindings: string[] = [];
    const stepMatches = result.output.matchAll(/TOP 3 BEVINDINGEN STAP (\d+):\s*([\s\S]*?)(?:\n\n|\n---|$)/g);
    for (const match of stepMatches) {
      topFindings.push(`Stap ${match[1]}: ${match[2].trim()}`);
    }

    const extraction = await extractStructuredData({
      supabase,
      apiKey,
      clientId,
      sopType: "biweekly",
      analysisDate: result.analysisDate,
      periodStart,
      periodEnd,
      analysisOutput: result.output,
      findingsSystemPrompt: BIWEEKLY_FINDINGS_SYSTEM,
      recsSystemPrompt: BIWEEKLY_RECS_SYSTEM,
      stepOffset: 4, // biweekly has 4 text steps, findings = step 5, recs = step 6
      analysisId: null,
      reliability: biweeklyReliability,
      topFindings: topFindings.length > 0 ? topFindings.join("\n") : undefined,
      onPhase: async (phaseKey, message) => {
        await updateProgressPhase(supabase, { jobId, phaseKey, message });
      },
    });

    await markProgressCompleted(supabase, {
      jobId,
      message: "Bi-weekly SOP-analyse gereed.",
      metadata: {
        analysis_date: result.analysisDate,
        sop_type: "biweekly",
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
