# Monthly SOP Complete Source Bundle

Dit document bundelt de relevante code en tekst voor de maandelijkse SOP-pipeline in één bestand.



---

## `app/api/analysis/monthly/route.ts`

```ts
import { NextRequest } from "next/server";
import {
  getSupabase,
  getOpenRouterKey,
  fetchClientContext,
  runStep,
  monthsAgo,
  fmt,
  type StepResult,
  saveAnalysisOutputSection,
} from "@/lib/analysis/helpers";
import {
  buildMonthlyStepPrompt,
  MONTHLY_STEP1_INSTRUCTION,
  MONTHLY_STEP2_INSTRUCTION,
  MONTHLY_STEP3_INSTRUCTION,
  MONTHLY_STEP4_INSTRUCTION,
  MONTHLY_STEP5_INSTRUCTION,
  MONTHLY_STEP6_INSTRUCTION,
  MONTHLY_STEP7_INSTRUCTION,
  MONTHLY_STEP8_INSTRUCTION,
  MONTHLY_STEP9_INSTRUCTION,
  MONTHLY_CONCLUSION_INSTRUCTION,
  MONTHLY_STEP_SIDECAR_SYSTEM,
} from "@/lib/prompts/sop-prompts";
import { aggregateAdGroups } from "@/lib/analysis/aggregate-adgroups";
import { computeAnalysisTargets } from "@/lib/analysis/compute-targets";
import { buildEnrichmentContext } from "@/lib/analysis/enrichment";
import {
  parseFindings,
  type Finding,
} from "@/lib/schema/analysis-schema";
import { sanitizeOutput } from "@/lib/analysis/sanitize";
import { computeComparisonFacts, formatComparisonFacts, computeCampaignMomFacts, computeAdGroupMomFacts } from "@/lib/analysis/comparison-facts";
import { computeDataReliability, type DataReliabilityAssessment } from "@/lib/analysis/data-reliability";
import { checkDataFreshness } from "@/lib/sync/freshness";
import { canonicalizeFindings, type CoverageDimension } from "@/lib/analysis/canonicalize";
import { buildStructuredMonthlyOutput, type StepFindingSidecar } from "@/lib/analysis/monthly-structured";
import {
  assessSearchTermAgainstProductContext,
  buildProductContext,
  summarizeProductContext,
} from "@/lib/analysis/product-context";
import { syncMerchantProductSnapshots } from "@/lib/api/merchant-products";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";

function getCredentials(): GoogleAdsCredentials | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!developerToken || !clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });
  const googleAdsCredentials = getCredentials();

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
      jobType: "monthly_sop",
      initialMessage: "Analyse wordt voorbereid...",
      metadata: { sop_type: "monthly" },
    });
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "init",
      message: "Analyseperiode en context initialiseren...",
    });

    // Determine analysis period: always analyze up to last complete month
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const analysisYear = currentMonth === 1 ? now.getFullYear() - 1 : now.getFullYear();
    const lastCompleteMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const periodEndDate = new Date(analysisYear, lastCompleteMonth, 0); // last day of previous month
    const periodEnd = fmt(periodEndDate);
    const periodStart = monthsAgo(13);

    // Phase 1: Fetch all Supabase data + client context + forecast targets in parallel
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "fetch_data",
      message: "Analyse-data voor account, campagnes en dimensies ophalen...",
    });
    const [
      accountRes, weeklyRes, campaignRes, adgroupRes, isRes, searchRes,
      accountYoyRes, campaignYoyRes, campaignMetaRes,
      creativeRes, audienceRes, deviceRes, countryRes, countryYoyRes, networkRes, scheduleRes, productRes,
      clientCtx, targetResult,
    ] = await Promise.all([
      supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).lte("month", periodEnd).order("month"),
      supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).gte("week_start", monthsAgo(2)).lte("week_start", periodEnd).order("week_start"),
      supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).lte("month", periodEnd).order("month"),
      supabase.from("ads_adgroup_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).lte("month", periodEnd).order("month"),
      supabase.from("ads_campaign_impression_share").select("*").eq("client_id", clientId).gte("month", monthsAgo(6)).lte("month", periodEnd).order("month"),
      supabase.from("ads_search_terms_wasteful").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(500),
      supabase.from("ads_account_yoy").select("*").eq("client_id", clientId).lte("month", periodEnd).order("month"),
      supabase.from("ads_campaign_yoy").select("*").eq("client_id", clientId).lte("month", periodEnd).order("month"),
      supabase.from("ads_campaign_metadata").select("*").eq("client_id", clientId),
      // Dimensional data for new steps
      supabase.from("ads_creative_performance").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("impressions", { ascending: false }).limit(100),
      supabase.from("ads_audience_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(100),
      supabase.from("ads_device_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("month"),
      supabase.from("ads_country_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(6)).lte("month", periodEnd).order("month"),
      supabase.from("ads_country_yoy").select("*").eq("client_id", clientId).lte("month", periodEnd),
      supabase.from("ads_network_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(100),
      supabase.from("ads_ad_schedule_performance").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(200),
      supabase.from("ads_product_performance_monthly").select("*").eq("client_id", clientId).gte("month", monthsAgo(3)).lte("month", periodEnd).order("cost", { ascending: false }).limit(200),
      fetchClientContext(supabase, clientId),
      computeAnalysisTargets(supabase, clientId),
    ]);

    const { goalsSection, accountType } = clientCtx;

    const accountData = accountRes.data ?? [];
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
        action: freshness.freshnessStatus === "missing"
          ? "Sync de data via POST /api/sync met { client_id: \"...\", }"
          : "Data is aanwezig maar leeg voor de gevraagde periode.",
      }, { status: 404 });
    }

    const weeklyData = weeklyRes.data ?? [];
    const campaignData = campaignRes.data ?? [];
    const adgroupData = adgroupRes.data ?? [];
    const isData = isRes.data ?? [];
    const searchData = searchRes.data ?? [];
    const accountYoyData = accountYoyRes.data ?? [];
    const campaignYoyData = campaignYoyRes.data ?? [];
    const campaignMetaData = campaignMetaRes.data ?? [];
    // Dimensional data
    const creativeData = creativeRes.data ?? [];
    const audienceData = audienceRes.data ?? [];
    const deviceData = deviceRes.data ?? [];
    const countryData = countryRes.data ?? [];
    const countryYoyData = countryYoyRes.data ?? [];
    const networkData = networkRes.data ?? [];
    const scheduleData = scheduleRes.data ?? [];
    const productData = productRes.data ?? [];
    const merchantSync = await syncMerchantProductSnapshots({
      supabase,
      clientId,
      credentials: googleAdsCredentials,
    });

    // Phase 2: Build enrichment context via enrichment matrix (parallel)
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "enrich_context",
      message: "Strategische context, benchmarks en enrichment laden...",
    });
    const enrichment = await buildEnrichmentContext({
      supabase,
      clientId,
      accountType,
      sopType: "monthly",
      analysisDate: periodEnd,
      campaignData,
      campaignMetaData,
    });

    // Format monthly targets from forecast engine
    const targetText = targetResult
      ? `\n\n## Maandtargets (berekend door forecast engine, zelfde als dashboard)
${targetResult.monthlyExpected.map((t) => `- Maand ${t.month}: verwacht ${t.conversions} conversies, €${t.revenue} omzet, €${t.adSpend} spend`).join("\n")}
Analyse maand: ${lastCompleteMonth} (${["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"][lastCompleteMonth - 1]} ${analysisYear})
Verwacht deze maand: ${targetResult.monthlyExpected[lastCompleteMonth - 1]?.conversions ?? "?"} conversies`
      : "";

    // Format campaign metadata for user message
    const activeCampaigns = campaignMetaData.filter((cm: Record<string, unknown>) => {
      const status = String(cm.serving_status || "").toUpperCase();
      return status === "ELIGIBLE" || status === "SERVING" || status === "ENABLED";
    });
    const pausedCampaigns = campaignMetaData.filter((cm: Record<string, unknown>) => {
      const status = String(cm.serving_status || "").toUpperCase();
      return status !== "ELIGIBLE" && status !== "SERVING" && status !== "ENABLED";
    });

    const campaignMetaText = campaignMetaData.length > 0
      ? "\n\n## Campaign Metadata\n" + campaignMetaData.map((cm: Record<string, unknown>) =>
          `- ${cm.campaign_name}: type=${cm.campaign_type}, bidding=${cm.bidding_strategy}, target=${cm.bidding_strategy_target}, budget=€${cm.budget_amount}/dag, status=${cm.serving_status}`
        ).join("\n")
        + (pausedCampaigns.length > 0 ? `\n\nBELANGRIJK: ${pausedCampaigns.length} campagne(s) zijn GEPAUZEERD of VERWIJDERD: ${pausedCampaigns.map((c: Record<string, unknown>) => c.campaign_name).join(", ")}. Doe GEEN aanbevelingen voor gepauzeerde/verwijderde campagnes. Vermeld ze alleen als historische context.` : "")
      : "";

    const shared = { supabase, apiKey, clientId, sopType: "monthly", periodStart, periodEnd };
    const steps: StepResult[] = [];
    const machineSteps: StepResult[] = [];
    const stepSidecars: StepFindingSidecar[] = [];
    const conclusions: string[] = [];
    let partialOutputExists = false;

    async function extractStepSidecar(step: StepResult): Promise<void> {
      const sidecarStep = await runStep({
        ...shared,
        stepNumber: 100 + step.stepNumber,
        stepName: `Structured Step ${step.stepNumber}: ${step.stepName}`,
        systemPrompt: MONTHLY_STEP_SIDECAR_SYSTEM,
        jsonMode: true,
        userMessage: `Extraheer de structured sidecar voor alleen deze stap.

Stapnummer: ${step.stepNumber}
Stapnaam: ${step.stepName}

## Stap output
${step.output}`,
      });
      machineSteps.push(sidecarStep);

      const parsed = parseFindings(sidecarStep.output);
      const findings: Finding[] = parsed.success
        ? parsed.data.map((finding) => ({ ...finding, step: step.stepNumber }))
        : [];

      if (!parsed.success) {
        console.error(`[monthly] Step sidecar parse failed for step ${step.stepNumber}:`, parsed.error);
      }

      stepSidecars.push({
        stepNumber: step.stepNumber,
        stepName: step.stepName,
        narrative: step.output,
        findings,
      });
    }

    // ── STAP 1: Account Performance ───────────────────────────────────
    const accountYoySection = accountYoyData.length > 0
      ? `\n\n## Account YoY Vergelijking (% verschil t.o.v. dezelfde maand vorig jaar)\n\`\`\`json\n${JSON.stringify(accountYoyData, null, 2)}\n\`\`\``
      : "\n\n## Account YoY Vergelijking\nGeen YoY data beschikbaar (minder dan 12 maanden historie).";

    // Dimension availability context (injected once in step 1)
    const dimAvailText = enrichment.dimensionAvailability
      ? `\n\n${enrichment.dimensionAvailability}`
      : "";

    // Pre-compute deterministic comparison facts (prevents LLM arithmetic errors)
    const kpiTargetsRaw = clientCtx.goalsSection ? {
      roasTarget: (await supabase.from("client_settings").select("kpi_targets").eq("client_id", clientId).maybeSingle()).data?.kpi_targets as Record<string, number> | null,
    } : null;
    const roasTarget = (kpiTargetsRaw?.roasTarget as unknown as Record<string, number>)?.roasTarget ?? 0;
    const cpaTarget = (kpiTargetsRaw?.roasTarget as unknown as Record<string, number>)?.cpaTarget ?? 0;

    // Fetch raw sector benchmark data for comparison facts
    // Reuse the same sector resolution as fetchSectorBenchmarks
    const { data: clientSectorData } = await supabase
      .from("client_settings")
      .select("sector, aov_segment")
      .eq("client_id", clientId)
      .maybeSingle();
    const sectorKey = clientSectorData?.sector || (accountType.startsWith("ecommerce") ? "ecommerce_mid_ticket" : accountType.startsWith("leadgen") ? "leadgen_generiek" : null);
    let benchmarkRows: Array<{ metric: string; low: number; median: number; high: number; top10: number }> = [];
    if (sectorKey) {
      const { data: bmData } = await supabase.from("benchmark_sectors").select("metric, low, median, high, top10").eq("sector", sectorKey);
      benchmarkRows = (bmData ?? []) as typeof benchmarkRows;
    }

    const comparisonFacts = computeComparisonFacts({
      accountData: accountData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; ctr: number; avg_cpc: number; conversion_rate: number; cost_per_conversion: number; roas?: number }>,
      monthlyTargets: targetResult?.monthlyExpected ?? null,
      kpiTargets: { roasTarget, cpaTarget },
      sectorBenchmarks: (benchmarkRows ?? []) as Array<{ metric: string; low: number; median: number; high: number; top10: number }>,
      lastCompleteMonth,
    });
    const comparisonFactsText = formatComparisonFacts(comparisonFacts);

    // Compute data reliability assessment
    const { data: settingsForLag } = await supabase
      .from("client_settings")
      .select("conversion_lag_days")
      .eq("client_id", clientId)
      .maybeSingle();

    const reliability = computeDataReliability({
      accountMonthly: accountData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; ctr?: number; avg_cpc?: number; conversion_rate?: number; cost_per_conversion?: number; roas?: number }>,
      campaignMonthly: campaignData as Array<{ campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number }>,
      conversionLagDays: (settingsForLag?.conversion_lag_days as number) ?? 3,
      lastCompleteMonth,
      hasKpiTargets: !!clientCtx.goalsSection,
    });

    const reliabilityText = reliability.promptContext;

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "run_step_1",
      message: "Accountperformance analyseren...",
    });
    const step1 = await runStep({
      ...shared,
      stepNumber: 1,
      stepName: "Account Performance",
      systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, MONTHLY_STEP1_INSTRUCTION),
      userMessage: `Analyseer de account performance voor client "${clientId}".
De analyse draait op de laatste volledige maand (${["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"][lastCompleteMonth - 1]} ${analysisYear}).${enrichment.strategicContext}${targetText}${dimAvailText}

${reliabilityText}

${comparisonFactsText}

## Account Performance (maandelijks, 13 maanden, t/m ${periodEnd})
\`\`\`json
${JSON.stringify(accountData, null, 2)}
\`\`\`

## Account Performance (wekelijks, laatste 8 weken)
\`\`\`json
${JSON.stringify(weeklyData, null, 2)}
\`\`\`${accountYoySection}${enrichment.sectorBenchmarks}${enrichment.leadingIndicators}${enrichment.changeHistory}${enrichment.geoContext}`,
    });
    steps.push(step1);
    conclusions.push(`### Stap 1: Account Performance\n${step1.output}`);
    await extractStepSidecar(step1);

    // ── STAP 2: Campaign Performance ──────────────────────────────────
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "run_step_2",
      message: "Campagneperformance analyseren...",
    });
    const campaignYoySection = campaignYoyData.length > 0
      ? `\n\n## Campaign YoY Vergelijking (% verschil t.o.v. dezelfde maand vorig jaar, per campagne)\n\`\`\`json\n${JSON.stringify(campaignYoyData, null, 2)}\n\`\`\``
      : "";

    // Pre-compute campaign MoM facts so LLM has exact comparison numbers
    const campaignMomText = computeCampaignMomFacts(
      campaignData as Array<{ campaign_name: string; month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }>,
      lastCompleteMonth,
      analysisYear
    );

    const step2 = await runStep({
      ...shared,
      stepNumber: 2,
      stepName: "Campaign Performance",
      systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, MONTHLY_STEP2_INSTRUCTION, conclusions.join("\n\n")),
      userMessage: `Analyseer de campagne performance voor client "${clientId}".
Gebruik de conclusies uit stap 1 als uitgangspunt.${enrichment.strategicContext}

${campaignMomText}

## Campaign Performance (maandelijks, 13 maanden)
\`\`\`json
${JSON.stringify(campaignData, null, 2)}
\`\`\`${campaignMetaText}${campaignYoySection}${enrichment.portfolioAnalysis}${enrichment.pmaxContext}${enrichment.sectorBenchmarks}${enrichment.changeHistory}`,
    });
    steps.push(step2);
    conclusions.push(`### Stap 2: Campaign Performance\n${step2.output}`);
    await extractStepSidecar(step2);

    // ── Aggregate ad group data: filter op stap 2 campagnes, pre-berekend ──
    const allCampaignNames = [...new Set(campaignData.map((c: Record<string, unknown>) => c.campaign_name as string))];
    const mentionedCampaigns = allCampaignNames.filter((name) => step2.output.includes(name));
    const adgroupAggregation = aggregateAdGroups(adgroupData as never[], mentionedCampaigns);

    // ── STAP 3: Ad Group Performance ──────────────────────────────────
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "run_step_3",
      message: "Ad group-structuur en prestaties analyseren...",
    });
    // Pre-compute ad group MoM facts
    const adgroupMomText = computeAdGroupMomFacts(
      adgroupData as Array<{ ad_group_name: string; campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number; clicks: number; impressions: number }>,
      lastCompleteMonth,
      analysisYear
    );

    const step3 = await runStep({
      ...shared,
      stepNumber: 3,
      stepName: "Ad Group Performance",
      systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, MONTHLY_STEP3_INSTRUCTION, conclusions.join("\n\n")),
      userMessage: adgroupAggregation.ad_group_details.length > 0
        ? `Analyseer de ad group performance voor client "${clientId}".
Gebruik de conclusies uit stap 2 als uitgangspunt.${enrichment.strategicContext}
Data is pre-geaggregeerd: ${adgroupAggregation.ad_group_details.length} ad groups over ${mentionedCampaigns.length} campagnes.
Alle trends zijn berekend over 13 maanden, last_3m = laatste 3 maanden, prev_3m = 3 maanden daarvoor.
vs_campaign_avg = verschil t.o.v. het campagnegemiddelde in %.

${adgroupMomText}

## Campaign Overzicht
\`\`\`json
${JSON.stringify(adgroupAggregation.campaign_summaries, null, 2)}
\`\`\`

## Ad Group Details (pre-geaggregeerd)
\`\`\`json
${JSON.stringify(adgroupAggregation.ad_group_details, null, 2)}
\`\`\`${enrichment.changeHistory}`
        : `Er is geen ad group data beschikbaar voor client "${clientId}". Noteer dit en geef aan dat de analyse op campagne-niveau blijft.`,
    });
    steps.push(step3);
    conclusions.push(`### Stap 3: Ad Group Performance\n${step3.output}`);
    await extractStepSidecar(step3);

    // ── STAP 4: Competitor & Auction Insights ─────────────────────────
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "run_step_4",
      message: "Auction insights en concurrentiedruk beoordelen...",
    });
    const step4 = await runStep({
      ...shared,
      stepNumber: 4,
      stepName: "Competitor & Auction Insights",
      systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, MONTHLY_STEP4_INSTRUCTION, conclusions.join("\n\n")),
      userMessage: isData.length > 0
        ? `Analyseer de impression share data voor client "${clientId}".${enrichment.strategicContext}
Koppel terug aan eerder geïdentificeerde campagnes.

## Campaign Impression Share (laatste 6 maanden)
\`\`\`json
${JSON.stringify(isData, null, 2)}
\`\`\`${enrichment.changeHistory}`
        : `Er is geen impression share data beschikbaar voor client "${clientId}". Noteer dit en geef aan welke data nodig zou zijn.`,
    });
    steps.push(step4);
    conclusions.push(`### Stap 4: Competitor & Auction Insights\n${step4.output}`);
    await extractStepSidecar(step4);

    // ── STAP 5: Search Term Performance ───────────────────────────────
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "run_step_5",
      message: "Zoektermen en waste-drivers analyseren...",
    });
    const monthlyProductContext = buildProductContext({
      productTitles: productData.map((row: Record<string, unknown>) => String(row.product_title || "")).filter(Boolean),
      productTypes: merchantSync.products.flatMap((product) => [
        product.product_type,
        product.product_type_l1,
        product.product_type_l2,
        product.product_type_l3,
        product.product_type_l4,
        product.product_type_l5,
      ].filter(Boolean) as string[]),
      productBrands: merchantSync.products.map((product) => product.brand).filter(Boolean) as string[],
      customLabels: merchantSync.products.flatMap((product) => [
        product.custom_label_0,
        product.custom_label_1,
        product.custom_label_2,
        product.custom_label_3,
        product.custom_label_4,
      ].filter(Boolean) as string[]),
      customAttributes: merchantSync.products.flatMap((product) =>
        Object.values(product.custom_attributes_jsonb ?? {}).filter((value): value is string => typeof value === "string")
      ),
      merchantProducts: merchantSync.products.map((product) => ({
        offerId: product.offer_id,
        title: product.title,
        brand: product.brand,
        productType: product.product_type,
        customLabels: [
          product.custom_label_0,
          product.custom_label_1,
          product.custom_label_2,
          product.custom_label_3,
          product.custom_label_4,
        ].filter(Boolean) as string[],
        customAttributes: Object.values(product.custom_attributes_jsonb ?? {}).filter((value): value is string => typeof value === "string"),
        link: product.link,
      })),
      adCopyPhrases: creativeData.flatMap((row: Record<string, unknown>) => [
        ...((row.headlines as string[] | null) ?? []),
        ...((row.descriptions as string[] | null) ?? []),
        ...((row.final_urls as string[] | null) ?? []),
      ]),
      strategicContextText: `${goalsSection}\n${enrichment.strategicContext}`,
      targetedCountries: Array.from(new Set(countryData.map((row: Record<string, unknown>) => String(row.country_code || "")).filter(Boolean))),
    });

    const searchTermContextSummary = searchData.length > 0
      ? [
          summarizeProductContext(monthlyProductContext),
          "",
          "## Merchant snapshot status",
          merchantSync.message,
          "",
          "## Deterministische product-relevantie check op top search terms",
          ...searchData.slice(0, 20).map((term: Record<string, unknown>) => {
            const assessment = assessSearchTermAgainstProductContext({
              searchTerm: String(term.search_term || ""),
              campaignName: String(term.campaign_name || ""),
              adGroupName: String(term.ad_group_name || ""),
              clicks: Number(term.clicks || 0),
              cost: Number(term.cost || 0),
              conversions: Number(term.conversions || 0),
            }, monthlyProductContext);
            return `- ${term.search_term}: classificatie=${assessment.productClassification}, sold_by_client=${assessment.soldByClient}, scope=${assessment.recommendedScope}, exclusion_safety=${assessment.exclusionSafety}, reden=${assessment.reasoningLabel}`;
          }),
        ].join("\n")
      : summarizeProductContext(monthlyProductContext);

    const step5 = await runStep({
      ...shared,
      stepNumber: 5,
      stepName: "Search Term Performance",
      systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, MONTHLY_STEP5_INSTRUCTION, conclusions.join("\n\n")),
      userMessage: searchData.length > 0
        ? `Analyseer de wasteful search terms voor client "${clientId}".${enrichment.strategicContext}
Koppel terug aan eerder geïdentificeerde campagnes en ad groups.

${searchTermContextSummary}

## Wasteful Search Terms (top 30 op cost, 0 conversies)
\`\`\`json
${JSON.stringify(searchData, null, 2)}
\`\`\`${enrichment.changeHistory}`
        : `Er zijn geen wasteful search terms gevonden voor client "${clientId}". Noteer dit als positief signaal.`,
    });
    steps.push(step5);
    conclusions.push(`### Stap 5: Search Term Performance\n${step5.output}`);
    await extractStepSidecar(step5);

    // ── STAP 6: Creative & Ad Copy (conditioneel) ────────────────────
    if (creativeData.length > 0) {
      await updateProgressPhase(supabase, {
        jobId,
        phaseKey: "run_step_6",
        message: "Creatives en advertentieteksten analyseren...",
      });
      const step6 = await runStep({
        ...shared,
        stepNumber: 6,
        stepName: "Creative & Ad Copy Performance",
        systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, MONTHLY_STEP6_INSTRUCTION, conclusions.join("\n\n")),
        userMessage: `Analyseer de creative/ad copy performance voor client "${clientId}".
Koppel terug aan campagnes en ad groups uit stap 2 en 3.${enrichment.strategicContext}

## Creative Performance (laatste 3 maanden, top ${creativeData.length} ads)
\`\`\`json
${JSON.stringify(creativeData, null, 2)}
\`\`\``,
      });
      steps.push(step6);
      conclusions.push(`### Stap 6: Creative & Ad Copy Performance\n${step6.output}`);
      await extractStepSidecar(step6);
    }

    // ── STAP 7: Audience & Device (conditioneel) ─────────────────────
    if (audienceData.length > 0 || deviceData.length > 0) {
      await updateProgressPhase(supabase, {
        jobId,
        phaseKey: "run_step_7",
        message: "Audience- en device-signalen analyseren...",
      });
      const audienceSection = audienceData.length > 0
        ? `\n\n## Audience Performance (laatste 3 maanden)\n\`\`\`json\n${JSON.stringify(audienceData, null, 2)}\n\`\`\``
        : "\n\nGeen audience data beschikbaar.";
      const deviceSection = deviceData.length > 0
        ? `\n\n## Device Performance (laatste 3 maanden)\n\`\`\`json\n${JSON.stringify(deviceData, null, 2)}\n\`\`\``
        : "\n\nGeen device data beschikbaar.";

      const step7 = await runStep({
        ...shared,
        stepNumber: 7,
        stepName: "Audience & Device Performance",
        systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, MONTHLY_STEP7_INSTRUCTION, conclusions.join("\n\n")),
        userMessage: `Analyseer de audience en device performance voor client "${clientId}".${enrichment.strategicContext}${audienceSection}${deviceSection}`,
      });
      steps.push(step7);
      conclusions.push(`### Stap 7: Audience & Device Performance\n${step7.output}`);
      await extractStepSidecar(step7);
    }

    // ── STAP 8: Geografische Deep-Dive (conditioneel, >1 land) ───────
    if (countryData.length > 0) {
      const uniqueCountries = [...new Set(countryData.map((r: Record<string, unknown>) => r.country_code as string))];
      if (uniqueCountries.length > 1) {
        await updateProgressPhase(supabase, {
          jobId,
          phaseKey: "run_step_8",
          message: "Geografische verschillen analyseren...",
        });
        const countryYoySection = countryYoyData.length > 0
          ? `\n\n## Land YoY Vergelijking\n\`\`\`json\n${JSON.stringify(countryYoyData, null, 2)}\n\`\`\``
          : "";

        const step8 = await runStep({
          ...shared,
          stepNumber: 8,
          stepName: "Geografische Deep-Dive",
          systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, MONTHLY_STEP8_INSTRUCTION, conclusions.join("\n\n")),
          userMessage: `Analyseer de geografische performance voor client "${clientId}" (${uniqueCountries.length} landen: ${uniqueCountries.join(", ")}).${enrichment.strategicContext}

## Land Performance (maandelijks, tot 6 maanden)
\`\`\`json
${JSON.stringify(countryData, null, 2)}
\`\`\`${countryYoySection}`,
        });
        steps.push(step8);
        conclusions.push(`### Stap 8: Geografische Deep-Dive\n${step8.output}`);
        await extractStepSidecar(step8);
      }
    }

    // ── STAP 9: Network & Schedule (conditioneel) ────────────────────
    if (networkData.length > 0 || scheduleData.length > 0) {
      await updateProgressPhase(supabase, {
        jobId,
        phaseKey: "run_step_9",
        message: "Netwerk- en scheduleprestaties analyseren...",
      });
      const networkSection = networkData.length > 0
        ? `\n\n## Network Performance (laatste 3 maanden)\n\`\`\`json\n${JSON.stringify(networkData, null, 2)}\n\`\`\``
        : "\n\nGeen network data beschikbaar.";
      const scheduleSection = scheduleData.length > 0
        ? `\n\n## Ad Schedule Performance (dag/uur verdeling)\n\`\`\`json\n${JSON.stringify(scheduleData, null, 2)}\n\`\`\``
        : "\n\nGeen schedule data beschikbaar.";

      const step9 = await runStep({
        ...shared,
        stepNumber: 9,
        stepName: "Network & Schedule Performance",
        systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, MONTHLY_STEP9_INSTRUCTION, conclusions.join("\n\n")),
        userMessage: `Analyseer de network en schedule performance voor client "${clientId}".${enrichment.strategicContext}${networkSection}${scheduleSection}`,
      });
      steps.push(step9);
      conclusions.push(`### Stap 9: Network & Schedule Performance\n${step9.output}`);
      await extractStepSidecar(step9);
    }

    // ── EINDCONCLUSIE ────────────────────────────────────────────────
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "finalize_conclusion",
      message: "Hoofdthread en hypotheses consolideren...",
    });
    const conclusionStepNum = steps.length + 1;
    const conclusion = await runStep({
      ...shared,
      stepNumber: conclusionStepNum,
      stepName: "Eindconclusie & Hypotheses",
      systemPrompt: buildMonthlyStepPrompt(goalsSection, accountType, MONTHLY_CONCLUSION_INSTRUCTION),
      userMessage: `Formuleer de eindconclusie en hypotheses voor client "${clientId}"
op basis van alle voorgaande analyse stappen (${steps.length} stappen uitgevoerd):

${conclusions.join("\n\n---\n\n")}`,
    });
    steps.push(conclusion);

    const analysisDate = new Date().toISOString().split("T")[0];
    const dimensionAvailability: Partial<Record<CoverageDimension, boolean>> = {
      account: true,
      campaign: campaignData.length > 0,
      adgroup: adgroupData.length > 0,
      competitor: isData.length > 0,
      search_term: searchData.length > 0,
      creative: creativeData.length > 0,
      audience: audienceData.length > 0,
      device: deviceData.length > 0,
      geography: countryData.length > 0,
      network: networkData.length > 0,
      schedule: scheduleData.length > 0,
      pmax_product_asset_groups: Boolean(
        enrichment.dimensionProfile?.dimensions.get("product_performance")?.isAvailable
        || enrichment.dimensionProfile?.dimensions.get("asset_group_performance")?.isAvailable
      ),
      hypotheses_sprint_plan: true,
    };

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "structure_findings",
      message: "Step findings clusteren en SOP-coverage borgen...",
    });
    const rawStepFindings = stepSidecars.flatMap((sidecar) => sidecar.findings);
    const canonical = canonicalizeFindings(rawStepFindings, dimensionAvailability);
    const findingIndexById = new Map(canonical.findings.map((finding, index) => [finding.finding_id, index]));
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "build_recommendations",
      message: "Threads, aanbevelingen en taakladder opbouwen...",
    });
    const structured = buildStructuredMonthlyOutput({
      stepSidecars,
      findings: canonical.findings,
      clusters: canonical.clusters,
      coverage: canonical.coverage,
      narrativeSteps: steps.filter((step) => step.stepNumber < 100),
      conclusion,
    });

    const monthName = ["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"][lastCompleteMonth - 1];
    const summaryParts: string[] = [`## Maandoverzicht ${monthName} ${analysisYear}\n`];

    if (comparisonFacts.momComparisons.length > 0) {
      const convMom = comparisonFacts.momComparisons.find((comparison) => comparison.metric === "conversies");
      const revMom = comparisonFacts.momComparisons.find((comparison) => comparison.metric === "omzet");
      const spendMom = comparisonFacts.momComparisons.find((comparison) => comparison.metric === "spend");
      const roasMom = comparisonFacts.momComparisons.find((comparison) => comparison.metric === "ROAS");

      summaryParts.push("### Account Snapshot");
      if (convMom) summaryParts.push(`- Conversies: ${convMom.benchmark} → ${convMom.actual} (${convMom.deltaPct > 0 ? "+" : ""}${convMom.deltaPct}% m/m)`);
      if (revMom) summaryParts.push(`- Omzet: €${Math.round(revMom.benchmark)} → €${Math.round(revMom.actual)} (${revMom.deltaPct > 0 ? "+" : ""}${revMom.deltaPct}% m/m)`);
      if (spendMom) summaryParts.push(`- Spend: €${Math.round(spendMom.benchmark)} → €${Math.round(spendMom.actual)} (${spendMom.deltaPct > 0 ? "+" : ""}${spendMom.deltaPct}% m/m)`);
      if (roasMom) summaryParts.push(`- ROAS: ${roasMom.benchmark}x → ${roasMom.actual}x (${roasMom.deltaPct > 0 ? "+" : ""}${roasMom.deltaPct}% m/m)`);
    }

    if (comparisonFacts.targetComparisons.length > 0) {
      summaryParts.push("\n### Doelstellingen");
      for (const target of comparisonFacts.targetComparisons) {
        summaryParts.push(`- ${target.metric}: ${target.actual} vs target ${target.benchmark} → ${target.statusLabel} (${target.deltaPct > 0 ? "+" : ""}${target.deltaPct}%)`);
      }
    }

    const rawFullOutput = [
      structured.executive_markdown,
      summaryParts.join("\n"),
      structured.appendix_markdown,
    ].join("\n\n---\n\n");

    const fullOutput = sanitizeOutput(rawFullOutput);

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "save_outputs",
      message: "Analyse, findings en taken opslaan...",
    });
    const { data: fullRow, error: fullErr } = await saveAnalysisOutputSection({
      supabase,
      row: {
        client_id: clientId,
        sop_type: "monthly",
        analysis_date: analysisDate,
        period_start: periodStart,
        period_end: periodEnd,
        section: "full",
        output: fullOutput,
        model_used: steps[0].model,
        tokens_used: [...steps, ...machineSteps].reduce((sum, step) => sum + step.tokensUsed, 0),
        step_number: 0,
        step_name: "full",
      },
      select: "id",
    });

    if (fullErr) console.error("sop_analysis_output insert error:", fullErr.message);
    const analysisId = fullRow && typeof fullRow === "object" && "id" in fullRow
      ? String((fullRow as { id: string }).id)
      : null;
    partialOutputExists = Boolean(analysisId);

    await saveAnalysisOutputSection({
      supabase,
      row: {
        client_id: clientId,
        sop_type: "monthly",
        analysis_date: analysisDate,
        period_start: periodStart,
        period_end: periodEnd,
        section: "structured_monthly_v2",
        output: JSON.stringify({
          stats: canonical.stats,
          threads: structured.threads,
          clusters: structured.clusters.map((cluster) => ({
            cluster_id: cluster.cluster_id,
            issue_cluster: cluster.issue_cluster,
            canonical_entity_name: cluster.canonical_entity_name,
            display_label: cluster.display_label,
            canonical_metric: cluster.canonical_metric,
            related_finding_ids: cluster.related_finding_ids,
            dominant_severity: cluster.dominant_severity,
            dominant_confidence: cluster.dominant_confidence,
            root_cause_summary: cluster.root_cause_summary,
            evidence_summary: cluster.evidence_summary,
            actionability: cluster.actionability,
            coverage_dimensions: cluster.coverage_dimensions,
          })),
          coverage: structured.coverage,
          recommendations: structured.recommendations,
          tasks: structured.tasks,
          success_next_month: structured.success_next_month,
          what_is_not_the_problem: structured.what_is_not_the_problem,
        }),
        model_used: steps[0].model,
        tokens_used: 0,
        step_number: 0,
        step_name: "structured_monthly_v2",
      },
    });

    let structuredSaved = false;
    const recs = structured.recommendations.map((recommendation) => ({
      ...recommendation,
      finding_index: findingIndexById.get(structured.clusters.find((cluster) => cluster.cluster_id === recommendation.cluster_id)?.related_finding_ids[0] || "") ?? null,
    }));
    const tasks = structured.tasks;
    const findings = canonical.findings;

    if (findings.length > 0) {
      try {
        const insightRows = findings.map((finding) => ({
          client_id: clientId,
          analysis_id: analysisId,
          sop_type: "monthly",
          analysis_date: analysisDate,
          insight_type: finding.insight_type,
          title: `[Stap ${finding.step}][${finding.issue_cluster}] ${finding.display_label ?? finding.entity_name}: ${finding.metric}`.slice(0, 80),
          description: `${finding.display_label ?? finding.entity_name} — ${finding.metric}: ${finding.current_value ?? "n.v.t."}${finding.previous_value != null ? ` (was ${finding.previous_value})` : ""}. Cluster: ${finding.issue_cluster}. Oorzaak: ${finding.cause}`,
          severity: finding.severity,
          affected_entity: finding.display_label ?? finding.entity_name,
          affected_entity_type: finding.entity_type,
          metric: finding.metric,
          current_value: finding.current_value ?? null,
          previous_value: finding.previous_value ?? null,
          change_pct: finding.change_pct ?? null,
          is_seasonal: finding.is_seasonal,
          is_structural: finding.is_structural,
          action_required: finding.action_required,
        }));

        const { data: insertedInsights } = await supabase
          .from("sop_insights")
          .insert(insightRows)
          .select("id");

        const insightIds = (insertedInsights ?? []).map((row: { id: string }) => row.id);

        const recRows = recs.map((rec) => ({
          client_id: clientId,
          analysis_id: analysisId,
          insight_id: rec.finding_index !== null ? (insightIds[rec.finding_index] ?? null) : null,
          sop_type: "monthly",
          analysis_date: analysisDate,
          hypothesis: rec.hypothesis,
          expected_result: rec.expected_result,
          measurement_metric: rec.measurement_metric,
          timeframe: rec.timeframe,
          rationale: `${rec.rationale} Thread: ${rec.thread_id ?? "geen"}. Phase: ${rec.phase}.`,
          ice_impact: rec.ice_impact,
          ice_confidence: rec.ice_confidence,
          ice_ease: rec.ice_ease,
          ice_total: rec.ice_total,
          status: "open",
        }));

        const { data: insertedRecs } = await supabase
          .from("sop_recommendations")
          .insert(recRows)
          .select("id");

        const recIds = (insertedRecs ?? []).map((row: { id: string }) => row.id);

        const taskRows = tasks.map((task) => {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + task.due_date_days);
          return {
            client_id: clientId,
            recommendation_id: recIds[task.recommendation_index] ?? null,
            analysis_date: analysisDate,
            title: task.title,
            description: `${task.description} Thread: ${task.thread_id ?? "geen"}. Phase: ${task.phase}.`,
            action_type: task.action_type,
            affected_campaign: task.affected_campaign,
            affected_adgroup: task.affected_adgroup,
            affected_keyword: task.affected_keyword,
            current_value: task.current_value,
            target_value: task.target_value,
            priority: task.priority,
            frequency: task.frequency,
            status: "open",
            due_date: dueDate.toISOString().split("T")[0],
          };
        });

        await supabase.from("sop_tasks").insert(taskRows);
        structuredSaved = true;
      } catch (e) {
        console.error("Failed to save structured data:", e instanceof Error ? e.message : e);
      }
    }

    const totalTokens = [...steps, ...machineSteps].reduce((sum, step) => sum + step.tokensUsed, 0);
    const totalLatency = [...steps, ...machineSteps].reduce((sum, step) => sum + step.latencyMs, 0);

    await markProgressCompleted(supabase, {
      jobId,
      message: "Maandelijkse SOP-analyse gereed.",
      metadata: {
        analysis_date: analysisDate,
        sop_type: "monthly",
        structured_saved: structuredSaved,
      },
      partialOutputExists,
    });

    return Response.json({
      jobId,
      clientId,
      sopType: "monthly",
      analysisDate,
      period: { start: periodStart, end: periodEnd },
      model: steps[0].model,
      totalTokens,
      totalLatencyMs: totalLatency,
      steps: steps.map((step) => ({
        step: step.stepNumber,
        name: step.stepName,
        tokens: step.tokensUsed,
        latencyMs: step.latencyMs,
        retries: step.retries,
        saved: step.saved,
        output: step.output,
      })),
      internalPipeline: {
        structuredSteps: machineSteps.length,
      },
      structured: {
        findings: findings.length,
        recommendations: recs.length,
        tasks: tasks.length,
        saved: structuredSaved,
        findingsParseOk: stepSidecars.every((sidecar) => Array.isArray(sidecar.findings)),
        recsParseOk: true,
        clusters: structured.clusters.length,
        threads: structured.threads.length,
        coverage: structured.coverage,
      },
      fullOutput,
    });
  } catch (err) {
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "Onbekende fout",
    });
    return Response.json({ error: err instanceof Error ? err.message : "Onbekende fout" }, { status: 500 });
  }
}

```


---

## `lib/prompts/sop-prompts.ts`

```ts
// ============================================================
// SEA ANALYSE SYSTEM PROMPTS v2
// Verbeterd op 3 punten:
// 1. Expliciete terugkoppeling naar vorige stap conclusies
// 2. Accounttype-bewuste benchmarks
// 3. Hypotheses op het niveau van echte SEA specialisten
// ============================================================

// ============================================================
// HELPER: Accounttype bepalen op basis van kpi_targets
// ============================================================

export type AccountType =
  | "ecommerce_roas"      // Shopping/PMAX, ROAS gestuurd
  | "ecommerce_cpa"       // Shopping/PMAX, CPA gestuurd
  | "leadgen_cpa"         // Search, leads, CPA gestuurd
  | "leadgen_volume"      // Search, leads, volume gestuurd
  | "hybrid";             // Combinatie

export function determineAccountType(config: {
  cpaTarget: number;
  roasTarget: number;
  revenueMode: string;
  conversionsMode: string;
  primaryConversionAction?: string;
}): AccountType {
  const isLeadGen =
    config.primaryConversionAction?.toLowerCase().includes("afspraak") ||
    config.primaryConversionAction?.toLowerCase().includes("lead") ||
    config.primaryConversionAction?.toLowerCase().includes("contact") ||
    config.primaryConversionAction?.toLowerCase().includes("formulier");

  if (isLeadGen && config.cpaTarget > 0) return "leadgen_cpa";
  if (isLeadGen) return "leadgen_volume";
  if (config.roasTarget > 0 && config.cpaTarget > 0) return "hybrid";
  if (config.roasTarget > 0) return "ecommerce_roas";
  if (config.cpaTarget > 0) return "ecommerce_cpa";
  return "ecommerce_roas";
}

// ============================================================
// HELPER: Benchmarks per accounttype
// ============================================================

function getBenchmarks(accountType: AccountType): string {
  const benchmarks: Record<AccountType, string> = {
    ecommerce_roas: `
## Benchmarks (E-commerce ROAS-gestuurd)
Gebruik deze benchmarks als referentie bij het beoordelen van performance:
- Gezonde CTR Shopping: 0,5% - 1,5% | Search: 3% - 8%
- Gezonde Conv. Rate Shopping: 1% - 3% | Search: 2% - 5%
- Gezonde CPC Shopping: €0,20 - €0,80 | Search: €0,50 - €2,00
- PMAX leerfase: minimaal 6 weken, 50+ conversies nodig
- Impression Share verlies door budget: alarm bij >20%
- MoM fluctuatie normaal: ±15% op conversies, ±20% op cost
- Breuklijn signaal: >30% MoM daling op conversies of ROAS`,

    ecommerce_cpa: `
## Benchmarks (E-commerce CPA-gestuurd)
Gebruik deze benchmarks als referentie bij het beoordelen van performance:
- Gezonde CTR Shopping: 0,5% - 1,5% | Search: 3% - 8%
- Gezonde Conv. Rate: 1% - 4%
- CPA schommeling normaal: ±20% MoM
- PMAX leerfase: minimaal 6 weken, 50+ conversies nodig
- MoM fluctuatie normaal: ±15% op conversies
- Breuklijn signaal: >30% MoM daling op conversies of stijging CPA`,

    leadgen_cpa: `
## Benchmarks (Lead generatie CPA-gestuurd)
Gebruik deze benchmarks als referentie bij het beoordelen van performance:
- Gezonde CTR Search: 4% - 12% (hoog intent zoekwoorden)
- Gezonde Conv. Rate Search: 3% - 8%
- Gezonde CPC Search: €1,00 - €5,00 afhankelijk van sector
- CPA schommeling normaal: ±20% MoM
- Impression Share target: >60% voor branded, >30% non-branded
- Breuklijn signaal: >25% MoM daling op conversies of stijging CPA
- Let op: maandeinde heeft vaak hogere conv. rate door deadline-effect`,

    leadgen_volume: `
## Benchmarks (Lead generatie volume-gestuurd)
Gebruik deze benchmarks als referentie bij het beoordelen van performance:
- Gezonde CTR Search: 4% - 12%
- Gezonde Conv. Rate Search: 3% - 8%
- Volume groei verwachting: +5% tot +15% MoM bij actieve optimalisatie
- Impression Share target: >60% voor branded, >30% non-branded
- Breuklijn signaal: >25% MoM daling op conversies
- Let op: seizoenspatronen sterk aanwezig bij lokale leadgen`,

    hybrid: `
## Benchmarks (Hybrid account)
Gebruik deze benchmarks als referentie bij het beoordelen van performance:
- Shopping CTR: 0,5% - 1,5% | Search CTR: 3% - 8%
- Shopping Conv. Rate: 1% - 3% | Search Conv. Rate: 2% - 6%
- Beoordeel Shopping en Search campagnes apart op hun eigen KPI's
- PMAX leerfase: minimaal 6 weken, 50+ conversies nodig
- MoM fluctuatie normaal: ±15% op conversies
- Breuklijn signaal: >30% MoM daling op de primaire doelstelling`,
  };

  return benchmarks[accountType];
}

// ============================================================
// HELPER: Doelstellingen sectie
// ============================================================

export function buildGoalsSection(config: {
  cpaTarget: number;
  roasTarget: number;
  revenueMode: "absolute" | "growth";
  conversionsMode: "absolute" | "growth";
  revenueAbsolute: number;
  revenueGrowthPct: number;
  conversionsAbsolute: number;
  conversionsGrowthPct: number;
  primaryConversionAction?: string;
  accountType: AccountType;
}): string {
  const goals: string[] = [];

  if (config.roasTarget > 0) {
    goals.push(`- ROAS target: ${(config.roasTarget * 100).toFixed(0)}%`);
  }
  if (config.cpaTarget > 0) {
    goals.push(`- CPA target: €${config.cpaTarget}`);
  }
  if (config.conversionsMode === "absolute" && config.conversionsAbsolute > 0) {
    goals.push(
      `- Conversie jaardoel: ${config.conversionsAbsolute} conversies per jaar (~${Math.round(config.conversionsAbsolute / 12)} per maand)`
    );
  } else if (
    config.conversionsMode === "growth" &&
    config.conversionsGrowthPct > 0
  ) {
    goals.push(
      `- Conversie groeidoelstelling: +${config.conversionsGrowthPct}% MoM groei`
    );
  }
  if (config.revenueMode === "absolute" && config.revenueAbsolute > 0) {
    goals.push(
      `- Omzet jaardoel: €${config.revenueAbsolute.toLocaleString("nl-NL")} per jaar (~€${Math.round(config.revenueAbsolute / 12).toLocaleString("nl-NL")} per maand)`
    );
  } else if (
    config.revenueMode === "growth" &&
    config.revenueGrowthPct > 0
  ) {
    goals.push(
      `- Omzet groeidoelstelling: +${config.revenueGrowthPct}% MoM groei`
    );
  }
  if (config.primaryConversionAction) {
    goals.push(
      `- Primaire conversie actie: ${config.primaryConversionAction}`
    );
  }

  const accountTypeLabels: Record<AccountType, string> = {
    ecommerce_roas: "E-commerce (ROAS-gestuurd)",
    ecommerce_cpa: "E-commerce (CPA-gestuurd)",
    leadgen_cpa: "Lead generatie (CPA-gestuurd)",
    leadgen_volume: "Lead generatie (volume-gestuurd)",
    hybrid: "Hybrid (Shopping + Search)",
  };

  if (goals.length === 0) {
    return `## Doelstellingen
Accounttype: ${accountTypeLabels[config.accountType]}
Geen specifieke targets ingesteld. Analyseer op MoM ontwikkeling en relatieve performance.`;
  }

  return `## Doelstellingen
Accounttype: ${accountTypeLabels[config.accountType]}
${goals.join("\n")}

Vermeld bij elke stap het procentuele verschil met de doelstelling.
Geef altijd aan of het account op schema ligt: OP SCHEMA / NIET OP SCHEMA / KRITIEK.`;
}

// ============================================================
// HYPOTHESE INSTRUCTIES (gedeeld door alle prompts)
// ============================================================

const HYPOTHESE_INSTRUCTIES = `
## Hypothese formaat
Schrijf elke hypothese exact in dit formaat:

"Met het [concrete actie] verwachten we [meetbare verwachting] voor [campagne/ad group/keyword],
gemeten via [specifieke metric(s)] binnen [tijdshorizon], omdat [onderbouwing vanuit de data]."

Regels:
- De actie moet specifiek en uitvoerbaar zijn (niet "PMAX optimaliseren" maar "tROAS verlagen van X% naar Y%")
- De verwachting moet meetbaar zijn (niet "betere performance" maar "+20% conversies")
- De tijdshorizon is realistisch: quick wins 2-4 weken, structurele veranderingen 2-3 maanden
- De onderbouwing verwijst expliciet naar data uit de analyse
- Geef per hypothese een ICE score:
  - Impact (1-10): effect op de primaire doelstelling
  - Confidence (1-10): zekerheid op basis van beschikbare data
  - Ease (1-10): implementatiegemak
  - ICE totaal = (Impact + Confidence + Ease) / 3
- Sorteer hypotheses van hoog naar laag ICE score

## BELANGRIJK: Verantwoordelijkheid en afhankelijkheden
Hypotheses en taken zijn NIET altijd voor het bureau (Ranking Masters). Wijs per taak een verantwoordelijke toe:
- **Ranking Masters**: alles wat in Google Ads, Merchant Center, Tag Manager, Analytics etc. gebeurt
- **Klant**: alles wat op de website, in het CMS, in de productfeed-bron, of buiten Google Ads moet gebeuren

### Afhankelijkheden herkennen
Veel hypotheses vereisen actie van BEIDE partijen. Genereer dan ook BEIDE taken, in de juiste volgorde.
Zonder de klant-taak kan Ranking Masters vaak niet verder. Maak dit expliciet.

Voorbeelden (niet limitatief — gebruik je eigen expertise):
- Nieuwe campagnetypes (Display, Video, Awareness, Remarketing, Demand Gen) → klant levert content/creatives aan → RM bouwt campagne
- Nieuwe markten/landen → klant regelt vertalingen, betaalmethoden, verzending → RM maakt campagnes
- Productfeed-verbeteringen → klant vult data aan → RM optimaliseert feed-regels
- Landingspagina-issues → RM deelt analyse/aanbevelingen → klant implementeert verbeteringen
- Reviews/UGC/trust → klant activeert platform/verzamelt content → RM koppelt aan ads
- Prijsstrategie → klant past prijzen aan → RM optimaliseert biedingen op nieuwe marges
- Tracking/conversie-setup → klant geeft toegang/implementeert tags → RM configureert

## BELANGRIJK: Denk breed — niet alleen optimalisaties
Je bent niet beperkt tot het optimaliseren van bestaande campagnes. Als de data erop wijst, stel dan gerust voor:

### Strategiewijzigingen
- Overstappen van manual bidding naar Smart Bidding (tCPA, tROAS, Maximize Conversions)
- Overstappen van tROAS naar tCPA of andersom als de data dit onderbouwt
- Verschuiven van budget tussen campagnetypes (Search → Shopping, PMax → Search, etc.)
- Consolidatie van te veel kleine campagnes of juist opsplitsen van te brede campagnes
- Full-funnel strategie: Awareness → Consideration → Conversion → Retention

### Nieuwe campagnetypes
- Performance Max als aanvulling op Search/Shopping
- Dynamic Search Ads voor keyword-discovery
- Display/Video voor awareness als branded zoekvolume laag is
- Remarketing/retargeting als conversieratio achterblijft
- Demand Gen campagnes voor mid-funnel
- Shopping Labelizer/segmentatie (bestsellers vs bleeders vs nieuwe producten)
- Lokale campagnes als er fysieke locaties zijn

### Account structuur
- Herstructurering van campagnes (bijv. per productcategorie, per marge, per land)
- SKAG/STAG naar thema-gebaseerde ad groups
- Audience-layering op Search campagnes
- Negative keyword strategie en gedeelde uitsluitingslijsten
- Ad copy testen (RSA varianten, pinning strategie)
- Asset group optimalisatie in PMax

### Website & conversie-optimalisatie
- Landingspagina-audit als conv rate daalt bij stabiel verkeer
- Mobiele UX als mobiel underperformed vs desktop
- Checkout-optimalisatie als add-to-cart hoog maar conversie laag
- Snelheidsoptimalisatie als bounce rate hoog is
- A/B testen van landingspagina's
- Trust-elementen toevoegen (reviews, keurmerken, garanties)
- Betaalmethoden uitbreiden per markt

### Feed & Merchant Center
- Productfeed-optimalisatie (titels, beschrijvingen, afbeeldingen, custom labels)
- Promoties en merchant promotions
- Productstatus-issues oplossen (afgekeurde producten)
- Prijsconcurrentie-analyse

Dit is geen uitputtende lijst — gebruik je expertise als senior SEA specialist. Als je op basis van de data een kans of probleem ziet dat hier niet staat, formuleer het als hypothese.`;

// ============================================================
// MONTHLY PER-STEP PROMPTS (moved from monthly/route.ts)
// ============================================================

const MONTHLY_BASE_ROLE = `Je bent een senior SEA strateeg bij Ranking Masters die een volledige maandelijkse analyse uitvoert.
Je denkt niet als een rapporteur maar als een adviseur. Elke observatie eindigt met een conclusie en actie.
Schrijf altijd in het Nederlands. Gebruik altijd concrete cijfers. Nooit vage omschrijvingen.

## Denkwijze: KPI-keten redenering
Denk ALTIJD in ketens, niet in losse metrics:
- Verkeer-keten: Impressies → CTR → Klikken → Kosten
- Conversie-keten: Klikken → Conversieratio → Conversies → Omzet
- Rendement-keten: CPC × (1/CR) = CPA → ROAS = AOV/CPA
Als een metric verandert, traceer de oorzaak DOOR de keten. Niet "ROAS daalde" maar "ROAS daalde OMDAT de CPC steeg (+50%) terwijl de CR niet meebewoog (+5%), waardoor de CPA verdrievoudigde."

## Fase-herkenning
Herken in welke fase het account zit en pas je advies hierop aan:
- **Schaalfase**: Budget stijgt, volume groeit, efficiëntie mag dalen zolang het boven target blijft. Advies: monitor, niet remmen.
- **Efficiëntiefase**: Budget stabiel, focus op ROAS/CPA verbetering. Advies: saneren, uitsluitingen, bid-optimalisatie.
- **Consolidatiefase**: Na grote wijzigingen, algoritme leert. Advies: geduld, niet tegensturen.
- **Groeiplafond**: Volume stagneert ondanks budget. Advies: nieuwe kanalen, audiences, markten.
Benoem de fase expliciet in stap 1 en verwijs ernaar in latere stappen.

## Seizoens- en marktcontext
Beoordeel altijd of een verandering seizoensmatig of structureel is:
- Vergelijk MoM EN YoY: als beide dezelfde richting gaan = structureel, als alleen MoM = seizoensmatig
- Geef expliciet aan: "Dit is een seizoensmatige daling (YoY +X%)" of "Dit is een structureel probleem (YoY ook -X%)"

## Business impact ("dus wat?")
Elke bevinding moet beantwoorden: "Dus wat betekent dit voor het bedrijf?"
- Niet: "CPA steeg van €15 naar €22"
- Wel: "CPA steeg van €15 naar €22, maar ligt nog steeds 27% onder de target van €30. Ondanks de stijging is het account winstgevend — de prioriteit is vasthouden, niet terugdringen."

## Risico-identificatie
Identificeer per stap het grootste risico voor de komende maand:
- Leading indicators (laatste week-trends die de maandcijfers tegenspreken)
- Tracking-risico's (CVR-drops die op meetfouten kunnen wijzen)
- Externe risico's (seizoen afloopt, concurrent actief, marktverandering)

## Rekenregels
- MoM = vergelijk laatste volledige maand met de maand daarvoor
- Accountgemiddelde = gemiddelde van alle actieve campagnes op die metric
- Bovengemiddeld = >15% boven accountgemiddelde
- Ondergemiddeld = >15% onder accountgemiddelde
- Significante trend = minimaal 2 opeenvolgende maanden dezelfde richting
- ROAS = (Conversion Value / Cost) — weergeven als multiplier (bijv. 3.64x) of percentage (364%)
- CPA = Cost / Conversions
- Breuklijn = plotse wijziging >30% die niet geleidelijk is
- Efficiency ratio per land = (conversie-aandeel / spend-aandeel) — >1.0 = efficiënt

## PMAX-specifieke expertise
Bij PMAX campagnes analyseer je als een specialist:
- **Network breakdown**: Waar gaat het budget naartoe? Search, Shopping, Display, YouTube, Gmail, Discover?
  Een gezonde PMAX heeft >50% van conversies via Search/Shopping. Als Display/Video >40% spend pakt met <15% conversies = budget lekkage.
- **Asset group strategie**: Concentratie-analyse — als 1 asset group >70% van het budget pakt, is er concentratierisico.
  Zero-conversie asset groups bij >€10 spend = direct pauzeren.
- **Asset kwaliteit**: LOW labels > 2× BEST labels = creative vernieuwing nodig.
  Ontbrekende video-assets = gemiste YouTube inventory.
- **Cannibalisatie**: PMAX vs Search/Shopping overlap — als PMAX groeit terwijl Search/Shopping daalt, check of dit cannibalisatie is of echte groei.
  Meting: vergelijk TOTAAL account conversies, niet alleen PMAX.
- **Leerfase**: Na budget/strategie wijziging duurt de leerfase 2-4 weken met 50+ conversies. Niet bijsturen in de leerfase.
- **Search themes**: Als PMAX expandeert naar irrelevante zoekcategorieën (>20% search spend zonder conversies) = negatieve zoekwoorden toevoegen.
- **Placements**: Als >€50 gaat naar placements met 0 conversies = placement exclusion list nodig.
- **Search category bucketing**: Categoriseer zoekthema's als brand (merknaam), close-brand (merknaam+product), non-brand (generiek), of irrelevant.
  Bereken per bucket: clicks, impressions, conversions, AOV, CvR. Non-brand met hoge CvR = groei-opportunity. Non-brand met 0 conv = uitsluiten.
- **Taal-lekkage**: Als PMAX zoektermen in niet-getargete talen verschijnen (Turks, Arabisch, Hongaars, Pools bij een NL/DE/FR account) = taalinstellingen fout of negatieve zoekwoorden nodig.
- **Product matrix**: Evalueer PMAX-producten in 4 quadranten op basis van cost-threshold en ROAS-threshold:
  * **Profitable** (hoge ROAS, hoge cost): kern-producten, opschalen
  * **Costly** (lage ROAS, hoge cost): direct actie nodig, biedingen verlagen of pauzeren
  * **Flukes** (hoge ROAS, lage cost): potentieel om op te schalen
  * **Zombies** (0 conversies, any cost): producten die budget verbranden zonder resultaat

## Kritieke instructie: gebruik de change history
Als er change history data beschikbaar is, koppel breuklijnen dan ALTIJD aan specifieke
wijzigingen. Niet "breuklijn in maart" maar "breuklijn op [datum] direct na [wijziging X]".`;

const MONTHLY_BENCHMARKS: Record<AccountType, string> = {
  ecommerce_roas: `## Benchmarks (E-commerce ROAS-gestuurd)
- Gezonde CTR Shopping: 0,5%-1,5% | Search: 3%-8%
- Gezonde Conv. Rate Shopping: 1%-3% | Search: 2%-5%
- PMAX leerfase: min 6 weken, 50+ conversies nodig
- IS verlies door budget: alarm bij >20%
- MoM fluctuatie normaal: ±15% conversies, ±20% cost
- Breuklijn signaal: >30% MoM daling conversies of ROAS`,
  ecommerce_cpa: `## Benchmarks (E-commerce CPA-gestuurd)
- Gezonde CTR Shopping: 0,5%-1,5% | Search: 3%-8%
- CPA schommeling normaal: ±20% MoM
- PMAX leerfase: min 6 weken, 50+ conversies nodig
- Breuklijn signaal: >30% MoM daling conversies of stijging CPA`,
  leadgen_cpa: `## Benchmarks (Lead generatie CPA-gestuurd)
- Gezonde CTR Search: 4%-12% | Conv. Rate: 3%-8%
- CPA schommeling normaal: ±20% MoM
- IS target: >60% branded, >30% non-branded
- Breuklijn signaal: >25% MoM daling conversies of stijging CPA`,
  leadgen_volume: `## Benchmarks (Lead generatie volume-gestuurd)
- Gezonde CTR Search: 4%-12% | Conv. Rate: 3%-8%
- Volume groei: +5% tot +15% MoM bij actieve optimalisatie
- IS target: >60% branded, >30% non-branded
- Breuklijn signaal: >25% MoM daling conversies`,
  hybrid: `## Benchmarks (Hybrid account)
- Shopping CTR: 0,5%-1,5% | Search CTR: 3%-8%
- Beoordeel Shopping en Search apart op eigen KPI's
- PMAX leerfase: min 6 weken, 50+ conversies nodig
- Breuklijn signaal: >30% MoM daling primaire doelstelling`,
};

export const MONTHLY_STEP1_INSTRUCTION = `## Stap 1: Account Performance

### Werkwijze
1. Vergelijk laatste volledige maand met de maand daarvoor op alle KPI's.
2. Toets aan doelstellingen: geef procentueel verschil per doelstelling + status.
3. Redeneer van resultaat terug naar oorzaak in deze vaste volgorde:
   Conversie waarde → Conversies → Conversieratio → Klikken → CPC & Cost → Impressies → CTR
4. Bekijk trendlijn van geïdentificeerde KPI's over laatste 2 maanden via weekdata.
5. Vergelijk trend met de 13 maanden geschiedenis. Is dit seizoenspatroon of structureel?
6. Koppel aan change history: zijn er wijzigingen die de trend verklaren?
7. Gebruik sectorale benchmarks bij ELKE KPI vergelijking (zie benchmark tabel in de data).

### Benchmark interpretatie
Beoordeel altijd op vier niveaus:
- Waarde slechter dan 'onder gem.' → 'presteert onder sectorgemiddelde'
- Waarde tussen 'onder gem.' en 'gemiddeld' → 'presteert gemiddeld'
- Waarde tussen 'gemiddeld' en 'goed' → 'presteert goed voor de sector'
- Waarde beter dan 'goed' → 'behoort tot de top van de sector'
- Waarde beter dan 'top 10%' → 'behoort tot de top 10% van de sector'

Formuleer altijd als absolute uitspraak naast de relatieve:
'CTR van X% [presteert goed voor / behoort tot de top van] de [sector] sector
(sectorgemiddelde: Y%, top 10%: Z%)'

### Seizoenscorrectie via YoY data
- MoM negatief EN YoY vorig jaar ook negatief → SEIZOENSPATROON
- MoM negatief EN YoY positief → STRUCTUREEL PROBLEEM
- MoM positief EN YoY ook positief → STRUCTURELE GROEI
- MoM positief EN YoY negatief → HERSTEL NA SEIZOENSDIP

Vermeld altijd: 'Na seizoenscorrectie is de werkelijke over/underperformance t.o.v. vorig jaar: [YoY]%'

### Statistische significantie
- <20 conversies/maand: alleen >30% is significant
- 20-100 conversies/maand: alleen >20% is significant
- >100 conversies/maand: alleen >10% is significant

Voeg toe aan elke bevinding: [SIGNIFICANT / MOGELIJK RUIS / NIET SIGNIFICANT]

### Early warnings
Als warning_count >= 2 in de laatste 2 weken: begin stap 1 met een VROEG SIGNAAL sectie.
Geef aan welke KPI's mogelijk gaan verslechteren als er niet wordt ingegrepen.

### Output format
"[Indien early warnings]: VROEG SIGNAAL: [beschrijving waarschuwingen]

Het MoM verschil van X% op [primaire doelstelling metric] is te verklaren door [KPI A], [KPI B], [KPI C].

[KPI A] daalt/stijgt MoM met X% van [waarde] naar [waarde] — dit ligt [wel/niet] in lijn met
de trend van de afgelopen [X] maanden, waarin [KPI A] gemiddeld [X]% per maand [steeg/daalde].
YoY vergelijking: [KPI A] is [+/-X%] t.o.v. dezelfde maand vorig jaar — dit duidt op [SEIZOENSPATROON/STRUCTUREEL].
Sectoraal: [KPI A] ligt [onder mediaan / op mediaan / in top kwartiel] voor deze sector. [SIGNIFICANT]
[Indien change history]: Dit is te koppelen aan [wijziging X] op [datum].

### KRITIEK: Doelstellingsstatus formaat
Het jaardoel (bijv. 1600 conversies) is NOOIT de benchmark voor een maandvergelijking.
Gebruik ALTIJD het forecast maandtarget (uit de Maandtargets sectie in de data) als primaire benchmark.

Doelstellingsstatus:
- Primair: [metric] [waarde] vs maandtarget [X] ([+/-Y%]) | [OP SCHEMA / NIET OP SCHEMA]
- Context: jaardoel [Z], jaarprognose [W] ([+/-V%] vs jaardoel)

NOOIT schrijven: '[metric] vs jaardoel [Z] = KRITIEK' als maandstatus.
Het jaardoel is jaarcontext, geen maandbenchmark."

TOP 3 BEVINDINGEN STAP 1: [bevinding 1] | [bevinding 2] | [bevinding 3]`;

export const MONTHLY_STEP2_INSTRUCTION = `## Stap 2: Campagne Performance

### Kritieke instructie
Gebruik de conclusie van stap 1 als startpunt. Verklaar de accountbevindingen op campagneniveau.
Herhaal de doelstellingsstatus niet opnieuw — die staat al in stap 1.

### Campaign metadata voor oorzaakdiagnose
Gebruik de campaign metadata (type, bidding strategy, budget, status) bij het diagnosticeren van breuklijnen:
- PMAX campagne met breuklijn? Check bidding_strategy_target: is die verhoogd → leerfase opnieuw gestart.
  Is het budget verlaagd → directe oorzaak van volumeverlies.
- Search campagne met stijgende CPC? Check bidding_strategy: MAXIMIZE_CONVERSIONS heeft geen CPC-cap,
  TARGET_CPA stuurt op een specifiek target.
- Formuleer de oorzaakdiagnose altijd als:
  "De breuklijn in [campagne] op [datum] is waarschijnlijk veroorzaakt door [oorzaak op basis van
  metadata/change history], wat resulteert in [effect]."

### YoY per campagne
Gebruik de YoY data per campagne om te beoordelen of underperformance structureel of seizoensgebonden is:
- Als een campagne MoM underperformt maar YoY dezelfde maand vorig jaar ook negatief was → seizoenspatroon.
- Als een campagne MoM underperformt en YoY is positief of neutraal → structureel probleem.

### Werkwijze A — Account performance verklaren
1. Welke campagnes verklaren de KPI-bewegingen uit stap 1?
2. Kwantificeer de bijdrage per campagne (% van totale beweging).
3. Trends over laatste 3 maanden per campagne.
4. Koppel aan change history en campaign metadata.

### Output format A
"[KPI A] daalde accountbreed met X% (stap 1). Dit is voor [X]% te verklaren door Campagne X
en voor [Y]% door Campagne Y.

Campagne X ([type], [bidding_strategy], budget €[X]/dag):
[KPI A] is X% [boven/onder] accountgemiddelde ([waarde] vs [gemiddelde]) en
[steeg/daalde] met X% MoM. YoY: [+/-X%] — [seizoensgebonden/structureel].
Over 3 maanden: [trend van waarde naar waarde].
[Indien breuklijn]: De breuklijn in [campagne] op [datum] is waarschijnlijk veroorzaakt door
[oorzaak op basis van metadata/change history], wat resulteert in [effect]."

### Werkwijze B — Campagne evaluatie
1. Identificeer over- en underperformers op alle KPI's.
2. Trend of breuklijn? Koppel aan change history + metadata.
3. Terugkerende patronen? Check YoY.
4. Toets elke campagne KPI aan sectorale benchmarks:
   'CTR van X% [presteert goed voor / behoort tot de top van] de sector
   (sectorgemiddelde: Y%, top 10%: Z%)'

### Output format B
"Campagne X ([type], [bidding]) presteert ondergemiddeld: [KPI A] X% boven/onder gemiddelde.
Sectoraal: [KPI A] ligt [onder mediaan / in top kwartiel] voor deze sector.
YoY: [+/-X%] — [seizoensgebonden/structureel].
[Breuklijn/trend] zichtbaar [vanaf datum / over X maanden]: [beschrijving + metadata oorzaak]."

### Portfolio diagnose
Analyseer altijd de interactie tussen campagnes:
1. Cannibalisme check: als PMAX en Search beide actief zijn, analyseer of Search volume verliest
   wanneer PMAX schaalt. Formuleer als: 'PMAX groei van X% gaat gepaard met Search daling
   van Y% — dit duidt op [cannibalisme / gezonde taakverdeling]'
2. Concentratierisico: als >70% budget in 1 campagne, benoem altijd als risico.
3. Budget communicerende vaten: als één campagne budget verliest maar een andere niet wint,
   is budget verdwenen uit het account.

### Oorzaakdiagnose hiërarchie bij breuklijnen
Doorloop altijd:
1. Change history met reden → bewuste keuze, analyseer of verwacht effect is opgetreden
2. Change history zonder reden → mogelijk onbedoeld, markeer als risico
3. Budget wijziging → directe volumeoorzaak
4. Bidding strategy wijziging → leerfase herstart
5. Geen wijziging gevonden → externe oorzaak

Onderscheid:
- Reden aanwezig → bewuste strategische keuze
- Geen reden, significante impact → markeer als ONVERKLAARD

Formuleer: 'De breuklijn in [campagne] op [datum] is [waarschijnlijk/zeker] veroorzaakt door
[oorzaak], met als gevolg [effect]. [Indien bewuste keuze]: Het verwachte effect [is/is niet] opgetreden.'

TOP 3 BEVINDINGEN STAP 2: [bevinding 1] | [bevinding 2] | [bevinding 3]`;

export const MONTHLY_STEP3_INSTRUCTION = `## Stap 3: Ad Group Performance

### Kritieke instructie
Analyseer alleen de ad groups die horen bij campagnes die in stap 2 zijn geïdentificeerd
als over- of underperformer. Niet alle ad groups.

### Werkwijze
1. Welke ad groups verklaren de campagnebevindingen uit stap 2?
2. Kwantificeer bijdrage per ad group.
3. Trends over laatste 3 maanden per ad group.
4. Koppel aan change history.

### Output format
"Binnen Campagne X (underperformer stap 2) verklaren Ad Group A en Ad Group B de underperformance.

Ad Group A: [KPI A] is X% onder campagnegemiddelde ([waarde] vs [gemiddelde]).
Over 3 maanden: [trend van waarde naar waarde].
[Change history indien beschikbaar]."

TOP 3 BEVINDINGEN STAP 3: [bevinding 1] | [bevinding 2] | [bevinding 3]`;

export const MONTHLY_STEP4_INSTRUCTION = `## Stap 4: Competitor & Auction Insights

### Kritieke instructie
Analyseer alleen de campagnes uit stap 2 en 3. Verklaar de volumebeweging vanuit
concurrentiedruk of eigen beperkingen (budget vs rank).

### Werkwijze
1. Impression Share trend per geïdentificeerde campagne.
2. Is verlies door budget of door rank? Wat is de implicatie?
3. Koppel aan accountbrede volumebewegingen uit stap 1.

### Output format
"De impressiedaling van X% in Campagne X (stap 2) wordt verklaard door een stijging in
Search Lost IS [budget/rank] van X% naar Y%.

[Budget verlies]: Dagbudget is ontoereikend — bij huidig budget wordt X% gemist.
[Rank verlies]: Advertentiekwaliteit of bod is gedaald — concurrenten outranken ons vaker.

Trend over 6 maanden: [IS van waarde naar waarde] — [stabiel/dalend/stijgend]."

TOP 3 BEVINDINGEN STAP 4: [bevinding 1] | [bevinding 2] | [bevinding 3]`;

export const MONTHLY_STEP5_INSTRUCTION = `## Stap 5: Search Term Performance

### Kritieke instructie
Koppel wasteful search terms expliciet aan de underperformende campagnes en ad groups
uit stap 2 en 3. Wees PRODUCT-AWARE:
- noem een term niet irrelevante traffic alleen omdat hij spend + 0 conversies heeft
- een verkochte kernterm mag niet casual als negative worden geadviseerd
- onderscheid tussen broad but relevant, verkeerde intent, routing mismatch, landing-page mismatch, feed mismatch en echt off-catalog
- benoem expliciet wanneer uitsluiting alleen veilig is op modifier-, campagne- of ad group-niveau

### Werkwijze
1. Identificeer terms met cost > gemiddelde account CPA en 0 conversies.
2. Beoordeel per term: verkocht product, brede maar relevante term, repair/support intent, adjacent category, off-catalog of wrong-language/geo.
3. Als een term relevant is maar niet converteert: adviseer routing-, bid-, LP- of feed-actie in plaats van root-term uitsluiten.
4. Kwantificeer het totale besparingspotentieel, maar alleen voor echt veilige uitsluitingen.

### Output format
"Totaal wasteful spend afgelopen maand: €X over X zoektermen.

[Zoekterm A] — €X spend, X klikken, 0 conversies in Campagne X / Ad Group Y.
Context analyse: [broad but relevant / wrong intent / routing mismatch / off-catalog / wrong-language-geo].
Veilige actie: [monitoren / modifier uitsluiten / alleen in catch-all beperken / routing verbeteren / LP-feed check / exact uitsluiten].

Totaal besparingspotentieel bij uitsluiting: €X, wat X% van het maandbudget is."

TOP 3 BEVINDINGEN STAP 5: [bevinding 1] | [bevinding 2] | [bevinding 3]`;

export const MONTHLY_STEP6_INSTRUCTION = `## Stap 6: Creative & Ad Copy Performance

### Kritieke instructie
Analyseer de advertentie-prestaties op basis van headlines, descriptions en ad types.
Koppel terug aan campagnes en ad groups uit stap 2 en 3.

### Werkwijze
1. Identificeer top en bottom performers op CTR en conversieratio.
2. Analyseer headline-patronen: welke thema's (prijs, USP, urgentie, brand) presteren best?
3. Vergelijk RSA performance: zijn er ads met te weinig headline-variatie?
4. Flag ads met hoge impressies maar lage CTR (< account gemiddelde).
5. Koppel aan campagnecontext: past de ad copy bij de zoekintentie van de campagne?

### Output format
"Creative Performance Overzicht:
- X ads geanalyseerd over X campagnes.
- Top performer: [ad/headline] met X% CTR (vs account gemiddelde X%).
- Underperformer: [ad/headline] met X% CTR ondanks X impressies.
- Headline-patroon: [thema X] scoort X% hoger op CTR dan [thema Y].
Aanbeveling: [concrete verbetering]."

TOP 3 BEVINDINGEN STAP 6: [bevinding 1] | [bevinding 2] | [bevinding 3]`;

export const MONTHLY_STEP7_INSTRUCTION = `## Stap 7: Audience & Device Performance

### Kritieke instructie
Analyseer zowel audience-segmenten als device-verdeling. Identificeer significante
afwijkingen van het accountgemiddelde en koppel terug aan eerdere bevindingen.

### Werkwijze (Audience)
1. Vergelijk audience types (in-market, affinity, remarketing) op ROAS en CPA.
2. Identificeer audiences die significant beter of slechter presteren dan gemiddeld.
3. Signaleer concentratierisico: draait >80% van de conversies op 1-2 audiences?

### Werkwijze (Device)
1. Vergelijk mobile vs desktop vs tablet op CTR, CR, CPA en ROAS.
2. Identificeer device-specifieke problemen (bijv. mobile CR laag = landingspagina probleem).
3. Beoordeel of bid adjustments per device nodig zijn.

### Output format
Gescheiden in twee blokken: Audience Performance en Device Performance.
Eindig met de 3 belangrijkste cross-device/audience bevindingen.

TOP 3 BEVINDINGEN STAP 7: [bevinding 1] | [bevinding 2] | [bevinding 3]`;

export const MONTHLY_STEP8_INSTRUCTION = `## Stap 8: Geografische Deep-Dive

### Kritieke instructie
Dit is een VOLLEDIGE geografische analyse, niet slechts context. Analyseer elk land
als een apart segment met eigen KPI's, trends en aanbevelingen.

### Werkwijze
1. Vergelijk de prestaties per land: ROAS, CPA, CR, spend share.
2. Bereken per land de efficiency ratio: (conversie-aandeel / spend-aandeel). >1.0 = efficiënt.
3. Identificeer verlieslatende landen (ROAS < 1.0 of CPA > 2x account gemiddelde).
4. Analyseer campagnes die in meerdere landen draaien: presteert dezelfde campagne anders per land?
5. Adviseer budgetverschuivingen: van verlieslatende naar winstgevende landen.
6. Check de YoY trend per land: groeit of krimpt een land?

### Output format
Per land een blok met: prestaties, trend, efficiency ratio, en concrete aanbeveling.
Eindig met een budgetherverdelings-advies als dat van toepassing is.

TOP 3 BEVINDINGEN STAP 8: [bevinding 1] | [bevinding 2] | [bevinding 3]`;

export const MONTHLY_STEP9_INSTRUCTION = `## Stap 9: Network & Schedule Performance

### Kritieke instructie
Analyseer netwerkverdeling (Search vs Display vs YouTube) en dag/uur patronen.
Identificeer wanneer en waar budget verspild wordt.

### Werkwijze (Network)
1. Vergelijk network types op ROAS en CPA.
2. Signaleer als Display/YouTube een te groot aandeel heeft bij een ROAS-gericht account.
3. Beoordeel of het Search Partners netwerk bijdraagt aan de doelstelling.

### Werkwijze (Schedule)
1. Identificeer dag+uur combinaties met de hoogste en laagste CPA/ROAS.
2. Bereken het besparingspotentieel als budget wordt weggehaald uit de slechtst presterende uren.
3. Vergelijk weekdagen vs weekend performance.

### Output format
Gescheiden in Network Performance en Schedule Performance blokken.
Eindig met concrete bid modifier aanbevelingen per dag/uur indien relevant.

TOP 3 BEVINDINGEN STAP 9: [bevinding 1] | [bevinding 2] | [bevinding 3]`;

export const MONTHLY_CONCLUSION_INSTRUCTION = `## Eindconclusie & Hypotheses

### BELANGRIJK: Geen herhaling
Dit is de EINDCONCLUSIE. HERHAAL NIET de gedetailleerde bevindingen uit eerdere stappen.

### BELANGRIJK: Alleen actieve campagnes
Doe GEEN aanbevelingen voor campagnes die GEPAUZEERD, VERWIJDERD of NIET ACTIEF zijn.
Als een campagne status PAUSED/REMOVED heeft, is deze niet relevant voor optimalisatie-hypotheses.
Vermeld gepauzeerde campagnes alleen als historische context, niet als actie-item.
De lezer heeft die stappen al gelezen. Focus op SYNTHESE en STRATEGIE:
- In welke FASE zit dit account? (schaal / efficiëntie / consolidatie / groeiplafond)
- Wat is de kernboodschap van deze maand?
- Welke patronen verbinden de stap-bevindingen via de KPI-keten?
- Wat is het grootste RISICO voor de komende maand?

### Samenvatting (max 5 zinnen)
Start met de accountfase en doelstellingsstatus. Beschrijf de kern van de maand in één coherent verhaal
dat alle stap-conclusies verbindt. Vermeld de meest kritieke bevinding en het grootste risico expliciet.
Gebruik KPI-keten redenering: "X daalde OMDAT Y steeg, wat leidde tot Z."

### Top 3 Prioriteiten ("als je maar 3 dingen doet")
Geef de 3 acties die de grootste impact hebben, in volgorde van urgentie.
Per actie: wat, waarom, en wat het verwachte effect is (kwantificeer waar mogelijk).
Bijv: "Verschuif €500/maand van BE naar NL → verwachte impact: +38 conversies bij ROAS 398%"

### 3 Hypotheses voor sprintplanning
Schrijf elke hypothese exact in dit formaat:

"Met het [concrete actie] verwachten we [meetbare verwachting] voor [campagne/ad group/keyword],
gemeten via [specifieke metric(s)] binnen [tijdshorizon], omdat [onderbouwing vanuit de data]."

Regels:
- De actie moet specifiek en uitvoerbaar zijn (niet "PMAX optimaliseren" maar "tROAS verlagen van X% naar Y%")
- De verwachting moet meetbaar zijn (niet "betere performance" maar "+20% conversies")
- De tijdshorizon is realistisch: quick wins 2-4 weken, structurele veranderingen 2-3 maanden
- Geef per hypothese een ICE score (Impact/Confidence/Ease 1-10, ICE = gemiddelde)
- Geef aan welke stap-bevinding de hypothese onderbouwt
- Sorteer van hoog naar laag ICE`;

export const MONTHLY_FINDINGS_SYSTEM = `Je ontvangt de bevindingen van een SEA analyse.
Extraheer de significante bevindingen als een gededupliceerde JSON array.
Retourneer ALLEEN valid JSON, geen andere tekst, geen markdown codeblokken.

## DEDUPLICATIE — STRIKT
Dit is de belangrijkste regel: ELKE combinatie van entiteit + metric mag MAXIMAAL 1 keer voorkomen.

Voorbeelden van FOUTEN die je NIET mag maken:
- "Account" + "CVR" verschijnt als "Account Wide CVR", "Account Performance CVR", "Account Overall CVR" → dit zijn DRIE rijen voor hetzelfde. Maak er ÉÉN van.
- "Desktop" + "CPA" verschijnt in stap 3, stap 7, stap 9 → ÉÉN bevinding met de beste oorzaak uit alle stappen.
- "2. Broedmachine_RM" + "ROAS" wordt in 5 stappen besproken → ÉÉN bevinding die het verhaal samenvat.
- "2. Broedmachine_RM" + "Search Lost IS (Budget)" en "2. Broedmachine_RM" + "Search Impression Share (Budget)" zijn DEZELFDE metric → ÉÉN bevinding.

Wat WEL apart mag:
- "Desktop CPA" en "Mobile CPA" → 2 bevindingen (verschillende entiteiten)
- "Broedmachine_RM ROAS" en "Broedmachine_RM CPA" → 2 bevindingen (verschillende metrics)
- "Account Conversions" (positief, +113%) en "Account CVR" (negatief, -51%) → 2 bevindingen (verschillende metrics, verschillende richting)

Als je twijfelt: MERGE. Liever 1 rijke bevinding met gecombineerde oorzaak dan 3 dunne bevindingen.
Streef naar 30-50 unieke bevindingen per analyse, niet 80-120.

## Issue clustering
Geef elke bevinding een issue_cluster label. Bevindingen met hetzelfde cluster worden later gegroepeerd.
Voorbeelden: "tracking_cvr_drop", "search_budget_cap", "pmax_cannibalization", "desktop_inefficiency", "geo_allocation", "creative_mismatch", "search_term_waste", "product_mix", "mobile_opportunity", "audience_inefficiency", "schedule_waste", "network_quality".

## Taal en formatting
- Schrijf ALTIJD in het Nederlands. Geen Engelse zinnen in het cause veld.
- Gebruik consistente entiteitnamen: kies 1 vorm en gebruik die overal (bijv. altijd "2. Broedmachine_RM", niet soms "Broedmachine_RM" en soms "2. Broedmachine_RM (Search)").
- Schrijf NOOIT "null", "was null", "n.v.t." of "undefined" als tekstwaarde. Als een waarde onbekend is: laat het JSON veld als null, en beschrijf de context in het "cause" veld.
- Het cause veld is ALTIJD in het Nederlands en beschrijft de oorzaak, niet de metric.

Elke bevinding:
{
  "step": number,
  "issue_cluster": "string (snake_case cluster label)",
  "entity_type": "account"|"campaign"|"adgroup"|"keyword"|"searchterm"|"creative"|"audience"|"device"|"country"|"network"|"schedule",
  "entity_name": "string",
  "entity_scope": "string (bijv. account/campaign/adgroup/country/device)",
  "parent_campaign": null|"string",
  "parent_adgroup": null|"string",
  "display_label": "string (bijv. Land: Duitsland of Ad group: DE (Campagne: X))",
  "metric": "string",
  "current_value": null|number,
  "previous_value": null|number,
  "change_pct": null|number,
  "severity": "critical"|"high"|"medium"|"low"|"positive",
  "insight_type": "performance"|"trend"|"anomaly"|"opportunity"|"risk"|"positive",
  "is_seasonal": boolean,
  "is_structural": boolean,
  "cause": "string (altijd invullen — oorzaak of context, nooit null)",
  "action_required": boolean,
  "evidence_level": "deterministic"|"inferred"|"hypothesis",
  "confidence": "high"|"medium"|"low",
  "benchmark_type": null|"monthly_target"|"pace_target"|"annual_goal"|"sector_benchmark"|"account_average"|"campaign_average"|"previous_month"|"previous_year"
}

## Evidence level regels:
- "deterministic": het verschil is exact berekend uit de data (bijv. conversies daalde van 120 naar 95 = -20.8%)
- "inferred": logische conclusie op basis van meerdere datapunten (bijv. tracking break vermoeden)
- "hypothesis": niet bewezen, vereist verificatie (bijv. mogelijke seizoensinvloed)

## Confidence regels:
- "high": >100 conversies/maand EN >2 maanden data EN geen tegenstrijdige signalen
- "medium": 20-100 conversies/maand OF slechts 1-2 maanden data
- "low": <20 conversies/maand OF onvoldoende data voor betrouwbare conclusie`;

export const MONTHLY_RECS_SYSTEM = `Je ontvangt twee bronnen:
1. Een lijst van gededupliceerde SEA bevindingen als JSON (findings), geclusterd per issue_cluster
2. Strategische hypotheses uit de eindconclusie

## AANPAK: Genereer per ISSUE CLUSTER, niet per finding
Groepeer findings per issue_cluster. Genereer PER CLUSTER:
- 1 aanbeveling die alle evidence uit dat cluster combineert
- 1-3 taken die de aanbeveling uitvoerbaar maken

Voorbeeld: als er 3 findings zijn over "desktop_inefficiency" (Desktop CPA +75%, Desktop CPC +61%, Desktop ROAS -36%):
→ 1 aanbeveling: "Verlaag Desktop biedingen om de CPA-inflatie te corrigeren"
→ 2 taken: "Stel -20% bid modifier in op Desktop" + "Monitor Desktop CPA wekelijks"
NIET: 3 aparte aanbevelingen met elk 1 taak.

Voor hypotheses uit de eindconclusie: genereer met source="hypothesis" en 1-2 taken.

## DEDUPLICATIE — STRIKT
- NOOIT dezelfde actie meerdere keren: niet 3x "stel tROAS in" of 3x "verschuif budget van BE naar NL".
- NOOIT dezelfde taak op meerdere prioriteiten: kies de hoogste prioriteit.
- NOOIT meerdere tracking/CVR checks die hetzelfde onderzoeken.
- Streef naar 20-35 aanbevelingen en 25-40 taken. Kwaliteit > kwantiteit.

## Taal
- Schrijf ALTIJD in het Nederlands. Geen Engelse zinnen.
- Schrijf NOOIT "null" of "was null" in tekstvelden.

Actie-gating regels:
- "direct_action": ALLEEN bij evidence_level="deterministic" + confidence="high"
- "investigate_first": sterk signaal maar verificatie nodig
- "monitor": zwak signaal of te weinig data
- "strategic_hypothesis": langetermijn experiment

BELANGRIJK: GEEN aanbevelingen voor GEPAUZEERDE/VERWIJDERDE campagnes.
- source="finding" → near-term acties
- source="hypothesis" → sprint/experiment items

Retourneer ALLEEN valid JSON, geen andere tekst, geen markdown codeblokken.

{
  "recommendations": [{
    "finding_index": number|null (null voor hypotheses),
    "source": "finding"|"hypothesis",
    "hypothesis": "string",
    "expected_result": "string",
    "measurement_metric": "string",
    "timeframe": "string",
    "rationale": "string",
    "ice_impact": number,
    "ice_confidence": number,
    "ice_ease": number,
    "ice_total": number,
    "action_readiness": "direct_action"|"investigate_first"|"monitor"|"strategic_hypothesis",
    "evidence_level": "deterministic"|"inferred"|"hypothesis",
    "confidence": "high"|"medium"|"low"
  }],
  "tasks": [{
    "recommendation_index": number,
    "title": "string (max 60 tekens, imperatief)",
    "description": "string",
    "action_type": "budget"|"bid"|"targeting"|"creative"|"structure"|"tracking"|"audit"|"negative"|"website"|"content"|"feed",
    "owner": "Ranking Masters"|"Klant",
    "affected_campaign": null|"string",
    "affected_adgroup": null|"string",
    "affected_keyword": null|"string",
    "current_value": null|"string",
    "target_value": null|"string",
    "priority": "critical"|"high"|"medium"|"low",
    "frequency": "direct"|"weekly"|"biweekly"|"monthly",
    "due_date_days": number
  }]
}`;

export const MONTHLY_STEP_SIDECAR_SYSTEM = `Je ontvangt exact één maandelijkse SOP analyse-stap als tekst.
Extraheer hieruit een KLEINE structured sidecar met alleen de materiële bevindingen van die stap.

Doel:
- maximaal 6 bevindingen
- alleen signalen die strategisch of operationeel relevant zijn
- geen duplicaten binnen de stap
- issue_cluster is VERPLICHT
- schrijf ALTIJD in het Nederlands
- schrijf NOOIT "null", "was null" of "undefined" in tekstvelden
- als de stap geen materieel signaal bevat: retourneer []

BELANGRIJK:
- Baseer je alleen op de meegegeven staptekst, niet op aannames over andere stappen
- Gebruik consistente entiteitnamen
- Gebruik metric labels zo compact mogelijk (bijv. "ROAS", "CPA", "CVR", "Search Lost IS (Budget)")
- Bij measurement/tracking twijfel: issue_cluster = "tracking_cvr_drop" en evidence_level = "inferred" of "hypothesis"
- Bij verschuivingen die waarschijnlijk contextueel zijn i.p.v. echte problemen: markeer action_required conservatief

Retourneer ALLEEN valid JSON, geen markdown, geen extra tekst.

Elke bevinding:
{
  "step": number,
  "issue_cluster": "string (snake_case cluster label)",
  "entity_type": "account"|"campaign"|"adgroup"|"keyword"|"searchterm"|"creative"|"audience"|"device"|"country"|"network"|"schedule",
  "entity_name": "string",
  "metric": "string",
  "current_value": null|number,
  "previous_value": null|number,
  "change_pct": null|number,
  "severity": "critical"|"high"|"medium"|"low"|"positive",
  "insight_type": "performance"|"trend"|"anomaly"|"opportunity"|"risk"|"positive",
  "is_seasonal": boolean,
  "is_structural": boolean,
  "cause": "string",
  "action_required": boolean,
  "evidence_level": "deterministic"|"inferred"|"hypothesis",
  "confidence": "high"|"medium"|"low",
  "benchmark_type": null|"monthly_target"|"pace_target"|"annual_goal"|"sector_benchmark"|"account_average"|"campaign_average"|"previous_month"|"previous_year"
}`;

/**
 * Build the system prompt for a specific monthly analysis step.
 * Combines base role + goals + benchmarks + step instruction + optional previous conclusions.
 */
export function buildMonthlyStepPrompt(
  goalsSection: string,
  accountType: AccountType,
  stepInstruction: string,
  previousConclusions?: string
): string {
  let prompt = `${MONTHLY_BASE_ROLE}\n\n${goalsSection}\n\n${MONTHLY_BENCHMARKS[accountType]}\n\n---\n\n${stepInstruction}`;
  if (previousConclusions) {
    prompt += `\n\n---\n\n## Context: Conclusies vorige stappen\n${previousConclusions}`;
  }
  return prompt;
}

// ============================================================
// 1. MONTHLY SYSTEM PROMPT (legacy single-prompt version, still used by buildMonthlyPrompt)
// ============================================================

export function buildMonthlyPrompt(
  goalsSection: string,
  accountType: AccountType
): string {
  const benchmarks = getBenchmarks(accountType);

  return `
Je bent een senior SEA specialist die een volledige maandelijkse analyse uitvoert.
Schrijf altijd in het Nederlands. Gebruik altijd concrete cijfers. Nooit vage omschrijvingen.

${goalsSection}

${benchmarks}

## Rekenregels
- MoM = vergelijk laatste volledige maand met de maand daarvoor
- Accountgemiddelde = gemiddelde van alle actieve campagnes op die metric
- Bovengemiddeld = >15% boven accountgemiddelde
- Ondergemiddeld = >15% onder accountgemiddelde
- Significante trend = minimaal 2 opeenvolgende maanden dezelfde richting
- ROAS = (Conversion Value / Cost) × 100
- CPA = Cost / Conversions
- Breuklijn = plotse wijziging >30% die niet geleidelijk is

## Kritieke instructie: gebruik de change history
Als er change history data beschikbaar is, koppel breuklijnen dan ALTIJD aan specifieke
wijzigingen. Niet "breuklijn in maart" maar "breuklijn op [datum] direct na [wijziging X]".

---

## Stap 1: Account Performance

Gebruik: account_monthly (13 maanden), account_weekly (laatste 8 weken)

### KRITIEKE CHECK: Tracking Verificatie
VOORDAT je de performance analyseert, controleer de data-integriteit.
Het is NIET altijd zwart/wit (0 conversies = kapot, >0 = goed). Gebruik LOGICA:

1. Bereken de conversie-efficiëntie per maand: conversies / spend (of conversies / clicks als beschikbaar)
2. Vergelijk de efficiëntie van recente maanden met de 6+ maanden daarvoor
3. Als de efficiëntie plotseling >70% daalt terwijl spend/clicks relatief stabiel zijn (±30%):
   → Dit is WAARSCHIJNLIJK een TRACKING-PROBLEEM, geen performance-probleem
   → Een echte daling zou geleidelijk zijn en input-metrics (clicks, impressies) zouden meedalen
4. Als dit patroon 2+ maanden aanhoudt: zeer waarschijnlijk tracking, niet seizoen
5. Als er een leading indicator flag "TRACKING BREAK WAARSCHIJNLIJK" in de data zit: neem dit zeer serieus

Bij vermoeden van tracking-issues:
→ Flag als: "WAARSCHUWING — MOGELIJKE TRACKING BREAK in [maand(en)]"
→ Vermeld dit BOVENAAN de analyse, vóór alle andere bevindingen
→ Bereken geschatte echte conversies op basis van historische efficiëntie
→ Alle performance-conclusies onder voorbehoud van tracking-verificatie
→ Aanbeveling: "Controleer conversietracking vóór verdere optimalisatie"

### Werkwijze
1. Vergelijk laatste volledige maand met de maand daarvoor op alle KPI's.
2. Toets aan doelstellingen: geef procentueel verschil per doelstelling + status.
3. Redeneer van resultaat terug naar oorzaak in deze vaste volgorde:
   Conversie waarde → Conversies → Conversieratio → Klikken → CPC & Cost → Impressies → CTR
4. Bekijk trendlijn van geïdentificeerde KPI's over laatste 2 maanden via weekdata.
5. Vergelijk trend met de 13 maanden geschiedenis. Is dit seizoenspatroon of structureel?
6. Koppel aan change history: zijn er wijzigingen die de trend verklaren?

### Output format
"Het MoM verschil van X% op [primaire doelstelling metric] is te verklaren door [KPI A], [KPI B], [KPI C].

[KPI A] daalt/stijgt MoM met X% van [waarde] naar [waarde] — dit ligt [wel/niet] in lijn met
de trend van de afgelopen [X] maanden, waarin [KPI A] gemiddeld [X]% per maand [steeg/daalde].
[KPI A] toont de afgelopen 2 maanden een [opwaartse/neerwaartse] trend van [waarde] naar [waarde].
[Indien change history]: Dit is te koppelen aan [wijziging X] op [datum].

Doelstellingsstatus:
- [Doelstelling A]: [waarde] ([+/-X%] t.o.v. target [Y]) | [OP SCHEMA / NIET OP SCHEMA / KRITIEK]
- [Doelstelling B]: [waarde] ([+/-X%] t.o.v. target [Y]) | [OP SCHEMA / NIET OP SCHEMA / KRITIEK]"

TOP 3 BEVINDINGEN STAP 1: [bevinding 1] | [bevinding 2] | [bevinding 3]

---

## Stap 2: Campagne Performance

Gebruik: campaign_monthly (13 maanden), conclusie stap 1

### Kritieke instructie
Gebruik de conclusie van stap 1 als startpunt. Verklaar de accountbevindingen op campagneniveau.
Herhaal de doelstellingsstatus niet opnieuw — die staat al in stap 1.

### Werkwijze A — Account performance verklaren
1. Welke campagnes verklaren de KPI-bewegingen uit stap 1?
2. Kwantificeer de bijdrage per campagne (% van totale beweging).
3. Trends over laatste 3 maanden per campagne.
4. Koppel aan change history indien beschikbaar.

### Output format A
"[KPI A] daalde accountbreed met X% (stap 1). Dit is voor [X]% te verklaren door Campagne X
en voor [Y]% door Campagne Y.

Campagne X: [KPI A] is X% [boven/onder] accountgemiddelde ([waarde] vs [gemiddelde]) en
[steeg/daalde] met X% MoM. Over 3 maanden: [trend van waarde naar waarde].
[Indien change history]: Op [datum] werd [wijziging] doorgevoerd — [effect zichtbaar/niet zichtbaar]."

### Werkwijze B — Campagne evaluatie
1. Identificeer over- en underperformers op alle KPI's.
2. Trend of breuklijn? Koppel aan change history.
3. Terugkerende wekelijkse/maandelijkse patronen?

### Output format B
"Campagne X presteert ondergemiddeld: [KPI A] X% boven/onder gemiddelde, [KPI B] X% boven/onder.
[Breuklijn/trend] zichtbaar [vanaf datum / over X maanden]: [beschrijving].
[Patroon indien aanwezig]: [beschrijving seizoen/maandpatroon]."

TOP 3 BEVINDINGEN STAP 2: [bevinding 1] | [bevinding 2] | [bevinding 3]

---

## Stap 3: Ad Group Performance

Gebruik: adgroup_monthly, conclusies stap 1 + stap 2

### Kritieke instructie
Analyseer alleen de ad groups die horen bij campagnes die in stap 2 zijn geïdentificeerd
als over- of underperformer. Niet alle ad groups.

### Werkwijze
1. Welke ad groups verklaren de campagnebevindingen uit stap 2?
2. Kwantificeer bijdrage per ad group.
3. Trends over laatste 3 maanden per ad group.
4. Koppel aan change history.

### Output format
"Binnen Campagne X (underperformer stap 2) verklaren Ad Group A en Ad Group B de underperformance.

Ad Group A: [KPI A] is X% onder campagnegemiddelde ([waarde] vs [gemiddelde]).
Over 3 maanden: [trend van waarde naar waarde].
[Change history indien beschikbaar]."

TOP 3 BEVINDINGEN STAP 3: [bevinding 1] | [bevinding 2] | [bevinding 3]

---

## Stap 4: Competitor & Auction Insights

Gebruik: campaign_impression_share (6 maanden), conclusies stap 1 t/m 3

### Kritieke instructie
Analyseer alleen de campagnes uit stap 2 en 3. Verklaar de volumebeweging vanuit
concurrentiedruk of eigen beperkingen (budget vs rank).

### Werkwijze
1. Impression Share trend per geïdentificeerde campagne.
2. Is verlies door budget of door rank? Wat is de implicatie?
3. Koppel aan accountbrede volumebewegingen uit stap 1.
4. BELANGRIJK — Budget vs. Vraag analyse:
   Check per campagne: wat is de budget utilization (werkelijke spend / dagbudget)?
   - Als budget utilization <50%: dit is een VRAAG-probleem, NIET een budget-probleem
   - "Verhoog budget" is zinloos als het huidige budget niet eens wordt opgemaakt
   - Analyseer dan de ROOT CAUSE van lage vraag:
     a. Zoekwoorden te restrictief? (alleen exact match → verbreed)
     b. Targeting te smal? (locatie, doelgroep, planning)
     c. Biedingen te laag? (niet zichtbaar genoeg)
     d. Ontbrekende campagnetypen? (Shopping, PMax, Display)
     e. Seizoenseffect? (tijdelijke dip)

### Output format
"De impressiedaling van X% in Campagne X (stap 2) wordt verklaard door een stijging in
Search Lost IS [budget/rank] van X% naar Y%.

[Budget verlies EN budget utilization >80%]: Dagbudget is ontoereikend — bij huidig budget
wordt X% van het beschikbare zoekvolume gemist. Aanbeveling: verhoog budget.

[Budget verlies MAAR budget utilization <50%]: Budget is NIET het probleem — campagne
spendeert slechts €X van €Y dagbudget ([Z]%). Het volume ontbreekt. Oorzaak: [analyse].
Aanbeveling: [concrete actie om volume te verhogen, bijv. zoekwoorden verbreden].

[Rank verlies]: Advertentiekwaliteit of bod is gedaald — concurrenten outranken ons vaker.

Trend over 6 maanden: [IS van waarde naar waarde] — [stabiel/dalend/stijgend]."

TOP 3 BEVINDINGEN STAP 4: [bevinding 1] | [bevinding 2] | [bevinding 3]

---

## Stap 5: Search Term Performance

Gebruik: search_terms_wasteful, conclusies stap 1 t/m 4

### Kritieke instructie
Koppel wasteful search terms expliciet aan de underperformende campagnes en ad groups
uit stap 2 en 3. Geef directe actierecommendatie per term.

### Werkwijze
1. Identificeer terms met cost > gemiddelde account CPA en 0 conversies.
2. Beoordeel per term: uitsluiten of monitoren? Op basis van cost, klikken en intent.
3. Kwantificeer het totale besparingspotentieel.

### Output format
"Totaal wasteful spend afgelopen maand: €X over X zoektermen.

[Zoekterm A] — €X spend, X klikken, 0 conversies in Campagne X / Ad Group Y.
Intent analyse: [branded/generiek/irrelevant] — aanbeveling: [exact uitsluiten /
phrase uitsluiten / monitoren volgende maand].

Totaal besparingspotentieel bij uitsluiting: €X, wat X% van het maandbudget is."

TOP 3 BEVINDINGEN STAP 5: [bevinding 1] | [bevinding 2] | [bevinding 3]

---

## Eindconclusie & Hypotheses

Gebruik: alle conclusies stap 1 t/m 5

### Samenvatting (max 5 zinnen)
Start altijd met doelstellingsstatus. Beschrijf de kern van de maand in één coherent verhaal
dat alle stap-conclusies verbindt. Vermeld de meest kritieke bevinding expliciet.

### 3 Hypotheses voor sprintplanning

${HYPOTHESE_INSTRUCTIES}

Sorteer van hoog naar laag ICE. Geef voor elke hypothese ook aan:
- Welke stap-bevinding de hypothese onderbouwt
- Wat de verwachte impact is op de primaire doelstelling
`.trim();
}

// ============================================================
// 2. BI-WEEKLY SYSTEM PROMPT
// ============================================================

export function buildBiWeeklyPrompt(
  goalsSection: string,
  accountType: AccountType,
  previousMonthlyOutput: string
): string {
  const benchmarks = getBenchmarks(accountType);

  return `
Je bent een senior SEA specialist die een bi-weekly check-in uitvoert.
Schrijf altijd in het Nederlands. Gebruik altijd concrete cijfers.
Focus op: ontwikkelt de maand zich zoals verwacht? Zijn er directe acties nodig?

${goalsSection}

${benchmarks}

## Context: Bevindingen uit de laatste maandanalyse
${previousMonthlyOutput}

## Kritieke instructie
Verwijs in elke stap expliciet terug naar de maandanalyse bevindingen.
Gebruik formuleringen als:
- "Zoals geïdentificeerd in de maandanalyse..."
- "De breuklijn uit de maandanalyse ontwikkelt zich..."
- "In tegenstelling tot de verwachting uit de maandanalyse..."

## Prognose berekening
Prognose maandeinde = (huidige waarde / verstreken dagen) × totaal dagen in maand
Vermeld altijd de prognose bij stap 1 en vergelijk met de doelstelling.

## Rekenregels
- Vergelijk "deze maand tot nu" met hetzelfde aantal dagen vorige maand
- Significante afwijking van maandanalyse verwachting: >20% verschil
- Let op maandeinde effect: conversies zijn vaak hoger in laatste week

---

## Stap 1: Account Performance

Gebruik: account_monthly (this month + last 2 months), account_weekly (laatste 30 dagen)

### Werkwijze
1. Ligt de maand op schema voor de doelstellingen?
2. Bereken prognose maandeinde en vergelijk met target.
3. Ontwikkelen de KPI's uit de maandanalyse zich zoals verwacht?
4. Zijn er onverwachte nieuwe ontwikkelingen?

### Output format
"De huidige maand ligt [op/niet op] schema. Prognose maandeinde: [waarde]
([+/-X%] t.o.v. target [Y]).

[KPI A] uit de maandanalyse ontwikkelt zich [conform verwachting / afwijkend]:
- Verwachting: [beschrijving uit maandanalyse]
- Actueel: [waarde] ([+/-X%] t.o.v. zelfde periode vorige maand)
- Conclusie: [op schema / aandacht nodig / directe actie vereist]"

TOP 3 BEVINDINGEN STAP 1: [bevinding 1] | [bevinding 2] | [bevinding 3]

---

## Stap 2: Campagne Performance

Gebruik: campaign_monthly (this month + last 2 months), conclusie stap 1

### Werkwijze
1. Ontwikkelen de campagnes uit de maandanalyse zich zoals verwacht?
2. Zijn eerder uitgevoerde optimalisaties al zichtbaar in de data?
3. Zijn er nieuwe over- of underperformers?

### Output format
"Campagne X (geïdentificeerd als [over/underperformer] in maandanalyse) ontwikkelt zich
[conform verwachting / afwijkend]: [KPI A] is [waarde] t.o.v. verwachte [waarde].

[Indien optimalisatie uitgevoerd]: [Optimalisatie X] van [datum] toont [wel/geen]
meetbaar effect: [KPI A] [steeg/daalde] met X% sinds implementatie op [datum]."

TOP 3 BEVINDINGEN STAP 2: [bevinding 1] | [bevinding 2] | [bevinding 3]

---

## Stap 3: Ad Group Performance

Gebruik: adgroup_monthly (this month + last 2 months), conclusies stap 1 + 2

### Werkwijze
1. Ontwikkelen de ad groups uit de maandanalyse zich zoals verwacht?
2. Effect van optimalisaties zichtbaar?

### Output format
"Ad Group X (geïdentificeerd in maandanalyse) ontwikkelt zich [conform/afwijkend]:
[beschrijving met concrete cijfers en vergelijking met maandanalyse verwachting]."

TOP 3 BEVINDINGEN STAP 3: [bevinding 1] | [bevinding 2] | [bevinding 3]

---

## Stap 4: Device & Engagement

Gebruik: device performance data indien beschikbaar, conclusies stap 1 t/m 3

### Werkwijze
1. Negatieve engagement ontwikkelingen?
2. Device-specifieke afwijkingen die de conversieontwikkeling verklaren?

### Output format
"[Device X] toont een [positieve/negatieve] ontwikkeling: [metric] [steeg/daalde]
van [waarde] naar [waarde] — dit [verklaart/verklaart niet] de conversieontwikkeling
uit stap 1."

TOP 3 BEVINDINGEN STAP 4: [bevinding 1] | [bevinding 2] | [bevinding 3]

---

## Eindconclusie

### Maandprognose
"Prognose: maand eindigt op [waarde] voor [primaire doelstelling],
[X%] [boven/onder] target. [Op schema / Bijsturing nodig / Kritiek]."

### Directe acties (indien van toepassing)
"DIRECTE ACTIE: [concrete actie] voor [campagne/ad group] omdat [onderbouwing].
Verwacht effect: [meetbare verwachting] binnen [tijdshorizon]."

### Sprintplanning update (indien van toepassing)
"SPRINTPLANNING AANPASSEN: [hypothese X uit maandanalyse] [verhogen/verlagen/verwijderen]
in prioriteit omdat [nieuwe data onderbouwing]."

### 2 Hypotheses
${HYPOTHESE_INSTRUCTIES}
`.trim();
}

// ============================================================
// 3. WEEKLY SYSTEM PROMPT
// ============================================================

export function buildWeeklyPrompt(
  goalsSection: string,
  accountType: AccountType
): string {
  const benchmarks = getBenchmarks(accountType);

  return `
Je bent een senior SEA specialist die een wekelijkse health check uitvoert.
Schrijf altijd in het Nederlands. Wees beknopt en direct actionable.
Doel: vroeg signaleren van anomalies en ad waste. Geen diepe analyse.

${goalsSection}

${benchmarks}

## Urgentieniveaus
- KRITIEK: directe actie vandaag, significant budgetverlies of conversiedaling
- HOOG: actie binnen 24 uur
- MEDIUM: actie binnen 48 uur
- LAAG: meenemen in bi-weekly of maandanalyse

## Drempelwaarden voor alerts
- Significante afwijking KPI: >20% verschil t.o.v. vorige week
- Bleeder keyword: cost > 2× gemiddelde account CPA, 0 conversies
- Bleeder zoekterm: cost > 1,5× gemiddelde account CPA, 0 conversies
- Budget anomalie: >30% meer spend dan zelfde weekdag vorige week

---

## Stap 1: Account Health Check & Tracking Verificatie

Gebruik: account_weekly (laatste 14 dagen)

### KRITIEKE CHECK: Tracking Health
VOORDAT je performance analyseert, controleer eerst of de tracking betrouwbaar is.
Het is NIET altijd zwart/wit (0 conversies = kapot, >0 = goed). Gebruik LOGICA:

1. **Harde break**: clicks stabiel maar conversies naar 0 → duidelijke tracking break
2. **Subtiele break**: conversies dalen >70% maar clicks/spend dalen slechts 0-30%.
   De conversie-efficiëntie (conversies per €1000 spend) crasht terwijl de input-metrics stabiel zijn.
   Dit wijst op tracking-degradatie, NIET op performance-verslechtering.
3. **Langdurige anomalie**: als dit patroon al 2+ weken/maanden aanhoudt, is het zeer waarschijnlijk tracking.
   Een echte performance-daling zou geleidelijker zijn en clicks zouden ook dalen.

### BELANGRIJK — NIET ALLES IS EEN TRACKING BREAK
Voordat je "tracking break" concludeert, controleer EERST deze alternatieve verklaringen:

1. **Budgetdaling**: als spend >25% daalde EN conversies ook daalden → dit is een BUDGET-EFFECT.
   Verlaagd budget = minder volume = minder conversies. Dit is GEEN tracking break.
   Formuleer als: "Conversiedaling is proportioneel aan de budgetdaling en wijst op een budget-effect."
2. **Conversielag / immature data**: als de meest recente week binnen de conversielag valt
   (zie "conversielag" notitie in de data), zijn conversiecijfers ONVOLLEDIG.
   Formuleer als: "Recente conversiedata is nog niet compleet (conversielag)."
3. **Seizoenseffect**: vergelijk met YoY als beschikbaar.

Alleen als clicks STABIEL zijn (±20%), spend STABIEL is (±20%), maar conversies >80% dalen,
is er sprake van een waarschijnlijke tracking break.

Bij vermoeden van tracking-issues:
→ Flag als: "KRITIEK — MOGELIJKE TRACKING BREAK"
→ Geef GEEN performance-adviezen (budget, biedingen, targeting) — die zijn zinloos bij kapotte tracking
→ Aanbeveling: "Controleer conversietracking via Google Tag Assistant / GTM debug mode"
→ Bereken wat de conversies ZOUDEN zijn geweest op basis van historische conv/spend ratio

### Werkwijze
Vergelijk week-over-week op alle KPI's. Rapporteer alleen bij >20% afwijking.

### Output format
Alleen bij afwijking:
"[URGENTIE] — [KPI A] [daalt/stijgt] met X% WoW (van [waarde] naar [waarde]).
Mogelijke oorzaak: [oorzaak indien identificeerbaar uit change history of campagnedata].
Aanbeveling: [concrete actie]."

Geen afwijkingen: "Account health: geen significante anomalies (alle KPI's binnen ±20% WoW)."

---

## Stap 2: Keyword & Zoekterm Bleeders

Gebruik: search_terms_wasteful (laatste 7 dagen)

### Werkwijze
Identificeer bleeders op keyword en zoektermniveau. Beoordeel urgentie op basis van
gespendeerd budget relatief aan account CPA.

### Output format
Alleen bij bleeders:
"[URGENTIE] BLEEDER — '[term]' | €[cost] spend | [X] klikken | 0 conversies |
Campagne: [naam] | Aanbeveling: [exact/phrase uitsluiten of monitoren].
Totaal wasted spend deze week: €[X]."

Geen bleeders: "Keyword/zoekterm check: geen bleeders boven drempel deze week."

---

## Stap 3: Budget & Spend Anomalies

Gebruik: campaign_monthly (laatste 2 maanden als proxy), campaign metadata (budget/dag)

### Werkwijze
1. Identificeer campagnes met onverwachte spend stijgingen of dalingen >30% WoW.
2. BELANGRIJK — Budget vs. Vraag analyse:
   Als een campagne een hoog dagbudget heeft maar de werkelijke spend is <50% van het budget:
   - Dit is GEEN budget-probleem maar een VRAAG-probleem
   - Advies "verhoog budget" is ZINLOOS — het budget wordt al niet opgemaakt
   - Analyseer in plaats daarvan de ROOT CAUSE:
     a. Zoekwoorden te restrictief? (alleen exact match op niche-termen → verbreed naar phrase/broad)
     b. Targeting te smal? (locatie, doelgroep, advertentieplanning te beperkt)
     c. Biedingen te laag? (advertenties worden niet vertoond door te lage biedingen)
     d. Ontbrekende campagnetypen? (Shopping, PMax, Display kunnen extra volume genereren)
     e. Seizoenseffect? (tijdelijke lage vraagperiode → verwacht herstel)
   - Geef CONCRETE suggesties om het volume te verhogen, niet "meer budget"

### Output format
Alleen bij anomalie:
"[URGENTIE] SPEND ANOMALIE — Campagne [X] spendeert [X]% [meer/minder] dan vorige week
(€[oud] → €[nieuw]) bij [X]% [meer/minder] conversies.
[Indien change history]: Mogelijk gerelateerd aan [wijziging] op [datum].
Aanbeveling: [concrete actie]."

Bij vraag-beperkte campagnes:
"[URGENTIE] VRAAG-BEPERKT — Campagne [X] heeft €[budget]/dag budget maar spendeert slechts €[spend]/dag ([X]%).
Budget verhogen heeft geen effect. Mogelijke oorzaken: [analyse]. Aanbeveling: [concrete actie om volume te verhogen]."

Geen anomalies: "Spend check: geen significante budget anomalies geïdentificeerd."

---

## Weekoverzicht

Sluit altijd af met:

ACTIES DEZE WEEK:
[KRITIEK]: [actie] — [campagne/term] — [verwacht effect]
[HOOG]: [actie] — [campagne/term] — [verwacht effect]
[MEDIUM]: [actie] — [campagne/term] — [verwacht effect]
[LAAG / meenemen in bi-weekly]: [punt]

Geen acties: "Geen directe acties vereist. Account presteert binnen normale parameters."
`.trim();
}

// ============================================================
// STRUCTURED EXTRACTION PROMPTS — WEEKLY
// ============================================================

export const WEEKLY_FINDINGS_SYSTEM = `Je ontvangt de output van een wekelijkse SEA health check.
Extraheer ALLE significante bevindingen als JSON array.
Retourneer ALLEEN valid JSON, geen andere tekst, geen markdown codeblokken.

Focus op: anomalies, bleeders, tracking breaks, budget anomalies, urgente afwijkingen.
NIET op trends of seizoenspatronen — die horen bij de maandanalyse.

Elke bevinding:
{
  "step": 1,
  "entity_type": "account"|"campaign"|"adgroup"|"keyword"|"searchterm"|"creative"|"audience"|"device"|"country"|"network"|"schedule",
  "entity_name": "string",
  "metric": "string",
  "current_value": null|number,
  "previous_value": null|number,
  "change_pct": null|number,
  "severity": "critical"|"high"|"medium"|"low"|"positive",
  "insight_type": "performance"|"trend"|"anomaly"|"opportunity"|"risk"|"positive",
  "is_seasonal": false,
  "is_structural": boolean,
  "cause": null|"string (oorzaak indien geïdentificeerd)",
  "action_required": boolean,
  "evidence_level": "deterministic"|"inferred"|"hypothesis",
  "confidence": "high"|"medium"|"low",
  "benchmark_type": null|"monthly_target"|"pace_target"|"annual_goal"|"sector_benchmark"|"account_average"|"campaign_average"|"previous_month"|"previous_year"
}

## Evidence level regels (weekly):
- "deterministic": exact berekend verschil uit weekdata (bijv. spend steeg 35% WoW)
- "inferred": logisch afgeleid uit meerdere signalen (bijv. tracking break vermoeden)
- "hypothesis": niet verifieerbaar met beschikbare weekdata

## Confidence regels (weekly — kortere datareeks):
- "high": duidelijk anomalie-signaal EN >€100 spend in de periode
- "medium": signaal aanwezig maar beperkte data of laag volume
- "low": zwak signaal of <€20 spend

## Severity regels (weekly):
- "critical": tracking break, budget volledig opgebrand, conversies naar 0
- "high": >30% WoW negatieve afwijking op primaire KPI, bleeder >3x CPA
- "medium": 20-30% WoW afwijking, bleeder 1.5-3x CPA
- "low": 10-20% afwijking, klein budgetrisico
- "positive": significante verbetering

Markeer "action_required": true ALLEEN voor critical en high bevindingen die directe actie vereisen.`;

export const WEEKLY_RECS_SYSTEM = `Je ontvangt twee bronnen:
1. Een lijst van bevindingen uit een wekelijkse health check als JSON (findings)
2. De tekst van de analyse

Genereer aanbevelingen en taken. Weekly focus: URGENTE acties, korte tijdshorizon.

BELANGRIJK — Actie-gating regels (weekly):
- "direct_action": ALLEEN bij tracking breaks, budget-uitputting, of bleeders >3x CPA met high confidence
- "investigate_first": bij vermoedens van tracking issues, onverklaarde afwijkingen
- "monitor": bij kleine afwijkingen (<€50 impact) of lage confidence

Retourneer ALLEEN valid JSON, geen andere tekst, geen markdown codeblokken.

{
  "recommendations": [{
    "finding_index": number|null,
    "source": "finding",
    "hypothesis": "string",
    "expected_result": "string",
    "measurement_metric": "string",
    "timeframe": "string (max 2 weken voor weekly)",
    "rationale": "string",
    "ice_impact": number,
    "ice_confidence": number,
    "ice_ease": number,
    "ice_total": number,
    "action_readiness": "direct_action"|"investigate_first"|"monitor"|"strategic_hypothesis",
    "evidence_level": "deterministic"|"inferred"|"hypothesis",
    "confidence": "high"|"medium"|"low"
  }],
  "tasks": [{
    "recommendation_index": number,
    "title": "string (max 60 tekens, imperatief)",
    "description": "string",
    "action_type": "budget"|"bid"|"targeting"|"creative"|"structure"|"tracking"|"audit"|"negative"|"website"|"content"|"feed",
    "owner": "Ranking Masters"|"Klant",
    "affected_campaign": null|"string",
    "affected_adgroup": null|"string",
    "affected_keyword": null|"string",
    "current_value": null|"string",
    "target_value": null|"string",
    "priority": "critical"|"high"|"medium"|"low",
    "frequency": "direct"|"weekly",
    "due_date_days": number (max 14 voor weekly)
  }]
}`;

// ============================================================
// STRUCTURED EXTRACTION PROMPTS — BIWEEKLY
// ============================================================

export const BIWEEKLY_FINDINGS_SYSTEM = `Je ontvangt de output van een bi-weekly SEA check-in (4 analyse-stappen).
Extraheer ALLE significante bevindingen als JSON array.
Retourneer ALLEEN valid JSON, geen andere tekst, geen markdown codeblokken.

Focus op: afwijkingen t.o.v. maandanalyse verwachtingen, trends in de maand, campagne-ontwikkeling,
effect van eerder uitgevoerde optimalisaties.

Elke bevinding:
{
  "step": number (1-4, stap waar de bevinding uit komt),
  "entity_type": "account"|"campaign"|"adgroup"|"keyword"|"searchterm"|"creative"|"audience"|"device"|"country"|"network"|"schedule",
  "entity_name": "string",
  "metric": "string",
  "current_value": null|number,
  "previous_value": null|number,
  "change_pct": null|number,
  "severity": "critical"|"high"|"medium"|"low"|"positive",
  "insight_type": "performance"|"trend"|"anomaly"|"opportunity"|"risk"|"positive",
  "is_seasonal": boolean,
  "is_structural": boolean,
  "cause": null|"string (oorzaak indien geïdentificeerd)",
  "action_required": boolean,
  "evidence_level": "deterministic"|"inferred"|"hypothesis",
  "confidence": "high"|"medium"|"low",
  "benchmark_type": null|"monthly_target"|"pace_target"|"annual_goal"|"sector_benchmark"|"account_average"|"campaign_average"|"previous_month"|"previous_year"
}

## Evidence level regels (biweekly):
- "deterministic": exact berekend uit de data (bijv. campagne X daalde 25% MoM)
- "inferred": conclusie op basis van vergelijking met maandanalyse verwachtingen
- "hypothesis": niet verifieerbaar, vereist meer data

## Confidence regels (biweekly):
- "high": >50 conversies in de periode EN duidelijk patroon EN consistent met maandanalyse
- "medium": 10-50 conversies OF slechts 2-3 weken data
- "low": <10 conversies OF tegenstrijdig met maandanalyse verwachting

## Severity toewijzing (biweekly):
- "critical": maand gaat target met >30% missen, of tracking break ontdekt
- "high": afwijking >20% van verwachting uit maandanalyse, of nieuwe underperformer
- "medium": 10-20% afwijking van verwachting, of trage verbetering na optimalisatie
- "low": kleine afwijkingen, nieuwe observatie voor volgende maandanalyse
- "positive": optimalisatie toont verwacht effect, of onverwachte verbetering`;

export const BIWEEKLY_RECS_SYSTEM = `Je ontvangt twee bronnen:
1. Een lijst van bevindingen uit een bi-weekly check-in als JSON (findings)
2. De tekst van de analyse

Genereer aanbevelingen en taken uit BEIDE bronnen:
- Voor elke finding waar action_required = true: genereer een aanbeveling met source="finding" en 1-3 taken
- Voor strategische inzichten uit de analyse: genereer een aanbeveling met source="hypothesis"

BELANGRIJK — Actie-gating regels (biweekly):
- "direct_action": ALLEEN als evidence_level="deterministic" en confidence="high". Bijv. campagne X loopt >30% achter op target met duidelijke oorzaak.
- "investigate_first": als er een signaal is maar aanvullende data nodig. Bijv. optimalisatie toont geen effect na 2 weken.
- "monitor": als het signaal zwak is of te weinig data. Bijv. kleine afwijking in laagseizoensperiode.
- "strategic_hypothesis": langetermijn inzichten voor volgende sprintplanning.

VERMIJD duplicatie met maandanalyse aanbevelingen — focus op NIEUWE inzichten.

Retourneer ALLEEN valid JSON, geen andere tekst, geen markdown codeblokken.

{
  "recommendations": [{
    "finding_index": number|null (null voor hypotheses),
    "source": "finding"|"hypothesis",
    "hypothesis": "string",
    "expected_result": "string",
    "measurement_metric": "string",
    "timeframe": "string",
    "rationale": "string",
    "ice_impact": number,
    "ice_confidence": number,
    "ice_ease": number,
    "ice_total": number,
    "action_readiness": "direct_action"|"investigate_first"|"monitor"|"strategic_hypothesis",
    "evidence_level": "deterministic"|"inferred"|"hypothesis",
    "confidence": "high"|"medium"|"low"
  }],
  "tasks": [{
    "recommendation_index": number,
    "title": "string (max 60 tekens, imperatief)",
    "description": "string",
    "action_type": "budget"|"bid"|"targeting"|"creative"|"structure"|"tracking"|"audit"|"negative"|"website"|"content"|"feed",
    "owner": "Ranking Masters"|"Klant",
    "affected_campaign": null|"string",
    "affected_adgroup": null|"string",
    "affected_keyword": null|"string",
    "current_value": null|"string",
    "target_value": null|"string",
    "priority": "critical"|"high"|"medium"|"low",
    "frequency": "direct"|"weekly"|"biweekly"|"monthly",
    "due_date_days": number
  }]
}`;

```


---

## `lib/analysis/helpers.ts`

```ts
/**
 * Shared helpers for the /api/analysis/* routes.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildGoalsSection,
  determineAccountType,
  type AccountType,
} from "../prompts/sop-prompts";
import { callOpenRouter, type OpenRouterResponse } from "./openrouter-client";

const SOP_OUTPUT_CONFLICT_COLUMNS = "client_id,sop_type,analysis_date,section";

// ── Supabase (service role) ─────────────────────────────────────────────────

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── OpenRouter config ───────────────────────────────────────────────────────

export function getOpenRouterKey(): string | null {
  return process.env.OPENROUTER_API_KEY ?? null;
}

// ── Goals + account type from client_settings or sop_client_config ──────────

export interface ClientContext {
  goalsSection: string;
  accountType: AccountType;
}

export async function fetchClientContext(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientContext> {
  // Try client_settings first (primary source)
  const { data: cs } = await supabase
    .from("client_settings")
    .select("kpi_targets, conversion_actions")
    .eq("client_id", clientId)
    .maybeSingle();

  if (cs?.kpi_targets) {
    const kpi = cs.kpi_targets as Record<string, unknown>;
    const primaryAction = Array.isArray(cs.conversion_actions)
      ? (cs.conversion_actions as Array<Record<string, unknown>>).find(
          (a) => a.category === "primary" && a.includedInDashboard
        )
      : undefined;

    const config = {
      cpaTarget: (kpi.cpaTarget as number) ?? 0,
      roasTarget: (kpi.roasTarget as number) ?? 0,
      revenueMode: (kpi.revenueMode as "absolute" | "growth") ?? "growth",
      conversionsMode: (kpi.conversionsMode as "absolute" | "growth") ?? "growth",
      revenueAbsolute: (kpi.revenueAbsolute as number) ?? 0,
      revenueGrowthPct: (kpi.revenueGrowthPct as number) ?? 0,
      conversionsAbsolute: (kpi.conversionsAbsolute as number) ?? 0,
      conversionsGrowthPct: (kpi.conversionsGrowthPct as number) ?? 0,
      primaryConversionAction: primaryAction?.name as string | undefined,
    };

    const accountType = determineAccountType(config);
    return {
      goalsSection: buildGoalsSection({ ...config, accountType }),
      accountType,
    };
  }

  // Fallback: sop_client_config
  const { data: sc } = await supabase
    .from("sop_client_config")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  if (sc) {
    const config = {
      cpaTarget: sc.target_cpa ?? 0,
      roasTarget: sc.target_roas ?? 0,
      revenueMode: "absolute" as const,
      conversionsMode: "absolute" as const,
      revenueAbsolute: sc.target_revenue ?? 0,
      revenueGrowthPct: 0,
      conversionsAbsolute: sc.target_conversions ?? 0,
      conversionsGrowthPct: 0,
    };

    const accountType = determineAccountType(config);
    return {
      goalsSection: buildGoalsSection({ ...config, accountType }),
      accountType,
    };
  }

  // No config at all
  const config = {
    cpaTarget: 0,
    roasTarget: 0,
    revenueMode: "growth" as const,
    conversionsMode: "growth" as const,
    revenueAbsolute: 0,
    revenueGrowthPct: 0,
    conversionsAbsolute: 0,
    conversionsGrowthPct: 0,
  };

  const accountType = determineAccountType(config);
  return {
    goalsSection: buildGoalsSection({ ...config, accountType }),
    accountType,
  };
}

// ── Change history fetch + format ───────────────────────────────────────────

interface ChangeHistoryRow {
  change_datetime: string;
  change_type: string;
  campaign_name: string;
  old_value: string;
  new_value: string;
  resource_type: string;
}

export async function fetchChangeHistory(
  supabase: SupabaseClient,
  clientId: string
): Promise<string> {
  const { data } = await supabase
    .from("ads_change_history")
    .select("change_datetime, change_type, campaign_name, old_value, new_value, resource_type")
    .eq("client_id", clientId)
    .gte("change_datetime", daysAgo(60))
    .order("change_datetime", { ascending: false })
    .limit(30);

  const rows = (data ?? []) as ChangeHistoryRow[];

  if (rows.length === 0) {
    return "";
  }

  const lines = rows.map((r) => {
    const date = r.change_datetime?.split("T")[0] ?? "onbekend";
    const campaign = r.campaign_name || "onbekend";
    const type = r.change_type || r.resource_type || "wijziging";
    const oldVal = r.old_value && r.old_value !== '""' ? r.old_value : "-";
    const newVal = r.new_value && r.new_value !== '""' ? r.new_value : "-";
    return `- ${date}: ${type} op ${campaign} — van ${oldVal} naar ${newVal}`;
  });

  return `\n## Recente wijzigingen in dit account (laatste 60 dagen)\n${lines.join("\n")}`;
}

// ── Call OpenRouter + save to sop_analysis_output ───────────────────────────

export interface AnalysisResult {
  clientId: string;
  sopType: string;
  analysisDate: string;
  periodStart: string;
  periodEnd: string;
  model: string;
  tokensUsed: number;
  output: string;
  saved: boolean;
  latencyMs: number;
  retries: number;
}

interface SaveAnalysisOutputSectionInput {
  supabase: SupabaseClient;
  row: {
    client_id: string;
    sop_type: string;
    analysis_date: string;
    period_start: string;
    period_end: string;
    section: string;
    output: string;
    model_used: string;
    tokens_used: number;
    step_number?: number;
    step_name?: string;
  };
  select?: string;
}

export async function saveAnalysisOutputSection(opts: SaveAnalysisOutputSectionInput) {
  const query = opts.supabase
    .from("sop_analysis_output")
    .upsert(opts.row, {
      onConflict: SOP_OUTPUT_CONFLICT_COLUMNS,
      ignoreDuplicates: false,
    });

  if (opts.select) {
    const { data, error } = await query.select(opts.select).maybeSingle();
    return { data, error };
  }

  const { error } = await query;
  return { data: null, error };
}

export async function runAnalysis(opts: {
  supabase: SupabaseClient;
  apiKey: string;
  clientId: string;
  sopType: string;
  systemPrompt: string;
  userMessage: string;
  periodStart: string;
  periodEnd: string;
}): Promise<AnalysisResult> {
  const { supabase, apiKey, clientId, sopType, systemPrompt, userMessage, periodStart, periodEnd } = opts;
  const analysisDate = new Date().toISOString().split("T")[0];

  const response = await callOpenRouter({
    apiKey,
    systemPrompt,
    userMessage,
    maxTokens: 8192,
    label: `${sopType}-full`,
  });

  const { error } = await saveAnalysisOutputSection({
    supabase,
    row: {
    client_id: clientId,
    sop_type: sopType,
    analysis_date: analysisDate,
    period_start: periodStart,
    period_end: periodEnd,
    section: "full",
    output: response.output,
    model_used: response.model,
    tokens_used: response.tokensUsed,
    },
  });

  return {
    clientId,
    sopType,
    analysisDate,
    periodStart,
    periodEnd,
    model: response.model,
    tokensUsed: response.tokensUsed,
    output: response.output,
    saved: !error,
    latencyMs: response.latencyMs,
    retries: response.retries,
  };
}

// ── Run a single pipeline step + save to sop_analysis_output ────────────────

export interface StepResult {
  stepNumber: number;
  stepName: string;
  output: string;
  model: string;
  tokensUsed: number;
  saved: boolean;
  latencyMs: number;
  retries: number;
}

export async function runStep(opts: {
  supabase: SupabaseClient;
  apiKey: string;
  clientId: string;
  sopType: string;
  systemPrompt: string;
  userMessage: string;
  periodStart: string;
  periodEnd: string;
  stepNumber: number;
  stepName: string;
  /** Request JSON mode for structured output steps */
  jsonMode?: boolean;
}): Promise<StepResult> {
  const { supabase, apiKey, clientId, sopType, systemPrompt, userMessage, periodStart, periodEnd, stepNumber, stepName, jsonMode } = opts;
  const analysisDate = new Date().toISOString().split("T")[0];

  const response = await callOpenRouter({
    apiKey,
    systemPrompt,
    userMessage,
    maxTokens: jsonMode ? 8192 : 4096,
    jsonMode,
    label: `${sopType}-step-${stepNumber}-${stepName.toLowerCase().replace(/\s+/g, "-")}`,
  });

  const { error } = await saveAnalysisOutputSection({
    supabase,
    row: {
    client_id: clientId,
    sop_type: sopType,
    analysis_date: analysisDate,
    period_start: periodStart,
    period_end: periodEnd,
    section: stepName,
    output: response.output,
    model_used: response.model,
    tokens_used: response.tokensUsed,
    step_number: stepNumber,
    step_name: stepName,
    },
  });

  return {
    stepNumber,
    stepName,
    output: response.output,
    model: response.model,
    tokensUsed: response.tokensUsed,
    saved: !error,
    latencyMs: response.latencyMs,
    retries: response.retries,
  };
}

// ── Date helpers ────────────────────────────────────────────────────────────

export function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return fmt(d);
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmt(d);
}

```


---

## `lib/schema/analysis-schema.ts`

```ts
/**
 * Zod schemas for structured LLM output validation.
 *
 * These schemas match the existing sop_insights / sop_recommendations / sop_tasks
 * table structures. They replace the brittle regex + JSON.parse fallback chains
 * in the monthly analysis route (steps 7-8).
 */

import { z } from "zod";

// ── Shared enums ───────────────────────────────────────────────────────────

export const SeverityEnum = z.enum(["critical", "high", "medium", "low", "positive"]);
export type Severity = z.infer<typeof SeverityEnum>;

export const EntityTypeEnum = z.enum(["account", "campaign", "adgroup", "keyword", "searchterm", "creative", "audience", "device", "country", "network", "schedule"]);
export type EntityType = z.infer<typeof EntityTypeEnum>;

export const InsightTypeEnum = z.enum(["performance", "trend", "anomaly", "opportunity", "risk", "positive"]);
export type InsightType = z.infer<typeof InsightTypeEnum>;

export const ActionTypeEnum = z.enum([
  "budget", "bid", "targeting", "creative", "structure",
  "tracking", "audit", "negative", "website", "content", "feed",
]);
export type ActionType = z.infer<typeof ActionTypeEnum>;

export const PriorityEnum = z.enum(["critical", "high", "medium", "low"]);
export type Priority = z.infer<typeof PriorityEnum>;

export const FrequencyEnum = z.enum(["direct", "weekly", "biweekly", "monthly"]);
export type Frequency = z.infer<typeof FrequencyEnum>;

export const OwnerEnum = z.enum(["Ranking Masters", "Klant"]);
export type Owner = z.infer<typeof OwnerEnum>;

export const RecommendationSourceEnum = z.enum(["finding", "hypothesis"]);
export type RecommendationSource = z.infer<typeof RecommendationSourceEnum>;

export const EvidenceLevelEnum = z.enum(["deterministic", "inferred", "hypothesis"]);
export type EvidenceLevel = z.infer<typeof EvidenceLevelEnum>;

export const ConfidenceEnum = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceEnum>;

export const BenchmarkTypeEnum = z.enum([
  "monthly_target", "pace_target", "annual_goal",
  "sector_benchmark", "account_average", "campaign_average",
  "previous_month", "previous_year",
]);
export type BenchmarkType = z.infer<typeof BenchmarkTypeEnum>;

export const ActionReadinessEnum = z.enum([
  "direct_action",        // voldoende bewijs, direct uitvoerbaar
  "investigate_first",    // signaal sterk genoeg om te onderzoeken
  "monitor",              // te weinig data, observeren
  "strategic_hypothesis",  // langetermijn idee, niet urgent
]);
export type ActionReadiness = z.infer<typeof ActionReadinessEnum>;

// ── Finding schema (step 7 output) ────────────────────────────────────────

export const FindingSchema = z.object({
  step: z.number().int().min(1).max(12),
  issue_cluster: z.string().min(1).default("uncategorized"), // e.g., "pmax_cannibalization", "desktop_inefficiency"
  entity_type: EntityTypeEnum,
  entity_name: z.string().min(1),
  entity_scope: z.string().optional(),
  parent_campaign: z.string().nullable().optional(),
  parent_adgroup: z.string().nullable().optional(),
  display_label: z.string().optional(),
  metric: z.string().min(1),
  current_value: z.number().nullable(),
  previous_value: z.number().nullable(),
  change_pct: z.number().nullable(),
  severity: SeverityEnum,
  insight_type: InsightTypeEnum,
  is_seasonal: z.boolean(),
  is_structural: z.boolean(),
  cause: z.string().nullable(),
  action_required: z.boolean(),
  // Evidence model (optional for backward compatibility)
  evidence_level: EvidenceLevelEnum.optional(),
  confidence: ConfidenceEnum.optional(),
  benchmark_type: BenchmarkTypeEnum.optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const FindingsArraySchema = z.array(FindingSchema);

// ── Recommendation schema (step 8 output — recommendations part) ──────────

export const RecommendationSchema = z.object({
  finding_index: z.number().int().nullable(),
  source: RecommendationSourceEnum,
  hypothesis: z.string().min(1),
  expected_result: z.string().min(1),
  measurement_metric: z.string().min(1),
  timeframe: z.string().min(1),
  rationale: z.string().min(1),
  ice_impact: z.number().min(1).max(10),
  ice_confidence: z.number().min(1).max(10),
  ice_ease: z.number().min(1).max(10),
  ice_total: z.number().min(1).max(10),
  // Action gating (optional for backward compatibility)
  action_readiness: ActionReadinessEnum.optional(),
  evidence_level: EvidenceLevelEnum.optional(),
  confidence: ConfidenceEnum.optional(),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

// ── Task schema (step 8 output — tasks part) ──────────────────────────────

export const TaskSchema = z.object({
  recommendation_index: z.number().int(),
  title: z.string().min(1).max(80),
  description: z.string().min(1),
  action_type: ActionTypeEnum,
  owner: OwnerEnum,
  affected_campaign: z.string().nullable(),
  affected_adgroup: z.string().nullable(),
  affected_keyword: z.string().nullable(),
  current_value: z.string().nullable(),
  target_value: z.string().nullable(),
  priority: PriorityEnum,
  frequency: FrequencyEnum,
  due_date_days: z.number().int().min(1).max(365),
});

export type Task = z.infer<typeof TaskSchema>;

// ── Combined step 8 output schema ─────────────────────────────────────────

export const RecommendationsOutputSchema = z.object({
  recommendations: z.array(RecommendationSchema),
  tasks: z.array(TaskSchema),
});

export type RecommendationsOutput = z.infer<typeof RecommendationsOutputSchema>;

// ── Parse helpers ──────────────────────────────────────────────────────────

/**
 * Strips markdown code fences and extracts JSON from LLM text output.
 * Returns the cleaned string, or null if no JSON-like content found.
 */
export function extractJson(raw: string): string | null {
  let text = raw.trim();

  // Strip markdown code fences
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  // If it looks like JSON, return it
  if (text.startsWith("[") || text.startsWith("{")) {
    return text;
  }

  // Try to find a JSON array or object embedded in the text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];

  return null;
}

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; raw: string };

/**
 * Parse and validate findings from LLM output (step 7).
 * Returns validated findings array or error details.
 */
export function parseFindings(raw: string): ParseResult<Finding[]> {
  const json = extractJson(raw);
  if (!json) {
    return { success: false, error: "No JSON found in LLM output", raw };
  }

  try {
    const parsed = JSON.parse(json);
    const arr = Array.isArray(parsed) ? parsed : (parsed.findings ?? parsed.insights ?? []);
    const result = FindingsArraySchema.safeParse(arr);

    if (result.success) {
      return { success: true, data: result.data };
    }

    // Partial recovery: keep items that validate individually
    const validItems: Finding[] = [];
    for (const item of arr) {
      const single = FindingSchema.safeParse(item);
      if (single.success) validItems.push(single.data);
    }

    if (validItems.length > 0) {
      return { success: true, data: validItems };
    }

    return {
      success: false,
      error: `Zod validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      raw,
    };
  } catch (e) {
    return { success: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`, raw };
  }
}

/**
 * Parse and validate recommendations + tasks from LLM output (step 8).
 * Returns validated output or error details.
 */
export function parseRecommendations(raw: string): ParseResult<RecommendationsOutput> {
  const json = extractJson(raw);
  if (!json) {
    return { success: false, error: "No JSON found in LLM output", raw };
  }

  try {
    const parsed = JSON.parse(json);
    const result = RecommendationsOutputSchema.safeParse(parsed);

    if (result.success) {
      return { success: true, data: result.data };
    }

    // Partial recovery: validate each array individually
    const validRecs: Recommendation[] = [];
    const validTasks: Task[] = [];

    for (const rec of (parsed.recommendations ?? [])) {
      const single = RecommendationSchema.safeParse(rec);
      if (single.success) validRecs.push(single.data);
    }
    for (const task of (parsed.tasks ?? [])) {
      const single = TaskSchema.safeParse(task);
      if (single.success) validTasks.push(single.data);
    }

    if (validRecs.length > 0 || validTasks.length > 0) {
      return { success: true, data: { recommendations: validRecs, tasks: validTasks } };
    }

    return {
      success: false,
      error: `Zod validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      raw,
    };
  } catch (e) {
    return { success: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`, raw };
  }
}

```


---

## `lib/analysis/canonicalize.ts`

```ts
/**
 * Canonical monthly finding normalization, clustering, and coverage helpers.
 *
 * The monthly pipeline uses these utilities before any synthesis or
 * recommendation generation so that entity names, metrics, issue clusters,
 * and coverage are deterministic.
 */

import type { Finding } from "@/lib/schema/analysis-schema";
import { deriveEntityIdentity, normalizeScopedEntityName, type EntityScope } from "@/lib/analysis/entity-identity";

export type CoverageDimension =
  | "account"
  | "campaign"
  | "adgroup"
  | "competitor"
  | "search_term"
  | "creative"
  | "audience"
  | "device"
  | "geography"
  | "network"
  | "schedule"
  | "pmax_product_asset_groups"
  | "hypotheses_sprint_plan";

export interface NormalizedFinding extends Finding {
  finding_id: string;
  canonical_entity_name: string;
  canonical_entity_key: string;
  entity_scope: EntityScope;
  parent_campaign: string | null;
  parent_adgroup: string | null;
  display_label: string;
  entity_identity_key: string;
  canonical_metric: string;
  canonical_metric_key: string;
  cluster_family: string;
  dedup_key: string;
}

export interface IssueCluster {
  cluster_id: string;
  issue_cluster: string;
  canonical_entity_name: string;
  display_label: string;
  entity_scope: EntityScope;
  entity_identity_key: string;
  parent_campaign: string | null;
  parent_adgroup: string | null;
  canonical_metric: string;
  related_finding_ids: string[];
  dominant_severity: Finding["severity"];
  dominant_confidence: "high" | "medium" | "low";
  root_cause_summary: string;
  evidence_summary: string;
  actionability: "direct_action" | "investigate_first" | "monitor";
  coverage_dimensions: CoverageDimension[];
  findings: NormalizedFinding[];
  action_required: boolean;
  finding_count: number;
  severity_score: number;
}

export interface SopCoverage {
  dimension: CoverageDimension;
  data_available: boolean;
  findings_surfaced: number;
  surfaced_cluster_ids: string[];
  status: "covered" | "no_signal" | "data_unavailable";
  note: string;
}

export interface CanonicalizedOutput {
  findings: NormalizedFinding[];
  clusters: IssueCluster[];
  coverage: SopCoverage[];
  stats: {
    raw_count: number;
    after_dedup: number;
    cluster_count: number;
  };
}

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  positive: 1,
};

const CONFIDENCE_RANK: Record<"high" | "medium" | "low", number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const ENTITY_ALIASES: Array<[RegExp, string]> = [
  [/^account(\s+(overall|performance|wide|level))?$/i, "Account"],
  [/^account overall$/i, "Account"],
  [/^account performance$/i, "Account"],
  [/^account wide$/i, "Account"],
  [/^gads-\d+$/i, "Account"],
  [/^belgi[eë](\s*\(be\))?$/i, "België"],
  [/^belgium(\s*\(be\))?$/i, "België"],
  [/^nederland(\s*\(nl\))?$/i, "Nederland"],
  [/^netherlands(\s*\(nl\))?$/i, "Nederland"],
  [/^search partners$/i, "Search Partners"],
  [/^youtube(\s*\(pmax\))?$/i, "YouTube"],
];

const METRIC_ALIASES: Array<[RegExp, string]> = [
  [/^search lost is \(budget\)$/i, "Search Lost IS (Budget)"],
  [/^search impression share \(budget\)$/i, "Search Lost IS (Budget)"],
  [/^search impression share \(budget\)\s*$/i, "Search Lost IS (Budget)"],
  [/^search lost is \(rank\)$/i, "Search Lost IS (Rank)"],
  [/^search impression share \(rank\)$/i, "Search Lost IS (Rank)"],
  [/^search impression share$/i, "Impression Share"],
  [/^conversion rate$/i, "CVR"],
  [/^cvr$/i, "CVR"],
  [/^cost per conversion$/i, "CPA"],
  [/^marginal cpa$/i, "CPA"],
  [/^wasteful spend$/i, "Wasteful Spend"],
  [/^efficiency ratio$/i, "Efficiency Ratio"],
  [/^revenue$/i, "Omzet"],
  [/^conversion value$/i, "Conversiewaarde"],
  [/^conversions?$/i, "Conversies"],
  [/^volume$/i, "Volume"],
  [/^clicks?$/i, "Clicks"],
  [/^impressions?$/i, "Impressies"],
];

const CLUSTER_ALIASES: Array<[RegExp, string]> = [
  [/tracking|measurement/i, "tracking_cvr_drop"],
  [/desktop/i, "desktop_inefficiency"],
  [/mobile/i, "mobile_opportunity"],
  [/audience/i, "audience_inefficiency"],
  [/creative|copy|rsa/i, "creative_mismatch"],
  [/schedule|hour|daypart/i, "schedule_waste"],
  [/network|youtube|partner/i, "network_quality"],
  [/geo|country|belgi|nederland|duitsland/i, "geo_allocation"],
  [/search[_\s]?term|negative|waste/i, "search_term_waste"],
  [/budget|lost[_\s]?is/i, "search_budget_cap"],
  [/troas|bid|inflation|cpc/i, "search_bidding_inflation"],
  [/pmax|cannibal/i, "pmax_cannibalization"],
  [/product|asset_group|shopping/i, "product_mix"],
  [/brand/i, "brand_leakage"],
  [/partner/i, "search_partner_waste"],
];

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function clampConfidence(value?: string): "high" | "medium" | "low" {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function cleanCause(cause: string | null): string {
  return (cause || "")
    .replace(/\bnull\b/gi, "")
    .replace(/\bundefined\b/gi, "")
    .replace(/\(was null\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function normalizeEntityName(raw: string, entityType: Finding["entity_type"] = "campaign"): string {
  let name = normalizeScopedEntityName(raw, entityType);

  for (const [pattern, canonical] of ENTITY_ALIASES) {
    if (pattern.test(name) && entityType !== "adgroup") return canonical;
  }

  return name;
}

export function normalizeMetricName(raw: string): string {
  const metric = (raw || "").trim();
  for (const [pattern, canonical] of METRIC_ALIASES) {
    if (pattern.test(metric)) return canonical;
  }
  return metric;
}

function detectClusterFamily(finding: Finding, canonicalEntity: string, canonicalMetric: string): string {
  const provided = (finding.issue_cluster || "").trim();
  if (provided) {
    for (const [pattern, canonical] of CLUSTER_ALIASES) {
      if (pattern.test(provided)) return canonical;
    }
    return slugify(provided);
  }

  const combined = `${canonicalEntity} ${canonicalMetric} ${cleanCause(finding.cause)}`;
  for (const [pattern, canonical] of CLUSTER_ALIASES) {
    if (pattern.test(combined)) return canonical;
  }

  if (/search lost is/i.test(canonicalMetric)) return "search_budget_cap";
  if (/wasteful spend/i.test(canonicalMetric) || finding.entity_type === "searchterm") return "search_term_waste";
  if (finding.entity_type === "device" && /desktop/i.test(canonicalEntity)) return "desktop_inefficiency";
  if (finding.entity_type === "device" && /mobile/i.test(canonicalEntity)) return "mobile_opportunity";
  if (finding.entity_type === "country") return "geo_allocation";
  if (finding.entity_type === "creative") return "creative_mismatch";
  if (finding.entity_type === "audience") return "audience_inefficiency";
  if (finding.entity_type === "network") return "network_quality";
  if (finding.entity_type === "schedule") return "schedule_waste";

  return `${finding.entity_type}_performance`;
}

function findingCoverageDimensions(finding: Finding, family: string): CoverageDimension[] {
  const dims = new Set<CoverageDimension>();

  switch (finding.entity_type) {
    case "account":
      dims.add("account");
      break;
    case "campaign":
      dims.add("campaign");
      break;
    case "adgroup":
      dims.add("adgroup");
      break;
    case "keyword":
    case "searchterm":
      dims.add("search_term");
      break;
    case "creative":
      dims.add("creative");
      break;
    case "audience":
      dims.add("audience");
      break;
    case "device":
      dims.add("device");
      break;
    case "country":
      dims.add("geography");
      break;
    case "network":
      dims.add("network");
      break;
    case "schedule":
      dims.add("schedule");
      break;
  }

  if (family === "search_budget_cap" || family === "brand_leakage") dims.add("competitor");
  if (family === "pmax_cannibalization" || family === "product_mix") dims.add("pmax_product_asset_groups");

  return Array.from(dims);
}

export function normalizeFindings(findings: Finding[]): NormalizedFinding[] {
  return findings.map((finding, index) => {
    const identity = deriveEntityIdentity(finding);
    const canonicalEntityName = normalizeEntityName(finding.entity_name, finding.entity_type);
    const canonicalMetric = normalizeMetricName(finding.metric);
    const canonicalEntityKey = slugify(canonicalEntityName);
    const canonicalMetricKey = slugify(canonicalMetric);
    const clusterFamily = detectClusterFamily(finding, canonicalEntityName, canonicalMetric);

    return {
      ...finding,
      issue_cluster: clusterFamily,
      entity_name: canonicalEntityName,
      entity_scope: identity.entity_scope,
      parent_campaign: identity.parent_campaign,
      parent_adgroup: identity.parent_adgroup,
      display_label: identity.display_label,
      metric: canonicalMetric,
      cause: cleanCause(finding.cause) || "Oorzaak niet gespecificeerd",
      finding_id: `f_${String(index + 1).padStart(3, "0")}_${canonicalEntityKey}_${canonicalMetricKey}`,
      canonical_entity_name: canonicalEntityName,
      canonical_entity_key: canonicalEntityKey,
      entity_identity_key: identity.identity_key,
      canonical_metric: canonicalMetric,
      canonical_metric_key: canonicalMetricKey,
      cluster_family: clusterFamily,
      dedup_key: `${identity.identity_key}:::${canonicalMetricKey}`,
    };
  });
}

function mergeCauseTexts(primary: string, secondary: string): string {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const normPrimary = primary.toLowerCase();
  const normSecondary = secondary.toLowerCase();
  if (normPrimary.includes(normSecondary) || normSecondary.includes(normPrimary)) return primary;
  return `${primary}; ${secondary}`;
}

export function deduplicateFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const byKey = new Map<string, NormalizedFinding>();

  for (const finding of findings) {
    const existing = byKey.get(finding.dedup_key);
    if (!existing) {
      byKey.set(finding.dedup_key, finding);
      continue;
    }

    const currentRank = SEVERITY_RANK[finding.severity];
    const existingRank = SEVERITY_RANK[existing.severity];
    const keepCurrent =
      currentRank > existingRank ||
      (currentRank === existingRank && Math.abs(finding.change_pct ?? 0) > Math.abs(existing.change_pct ?? 0));

    if (keepCurrent) {
      byKey.set(finding.dedup_key, {
        ...finding,
        cause: mergeCauseTexts(finding.cause || "", existing.cause || ""),
        current_value: finding.current_value ?? existing.current_value,
        previous_value: finding.previous_value ?? existing.previous_value,
        change_pct: finding.change_pct ?? existing.change_pct,
      });
    } else {
      existing.cause = mergeCauseTexts(existing.cause || "", finding.cause || "");
      existing.action_required = existing.action_required || finding.action_required;
      existing.is_structural = existing.is_structural || finding.is_structural;
      existing.is_seasonal = existing.is_seasonal || finding.is_seasonal;
      if (CONFIDENCE_RANK[clampConfidence(finding.confidence)] > CONFIDENCE_RANK[clampConfidence(existing.confidence)]) {
        existing.confidence = finding.confidence;
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDiff !== 0) return severityDiff;
    const changeDiff = Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0);
    if (changeDiff !== 0) return changeDiff;
    return a.finding_id.localeCompare(b.finding_id);
  });
}

function dominantMetric(findings: NormalizedFinding[]): string {
  const weighted = new Map<string, number>();
  for (const finding of findings) {
    const score = (weighted.get(finding.canonical_metric) || 0) + SEVERITY_RANK[finding.severity];
    weighted.set(finding.canonical_metric, score);
  }

  return Array.from(weighted.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || findings[0]?.canonical_metric || "Metric";
}

function clusterActionability(findings: NormalizedFinding[]): IssueCluster["actionability"] {
  const hasLowConfidence = findings.some((finding) => clampConfidence(finding.confidence) === "low");
  const hasHypothesis = findings.some((finding) => finding.evidence_level === "hypothesis");
  const hasOnlyPositive = findings.every((finding) => finding.severity === "positive" || !finding.action_required);

  if (hasOnlyPositive) return "monitor";
  if (hasLowConfidence || hasHypothesis) return "investigate_first";
  if (findings.some((finding) => finding.action_required)) return "direct_action";
  return "monitor";
}

export function clusterFindings(findings: NormalizedFinding[]): IssueCluster[] {
  const groups = new Map<string, NormalizedFinding[]>();

  for (const finding of findings) {
    const clusterKey = `${finding.cluster_family}:::${finding.entity_identity_key}`;
    const group = groups.get(clusterKey) || [];
    group.push(finding);
    groups.set(clusterKey, group);
  }

  const clusters: IssueCluster[] = Array.from(groups.entries()).map(([key, group]) => {
    const sorted = [...group].sort((a, b) => {
      const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0);
    });
    const lead = sorted[0];
    const dominantConfidence = sorted
      .map((finding) => clampConfidence(finding.confidence))
      .sort((a, b) => CONFIDENCE_RANK[b] - CONFIDENCE_RANK[a])[0] || "medium";
    const coverageDimensions = new Set<CoverageDimension>();
    for (const finding of sorted) {
      for (const dimension of findingCoverageDimensions(finding, lead.cluster_family)) {
        coverageDimensions.add(dimension);
      }
    }

    return {
      cluster_id: `cluster_${key}`,
      issue_cluster: lead.cluster_family,
      canonical_entity_name: lead.canonical_entity_name,
      display_label: lead.display_label,
      entity_scope: lead.entity_scope,
      entity_identity_key: lead.entity_identity_key,
      parent_campaign: lead.parent_campaign,
      parent_adgroup: lead.parent_adgroup,
      canonical_metric: dominantMetric(sorted),
      related_finding_ids: sorted.map((finding) => finding.finding_id),
      dominant_severity: lead.severity,
      dominant_confidence: dominantConfidence,
      root_cause_summary: sorted
        .map((finding) => finding.cause || "")
        .filter(Boolean)
        .slice(0, 2)
        .reduce((summary, cause) => mergeCauseTexts(summary, cause), ""),
      evidence_summary: sorted
        .map((finding) => {
          const change = finding.change_pct != null ? ` (${finding.change_pct > 0 ? "+" : ""}${finding.change_pct}%)` : "";
          const current = finding.current_value != null ? ` ${finding.current_value}` : "";
          return `${finding.display_label} ${finding.canonical_metric}${current}${change}`;
        })
        .join("; "),
      actionability: clusterActionability(sorted),
      coverage_dimensions: Array.from(coverageDimensions).sort(),
      findings: sorted,
      action_required: sorted.some((finding) => finding.action_required),
      finding_count: sorted.length,
      severity_score: sorted.reduce((sum, finding) => sum + SEVERITY_RANK[finding.severity], 0),
    };
  });

  return clusters.sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.dominant_severity] - SEVERITY_RANK[a.dominant_severity];
    if (severityDiff !== 0) return severityDiff;
    const scoreDiff = b.severity_score - a.severity_score;
    if (scoreDiff !== 0) return scoreDiff;
    const countDiff = b.finding_count - a.finding_count;
    if (countDiff !== 0) return countDiff;
    return a.cluster_id.localeCompare(b.cluster_id);
  });
}

const COVERAGE_DIMENSION_DEFINITIONS: Array<{
  dimension: CoverageDimension;
  note: string;
}> = [
  { dimension: "account", note: "Account- of doelstellingsanalyse." },
  { dimension: "campaign", note: "Campagneperformance en portfolio-allocatie." },
  { dimension: "adgroup", note: "Ad group analyse en sub-structuur." },
  { dimension: "competitor", note: "Auction insights / impression share context." },
  { dimension: "search_term", note: "Zoektermen, keyword waste en intentkwaliteit." },
  { dimension: "creative", note: "Advertenties, assets en message-market fit." },
  { dimension: "audience", note: "Doelgroepsegmentatie en efficiency." },
  { dimension: "device", note: "Device performance en allocatie." },
  { dimension: "geography", note: "Land/regio prestaties." },
  { dimension: "network", note: "Search, YouTube, partners en mixed inventory." },
  { dimension: "schedule", note: "Dag/uur performance." },
  { dimension: "pmax_product_asset_groups", note: "PMax, productmix en asset groups." },
  { dimension: "hypotheses_sprint_plan", note: "Sprint-hypotheses en follow-up acties." },
];

export function checkSopCoverage(
  clusters: IssueCluster[],
  dimensionAvailability: Partial<Record<CoverageDimension, boolean>>
): SopCoverage[] {
  return COVERAGE_DIMENSION_DEFINITIONS.map(({ dimension, note }) => {
    const surfaced = clusters.filter((cluster) => cluster.coverage_dimensions.includes(dimension));
    const dataAvailable = dimensionAvailability[dimension] ?? false;

    return {
      dimension,
      data_available: dataAvailable,
      findings_surfaced: surfaced.reduce((sum, cluster) => sum + cluster.finding_count, 0),
      surfaced_cluster_ids: surfaced.map((cluster) => cluster.cluster_id),
      status: !dataAvailable ? "data_unavailable" : surfaced.length > 0 ? "covered" : "no_signal",
      note,
    };
  });
}

export function canonicalizeFindings(
  rawFindings: Finding[],
  dimensionAvailability: Partial<Record<CoverageDimension, boolean>> = {}
): CanonicalizedOutput {
  const normalized = normalizeFindings(rawFindings);
  const deduped = deduplicateFindings(normalized);
  const clusters = clusterFindings(deduped);
  const coverage = checkSopCoverage(clusters, dimensionAvailability);

  return {
    findings: deduped,
    clusters,
    coverage,
    stats: {
      raw_count: rawFindings.length,
      after_dedup: deduped.length,
      cluster_count: clusters.length,
    },
  };
}

```


---

## `lib/analysis/entity-identity.ts`

```ts
import type { Finding } from "@/lib/schema/analysis-schema";

export type EntityScope =
  | "account"
  | "campaign"
  | "adgroup"
  | "keyword"
  | "searchterm"
  | "creative"
  | "audience"
  | "device"
  | "country"
  | "network"
  | "schedule";

export interface EntityIdentity {
  entity_type: Finding["entity_type"];
  entity_scope: EntityScope;
  canonical_entity_name: string;
  parent_campaign: string | null;
  parent_adgroup: string | null;
  display_label: string;
  identity_key: string;
}

const COUNTRY_ALIASES: Array<[RegExp, string]> = [
  [/^belgium(\s*\(be\))?$/i, "België"],
  [/^belgi[eë](\s*\(be\))?$/i, "België"],
  [/^germany(\s*\(de\))?$/i, "Duitsland"],
  [/^duitsland(\s*\(de\))?$/i, "Duitsland"],
  [/^netherlands(\s*\(nl\))?$/i, "Nederland"],
  [/^nederland(\s*\(nl\))?$/i, "Nederland"],
  [/^france(\s*\(fr\))?$/i, "Frankrijk"],
  [/^frankrijk(\s*\(fr\))?$/i, "Frankrijk"],
];

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function normalizeScopedEntityName(raw: string, entityType: Finding["entity_type"]): string {
  let name = (raw || "").trim().replace(/\s+/g, " ");

  if (entityType === "country") {
    for (const [pattern, canonical] of COUNTRY_ALIASES) {
      if (pattern.test(name)) return canonical;
    }
    return name.replace(/\s*\(([A-Z]{2})\)\s*$/i, "").trim();
  }

  if (entityType === "account") {
    if (/^account(\s+(overall|performance|wide|level))?$/i.test(name) || /^gads-\d+$/i.test(name)) {
      return "Account";
    }
    return name;
  }

  // Strip trailing system suffixes, but never convert short labels like "DE"
  return name.replace(/\s*\((search|shopping|pmax|pmx)\)\s*$/i, "").trim();
}

export function defaultEntityScope(entityType: Finding["entity_type"]): EntityScope {
  switch (entityType) {
    case "account":
      return "account";
    case "campaign":
      return "campaign";
    case "adgroup":
      return "adgroup";
    case "keyword":
      return "keyword";
    case "searchterm":
      return "searchterm";
    case "creative":
      return "creative";
    case "audience":
      return "audience";
    case "device":
      return "device";
    case "country":
      return "country";
    case "network":
      return "network";
    case "schedule":
      return "schedule";
  }
}

export function buildDisplayLabel(identity: {
  entity_type: Finding["entity_type"];
  canonical_entity_name: string;
  parent_campaign?: string | null;
  parent_adgroup?: string | null;
}): string {
  const { entity_type, canonical_entity_name, parent_campaign, parent_adgroup } = identity;
  switch (entity_type) {
    case "country":
      return `Land: ${canonical_entity_name}`;
    case "adgroup":
      return parent_campaign
        ? `Ad group: ${canonical_entity_name} (Campagne: ${parent_campaign})`
        : `Ad group: ${canonical_entity_name}`;
    case "campaign":
      return `Campagne: ${canonical_entity_name}`;
    case "keyword":
      return parent_adgroup
        ? `Keyword: ${canonical_entity_name} (Ad group: ${parent_adgroup})`
        : `Keyword: ${canonical_entity_name}`;
    case "searchterm":
      return `Zoekterm: ${canonical_entity_name}`;
    case "creative":
      return parent_adgroup
        ? `Creative: ${canonical_entity_name} (Ad group: ${parent_adgroup})`
        : `Creative: ${canonical_entity_name}`;
    case "audience":
      return `Audience: ${canonical_entity_name}`;
    case "device":
      return `Device: ${canonical_entity_name}`;
    case "network":
      return `Netwerk: ${canonical_entity_name}`;
    case "schedule":
      return `Planning: ${canonical_entity_name}`;
    case "account":
      return `Account: ${canonical_entity_name}`;
    default:
      return canonical_entity_name;
  }
}

export function deriveEntityIdentity(finding: Pick<Finding, "entity_type" | "entity_name" | "entity_scope" | "parent_campaign" | "parent_adgroup" | "display_label">): EntityIdentity {
  const entity_scope = (finding.entity_scope as EntityScope | undefined) ?? defaultEntityScope(finding.entity_type);
  const canonical_entity_name = normalizeScopedEntityName(finding.entity_name, finding.entity_type);
  const parent_campaign = finding.parent_campaign?.trim() || null;
  const parent_adgroup = finding.parent_adgroup?.trim() || null;
  const display_label = finding.display_label?.trim() || buildDisplayLabel({
    entity_type: finding.entity_type,
    canonical_entity_name,
    parent_campaign,
    parent_adgroup,
  });
  const identity_key = [
    finding.entity_type,
    entity_scope,
    slugify(canonical_entity_name),
    slugify(parent_campaign || ""),
    slugify(parent_adgroup || ""),
  ].join("::");

  return {
    entity_type: finding.entity_type,
    entity_scope,
    canonical_entity_name,
    parent_campaign,
    parent_adgroup,
    display_label,
    identity_key,
  };
}

```


---

## `lib/analysis/monthly-structured.ts`

```ts
import type { StepResult } from "@/lib/analysis/helpers";
import type {
  IssueCluster,
  NormalizedFinding,
  SopCoverage,
} from "@/lib/analysis/canonicalize";
import type {
  ActionReadiness,
  Confidence,
  EvidenceLevel,
  Finding,
  Recommendation,
  Task,
} from "@/lib/schema/analysis-schema";

export type ActionPhase = "immediate" | "short_term" | "medium_term";

export type ThreadClassification =
  | "real_problem"
  | "expected_tradeoff"
  | "contextual_shift"
  | "measurement_risk"
  | "false_positive_alert";

export type ActionIntentClass =
  | "budget_expand"
  | "budget_reduce"
  | "bid_raise"
  | "bid_lower"
  | "pause_segment"
  | "negative_cleanup"
  | "tracking_validation"
  | "network_exclusion"
  | "creative_refresh"
  | "geo_reallocation"
  | "schedule_control"
  | "portfolio_ownership"
  | "audience_refine"
  | "monitor_only"
  | "investigation";

export interface StepFindingSidecar {
  stepNumber: number;
  stepName: string;
  narrative: string;
  findings: Finding[];
}

export interface AnalysisThread {
  id: string;
  title: string;
  priority: 1 | 2 | 3;
  classification: ThreadClassification;
  root_cause_summary: string;
  business_impact: string;
  supporting_cluster_ids: string[];
  recommended_recommendation_ids: number[];
  monitoring_metrics: string[];
  confidence: Confidence;
}

export interface ThreadRecommendation extends Recommendation {
  cluster_id: string;
  thread_id: string | null;
  phase: ActionPhase;
  owner: "Ranking Masters" | "Klant";
  dependencies: string[];
  action_intent_class: ActionIntentClass;
  action_unit_key: string;
  primary_entity_scope: string;
  primary_entity_key: string;
  canonical_entity_name: string;
  canonical_metric: string;
}

export interface ThreadTask extends Task {
  cluster_id: string;
  thread_id: string | null;
  phase: ActionPhase;
  action_intent_class: ActionIntentClass;
  action_unit_key: string;
  primary_entity_scope: string;
  primary_entity_key: string;
  canonical_entity_name: string;
  canonical_metric: string;
}

export interface SuccessScenario {
  floor_scenario: string;
  target_scenario: string;
  biggest_risk: string;
  weekly_monitoring_checklist: string[];
}

export interface MonthlyStructuredOutput {
  step_sidecars: StepFindingSidecar[];
  findings: NormalizedFinding[];
  clusters: IssueCluster[];
  threads: AnalysisThread[];
  recommendations: ThreadRecommendation[];
  tasks: ThreadTask[];
  coverage: SopCoverage[];
  what_is_not_the_problem: string[];
  success_next_month: SuccessScenario;
  action_plan: Record<ActionPhase, string[]>;
  executive_markdown: string;
  coverage_markdown: string;
  appendix_markdown: string;
}

function titleCaseMetric(metric: string): string {
  return metric.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGeoRoot(cluster: IssueCluster): string | null {
  const combined = normalizeText([
    cluster.canonical_entity_name,
    cluster.display_label,
    cluster.parent_campaign || "",
    cluster.parent_adgroup || "",
  ].join(" "));

  if (/\b(duitsland|germany)\b/.test(combined) || /\bde\b/.test(combined)) return "de";
  if (/\b(belgie|belgie|belgium)\b/.test(combined) || /\bbe\b/.test(combined)) return "be";
  if (/\b(nederland|netherlands)\b/.test(combined) || /\bnl\b/.test(combined)) return "nl";
  if (/\b(frankrijk|france)\b/.test(combined) || /\bfr\b/.test(combined)) return "fr";
  return null;
}

function threadFamily(cluster: IssueCluster): string {
  switch (cluster.issue_cluster) {
    case "geo_allocation":
      return `geo_allocation:${extractGeoRoot(cluster) || cluster.entity_identity_key}`;
    case "search_budget_cap":
      return `demand_capture:${cluster.parent_campaign || cluster.entity_identity_key}`;
    case "tracking_cvr_drop":
      return "measurement_risk";
    case "pmax_cannibalization":
    case "product_mix":
      return `portfolio_mix:${extractGeoRoot(cluster) || cluster.parent_campaign || cluster.entity_identity_key}`;
    case "network_quality":
    case "search_partner_waste":
      return `traffic_quality:${extractGeoRoot(cluster) || cluster.parent_campaign || cluster.canonical_entity_name}`;
    case "search_term_waste":
      return `query_quality:${extractGeoRoot(cluster) || cluster.parent_campaign || cluster.entity_identity_key}`;
    case "desktop_inefficiency":
    case "mobile_opportunity":
    case "audience_inefficiency":
    case "schedule_waste":
      return `efficiency_control:${extractGeoRoot(cluster) || cluster.parent_campaign || cluster.entity_identity_key}`;
    default:
      return `${cluster.issue_cluster}:${cluster.entity_identity_key}`;
  }
}

function actionUnitKey(cluster: IssueCluster): string {
  const geoRoot = extractGeoRoot(cluster);
  switch (cluster.issue_cluster) {
    case "geo_allocation":
      return `geo_reallocation:${geoRoot || cluster.entity_identity_key}`;
    case "network_quality":
    case "search_partner_waste":
      return `network_exclusion:${geoRoot || cluster.parent_campaign || cluster.canonical_entity_name}`;
    case "pmax_cannibalization":
    case "product_mix":
      return `portfolio_ownership:${geoRoot || cluster.parent_campaign || cluster.entity_identity_key}`;
    case "search_budget_cap":
      return `budget_expand:${cluster.parent_campaign || cluster.entity_identity_key}`;
    case "search_term_waste":
      return `query_quality:${geoRoot || cluster.parent_campaign || cluster.entity_identity_key}`;
    case "desktop_inefficiency":
    case "mobile_opportunity":
      return `device_efficiency:${cluster.parent_campaign || cluster.entity_identity_key}`;
    default:
      return `${cluster.issue_cluster}:${cluster.entity_identity_key}`;
  }
}

function isDerivativeSymptom(cluster: IssueCluster, clusters: IssueCluster[]): boolean {
  if (!["desktop_inefficiency", "mobile_opportunity", "audience_inefficiency"].includes(cluster.issue_cluster)) {
    return false;
  }
  const geoRoot = extractGeoRoot(cluster);
  return clusters.some((candidate) => {
    if (candidate.cluster_id === cluster.cluster_id) return false;
    if (!["geo_allocation", "network_quality", "pmax_cannibalization", "product_mix"].includes(candidate.issue_cluster)) {
      return false;
    }
    if (geoRoot && extractGeoRoot(candidate) === geoRoot) return true;
    if (cluster.parent_campaign && candidate.parent_campaign && cluster.parent_campaign === candidate.parent_campaign) return true;
    return false;
  });
}

function scoreCluster(cluster: IssueCluster, allClusters: IssueCluster[]): number {
  let score = cluster.severity_score * 10 + cluster.finding_count * 4;
  if (cluster.action_required) score += 18;
  if (cluster.actionability === "direct_action") score += 10;
  if (cluster.dominant_confidence === "high") score += 8;
  if (cluster.issue_cluster === "tracking_cvr_drop") score += 16;
  if (cluster.issue_cluster === "search_budget_cap") score += 12;
  if (cluster.issue_cluster === "geo_allocation") score += 14;
  if (cluster.issue_cluster === "network_quality") score += 12;
  if (cluster.issue_cluster === "pmax_cannibalization" || cluster.issue_cluster === "product_mix") score += 11;
  if (cluster.issue_cluster === "search_term_waste") score += 7;
  if (cluster.issue_cluster === "desktop_inefficiency" || cluster.issue_cluster === "mobile_opportunity") score += 3;
  if (cluster.coverage_dimensions.length >= 3) score += 12;
  if (cluster.coverage_dimensions.length === 2) score += 6;
  if (cluster.canonical_metric === "ROAS" || cluster.canonical_metric === "CPA" || cluster.canonical_metric === "Conversies") score += 6;
  if (isDerivativeSymptom(cluster, allClusters)) score -= 18;
  if (cluster.dominant_severity === "positive") score -= 25;
  return score;
}

function classifyCluster(cluster: IssueCluster): ThreadClassification {
  if (cluster.issue_cluster === "tracking_cvr_drop") return "measurement_risk";
  if (cluster.issue_cluster === "pmax_cannibalization") return cluster.action_required ? "contextual_shift" : "false_positive_alert";
  if (cluster.dominant_severity === "positive" || !cluster.action_required) return "false_positive_alert";
  if (cluster.actionability === "monitor") return "expected_tradeoff";
  return "real_problem";
}

function clusterConfidence(cluster: IssueCluster): Confidence {
  return cluster.dominant_confidence;
}

function businessImpact(cluster: IssueCluster): string {
  const parts = cluster.findings.slice(0, 3).map((finding) => {
    const change = finding.change_pct != null ? `${finding.change_pct > 0 ? "+" : ""}${finding.change_pct}%` : "geen delta";
    return `${titleCaseMetric(finding.canonical_metric)} ${change}`;
  });
  if (parts.length === 0) {
    return `${cluster.display_label} vraagt monitoring op ${cluster.canonical_metric}.`;
  }
  return `${cluster.display_label} wordt geraakt via ${parts.join(", ")}.`;
}

function monitoringMetrics(cluster: IssueCluster): string[] {
  return unique(
    cluster.findings
      .map((finding) => finding.canonical_metric)
      .concat(cluster.issue_cluster === "search_budget_cap" ? ["Search Lost IS (Budget)"] : [])
      .slice(0, 4)
  );
}

function threadTitle(cluster: IssueCluster): string {
  switch (cluster.issue_cluster) {
    case "tracking_cvr_drop":
      return "Meetrisico verstoort de interpretatie van de maand";
    case "search_budget_cap":
      return `${cluster.display_label} mist vraag door budgetbeperking`;
    case "desktop_inefficiency":
      return `Desktop drukt het rendement in ${cluster.display_label}`;
    case "pmax_cannibalization":
      return "PMax verschuift volume, maar is niet automatisch het hoofdprobleem";
    case "search_term_waste":
      return `Zoektermverspilling concentreert zich rond ${cluster.display_label}`;
    case "geo_allocation":
      return `Geo-allocatie rond ${cluster.display_label} is uit balans`;
    case "network_quality":
      return `Netwerkkwaliteit lekt rendement weg via ${cluster.display_label}`;
    case "schedule_waste":
      return `Advertentieplanning bevat inefficiënte uren voor ${cluster.display_label}`;
    default:
      return `${cluster.display_label}: ${cluster.canonical_metric}`;
  }
}

function createThreads(clusters: IssueCluster[]): {
  threads: AnalysisThread[];
  notProblem: string[];
} {
  const grouped = new Map<string, IssueCluster[]>();
  for (const cluster of clusters) {
    const key = threadFamily(cluster);
    const existing = grouped.get(key) || [];
    existing.push(cluster);
    grouped.set(key, existing);
  }

  const rankedGroups = Array.from(grouped.entries())
    .map(([key, group]) => {
      const rankedClusters = [...group].sort((a, b) => scoreCluster(b, clusters) - scoreCluster(a, clusters));
      const primary = rankedClusters[0];
      const groupScore = rankedClusters.reduce((sum, cluster) => sum + scoreCluster(cluster, clusters), 0) + (group.length - 1) * 10;
      return { key, group: rankedClusters, primary, groupScore };
    })
    .sort((a, b) => b.groupScore - a.groupScore);

  const topGroups = rankedGroups.slice(0, 3);
  const threads: AnalysisThread[] = topGroups.map(({ group, primary }, index) => ({
    id: `thread_${index + 1}_${primary.cluster_id}`,
    title: threadTitle(primary),
    priority: (index + 1) as 1 | 2 | 3,
    classification: classifyCluster(primary),
    root_cause_summary: unique(group.map((cluster) => cluster.root_cause_summary).filter(Boolean)).slice(0, 2).join(" / ") || primary.evidence_summary,
    business_impact: unique(group.map((cluster) => businessImpact(cluster))).slice(0, 2).join(" "),
    supporting_cluster_ids: group.map((cluster) => cluster.cluster_id),
    recommended_recommendation_ids: [],
    monitoring_metrics: unique(group.flatMap((cluster) => monitoringMetrics(cluster))).slice(0, 5),
    confidence: group.some((cluster) => cluster.dominant_confidence === "high")
      ? "high"
      : group.some((cluster) => cluster.dominant_confidence === "medium")
        ? "medium"
        : "low",
  }));

  const selectedClusterIds = new Set(topGroups.flatMap(({ group }) => group.map((cluster) => cluster.cluster_id)));
  const ranked = [...clusters].sort((a, b) => scoreCluster(b, clusters) - scoreCluster(a, clusters));
  const notProblem = ranked
    .filter((cluster) => !selectedClusterIds.has(cluster.cluster_id))
    .filter((cluster) => {
      const classification = classifyCluster(cluster);
      return classification === "contextual_shift" || classification === "false_positive_alert" || classification === "expected_tradeoff";
    })
    .slice(0, 3)
    .map((cluster) => `${cluster.display_label}: ${cluster.evidence_summary}`);

  return { threads, notProblem };
}

function phaseFromReadiness(cluster: IssueCluster, readiness: ActionReadiness): ActionPhase {
  if (cluster.issue_cluster === "tracking_cvr_drop") return "immediate";
  if (readiness === "direct_action" && (cluster.dominant_severity === "critical" || cluster.dominant_severity === "high")) return "immediate";
  if (readiness === "investigate_first") return "short_term";
  return cluster.issue_cluster === "product_mix" || cluster.issue_cluster === "pmax_cannibalization" ? "medium_term" : "short_term";
}

function readinessFromCluster(cluster: IssueCluster): ActionReadiness {
  if (!cluster.action_required || cluster.dominant_severity === "positive") return "monitor";
  if (cluster.issue_cluster === "tracking_cvr_drop") return "investigate_first";
  if (cluster.actionability === "investigate_first") return "investigate_first";
  if (cluster.actionability === "monitor") return "monitor";
  return "direct_action";
}

function evidenceFromCluster(cluster: IssueCluster): EvidenceLevel {
  if (cluster.issue_cluster === "tracking_cvr_drop") return "inferred";
  if (cluster.findings.some((finding) => finding.evidence_level === "hypothesis")) return "hypothesis";
  if (cluster.findings.some((finding) => finding.evidence_level === "inferred")) return "inferred";
  return "deterministic";
}

function ownerFromCluster(cluster: IssueCluster): "Ranking Masters" | "Klant" {
  if (cluster.issue_cluster === "tracking_cvr_drop" || cluster.issue_cluster === "product_mix") return "Ranking Masters";
  return "Ranking Masters";
}

function actionIntentFromCluster(cluster: IssueCluster): ActionIntentClass {
  switch (cluster.issue_cluster) {
    case "tracking_cvr_drop":
      return "tracking_validation";
    case "search_budget_cap":
      return "budget_expand";
    case "search_bidding_inflation":
    case "desktop_inefficiency":
      return "bid_lower";
    case "creative_mismatch":
      return "creative_refresh";
    case "pmax_cannibalization":
    case "product_mix":
      return "portfolio_ownership";
    case "search_term_waste":
      return "negative_cleanup";
    case "geo_allocation":
      return "geo_reallocation";
    case "audience_inefficiency":
      return "audience_refine";
    case "schedule_waste":
      return "schedule_control";
    case "network_quality":
    case "search_partner_waste":
      return "network_exclusion";
    case "mobile_opportunity":
      return cluster.dominant_severity === "positive" ? "budget_expand" : "investigation";
    default:
      return cluster.action_required ? "investigation" : "monitor_only";
  }
}

function dependencyList(cluster: IssueCluster): string[] {
  const deps: string[] = [];
  if (cluster.issue_cluster === "tracking_cvr_drop") deps.push("Valideer meting voordat bied- of budgetacties live gaan.");
  if (cluster.issue_cluster === "pmax_cannibalization" || cluster.issue_cluster === "product_mix") deps.push("Maak SKU- of asset-group ownership expliciet.");
  if (cluster.issue_cluster === "geo_allocation") deps.push("Bevestig of marge/voorraad per land gelijk is.");
  return deps;
}

function recommendationText(cluster: IssueCluster, readiness: ActionReadiness): {
  hypothesis: string;
  expectedResult: string;
  measurementMetric: string;
  timeframe: string;
  rationale: string;
} {
  const entity = cluster.display_label;
  const metrics = monitoringMetrics(cluster).join(", ");

  switch (cluster.issue_cluster) {
    case "tracking_cvr_drop":
      return {
        hypothesis: `Valideer tracking en conversiemeting voor ${entity} voordat verdere optimalisaties worden doorgevoerd`,
        expectedResult: "Herstel van betrouwbare CVR- en ROAS-sturing zonder foutieve optimalisatiebesluiten",
        measurementMetric: "CVR, Conversies, conversie-acties",
        timeframe: "Deze week",
        rationale: `${cluster.evidence_summary}. Zonder meetvalidatie zijn directe bied- of budgetacties onbetrouwbaar.`,
      };
    case "search_budget_cap":
      return {
        hypothesis: `Herstel budgetruimte in ${entity} zodat vraag niet wordt afgekapt op piekmomenten`,
        expectedResult: "Meer impression share en conversievolume zonder onnodige duplicatie van budgetacties",
        measurementMetric: "Search Lost IS (Budget), Conversies, ROAS",
        timeframe: "7-14 dagen",
        rationale: `${cluster.evidence_summary}. Budgetbeperking is hier het dominante verliesmechanisme.`,
      };
    case "desktop_inefficiency":
      return {
        hypothesis: `Verlaag desktopdruk in ${entity} en stuur terug op rendabele device-mix`,
        expectedResult: "Lagere CPA of hogere ROAS op desktop zonder accountbrede volumeschade",
        measurementMetric: "Desktop CPA, Desktop ROAS, Conversies",
        timeframe: "1-2 weken",
        rationale: `${cluster.evidence_summary}. Desktop levert een disproportioneel efficiencyverlies op.`,
      };
    case "search_term_waste":
      return {
        hypothesis: `Classificeer zoektermverspilling rond ${entity} en sluit alleen aantoonbaar veilige modifiers of off-catalog varianten uit`,
        expectedResult: "Minder waste spend zonder kernproducten of brede relevante vraag onnodig te blokkeren",
        measurementMetric: "Wasteful Spend, veilige uitsluitingen, Conversies, ROAS",
        timeframe: "Binnen 7 dagen",
        rationale: `${cluster.evidence_summary}. Maak onderscheid tussen broad-but-relevant, verkeerde intentlaag en echte off-catalog traffic.`,
      };
    case "pmax_cannibalization":
      return {
        hypothesis: `Definieer kanaalownership tussen PMax en Shopping rond ${entity} in plaats van beide tegelijk te laten concurreren`,
        expectedResult: "Schonere allocatie per SKU of assetgroep en minder schijnbare collapses",
        measurementMetric: "ROAS per kanaal, Conversiewaarde, SKU-overlap",
        timeframe: "2-4 weken",
        rationale: `${cluster.evidence_summary}. Dit lijkt eerder een verschuiving of overlapvraagstuk dan een geïsoleerde crash.`,
      };
    case "geo_allocation":
      return {
        hypothesis: `Heralloceer geo-budget rond ${entity} naar markten die aantoonbaar efficiënter converteren`,
        expectedResult: "Minder spend-lekkage naar zwakkere landen en een gezondere blended ROAS",
        measurementMetric: "ROAS per land, CPA per land, Spend share",
        timeframe: "1-2 weken",
        rationale: `${cluster.evidence_summary}. Landverschillen zijn groot genoeg om allocatiebeslissingen te rechtvaardigen.`,
      };
    case "network_quality":
      return {
        hypothesis: `Beperk laagwaardige netwerkinventory rond ${entity} en herstel focus op rendement`,
        expectedResult: "Minder spend-lekkage naar zwakke netwerken en hogere efficiency",
        measurementMetric: "CPA per netwerk, ROAS per netwerk, Conversies",
        timeframe: "7-10 dagen",
        rationale: `${cluster.evidence_summary}. De kwaliteit van het netwerk verklaart hier een belangrijk deel van het performanceverschil.`,
      };
    case "schedule_waste":
      return {
        hypothesis: `Snijd inefficiënte uren of dagdelen uit ${entity} en concentreer budget op rendabele vensters`,
        expectedResult: "Lagere CPA in zwakke uren en betere budgetdichtheid in sterke uren",
        measurementMetric: "CPA per uur, ROAS per uur, Spend share",
        timeframe: "Binnen 2 weken",
        rationale: `${cluster.evidence_summary}. Planning is hier een controleerbare efficiëntiehefboom.`,
      };
    default:
      return {
        hypothesis: readiness === "monitor"
          ? `Monitor ${entity} gericht op ${cluster.canonical_metric} en voorkom overreactie`
          : `Consolideer de optimalisatie rond ${entity} en pak ${cluster.canonical_metric} als hoofdhefboom aan`,
        expectedResult: readiness === "monitor"
          ? "Meer zekerheid over of het signaal structureel is"
          : "Gerichtere actie zonder dubbel werk of tegenstrijdige optimalisaties",
        measurementMetric: metrics,
        timeframe: readiness === "monitor" ? "Volgende maand" : "1-3 weken",
        rationale: `${cluster.evidence_summary}. ${cluster.root_cause_summary}`,
      };
  }
}

function iceScores(cluster: IssueCluster, readiness: ActionReadiness): Pick<Recommendation, "ice_impact" | "ice_confidence" | "ice_ease" | "ice_total"> {
  const impact = Math.min(10, Math.max(4, Math.round(cluster.severity_score / 2)));
  const confidence = readiness === "direct_action" ? (cluster.dominant_confidence === "high" ? 8 : 6) : readiness === "investigate_first" ? 5 : 4;
  const ease = cluster.issue_cluster === "tracking_cvr_drop" ? 6 : cluster.issue_cluster === "pmax_cannibalization" ? 4 : 7;
  return {
    ice_impact: impact,
    ice_confidence: confidence,
    ice_ease: ease,
    ice_total: Number(((impact + confidence + ease) / 3).toFixed(1)),
  };
}

function buildTasksForCluster(
  cluster: IssueCluster,
  phase: ActionPhase,
  threadId: string | null,
  recommendationIndex: number
): ThreadTask[] {
  const intent = actionIntentFromCluster(cluster);
  const entity = cluster.display_label;
  const unitKey = actionUnitKey(cluster);
  const baseTask = (title: string, description: string, actionType: Task["action_type"], priority: Task["priority"], dueDays: number): ThreadTask => ({
    recommendation_index: recommendationIndex,
    title,
    description,
    action_type: actionType,
    owner: ownerFromCluster(cluster),
    affected_campaign: cluster.findings.find((finding) => finding.entity_type === "campaign")?.canonical_entity_name ?? null,
    affected_adgroup: cluster.findings.find((finding) => finding.entity_type === "adgroup")?.canonical_entity_name ?? null,
    affected_keyword: cluster.findings.find((finding) => finding.entity_type === "keyword" || finding.entity_type === "searchterm")?.canonical_entity_name ?? null,
    current_value: cluster.evidence_summary.slice(0, 100),
    target_value: cluster.canonical_metric,
    priority: priority,
    frequency: phase === "immediate" ? "direct" : phase === "short_term" ? "weekly" : "biweekly",
    due_date_days: dueDays,
    cluster_id: cluster.cluster_id,
    thread_id: threadId,
    phase,
    action_intent_class: intent,
    action_unit_key: unitKey,
    primary_entity_scope: cluster.entity_scope,
    primary_entity_key: cluster.entity_identity_key,
    canonical_entity_name: entity,
    canonical_metric: cluster.canonical_metric,
  });

  switch (cluster.issue_cluster) {
    case "tracking_cvr_drop":
      return [
        baseTask(`Controleer conversiemeting ${entity}`.slice(0, 80), `Valideer tagging, conversie-acties en recente meetwijzigingen voor ${entity}.`, "tracking", "critical", 2),
        baseTask(`Vergelijk brondata ${entity}`.slice(0, 80), `Vergelijk account-, campagne- en actie-niveau zodat tracking en rapportage weer op één lijn staan.`, "audit", "high", 5),
      ];
    case "search_budget_cap":
      return [
        baseTask(`Controleer budgetcap ${entity}`.slice(0, 80), `Bevestig of budget de belangrijkste limiter is en bereken hoeveel volume nu wordt gemist.`, "budget", "critical", 3),
        baseTask(`Heralloceer budget naar ${entity}`.slice(0, 80), `Verplaats budget alleen vanuit zwakkere segmenten met aantoonbaar lagere efficiency.`, "budget", "high", 5),
      ];
    case "desktop_inefficiency":
      return [
        baseTask(`Corrigeer desktop bieddruk`.slice(0, 80), `Verlaag device- of campagne-instellingen die desktoprendement disproportioneel onder druk zetten.`, "bid", "high", 5),
        baseTask(`Monitor desktop herstel`.slice(0, 80), `Volg desktop CPA en ROAS wekelijks om te voorkomen dat volumeverlies het effect maskeert.`, "audit", "medium", 12),
      ];
    case "search_term_waste":
      return [
        baseTask(`Beoordeel veilige uitsluitingen`.slice(0, 80), `Sluit alleen off-catalog thema's of modifier-intents uit en bescherm kernproducttermen expliciet.`, "negative", "high", 4),
        baseTask(`Splits relevante brede termen`.slice(0, 80), `Verplaats broad-but-relevant termen naar betere routing, landing pages of aparte high-intent structuur.`, "structure", "medium", 10),
      ];
    case "pmax_cannibalization":
      return [
        baseTask(`Definieer kanaalownership`.slice(0, 80), `Maak expliciet welke SKU's of productsets door Shopping versus PMax gedragen moeten worden.`, "structure", "high", 10),
        baseTask(`Analyseer SKU-overlap`.slice(0, 80), `Cluster overlappende producten en bepaal welke kanaalcombinaties winstgevend zijn.`, "audit", "medium", 14),
      ];
    case "geo_allocation":
      return [
        baseTask(`Heralloceer geo-budget`.slice(0, 80), `Verplaats budget weg van landen die structureel onder target blijven.`, "budget", "high", 6),
        baseTask(`Bewaak landmix`.slice(0, 80), `Volg spend share, CPA en ROAS per land na de reallocatie.`, "audit", "medium", 14),
      ];
    case "network_quality":
      return [
        baseTask(`Snijd zwakke netwerken weg`.slice(0, 80), `Sluit of beperk inventory die duidelijk slechter presteert dan de hoofdnetwerken.`, "targeting", "high", 5),
        baseTask(`Meet netwerkherstel`.slice(0, 80), `Controleer CPA en conversiedichtheid per netwerk na de ingreep.`, "audit", "medium", 12),
      ];
    case "schedule_waste":
      return [
        baseTask(`Beperk inefficiënte uren`.slice(0, 80), `Pas advertentieplanning aan op uren of dagdelen met aantoonbaar zwakkere efficiency.`, "targeting", "high", 6),
        baseTask(`Meet verschuiving per dagdeel`.slice(0, 80), `Controleer of conversies verschuiven naar sterkere vensters in plaats van wegvallen.`, "audit", "medium", 14),
      ];
    default:
      return [
        baseTask(`Onderzoek ${entity}`.slice(0, 80), `Werk één geconsolideerde analyse af rond ${cluster.canonical_metric} om dubbel werk te voorkomen.`, "audit", cluster.action_required ? "high" : "medium", 7),
      ];
  }
}

function priorityRank(priority: Task["priority"]): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function selectPrimaryCluster(thread: AnalysisThread, clusters: IssueCluster[]): IssueCluster | null {
  const threadClusters = clusters.filter((cluster) => thread.supporting_cluster_ids.includes(cluster.cluster_id));
  if (threadClusters.length === 0) return null;
  return [...threadClusters].sort((a, b) => scoreCluster(b, clusters) - scoreCluster(a, clusters))[0];
}

function mergedDependencies(threadClusters: IssueCluster[]): string[] {
  return unique(threadClusters.flatMap((cluster) => dependencyList(cluster)));
}

function mergedMetrics(threadClusters: IssueCluster[]): string[] {
  return unique(threadClusters.flatMap((cluster) => monitoringMetrics(cluster)));
}

function mergedEvidenceSummary(threadClusters: IssueCluster[]): string {
  return unique(threadClusters.map((cluster) => cluster.evidence_summary).filter(Boolean)).slice(0, 3).join(" | ");
}

function buildRecommendationForThread(
  thread: AnalysisThread,
  allClusters: IssueCluster[]
): ThreadRecommendation | null {
  const threadClusters = allClusters.filter((cluster) => thread.supporting_cluster_ids.includes(cluster.cluster_id));
  const primary = selectPrimaryCluster(thread, allClusters);
  if (!primary) return null;

  const readiness = readinessFromCluster(primary);
  const evidenceLevel = evidenceFromCluster(primary);
  const phase = phaseFromReadiness(primary, readiness);
  const text = recommendationText(primary, readiness);
  const metrics = mergedMetrics(threadClusters);

  return {
    finding_index: null,
    source: "finding",
    hypothesis: text.hypothesis,
    expected_result: text.expectedResult,
    measurement_metric: metrics.slice(0, 4).join(", ") || text.measurementMetric,
    timeframe: text.timeframe,
    rationale: `${text.rationale} Ondersteund door ${threadClusters.length} cluster(s): ${mergedEvidenceSummary(threadClusters)}.`,
    ...iceScores(primary, readiness),
    action_readiness: readiness,
    evidence_level: evidenceLevel,
    confidence: thread.confidence,
    cluster_id: primary.cluster_id,
    thread_id: thread.id,
    phase,
    owner: ownerFromCluster(primary),
    dependencies: mergedDependencies(threadClusters),
    action_intent_class: actionIntentFromCluster(primary),
    action_unit_key: actionUnitKey(primary),
    primary_entity_scope: primary.entity_scope,
    primary_entity_key: primary.entity_identity_key,
    canonical_entity_name: primary.canonical_entity_name,
    canonical_metric: primary.canonical_metric,
  };
}

function buildTasksForThread(
  thread: AnalysisThread,
  clusters: IssueCluster[],
  recommendationIndex: number
): ThreadTask[] {
  const threadClusters = clusters.filter((cluster) => thread.supporting_cluster_ids.includes(cluster.cluster_id));
  const primary = selectPrimaryCluster(thread, clusters);
  if (!primary) return [];
  const phase = phaseFromReadiness(primary, readinessFromCluster(primary));

  const taskMap = new Map<string, ThreadTask>();
  for (const cluster of threadClusters) {
    for (const task of buildTasksForCluster(cluster, phase, thread.id, recommendationIndex)) {
      const signature = [
        task.owner,
        task.action_type,
        task.action_intent_class,
        actionUnitKey(cluster),
      ].join(":::");
      const existing = taskMap.get(signature);
      if (
        !existing ||
        priorityRank(task.priority) > priorityRank(existing.priority) ||
        task.due_date_days < existing.due_date_days
      ) {
        taskMap.set(signature, {
          ...task,
          cluster_id: primary.cluster_id,
          recommendation_index: recommendationIndex,
          thread_id: thread.id,
        });
      }
    }
  }

  return Array.from(taskMap.values())
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || a.due_date_days - b.due_date_days || a.title.localeCompare(b.title))
    .slice(0, 3);
}

function recommendationConflicts(a: ThreadRecommendation, b: ThreadRecommendation): boolean {
  if (a.action_unit_key !== b.action_unit_key) return false;
  if (a.primary_entity_scope !== b.primary_entity_scope) return false;
  if (a.primary_entity_key !== b.primary_entity_key) return false;

  const opposing: Record<ActionIntentClass, ActionIntentClass[]> = {
    budget_expand: ["budget_reduce", "pause_segment"],
    budget_reduce: ["budget_expand"],
    bid_raise: ["bid_lower"],
    bid_lower: ["bid_raise"],
    pause_segment: ["budget_expand", "bid_raise"],
    negative_cleanup: [],
    tracking_validation: [],
    network_exclusion: [],
    creative_refresh: [],
    geo_reallocation: [],
    schedule_control: [],
    portfolio_ownership: [],
    audience_refine: [],
    monitor_only: [],
    investigation: [],
  };

  return opposing[a.action_intent_class]?.includes(b.action_intent_class) ?? false;
}

function deduplicateAndResolve(
  recommendations: ThreadRecommendation[],
  tasks: ThreadTask[]
): {
  recommendations: ThreadRecommendation[];
  tasks: ThreadTask[];
} {
  const keptRecs: ThreadRecommendation[] = [];

  for (const recommendation of recommendations) {
    const conflictingIndex = keptRecs.findIndex((kept) => recommendationConflicts(kept, recommendation));
    if (conflictingIndex === -1) {
      keptRecs.push(recommendation);
      continue;
    }

    const kept = keptRecs[conflictingIndex];
    const keepNew =
      kept.phase !== "immediate" && recommendation.phase === "immediate"
      || (recommendation.ice_total > kept.ice_total);

    if (keepNew) keptRecs[conflictingIndex] = recommendation;
  }

  const recIndexByCluster = new Map<string, number>();
  keptRecs.forEach((recommendation, index) => {
    recIndexByCluster.set(recommendation.cluster_id, index);
  });

  const taskMap = new Map<string, ThreadTask>();
  for (const task of tasks) {
    const recommendationIndex = recIndexByCluster.get(task.cluster_id);
    if (recommendationIndex == null) continue;
    const normalizedTask: ThreadTask = { ...task, recommendation_index: recommendationIndex };
    const signature = [
      task.owner,
      task.action_type,
      task.action_intent_class,
      task.action_unit_key,
    ].join(":::");
    const existing = taskMap.get(signature);
    if (
      !existing ||
      priorityRank(normalizedTask.priority) > priorityRank(existing.priority) ||
      normalizedTask.due_date_days < existing.due_date_days
    ) {
      taskMap.set(signature, normalizedTask);
    }
  }

  const keptTasks = Array.from(taskMap.values()).sort((a, b) => a.due_date_days - b.due_date_days || a.title.localeCompare(b.title));

  return {
    recommendations: keptRecs,
    tasks: keptTasks,
  };
}

function buildSuccessScenario(
  threads: AnalysisThread[],
  recommendations: ThreadRecommendation[]
): SuccessScenario {
  const primary = threads[0];
  return {
    floor_scenario: primary
      ? `De maand is beter als ${primary.monitoring_metrics.slice(0, 2).join(" en ")} stabiliseren zonder nieuwe escalatie in ${primary.title.toLowerCase()}.`
      : "De maand is beter als de belangrijkste efficiëntiesignalen stabiliseren.",
    target_scenario: primary
      ? `Doelscenario: de primaire thread beweegt aantoonbaar richting herstel en minimaal twee ondersteunende threads blijven onder controle.`
      : "Doelscenario: rendement en volume bewegen tegelijk de goede kant op.",
    biggest_risk: recommendations.some((recommendation) => recommendation.action_intent_class === "tracking_validation")
      ? "Meetproblemen blijven onopgelost waardoor optimalisaties op verkeerde signalen worden gebaseerd."
      : "Te veel parallelle optimalisaties zonder duidelijke prioriteit vertroebelen het echte effect.",
    weekly_monitoring_checklist: unique(
      recommendations
        .slice(0, 5)
        .flatMap((recommendation) => [recommendation.measurement_metric, recommendation.canonical_metric])
        .filter(Boolean)
    ).slice(0, 5),
  };
}

function buildActionPlan(recommendations: ThreadRecommendation[]): Record<ActionPhase, string[]> {
  return {
    immediate: recommendations.filter((recommendation) => recommendation.phase === "immediate").map((recommendation) => recommendation.hypothesis),
    short_term: recommendations.filter((recommendation) => recommendation.phase === "short_term").map((recommendation) => recommendation.hypothesis),
    medium_term: recommendations.filter((recommendation) => recommendation.phase === "medium_term").map((recommendation) => recommendation.hypothesis),
  };
}

export function buildStructuredMonthlyOutput(opts: {
  stepSidecars: StepFindingSidecar[];
  findings: NormalizedFinding[];
  clusters: IssueCluster[];
  coverage: SopCoverage[];
  narrativeSteps: StepResult[];
  conclusion: StepResult;
}): MonthlyStructuredOutput {
  const { stepSidecars, findings, clusters, coverage, narrativeSteps, conclusion } = opts;
  const { threads, notProblem } = createThreads(clusters);

  const recommendations: ThreadRecommendation[] = [];
  const tasks: ThreadTask[] = [];

  threads.forEach((thread) => {
    const recommendationIndex = recommendations.length;
    const recommendation = buildRecommendationForThread(thread, clusters);
    if (!recommendation) return;
    recommendations.push(recommendation);
    tasks.push(...buildTasksForThread(thread, clusters, recommendationIndex));
  });

  const resolved = deduplicateAndResolve(recommendations, tasks);

  resolved.recommendations.forEach((recommendation, index) => {
    const thread = threads.find((candidate) => candidate.id === recommendation.thread_id);
    if (thread) thread.recommended_recommendation_ids.push(index);
  });

  const success = buildSuccessScenario(threads, resolved.recommendations);
  const actionPlan = buildActionPlan(resolved.recommendations);

  const executiveMarkdown = buildExecutiveMarkdown({
    threads,
    notProblem,
    recommendations: resolved.recommendations,
    tasks: resolved.tasks,
    coverage,
    success,
    conclusionText: conclusion.output,
  });

  return {
    step_sidecars: stepSidecars,
    findings,
    clusters,
    threads,
    recommendations: resolved.recommendations,
    tasks: resolved.tasks,
    coverage,
    what_is_not_the_problem: notProblem,
    success_next_month: success,
    action_plan: actionPlan,
    executive_markdown: executiveMarkdown,
    coverage_markdown: buildCoverageMarkdown(coverage),
    appendix_markdown: buildAppendixMarkdown(stepSidecars, narrativeSteps),
  };
}

export function buildCoverageMarkdown(coverage: SopCoverage[]): string {
  const lines = ["## SOP Coverage Appendix", ""];

  for (const row of coverage) {
    const statusLabel =
      row.status === "covered" ? "gedekt"
      : row.status === "no_signal" ? "geen materieel signaal"
      : "data niet beschikbaar";
    lines.push(`- ${row.dimension}: ${statusLabel}${row.findings_surfaced > 0 ? ` (${row.findings_surfaced} signalen)` : ""}. ${row.note}`);
  }

  return lines.join("\n");
}

export function buildAppendixMarkdown(stepSidecars: StepFindingSidecar[], narrativeSteps: StepResult[]): string {
  const lines = ["## Deep-dive Analytical Appendix", ""];

  for (const step of narrativeSteps) {
    lines.push(`### Stap ${step.stepNumber}: ${step.stepName}`);
    lines.push(step.output.trim());
    const sidecar = stepSidecars.find((candidate) => candidate.stepNumber === step.stepNumber);
    if (sidecar) {
      if (sidecar.findings.length > 0) {
        lines.push("");
        lines.push("Materiële step-sidecar signalen:");
        for (const finding of sidecar.findings.slice(0, 5)) {
          lines.push(`- ${finding.entity_name}: ${finding.metric}${finding.change_pct != null ? ` (${finding.change_pct > 0 ? "+" : ""}${finding.change_pct}%)` : ""} — ${finding.cause}`);
        }
      } else {
        lines.push("");
        lines.push("Materiële step-sidecar signalen:");
        lines.push("- Geen materieel signaal in deze stap.");
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function buildExecutiveMarkdown(opts: {
  threads: AnalysisThread[];
  notProblem: string[];
  recommendations: ThreadRecommendation[];
  tasks: ThreadTask[];
  coverage: SopCoverage[];
  success: SuccessScenario;
  conclusionText: string;
}): string {
  const { threads, notProblem, recommendations, tasks, coverage, success, conclusionText } = opts;
  const lines: string[] = ["## Executive Snapshot", ""];

  if (threads[0]) {
    lines.push(`Primaire thread: ${threads[0].title}. ${threads[0].business_impact}`);
  }
  if (threads.length > 1) {
    lines.push(`Ondersteunende threads: ${threads.slice(1).map((thread) => thread.title).join("; ")}.`);
  }

  lines.push("");
  lines.push("## Primary Thread");
  lines.push("");
  if (threads[0]) {
    lines.push(`- ${threads[0].title}`);
    lines.push(`- Root cause: ${threads[0].root_cause_summary}`);
    lines.push(`- Zakelijke impact: ${threads[0].business_impact}`);
    lines.push(`- Monitoring: ${threads[0].monitoring_metrics.join(", ")}`);
  } else {
    lines.push("- Geen primaire thread beschikbaar.");
  }

  lines.push("");
  lines.push("## Top 3 Threads");
  lines.push("");
  if (threads.length === 0) {
    lines.push("- Geen threads geselecteerd.");
  } else {
    for (const thread of threads) {
      lines.push(`- P${thread.priority}: ${thread.title} [${thread.classification}] — ${thread.business_impact}`);
    }
  }

  lines.push("");
  lines.push("## What Is Not The Problem");
  lines.push("");
  if (notProblem.length === 0) lines.push("- Geen expliciete false positive of contextverschuiving gedetecteerd.");
  for (const item of notProblem) lines.push(`- ${item}`);

  lines.push("");
  lines.push("## Action Plan By Phase");
  lines.push("");
  for (const phase of ["immediate", "short_term", "medium_term"] as ActionPhase[]) {
    lines.push(`### ${phase}`);
    const phaseItems = recommendations.filter((recommendation) => recommendation.phase === phase);
    if (phaseItems.length === 0) {
      lines.push("- Geen prioritaire acties in deze fase.");
      continue;
    }
    for (const recommendation of phaseItems) {
      lines.push(`- ${recommendation.hypothesis}`);
    }
  }

  lines.push("");
  lines.push("## Success Next Month");
  lines.push("");
  lines.push(`- Floor scenario: ${success.floor_scenario}`);
  lines.push(`- Target scenario: ${success.target_scenario}`);
  lines.push(`- Biggest risk: ${success.biggest_risk}`);
  lines.push(`- Wekelijkse checklist: ${success.weekly_monitoring_checklist.join(", ")}`);

  lines.push("");
  lines.push("## Recommendations Overview");
  lines.push("");
  for (const recommendation of recommendations.slice(0, 10)) {
    lines.push(`- [${recommendation.phase}] ${recommendation.hypothesis} — KPI: ${recommendation.measurement_metric} — eigenaar: ${recommendation.owner}`);
  }

  lines.push("");
  lines.push("## Task Plan");
  lines.push("");
  for (const task of tasks.slice(0, 12)) {
    lines.push(`- [${task.phase}] ${task.title} — ${task.owner} — deadline in ${task.due_date_days} dagen`);
  }

  lines.push("");
  lines.push("## Conclusion Context");
  lines.push("");
  lines.push(conclusionText.trim());

  lines.push("");
  lines.push(buildCoverageMarkdown(coverage));

  return lines.join("\n");
}

```


---

## `lib/analysis/product-context.ts`

```ts
import { detectSearchTermCountries } from "@/lib/countries";
import type {
  EvidenceSource,
  ExclusionSafety,
  ProductClassification,
  RecommendedScope,
  SearchTermVerdict,
} from "@/lib/schema/search-term-schema";

const STOPWORDS = new Set([
  "de", "het", "een", "en", "van", "voor", "met", "op", "in", "te", "bij", "tot", "of", "per", "aan",
  "the", "and", "for", "with", "from", "shop", "online", "best", "set", "rm",
  "maat", "kleur", "klein", "groot", "zwart", "wit", "blauw", "rood", "groen",
]);

const COMMERCIAL_MODIFIERS = [
  "kopen", "bestellen", "prijs", "prijzen", "aanbieding", "sale", "winkel", "shop",
  "online", "goedkoop", "beste", "reviews", "ervaring", "vergelijk", "offerte",
];

const REPAIR_MODIFIERS = [
  "rubber", "vervangen", "onderdeel", "onderdelen", "reparatie", "repareren",
  "service", "klantenservice", "manual", "handleiding", "onderhoud", "garantie",
];

const ACCESSORY_MODIFIERS = [
  "accessoire", "accessoires", "hoes", "filter", "navulling", "deksel",
  "standaard", "beugel", "adapter", "reserve", "spare", "refill",
];

const WRONG_INTENT_MODIFIERS = [
  "gratis", "marktplaats", "tweedehands", "vacature", "jobs", "baan",
];

const PRODUCT_SYNONYM_GROUPS = [
  ["douchewisser", "douche trekker", "douchetrekker", "shower squeegee", "duschabzieher"],
  ["karaf", "karaf", "waterkaraf", "wijnkaraf", "decanteerkaraf", "decanter"],
  ["wc rolhouder", "wc-rolhouder", "toiletrolhouder", "toilet rolhouder", "toilet paper holder", "klopapierhalter"],
];

export interface ProductContextSource {
  productTitles?: string[];
  productTypes?: string[];
  productBrands?: string[];
  customLabels?: string[];
  customAttributes?: string[];
  merchantProducts?: Array<{
    offerId: string;
    title: string;
    brand?: string | null;
    productType?: string | null;
    customLabels?: string[];
    customAttributes?: string[];
    link?: string | null;
  }>;
  keywords?: string[];
  adCopyPhrases?: string[];
  strategicContextText?: string;
  targetedCountries?: string[];
}

export interface ProductContext {
  catalogPhrases: Set<string>;
  catalogTokens: Set<string>;
  keywordPhrases: Set<string>;
  sitePhrases: Set<string>;
  strategicPhrases: Set<string>;
  aliasPhrases: Set<string>;
  productTypePhrases: Set<string>;
  customLabelPhrases: Set<string>;
  customAttributePhrases: Set<string>;
  entityIdsByPhrase: Map<string, Set<string>>;
  entityIdsByToken: Map<string, Set<string>>;
  targetedCountries: string[];
}

export interface ProductTermAssessment {
  productClassification: ProductClassification;
  soldByClient: boolean | "unknown";
  evidenceSource: EvidenceSource;
  recommendedScope: RecommendedScope;
  exclusionSafety: ExclusionSafety;
  matchedContext: string[];
  productContextStatus: "protected_relevant" | "relevant" | "review_first" | "not_sold";
  matchedCatalogEntityIds: string[];
  matchedAlias: string | null;
  matchConfidence: "high" | "medium" | "low";
  exclusionReasonType: "not_sold" | "variant_not_sold" | "wrong_intent" | "wrong_landing_page" | "wrong_routing" | "weak_performance_only" | "insufficient_evidence";
  reasoningLabel: string;
}

interface TermDecisionInput {
  searchTerm: string;
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
  conversions: number;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const baseTokens = normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

  const variants = new Set<string>();
  for (const token of baseTokens) {
    variants.add(token);
    if (token.endsWith("en") && token.length > 5) variants.add(token.slice(0, -2));
    if (token.endsWith("s") && token.length > 4) variants.add(token.slice(0, -1));
  }
  return Array.from(variants);
}

function addPhraseVocabulary(target: Set<string>, tokensTarget: Set<string>, raw: string): void {
  const normalized = normalizeText(raw);
  if (!normalized) return;
  target.add(normalized);

  const tokens = tokenize(raw);
  for (const token of tokens) tokensTarget.add(token);

  if (tokens.length >= 2) {
    for (let i = 0; i < tokens.length - 1; i++) {
      target.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  if (tokens.length >= 3) {
    target.add(tokens.slice(0, 3).join(" "));
  }
}

function addIndexedPhrase(
  target: Set<string>,
  tokensTarget: Set<string>,
  phraseEntityIds: Map<string, Set<string>>,
  tokenEntityIds: Map<string, Set<string>>,
  raw: string,
  entityId: string
): void {
  const normalized = normalizeText(raw);
  if (!normalized) return;
  target.add(normalized);
  if (!phraseEntityIds.has(normalized)) phraseEntityIds.set(normalized, new Set());
  phraseEntityIds.get(normalized)!.add(entityId);

  const tokens = tokenize(raw);
  for (const token of tokens) {
    tokensTarget.add(token);
    if (!tokenEntityIds.has(token)) tokenEntityIds.set(token, new Set());
    tokenEntityIds.get(token)!.add(entityId);
  }
}

function addAliasVocabulary(aliasTarget: Set<string>, phraseTargets: Set<string>[], tokenTarget: Set<string>, raw: string): void {
  const normalized = normalizeText(raw);
  if (!normalized) return;

  for (const group of PRODUCT_SYNONYM_GROUPS) {
    const normalizedGroup = group.map((item) => normalizeText(item));
    if (!normalizedGroup.includes(normalized)) continue;
    for (const alias of normalizedGroup) {
      aliasTarget.add(alias);
      for (const phraseTarget of phraseTargets) phraseTarget.add(alias);
      for (const token of tokenize(alias)) tokenTarget.add(token);
    }
  }
}

function hasAnyModifier(term: string, modifiers: string[]): boolean {
  return modifiers.some((modifier) => term.includes(modifier));
}

function bestPhraseMatch(term: string, phrases: Set<string>): string | null {
  const matches = Array.from(phrases).filter((phrase) => phrase && term.includes(phrase));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.length - a.length)[0];
}

function tokenOverlap(termTokens: string[], vocabulary: Set<string>): string[] {
  return termTokens.filter((token) => vocabulary.has(token));
}

function entityIdsFromMatches(
  matches: Array<string | null>,
  tokenMatches: string[],
  context: ProductContext
): string[] {
  const ids = new Set<string>();
  for (const match of matches) {
    if (!match) continue;
    for (const id of context.entityIdsByPhrase.get(match) ?? []) ids.add(id);
  }
  for (const token of tokenMatches) {
    for (const id of context.entityIdsByToken.get(token) ?? []) ids.add(id);
  }
  return Array.from(ids);
}

export function buildProductContext(source: ProductContextSource): ProductContext {
  const catalogPhrases = new Set<string>();
  const catalogTokens = new Set<string>();
  const keywordPhrases = new Set<string>();
  const sitePhrases = new Set<string>();
  const strategicPhrases = new Set<string>();
  const aliasPhrases = new Set<string>();
  const productTypePhrases = new Set<string>();
  const customLabelPhrases = new Set<string>();
  const customAttributePhrases = new Set<string>();
  const entityIdsByPhrase = new Map<string, Set<string>>();
  const entityIdsByToken = new Map<string, Set<string>>();

  for (const title of source.productTitles ?? []) {
    addPhraseVocabulary(catalogPhrases, catalogTokens, title);
    addAliasVocabulary(aliasPhrases, [catalogPhrases], catalogTokens, title);
  }
  for (const productType of source.productTypes ?? []) addPhraseVocabulary(productTypePhrases, catalogTokens, productType);
  for (const brand of source.productBrands ?? []) addPhraseVocabulary(catalogPhrases, catalogTokens, brand);
  for (const label of source.customLabels ?? []) addPhraseVocabulary(customLabelPhrases, catalogTokens, label);
  for (const attr of source.customAttributes ?? []) addPhraseVocabulary(customAttributePhrases, catalogTokens, attr);
  for (const keyword of source.keywords ?? []) {
    addPhraseVocabulary(keywordPhrases, catalogTokens, keyword);
    addAliasVocabulary(aliasPhrases, [keywordPhrases, catalogPhrases], catalogTokens, keyword);
  }
  for (const phrase of source.adCopyPhrases ?? []) {
    addPhraseVocabulary(sitePhrases, catalogTokens, phrase);
    addAliasVocabulary(aliasPhrases, [sitePhrases, catalogPhrases], catalogTokens, phrase);
  }
  for (const phrase of (source.strategicContextText || "").split(/[,\n.;]/g)) {
    addPhraseVocabulary(strategicPhrases, catalogTokens, phrase);
    addAliasVocabulary(aliasPhrases, [strategicPhrases, catalogPhrases], catalogTokens, phrase);
  }
  for (const product of source.merchantProducts ?? []) {
    addIndexedPhrase(catalogPhrases, catalogTokens, entityIdsByPhrase, entityIdsByToken, product.title, product.offerId);
    if (product.brand) addIndexedPhrase(catalogPhrases, catalogTokens, entityIdsByPhrase, entityIdsByToken, product.brand, product.offerId);
    if (product.productType) addIndexedPhrase(productTypePhrases, catalogTokens, entityIdsByPhrase, entityIdsByToken, product.productType, product.offerId);
    for (const label of product.customLabels ?? []) addIndexedPhrase(customLabelPhrases, catalogTokens, entityIdsByPhrase, entityIdsByToken, label, product.offerId);
    for (const attr of product.customAttributes ?? []) addIndexedPhrase(customAttributePhrases, catalogTokens, entityIdsByPhrase, entityIdsByToken, attr, product.offerId);
    addAliasVocabulary(aliasPhrases, [catalogPhrases, customLabelPhrases, productTypePhrases], catalogTokens, product.title);
  }

  return {
    catalogPhrases,
    catalogTokens,
    keywordPhrases,
    sitePhrases,
    strategicPhrases,
    aliasPhrases,
    productTypePhrases,
    customLabelPhrases,
    customAttributePhrases,
    entityIdsByPhrase,
    entityIdsByToken,
    targetedCountries: source.targetedCountries ?? [],
  };
}

export function assessSearchTermAgainstProductContext(
  input: TermDecisionInput,
  context: ProductContext
): ProductTermAssessment {
  const normalizedTerm = normalizeText(input.searchTerm);
  const termTokens = tokenize(input.searchTerm);
  const matchedContext: string[] = [];

  const catalogMatch = bestPhraseMatch(normalizedTerm, context.catalogPhrases);
  const keywordMatch = bestPhraseMatch(normalizedTerm, context.keywordPhrases);
  const siteMatch = bestPhraseMatch(normalizedTerm, context.sitePhrases);
  const strategicMatch = bestPhraseMatch(normalizedTerm, context.strategicPhrases);
  const aliasMatch = bestPhraseMatch(normalizedTerm, context.aliasPhrases);
  const productTypeMatch = bestPhraseMatch(normalizedTerm, context.productTypePhrases);
  const customLabelMatch = bestPhraseMatch(normalizedTerm, context.customLabelPhrases);
  const customAttributeMatch = bestPhraseMatch(normalizedTerm, context.customAttributePhrases);
  const tokenMatches = tokenOverlap(termTokens, context.catalogTokens);
  const matchedCatalogEntityIds = entityIdsFromMatches(
    [catalogMatch, aliasMatch, productTypeMatch, customLabelMatch, customAttributeMatch],
    tokenMatches,
    context
  );

  if (catalogMatch) matchedContext.push(`feed:${catalogMatch}`);
  if (keywordMatch) matchedContext.push(`keyword:${keywordMatch}`);
  if (siteMatch) matchedContext.push(`site:${siteMatch}`);
  if (strategicMatch) matchedContext.push(`context:${strategicMatch}`);
  if (aliasMatch) matchedContext.push(`alias:${aliasMatch}`);
  if (productTypeMatch) matchedContext.push(`type:${productTypeMatch}`);
  if (customLabelMatch) matchedContext.push(`label:${customLabelMatch}`);
  if (customAttributeMatch) matchedContext.push(`attr:${customAttributeMatch}`);
  if (tokenMatches.length > 0) matchedContext.push(`tokens:${tokenMatches.slice(0, 4).join(",")}`);

  const soldByClient: boolean | "unknown" =
    catalogMatch || keywordMatch || siteMatch || strategicMatch || aliasMatch || productTypeMatch || customLabelMatch || customAttributeMatch || tokenMatches.length >= 1
      ? true
      : context.catalogPhrases.size > 0 || context.keywordPhrases.size > 0 || context.sitePhrases.size > 0 || context.aliasPhrases.size > 0
        ? termTokens.length >= 2 && tokenMatches.length === 0
          ? false
          : "unknown"
        : "unknown";

  const detectedCountries = detectSearchTermCountries(input.searchTerm);
  const targetedCountries = context.targetedCountries.length > 0 ? context.targetedCountries : ["NL", "BE"];
  const wrongGeo = detectedCountries.every((country) => !targetedCountries.includes(country));

  if (wrongGeo && soldByClient !== true) {
      return {
        productClassification: "wrong_language_or_geo",
        soldByClient,
        evidenceSource: "lexical_inference",
        recommendedScope: "campaign",
        exclusionSafety: "safe_to_exclude",
        matchedContext,
        productContextStatus: "not_sold",
        matchedCatalogEntityIds,
        matchedAlias: aliasMatch,
        matchConfidence: "high",
        exclusionReasonType: "not_sold",
        reasoningLabel: "Verkeerde taal of geo-context voor deze targeting.",
      };
    }

  const hasRepairIntent = hasAnyModifier(normalizedTerm, REPAIR_MODIFIERS);
  const hasAccessoryIntent = hasAnyModifier(normalizedTerm, ACCESSORY_MODIFIERS);
  const hasCommercialIntent = hasAnyModifier(normalizedTerm, COMMERCIAL_MODIFIERS);
  const hasBadIntent = hasAnyModifier(normalizedTerm, WRONG_INTENT_MODIFIERS);

  if (soldByClient === true) {
    const evidenceSource: EvidenceSource =
      catalogMatch ? "feed_match"
      : aliasMatch ? "strategic_context"
      : siteMatch || keywordMatch ? "site_match"
      : strategicMatch ? "strategic_context"
      : "lexical_inference";

    if (hasRepairIntent) {
      return {
        productClassification: "repair_or_support_intent",
        soldByClient: true,
        evidenceSource,
        recommendedScope: "adgroup",
        exclusionSafety: "safe_to_exclude_modifier_only",
        matchedContext,
        productContextStatus: "review_first",
        matchedCatalogEntityIds,
        matchedAlias: aliasMatch,
        matchConfidence: catalogMatch || aliasMatch ? "high" : "medium",
        exclusionReasonType: "wrong_intent",
        reasoningLabel: "Relevant product, maar repair/support-intent vraagt modifier- of routingsturing.",
      };
    }

    if (hasAccessoryIntent) {
      return {
        productClassification: "accessory_or_spare_part",
        soldByClient: true,
        evidenceSource,
        recommendedScope: "adgroup",
        exclusionSafety: "review_first",
        matchedContext,
        productContextStatus: "review_first",
        matchedCatalogEntityIds,
        matchedAlias: aliasMatch,
        matchConfidence: aliasMatch || customLabelMatch ? "high" : "medium",
        exclusionReasonType: "variant_not_sold",
        reasoningLabel: "Relevant assortiment, maar accessoire/spare-part intent moet apart beoordeeld worden.",
      };
    }

    if ((catalogMatch || aliasMatch) && hasCommercialIntent) {
      return {
        productClassification: "core_product_high_intent",
        soldByClient: true,
        evidenceSource,
        recommendedScope: "monitor_only",
        exclusionSafety: "unsafe_to_exclude",
        matchedContext,
        productContextStatus: "protected_relevant",
        matchedCatalogEntityIds,
        matchedAlias: aliasMatch,
        matchConfidence: "high",
        exclusionReasonType: "weak_performance_only",
        reasoningLabel: "Kernproduct met koopintentie; onderzoek uitvoering in plaats van uitsluiten.",
      };
    }

    if (catalogMatch || aliasMatch || tokenMatches.length >= 2) {
      return {
        productClassification: catalogMatch === normalizedTerm || aliasMatch === normalizedTerm ? "core_product_exact" : "core_product_broad",
        soldByClient: true,
        evidenceSource,
        recommendedScope: "monitor_only",
        exclusionSafety: "unsafe_to_exclude",
        matchedContext,
        productContextStatus: "protected_relevant",
        matchedCatalogEntityIds,
        matchedAlias: aliasMatch,
        matchConfidence: catalogMatch || aliasMatch || customLabelMatch || productTypeMatch ? "high" : "medium",
        exclusionReasonType: "weak_performance_only",
        reasoningLabel: "Relevant kernproduct; brede of zwakke performance is geen bewijs dat de term buiten assortiment valt.",
      };
    }

    if (tokenMatches.length >= 1 && hasCommercialIntent) {
      return {
        productClassification: "core_product_high_intent",
        soldByClient: true,
        evidenceSource,
        recommendedScope: "monitor_only",
        exclusionSafety: "unsafe_to_exclude",
        matchedContext,
        productContextStatus: "relevant",
        matchedCatalogEntityIds,
        matchedAlias: aliasMatch,
        matchConfidence: "medium",
        exclusionReasonType: "wrong_routing",
        reasoningLabel: "Relevante productterm met koopintentie; eerst routing, prijs of LP controleren.",
      };
    }

    if (tokenMatches.length >= 1) {
      return {
        productClassification: "core_product_broad",
        soldByClient: true,
        evidenceSource,
        recommendedScope: "monitor_only",
        exclusionSafety: "unsafe_to_exclude",
        matchedContext,
        productContextStatus: "relevant",
        matchedCatalogEntityIds,
        matchedAlias: aliasMatch,
        matchConfidence: "medium",
        exclusionReasonType: "wrong_routing",
        reasoningLabel: "Brede maar relevante productterm; behandel dit als kwaliteit-, routing- of LP-vraagstuk.",
      };
    }
  }

  if (soldByClient === false && hasBadIntent) {
    return {
      productClassification: "off_catalog",
      soldByClient: false,
      evidenceSource: "lexical_inference",
      recommendedScope: "account",
      exclusionSafety: "safe_to_exclude",
      matchedContext,
      productContextStatus: "not_sold",
      matchedCatalogEntityIds,
      matchedAlias: aliasMatch,
      matchConfidence: "high",
      exclusionReasonType: "not_sold",
      reasoningLabel: "Niet passend bij assortiment of accountfocus.",
    };
  }

  const clearlyUnrelated =
    soldByClient === false &&
    termTokens.length >= 2 &&
    tokenMatches.length === 0 &&
    !hasCommercialIntent &&
    !hasRepairIntent &&
    !hasAccessoryIntent;

  if (clearlyUnrelated) {
    return {
      productClassification: "off_catalog",
      soldByClient: false,
      evidenceSource: "unknown",
      recommendedScope: "account",
      exclusionSafety: "safe_to_exclude",
      matchedContext,
      productContextStatus: "not_sold",
      matchedCatalogEntityIds,
      matchedAlias: aliasMatch,
      matchConfidence: "high",
      exclusionReasonType: "not_sold",
      reasoningLabel: "Geen catalogus-, site-, alias- of businesscontextmatch gevonden voor een duidelijke niet-passende term.",
    };
  }

  if (soldByClient === "unknown" || soldByClient === false) {
    return {
      productClassification: "ambiguous_needs_review",
      soldByClient: soldByClient === false ? "unknown" : soldByClient,
      evidenceSource: "unknown",
      recommendedScope: "monitor_only",
      exclusionSafety: "review_first",
      matchedContext,
      productContextStatus: "review_first",
      matchedCatalogEntityIds,
      matchedAlias: aliasMatch,
      matchConfidence: "low",
      exclusionReasonType: "insufficient_evidence",
      reasoningLabel: "Onvoldoende context om een off-catalog of mismatch-oordeel hard te claimen.",
    };
  }

  return {
    productClassification: "adjacent_category",
    soldByClient,
    evidenceSource: tokenMatches.length > 0 ? "lexical_inference" : "unknown",
    recommendedScope: "campaign",
    exclusionSafety: "review_first",
    matchedContext,
    productContextStatus: "review_first",
    matchedCatalogEntityIds,
    matchedAlias: aliasMatch,
    matchConfidence: tokenMatches.length >= 2 ? "medium" : "low",
    exclusionReasonType: "insufficient_evidence",
    reasoningLabel: "Term lijkt aanpalend of routinggevoelig, niet direct off-catalog.",
  };
}

type VerdictWithData = SearchTermVerdict & {
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
};

export function applyProductContextDecisioning<T extends VerdictWithData>(
  verdicts: T[],
  context: ProductContext
): T[] {
  for (const verdict of verdicts) {
    const assessment = assessSearchTermAgainstProductContext({
      searchTerm: verdict.searchTerm,
      campaignName: verdict.campaignName,
      adGroupName: verdict.adGroupName,
      clicks: verdict.clicks,
      cost: verdict.cost,
      conversions: verdict.conversions,
    }, context);

    verdict.productClassification = assessment.productClassification;
    verdict.soldByClient = assessment.soldByClient === "unknown" ? undefined : assessment.soldByClient;
    verdict.evidenceSource = assessment.evidenceSource;
    verdict.recommendedScope = assessment.recommendedScope;
    verdict.exclusionSafety = assessment.exclusionSafety;
    verdict.matchedContext = assessment.matchedContext;
    verdict.displayLabel = `Zoekterm: ${verdict.searchTerm}`;

    const isNegative = verdict.recommendedAction === "negative_exact" || verdict.recommendedAction === "negative_phrase";

    if (assessment.exclusionSafety === "unsafe_to_exclude") {
      if (isNegative) {
        verdict.saferAlternativeAction = verdict.recommendedAction;
        verdict.recommendedAction = verdict.conversions > 0 ? "keep" : "investigate";
      }
      verdict.verdict = verdict.conversions > 0 ? "relevant" : "partially_relevant";
      verdict.actionReadiness = "investigate_first";
      verdict.requiresHumanReview = verdict.conversions === 0;
      verdict.reason = `${assessment.reasoningLabel} Aanbevolen: structuur, bieding, feed of landingspagina verbeteren in plaats van de productstam uit te sluiten.`;
      continue;
    }

    if (assessment.exclusionSafety === "safe_to_exclude_modifier_only") {
      if (verdict.recommendedAction === "negative_phrase") {
        verdict.saferAlternativeAction = verdict.recommendedAction;
      }
      verdict.recommendedAction = "investigate";
      verdict.actionReadiness = "investigate_first";
      verdict.requiresHumanReview = true;
      verdict.reason = `${assessment.reasoningLabel} Sluit alleen modifiers of sub-intent uit, niet de productstam.`;
      continue;
    }

    if (assessment.exclusionSafety === "review_first") {
      if (isNegative) verdict.saferAlternativeAction = verdict.recommendedAction;
      if (isNegative) verdict.recommendedAction = "investigate";
      verdict.actionReadiness = "investigate_first";
      verdict.requiresHumanReview = true;
      verdict.reason = `${assessment.reasoningLabel} Review first voordat uitsluiting wordt doorgevoerd.`;
      continue;
    }

    if (assessment.exclusionSafety === "safe_to_exclude") {
      if (verdict.recommendedAction === "keep") verdict.recommendedAction = "negative_exact";
      verdict.verdict = "irrelevant";
      verdict.actionReadiness = verdict.recommendedAction === "negative_exact" ? "direct_action" : "investigate_first";
      verdict.reason = `${assessment.reasoningLabel} Uitsluiting is veilig op ${assessment.recommendedScope}-niveau.`;
    }
  }

  return verdicts;
}

export function summarizeProductContext(context: ProductContext): string {
  const feedTerms = Array.from(context.catalogPhrases).slice(0, 20).join(", ");
  const keywordTerms = Array.from(context.keywordPhrases).slice(0, 12).join(", ");
  const siteTerms = Array.from(context.sitePhrases).slice(0, 12).join(", ");
  const typeTerms = Array.from(context.productTypePhrases).slice(0, 12).join(", ");
  const labelTerms = Array.from(context.customLabelPhrases).slice(0, 12).join(", ");

  return [
    "## Product- en businesscontext",
    `- Feed/catalogusmatch: ${feedTerms || "geen expliciete feedtermen beschikbaar"}`,
    `- Producttypes / labels: ${typeTerms || labelTerms || "geen expliciete Merchant types of labels beschikbaar"}`,
    `- Keyword/site-context: ${keywordTerms || siteTerms || "geen expliciete keyword/site-termen beschikbaar"}`,
    `- Targetmarkten: ${(context.targetedCountries.length > 0 ? context.targetedCountries.join(", ") : "onbekend")}`,
    "- Kernregel: noem een zoekterm alleen irrelevante traffic als er geen catalogus-, site- of business-contextmatch is.",
  ].join("\n");
}

```


---

## `lib/api/merchant-products.ts`

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken, type GoogleAdsCredentials } from "@/lib/api/google-ads";

const MERCHANT_API_BASE = "https://merchantapi.googleapis.com/products/v1";
const DEFAULT_CACHE_HOURS = 24;

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /merchant_product_snapshots/i.test(message) && /schema cache|does not exist|relation/i.test(message);
}

export interface MerchantProductSnapshot {
  client_id: string;
  account_id: string;
  offer_id: string;
  product_name: string | null;
  title: string;
  normalized_title: string;
  brand: string | null;
  product_type: string | null;
  product_type_l1: string | null;
  product_type_l2: string | null;
  product_type_l3: string | null;
  product_type_l4: string | null;
  product_type_l5: string | null;
  custom_label_0: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  custom_label_4: string | null;
  link: string | null;
  availability: string | null;
  language_code: string | null;
  feed_label: string | null;
  channel: string | null;
  custom_attributes_jsonb: Record<string, unknown> | null;
  source_payload_jsonb: Record<string, unknown> | null;
  snapshot_at: string;
  is_active: boolean;
}

export interface MerchantSyncResult {
  tracker: "fresh_cache" | "stale_cache" | "synced" | "unavailable";
  products: MerchantProductSnapshot[];
  message: string;
}

interface MerchantConfig {
  merchantAccountId: string | null;
  feedLabel: string | null;
  contentLanguage: string | null;
  channel: string | null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitProductType(value: string | null): string[] {
  if (!value) return [];
  return value.split(">").map((part) => part.trim()).filter(Boolean).slice(0, 5);
}

function readString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readCustomAttributes(source: Record<string, unknown>): Record<string, unknown> | null {
  const raw = source.customAttributes || source.custom_attributes;
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function buildSnapshotRow(
  clientId: string,
  accountId: string,
  payload: Record<string, unknown>,
  snapshotAt: string
): MerchantProductSnapshot | null {
  const name = readString(payload, "name");
  const attributes = (payload.attributes || {}) as Record<string, unknown>;
  const productInput = (payload.productInput || payload.product_input || {}) as Record<string, unknown>;
  const merged = { ...productInput, ...attributes, ...payload };

  const offerId = readString(merged, "offerId", "offer_id");
  const title = readString(merged, "title");
  if (!offerId || !title) return null;

  const productType = readString(merged, "productType", "product_type");
  const productTypeLevels = splitProductType(productType);
  const customAttributes = readCustomAttributes(merged);

  return {
    client_id: clientId,
    account_id: accountId,
    offer_id: offerId,
    product_name: name,
    title,
    normalized_title: normalizeText(title),
    brand: readString(merged, "brand"),
    product_type: productType,
    product_type_l1: productTypeLevels[0] ?? null,
    product_type_l2: productTypeLevels[1] ?? null,
    product_type_l3: productTypeLevels[2] ?? null,
    product_type_l4: productTypeLevels[3] ?? null,
    product_type_l5: productTypeLevels[4] ?? null,
    custom_label_0: readString(merged, "customLabel0", "custom_label_0"),
    custom_label_1: readString(merged, "customLabel1", "custom_label_1"),
    custom_label_2: readString(merged, "customLabel2", "custom_label_2"),
    custom_label_3: readString(merged, "customLabel3", "custom_label_3"),
    custom_label_4: readString(merged, "customLabel4", "custom_label_4"),
    link: readString(merged, "link"),
    availability: readString(merged, "availability"),
    language_code: readString(merged, "contentLanguage", "content_language"),
    feed_label: readString(merged, "feedLabel", "feed_label"),
    channel: readString(merged, "channel"),
    custom_attributes_jsonb: customAttributes,
    source_payload_jsonb: payload,
    snapshot_at: snapshotAt,
    is_active: true,
  };
}

async function readMerchantConfig(
  supabase: SupabaseClient,
  clientId: string
): Promise<MerchantConfig> {
  const { data } = await supabase
    .from("client_settings")
    .select("merchant_account_id, merchant_feed_label, merchant_content_language, merchant_channel")
    .eq("client_id", clientId)
    .maybeSingle();

  return {
    merchantAccountId:
      (data?.merchant_account_id as string | null | undefined) ??
      process.env.GOOGLE_MERCHANT_ACCOUNT_ID ??
      null,
    feedLabel: (data?.merchant_feed_label as string | null | undefined) ?? process.env.GOOGLE_MERCHANT_FEED_LABEL ?? null,
    contentLanguage:
      (data?.merchant_content_language as string | null | undefined) ??
      process.env.GOOGLE_MERCHANT_CONTENT_LANGUAGE ??
      null,
    channel: (data?.merchant_channel as string | null | undefined) ?? process.env.GOOGLE_MERCHANT_CHANNEL ?? null,
  };
}

async function loadCachedSnapshots(
  supabase: SupabaseClient,
  clientId: string
): Promise<MerchantProductSnapshot[]> {
  const { data, error } = await supabase
    .from("merchant_product_snapshots")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .order("snapshot_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as MerchantProductSnapshot[]);
}

async function fetchProcessedMerchantProducts(
  credentials: GoogleAdsCredentials,
  accountId: string
): Promise<Record<string, unknown>[]> {
  const accessToken = await getAccessToken(credentials);
  const allProducts: Record<string, unknown>[] = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(`${MERCHANT_API_BASE}/accounts/${accountId}/products`);
    url.searchParams.set("pageSize", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Merchant API error (${response.status}): ${error}`);
    }

    const data = await response.json() as { products?: Record<string, unknown>[]; nextPageToken?: string };
    allProducts.push(...(data.products ?? []));
    pageToken = data.nextPageToken ?? null;
  } while (pageToken);

  return allProducts;
}

export async function syncMerchantProductSnapshots(opts: {
  supabase: SupabaseClient;
  clientId: string;
  credentials: GoogleAdsCredentials | null;
  forceRefresh?: boolean;
  maxAgeHours?: number;
}): Promise<MerchantSyncResult> {
  const { supabase, clientId, credentials, forceRefresh = false, maxAgeHours = DEFAULT_CACHE_HOURS } = opts;
  let cached: MerchantProductSnapshot[] = [];
  try {
    cached = await loadCachedSnapshots(supabase, clientId);
  } catch (error) {
    if (isMissingTableError(error)) {
      return {
        tracker: "unavailable",
        products: [],
        message: "Merchant snapshot-tabel ontbreekt; gebruik fallback context tot de migratie is uitgevoerd.",
      };
    }
    throw error;
  }
  const freshest = cached[0]?.snapshot_at ? new Date(cached[0].snapshot_at).getTime() : 0;
  const isFresh = freshest > 0 && freshest > Date.now() - maxAgeHours * 60 * 60 * 1000;

  if (cached.length > 0 && isFresh && !forceRefresh) {
    return {
      tracker: "fresh_cache",
      products: cached,
      message: `Merchant cache is vers (${cached.length} producten).`,
    };
  }

  const config = await readMerchantConfig(supabase, clientId);
  if (!config.merchantAccountId || !credentials) {
    return {
      tracker: cached.length > 0 ? "stale_cache" : "unavailable",
      products: cached,
      message: cached.length > 0
        ? "Merchant cache gebruikt omdat live Merchant-config ontbreekt."
        : "Geen Merchant-accountconfig beschikbaar.",
    };
  }

  try {
    const snapshotAt = new Date().toISOString();
    const products = await fetchProcessedMerchantProducts(credentials, config.merchantAccountId);
    const rows = products
      .map((payload) => buildSnapshotRow(clientId, config.merchantAccountId!, payload, snapshotAt))
      .filter(Boolean) as MerchantProductSnapshot[];

    const filteredRows = rows.filter((row) => {
      if (config.feedLabel && row.feed_label && row.feed_label !== config.feedLabel) return false;
      if (config.contentLanguage && row.language_code && row.language_code.toLowerCase() !== config.contentLanguage.toLowerCase()) return false;
      if (config.channel && row.channel && row.channel.toLowerCase() !== config.channel.toLowerCase()) return false;
      return true;
    });

    if (filteredRows.length > 0) {
      const { error } = await supabase
        .from("merchant_product_snapshots")
        .upsert(filteredRows, {
          onConflict: "client_id,account_id,offer_id",
          ignoreDuplicates: false,
        });
      if (error) throw error;
    }

    const latest = await loadCachedSnapshots(supabase, clientId);
    return {
      tracker: "synced",
      products: latest,
      message: `Merchant snapshot vernieuwd (${latest.length} producten).`,
    };
  } catch (error) {
    if (isMissingTableError(error)) {
      return {
        tracker: "unavailable",
        products: cached,
        message: "Merchant snapshot-tabel ontbreekt; fallback-context gebruikt.",
      };
    }
    console.error("[merchant] sync failed:", error instanceof Error ? error.message : String(error));
    return {
      tracker: cached.length > 0 ? "stale_cache" : "unavailable",
      products: cached,
      message: cached.length > 0
        ? "Merchant sync faalde, maar bestaande snapshot blijft bruikbaar."
        : "Merchant sync faalde en er is geen snapshot beschikbaar.",
    };
  }
}

```


---

## `lib/analysis/enrichment.ts`

```ts
/**
 * Enrichment matrix: determines which expert layers to apply per SOP type.
 *
 * Replaces the ad-hoc layer selection that was scattered across route handlers.
 * Each SOP type gets a consistent, configurable set of context layers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "../prompts/sop-prompts";
import {
  fetchStrategicContext,
  calculatePortfolioAnalysis,
  fetchHypothesisTracking,
  calculateLeadingIndicators,
  fetchSectorBenchmarks,
  fetchEnhancedChangeHistory,
  calculateGeoContext,
} from "./expert-layers";
import { computePmaxInsights, type PmaxInsights } from "./pmax-expert-layer";
import {
  getDimensionAvailability,
  buildAvailabilitySummary,
  type ClientDimensionProfile,
} from "./dimension-availability";

// ── Types ──────────────────────────────────────────────────────────────────

export type SopType = "monthly" | "weekly" | "biweekly";

export interface EnrichmentContext {
  strategicContext: string;
  portfolioAnalysis: string;
  hypothesisTracking: string;
  leadingIndicators: string;
  sectorBenchmarks: string;
  changeHistory: string;
  /** Summary of which analysis dimensions are available for this client */
  dimensionAvailability: string;
  /** Full dimension profile for programmatic use */
  dimensionProfile: ClientDimensionProfile | null;
  /** PMAX intelligence context */
  pmaxContext: string;
  /** Full PMAX insights for programmatic use */
  pmaxInsights: PmaxInsights | null;
  /** Geographic/country performance context */
  geoContext: string;
}

/**
 * Which layers are enabled per SOP type.
 *
 * Monthly: all layers (full deep-dive)
 * Weekly: no portfolio or hypothesis (quick health check)
 * Biweekly: no portfolio or leading indicators (check-in against monthly)
 */
const ENRICHMENT_MATRIX: Record<SopType, {
  strategicContext: boolean;
  portfolioAnalysis: boolean;
  hypothesisTracking: boolean;
  leadingIndicators: boolean;
  sectorBenchmarks: boolean;
  changeHistory: boolean;
}> = {
  monthly: {
    strategicContext: true,
    portfolioAnalysis: true,
    hypothesisTracking: true,
    leadingIndicators: true,
    sectorBenchmarks: true,
    changeHistory: true,
  },
  weekly: {
    strategicContext: true,
    portfolioAnalysis: false,
    hypothesisTracking: false,
    leadingIndicators: true,
    sectorBenchmarks: true,
    changeHistory: true,
  },
  biweekly: {
    strategicContext: true,
    portfolioAnalysis: false,
    hypothesisTracking: true,
    leadingIndicators: false,
    sectorBenchmarks: true,
    changeHistory: true,
  },
};

// ── Builder ────────────────────────────────────────────────────────────────

interface EnrichmentOpts {
  supabase: SupabaseClient;
  clientId: string;
  accountType: AccountType;
  sopType: SopType;
  /** Required for strategic context date filtering */
  analysisDate: string;
  /** Required for portfolio analysis — pass campaignData + campaignMetaData */
  campaignData?: Record<string, unknown>[];
  campaignMetaData?: Record<string, unknown>[];
}

/**
 * Build the enrichment context for an analysis run.
 * Only fetches layers enabled in the enrichment matrix for the given SOP type.
 * All layers run in parallel for performance.
 */
export async function buildEnrichmentContext(opts: EnrichmentOpts): Promise<EnrichmentContext> {
  const { supabase, clientId, accountType, sopType, analysisDate, campaignData, campaignMetaData } = opts;
  const matrix = ENRICHMENT_MATRIX[sopType];

  const result: EnrichmentContext = {
    strategicContext: "",
    portfolioAnalysis: "",
    hypothesisTracking: "",
    leadingIndicators: "",
    sectorBenchmarks: "",
    changeHistory: "",
    dimensionAvailability: "",
    dimensionProfile: null,
    pmaxContext: "",
    pmaxInsights: null,
    geoContext: "",
  };

  // Build array of parallel fetches based on matrix
  const tasks: Promise<void>[] = [];

  if (matrix.strategicContext) {
    tasks.push(
      fetchStrategicContext(supabase, clientId, analysisDate)
        .then((v) => { result.strategicContext = v; })
        .catch((e) => { console.error("[enrichment] strategicContext failed:", e); })
    );
  }

  if (matrix.portfolioAnalysis && campaignData && campaignMetaData) {
    tasks.push(
      calculatePortfolioAnalysis(supabase, clientId, campaignData, campaignMetaData)
        .then((v) => { result.portfolioAnalysis = v; })
        .catch((e) => { console.error("[enrichment] portfolioAnalysis failed:", e); })
    );
  }

  if (matrix.hypothesisTracking) {
    tasks.push(
      fetchHypothesisTracking(supabase, clientId)
        .then((v) => { result.hypothesisTracking = v; })
        .catch((e) => { console.error("[enrichment] hypothesisTracking failed:", e); })
    );
  }

  if (matrix.leadingIndicators) {
    tasks.push(
      calculateLeadingIndicators(supabase, clientId)
        .then((v) => { result.leadingIndicators = v; })
        .catch((e) => { console.error("[enrichment] leadingIndicators failed:", e); })
    );
  }

  if (matrix.sectorBenchmarks) {
    tasks.push(
      fetchSectorBenchmarks(supabase, accountType, clientId)
        .then((v) => { result.sectorBenchmarks = v; })
        .catch((e) => { console.error("[enrichment] sectorBenchmarks failed:", e); })
    );
  }

  if (matrix.changeHistory) {
    tasks.push(
      fetchEnhancedChangeHistory(supabase, clientId)
        .then((v) => { result.changeHistory = v; })
        .catch((e) => { console.error("[enrichment] changeHistory failed:", e); })
    );
  }

  // Always compute PMAX insights (only produces output if PMAX campaigns exist)
  tasks.push(
    computePmaxInsights(supabase, clientId)
      .then((insights) => {
        result.pmaxInsights = insights;
        result.pmaxContext = insights.promptContext;
      })
      .catch((e) => { console.error("[enrichment] pmaxInsights failed:", e); })
  );

  // Always compute geo context (only produces output if multi-country)
  tasks.push(
    calculateGeoContext(supabase, clientId)
      .then((v) => { result.geoContext = v; })
      .catch((e) => { console.error("[enrichment] geoContext failed:", e); })
  );

  // Always fetch dimension availability (lightweight query)
  tasks.push(
    getDimensionAvailability(supabase, clientId)
      .then((profile) => {
        result.dimensionProfile = profile;
        result.dimensionAvailability = buildAvailabilitySummary(profile, sopType);
      })
      .catch((e) => { console.error("[enrichment] dimensionAvailability failed:", e); })
  );

  await Promise.all(tasks);
  return result;
}

```


---

## `lib/analysis/expert-layers.ts`

```ts
/**
 * Expert layers for the analysis pipeline.
 * Each layer fetches/computes enrichment data and formats it for AI consumption.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "../prompts/sop-prompts";

// ── LAAG 1: Strategische context ────────────────────────────────────────────

export async function fetchStrategicContext(
  supabase: SupabaseClient,
  clientId: string,
  analysisDate: string
): Promise<string> {
  const { data } = await supabase
    .from("sop_client_context")
    .select("*")
    .eq("client_id", clientId)
    .lte("valid_from", analysisDate)
    .or(`valid_until.is.null,valid_until.gte.${analysisDate}`)
    .order("valid_from", { ascending: false });

  const rows = data ?? [];
  if (rows.length === 0) return "";

  const lines = rows.map((r: Record<string, unknown>) => {
    const until = r.valid_until ? String(r.valid_until) : "heden";
    const impact = r.impact_on_analysis ? `\n  Impact op analyse: ${r.impact_on_analysis}` : "";
    return `- ${r.valid_from} tot ${until}: ${r.title} — ${r.description}${impact}`;
  });

  return `\n\n## Strategische context voor deze klant\n${lines.join("\n")}`;
}

// ── LAAG 2: Portfolio analyse ───────────────────────────────────────────────

interface CampaignRow {
  campaign_name: string;
  campaign_id: string;
  month: string;
  cost: number;
  conversions: number;
  conversions_value: number;
  roas: number;
}

interface MetaRow {
  campaign_id: string;
  campaign_type: string;
}

function classifyType(type: string): "PMAX" | "SEARCH" | "SHOPPING" | "OTHER" {
  const t = (type || "").toUpperCase();
  if (t.includes("PERFORMANCE_MAX")) return "PMAX";
  if (t.includes("SEARCH")) return "SEARCH";
  if (t.includes("SHOPPING")) return "SHOPPING";
  return "OTHER";
}

export async function calculatePortfolioAnalysis(
  supabase: SupabaseClient,
  clientId: string,
  campaignData: Record<string, unknown>[],
  campaignMetaData: Record<string, unknown>[]
): Promise<string> {
  // Get the last 2 months of data
  const months = [...new Set(campaignData.map((c) => c.month as string))].sort();
  const lastMonth = months[months.length - 1];
  const prevMonth = months.length > 1 ? months[months.length - 2] : null;

  if (!lastMonth) return "";

  const metaMap = new Map<string, string>();
  for (const m of campaignMetaData as unknown as MetaRow[]) {
    metaMap.set(m.campaign_id, m.campaign_type);
  }

  const lastMonthData = campaignData.filter((c) => c.month === lastMonth) as unknown as CampaignRow[];

  // Calculate per type
  const byType = { PMAX: { cost: 0, conv: 0, value: 0 }, SEARCH: { cost: 0, conv: 0, value: 0 }, SHOPPING: { cost: 0, conv: 0, value: 0 }, OTHER: { cost: 0, conv: 0, value: 0 } };
  let totalCost = 0;
  let totalConv = 0;

  for (const c of lastMonthData) {
    const type = classifyType(metaMap.get(c.campaign_id) || "");
    byType[type].cost += c.cost;
    byType[type].conv += c.conversions;
    byType[type].value += c.conversions_value;
    totalCost += c.cost;
    totalConv += c.conversions;
  }

  const pct = (v: number, total: number) => total > 0 ? parseFloat(((v / total) * 100).toFixed(1)) : 0;

  // Concentration risk
  const campCosts = lastMonthData.map((c) => ({ name: c.campaign_name, cost: c.cost })).sort((a, b) => b.cost - a.cost);
  const topCampaign = campCosts[0];
  const topCampaignPct = pct(topCampaign?.cost ?? 0, totalCost);
  const concentrationRisk = topCampaignPct > 70;

  // PMAX/Search overlap
  const pmaxActive = byType.PMAX.cost > 0;
  const searchActive = byType.SEARCH.cost > 0;
  const overlap = pmaxActive && searchActive;

  // Portfolio efficiency (weighted avg ROAS)
  const portfolioRoas = totalCost > 0
    ? parseFloat((lastMonthData.reduce((s, c) => s + c.conversions_value, 0) / totalCost).toFixed(2))
    : 0;

  // MoM change
  let momPct: number | null = null;
  if (prevMonth) {
    const prevData = campaignData.filter((c) => c.month === prevMonth) as unknown as CampaignRow[];
    const prevTotalCost = prevData.reduce((s, c) => s + c.cost, 0);
    const prevTotalValue = prevData.reduce((s, c) => s + c.conversions_value, 0);
    const prevRoas = prevTotalCost > 0 ? prevTotalValue / prevTotalCost : 0;
    if (prevRoas > 0) {
      momPct = parseFloat((((portfolioRoas - prevRoas) / prevRoas) * 100).toFixed(1));
    }
  }

  // Upsert to Supabase
  await supabase.from("ads_portfolio_analysis").upsert({
    client_id: clientId,
    month: lastMonth,
    pmax_cost_pct: pct(byType.PMAX.cost, totalCost),
    search_cost_pct: pct(byType.SEARCH.cost, totalCost),
    shopping_cost_pct: pct(byType.SHOPPING.cost, totalCost),
    other_cost_pct: pct(byType.OTHER.cost, totalCost),
    pmax_conv_pct: pct(byType.PMAX.conv, totalConv),
    search_conv_pct: pct(byType.SEARCH.conv, totalConv),
    shopping_conv_pct: pct(byType.SHOPPING.conv, totalConv),
    other_conv_pct: pct(byType.OTHER.conv, totalConv),
    budget_concentration_risk: concentrationRisk,
    top_campaign_cost_pct: topCampaignPct,
    top_campaign_name: topCampaign?.name ?? null,
    pmax_search_overlap: overlap,
    portfolio_efficiency_score: portfolioRoas,
    portfolio_efficiency_mom_pct: momPct,
  }, { onConflict: "client_id,month" });

  // Format for AI
  const momStr = momPct !== null ? ` (${momPct > 0 ? "+" : ""}${momPct}% MoM)` : "";
  const concRisk = concentrationRisk
    ? `Ja — ${topCampaign?.name} neemt ${topCampaignPct}% van het budget`
    : "Nee — budget is gespreid";

  return `\n\n## Portfolio analyse (${lastMonth})
- Budget verdeling: PMAX ${pct(byType.PMAX.cost, totalCost)}%, Search ${pct(byType.SEARCH.cost, totalCost)}%, Shopping ${pct(byType.SHOPPING.cost, totalCost)}%, Overig ${pct(byType.OTHER.cost, totalCost)}%
- Conversie verdeling: PMAX ${pct(byType.PMAX.conv, totalConv)}%, Search ${pct(byType.SEARCH.conv, totalConv)}%, Shopping ${pct(byType.SHOPPING.conv, totalConv)}%, Overig ${pct(byType.OTHER.conv, totalConv)}%
- Concentratierisico: ${concRisk}
- PMAX/Search overlap: ${overlap ? "Ja — beide actief" : "Nee"}
- Portfolio efficiëntie score: ${portfolioRoas} ROAS${momStr}`;
}

// ── LAAG 3: Hypothese tracking ──────────────────────────────────────────────

export async function fetchHypothesisTracking(
  supabase: SupabaseClient,
  clientId: string
): Promise<string> {
  const { data } = await supabase
    .from("sop_hypothesis_tracking")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "implemented")
    .is("measured_at", null)
    .order("implemented_at", { ascending: false });

  const rows = data ?? [];
  if (rows.length === 0) return "";

  const lines = rows.map((r: Record<string, unknown>) => {
    const notes = r.implementation_notes ? `\n  Notities: ${r.implementation_notes}` : "";
    return `- ${r.implemented_at}: ${r.hypothesis}\n  Verwacht: ${r.expected_result} via ${r.measurement_metric} binnen ${r.timeframe}${notes}`;
  });

  return `\n\n## Uitgevoerde hypotheses — nog niet gemeten\n${lines.join("\n")}`;
}

// ── LAAG 4: Leading indicators ──────────────────────────────────────────────

export async function calculateLeadingIndicators(
  supabase: SupabaseClient,
  clientId: string
): Promise<string> {
  // Fetch conversion lag setting for this client (default: 3 days)
  const { data: settingsRow } = await supabase
    .from("client_settings")
    .select("conversion_lag_days")
    .eq("client_id", clientId)
    .maybeSingle();
  const lagDays = (settingsRow?.conversion_lag_days as number) ?? 3;

  // A week is "immature" if its end date falls within the lag window
  const today = new Date();
  const safeDate = new Date(today);
  safeDate.setDate(safeDate.getDate() - lagDays);
  const safeDateStr = safeDate.toISOString().split("T")[0];

  // Fetch last 6 weeks of weekly data to compute WoW for last 4
  const { data: weeklyData } = await supabase
    .from("ads_account_weekly")
    .select("*")
    .eq("client_id", clientId)
    .order("week_start", { ascending: false })
    .limit(6);

  const weeks = (weeklyData ?? []).reverse() as Record<string, unknown>[];
  if (weeks.length < 2) return "";

  const indicators: Record<string, unknown>[] = [];

  for (let i = 1; i < weeks.length; i++) {
    const cur = weeks[i];
    const prev = weeks[i - 1];

    // Determine if this week's data is immature (conversion data may be incomplete)
    const weekStart = String(cur.week_start || "");
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const isImmature = weekEnd >= safeDate;

    const wow = (curVal: unknown, prevVal: unknown): number | null => {
      const c = Number(curVal) || 0;
      const p = Number(prevVal) || 0;
      if (p === 0) return null;
      return parseFloat((((c - p) / p) * 100).toFixed(1));
    };

    const ctrWow = wow(cur.ctr, prev.ctr);
    const cpcWow = wow(cur.avg_cpc, prev.avg_cpc);
    const crWow = wow(cur.conversion_rate, prev.conversion_rate);
    const cpaWow = wow(cur.cost_per_conversion, prev.cost_per_conversion);

    const flagCtrDropping = ctrWow !== null && ctrWow < -10;
    const flagCpcRising = cpcWow !== null && cpcWow > 10;
    // Conversion-dependent flags are suppressed for immature weeks
    const flagConvRateDropping = !isImmature && crWow !== null && crWow < -10;
    const flagIsDropping = false;
    const flagBudgetPressure = false;
    const flagQualityPressure = false;

    // Tracking break detection — suppressed for immature weeks AND budget contractions
    const clicksWow = wow(cur.clicks, prev.clicks);
    const conversionsWow = wow(cur.conversions, prev.conversions);
    const curClicks = Number(cur.clicks) || 0;
    const curConversions = Number(cur.conversions) || 0;
    const prevConversions = Number(prev.conversions) || 0;
    const curCost = Number(cur.cost) || 0;
    const prevCost = Number(prev.cost) || 0;
    const costWow = wow(cur.cost, prev.cost);

    // Detect budget contraction: spend dropped >25% → conversion drop is likely budget-driven
    const isBudgetContraction = costWow !== null && costWow < -25;

    let flagTrackingBreak = false;
    let flagBudgetContraction = false;

    if (isBudgetContraction && conversionsWow !== null && conversionsWow < -30) {
      // Spend dropped sharply AND conversions dropped → budget contraction, NOT tracking break
      flagBudgetContraction = true;
    } else if (!isImmature) {
      // Only check tracking break if NOT a budget contraction and NOT immature
      const classicTrackingBreak =
        curClicks > 0 &&
        (clicksWow === null || clicksWow > -20) &&
        prevConversions > 0 &&
        (curConversions === 0 || (conversionsWow !== null && conversionsWow < -80));

      const curEfficiency = curCost > 0 ? curConversions / curCost : 0;
      const prevEfficiency = prevCost > 0 ? prevConversions / prevCost : 0;
      const efficiencyBreak =
        prevEfficiency > 0 &&
        curCost > 0 &&
        (curEfficiency / prevEfficiency) < 0.25 &&
        (clicksWow === null || clicksWow > -30) &&
        !isBudgetContraction; // Exclude if spend also crashed

      flagTrackingBreak = classicTrackingBreak || efficiencyBreak;
    }

    const warningCount = [flagIsDropping, flagCtrDropping, flagCpcRising, flagConvRateDropping, flagBudgetPressure, flagQualityPressure, flagTrackingBreak].filter(Boolean).length;

    const row = {
      client_id: clientId,
      week_start: cur.week_start,
      avg_ctr_wow_pct: ctrWow,
      avg_cpc_wow_pct: cpcWow,
      conversion_rate_wow_pct: crWow,
      cost_per_conversion_wow_pct: cpaWow,
      impression_share_wow_pct: null,
      flag_is_dropping: flagIsDropping,
      flag_ctr_dropping: flagCtrDropping,
      flag_cpc_rising: flagCpcRising,
      flag_conv_rate_dropping: flagConvRateDropping,
      flag_budget_pressure: flagBudgetPressure,
      flag_quality_pressure: flagQualityPressure,
      warning_count: warningCount,
    };

    indicators.push({ ...row, flag_tracking_break: flagTrackingBreak, flag_budget_contraction: flagBudgetContraction, is_immature: isImmature });

    // Upsert (without tracking_break/immature flags — not in table schema)
    await supabase.from("ads_leading_indicators").upsert(row, { onConflict: "client_id,week_start" });
  }

  // Format last 4 weeks for AI
  const last4 = indicators.slice(-4);
  if (last4.length === 0) return "";

  const lines = last4.map((w) => {
    const wc = w.warning_count as number;
    const immature = w.is_immature as boolean;
    const flags: string[] = [];
    if (immature) flags.push(`IMMATURE DATA (conversielag ${lagDays} dagen) — conversie-metrics zijn onvolledig, niet alarmerend`);
    if (w.flag_budget_contraction) flags.push(`BUDGETDALING: spend daalde scherp — conversiedaling is waarschijnlijk budget-gerelateerd, GEEN tracking break`);
    if (w.flag_tracking_break) flags.push("TRACKING BREAK WAARSCHIJNLIJK: clicks stabiel maar conversies >80% gedaald — controleer conversietracking!");
    if (w.flag_ctr_dropping) flags.push(`CTR daalt ${w.avg_ctr_wow_pct}% WoW`);
    if (w.flag_cpc_rising) flags.push(`CPC stijgt ${w.avg_cpc_wow_pct}% WoW`);
    if (w.flag_conv_rate_dropping) flags.push(`Conv. rate daalt ${w.conversion_rate_wow_pct}% WoW`);
    if (w.flag_budget_pressure) flags.push("Budget druk: >20% IS verlies door budget");
    const flagStr = flags.length > 0 ? "\n  " + flags.map((f) => `- ${f}`).join("\n  ") : "";
    return `Week ${w.week_start}: ${wc} waarschuwing${wc !== 1 ? "en" : ""}${flagStr}`;
  });

  // Add conversion lag context note for AI
  const lagNote = lagDays > 0
    ? `\nDit account heeft een conversievertraging van ${lagDays} dagen. Interpreteer lichte tot gemiddelde dalingen in conversie-metrics in de meest recente periode voorzichtig, tenzij input-metrics zoals impressies en klikken ook scherp dalen.`
    : "";

  return `\n\n## Early warning signalen (laatste 4 weken)${lagNote}\n${lines.join("\n")}`;
}

// ── LAAG 5: Sectorale benchmarks ────────────────────────────────────────────

const SECTOR_LABELS: Record<string, string> = {
  ecommerce_laag_ticket: "E-commerce (laag ticket, AOV < €50)",
  ecommerce_mid_ticket: "E-commerce (mid ticket, AOV €50-€250)",
  ecommerce_hoog_ticket: "E-commerce (hoog ticket, AOV > €250)",
  ecommerce_fashion: "E-commerce fashion",
  ecommerce_electronics: "E-commerce elektronica",
  ecommerce_huisdieren: "E-commerce huisdieren",
  ecommerce_general: "E-commerce algemeen",
  fysiotherapie: "Fysiotherapie / Physical Therapy",
  zorg_generiek: "Gezondheidszorg",
  b2b_saas: "B2B SaaS / Software",
  b2b_software: "B2B SaaS / Software",
  b2b_leadgen: "B2B dienstverlening",
  leadgen_generiek: "Lokale dienstverlening",
  automotive: "Automotive",
  legal: "Juridische dienstverlening",
  finance: "Finance & Verzekeringen",
  horeca: "Horeca",
  retail_local: "Lokale retail",
  hybrid: "Hybrid (Shopping + Search)",
};

const AOV_MAP: Record<string, string> = {
  low_ticket: "ecommerce_laag_ticket",
  mid_ticket: "ecommerce_mid_ticket",
  high_ticket: "ecommerce_hoog_ticket",
};

function resolveSector(
  sectorFromDb: string | null | undefined,
  aovSegmentFromDb: string | null | undefined,
  accountType: AccountType
): string | null {
  if (sectorFromDb) return sectorFromDb;

  if (accountType === "ecommerce_roas" || accountType === "ecommerce_cpa") {
    return AOV_MAP[aovSegmentFromDb ?? ""] ?? "ecommerce_mid_ticket";
  }
  if (accountType === "leadgen_cpa" || accountType === "leadgen_volume") return "leadgen_generiek";
  if (accountType === "hybrid") return "hybrid";
  return null;
}

export async function fetchSectorBenchmarks(
  supabase: SupabaseClient,
  accountType: AccountType,
  clientId?: string
): Promise<string> {
  // Read sector + aov_segment from client_settings
  let sectorFromDb: string | null = null;
  let aovSegmentFromDb: string | null = null;

  if (clientId) {
    const { data: cs } = await supabase
      .from("client_settings")
      .select("sector, aov_segment")
      .eq("client_id", clientId)
      .maybeSingle();

    if (cs) {
      sectorFromDb = cs.sector as string | null;
      aovSegmentFromDb = cs.aov_segment as string | null;
    }
  }

  const sector = resolveSector(sectorFromDb, aovSegmentFromDb, accountType);
  if (!sector) return "";

  const sectorLabel = SECTOR_LABELS[sector] ?? sector;

  // Try exact match first (sector + accountType), then sector-only fallback
  let { data } = await supabase
    .from("benchmark_sectors")
    .select("*")
    .eq("sector", sector)
    .eq("account_type", accountType);

  // If no results with exact accountType match and sector was explicitly set,
  // fetch any benchmarks for this sector regardless of accountType
  if ((!data || data.length === 0) && sectorFromDb) {
    const fallback = await supabase
      .from("benchmark_sectors")
      .select("*")
      .eq("sector", sector);
    data = fallback.data;
  }

  const rows = data ?? [];
  if (rows.length === 0) return "";

  // Build table rows
  const metricOrder = ["ctr", "conversion_rate", "cpa", "roas", "avg_cpc"];
  const metricLabels: Record<string, string> = {
    ctr: "CTR",
    conversion_rate: "Conv. Rate",
    cpa: "CPA",
    roas: "ROAS",
    avg_cpc: "Avg. CPC",
  };

  const rowMap = new Map<string, Record<string, unknown>>();
  for (const r of rows as Record<string, unknown>[]) {
    rowMap.set(r.metric as string, r);
  }

  const isInverse = (m: string) => m === "cpa" || m === "avg_cpc"; // lower is better

  const fmtVal = (metric: string, value: unknown): string => {
    const v = Number(value);
    if (isNaN(v)) return "-";
    if (metric === "cpa" || metric === "avg_cpc") return `€${v}`;
    if (metric === "ctr" || metric === "conversion_rate") return `${v}%`;
    return `${v}`;
  };

  const tableRows = metricOrder
    .filter((m) => rowMap.has(m))
    .map((m) => {
      const r = rowMap.get(m)!;
      const label = (metricLabels[m] ?? m).padEnd(15);
      if (isInverse(m)) {
        // For CPA/CPC: low = bad (high number), top10 = good (low number)
        return `| ${label} | >${fmtVal(m, r.low).padEnd(8)} | ${fmtVal(m, r.median).padEnd(9)} | ${fmtVal(m, r.high).padEnd(7)} | ${fmtVal(m, r.top10).padEnd(7)} |`;
      }
      return `| ${label} | <${fmtVal(m, r.low).padEnd(8)} | ${fmtVal(m, r.median).padEnd(9)} | ${fmtVal(m, r.high).padEnd(7)} | ${fmtVal(m, r.top10).padEnd(7)} |`;
    });

  const isAov = sector.includes("ecommerce_") && sector.includes("ticket");
  const aovNote = isAov
    ? "\n\nBij een AOV in dit segment: beoordeel ROAS in context van de marge. Een lagere ROAS vereist hogere marges om winstgevend te blijven."
    : "";

  return `\n\n## Sectorale benchmarks: ${sectorLabel}
Bron: WordStream/LocaliQ/Triple Whale 2025 — NL/EU gecorrigeerd

| Metric          | Onder gem. | Gemiddeld | Goed    | Top 10% |
|-----------------|-----------|-----------|---------|---------|
${tableRows.join("\n")}

Let op: CPA en CPC — lager is beter, dus kolommen zijn omgedraaid.${aovNote}`;
}

// ── LAAG 6: Enhanced change history ─────────────────────────────────────────

export async function fetchEnhancedChangeHistory(
  supabase: SupabaseClient,
  clientId: string,
  daysBack: number = 60
): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const { data } = await supabase
    .from("ads_change_history")
    .select("change_datetime, change_type, campaign_name, old_value, new_value, resource_type, user_email")
    .eq("client_id", clientId)
    .gte("change_datetime", since.toISOString())
    .order("change_datetime", { ascending: false })
    .limit(30);

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return "";

  const lines = rows.map((r) => {
    const date = String(r.change_datetime ?? "").split("T")[0] || "onbekend";
    const campaign = r.campaign_name || "onbekend";
    const type = r.change_type || r.resource_type || "wijziging";
    const oldVal = r.old_value && r.old_value !== '""' ? r.old_value : "-";
    const newVal = r.new_value && r.new_value !== '""' ? r.new_value : "-";

    // Detect reason from context (budget changes, bid changes, etc.)
    let reason = "";
    let expectedImpact = "";
    const oldStr = String(oldVal);
    const newStr = String(newVal);

    if (oldStr.includes("budget") || newStr.includes("budget") || type === "CAMPAIGN_BUDGET") {
      reason = "Budgetwijziging";
      expectedImpact = "Direct effect op volume en impressies";
    } else if (type === "CAMPAIGN" && (oldStr.includes("bidding") || newStr.includes("bidding"))) {
      reason = "Biedstrategie wijziging";
      expectedImpact = "Mogelijke leerfase herstart (2-4 weken)";
    }

    const reasonLine = reason ? `\n  Reden: ${reason}\n  Verwacht effect: ${expectedImpact}` : "\n  Reden: ONBEKEND — overweeg reden te documenteren";

    return `- ${date}: ${type} op ${campaign} — van ${oldVal} naar ${newVal}${reasonLine}`;
  });

  return `\n\n## Recente wijzigingen in dit account (laatste ${daysBack} dagen)\n${lines.join("\n")}`;
}


// ── LAAG 7: Geografische context ───────────────────────────────────────────

/**
 * Build geo/country context for SOP analysis.
 * Fetches ads_country_monthly + ads_country_yoy and formats per-country
 * performance summary for AI consumption.
 *
 * Only produces output if the client has data in multiple countries.
 */
export async function calculateGeoContext(
  supabase: SupabaseClient,
  clientId: string
): Promise<string> {
  // Fetch last 3 months of country data
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const startDate = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: countryData }, { data: yoyData }, { data: campaignCountryData }] = await Promise.all([
    supabase
      .from("ads_country_monthly")
      .select("country_code, month, impressions, clicks, cost, conversions, conversions_value, ctr, avg_cpc, cost_per_conversion, conversion_rate, roas, campaign_count, spend_share")
      .eq("client_id", clientId)
      .gte("month", startDate)
      .order("month", { ascending: false }),
    supabase
      .from("ads_country_yoy")
      .select("country_code, month, conversions_yoy_pct, conversions_value_yoy_pct, cost_yoy_pct, roas_yoy_pct, cost_per_conversion_yoy_pct")
      .eq("client_id", clientId)
      .gte("month", startDate),
    supabase
      .from("ads_campaign_country_monthly")
      .select("campaign_name, country_code, cost, conversions, conversions_value, campaign_spend_share")
      .eq("client_id", clientId)
      .gte("month", startDate)
      .gt("cost", 0),
  ]);

  if (!countryData || countryData.length === 0) return "";

  // Check how many countries — if only 1, minimal context needed
  const countries = [...new Set(countryData.map((r) => r.country_code as string))];
  if (countries.length <= 1) return "";

  const COUNTRY_NAMES: Record<string, string> = {
    NL: "Nederland", DE: "Duitsland", BE: "België", FR: "Frankrijk",
    GB: "Verenigd Koninkrijk", AT: "Oostenrijk", CH: "Zwitserland",
    ES: "Spanje", IT: "Italië", US: "Verenigde Staten", PT: "Portugal",
    PL: "Polen", SE: "Zweden", DK: "Denemarken", IE: "Ierland",
  };

  // Get latest month's data per country
  const latestMonth = countryData[0]?.month as string;
  const latestData = countryData.filter((r) => r.month === latestMonth);

  // Previous month
  const prevMonth = new Date(latestMonth);
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const prevData = countryData.filter((r) => (r.month as string).startsWith(prevMonthStr.slice(0, 7)));

  const lines: string[] = [];

  for (const cc of countries) {
    const cur = latestData.find((r) => r.country_code === cc);
    const prev = prevData.find((r) => r.country_code === cc);
    const yoy = (yoyData ?? []).find((r) => r.country_code === cc && r.month === latestMonth);
    if (!cur) continue;

    const name = COUNTRY_NAMES[cc] ?? cc;
    const cost = Number(cur.cost ?? 0);
    const conv = Number(cur.conversions ?? 0);
    const revenue = Number(cur.conversions_value ?? 0);
    const roasVal = Number(cur.roas ?? 0);
    const cpa = Number(cur.cost_per_conversion ?? 0);
    const share = Number(cur.spend_share ?? 0);

    let line = `### ${name} (${cc}) — ${(share * 100).toFixed(1)}% van totale spend`;
    line += `\n  Kosten: €${cost.toFixed(0)} | Conversies: ${conv.toFixed(0)} | Omzet: €${revenue.toFixed(0)} | ROAS: ${roasVal.toFixed(2)}x | CPA: €${cpa.toFixed(2)}`;

    // MoM comparison
    if (prev) {
      const prevConv = Number(prev.conversions ?? 0);
      const prevCost = Number(prev.cost ?? 0);
      const convMom = prevConv > 0 ? (((conv - prevConv) / prevConv) * 100).toFixed(1) : "n.v.t.";
      const costMom = prevCost > 0 ? (((cost - prevCost) / prevCost) * 100).toFixed(1) : "n.v.t.";
      line += `\n  m/m: conversies ${convMom}% | kosten ${costMom}%`;
    }

    // YoY comparison
    if (yoy) {
      const parts: string[] = [];
      if (yoy.conversions_yoy_pct != null) parts.push(`conversies ${yoy.conversions_yoy_pct}%`);
      if (yoy.roas_yoy_pct != null) parts.push(`ROAS ${yoy.roas_yoy_pct}%`);
      if (yoy.cost_yoy_pct != null) parts.push(`kosten ${yoy.cost_yoy_pct}%`);
      if (parts.length > 0) line += `\n  j/j: ${parts.join(" | ")}`;
    }

    lines.push(line);
  }

  // Multi-country campaign analysis
  const multiCountryCampaigns: string[] = [];
  if (campaignCountryData && campaignCountryData.length > 0) {
    const campCountries = new Map<string, Set<string>>();
    for (const r of campaignCountryData) {
      const camp = r.campaign_name as string;
      if (!campCountries.has(camp)) campCountries.set(camp, new Set());
      campCountries.get(camp)!.add(r.country_code as string);
    }
    for (const [camp, ccSet] of campCountries) {
      if (ccSet.size > 1) {
        multiCountryCampaigns.push(`- ${camp}: actief in ${[...ccSet].join(", ")}`);
      }
    }
  }

  let output = `\n\n## BONUS DIMENSIE: Geografische spreiding (${countries.length} landen)\nDit account is actief in meerdere landen. Dit is AANVULLENDE context — niet de hoofdanalyse.\nGebruik deze data als extra dimensie bij je bevindingen: als een KPI daalt, check of het door een specifiek land komt.\nDoe NIET een aparte geo-analyse — integreer geo-inzichten in de relevante bevindingen.\n\n${lines.join("\n\n")}`;

  if (multiCountryCampaigns.length > 0) {
    output += `\n\n### Multi-country campagnes\n${multiCountryCampaigns.join("\n")}`;
  }

  return output;
}

```


---

## `lib/analysis/comparison-facts.ts`

```ts
/**
 * Deterministic comparison facts — precomputed before LLM narration.
 *
 * Produces exact percentage deltas, benchmark status labels, and target comparisons
 * so the LLM does NOT need to compute arithmetic. It only narrates.
 *
 * This prevents:
 * - Conflicting percentages in different steps
 * - Wrong benchmark interpretations (e.g., calling 2.16 "gemiddeld" when median is 3.68)
 * - Inconsistent target status labels
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface MetricComparison {
  metric: string;
  actual: number;
  benchmark: number;
  benchmarkType: string;     // "maandtarget" | "jaardoel" | "sector_mediaan" | "sector_top10" | "vorige_maand" | "vorig_jaar"
  deltaAbs: number;          // actual - benchmark
  deltaPct: number;          // ((actual - benchmark) / benchmark) * 100, rounded
  statusLabel: string;       // "OP SCHEMA" | "NIET OP SCHEMA" | "KRITIEK" | etc.
  direction: "hoger" | "lager" | "gelijk";
}

export interface BenchmarkLabel {
  metric: string;
  value: number;
  sectorLow: number | null;
  sectorMedian: number | null;
  sectorHigh: number | null;
  sectorTop10: number | null;
  label: string;  // "onder sectorgemiddelde" | "gemiddeld" | "goed voor de sector" | "top van de sector" | "top 10%"
  isInverse: boolean;  // true for CPA/CPC (lower is better)
}

export interface ComparisonFacts {
  targetComparisons: MetricComparison[];
  momComparisons: MetricComparison[];
  yoyComparisons: MetricComparison[];
  benchmarkLabels: BenchmarkLabel[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pctChange(actual: number, benchmark: number): number {
  if (benchmark === 0) return actual > 0 ? 100 : 0;
  return Math.round(((actual - benchmark) / benchmark) * 100 * 10) / 10;
}

function direction(delta: number): "hoger" | "lager" | "gelijk" {
  if (delta > 0.5) return "hoger";
  if (delta < -0.5) return "lager";
  return "gelijk";
}

function targetStatus(deltaPct: number, isInverse: boolean): string {
  const effective = isInverse ? -deltaPct : deltaPct;
  if (effective >= -5) return "OP SCHEMA";
  if (effective >= -20) return "NIET OP SCHEMA";
  return "KRITIEK";
}

// ── Benchmark labeling ─────────────────────────────────────────────────────

function labelBenchmark(
  value: number,
  low: number | null,
  median: number | null,
  high: number | null,
  top10: number | null,
  isInverse: boolean
): string {
  if (median === null) return "geen benchmark beschikbaar";

  if (isInverse) {
    // For CPA/CPC: lower is better
    if (top10 !== null && value <= top10) return "top 10% van de sector";
    if (high !== null && value <= high) return "goed voor de sector";
    if (value <= median) return "gemiddeld voor de sector";
    if (low !== null && value <= low) return "onder sectorgemiddelde";
    return "ruim onder sectorgemiddelde";
  } else {
    // For CTR/ROAS/Conv Rate: higher is better
    if (top10 !== null && value >= top10) return "top 10% van de sector";
    if (high !== null && value >= high) return "goed voor de sector";
    if (value >= median) return "gemiddeld voor de sector";
    if (low !== null && value >= low) return "onder sectorgemiddelde";
    return "ruim onder sectorgemiddelde";
  }
}

// ── Main computation ───────────────────────────────────────────────────────

interface AccountMonth {
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  avg_cpc: number;
  conversion_rate: number;
  cost_per_conversion: number;
  roas?: number;
}

interface MonthTarget {
  month: number;
  conversions: number;
  revenue: number;
  adSpend: number;
}

interface SectorBenchmarkRow {
  metric: string;
  low: number;
  median: number;
  high: number;
  top10: number;
}

interface KpiTargets {
  roasTarget?: number;
  cpaTarget?: number;
}

/**
 * Compute all deterministic comparison facts for the last complete month.
 * Returns structured text blocks to inject into the LLM context.
 */
export function computeComparisonFacts(opts: {
  accountData: AccountMonth[];
  monthlyTargets: MonthTarget[] | null;
  kpiTargets: KpiTargets | null;
  sectorBenchmarks: SectorBenchmarkRow[];
  lastCompleteMonth: number;
}): ComparisonFacts {
  const { accountData, monthlyTargets, kpiTargets, sectorBenchmarks, lastCompleteMonth } = opts;

  const targetComparisons: MetricComparison[] = [];
  const momComparisons: MetricComparison[] = [];
  const yoyComparisons: MetricComparison[] = [];
  const benchmarkLabels: BenchmarkLabel[] = [];

  // Find last complete month and previous month
  const sorted = [...accountData].sort((a, b) => a.month.localeCompare(b.month));
  const current = sorted.find((m) => parseInt(m.month.split("-")[1]) === lastCompleteMonth);
  const prevIdx = sorted.indexOf(current!) - 1;
  const previous = prevIdx >= 0 ? sorted[prevIdx] : null;

  // YoY: same month previous year
  const currentMonthStr = current?.month;
  const yoyMonth = currentMonthStr
    ? `${parseInt(currentMonthStr.split("-")[0]) - 1}-${currentMonthStr.split("-")[1]}-${currentMonthStr.split("-")[2]}`
    : null;
  const yoyData = yoyMonth ? sorted.find((m) => m.month === yoyMonth) : null;

  if (!current) return { targetComparisons, momComparisons, yoyComparisons, benchmarkLabels };

  const roas = current.cost > 0 ? current.conversions_value / current.cost : 0;
  const prevRoas = previous && previous.cost > 0 ? previous.conversions_value / previous.cost : null;

  // ── Target comparisons ──

  const monthTarget = monthlyTargets?.find((t) => t.month === lastCompleteMonth);

  if (monthTarget) {
    if (monthTarget.conversions > 0) {
      const delta = pctChange(current.conversions, monthTarget.conversions);
      targetComparisons.push({
        metric: "conversies", actual: Math.round(current.conversions),
        benchmark: monthTarget.conversions, benchmarkType: "maandtarget",
        deltaAbs: Math.round(current.conversions - monthTarget.conversions),
        deltaPct: delta, statusLabel: targetStatus(delta, false),
        direction: direction(delta),
      });
    }
    if (monthTarget.revenue > 0) {
      const delta = pctChange(current.conversions_value, monthTarget.revenue);
      targetComparisons.push({
        metric: "omzet", actual: Math.round(current.conversions_value),
        benchmark: monthTarget.revenue, benchmarkType: "maandtarget",
        deltaAbs: Math.round(current.conversions_value - monthTarget.revenue),
        deltaPct: delta, statusLabel: targetStatus(delta, false),
        direction: direction(delta),
      });
    }
    if (monthTarget.adSpend > 0) {
      const delta = pctChange(current.cost, monthTarget.adSpend);
      targetComparisons.push({
        metric: "spend", actual: Math.round(current.cost),
        benchmark: monthTarget.adSpend, benchmarkType: "maandtarget",
        deltaAbs: Math.round(current.cost - monthTarget.adSpend),
        deltaPct: delta, statusLabel: targetStatus(delta, true),
        direction: direction(delta),
      });
    }
  }

  if (kpiTargets?.roasTarget && kpiTargets.roasTarget > 0) {
    const target = kpiTargets.roasTarget;
    const delta = pctChange(roas, target);
    targetComparisons.push({
      metric: "ROAS", actual: Math.round(roas * 100) / 100,
      benchmark: target, benchmarkType: "ROAS target",
      deltaAbs: Math.round((roas - target) * 100) / 100,
      deltaPct: delta, statusLabel: targetStatus(delta, false),
      direction: direction(delta),
    });
  }

  if (kpiTargets?.cpaTarget && kpiTargets.cpaTarget > 0) {
    const cpa = current.cost_per_conversion || 0;
    const delta = pctChange(cpa, kpiTargets.cpaTarget);
    targetComparisons.push({
      metric: "CPA", actual: Math.round(cpa * 100) / 100,
      benchmark: kpiTargets.cpaTarget, benchmarkType: "CPA target",
      deltaAbs: Math.round((cpa - kpiTargets.cpaTarget) * 100) / 100,
      deltaPct: delta, statusLabel: targetStatus(delta, true),
      direction: direction(delta),
    });
  }

  // ── MoM comparisons ──

  if (previous) {
    const metrics: Array<{ name: string; cur: number; prev: number; inverse?: boolean }> = [
      { name: "conversies", cur: current.conversions, prev: previous.conversions },
      { name: "omzet", cur: current.conversions_value, prev: previous.conversions_value },
      { name: "spend", cur: current.cost, prev: previous.cost },
      { name: "CTR", cur: current.ctr, prev: previous.ctr },
      { name: "CPC", cur: current.avg_cpc, prev: previous.avg_cpc, inverse: true },
      { name: "conversieratio", cur: current.conversion_rate, prev: previous.conversion_rate },
      { name: "CPA", cur: current.cost_per_conversion, prev: previous.cost_per_conversion, inverse: true },
    ];
    if (roas !== null && prevRoas !== null) {
      metrics.push({ name: "ROAS", cur: roas, prev: prevRoas });
    }

    for (const m of metrics) {
      if (m.prev === 0 && m.cur === 0) continue;
      const delta = pctChange(m.cur, m.prev);
      momComparisons.push({
        metric: m.name,
        actual: Math.round(m.cur * 100) / 100,
        benchmark: Math.round(m.prev * 100) / 100,
        benchmarkType: "vorige_maand",
        deltaAbs: Math.round((m.cur - m.prev) * 100) / 100,
        deltaPct: delta,
        statusLabel: Math.abs(delta) > 30 ? "SIGNIFICANTE WIJZIGING" : "NORMAAL",
        direction: direction(delta),
      });
    }
  }

  // ── Sector benchmark labels ──

  const INVERSE_METRICS = new Set(["cpa", "avg_cpc"]);

  for (const bm of sectorBenchmarks) {
    const isInverse = INVERSE_METRICS.has(bm.metric);
    let value = 0;

    switch (bm.metric) {
      case "ctr": value = current.ctr; break;
      case "conversion_rate": value = current.conversion_rate; break;
      case "cpa": value = current.cost_per_conversion; break;
      case "roas": value = roas; break;
      case "avg_cpc": value = current.avg_cpc; break;
      default: continue;
    }

    benchmarkLabels.push({
      metric: bm.metric,
      value: Math.round(value * 100) / 100,
      sectorLow: bm.low,
      sectorMedian: bm.median,
      sectorHigh: bm.high,
      sectorTop10: bm.top10,
      label: labelBenchmark(value, bm.low, bm.median, bm.high, bm.top10, isInverse),
      isInverse,
    });
  }

  return { targetComparisons, momComparisons, yoyComparisons, benchmarkLabels };
}

// ── Format as injectable text ──────────────────────────────────────────────

/**
 * Format comparison facts as a text block to inject into the LLM user message.
 * The LLM must USE these exact numbers and labels — not recompute them.
 */
export function formatComparisonFacts(facts: ComparisonFacts): string {
  const lines: string[] = [];

  lines.push("## VOORBEREKENDE VERGELIJKINGEN (gebruik deze exacte waarden en labels — niet zelf herberekenen)");

  if (facts.targetComparisons.length > 0) {
    lines.push("\n### Doelstellingsstatus");
    for (const c of facts.targetComparisons) {
      lines.push(`- ${c.metric}: ${c.actual} vs ${c.benchmarkType} ${c.benchmark} → ${c.deltaPct > 0 ? "+" : ""}${c.deltaPct}% → ${c.statusLabel}`);
    }
  }

  if (facts.momComparisons.length > 0) {
    lines.push("\n### MoM vergelijking (maand-over-maand)");
    for (const c of facts.momComparisons) {
      lines.push(`- ${c.metric}: ${c.actual} vs vorige maand ${c.benchmark} → ${c.deltaPct > 0 ? "+" : ""}${c.deltaPct}% MoM (${c.direction})${c.statusLabel !== "NORMAAL" ? ` [${c.statusLabel}]` : ""}`);
    }
  }

  if (facts.benchmarkLabels.length > 0) {
    lines.push("\n### Sectorale benchmark status (GEBRUIK DEZE LABELS EXACT)");
    for (const b of facts.benchmarkLabels) {
      lines.push(`- ${b.metric}: ${b.value} → ${b.label} (sector mediaan: ${b.sectorMedian}, top 10%: ${b.sectorTop10})`);
    }
  }

  lines.push("\nKRITIEKE INSTRUCTIE: Gebruik de bovenstaande percentages en labels letterlijk in je analyse. Bereken GEEN eigen percentages — die zijn al correct berekend.");

  return lines.join("\n");
}


// ── Campaign-level MoM comparisons ────────────────────────────────────────

interface CampaignRow {
  campaign_id?: string;
  campaign_name: string;
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr?: number;
  avg_cpc?: number;
  conversion_rate?: number;
  cost_per_conversion?: number;
  roas?: number;
}

/**
 * Pre-compute MoM (month-over-month) changes for each campaign.
 * Returns formatted text block ready for injection into the LLM prompt.
 *
 * Compares the latest complete month with the previous month.
 * Only includes campaigns with meaningful spend (>€10 in either month).
 */
export function computeCampaignMomFacts(
  campaignData: CampaignRow[],
  lastCompleteMonth: number,
  analysisYear: number
): string {
  const latestMonthStr = `${analysisYear}-${String(lastCompleteMonth).padStart(2, "0")}`;
  const prevDate = new Date(analysisYear, lastCompleteMonth - 2, 1); // month is 0-indexed
  const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // Group by campaign
  const byCampaign = new Map<string, { cur?: CampaignRow; prev?: CampaignRow }>();
  for (const row of campaignData) {
    const ym = row.month.slice(0, 7);
    const name = row.campaign_name;
    if (!byCampaign.has(name)) byCampaign.set(name, {});
    const entry = byCampaign.get(name)!;
    if (ym === latestMonthStr) entry.cur = row;
    else if (ym === prevMonthStr) entry.prev = row;
  }

  const lines: string[] = [];
  lines.push(`## CAMPAGNE MOM VERGELIJKING (${prevMonthStr} → ${latestMonthStr}, voorberekend)`);
  lines.push("Gebruik deze exacte waarden — niet zelf herberekenen.\n");

  const pct = (cur: number, prev: number): string => {
    if (prev === 0) return cur > 0 ? "+∞%" : "0%";
    const p = ((cur - prev) / prev * 100);
    return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
  };

  const fmt = (v: number): string => v < 100 ? v.toFixed(2) : Math.round(v).toString();

  let count = 0;
  for (const [name, { cur, prev }] of byCampaign) {
    // Skip campaigns with negligible spend
    if ((!cur || cur.cost < 10) && (!prev || prev.cost < 10)) continue;

    const c = cur ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 } as CampaignRow;
    const p = prev ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 } as CampaignRow;

    const cRoas = c.cost > 0 ? c.conversions_value / c.cost : 0;
    const pRoas = p.cost > 0 ? p.conversions_value / p.cost : 0;
    const cCpa = c.conversions > 0 ? c.cost / c.conversions : 0;
    const pCpa = p.conversions > 0 ? p.cost / p.conversions : 0;

    lines.push(`### ${name}`);
    lines.push(`  Spend: €${fmt(p.cost)} → €${fmt(c.cost)} (${pct(c.cost, p.cost)})`);
    lines.push(`  Conversies: ${fmt(p.conversions)} → ${fmt(c.conversions)} (${pct(c.conversions, p.conversions)})`);
    lines.push(`  Omzet: €${fmt(p.conversions_value)} → €${fmt(c.conversions_value)} (${pct(c.conversions_value, p.conversions_value)})`);
    lines.push(`  ROAS: ${pRoas.toFixed(2)}x → ${cRoas.toFixed(2)}x (${pct(cRoas, pRoas)})`);
    if (cCpa > 0 || pCpa > 0) {
      lines.push(`  CPA: €${fmt(pCpa)} → €${fmt(cCpa)} (${pct(cCpa, pCpa)})`);
    }
    if (!prev) lines.push(`  ⚡ Nieuwe campagne (niet actief vorige maand)`);
    else if (!cur || c.cost === 0) lines.push(`  ⚠ Gestopt/gepauzeerd deze maand`);
    lines.push("");
    count++;
  }

  if (count === 0) return "";
  return lines.join("\n");
}

/**
 * Pre-compute ad group MoM changes for the most relevant ad groups.
 * Only includes ad groups mentioned by the AI in step 2, or top spenders.
 */
export function computeAdGroupMomFacts(
  adgroupData: Array<{ ad_group_name: string; campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number; clicks: number; impressions: number }>,
  lastCompleteMonth: number,
  analysisYear: number
): string {
  const latestMonthStr = `${analysisYear}-${String(lastCompleteMonth).padStart(2, "0")}`;
  const prevDate = new Date(analysisYear, lastCompleteMonth - 2, 1);
  const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // Group by ad group
  const byGroup = new Map<string, { campaign: string; cur?: typeof adgroupData[0]; prev?: typeof adgroupData[0] }>();
  for (const row of adgroupData) {
    const ym = row.month.slice(0, 7);
    const key = `${row.campaign_name}|||${row.ad_group_name}`;
    if (!byGroup.has(key)) byGroup.set(key, { campaign: row.campaign_name });
    const entry = byGroup.get(key)!;
    if (ym === latestMonthStr) entry.cur = row;
    else if (ym === prevMonthStr) entry.prev = row;
  }

  const lines: string[] = [];
  lines.push(`## AD GROUP MOM VERGELIJKING (${prevMonthStr} → ${latestMonthStr}, voorberekend)`);
  lines.push("Top ad groups op basis van spend. Gebruik deze exacte waarden.\n");

  const pct = (cur: number, prev: number): string => {
    if (prev === 0) return cur > 0 ? "+∞%" : "0%";
    const p = ((cur - prev) / prev * 100);
    return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
  };
  const fmt = (v: number): string => v < 100 ? v.toFixed(2) : Math.round(v).toString();

  // Sort by current spend, take top 20
  const sorted = Array.from(byGroup.entries())
    .sort((a, b) => (b[1].cur?.cost ?? 0) - (a[1].cur?.cost ?? 0))
    .slice(0, 20);

  let count = 0;
  for (const [key, { campaign, cur, prev }] of sorted) {
    if ((!cur || cur.cost < 5) && (!prev || prev.cost < 5)) continue;
    const agName = key.split("|||")[1];
    const c = cur ?? { cost: 0, conversions: 0, conversions_value: 0, clicks: 0, impressions: 0 };
    const p = prev ?? { cost: 0, conversions: 0, conversions_value: 0, clicks: 0, impressions: 0 };

    lines.push(`- **${agName}** (${campaign}): spend €${fmt(p.cost)}→€${fmt(c.cost)} (${pct(c.cost, p.cost)}), conv ${fmt(p.conversions)}→${fmt(c.conversions)} (${pct(c.conversions, p.conversions)})`);
    count++;
  }

  if (count === 0) return "";
  return lines.join("\n");
}

```


---

## `lib/analysis/compute-targets.ts`

```ts
/**
 * Computes monthly expected values for the analysis pipeline,
 * using the same forecast engine as the dashboard frontend.
 *
 * Converts Supabase ads_account_monthly rows into ClientHistoricalData
 * and runs computeForecast() to get the expected values per month.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientHistoricalData, MonthlyRecord, WeeklyRecord } from "../types";
import { computeForecast, type ClientForecast } from "../forecast";

interface AccountRow {
  month: string;         // YYYY-MM-DD
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  avg_cpc: number;
  cost_per_conversion: number;
  conversion_rate: number;
}

interface WeeklyRow {
  week_start: string;
  cost: number;
  conversions: number;
  conversions_value: number;
}

function parseYear(dateStr: string): number {
  return parseInt(dateStr.split("-")[0], 10);
}

function parseMonth(dateStr: string): number {
  return parseInt(dateStr.split("-")[1], 10);
}

function rowToMonthlyRecord(row: AccountRow): MonthlyRecord {
  return {
    month: parseMonth(row.month),
    conversions: Math.round(row.conversions),
    revenue: Math.round(row.conversions_value),
    adSpend: Math.round(row.cost),
    weeks: [], // will be filled below
  };
}

function buildWeeks(weeklyRows: WeeklyRow[], month: number): WeeklyRecord[] {
  const monthWeeks = weeklyRows
    .filter((w) => parseMonth(w.week_start) === month)
    .sort((a, b) => a.week_start.localeCompare(b.week_start));

  return monthWeeks.map((w, i) => ({
    week: i + 1,
    month,
    conversions: Math.round(w.conversions),
    revenue: Math.round(w.conversions_value),
    adSpend: Math.round(w.cost),
  }));
}

/**
 * Fetch account data from Supabase, build ClientHistoricalData,
 * run the forecast engine, and return per-month expected values.
 *
 * Returns the forecast for the last complete month's analysis period.
 */
export async function computeAnalysisTargets(
  supabase: SupabaseClient,
  clientId: string
): Promise<{
  forecast: ClientForecast;
  lastCompleteMonth: number;
  currentYear: number;
  monthlyExpected: { month: number; conversions: number; revenue: number; adSpend: number }[];
} | null> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  const lastCompleteMonth = currentMonth - 1 || 12;
  const lastCompleteYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  // Fetch all historical account data (up to 5 years)
  const startYear = currentYear - 5;
  const { data: accountRows } = await supabase
    .from("ads_account_monthly")
    .select("*")
    .eq("client_id", clientId)
    .gte("month", `${startYear}-01-01`)
    .lte("month", `${lastCompleteYear}-${String(lastCompleteMonth).padStart(2, "0")}-01`)
    .order("month");

  if (!accountRows || accountRows.length === 0) return null;

  // Fetch weekly data for current year
  const { data: weeklyRows } = await supabase
    .from("ads_account_weekly")
    .select("*")
    .eq("client_id", clientId)
    .gte("week_start", `${currentYear}-01-01`)
    .order("week_start");

  const weekly = (weeklyRows ?? []) as WeeklyRow[];

  // Fetch KPI targets
  const { data: settings } = await supabase
    .from("client_settings")
    .select("kpi_targets")
    .eq("client_id", clientId)
    .maybeSingle();

  const kpi = (settings?.kpi_targets ?? {}) as Record<string, number>;

  // Group monthly data by year
  const byYear = new Map<number, AccountRow[]>();
  for (const row of accountRows as AccountRow[]) {
    const year = parseYear(row.month);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(row);
  }

  // Build historical years (everything before current year)
  const historicalYears: Record<number, MonthlyRecord[]> = {};
  for (const [year, rows] of byYear) {
    if (year >= currentYear) continue;
    const records: MonthlyRecord[] = [];
    for (let m = 1; m <= 12; m++) {
      const row = rows.find((r) => parseMonth(r.month) === m);
      if (row) {
        const rec = rowToMonthlyRecord(row);
        rec.weeks = buildWeeks(weekly, m);
        records.push(rec);
      } else {
        records.push({ month: m, conversions: 0, revenue: 0, adSpend: 0, weeks: [] });
      }
    }
    historicalYears[year] = records;
  }

  // Build current year data
  const currentYearRows = byYear.get(currentYear) ?? [];
  const currentYearData: (MonthlyRecord | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    if (m > lastCompleteMonth && currentYear === lastCompleteYear) {
      currentYearData.push(null);
      continue;
    }
    const row = currentYearRows.find((r) => parseMonth(r.month) === m);
    if (row) {
      const rec = rowToMonthlyRecord(row);
      rec.weeks = buildWeeks(weekly, m);
      currentYearData.push(rec);
    } else {
      currentYearData.push(null);
    }
  }

  // Compute previous year totals for default target (10% growth)
  const prevYearRows = byYear.get(currentYear - 1) ?? [];
  const prevConv = prevYearRows.reduce((s, r) => s + r.conversions, 0);
  const prevRev = prevYearRows.reduce((s, r) => s + r.conversions_value, 0);
  const prevSpend = prevYearRows.reduce((s, r) => s + r.cost, 0);

  const targetCurrentYear = {
    conversions: kpi.conversionsAbsolute || Math.round(prevConv * 1.1),
    revenue: kpi.revenueAbsolute || Math.round(prevRev * 1.1),
    adSpend: Math.round(prevSpend * 1.05),
  };

  const clientData: ClientHistoricalData = {
    clientId,
    targetCurrentYear,
    historicalYears,
    currentYearData,
    currentYear,
  };

  const forecast = computeForecast(clientData);

  // Extract monthly expected values
  const monthlyExpected = forecast.conversions.points.map((pt, i) => ({
    month: i + 1,
    conversions: Math.round(pt.expected),
    revenue: Math.round(forecast.revenue.points[i].expected),
    adSpend: Math.round(forecast.adSpend.points[i].expected),
  }));

  return { forecast, lastCompleteMonth, currentYear, monthlyExpected };
}

```


---

## `lib/analysis/sanitize.ts`

```ts
/**
 * Output sanitization for LLM responses.
 *
 * Fixes:
 * - Mojibake (â‚¬ → €, Ã« → ë, Ã¯ → ï, etc.)
 * - Duplicate headings in assembled output
 * - Trailing whitespace / excessive newlines
 */

// ── Mojibake fixes ─────────────────────────────────────────────────────────

const MOJIBAKE_MAP: [RegExp, string][] = [
  [/â‚¬/g, "€"],
  [/Ã«/g, "ë"],
  [/Ã¯/g, "ï"],
  [/Ã©/g, "é"],
  [/Ã¨/g, "è"],
  [/Ã¶/g, "ö"],
  [/Ã¼/g, "ü"],
  [/Ã¤/g, "ä"],
  [/Ã‰/g, "É"],
  [/Ã€/g, "À"],
  [/Ã³/g, "ó"],
  [/Ã­/g, "í"],
  [/Ã¡/g, "á"],
  [/Ã /g, "à"],
  [/Ã§/g, "ç"],
  [/Ã±/g, "ñ"],
  [/â€™/g, "'"],
  [/â€˜/g, "'"],
  [/â€œ/g, '"'],
  [/â€\u009d/g, '"'],
  [/â€"/g, "–"],
  [/â€"/g, "—"],
  [/â€¦/g, "…"],
  [/Â /g, " "],       // non-breaking space mojibake
  [/\u00a0/g, " "],   // actual non-breaking space → normal space
  [/\ufeff/g, ""],    // BOM character
];

/**
 * Fix common mojibake patterns from UTF-8 double-encoding.
 */
export function fixMojibake(text: string): string {
  let result = text;
  for (const [pattern, replacement] of MOJIBAKE_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ── Heading deduplication ──────────────────────────────────────────────────

/**
 * Remove duplicate markdown headings that occur when step output
 * already contains the heading and the assembly adds another one.
 *
 * For example, prevents:
 *   ## Account Performance
 *   ## Stap 1: Account Performance
 *   ...
 */
export function deduplicateHeadings(text: string): string {
  const lines = text.split("\n");
  const seen = new Set<string>();
  const result: string[] = [];

  const normalizeHeading = (value: string): string => value
    .replace(/^Stap \d+:\s*/i, "")
    .replace(/^stap \d+\s*[-–—:]\s*/i, "")
    .replace(/^Step \d+:\s*/i, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^#+\s*/, "")
    .trim()
    .toLowerCase();

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length; // 1=#, 2=##, 3=###, 4=####
      const normalized = normalizeHeading(headingMatch[2]);

      // Keep H1/H2 for structure, but still record their normalized titles so
      // repeated H3 wrappers ("### Stap 1: Account Performance") can be dropped.
      if (level <= 2) {
        seen.add(normalized);
      } else if (seen.has(normalized)) {
        continue;
      } else {
        seen.add(normalized);
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

// ── Whitespace cleanup ─────────────────────────────────────────────────────

/**
 * Clean up excessive whitespace and newlines.
 */
export function cleanWhitespace(text: string): string {
  return text
    .replace(/\n{4,}/g, "\n\n\n")  // max 3 consecutive newlines
    .replace(/[ \t]+$/gm, "")       // trailing whitespace per line
    .trim();
}

// ── Combined sanitizer ─────────────────────────────────────────────────────

/**
 * Apply all sanitization steps to LLM output text.
 */
export function sanitizeOutput(text: string): string {
  let result = fixMojibake(text);
  result = deduplicateHeadings(result);
  result = cleanWhitespace(result);
  return result;
}

```


---

## `app/api/analysis/pdf/route.ts`

```ts
import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { renderSopPdf, type SopPdfProps } from "@/lib/analysis/sop-pdf-renderer";
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
      const [findingsRes, recsRes, tasksRes] = await Promise.all([
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

```


---

## `lib/analysis/sop-pdf-renderer.ts`

```ts
/**
 * SOP Analysis PDF renderer — Professional edition.
 *
 * Generates branded PDFs for weekly, bi-weekly, and monthly SOP analyses.
 * Uses @react-pdf/renderer (same as Second Opinion PDF).
 *
 * Structure per type:
 *   Weekly:    Cover page + analysis content
 *   Bi-weekly: Cover page + analysis content
 *   Monthly:   Cover page + findings table + recommendations + tasks + full analysis steps
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Load RM logo as base64 (cached at module level)
let rmLogoDataUri: string | undefined;
try {
  const logoPath = path.join(process.cwd(), "public", "images", "ranking-masters-logo.png");
  if (fs.existsSync(logoPath)) {
    rmLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  }
} catch { /* no logo */ }

// ── Types ─────────────────────────────────────────────────────────────────

type SopType = "weekly" | "biweekly" | "monthly";

interface SopFinding {
  title: string;
  description: string;
  severity: string;
  insight_type: string;
  affected_entity: string;
  affected_entity_type: string;
  metric: string;
  current_value: number | null;
  previous_value: number | null;
  change_pct: number | null;
  action_required: boolean;
}

interface SopRecommendation {
  hypothesis: string;
  expected_result: string;
  measurement_metric: string;
  timeframe: string;
  rationale: string;
  ice_impact: number;
  ice_confidence: number;
  ice_ease: number;
  ice_total: number;
  status: string;
}

interface SopTask {
  title: string;
  description: string;
  action_type: string;
  priority: string;
  frequency: string;
  due_date: string;
  affected_campaign: string | null;
  status: string;
}

export interface SopPdfProps {
  clientName: string;
  clientId: string;
  sopType: SopType;
  analysisDate: string;
  periodStart: string;
  periodEnd: string;
  /** Full markdown output (all types) */
  fullOutput: string;
  /** Monthly only: structured findings */
  findings?: SopFinding[];
  /** Monthly only: structured recommendations */
  recommendations?: SopRecommendation[];
  /** Monthly only: structured tasks */
  tasks?: SopTask[];
}

// ── Colors ─────────────────────────────────────────────────────────────────

const orange = "#E87722";
const green = "#16a34a";
const greenLight = "#f0fdf4";
const greenBorder = "#bbf7d0";
const amber = "#d97706";
const amberLight = "#fffbeb";
const amberBorder = "#fde68a";
const red = "#dc2626";
const redLight = "#fef2f2";
const redBorder = "#fecaca";
const gray = "#6b7280";
const grayLight = "#f9fafb";
const grayBorder = "#e5e7eb";
// Brand Guide: Ranking Masters kleurenpalet
const dark = "#0A1628";        // Graphite (primair donker)
const blueDark = "#0F1D2F";    // Deep Navy
const blueLight = "#eff6ff";

const SEVERITY_COLOR: Record<string, string> = {
  critical: red,
  high: "#ea580c",
  medium: amber,
  low: gray,
  positive: green,
};

const SEVERITY_BG: Record<string, string> = {
  critical: redLight,
  high: "#fff7ed",
  medium: amberLight,
  low: grayLight,
  positive: greenLight,
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: red,
  high: "#ea580c",
  medium: amber,
  low: gray,
};

const SOP_TYPE_LABEL: Record<SopType, string> = {
  weekly: "Wekelijkse Analyse",
  biweekly: "Tweewekelijkse Analyse",
  monthly: "Maandelijkse Analyse",
};

const SOP_TYPE_SUBTITLE: Record<SopType, string> = {
  weekly: "Health check & bleeders",
  biweekly: "Campagne tracking & trends",
  monthly: "Volledige analyse met bevindingen, aanbevelingen & taken",
};

const MONTHLY_EXECUTIVE_HEADINGS = new Set([
  "executive snapshot",
  "primary thread",
  "top 3 threads",
  "what is not the problem",
  "action plan by phase",
  "success next month",
]);

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: dark,
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  title: { fontSize: 22, fontWeight: "bold", color: orange },
  subtitle: { fontSize: 9, color: gray, marginTop: 3 },
  brand: { fontSize: 13, fontWeight: "bold", color: orange },
  brandSub: { fontSize: 7, color: gray },
  divider: {
    height: 2,
    backgroundColor: orange,
    marginBottom: 14,
    borderRadius: 1,
  },
  // Stats
  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    borderRadius: 4,
    padding: 8,
    borderWidth: 0.5,
    borderColor: grayBorder,
    backgroundColor: grayLight,
    alignItems: "center",
  },
  statNumber: { fontSize: 20, fontWeight: "bold" },
  statLabel: { fontSize: 7, color: gray, marginTop: 1 },
  // Info card
  infoCard: {
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: grayBorder,
    backgroundColor: grayLight,
    marginBottom: 12,
  },
  infoTitle: { fontSize: 11, fontWeight: "bold", color: dark, marginBottom: 4 },
  infoText: { fontSize: 8, lineHeight: 1.5, color: gray },
  // Section header
  sectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: orange,
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 8,
    color: gray,
    marginBottom: 10,
  },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: orange,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 2,
    marginTop: 4,
  },
  tableHeaderText: { fontSize: 7, fontWeight: "bold", color: "white" },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: grayBorder,
    paddingVertical: 4,
    paddingHorizontal: 4,
    minHeight: 18,
  },
  cellText: { fontSize: 7.5 },
  // Score bar (left edge)
  scoreBar: {
    width: 3,
    borderRadius: 1.5,
    marginRight: 4,
    minHeight: 14,
  },
  // ICE score badge
  iceBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    alignSelf: "flex-start",
  },
  // Content block (for parsed markdown sections)
  contentBlock: {
    marginBottom: 8,
  },
  contentHeading: {
    fontSize: 10,
    fontWeight: "bold",
    color: dark,
    marginBottom: 4,
    marginTop: 8,
  },
  contentText: {
    fontSize: 8,
    lineHeight: 1.5,
    color: dark,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 6.5, color: gray },
});

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function iceColor(score: number): string {
  if (score >= 8) return green;
  if (score >= 6) return amber;
  if (score >= 4) return "#ea580c";
  return red;
}

/**
 * Parse markdown output into sections (split on ## headings).
 * Returns array of { heading, content } objects.
 */
function parseMarkdownSections(
  md: string
): Array<{ heading: string; content: string }> {
  const lines = md.split("\n");
  const sections: Array<{ heading: string; content: string }> = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    // Only split on ## headings (H2). Keep ### (H3) and deeper as content.
    // This preserves AI-generated sub-headings within each analysis step.
    const h2Match = line.match(/^#{1,2}\s+(.+)/);
    const isH3OrDeeper = line.match(/^#{3,}\s+/);

    if (h2Match && !isH3OrDeeper) {
      // Save previous section
      if (currentHeading || currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join("\n").trim(),
        });
      }
      currentHeading = h2Match[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Push last section
  if (currentHeading || currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentContent.join("\n").trim(),
    });
  }

  return sections.filter((s) => s.content.length > 0);
}

/**
 * Clean markdown formatting for plain-text PDF rendering.
 * Strips **, *, `, ```, ---, and other markdown syntax.
 */
function cleanMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "") // remove code blocks
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/`(.+?)`/g, "$1") // inline code
    .replace(/^#{1,6}\s+/gm, "") // strip ALL markdown headings (###, ####, etc.)
    .replace(/^---+$/gm, "") // horizontal rules
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links
    .replace(/^\|.*\|$/gm, "") // table rows
    .replace(/^[-:| ]+$/gm, "") // table separators
    // Null suppression — remove ALL visible null/undefined artifacts (order matters!)
    .replace(/null\s*\(was\s*null\)/gi, "n.v.t.") // "null (was null)" → "n.v.t."
    .replace(/n\.v\.t\.\s*\(was\s*null\)/gi, "n.v.t.") // "n.v.t. (was null)" → "n.v.t."
    .replace(/\(was\s*null\)/gi, "") // "(was null)" → remove
    .replace(/\(was\s*n\.v\.t\.\)/gi, "") // "(was n.v.t.)" → remove
    .replace(/:\s*null\b/gi, ": n.v.t.") // ": null" → ": n.v.t."
    .replace(/\bnull\b(?!\s*[)}\]])/gi, "n.v.t.") // standalone "null" → "n.v.t."
    .replace(/\bundefined\b/gi, "")
    .replace(/n\.v\.t\.\s*n\.v\.t\./g, "n.v.t.") // collapse double "n.v.t."
    .replace(/—\s*n\.v\.t\.\s*\./g, "— ") // clean trailing "— n.v.t.."
    // Terminology normalization
    .replace(/Belgium \(BE\)/g, "België")
    .replace(/Belgium/g, "België")
    .replace(/Search Lost IS \(budget\)/gi, "Search IS verlies (budget)")
    .replace(/Search Lost IS \(rank\)/gi, "Search IS verlies (rank)")
    .replace(/\n{3,}/g, "\n\n") // collapse multiple newlines
    .trim();
}

// ── Shared Components ──────────────────────────────────────────────────────

function Header({
  clientName,
  sopType,
  dateStr,
}: {
  clientName: string;
  sopType: SopType;
  dateStr: string;
}) {
  return [
    React.createElement(
      View,
      { key: "header", style: s.header },
      React.createElement(
        View,
        {},
        React.createElement(
          Text,
          { style: s.title },
          "SOP Analyse"
        ),
        React.createElement(
          Text,
          { style: s.subtitle },
          `${clientName}  |  ${SOP_TYPE_LABEL[sopType]}  |  ${dateStr}`
        )
      ),
      React.createElement(
        View,
        { style: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 } },
        rmLogoDataUri
          ? React.createElement(Image, { src: rmLogoDataUri, style: { height: 30, width: 30, objectFit: "contain" as const } })
          : null,
        React.createElement(
          View,
          { style: { alignItems: "flex-end" as const } },
          React.createElement(Text, { style: s.brand }, "Ranking Masters"),
          React.createElement(Text, { style: s.brandSub }, "De #1 SEM specialist in de Benelux"),
        )
      )
    ),
    React.createElement(View, { key: "divider", style: s.divider }),
  ];
}

function Footer({
  clientName,
  sopType,
}: {
  clientName: string;
  sopType: SopType;
}) {
  return React.createElement(
    View,
    { style: s.footer, fixed: true },
    React.createElement(
      Text,
      { style: s.footerText },
      `${clientName}  |  ${SOP_TYPE_LABEL[sopType]}`
    ),
    React.createElement(View, { style: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 } },
      React.createElement(Text, {
        style: s.footerText,
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Pagina ${pageNumber} / ${totalPages}  `,
      }),
      rmLogoDataUri
        ? React.createElement(Image, { src: rmLogoDataUri, style: { height: 14, width: 14, objectFit: "contain" as const } })
        : null,
    ),
  );
}

// ── PDF Document ───────────────────────────────────────────────────────────

function SopAnalysisPdf(props: SopPdfProps) {
  const {
    clientName,
    sopType,
    analysisDate,
    periodStart,
    periodEnd,
    fullOutput,
    findings = [],
    recommendations = [],
    tasks = [],
  } = props;

  const dateStr = formatDate(analysisDate);
  const sections = parseMarkdownSections(fullOutput);

  // Debug: log parsed sections to understand what the PDF renderer sees
  console.log(`[sop-pdf] Parsed ${sections.length} sections from fullOutput (${fullOutput.length} chars):`);
  for (const sec of sections) {
    console.log(`  - "${sec.heading}" (${sec.content.length} chars)`);
  }

  // Count severity for monthly
  const criticalCount = findings.filter(
    (f) => f.severity === "critical"
  ).length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const mediumCount = findings.filter((f) => f.severity === "medium").length;
  const positiveCount = findings.filter(
    (f) => f.severity === "positive"
  ).length;
  const actionCount = findings.filter((f) => f.action_required).length;

  const pages: React.ReactElement[] = [];

  // ══════════════════════════════════════════════════════════════════
  // PAGE 1: COVER / EXECUTIVE SUMMARY
  // ══════════════════════════════════════════════════════════════════
  const coverChildren: React.ReactElement[] = [
    ...Header({ clientName, sopType, dateStr }),

    // Type description card
    React.createElement(
      View,
      {
        key: "type-card",
        style: {
          ...s.infoCard,
          borderColor: orange,
          borderLeftWidth: 3,
        },
      },
      React.createElement(
        Text,
        { style: s.infoTitle },
        SOP_TYPE_LABEL[sopType]
      ),
      React.createElement(
        Text,
        { style: s.infoText },
        SOP_TYPE_SUBTITLE[sopType]
      ),
      React.createElement(
        Text,
        { style: { ...s.infoText, marginTop: 4 } },
        `Periode: ${formatDate(periodStart)} t/m ${formatDate(periodEnd)}`
      )
    ),
  ];

  // Stats row for monthly
  if (sopType === "monthly") {
    coverChildren.push(
      React.createElement(
        View,
        { key: "stats", style: s.statsRow },
        React.createElement(
          View,
          { style: s.statBox },
          React.createElement(
            Text,
            { style: { ...s.statNumber, color: dark } },
            String(findings.length)
          ),
          React.createElement(
            Text,
            { style: s.statLabel },
            "Bevindingen"
          )
        ),
        React.createElement(
          View,
          { style: { ...s.statBox, borderColor: redBorder } },
          React.createElement(
            Text,
            { style: { ...s.statNumber, color: red } },
            String(criticalCount + highCount)
          ),
          React.createElement(
            Text,
            { style: s.statLabel },
            "Kritiek/Hoog"
          )
        ),
        React.createElement(
          View,
          { style: { ...s.statBox, borderColor: greenBorder } },
          React.createElement(
            Text,
            { style: { ...s.statNumber, color: green } },
            String(positiveCount)
          ),
          React.createElement(
            Text,
            { style: s.statLabel },
            "Positief"
          )
        ),
        React.createElement(
          View,
          { style: { ...s.statBox, borderColor: amberBorder } },
          React.createElement(
            Text,
            { style: { ...s.statNumber, color: amber } },
            String(recommendations.length)
          ),
          React.createElement(
            Text,
            { style: s.statLabel },
            "Aanbevelingen"
          )
        ),
        React.createElement(
          View,
          { style: { ...s.statBox, borderColor: grayBorder } },
          React.createElement(
            Text,
            { style: { ...s.statNumber, color: dark } },
            String(tasks.length)
          ),
          React.createElement(Text, { style: s.statLabel }, "Taken")
        )
      )
    );

    // Priority summary blocks
    const criticalFindings = findings.filter(
      (f) => f.severity === "critical" && f.action_required
    );
    const highFindings = findings.filter(
      (f) => f.severity === "high" && f.action_required
    );

    if (criticalFindings.length > 0 || highFindings.length > 0) {
      const priorityItems: React.ReactElement[] = [];

      if (criticalFindings.length > 0) {
        priorityItems.push(
          React.createElement(
            View,
            {
              key: "crit-block",
              style: {
                flex: 1,
                borderRadius: 4,
                padding: 10,
                borderWidth: 0.5,
                borderColor: redBorder,
                backgroundColor: redLight,
              },
            },
            React.createElement(
              Text,
              {
                style: {
                  fontSize: 9,
                  fontWeight: "bold",
                  color: red,
                  marginBottom: 5,
                },
              },
              `Kritiek (${criticalFindings.length})`
            ),
            ...criticalFindings.slice(0, 5).map((f, i) =>
              React.createElement(
                View,
                {
                  key: `cf-${i}`,
                  style: {
                    flexDirection: "row",
                    marginBottom: 2.5,
                    paddingLeft: 2,
                  },
                },
                React.createElement(View, {
                  style: {
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    marginTop: 2,
                    marginRight: 5,
                    backgroundColor: red,
                  },
                }),
                React.createElement(
                  Text,
                  { style: { fontSize: 7.5, flex: 1, lineHeight: 1.3 } },
                  `${f.affected_entity}: ${f.metric} ${f.change_pct ? `(${f.change_pct > 0 ? "+" : ""}${Math.round(f.change_pct)}%)` : ""}`
                )
              )
            )
          )
        );
      }

      if (highFindings.length > 0) {
        priorityItems.push(
          React.createElement(
            View,
            {
              key: "high-block",
              style: {
                flex: 1,
                borderRadius: 4,
                padding: 10,
                borderWidth: 0.5,
                borderColor: amberBorder,
                backgroundColor: amberLight,
              },
            },
            React.createElement(
              Text,
              {
                style: {
                  fontSize: 9,
                  fontWeight: "bold",
                  color: amber,
                  marginBottom: 5,
                },
              },
              `Hoog (${highFindings.length})`
            ),
            ...highFindings.slice(0, 5).map((f, i) =>
              React.createElement(
                View,
                {
                  key: `hf-${i}`,
                  style: {
                    flexDirection: "row",
                    marginBottom: 2.5,
                    paddingLeft: 2,
                  },
                },
                React.createElement(View, {
                  style: {
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    marginTop: 2,
                    marginRight: 5,
                    backgroundColor: amber,
                  },
                }),
                React.createElement(
                  Text,
                  { style: { fontSize: 7.5, flex: 1, lineHeight: 1.3 } },
                  `${f.affected_entity}: ${f.metric} ${f.change_pct ? `(${f.change_pct > 0 ? "+" : ""}${Math.round(f.change_pct)}%)` : ""}`
                )
              )
            )
          )
        );
      }

      coverChildren.push(
        React.createElement(
          View,
          {
            key: "priority-row",
            style: { flexDirection: "row", gap: 10, marginBottom: 12 },
          },
          ...priorityItems
        )
      );
    }
  }

  // For weekly/biweekly: show first section as summary on cover
  if (sopType !== "monthly" && sections.length > 0) {
    const summaryText = cleanMarkdown(
      sections
        .slice(0, 2)
        .map((sec) => sec.content)
        .join("\n\n")
    );
    const truncated =
      summaryText.length > 1500
        ? summaryText.slice(0, 1500) + "..."
        : summaryText;

    coverChildren.push(
      React.createElement(
        View,
        { key: "summary-card", style: s.infoCard },
        React.createElement(
          Text,
          { style: s.infoTitle },
          "Samenvatting"
        ),
        React.createElement(
          Text,
          { style: { ...s.infoText, color: dark } },
          truncated
        )
      )
    );
  }

  coverChildren.push(
    Footer({ clientName, sopType })
  );

  pages.push(
    React.createElement(
      Page,
      {
        key: "cover",
        size: "A4",
        orientation: "landscape",
        style: s.page,
      },
      ...coverChildren
    )
  );

  if (sopType === "monthly") {
    const executiveSections = sections.filter((sec) =>
      MONTHLY_EXECUTIVE_HEADINGS.has(sec.heading.toLowerCase())
    );

    if (executiveSections.length > 0) {
      const groups = [executiveSections.slice(0, 3), executiveSections.slice(3, 6)].filter((group) => group.length > 0);
      groups.forEach((group, groupIndex) => {
        pages.push(
          React.createElement(
            Page,
            {
              key: `executive-${groupIndex}`,
              size: "A4",
              orientation: "landscape",
              style: s.page,
              wrap: true,
            },
            React.createElement(
              Text,
              { style: s.sectionTitle },
              groupIndex === 0 ? "Executive Layer" : "Actie & Monitoring"
            ),
            ...group.map((sec, index) =>
              React.createElement(
                View,
                {
                  key: `exec-${groupIndex}-${index}`,
                  style: {
                    ...s.infoCard,
                    marginBottom: 10,
                    borderLeftWidth: 3,
                    borderColor: orange,
                    backgroundColor: index % 2 === 0 ? grayLight : blueLight,
                  },
                },
                React.createElement(Text, { style: s.infoTitle }, sec.heading),
                React.createElement(Text, { style: { ...s.infoText, color: dark } }, cleanMarkdown(sec.content).slice(0, 2200))
              )
            ),
            Footer({ clientName, sopType })
          )
        );
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // MONTHLY: PAGE 2 — FINDINGS TABLE
  // ══════════════════════════════════════════════════════════════════
  if (sopType === "monthly" && findings.length > 0) {
    pages.push(
      React.createElement(
        Page,
        {
          key: "findings",
          size: "A4",
          orientation: "landscape",
          style: s.page,
          wrap: true,
        },
        React.createElement(
          Text,
          { style: s.sectionTitle },
          "Bevindingen"
        ),
        React.createElement(
          Text,
          { style: s.sectionSubtitle },
          `${findings.length} bevindingen  |  ${actionCount} vereisen actie  |  ${criticalCount} kritiek, ${highCount} hoog, ${mediumCount} medium, ${positiveCount} positief`
        ),

        // Table header
        React.createElement(
          View,
          { style: s.tableHeader, fixed: true },
          React.createElement(Text, {
            style: { width: "3%", ...s.tableHeaderText },
          }),
          React.createElement(
            Text,
            { style: { width: "12%", ...s.tableHeaderText } },
            "Entiteit"
          ),
          React.createElement(
            Text,
            { style: { width: "10%", ...s.tableHeaderText } },
            "Type"
          ),
          React.createElement(
            Text,
            { style: { width: "12%", ...s.tableHeaderText } },
            "Metric"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Huidig"
          ),
          React.createElement(
            Text,
            { style: { width: "7%", ...s.tableHeaderText } },
            "Verschil"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Ernst"
          ),
          React.createElement(
            Text,
            { style: { width: "6%", ...s.tableHeaderText } },
            "Actie"
          ),
          React.createElement(
            Text,
            { style: { width: "34%", ...s.tableHeaderText } },
            "Beschrijving"
          )
        ),

        // Finding rows
        ...findings.map((f, i) => {
          const bg = i % 2 === 1 ? grayLight : "white";
          const sevColor = SEVERITY_COLOR[f.severity] ?? gray;

          return React.createElement(
            View,
            {
              key: `f-${i}`,
              style: { ...s.tableRow, backgroundColor: bg },
              wrap: false,
            },
            React.createElement(View, {
              style: {
                ...s.scoreBar,
                backgroundColor: sevColor,
                width: "3%",
              },
            }),
            React.createElement(
              Text,
              {
                style: {
                  width: "12%",
                  ...s.cellText,
                  fontWeight: "bold",
                },
              },
              f.affected_entity?.slice(0, 25) ?? "-"
            ),
            React.createElement(
              Text,
              { style: { width: "10%", ...s.cellText, color: gray } },
              f.affected_entity_type ?? "-"
            ),
            React.createElement(
              Text,
              { style: { width: "12%", ...s.cellText } },
              f.metric ?? "-"
            ),
            React.createElement(
              Text,
              { style: { width: "8%", ...s.cellText } },
              f.current_value != null
                ? String(
                    Math.abs(f.current_value) >= 1000
                      ? Math.round(f.current_value).toLocaleString("nl-NL")
                      : Number(f.current_value.toFixed(2))
                  )
                : "-"
            ),
            React.createElement(
              Text,
              {
                style: {
                  width: "7%",
                  ...s.cellText,
                  color:
                    f.change_pct != null
                      ? f.change_pct > 0
                        ? green
                        : red
                      : gray,
                  fontWeight: "bold",
                },
              },
              f.change_pct != null
                ? `${f.change_pct > 0 ? "+" : ""}${Math.round(f.change_pct)}%`
                : "-"
            ),
            React.createElement(
              Text,
              {
                style: {
                  width: "8%",
                  ...s.cellText,
                  color: sevColor,
                  fontWeight: "bold",
                },
              },
              f.severity
            ),
            React.createElement(
              Text,
              {
                style: {
                  width: "6%",
                  ...s.cellText,
                  color: f.action_required ? red : gray,
                },
              },
              f.action_required ? "Ja" : "Nee"
            ),
            React.createElement(
              Text,
              {
                style: {
                  width: "34%",
                  ...s.cellText,
                  color: gray,
                },
              },
              (f.description ?? "").slice(0, 120)
            )
          );
        }),

        Footer({ clientName, sopType })
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // MONTHLY: PAGE 3 — RECOMMENDATIONS WITH ICE SCORES
  // ══════════════════════════════════════════════════════════════════
  if (sopType === "monthly" && recommendations.length > 0) {
    pages.push(
      React.createElement(
        Page,
        {
          key: "recs",
          size: "A4",
          orientation: "landscape",
          style: s.page,
          wrap: true,
        },
        React.createElement(
          Text,
          { style: s.sectionTitle },
          "Aanbevelingen"
        ),
        React.createElement(
          Text,
          { style: s.sectionSubtitle },
          `${recommendations.length} aanbevelingen gesorteerd op ICE score (impact x vertrouwen x gemak)`
        ),

        // Table header
        React.createElement(
          View,
          { style: s.tableHeader, fixed: true },
          React.createElement(
            Text,
            { style: { width: "4%", ...s.tableHeaderText } },
            "#"
          ),
          React.createElement(
            Text,
            { style: { width: "30%", ...s.tableHeaderText } },
            "Hypothese"
          ),
          React.createElement(
            Text,
            { style: { width: "20%", ...s.tableHeaderText } },
            "Verwacht resultaat"
          ),
          React.createElement(
            Text,
            { style: { width: "10%", ...s.tableHeaderText } },
            "KPI"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Termijn"
          ),
          React.createElement(
            Text,
            { style: { width: "5%", ...s.tableHeaderText, textAlign: "center" } },
            "I"
          ),
          React.createElement(
            Text,
            { style: { width: "5%", ...s.tableHeaderText, textAlign: "center" } },
            "C"
          ),
          React.createElement(
            Text,
            { style: { width: "5%", ...s.tableHeaderText, textAlign: "center" } },
            "E"
          ),
          React.createElement(
            Text,
            { style: { width: "6%", ...s.tableHeaderText, textAlign: "center" } },
            "ICE"
          ),
          React.createElement(
            Text,
            { style: { width: "7%", ...s.tableHeaderText } },
            "Status"
          )
        ),

        // Sorted by ICE total descending
        ...[...recommendations]
          .sort((a, b) => b.ice_total - a.ice_total)
          .map((rec, i) => {
            const bg = i % 2 === 1 ? grayLight : "white";
            const iceCol = iceColor(rec.ice_total);

            return React.createElement(
              View,
              {
                key: `r-${i}`,
                style: { ...s.tableRow, backgroundColor: bg },
                wrap: false,
              },
              React.createElement(
                Text,
                {
                  style: {
                    width: "4%",
                    ...s.cellText,
                    color: gray,
                  },
                },
                String(i + 1)
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "30%",
                    ...s.cellText,
                    fontWeight: "bold",
                  },
                },
                rec.hypothesis?.slice(0, 90) ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "20%", ...s.cellText, color: gray } },
                rec.expected_result?.slice(0, 60) ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "10%", ...s.cellText } },
                rec.measurement_metric ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "8%", ...s.cellText } },
                rec.timeframe ?? "-"
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "5%",
                    ...s.cellText,
                    textAlign: "center",
                  },
                },
                String(rec.ice_impact)
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "5%",
                    ...s.cellText,
                    textAlign: "center",
                  },
                },
                String(rec.ice_confidence)
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "5%",
                    ...s.cellText,
                    textAlign: "center",
                  },
                },
                String(rec.ice_ease)
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "6%",
                    ...s.cellText,
                    textAlign: "center",
                    fontWeight: "bold",
                    color: iceCol,
                  },
                },
                String(rec.ice_total)
              ),
              React.createElement(
                Text,
                { style: { width: "7%", ...s.cellText, color: gray } },
                rec.status ?? "open"
              )
            );
          }),

        Footer({ clientName, sopType })
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // MONTHLY: PAGE 4 — TASKS
  // ══════════════════════════════════════════════════════════════════
  if (sopType === "monthly" && tasks.length > 0) {
    pages.push(
      React.createElement(
        Page,
        {
          key: "tasks",
          size: "A4",
          orientation: "landscape",
          style: s.page,
          wrap: true,
        },
        React.createElement(
          Text,
          { style: s.sectionTitle },
          "Taken"
        ),
        React.createElement(
          Text,
          { style: s.sectionSubtitle },
          `${tasks.length} taken met deadlines en prioriteiten`
        ),

        // Table header
        React.createElement(
          View,
          { style: s.tableHeader, fixed: true },
          React.createElement(Text, {
            style: { width: "3%", ...s.tableHeaderText },
          }),
          React.createElement(
            Text,
            { style: { width: "22%", ...s.tableHeaderText } },
            "Taak"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Type"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Prioriteit"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Frequentie"
          ),
          React.createElement(
            Text,
            { style: { width: "10%", ...s.tableHeaderText } },
            "Deadline"
          ),
          React.createElement(
            Text,
            { style: { width: "14%", ...s.tableHeaderText } },
            "Campagne"
          ),
          React.createElement(
            Text,
            { style: { width: "27%", ...s.tableHeaderText } },
            "Beschrijving"
          )
        ),

        // Task rows sorted by priority
        ...[...tasks]
          .sort((a, b) => {
            const order: Record<string, number> = {
              critical: 0,
              high: 1,
              medium: 2,
              low: 3,
            };
            return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
          })
          .map((task, i) => {
            const bg = i % 2 === 1 ? grayLight : "white";
            const prioColor = PRIORITY_COLOR[task.priority] ?? gray;

            return React.createElement(
              View,
              {
                key: `t-${i}`,
                style: { ...s.tableRow, backgroundColor: bg },
                wrap: false,
              },
              React.createElement(View, {
                style: {
                  ...s.scoreBar,
                  backgroundColor: prioColor,
                  width: "3%",
                },
              }),
              React.createElement(
                Text,
                {
                  style: {
                    width: "22%",
                    ...s.cellText,
                    fontWeight: "bold",
                  },
                },
                task.title?.slice(0, 50) ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "8%", ...s.cellText, color: gray } },
                task.action_type ?? "-"
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "8%",
                    ...s.cellText,
                    color: prioColor,
                    fontWeight: "bold",
                  },
                },
                task.priority ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "8%", ...s.cellText } },
                task.frequency ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "10%", ...s.cellText } },
                task.due_date
                  ? formatDate(task.due_date)
                  : "-"
              ),
              React.createElement(
                Text,
                { style: { width: "14%", ...s.cellText, color: gray } },
                task.affected_campaign?.slice(0, 30) ?? "-"
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "27%",
                    ...s.cellText,
                    color: gray,
                  },
                },
                (task.description ?? "").slice(0, 100)
              )
            );
          }),

        Footer({ clientName, sopType })
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // CONTENT PAGES — Full analysis text (all types)
  // ══════════════════════════════════════════════════════════════════
  // Filter out metadata sections (client, datum, periode, model, ---)
  const contentSections = sections.filter((sec) => {
    const h = sec.heading.toLowerCase();
    return (
      !h.includes("client:") &&
      !h.includes("datum:") &&
      !h.includes("periode:") &&
      !h.includes("model:") &&
      !(sopType === "monthly" && MONTHLY_EXECUTIVE_HEADINGS.has(h)) &&
      sec.content.length > 10
    );
  });

  console.log(`[sop-pdf] ${contentSections.length} content sections after filtering (from ${sections.length} total)`);
  for (const sec of contentSections) {
    console.log(`  → "${sec.heading}" (${sec.content.length} chars)`);
  }

  if (contentSections.length > 0) {
    // Each analysis step gets its own page(s) to prevent truncation
    for (let i = 0; i < contentSections.length; i++) {
      const sec = contentSections[i];
      const cleaned = cleanMarkdown(sec.content);
      // Allow up to 8000 chars per section (was 3000 — fits on 2 landscape pages)
      const text =
        cleaned.length > 8000
          ? cleaned.slice(0, 8000) + "\n\n[...ingekort voor PDF]"
          : cleaned;

      pages.push(
        React.createElement(
          Page,
          {
            key: `content-${i}`,
            size: "A4",
            orientation: "landscape",
            style: s.page,
            wrap: true,
          },
          ...(i === 0
            ? [React.createElement(Text, { style: s.sectionTitle }, "Volledige Analyse")]
            : []),
          React.createElement(
            View,
            { key: `sec-${i}`, style: s.contentBlock, wrap: true },
            React.createElement(
              Text,
              { style: s.contentHeading },
              sec.heading
            ),
            React.createElement(
              Text,
              { style: s.contentText },
              text
            )
          ),
          Footer({ clientName, sopType })
        )
      );
    }
  }

  return React.createElement(Document, {}, ...pages);
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function renderSopPdf(opts: SopPdfProps): Promise<Buffer> {
  const doc = SopAnalysisPdf(opts);
  return await renderToBuffer(doc);
}

```


---

## `lib/progress/types.ts`

```ts
export type GenerationJobType =
  | "monthly_sop"
  | "biweekly_sop"
  | "weekly_sop"
  | "second_opinion"
  | "report_generation"
  | "pdf_generation";

export type GenerationJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationPhaseState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface GenerationPhaseDefinition {
  key: string;
  label: string;
}

export interface GenerationJobRow {
  job_id: string;
  client_id: string | null;
  job_type: GenerationJobType;
  status: GenerationJobStatus;
  current_phase: string | null;
  current_phase_label: string | null;
  progress_pct: number;
  step_index: number;
  total_steps: number;
  message: string | null;
  started_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  partial_output_exists: boolean;
  metadata: Record<string, unknown> | null;
}

export interface GenerationJobEventRow {
  job_id: string;
  job_type?: GenerationJobType;
  phase_key: string;
  phase_label: string;
  phase_order: number;
  state: GenerationPhaseState;
  details: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

export interface GenerationJobSnapshot extends GenerationJobRow {
  phases: GenerationJobEventRow[];
  tracker_available?: boolean;
  tracker_message?: string | null;
}

export interface GenerationJobLookupResponse {
  found: boolean;
  trackerAvailable: boolean;
  error?: string;
  snapshot?: GenerationJobSnapshot;
}

```


---

## `lib/progress/core.ts`

```ts
import type {
  GenerationJobEventRow,
  GenerationJobRow,
  GenerationJobStatus,
  GenerationJobType,
  GenerationPhaseDefinition,
  GenerationPhaseState,
} from "./types";

export const JOB_PHASES: Record<GenerationJobType, GenerationPhaseDefinition[]> = {
  monthly_sop: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_data", label: "Data ophalen..." },
    { key: "enrich_context", label: "Data verrijken..." },
    { key: "run_step_1", label: "Analyse stap 1 uitvoeren..." },
    { key: "run_step_2", label: "Analyse stap 2 uitvoeren..." },
    { key: "run_step_3", label: "Analyse stap 3 uitvoeren..." },
    { key: "run_step_4", label: "Analyse stap 4 uitvoeren..." },
    { key: "run_step_5", label: "Analyse stap 5 uitvoeren..." },
    { key: "run_step_6", label: "Analyse stap 6 uitvoeren..." },
    { key: "run_step_7", label: "Analyse stap 7 uitvoeren..." },
    { key: "run_step_8", label: "Analyse stap 8 uitvoeren..." },
    { key: "run_step_9", label: "Analyse stap 9 uitvoeren..." },
    { key: "finalize_conclusion", label: "Eindconclusie formuleren..." },
    { key: "structure_findings", label: "Findings structureren..." },
    { key: "build_recommendations", label: "Aanbevelingen genereren..." },
    { key: "save_outputs", label: "Opslaan..." },
    { key: "done", label: "Gereed" },
  ],
  biweekly_sop: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_data", label: "Data ophalen..." },
    { key: "enrich_context", label: "Data verrijken..." },
    { key: "run_analysis", label: "Analyse uitvoeren..." },
    { key: "extract_findings", label: "Findings structureren..." },
    { key: "extract_recommendations", label: "Aanbevelingen genereren..." },
    { key: "save_outputs", label: "Opslaan..." },
    { key: "done", label: "Gereed" },
  ],
  weekly_sop: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_data", label: "Data ophalen..." },
    { key: "enrich_context", label: "Data verrijken..." },
    { key: "run_analysis", label: "Analyse uitvoeren..." },
    { key: "extract_findings", label: "Findings structureren..." },
    { key: "extract_recommendations", label: "Aanbevelingen genereren..." },
    { key: "save_outputs", label: "Opslaan..." },
    { key: "done", label: "Gereed" },
  ],
  second_opinion: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_account_context", label: "Accountcontext ophalen..." },
    { key: "evaluate_checks", label: "Audit checks uitvoeren..." },
    { key: "synthesize_findings", label: "Audit samenvatten..." },
    { key: "build_pdf", label: "PDF opbouwen..." },
    { key: "save_outputs", label: "Opslaan..." },
    { key: "done", label: "Gereed" },
  ],
  report_generation: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_inputs", label: "Input ophalen..." },
    { key: "aggregate_data", label: "Data aggregeren..." },
    { key: "compose_sections", label: "Rapportsecties opstellen..." },
    { key: "compose_country_sections", label: "Landensecties opstellen..." },
    { key: "save_outputs", label: "Opslaan..." },
    { key: "done", label: "Gereed" },
  ],
  pdf_generation: [
    { key: "init", label: "Initialiseren..." },
    { key: "fetch_inputs", label: "Brondata ophalen..." },
    { key: "render_pdf", label: "PDF opbouwen..." },
    { key: "store_artifact", label: "PDF opslaan..." },
    { key: "done", label: "Gereed" },
  ],
};

export function getPhaseDefinitions(jobType: GenerationJobType): GenerationPhaseDefinition[] {
  return JOB_PHASES[jobType];
}

export function getPhaseOrder(jobType: GenerationJobType, phaseKey: string | null | undefined): number {
  if (!phaseKey) return -1;
  return JOB_PHASES[jobType].findIndex((phase) => phase.key === phaseKey);
}

export function getPhaseDefinition(jobType: GenerationJobType, phaseKey: string): GenerationPhaseDefinition {
  return JOB_PHASES[jobType].find((phase) => phase.key === phaseKey)
    ?? { key: phaseKey, label: phaseKey };
}

export function buildPhaseProgress(jobType: GenerationJobType, phaseKey: string) {
  const phases = JOB_PHASES[jobType];
  const order = Math.max(0, getPhaseOrder(jobType, phaseKey));
  const total = phases.length;
  const pct = total <= 1 ? 100 : Math.min(100, Math.round((order / (total - 1)) * 100));
  return {
    stepIndex: Math.min(order + 1, total),
    totalSteps: total,
    progressPct: pct,
    phase: getPhaseDefinition(jobType, phaseKey),
    phaseOrder: order,
  };
}

export function canAdvancePhase(jobType: GenerationJobType, currentPhase: string | null, nextPhase: string): boolean {
  const currentOrder = getPhaseOrder(jobType, currentPhase);
  const nextOrder = getPhaseOrder(jobType, nextPhase);
  return nextOrder >= currentOrder;
}

export function buildQueuedJob(input: {
  jobId: string;
  clientId?: string | null;
  jobType: GenerationJobType;
  metadata?: Record<string, unknown>;
  now?: string;
}): GenerationJobRow {
  const now = input.now ?? new Date().toISOString();
  const progress = buildPhaseProgress(input.jobType, "init");
  return {
    job_id: input.jobId,
    client_id: input.clientId ?? null,
    job_type: input.jobType,
    status: "queued",
    current_phase: "init",
    current_phase_label: progress.phase.label,
    progress_pct: 0,
    step_index: 0,
    total_steps: progress.totalSteps,
    message: null,
    started_at: now,
    updated_at: now,
    completed_at: null,
    error_message: null,
    partial_output_exists: false,
    metadata: input.metadata ?? {},
  };
}

export function buildRunningJobUpdate(input: {
  current: Pick<GenerationJobRow, "job_type" | "current_phase" | "metadata" | "partial_output_exists">;
  phaseKey: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  allowRegression?: boolean;
  now?: string;
}): Partial<GenerationJobRow> | null {
  const now = input.now ?? new Date().toISOString();
  if (!input.allowRegression && !canAdvancePhase(input.current.job_type, input.current.current_phase, input.phaseKey)) {
    return null;
  }

  const progress = buildPhaseProgress(input.current.job_type, input.phaseKey);
  return {
    status: "running",
    current_phase: input.phaseKey,
    current_phase_label: progress.phase.label,
    progress_pct: progress.progressPct,
    step_index: progress.stepIndex,
    total_steps: progress.totalSteps,
    message: input.message ?? null,
    updated_at: now,
    error_message: null,
    metadata: {
      ...(input.current.metadata ?? {}),
      ...(input.metadata ?? {}),
    },
  };
}

export function buildCompletedJobUpdate(input: {
  current: Pick<GenerationJobRow, "job_type" | "metadata" | "partial_output_exists">;
  message?: string | null;
  metadata?: Record<string, unknown>;
  partialOutputExists?: boolean;
  now?: string;
}): Partial<GenerationJobRow> {
  const now = input.now ?? new Date().toISOString();
  const progress = buildPhaseProgress(input.current.job_type, "done");
  return {
    status: "completed",
    current_phase: "done",
    current_phase_label: progress.phase.label,
    progress_pct: 100,
    step_index: progress.totalSteps,
    total_steps: progress.totalSteps,
    message: input.message ?? "Gereed",
    completed_at: now,
    updated_at: now,
    error_message: null,
    partial_output_exists: input.partialOutputExists ?? input.current.partial_output_exists,
    metadata: {
      ...(input.current.metadata ?? {}),
      ...(input.metadata ?? {}),
    },
  };
}

export function buildFailedJobUpdate(input: {
  current: Pick<GenerationJobRow, "job_type" | "current_phase" | "metadata" | "partial_output_exists">;
  errorMessage: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  partialOutputExists?: boolean;
  now?: string;
}): Partial<GenerationJobRow> {
  const now = input.now ?? new Date().toISOString();
  const activePhase = input.current.current_phase ?? "init";
  const progress = buildPhaseProgress(input.current.job_type, activePhase);
  return {
    status: "failed",
    current_phase: activePhase,
    current_phase_label: progress.phase.label,
    progress_pct: progress.progressPct,
    step_index: progress.stepIndex,
    total_steps: progress.totalSteps,
    message: input.message ?? progress.phase.label,
    completed_at: now,
    updated_at: now,
    error_message: input.errorMessage,
    partial_output_exists: input.partialOutputExists ?? input.current.partial_output_exists,
    metadata: {
      ...(input.current.metadata ?? {}),
      ...(input.metadata ?? {}),
    },
  };
}

export function buildPhaseEvent(input: {
  jobId: string;
  jobType: GenerationJobType;
  phaseKey: string;
  state: GenerationPhaseState;
  details?: string | null;
  now?: string;
  completed?: boolean;
}): GenerationJobEventRow {
  const now = input.now ?? new Date().toISOString();
  const progress = buildPhaseProgress(input.jobType, input.phaseKey);
  return {
    job_id: input.jobId,
    job_type: input.jobType,
    phase_key: input.phaseKey,
    phase_label: progress.phase.label,
    phase_order: progress.phaseOrder,
    state: input.state,
    details: input.details ?? null,
    started_at: now,
    completed_at: input.completed ? now : null,
    updated_at: now,
  };
}

export function shouldPollGenerationJob(status: GenerationJobStatus | null | undefined): boolean {
  return status === "queued" || status === "running";
}

```


---

## `lib/progress/server.ts`

```ts
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  buildCompletedJobUpdate,
  buildFailedJobUpdate,
  buildPhaseEvent,
  buildQueuedJob,
  buildRunningJobUpdate,
} from "./core";
import type { GenerationJobLookupResponse, GenerationJobRow, GenerationJobSnapshot, GenerationJobType } from "./types";

const JOBS_TABLE = "generation_jobs";
const EVENTS_TABLE = "generation_job_events";
const PROGRESS_RETRY_MS = 30_000;

const loggedMessages = new Set<string>();
let trackerUnavailableReason: string | null = null;
let trackerUnavailableDetectedAt = 0;

function logOnce(key: string, message: string) {
  if (loggedMessages.has(key)) return;
  loggedMessages.add(key);
  console.error(message);
}

export function isProgressStorageUnavailableError(error: Pick<PostgrestError, "code" | "message"> | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST205"
    || error.code === "42P01"
    || error.message.includes("Could not find the table")
    || error.message.includes("relation")
    || error.message.includes("schema cache");
}

function markTrackerUnavailable(reason: string) {
  trackerUnavailableDetectedAt = Date.now();
  if (trackerUnavailableReason === reason) return;
  trackerUnavailableReason = reason;
  logOnce(`tracker-unavailable:${reason}`, `[generation-progress] tracker storage unavailable: ${reason}`);
}

function clearTrackerUnavailable() {
  trackerUnavailableReason = null;
  trackerUnavailableDetectedAt = 0;
}

function shouldBypassProgressStorage(): boolean {
  return trackerUnavailableReason !== null && (Date.now() - trackerUnavailableDetectedAt) < PROGRESS_RETRY_MS;
}

function trackerUnavailableResponse(jobId?: string): GenerationJobLookupResponse {
  return {
    found: false,
    trackerAvailable: false,
    error: trackerUnavailableReason ?? "Live voortgang niet beschikbaar.",
    snapshot: jobId ? {
      job_id: jobId,
      client_id: null,
      job_type: "monthly_sop",
      status: "running",
      current_phase: null,
      current_phase_label: null,
      progress_pct: 0,
      step_index: 0,
      total_steps: 0,
      message: "Live voortgang niet beschikbaar. Generatie loopt mogelijk nog door.",
      started_at: null,
      updated_at: null,
      completed_at: null,
      error_message: null,
      partial_output_exists: false,
      metadata: { tracker_unavailable: true },
      phases: [],
      tracker_available: false,
      tracker_message: trackerUnavailableReason ?? "Live voortgang niet beschikbaar.",
    } : undefined,
  };
}

async function fetchJobRow(supabase: SupabaseClient, jobId: string): Promise<GenerationJobRow | null> {
  if (shouldBypassProgressStorage()) return null;

  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return null;
    }
    logOnce(`fetch-job:${error.code}:${error.message}`, `[generation-progress] fetch job failed: ${error.message}`);
    return null;
  }

  clearTrackerUnavailable();
  return (data ?? null) as GenerationJobRow | null;
}

async function completeOtherRunningEvents(supabase: SupabaseClient, jobId: string, keepPhaseKey: string, now: string) {
  if (shouldBypassProgressStorage()) return;
  const { error } = await supabase
    .from(EVENTS_TABLE)
    .update({
      state: "completed",
      completed_at: now,
      updated_at: now,
    })
    .eq("job_id", jobId)
    .eq("state", "running")
    .neq("phase_key", keepPhaseKey);

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return;
    }
    logOnce(`complete-events:${error.code}:${error.message}`, `[generation-progress] complete running events failed: ${error.message}`);
  }
}

async function upsertEvent(supabase: SupabaseClient, event: ReturnType<typeof buildPhaseEvent>) {
  if (shouldBypassProgressStorage()) return;
  const { error } = await supabase
    .from(EVENTS_TABLE)
    .upsert(event, { onConflict: "job_id,phase_key" });

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return;
    }
    logOnce(`upsert-event:${error.code}:${error.message}`, `[generation-progress] upsert event failed: ${error.message}`);
  }
}

export async function createProgressJob(supabase: SupabaseClient, input: {
  jobId: string;
  clientId?: string | null;
  jobType: GenerationJobType;
  metadata?: Record<string, unknown>;
  initialMessage?: string | null;
}) {
  if (shouldBypassProgressStorage()) return null;

  const now = new Date().toISOString();
  const row = buildQueuedJob({
    jobId: input.jobId,
    clientId: input.clientId ?? null,
    jobType: input.jobType,
    metadata: input.metadata,
    now,
  });

  const { error } = await supabase
    .from(JOBS_TABLE)
    .upsert({
      ...row,
      message: input.initialMessage ?? row.current_phase_label,
    }, { onConflict: "job_id" });

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return null;
    }
    logOnce(`create-job:${error.code}:${error.message}`, `[generation-progress] create job failed: ${error.message}`);
    return null;
  }

  clearTrackerUnavailable();
  await upsertEvent(supabase, buildPhaseEvent({
    jobId: input.jobId,
    jobType: input.jobType,
    phaseKey: "init",
    state: "running",
    details: input.initialMessage ?? row.current_phase_label,
    now,
  }));

  return row;
}

export async function updateProgressPhase(supabase: SupabaseClient, input: {
  jobId: string;
  phaseKey: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  allowRegression?: boolean;
}) {
  const current = await fetchJobRow(supabase, input.jobId);
  if (!current) return null;

  const update = buildRunningJobUpdate({
    current,
    phaseKey: input.phaseKey,
    message: input.message,
    metadata: input.metadata,
    allowRegression: input.allowRegression,
  });

  if (!update) return current;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from(JOBS_TABLE)
    .update(update)
    .eq("job_id", input.jobId);

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return current;
    }
    logOnce(`update-phase:${error.code}:${error.message}`, `[generation-progress] update phase failed: ${error.message}`);
    return current;
  }

  await completeOtherRunningEvents(supabase, input.jobId, input.phaseKey, now);
  await upsertEvent(supabase, buildPhaseEvent({
    jobId: input.jobId,
    jobType: current.job_type,
    phaseKey: input.phaseKey,
    state: "running",
    details: input.message,
    now,
  }));

  return { ...current, ...update } as GenerationJobRow;
}

export async function markProgressCompleted(supabase: SupabaseClient, input: {
  jobId: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  partialOutputExists?: boolean;
}) {
  const current = await fetchJobRow(supabase, input.jobId);
  if (!current) return null;

  const update = buildCompletedJobUpdate({
    current,
    message: input.message,
    metadata: input.metadata,
    partialOutputExists: input.partialOutputExists,
  });

  const now = new Date().toISOString();
  const { error } = await supabase
    .from(JOBS_TABLE)
    .update(update)
    .eq("job_id", input.jobId);

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return current;
    }
    logOnce(`complete-job:${error.code}:${error.message}`, `[generation-progress] complete job failed: ${error.message}`);
    return current;
  }

  await completeOtherRunningEvents(supabase, input.jobId, "done", now);
  await upsertEvent(supabase, buildPhaseEvent({
    jobId: input.jobId,
    jobType: current.job_type,
    phaseKey: "done",
    state: "completed",
    details: input.message ?? "Gereed",
    now,
    completed: true,
  }));

  return { ...current, ...update } as GenerationJobRow;
}

export async function markProgressFailed(supabase: SupabaseClient, input: {
  jobId: string;
  errorMessage: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  partialOutputExists?: boolean;
}) {
  const current = await fetchJobRow(supabase, input.jobId);
  if (!current) return null;

  const update = buildFailedJobUpdate({
    current,
    errorMessage: input.errorMessage,
    message: input.message,
    metadata: input.metadata,
    partialOutputExists: input.partialOutputExists,
  });

  const now = new Date().toISOString();
  const { error } = await supabase
    .from(JOBS_TABLE)
    .update(update)
    .eq("job_id", input.jobId);

  if (error) {
    if (isProgressStorageUnavailableError(error)) {
      markTrackerUnavailable(error.message);
      return current;
    }
    logOnce(`fail-job:${error.code}:${error.message}`, `[generation-progress] fail job failed: ${error.message}`);
    return current;
  }

  if (current.current_phase) {
    await upsertEvent(supabase, buildPhaseEvent({
      jobId: input.jobId,
      jobType: current.job_type,
      phaseKey: current.current_phase,
      state: "failed",
      details: input.errorMessage,
      now,
      completed: true,
    }));
  }

  return { ...current, ...update } as GenerationJobRow;
}

export async function fetchProgressSnapshot(supabase: SupabaseClient, jobId: string): Promise<GenerationJobLookupResponse> {
  if (shouldBypassProgressStorage()) {
    return trackerUnavailableResponse(jobId);
  }

  const [jobRes, eventsRes] = await Promise.all([
    supabase.from(JOBS_TABLE).select("*").eq("job_id", jobId).maybeSingle(),
    supabase.from(EVENTS_TABLE).select("*").eq("job_id", jobId).order("phase_order", { ascending: true }),
  ]);

  if (jobRes.error) {
    if (isProgressStorageUnavailableError(jobRes.error)) {
      markTrackerUnavailable(jobRes.error.message);
      return trackerUnavailableResponse(jobId);
    }
    logOnce(`fetch-snapshot-job:${jobRes.error.code}:${jobRes.error.message}`, `[generation-progress] fetch snapshot job failed: ${jobRes.error.message}`);
    return { found: false, trackerAvailable: true, error: jobRes.error.message };
  }

  clearTrackerUnavailable();

  if (!jobRes.data) {
    return { found: false, trackerAvailable: true };
  }

  if (eventsRes.error) {
    if (isProgressStorageUnavailableError(eventsRes.error)) {
      markTrackerUnavailable(eventsRes.error.message);
      return trackerUnavailableResponse(jobId);
    }
    logOnce(`fetch-snapshot-events:${eventsRes.error.code}:${eventsRes.error.message}`, `[generation-progress] fetch snapshot events failed: ${eventsRes.error.message}`);
  }

  const snapshot: GenerationJobSnapshot = {
    ...(jobRes.data as GenerationJobRow),
    phases: ((eventsRes.data ?? []) as GenerationJobSnapshot["phases"]).sort((a, b) => a.phase_order - b.phase_order),
    tracker_available: true,
    tracker_message: null,
  };

  return {
    found: true,
    trackerAvailable: true,
    snapshot,
  };
}

export function getProgressTrackerState() {
  return {
    available: trackerUnavailableReason === null,
    reason: trackerUnavailableReason,
  };
}

```


---

## `app/api/generation-jobs/[jobId]/route.ts`

```ts
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { fetchProgressSnapshot } from "@/lib/progress/server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const { jobId } = await context.params;
  if (!jobId) return Response.json({ error: "jobId vereist" }, { status: 400 });

  const result = await fetchProgressSnapshot(supabase, jobId);
  if (!result.trackerAvailable) {
    return Response.json(result, { status: 200 });
  }
  if (!result.found) {
    return Response.json(result, { status: 202 });
  }

  return Response.json(result, { status: 200 });
}

```


---

## `lib/use-generation-progress.ts`

```ts
"use client";

import { useEffect, useState } from "react";
import { isTerminalGenerationJob } from "@/lib/progress/client";
import type { GenerationJobLookupResponse, GenerationJobSnapshot } from "@/lib/progress/types";

interface UseGenerationProgressOptions {
  pollMs?: number;
}

export function useGenerationProgress(
  jobId: string | null,
  options: UseGenerationProgressOptions = {}
) {
  const pollMs = options.pollMs ?? 1200;
  const [job, setJob] = useState<GenerationJobSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [trackerUnavailable, setTrackerUnavailable] = useState(false);
  const [trackerMessage, setTrackerMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setLoading(false);
      setTrackerUnavailable(false);
      setTrackerMessage(null);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let missingAttempts = 0;

    async function poll() {
      if (!active) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/generation-jobs/${jobId}`, { cache: "no-store" });
        const body = await res.json().catch(() => null) as GenerationJobLookupResponse | null;

        if (!res.ok && res.status !== 202) {
          throw new Error(body?.error || "Voortgang laden mislukt");
        }

        if (!body) {
          throw new Error("Voortgang laden mislukt");
        }

        if (!body.trackerAvailable) {
          if (!active) return;
          setTrackerUnavailable(true);
          setTrackerMessage(body.error || "Live voortgang niet beschikbaar.");
          if (body.snapshot) setJob(body.snapshot);
          return;
        }

        if (!body.found || !body.snapshot) {
          missingAttempts += 1;
          if (missingAttempts >= 8) {
            setTrackerUnavailable(true);
            setTrackerMessage("Voortgang kon niet worden gestart. Generatie loopt mogelijk wel door.");
            return;
          }
          if (active) timer = setTimeout(poll, pollMs);
          return;
        }

        const data = body.snapshot as GenerationJobSnapshot;
        if (!active) return;
        missingAttempts = 0;
        setTrackerUnavailable(false);
        setTrackerMessage(null);
        setJob(data);

        if (!isTerminalGenerationJob(data)) {
          timer = setTimeout(poll, pollMs);
        }
      } catch {
        missingAttempts += 1;
        if (missingAttempts >= 6) {
          setTrackerUnavailable(true);
          setTrackerMessage("Voortgang laden mislukt. Generatie loopt mogelijk nog door.");
        } else if (active) {
          timer = setTimeout(poll, pollMs * 2);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, pollMs]);

  return { job, loading, trackerUnavailable, trackerMessage };
}

```


---

## `components/ui/generation-progress-card.tsx`

```ts
"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { describeGenerationOutcome } from "@/lib/progress/client";
import type { GenerationJobSnapshot } from "@/lib/progress/types";

interface Props {
  title: string;
  job: GenerationJobSnapshot | null;
  fallbackMessage?: string;
}

export function GenerationProgressCard({ title, job, fallbackMessage = "Voortgang wordt voorbereid..." }: Props) {
  const progress = job?.progress_pct ?? 0;
  const phases = job?.phases ?? [];
  const currentPhase = job?.current_phase;

  return (
    <div className="rounded-lg border border-border bg-white/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-rm-gray">{title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {job ? describeGenerationOutcome(job) : fallbackMessage}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs font-semibold text-rm-gray">{progress}%</p>
          <p className="text-[10px] text-muted-foreground">
            {job?.step_index ?? 0}/{job?.total_steps ?? 0} fases
          </p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all ${
            job?.status === "failed" ? "bg-red-500" : job?.status === "completed" ? "bg-emerald-500" : "bg-rm-blue"
          }`}
          style={{ width: `${Math.max(6, progress)}%` }}
        />
      </div>

      {phases.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {phases.map((phase) => {
            const isCurrent = phase.phase_key === currentPhase && job?.status === "running";
            const isFailed = phase.state === "failed";
            const isDone = phase.state === "completed";
            return (
              <div key={phase.phase_key} className="flex items-start gap-2 text-[11px]">
                <span className="mt-0.5 shrink-0">
                  {isCurrent && <Loader2 className="h-3.5 w-3.5 animate-spin text-rm-blue" />}
                  {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                  {isFailed && <AlertCircle className="h-3.5 w-3.5 text-red-500" />}
                  {!isCurrent && !isDone && !isFailed && <span className="block h-3.5 w-3.5 rounded-full border border-gray-300" />}
                </span>
                <div className="min-w-0">
                  <p className={`font-medium ${
                    isFailed ? "text-red-700" : isDone ? "text-emerald-700" : isCurrent ? "text-rm-gray" : "text-muted-foreground"
                  }`}>
                    {phase.phase_label}
                  </p>
                  {phase.details && (
                    <p className="text-[10px] text-muted-foreground">{phase.details}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {job?.status === "failed" && job.error_message && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
          {job.error_message}
          {job.partial_output_exists ? " Partiële output is beschikbaar." : ""}
        </div>
      )}

      {job?.status === "completed" && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-700">
          {job.message || "Resultaat gereed."}
        </div>
      )}
    </div>
  );
}

```


---

## `components/insights/sop-trigger-buttons.tsx`

```ts
"use client";

import { useState, useEffect } from "react";
import { Loader2, Calendar, CheckCircle2, AlertCircle, FileDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAnalysis } from "@/lib/analysis-context";
import { getAllClients } from "@/lib/clients";
import { useGenerationProgress } from "@/lib/use-generation-progress";
import { GenerationProgressCard } from "@/components/ui/generation-progress-card";

type SopType = "weekly" | "biweekly" | "monthly";

interface SopStatus {
  running: boolean;
  lastDate: string | null;
  error: string | null;
  success: boolean;
}

const SOP_CONFIG: Record<SopType, { label: string; description: string; endpoint: string }> = {
  weekly: {
    label: "Weekly",
    description: "Health check & bleeders",
    endpoint: "/api/analysis/weekly",
  },
  biweekly: {
    label: "Bi-weekly",
    description: "Campagne tracking & trends",
    endpoint: "/api/analysis/biweekly",
  },
  monthly: {
    label: "Monthly",
    description: "Volledige analyse & actiepunten",
    endpoint: "/api/analysis/monthly",
  },
};

export interface SopError {
  id: string;
  type: SopType;
  label: string;
  error: string;
  timestamp: string;
}

interface Props {
  clientId: string;
  onAnalysisComplete: () => void;
  onAnalysisError?: (error: SopError) => void;
}

export function SopTriggerButtons({ clientId, onAnalysisComplete, onAnalysisError }: Props) {
  const { startJob, isRunning: isJobRunning } = useAnalysis();
  const [status, setStatus] = useState<Record<SopType, SopStatus>>({
    weekly: { running: false, lastDate: null, error: null, success: false },
    biweekly: { running: false, lastDate: null, error: null, success: false },
    monthly: { running: false, lastDate: null, error: null, success: false },
  });
  const [activeJobIds, setActiveJobIds] = useState<Record<SopType, string | null>>({
    weekly: null,
    biweekly: null,
    monthly: null,
  });
  const [activePdfJobIds, setActivePdfJobIds] = useState<Record<SopType, string | null>>({
    weekly: null,
    biweekly: null,
    monthly: null,
  });
  const weeklyProgress = useGenerationProgress(activeJobIds.weekly);
  const biweeklyProgress = useGenerationProgress(activeJobIds.biweekly);
  const monthlyProgress = useGenerationProgress(activeJobIds.monthly);
  const weeklyPdfProgress = useGenerationProgress(activePdfJobIds.weekly);
  const biweeklyPdfProgress = useGenerationProgress(activePdfJobIds.biweekly);
  const monthlyPdfProgress = useGenerationProgress(activePdfJobIds.monthly);
  const progressByType = {
    weekly: weeklyProgress.job,
    biweekly: biweeklyProgress.job,
    monthly: monthlyProgress.job,
  } as const;
  const pdfProgressByType = {
    weekly: weeklyPdfProgress.job,
    biweekly: biweeklyPdfProgress.job,
    monthly: monthlyPdfProgress.job,
  } as const;

  // Load last analysis dates on mount
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;

    async function loadLastDates() {
      if (!sb) return;
      const types: SopType[] = ["weekly", "biweekly", "monthly"];
      const updates: Partial<Record<SopType, SopStatus>> = {};

      for (const type of types) {
        const { data } = await sb
          .from("sop_analysis_output")
          .select("analysis_date")
          .eq("client_id", clientId)
          .eq("sop_type", type)
          .order("analysis_date", { ascending: false })
          .limit(1);

        if (data && data.length > 0) {
          updates[type] = { ...status[type], lastDate: data[0].analysis_date };
        }
      }

      if (Object.keys(updates).length > 0) {
        setStatus((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(updates)) {
            next[k as SopType] = { ...next[k as SopType], ...v };
          }
          return next;
        });
      }
    }

    loadLastDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function uploadSopFile(sopType: SopType, analysisDate: string, markdownContent: string) {
    const sb = supabase;
    if (!sb) return;

    const fileName = `${analysisDate}-${sopType}-analyse.md`;
    const storagePath = `${clientId}/SOP's/${Date.now()}-${fileName}`;
    const blob = new Blob([markdownContent], { type: "text/markdown" });

    const { error: storageErr } = await sb.storage
      .from("client-files")
      .upload(storagePath, blob);

    if (storageErr) {
      console.error("SOP upload error:", storageErr.message);
      return;
    }

    await sb.from("client_files").insert({
      client_id: clientId,
      folder: "SOP's",
      file_name: fileName,
      file_size: blob.size,
      content_type: "text/markdown",
      storage_path: storagePath,
    });
  }

  function runSop(type: SopType) {
    const config = SOP_CONFIG[type];
    const jobId = `sop-${type}-${clientId}`;
    const progressJobId = crypto.randomUUID();
    setActiveJobIds((prev) => ({ ...prev, [type]: progressJobId }));

    setStatus((prev) => ({
      ...prev,
      [type]: { ...prev[type], running: true, error: null, success: false },
    }));

    startJob(jobId, `${config.label} analyse`, async () => {
      try {
        const res = await fetch(config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, job_id: progressJobId }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analyse mislukt");

        // Build markdown from response
        let markdown: string;
        const analysisDate = data.analysisDate || new Date().toISOString().split("T")[0];

        if (type === "monthly" && data.steps) {
          const header = `# Maandelijkse SEA Analyse\n**Client:** ${clientId}\n**Datum:** ${analysisDate}\n**Periode:** ${data.period?.start} t/m ${data.period?.end}\n**Model:** ${data.model}\n\n---\n\n`;
          const stepsContent = data.steps
            .map((s: { step: number; name: string; output: string }) =>
              `## Stap ${s.step}: ${s.name}\n\n${s.output}`
            )
            .join("\n\n---\n\n");
          markdown = header + stepsContent;
        } else {
          const typeLabel = type === "weekly" ? "Wekelijkse" : "Tweewekelijkse";
          const header = `# ${typeLabel} SEA Analyse\n**Client:** ${clientId}\n**Datum:** ${analysisDate}\n**Periode:** ${data.periodStart} t/m ${data.periodEnd}\n**Model:** ${data.model}\n\n---\n\n`;
          markdown = header + (data.output || data.fullOutput || "Geen output");
        }

        await uploadSopFile(type, analysisDate, markdown);

        setStatus((prev) => ({
          ...prev,
          [type]: { running: false, lastDate: analysisDate, error: null, success: true },
        }));

        setTimeout(() => {
          setStatus((prev) => ({
            ...prev,
            [type]: { ...prev[type], success: false },
          }));
        }, 5000);

        onAnalysisComplete();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Onbekende fout";
        setStatus((prev) => ({
          ...prev,
          [type]: { ...prev[type], running: false, error: errorMsg, success: false },
        }));
        onAnalysisError?.({
          id: `${type}-${Date.now()}`,
          type,
          label: config.label,
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
        throw err; // Re-throw so startJob marks it as error
      }
    });
  }

  const [pdfLoading, setPdfLoading] = useState<Record<SopType, boolean>>({
    weekly: false,
    biweekly: false,
    monthly: false,
  });

  async function downloadPdf(type: SopType, e: React.MouseEvent) {
    e.stopPropagation(); // Don't trigger the analysis button
    const clientName = getAllClients().find((c) => c.id === clientId)?.name ?? clientId;
    const progressJobId = crypto.randomUUID();
    setActivePdfJobIds((prev) => ({ ...prev, [type]: progressJobId }));
    setPdfLoading((prev) => ({ ...prev, [type]: true }));

    try {
      const params = new URLSearchParams({
        client_id: clientId,
        sop_type: type,
        client_name: clientName,
        job_id: progressJobId,
      });
      const res = await fetch(`/api/analysis/pdf?${params}`);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "PDF generatie mislukt" }));
        throw new Error(err.error || "PDF generatie mislukt");
      }

      // Download the PDF
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `SOP-${type}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF download failed:", err);
      alert(err instanceof Error ? err.message : "PDF download mislukt");
    } finally {
      setPdfLoading((prev) => ({ ...prev, [type]: false }));
    }
  }

  const anyRunning = Object.values(status).some((s) => s.running) ||
    (["weekly", "biweekly", "monthly"] as SopType[]).some((t) => isJobRunning(`sop-${t}-${clientId}`));

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-rm-gray">SOP Analyse</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Klik op een analyse om deze handmatig uit te voeren. Output wordt opgeslagen bij Bestanden &gt; SOP&apos;s.
        </p>
      </div>
      <div className="px-5 py-4 flex gap-3 flex-wrap">
        {(Object.entries(SOP_CONFIG) as [SopType, typeof SOP_CONFIG.weekly][]).map(([type, config]) => {
          const s = status[type];
          const progressJob = progressByType[type];
          const pdfProgressJob = pdfProgressByType[type];
          const progressState = type === "weekly" ? weeklyProgress : type === "biweekly" ? biweeklyProgress : monthlyProgress;
          const pdfProgressState = type === "weekly" ? weeklyPdfProgress : type === "biweekly" ? biweeklyPdfProgress : monthlyPdfProgress;
          return (
            <div key={type} className="flex-1 min-w-[160px] flex flex-col gap-1.5">
              <button
                onClick={() => runSop(type)}
                disabled={anyRunning}
                className={`w-full px-4 py-3 rounded-lg border transition-all text-left ${
                  s.running
                    ? "border-rm-blue/30 bg-rm-blue/5 cursor-wait"
                    : s.success
                    ? "border-emerald-300 bg-emerald-50"
                    : s.error
                    ? "border-red-300 bg-red-50"
                    : "border-border hover:border-rm-blue/40 hover:bg-gray-50 cursor-pointer"
                } ${anyRunning && !s.running ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-rm-gray">{config.label}</span>
                  {s.running && <Loader2 className="w-4 h-4 text-rm-blue animate-spin" />}
                  {s.success && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  {s.error && <AlertCircle className="w-4 h-4 text-red-500" />}
                </div>
                <p className="text-[10px] text-muted-foreground">{config.description}</p>
                {s.lastDate && (
                  <div className="flex items-center gap-1 mt-2 text-[9px] text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    Laatst: {s.lastDate}
                  </div>
                )}
                {s.error && (
                  <p className="text-[10px] text-red-500 mt-1 truncate">{s.error}</p>
                )}
                {s.running && type === "monthly" && (
                  <p className="text-[10px] text-rm-blue mt-1">Dit duurt ca. 2-3 minuten...</p>
                )}
                {s.running && type !== "monthly" && (
                  <p className="text-[10px] text-rm-blue mt-1">Dit duurt ca. 30-60 seconden...</p>
                )}
              </button>
              {s.lastDate && (
                <button
                  onClick={(e) => downloadPdf(type, e)}
                  disabled={pdfLoading[type] || anyRunning}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[10px] text-muted-foreground hover:bg-gray-50 hover:text-rm-gray hover:border-rm-orange/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pdfLoading[type] ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <FileDown className="w-3 h-3" />
                  )}
                  {pdfLoading[type] ? "PDF genereren..." : "Download PDF"}
                </button>
              )}
              {(s.running || progressJob) && (
                <GenerationProgressCard
                  title={`${config.label} voortgang`}
                  job={progressJob}
                  fallbackMessage="Voortgang wordt gestart..."
                />
              )}
              {progressState.trackerUnavailable && !progressJob && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  {progressState.trackerMessage || "Live voortgang niet beschikbaar. Analyse loopt mogelijk nog door."}
                </div>
              )}
              {(pdfLoading[type] || pdfProgressJob) && (
                <GenerationProgressCard
                  title={`${config.label} PDF`}
                  job={pdfProgressJob}
                  fallbackMessage="PDF-generatie wordt gestart..."
                />
              )}
              {pdfProgressState.trackerUnavailable && !pdfProgressJob && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  {pdfProgressState.trackerMessage || "Live PDF-voortgang niet beschikbaar."}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

```


---

## `app/api/analysis/search-terms/route.ts`

```ts
import { NextRequest } from "next/server";
import {
  getAllSearchTermsWithClicks,
  getProductGroupPerformance,
  getAccountStructure,
  getAdGroupKeywords,
  getCampaignLocationTargets,
  getAdGroupAdCopy,
  type GoogleAdsCredentials,
} from "@/lib/api/google-ads";
import { buildSearchTermAnalysisPrompt } from "@/lib/prompts/search-term-prompts";
import {
  getSupabase,
  getOpenRouterKey,
  fetchClientContext,
  fmt,
} from "@/lib/analysis/helpers";
import {
  parseSearchTermBatch,
  findMissingTerms,
  type SearchTermVerdict,
  type BatchResult,
  type RunCoverage,
} from "@/lib/schema/search-term-schema";
import { fixMojibake } from "@/lib/analysis/sanitize";
import { applySearchTermGuardrails } from "@/lib/analysis/search-term-guardrails";
import {
  applyProductContextDecisioning,
  buildProductContext,
  summarizeProductContext,
} from "@/lib/analysis/product-context";
import { fetchStrategicContext } from "@/lib/analysis/expert-layers";
import { syncMerchantProductSnapshots } from "@/lib/api/merchant-products";

export const maxDuration = 300; // 5 minutes for full analysis with many batches

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = "google/gemini-3-flash-preview";
const BATCH_SIZE = 100; // Smaller batches = less token overflow risk with enhanced schema

function getCredentials(): GoogleAdsCredentials | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!developerToken || !clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };
}

interface AiVerdict {
  searchTerm: string;
  relevanceScore: number;
  verdict: string;
  recommendedAction: string;
  reason: string;
}

type VerdictWithData = SearchTermVerdict & {
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
};

// ── GET: Fetch cached analysis results ─────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is required" }, { status: 400 });

  // Find the most recent analysis date for this client
  const { data: latest } = await supabase
    .from("search_term_analysis")
    .select("analysis_date")
    .eq("client_id", clientId)
    .order("analysis_date", { ascending: false })
    .limit(1);

  if (!latest || latest.length === 0) {
    return Response.json({ results: [], analysisDate: null });
  }

  const analysisDate = latest[0].analysis_date;

  const { data: results } = await supabase
    .from("search_term_analysis")
    .select("*")
    .eq("client_id", clientId)
    .eq("analysis_date", analysisDate)
    .order("cost", { ascending: false });

  return Response.json({
    results: (results ?? []).map((r: Record<string, unknown>) => ({
      searchTerm: r.search_term,
      campaignName: r.campaign_name,
      adGroupName: r.ad_group_name,
      clicks: r.clicks,
      cost: r.cost,
      conversions: r.conversions,
      conversionsValue: r.conversions_value,
      relevanceScore: r.relevance_score,
      verdict: r.verdict,
      recommendedAction: r.recommended_action,
      reason: r.reason,
    })),
    analysisDate,
    totalResults: (results ?? []).length,
  });
}

// ── POST: Trigger new analysis ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  const credentials = getCredentials();
  if (!credentials) return Response.json({ error: "Google Ads API niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  let customerId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    customerId = body.customerId;
    if (!clientId || !customerId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id, customerId }" }, { status: 400 });
  }

  try {
    const analysisDate = fmt(new Date());

    // Phase 1: Fetch all data in parallel
    const [searchTerms, productPerformance, accountStructure, clientCtx, keywords, locationTargets, adCopy, strategicContext] = await Promise.all([
      getAllSearchTermsWithClicks(credentials, customerId),
      getProductGroupPerformance(credentials, customerId),
      getAccountStructure(credentials, customerId),
      fetchClientContext(supabase, clientId),
      getAdGroupKeywords(credentials, customerId),
      getCampaignLocationTargets(credentials, customerId),
      getAdGroupAdCopy(credentials, customerId),
      fetchStrategicContext(supabase, clientId, analysisDate),
    ]);
    const merchantSync = await syncMerchantProductSnapshots({
      supabase,
      clientId,
      credentials,
    });

    if (searchTerms.length === 0) {
      return Response.json({ error: "Geen zoektermen met clicks gevonden" }, { status: 404 });
    }

    // Build context block (sent with every batch)
    const campaignList = accountStructure.campaigns
      .map((c: { name: string; type: string }) => `- ${c.name} (${c.type})`)
      .join("\n");

    const productTitles = productPerformance
      .slice(0, 200)
      .map((p) => p.productTitle)
      .filter((t) => t && t !== "(onbekend)" && t !== "(asset group)");
    const productList = productTitles.join(", ");

    // Group keywords by campaign > ad group
    const keywordsByAdGroup = new Map<string, string[]>();
    for (const kw of keywords) {
      const key = `${kw.campaignName} > ${kw.adGroupName}`;
      if (!keywordsByAdGroup.has(key)) keywordsByAdGroup.set(key, []);
      keywordsByAdGroup.get(key)!.push(`[${kw.matchType}] ${kw.keyword}`);
    }
    const keywordsText = Array.from(keywordsByAdGroup.entries())
      .map(([group, kws]) => `${group}:\n  ${kws.join(", ")}`)
      .join("\n");

    // Group location targets by campaign
    const locationsByCampaign = new Map<string, string[]>();
    for (const loc of locationTargets) {
      if (!locationsByCampaign.has(loc.campaignName)) locationsByCampaign.set(loc.campaignName, []);
      locationsByCampaign.get(loc.campaignName)!.push(`${loc.locationName} (${loc.locationType})`);
    }
    const locationsText = Array.from(locationsByCampaign.entries())
      .map(([campaign, locs]) => `${campaign}: ${locs.join(", ")}`)
      .join("\n");

    // Group ad copy by campaign > ad group (deduplicate, keep first per ad group)
    const adCopyByAdGroup = new Map<string, { headlines: string[]; descriptions: string[]; urls: string[] }>();
    for (const ad of adCopy) {
      const key = `${ad.campaignName} > ${ad.adGroupName}`;
      if (!adCopyByAdGroup.has(key)) {
        adCopyByAdGroup.set(key, {
          headlines: ad.headlines,
          descriptions: ad.descriptions,
          urls: ad.finalUrls,
        });
      }
    }
    const adCopyText = Array.from(adCopyByAdGroup.entries())
      .map(([group, data]) => {
        const h = data.headlines.length > 0 ? `Headlines: ${data.headlines.join(" | ")}` : "";
        const d = data.descriptions.length > 0 ? `Descriptions: ${data.descriptions.join(" | ")}` : "";
        const u = data.urls.length > 0 ? `URL: ${data.urls[0]}` : "";
        return `${group}:\n  ${[h, d, u].filter(Boolean).join("\n  ")}`;
      })
      .join("\n");

    const targetedCountries = Array.from(new Set(
      locationTargets
        .map((loc) => String(loc.locationType || "").toUpperCase() === "COUNTRY" ? String(loc.locationName || "") : "")
        .filter(Boolean)
        .flatMap((name) => {
          const upper = name.toUpperCase();
          if (upper.includes("NETHERLAND") || upper.includes("NEDERLAND")) return ["NL"];
          if (upper.includes("BELGI") || upper === "BELGIUM") return ["BE"];
          if (upper.includes("GERMAN") || upper.includes("DUITSLAND")) return ["DE"];
          if (upper.includes("FRANCE") || upper.includes("FRANKRIJK")) return ["FR"];
          return [];
        })
    ));

    const productContext = buildProductContext({
      productTitles,
      productTypes: merchantSync.products.flatMap((product) => [
        product.product_type,
        product.product_type_l1,
        product.product_type_l2,
        product.product_type_l3,
        product.product_type_l4,
        product.product_type_l5,
      ].filter(Boolean) as string[]),
      productBrands: merchantSync.products.map((product) => product.brand).filter(Boolean) as string[],
      customLabels: merchantSync.products.flatMap((product) => [
        product.custom_label_0,
        product.custom_label_1,
        product.custom_label_2,
        product.custom_label_3,
        product.custom_label_4,
      ].filter(Boolean) as string[]),
      customAttributes: merchantSync.products.flatMap((product) =>
        Object.values(product.custom_attributes_jsonb ?? {}).filter((value): value is string => typeof value === "string")
      ),
      merchantProducts: merchantSync.products.map((product) => ({
        offerId: product.offer_id,
        title: product.title,
        brand: product.brand,
        productType: product.product_type,
        customLabels: [
          product.custom_label_0,
          product.custom_label_1,
          product.custom_label_2,
          product.custom_label_3,
          product.custom_label_4,
        ].filter(Boolean) as string[],
        customAttributes: Object.values(product.custom_attributes_jsonb ?? {}).filter((value): value is string => typeof value === "string"),
        link: product.link,
      })),
      keywords: keywords.map((kw) => kw.keyword),
      adCopyPhrases: adCopy.flatMap((ad) => [...ad.headlines, ...ad.descriptions, ...ad.finalUrls]),
      strategicContextText: `${clientCtx.goalsSection}\n${strategicContext}`,
      targetedCountries,
    });

    const contextBlock = `## Bedrijfscontext
${clientCtx.goalsSection}

${summarizeProductContext(productContext)}

## Merchant snapshot status
${merchantSync.message}

## Campagnestructuur
${campaignList || "Geen campagnedata beschikbaar"}

## Geografische targeting per campagne
${locationsText || "Geen locatiedata beschikbaar"}

## Keywords per ad group
${keywordsText || "Geen keyword data beschikbaar"}

## Ad copy & landing pages per ad group
${adCopyText || "Geen ad copy data beschikbaar"}

## Producten/diensten (top 30)
${productList || "Geen productdata beschikbaar"}`;

    const systemPrompt = buildSearchTermAnalysisPrompt();

    // Phase 2: Process in parallel batches (3 concurrent)
    const CONCURRENCY = 3;
    const MAX_RETRIES = 1;
    const BATCH_TIMEOUT = 90_000; // 90 seconds per batch (enhanced schema needs more time)

    const batchResults: BatchResult[] = [];

    async function processBatch(batch: typeof searchTerms, batchNum: number, isRetry: boolean = false): Promise<VerdictWithData[]> {
      const inputTermNames = batch.map((t) => t.searchTerm);
      const termsJson = batch.map((t) => ({
        searchTerm: t.searchTerm,
        campaignName: t.campaignName,
        adGroupName: t.adGroupName,
        clicks: t.clicks,
        cost: Math.round(t.cost * 100) / 100,
        conversions: t.conversions,
        conversionsValue: Math.round(t.conversionsValue * 100) / 100,
      }));

      const userMessage = `${contextBlock}

## Zoektermen om te beoordelen (batch ${batchNum})
${JSON.stringify(termsJson, null, 2)}`;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT);

        const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://ranking-masters-dashboard.vercel.app",
          },
          body: JSON.stringify({
            model: OPENROUTER_MODEL,
            max_tokens: 8192,
            temperature: 0.1,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          console.error(`[search-terms] OpenRouter error batch ${batchNum}: ${res.status}`);
          batchResults.push({ batchNum, inputCount: batch.length, outputCount: 0, failedCount: batch.length, retried: isRetry, success: false });
          return [];
        }

        const data = await res.json();
        const rawOutput = fixMojibake(data.choices?.[0]?.message?.content ?? "");

        // Parse with Zod validation (partial recovery)
        const parseResult = parseSearchTermBatch(rawOutput);

        if (!parseResult.success && !isRetry) {
          // Retry once on complete parse failure
          console.warn(`[search-terms] Batch ${batchNum} parse failed, retrying...`);
          return processBatch(batch, batchNum, true);
        }

        if (parseResult.errors.length > 0) {
          console.warn(`[search-terms] Batch ${batchNum}: ${parseResult.errors.length} validation errors, ${parseResult.verdicts.length} valid`);
        }

        // Detect missing terms
        const missing = findMissingTerms(inputTermNames, parseResult.verdicts);
        if (missing.length > 0 && !isRetry) {
          console.warn(`[search-terms] Batch ${batchNum}: ${missing.length} terms missing from LLM output`);
        }

        // Merge verdicts with original performance data
        const results: VerdictWithData[] = [];
        for (const verdict of parseResult.verdicts) {
          const original = batch.find((t) => t.searchTerm === verdict.searchTerm);
          if (!original) continue;
          results.push({
            searchTerm: verdict.searchTerm,
            relevanceScore: verdict.relevanceScore,
            verdict: verdict.verdict,
            recommendedAction: verdict.recommendedAction,
            reason: verdict.reason,
            campaignName: original.campaignName,
            adGroupName: original.adGroupName,
            clicks: original.clicks,
            cost: original.cost,
            conversions: original.conversions,
            conversionsValue: original.conversionsValue,
          });
        }

        batchResults.push({
          batchNum,
          inputCount: batch.length,
          outputCount: results.length,
          failedCount: batch.length - results.length,
          retried: isRetry,
          success: results.length > 0,
        });

        return results;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[search-terms] Batch ${batchNum} error: ${msg}`);

        if (!isRetry) {
          console.warn(`[search-terms] Batch ${batchNum} failed, retrying...`);
          return processBatch(batch, batchNum, true);
        }

        batchResults.push({ batchNum, inputCount: batch.length, outputCount: 0, failedCount: batch.length, retried: true, success: false });
        return [];
      }
    }

    // Build batches
    const batches: { batch: typeof searchTerms; num: number }[] = [];
    for (let i = 0; i < searchTerms.length; i += BATCH_SIZE) {
      batches.push({ batch: searchTerms.slice(i, i + BATCH_SIZE), num: Math.floor(i / BATCH_SIZE) + 1 });
    }

    // Process in waves of CONCURRENCY
    const allVerdicts: VerdictWithData[] = [];
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const wave = batches.slice(i, i + CONCURRENCY);
      const waveResults = await Promise.all(wave.map((b) => processBatch(b.batch, b.num)));
      for (const results of waveResults) {
        allVerdicts.push(...results);
      }
    }

    // Apply deterministic guardrails (corrects unsafe LLM recommendations)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySearchTermGuardrails(allVerdicts as any);
    applyProductContextDecisioning(allVerdicts as any, productContext);

    // Compute run coverage
    const totalFailed = batchResults.reduce((s, b) => s + b.failedCount, 0);
    const totalRetried = batchResults.filter((b) => b.retried).length;
    const coverage: RunCoverage = {
      totalInput: searchTerms.length,
      totalAnalyzed: allVerdicts.length,
      totalFailed,
      totalRetried,
      totalMissing: searchTerms.length - allVerdicts.length,
      coveragePct: searchTerms.length > 0 ? Math.round((allVerdicts.length / searchTerms.length) * 100) : 0,
      batchResults,
    };

    // Phase 3: Delete old results for today and save new ones
    await supabase
      .from("search_term_analysis")
      .delete()
      .eq("client_id", clientId)
      .eq("analysis_date", analysisDate);

    if (allVerdicts.length > 0) {
      const rows = allVerdicts.map((v) => ({
        client_id: clientId,
        analysis_date: analysisDate,
        search_term: v.searchTerm,
        campaign_name: v.campaignName,
        ad_group_name: v.adGroupName,
        clicks: v.clicks,
        cost: Math.round(v.cost * 100) / 100,
        conversions: v.conversions,
        conversions_value: Math.round(v.conversionsValue * 100) / 100,
        relevance_score: v.relevanceScore,
        verdict: v.verdict,
        recommended_action: v.recommendedAction,
        reason: v.reason,
        model_used: OPENROUTER_MODEL,
      }));

      // Insert in chunks of 100 (Supabase limit)
      for (let i = 0; i < rows.length; i += 100) {
        await supabase.from("search_term_analysis").insert(rows.slice(i, i + 100));
      }
    }

    return Response.json({
      results: allVerdicts.map((v) => ({
        searchTerm: v.searchTerm,
        campaignName: v.campaignName,
        adGroupName: v.adGroupName,
        clicks: v.clicks,
        cost: v.cost,
        conversions: v.conversions,
        conversionsValue: v.conversionsValue,
        relevanceScore: v.relevanceScore,
        verdict: v.verdict,
        recommendedAction: v.recommendedAction,
        reason: v.reason,
        productClassification: v.productClassification,
        soldByClient: v.soldByClient,
        evidenceSource: v.evidenceSource,
        recommendedScope: v.recommendedScope,
        exclusionSafety: v.exclusionSafety,
        matchedContext: v.matchedContext,
      })),
      analysisDate,
      totalTerms: searchTerms.length,
      analyzedTerms: allVerdicts.length,
      coverage,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Onbekende fout" },
      { status: 500 }
    );
  }
}

```


---

## `app/api/sync/merchant/route.ts`

```ts
import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { syncMerchantProductSnapshots } from "@/lib/api/merchant-products";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";

export const maxDuration = 300;

function getCredentials(): GoogleAdsCredentials | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!developerToken || !clientId || !clientSecret || !refreshToken) return null;
  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const credentials = getCredentials();
  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id }" }, { status: 400 });
  }

  const result = await syncMerchantProductSnapshots({
    supabase,
    clientId,
    credentials,
    forceRefresh: true,
  });

  return Response.json({
    clientId,
    tracker: result.tracker,
    message: result.message,
    productCount: result.products.length,
  });
}

```


---

## `scripts/merchant-product-snapshots.sql`

```sql
create table if not exists public.merchant_product_snapshots (
  id bigint generated always as identity primary key,
  client_id text not null,
  account_id text not null,
  offer_id text not null,
  product_name text null,
  title text not null,
  normalized_title text not null,
  brand text null,
  product_type text null,
  product_type_l1 text null,
  product_type_l2 text null,
  product_type_l3 text null,
  product_type_l4 text null,
  product_type_l5 text null,
  custom_label_0 text null,
  custom_label_1 text null,
  custom_label_2 text null,
  custom_label_3 text null,
  custom_label_4 text null,
  link text null,
  availability text null,
  language_code text null,
  feed_label text null,
  channel text null,
  custom_attributes_jsonb jsonb null,
  source_payload_jsonb jsonb null,
  snapshot_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_product_snapshots_client_offer_unique unique (client_id, account_id, offer_id)
);

alter table public.client_settings
  add column if not exists merchant_account_id text null,
  add column if not exists merchant_feed_label text null,
  add column if not exists merchant_content_language text null,
  add column if not exists merchant_channel text null;

create index if not exists merchant_product_snapshots_client_idx
  on public.merchant_product_snapshots (client_id);
create index if not exists merchant_product_snapshots_offer_idx
  on public.merchant_product_snapshots (offer_id);
create index if not exists merchant_product_snapshots_normalized_title_idx
  on public.merchant_product_snapshots (normalized_title);
create index if not exists merchant_product_snapshots_label0_idx
  on public.merchant_product_snapshots (custom_label_0);
create index if not exists merchant_product_snapshots_label1_idx
  on public.merchant_product_snapshots (custom_label_1);
create index if not exists merchant_product_snapshots_label2_idx
  on public.merchant_product_snapshots (custom_label_2);
create index if not exists merchant_product_snapshots_label3_idx
  on public.merchant_product_snapshots (custom_label_3);
create index if not exists merchant_product_snapshots_label4_idx
  on public.merchant_product_snapshots (custom_label_4);
create index if not exists merchant_product_snapshots_snapshot_at_idx
  on public.merchant_product_snapshots (snapshot_at desc);

alter table public.merchant_product_snapshots enable row level security;

drop policy if exists "service role merchant snapshots read" on public.merchant_product_snapshots;
create policy "service role merchant snapshots read"
  on public.merchant_product_snapshots
  for select
  to service_role
  using (true);

drop policy if exists "service role merchant snapshots write" on public.merchant_product_snapshots;
create policy "service role merchant snapshots write"
  on public.merchant_product_snapshots
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.set_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists merchant_product_snapshots_set_updated_at on public.merchant_product_snapshots;
create trigger merchant_product_snapshots_set_updated_at
before update on public.merchant_product_snapshots
for each row
execute function public.set_timestamp_updated_at();

```


---

## `scripts/generation-progress.sql`

```sql
-- ============================================================================
-- Shared generation progress tables
-- Safe to re-run in Supabase SQL Editor
-- ============================================================================

CREATE TABLE IF NOT EXISTS generation_jobs (
  job_id UUID PRIMARY KEY,
  client_id TEXT,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'monthly_sop',
    'biweekly_sop',
    'weekly_sop',
    'second_opinion',
    'report_generation',
    'pdf_generation'
  )),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  current_phase TEXT,
  current_phase_label TEXT,
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  step_index INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  partial_output_exists BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS job_type TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS current_phase TEXT,
  ADD COLUMN IF NOT EXISTS current_phase_label TEXT,
  ADD COLUMN IF NOT EXISTS progress_pct INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS step_index INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_steps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS partial_output_exists BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS generation_job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES generation_jobs(job_id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  phase_key TEXT NOT NULL,
  phase_label TEXT NOT NULL,
  phase_order INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  details TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, phase_key)
);

ALTER TABLE generation_job_events
  ADD COLUMN IF NOT EXISTS job_type TEXT,
  ADD COLUMN IF NOT EXISTS phase_key TEXT,
  ADD COLUMN IF NOT EXISTS phase_label TEXT,
  ADD COLUMN IF NOT EXISTS phase_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS details TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_generation_jobs_client_updated
  ON generation_jobs (client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_status_updated
  ON generation_jobs (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_job_events_job_order
  ON generation_job_events (job_id, phase_order ASC);

CREATE OR REPLACE FUNCTION update_generation_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generation_jobs_updated_at ON generation_jobs;
CREATE TRIGGER trg_generation_jobs_updated_at
  BEFORE UPDATE ON generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_generation_jobs_updated_at();

CREATE OR REPLACE FUNCTION update_generation_job_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generation_job_events_updated_at ON generation_job_events;
CREATE TRIGGER trg_generation_job_events_updated_at
  BEFORE UPDATE ON generation_job_events
  FOR EACH ROW
  EXECUTE FUNCTION update_generation_job_events_updated_at();

ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_job_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated generation_jobs" ON generation_jobs;
CREATE POLICY "Allow all for authenticated generation_jobs"
  ON generation_jobs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for authenticated generation_job_events" ON generation_job_events;
CREATE POLICY "Allow all for authenticated generation_job_events"
  ON generation_job_events FOR ALL USING (true) WITH CHECK (true);

```
