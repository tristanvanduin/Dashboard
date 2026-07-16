import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey, fetchClientContext } from "@/lib/analysis/helpers";
import { callOpenRouter } from "@/lib/analysis/openrouter-client";
import { computeAnalysisTargets } from "@/lib/analysis/compute-targets";
import { countryLabel } from "@/lib/countries";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";

export const maxDuration = 120;

// ── Types ─────────────────────────────────────────────────────────────────

interface MetricPoint {
  month: string;
  value: number;
}

interface KpiCard {
  label: string;
  current: number;
  previous: number;
  changePct: number;
  yoyCurrent: number | null;
  yoyPrevious: number | null;
  yoyChangePct: number | null;
  format: "number" | "currency" | "percent" | "decimal";
}

interface MetricSection {
  id: string;
  label: string;
  heading: string;
  body: string;
  bullets: string[];
  chartData: MetricPoint[];
  /** Optional second chart */
  chartData2?: MetricPoint[];
  chartLabel: string;
  chartLabel2?: string;
  chartType: "bar" | "line";
  chartType2?: "bar" | "line";
}

interface CountrySection {
  countryCode: string;
  countryName: string;
  kpiCards: KpiCard[];
  metricSections: MetricSection[];
}

interface ReportData {
  title: string;
  reportMonth: string;
  reportYear: number;
  kpiCards: KpiCard[];
  metricSections: MetricSection[];
  actionSection: { heading: string; body: string };
  planningSection: { heading: string; body: string };
  summaryHeadline?: string;
  summarySubtitle?: string;
  countrySections?: CountrySection[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const MONTH_NAMES_FULL = ["Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"];
const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];

function pct(a: number, b: number): number | null {
  if (b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
}

function findMonth(rows: Array<Record<string, unknown>>, monthStr: string): Record<string, unknown> | undefined {
  return rows.find((r) => String(r.month ?? "").startsWith(monthStr));
}

// ── Prompt ─────────────────────────────────────────────────────────────────

function buildReportPrompt(clientName: string): string {
  return `Je bent een senior SEA account manager bij Ranking Masters die een professioneel klantrapport schrijft.
Het rapport is bedoeld voor de klant zelf.

## KRITIEKE STIJLREGELS

### 1. Koppen zijn ALTIJD concluderend
Koppen vertellen een verhaal in 1 zin. NOOIT observerend of generiek.
De kop beschrijft WAT er aan de hand is en WAAROM, niet alleen het onderwerp.

FOUT (observerend/generiek — gebruik deze NOOIT):
- "Conversie overzicht maart"
- "Performance analyse"
- "Impressies en klikken"
- "CPC ontwikkeling"
- "Sterke volumestijging in maart zorgt voor verdubbeling van het verkeer"  ← te beschrijvend, niet concluderend
- "Stijgende CPC weerspiegelt intensievere concurrentie" ← observeert alleen, concludeert niet

GOED (concluderend — elke kop vertelt het verhaal):
- Impressies: "Bereik verdubbelt door seizoensmatige vraag bij behoud van CTR-kwaliteit"
- CPC: "Lagere CPC dan vorig jaar bevestigt efficiëntere inkoop ondanks marktdruk"
- Conversies: "780 conversies overtreffen het maanddoel met 99% dankzij verbeterde conversieratio"
- Omzet/ROAS: "Omzet stijgt 87% terwijl ROAS ruim boven de 300% doelstelling blijft"
- IS: "Marktaandeel blijft stabiel ondanks verdrievoudiging van het advertentiebudget"
- Acties: "Focus verschuift naar rendementsbescherming na succesvolle schaalfase"
- Planning: "Consolidatie van de CPA-trend bij behoud van het verhoogde conversievolume"

KERNREGEL: De kop moet een CONCLUSIE zijn die de klant kan lezen zonder de rest van de tekst.
Als je de kop leest en je weet nog niet wat de boodschap is, is de kop niet goed genoeg.

ZELFTEST per kop: Bevat de kop een OORZAAK of GEVOLG? Zo nee → herschrijf.
- "Stijgende CPC naar €0,95" ← FOUT, alleen observatie
- "Stijgende CPC naar €0,95 weerspiegelt bewuste opschaling naar competitievere zoektermen" ← GOED, bevat oorzaak
- "Conversies stijgen naar 783" ← FOUT, alleen feit
- "Conversie-doelstelling met 99% overtroffen door verbeterde conversieratio" ← GOED, bevat verklaring

### 2. NOOIT extreme of sturende taal
VERBODEN: mega, extreem, fantastisch, geweldig, indrukwekkend, spectaculair, enorm, ongelofelijk
TOEGESTAAN: recordmaand, sterk, gezond, solide, stabiel, opvallend, consistent, aandachtspunt, uitdaging

### 3. Negatieve cijfers: altijd professioneel perspectief
Koppel ALTIJD aan een plan, verklaring of context. NOOIT letterlijk geruststellen.
- "De hogere CPA is het directe gevolg van de overstap naar tROAS-sturing, die we bewust hebben gemaakt."
- "Hoewel het volume terugloopt, verbetert de kwaliteit van het verkeer — de conversieratio steeg met 18%."

### 4. Schrijfstijl
Professioneel, actieve zinnen, concrete cijfers, Nederlands. Schrijf als strategisch partner.

## JE ONTVANGT
Per metric: de actuele en vorige maandwaarden, MoM en YoY verschil (al berekend).
Plus: afgeronde werkzaamheden, sprint planning, wijzigingen.

## OUTPUT FORMAAT
Retourneer ALLEEN valid JSON:

{
  "summary_headline": "string (concluderende headline voor de KPI-samenvattingspagina, bijv. 'Conversies verdubbelen bij een ROAS die ruim boven target blijft')",
  "summary_subtitle": "string (1 zin context, bijv. 'Maart kenmerkt zich door sterke seizoensgroei met behoud van rendement.')",
  "metric_sections": [
    {
      "id": "impressies",
      "heading": "string (concluderend, vertelt het verhaal van deze metric)",
      "body": "string (2-4 zinnen analyse, koppel aan strategie/seizoen/wijzigingen)"
    },
    { "id": "cpc", "heading": "...", "body": "..." },
    { "id": "conversies", "heading": "...", "body": "..." },
    { "id": "omzet_roas", "heading": "...", "body": "..." },
    { "id": "impression_share", "heading": "...", "body": "..." }
  ],
  "action_section": {
    "heading": "string (concluderend over komende acties)",
    "body": "string — GEBRUIK DIT FORMAAT:\n1. Actiegroep titel: Korte beschrijving van de actie en het verwachte effect.\n2. Tweede actiegroep: Beschrijving.\n3. Derde actiegroep: Beschrijving.\nElke groep op een nieuwe regel, genummerd. Max 4-5 groepen."
  },
  "planning_section": {
    "heading": "string (concluderend over strategie komende periode)",
    "body": "string (strategisch perspectief in 2-4 zinnen, met concrete doelen en tijdshorizon)"
  }
}

BELANGRIJK:
- De heading per metric is CONCLUDEREND — het vertelt de conclusie, niet het onderwerp.
- NIET de metric-naam herhalen als kop ("Impressies", "CPC ontwikkeling" = FOUT).
- De kop moet zo specifiek zijn dat de klant de rest niet hoeft te lezen om de boodschap te begrijpen.
- Gebruik concrete cijfers in koppen waar mogelijk ("780 conversies", "87% omzetgroei", "ROAS van 362%").
- De kop is het belangrijkste element van elke sectie. Besteed hier de meeste aandacht aan.`;
}

// ── Route handlers ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  let clientName: string;
  let jobId = crypto.randomUUID();
  try {
    const body = await request.json();
    clientId = body.client_id;
    clientName = body.client_name || clientId;
    jobId = body.job_id || crypto.randomUUID();
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id, client_name }" }, { status: 400 });
  }

  try {
    await createProgressJob(supabase, {
      jobId,
      clientId,
      jobType: "report_generation",
      initialMessage: "Rapport wordt voorbereid...",
      metadata: { report_type: "client_report" },
    });
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "fetch_inputs",
      message: "Rapport-input, KPI-data en context ophalen...",
    });
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthYear = currentMonth === 1 ? now.getFullYear() - 1 : now.getFullYear();
    const reportMonthLabel = MONTH_NAMES_FULL[lastMonth - 1];
    const reportMonthShort = MONTH_NAMES_SHORT[lastMonth - 1];

    // Previous month (for MoM)
    const prevMonth = lastMonth === 1 ? 12 : lastMonth - 1;
    const prevMonthYear = lastMonth === 1 ? lastMonthYear - 1 : lastMonthYear;

    // Same month last year (for YoY)
    const yoyYear = lastMonthYear - 1;

    const lastMonthStr = `${lastMonthYear}-${String(lastMonth).padStart(2, "0")}`;
    const prevMonthStr = `${prevMonthYear}-${String(prevMonth).padStart(2, "0")}`;
    const yoyMonthStr = `${yoyYear}-${String(lastMonth).padStart(2, "0")}`;

    // 13 months back for chart data — use string math to avoid timezone issues
    const startYear = lastMonth <= 13 ? lastMonthYear - 1 : lastMonthYear;
    const startMonth = ((lastMonth - 14 + 12) % 12) + 1;
    const thirteenMonthsAgo = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
    const periodEnd = `${lastMonthYear}-${String(lastMonth).padStart(2, "0")}-31`;
    const daysAgo60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // ── Fetch all data ───────────────────────────────────────────

    const [
      accountMonthlyRes, isRes,
      sprintItemsRes, completedTasksRes, changeHistoryRes,
      clientCtx, targetResult, latestSopRes, hypothesesRes,
    ] = await Promise.all([
      supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).gte("month", thirteenMonthsAgo).lte("month", periodEnd).order("month"),
      supabase.from("ads_campaign_impression_share").select("month, search_impression_share").eq("client_id", clientId).gte("month", thirteenMonthsAgo).lte("month", periodEnd).order("month"),
      supabase.from("sprint_items").select("task, status, owner, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(50),
      supabase.from("sop_tasks").select("title, description, action_type, affected_campaign, priority, status, due_date").eq("client_id", clientId).in("status", ["completed", "open"]).order("analysis_date", { ascending: false }).limit(40),
      supabase.from("ads_change_history").select("change_datetime, change_type, campaign_name, old_value, new_value").eq("client_id", clientId).gte("change_datetime", daysAgo60).order("change_datetime", { ascending: false }).limit(30),
      fetchClientContext(supabase, clientId),
      computeAnalysisTargets(supabase, clientId),
      supabase.from("sop_analysis_output").select("output, sop_type, analysis_date").eq("client_id", clientId).order("analysis_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("sprint_hypotheses").select("hypothesis, expected_result, status, ice_total").eq("client_id", clientId).in("status", ["pending", "accepted", "completed"]).order("ice_total", { ascending: false }).limit(15),
    ]);

    const accountData = (accountMonthlyRes.data ?? []) as Array<Record<string, unknown>>;
    const isData = (isRes.data ?? []) as Array<Record<string, unknown>>;

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "aggregate_data",
      message: "KPI's, grafiekdata en rapportcontext opbouwen...",
    });
    // ── Compute per-metric MoM + YoY ─────────────────────────────

    const cur = findMonth(accountData, lastMonthStr);
    const prev = findMonth(accountData, prevMonthStr);
    const yoy = findMonth(accountData, yoyMonthStr);

    const g = (row: Record<string, unknown> | undefined, key: string): number => Number(row?.[key] ?? 0);

    // KPI Cards (6 cards like original reports)
    const kpiCards: KpiCard[] = [
      { label: "Conversies", current: g(cur, "conversions"), previous: g(prev, "conversions"), changePct: pct(g(cur, "conversions"), g(prev, "conversions")) ?? 0, yoyCurrent: g(yoy, "conversions") || null, yoyPrevious: null, yoyChangePct: yoy ? pct(g(cur, "conversions"), g(yoy, "conversions")) : null, format: "number" },
      { label: "Omzet", current: g(cur, "conversions_value"), previous: g(prev, "conversions_value"), changePct: pct(g(cur, "conversions_value"), g(prev, "conversions_value")) ?? 0, yoyCurrent: g(yoy, "conversions_value") || null, yoyPrevious: null, yoyChangePct: yoy ? pct(g(cur, "conversions_value"), g(yoy, "conversions_value")) : null, format: "currency" },
      { label: "Kosten", current: g(cur, "cost"), previous: g(prev, "cost"), changePct: pct(g(cur, "cost"), g(prev, "cost")) ?? 0, yoyCurrent: g(yoy, "cost") || null, yoyPrevious: null, yoyChangePct: yoy ? pct(g(cur, "cost"), g(yoy, "cost")) : null, format: "currency" },
      { label: "ROAS", current: g(cur, "cost") > 0 ? g(cur, "conversions_value") / g(cur, "cost") * 100 : 0, previous: g(prev, "cost") > 0 ? g(prev, "conversions_value") / g(prev, "cost") * 100 : 0, changePct: 0, yoyCurrent: null, yoyPrevious: null, yoyChangePct: null, format: "percent" },
      { label: "CPA", current: g(cur, "conversions") > 0 ? g(cur, "cost") / g(cur, "conversions") : 0, previous: g(prev, "conversions") > 0 ? g(prev, "cost") / g(prev, "conversions") : 0, changePct: 0, yoyCurrent: null, yoyPrevious: null, yoyChangePct: null, format: "currency" },
    ];
    // Calculate ROAS and CPA change% after
    kpiCards[3].changePct = pct(kpiCards[3].current, kpiCards[3].previous) ?? 0;
    if (yoy) { kpiCards[3].yoyChangePct = pct(kpiCards[3].current, g(yoy, "cost") > 0 ? g(yoy, "conversions_value") / g(yoy, "cost") * 100 : 0); }
    kpiCards[4].changePct = pct(kpiCards[4].current, kpiCards[4].previous) ?? 0;
    if (yoy && g(yoy, "conversions") > 0) { kpiCards[4].yoyChangePct = pct(kpiCards[4].current, g(yoy, "cost") / g(yoy, "conversions")); }

    // ── Build chart data (13 months) ─────────────────────────────

    // Sort accountData by month string (YYYY-MM) to guarantee chronological order
    const sortedAccountData = [...accountData].sort((a, b) =>
      String(a.month ?? "").localeCompare(String(b.month ?? ""))
    );

    // Label formatter: "Feb '25", "Mrt '26" — compact with year disambiguation
    function chartLabel(rawMonth: string): string {
      const parts = String(rawMonth).slice(0, 7).split("-");
      const mIdx = parseInt(parts[1] ?? "1", 10) - 1;
      const yr = (parts[0] ?? "").slice(2); // "25", "26"
      return `${MONTH_NAMES_SHORT[mIdx] ?? "?"} '${yr}`;
    }

    function buildChartData(key: string): MetricPoint[] {
      const points = sortedAccountData.map((r) => ({
        month: chartLabel(String(r.month ?? "")),
        value: Number(r[key] ?? 0),
        _raw: String(r.month ?? ""),
      }));
      // Debug: log chart data for verification
      console.log(`[client-reports] buildChartData(${key}):`, points.map((p) => `${p._raw} → ${p.month}: ${p.value}`).join(" | "));
      return points.map(({ month, value }) => ({ month, value }));
    }

    function buildComputedChart(fn: (r: Record<string, unknown>) => number): MetricPoint[] {
      return sortedAccountData.map((r) => ({
        month: chartLabel(String(r.month ?? "")),
        value: fn(r),
      }));
    }

    // IS chart (from campaign data, aggregated)
    const isChartData: MetricPoint[] = [];
    const isMonths = new Map<string, number[]>();
    for (const r of isData) {
      const m = String(r.month ?? "").slice(0, 7);
      if (!isMonths.has(m)) isMonths.set(m, []);
      const val = Number(r.search_impression_share ?? 0);
      if (val > 0) isMonths.get(m)!.push(val);
    }
    // Sort IS months chronologically
    const sortedIsMonths = [...isMonths.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [m, vals] of sortedIsMonths) {
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      isChartData.push({ month: chartLabel(m), value: Math.round(avg * 100) / 100 });
    }

    // Format bullets for LLM
    const fmt = (v: number, f: string) => {
      if (f === "currency") return `€${new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
      if (f === "percent") return `${v.toFixed(2)}%`;
      if (f === "decimal") return v.toFixed(2);
      return new Intl.NumberFormat("nl-NL").format(Math.round(v));
    };

    const metricBullets = (label: string, curVal: number, prevVal: number, yoyVal: number | null, format: string) => {
      const mom = pct(curVal, prevVal);
      const yoyPct = yoyVal ? pct(curVal, yoyVal) : null;
      const lines = [`${label}: ${fmt(prevVal, format)} → ${fmt(curVal, format)} (${mom != null ? (mom > 0 ? "+" : "") + mom + "% m/m" : "n.v.t."})`];
      if (yoyPct != null) lines.push(`Jaar-op-jaar: ${fmt(yoyVal!, format)} → ${fmt(curVal, format)} (${yoyPct > 0 ? "+" : ""}${yoyPct}% YoY)`);
      return lines;
    };

    // ── Build LLM user message with computed data ────────────────

    const sprintItems = sprintItemsRes.data ?? [];
    const completedTasks = completedTasksRes.data ?? [];
    const changeHistory = changeHistoryRes.data ?? [];
    const hypotheses = hypothesesRes.data ?? [];
    const { goalsSection } = clientCtx;

    const doneItems = sprintItems.filter((i) => i.status === "done");
    const openItems = sprintItems.filter((i) => i.status !== "done" && i.status !== "expired");
    const doneTasks = completedTasks.filter((t) => t.status === "completed");
    const openTasks = completedTasks.filter((t) => t.status === "open");

    const curIS = isChartData.length > 0 ? isChartData[isChartData.length - 1]?.value : null;
    const prevIS = isChartData.length > 1 ? isChartData[isChartData.length - 2]?.value : null;

    const userMessage = `Schrijf een maandrapportage voor ${clientName} over ${reportMonthLabel} ${lastMonthYear}.

## Doelstellingen
${goalsSection}

## Per-metric data (al berekend, gebruik deze exacte cijfers)

### Impressies
${metricBullets("Impressies", g(cur, "impressions"), g(prev, "impressions"), yoy ? g(yoy, "impressions") : null, "number").join("\n")}
${metricBullets("Klikken", g(cur, "clicks"), g(prev, "clicks"), yoy ? g(yoy, "clicks") : null, "number").join("\n")}
${metricBullets("CTR", g(cur, "ctr") * 100, g(prev, "ctr") * 100, yoy ? g(yoy, "ctr") * 100 : null, "decimal").join("\n")}

### CPC
${metricBullets("CPC", g(cur, "avg_cpc"), g(prev, "avg_cpc"), yoy ? g(yoy, "avg_cpc") : null, "currency").join("\n")}

### Conversies
${metricBullets("Conversies", g(cur, "conversions"), g(prev, "conversions"), yoy ? g(yoy, "conversions") : null, "number").join("\n")}
${metricBullets("Conversieratio", g(cur, "conversion_rate") * 100, g(prev, "conversion_rate") * 100, yoy ? g(yoy, "conversion_rate") * 100 : null, "decimal").join("\n")}
${metricBullets("Kosten per conversie", kpiCards[4].current, kpiCards[4].previous, yoy && g(yoy, "conversions") > 0 ? g(yoy, "cost") / g(yoy, "conversions") : null, "currency").join("\n")}

### Omzet & ROAS
${metricBullets("Conversiewaarde", g(cur, "conversions_value"), g(prev, "conversions_value"), yoy ? g(yoy, "conversions_value") : null, "currency").join("\n")}
${metricBullets("Kosten", g(cur, "cost"), g(prev, "cost"), yoy ? g(yoy, "cost") : null, "currency").join("\n")}
${metricBullets("ROAS", kpiCards[3].current, kpiCards[3].previous, yoy && g(yoy, "cost") > 0 ? g(yoy, "conversions_value") / g(yoy, "cost") * 100 : null, "percent").join("\n")}

### Search Impression Share
${curIS != null && prevIS != null ? `IS: ${prevIS}% → ${curIS}% (${pct(curIS, prevIS) != null ? (pct(curIS, prevIS)! > 0 ? "+" : "") + pct(curIS, prevIS) + "% m/m" : ""})` : "Geen IS data beschikbaar."}

## Afgeronde werkzaamheden
${doneItems.length > 0 ? doneItems.map((i) => `- [${i.owner}] ${i.task}`).join("\n") : "Geen afgeronde sprint items."}
${doneTasks.length > 0 ? doneTasks.map((t) => `- [${t.priority}] ${t.title}: ${t.description}`).join("\n") : ""}

## Openstaande taken / planning komende maand
${openTasks.length > 0 ? openTasks.map((t) => `- [${t.priority}] ${t.title}: ${t.description}`).join("\n") : "Geen openstaande taken."}
${openItems.length > 0 ? openItems.map((i) => `- [${i.owner}] ${i.task} (${i.status})`).join("\n") : ""}
${hypotheses.length > 0 ? "\nHypotheses:\n" + hypotheses.map((h) => `- [${h.status}] ${h.hypothesis} → ${h.expected_result}`).join("\n") : ""}

## Wijzigingen in Google Ads (laatste 60 dagen)
${changeHistory.length > 0 ? changeHistory.slice(0, 15).map((c) => {
      const date = new Date(c.change_datetime as string).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
      return `- ${date}: ${c.change_type} op ${c.campaign_name}`;
    }).join("\n") : "Geen wijzigingen."}

${latestSopRes.data ? `\nContext laatste SOP (${latestSopRes.data.sop_type}):\n${(latestSopRes.data.output as string).slice(0, 1500)}` : ""}

Schrijf nu het rapport. Retourneer ALLEEN valid JSON.`;

    // ── Generate via LLM ─────────────────────────────────────────

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "compose_sections",
      message: "Hoofdsecties van het rapport genereren...",
    });
    const response = await callOpenRouter({
      apiKey,
      systemPrompt: buildReportPrompt(clientName),
      userMessage,
      maxTokens: 8192,
      jsonMode: true,
      label: "client-report-v2",
    });

    let llmData: {
      metric_sections: Array<{ id: string; heading: string; body: string }>;
      action_section: { heading: string; body: string };
      planning_section: { heading: string; body: string };
    };
    try {
      llmData = JSON.parse(response.output);
    } catch {
      const jsonMatch = response.output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        llmData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Rapport generatie mislukt: geen valid JSON");
      }
    }

    // ── Merge LLM text with computed data ────────────────────────

    const findLlmSection = (id: string) => llmData.metric_sections?.find((s) => s.id === id);

    const impressiesLlm = findLlmSection("impressies");
    const cpcLlm = findLlmSection("cpc");
    const conversiesLlm = findLlmSection("conversies");
    const omzetLlm = findLlmSection("omzet_roas");
    const isLlm = findLlmSection("impression_share");

    const metricSections: MetricSection[] = [
      {
        id: "impressies",
        label: `Resultaten ${reportMonthShort} | Impressies`,
        heading: impressiesLlm?.heading ?? "Impressies overzicht",
        body: impressiesLlm?.body ?? "",
        bullets: [
          ...metricBullets("Impressies", g(cur, "impressions"), g(prev, "impressions"), yoy ? g(yoy, "impressions") : null, "number"),
          ...metricBullets("Klikken", g(cur, "clicks"), g(prev, "clicks"), yoy ? g(yoy, "clicks") : null, "number"),
          ...metricBullets("CTR", g(cur, "ctr") * 100, g(prev, "ctr") * 100, yoy ? g(yoy, "ctr") * 100 : null, "decimal"),
        ],
        chartData: buildChartData("impressions"),
        chartData2: buildComputedChart((r) => Number(r.ctr ?? 0) * 100),
        chartLabel: "Impressies",
        chartLabel2: "CTR (%)",
        chartType: "bar",
        chartType2: "line",
      },
      {
        id: "cpc",
        label: `Resultaten ${reportMonthShort} | CPC`,
        heading: cpcLlm?.heading ?? "CPC overzicht",
        body: cpcLlm?.body ?? "",
        bullets: metricBullets("CPC", g(cur, "avg_cpc"), g(prev, "avg_cpc"), yoy ? g(yoy, "avg_cpc") : null, "currency"),
        chartData: buildChartData("avg_cpc"),
        chartLabel: "CPC",
        chartType: "line",
      },
      {
        id: "conversies",
        label: `Resultaten ${reportMonthShort} | Conversies`,
        heading: conversiesLlm?.heading ?? "Conversies overzicht",
        body: conversiesLlm?.body ?? "",
        bullets: [
          ...metricBullets("Conversies", g(cur, "conversions"), g(prev, "conversions"), yoy ? g(yoy, "conversions") : null, "number"),
          ...metricBullets("Conversieratio", g(cur, "conversion_rate") * 100, g(prev, "conversion_rate") * 100, yoy ? g(yoy, "conversion_rate") * 100 : null, "decimal"),
          ...metricBullets("Kosten per conversie", kpiCards[4].current, kpiCards[4].previous, yoy && g(yoy, "conversions") > 0 ? g(yoy, "cost") / g(yoy, "conversions") : null, "currency"),
        ],
        chartData: buildChartData("conversions"),
        chartData2: buildComputedChart((r) => Number(r.conversion_rate ?? 0) * 100),
        chartLabel: "Conversies",
        chartLabel2: "Conversieratio (%)",
        chartType: "bar",
        chartType2: "line",
      },
      {
        id: "omzet_roas",
        label: `Resultaten ${reportMonthShort} | Omzet & ROAS`,
        heading: omzetLlm?.heading ?? "Omzet & ROAS overzicht",
        body: omzetLlm?.body ?? "",
        bullets: [
          ...metricBullets("Conversiewaarde", g(cur, "conversions_value"), g(prev, "conversions_value"), yoy ? g(yoy, "conversions_value") : null, "currency"),
          ...metricBullets("Kosten", g(cur, "cost"), g(prev, "cost"), yoy ? g(yoy, "cost") : null, "currency"),
          ...metricBullets("ROAS", kpiCards[3].current, kpiCards[3].previous, yoy && g(yoy, "cost") > 0 ? g(yoy, "conversions_value") / g(yoy, "cost") * 100 : null, "percent"),
        ],
        chartData: buildChartData("conversions_value"),
        chartData2: buildComputedChart((r) => Number(r.cost ?? 0) > 0 ? Number(r.conversions_value ?? 0) / Number(r.cost ?? 1) * 100 : 0),
        chartLabel: "Omzet",
        chartLabel2: "ROAS (%)",
        chartType: "bar",
        chartType2: "line",
      },
    ];

    // Add IS section only if data exists
    if (isChartData.length > 0) {
      metricSections.push({
        id: "impression_share",
        label: `Resultaten ${reportMonthShort} | Impression Share`,
        heading: isLlm?.heading ?? "Search Impression Share",
        body: isLlm?.body ?? "",
        bullets: curIS != null && prevIS != null
          ? [`Search Impression Share: ${prevIS}% → ${curIS}% (${pct(curIS, prevIS) != null ? (pct(curIS, prevIS)! > 0 ? "+" : "") + pct(curIS, prevIS) + "% m/m" : ""})`]
          : [],
        chartData: isChartData,
        chartLabel: "Search Impression Share (%)",
        chartType: "line",
      });
    }

    // ── Multi-country sections (if applicable) ─────────────────

    let countrySections: CountrySection[] | undefined;

    // Determine active countries: explicit settings OR auto-detect from ads_country_monthly
    const { data: countrySettings } = await supabase
      .from("client_settings")
      .select("active_countries")
      .eq("client_id", clientId)
      .maybeSingle();

    let activeCountries = (countrySettings?.active_countries as string[] | null) ?? [];

    // Auto-detect if not explicitly set: check ads_country_monthly for countries with spend
    if (activeCountries.length === 0) {
      const { data: detectedData } = await supabase
        .from("ads_country_monthly")
        .select("country_code, cost")
        .eq("client_id", clientId)
        .gte("month", thirteenMonthsAgo)
        .gt("cost", 0);
      if (detectedData && detectedData.length > 0) {
        const spendByCountry = new Map<string, number>();
        for (const r of detectedData) {
          const cc = r.country_code as string;
          spendByCountry.set(cc, (spendByCountry.get(cc) ?? 0) + Number(r.cost));
        }
        activeCountries = Array.from(spendByCountry.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([cc]) => cc);
      }
    }

    if (activeCountries.length > 1) {
      await updateProgressPhase(supabase, {
        jobId,
        phaseKey: "compose_country_sections",
        message: `Landensecties genereren voor ${activeCountries.length} markten...`,
      });
      // Fetch pre-aggregated country data + YoY (much faster than raw geo aggregation)
      const [{ data: cmData }, { data: cyoyData }] = await Promise.all([
        supabase.from("ads_country_monthly")
          .select("country_code, month, impressions, clicks, cost, conversions, conversions_value, ctr, avg_cpc, cost_per_conversion, conversion_rate, roas, spend_share")
          .eq("client_id", clientId)
          .in("country_code", activeCountries)
          .gte("month", thirteenMonthsAgo)
          .lte("month", periodEnd)
          .order("month"),
        supabase.from("ads_country_yoy")
          .select("country_code, month, conversions_yoy_pct, conversions_value_yoy_pct, cost_yoy_pct, roas_yoy_pct, cost_per_conversion_yoy_pct")
          .eq("client_id", clientId)
          .in("country_code", activeCountries),
      ]);

      const cmRows = (cmData ?? []) as Array<Record<string, unknown>>;
      const yoyRows = (cyoyData ?? []) as Array<Record<string, unknown>>;

      // Group country data by country → month
      const countryMonthly = new Map<string, Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; avg_cpc: number; roas: number }>>();
      for (const row of cmRows) {
        const cc = String(row.country_code ?? "").toUpperCase();
        if (!countryMonthly.has(cc)) countryMonthly.set(cc, []);
        countryMonthly.get(cc)!.push({
          month: String(row.month ?? "").slice(0, 7),
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          cost: Number(row.cost ?? 0),
          conversions: Number(row.conversions ?? 0),
          conversions_value: Number(row.conversions_value ?? 0),
          avg_cpc: Number(row.avg_cpc ?? 0),
          roas: Number(row.roas ?? 0),
        });
      }

      // Index YoY by country+month
      const yoyIndex = new Map<string, Record<string, unknown>>();
      for (const r of yoyRows) {
        yoyIndex.set(`${r.country_code}|||${String(r.month ?? "").slice(0, 7)}`, r);
      }

      // Build per-country sections in parallel
      const countryPromises = activeCountries.map(async (cc) => {
        const monthData = countryMonthly.get(cc);
        if (!monthData || monthData.length === 0) return null;

        const cName = countryLabel(cc);
        const months = monthData.sort((a, b) => a.month.localeCompare(b.month));
        const cur = months[months.length - 1];
        const prev = months.length > 1 ? months[months.length - 2] : null;
        const curMonthKey = cur.month;

        if (!cur) return null;

        const p = prev ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0, avg_cpc: 0, roas: 0 };

        // ROAS as multiplier (not %)
        const cRoas = cur.roas;
        const pRoas = p.roas;
        const cCpa = cur.conversions > 0 ? cur.cost / cur.conversions : 0;
        const pCpa = p.conversions > 0 ? p.cost / p.conversions : 0;
        const cCpc = cur.avg_cpc;
        const pCpc = p.avg_cpc;

        // YoY data for this country+month
        const yoy = yoyIndex.get(`${cc}|||${curMonthKey}`);
        const yoyConv = yoy ? Number(yoy.conversions_yoy_pct ?? 0) : null;
        const yoyRev = yoy ? Number(yoy.conversions_value_yoy_pct ?? 0) : null;
        const yoyCost = yoy ? Number(yoy.cost_yoy_pct ?? 0) : null;
        const yoyRoas = yoy ? Number(yoy.roas_yoy_pct ?? 0) : null;
        const yoyCpa = yoy ? Number(yoy.cost_per_conversion_yoy_pct ?? 0) : null;

        const cKpis: KpiCard[] = [
          { label: "Conversies", current: cur.conversions, previous: p.conversions, changePct: pct(cur.conversions, p.conversions) ?? 0, yoyCurrent: null, yoyPrevious: null, yoyChangePct: yoyConv, format: "number" },
          { label: "Omzet", current: cur.conversions_value, previous: p.conversions_value, changePct: pct(cur.conversions_value, p.conversions_value) ?? 0, yoyCurrent: null, yoyPrevious: null, yoyChangePct: yoyRev, format: "currency" },
          { label: "Kosten", current: cur.cost, previous: p.cost, changePct: pct(cur.cost, p.cost) ?? 0, yoyCurrent: null, yoyPrevious: null, yoyChangePct: yoyCost, format: "currency" },
          { label: "ROAS", current: cRoas * 100, previous: pRoas * 100, changePct: pct(cRoas, pRoas) ?? 0, yoyCurrent: null, yoyPrevious: null, yoyChangePct: yoyRoas, format: "percent" },
          { label: "CPA", current: cCpa, previous: pCpa, changePct: pct(cCpa, pCpa) ?? 0, yoyCurrent: null, yoyPrevious: null, yoyChangePct: yoyCpa, format: "currency" },
        ];

        // Chart data from pre-aggregated monthly data
        function countryChartData(key: "conversions" | "conversions_value" | "cost" | "impressions" | "clicks"): MetricPoint[] {
          return months.map((d) => ({ month: chartLabel(d.month + "-01"), value: d[key] }));
        }
        const ctrChart: MetricPoint[] = months.map((d) => ({ month: chartLabel(d.month + "-01"), value: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0 }));
        const cpcChart: MetricPoint[] = months.map((d) => ({ month: chartLabel(d.month + "-01"), value: d.avg_cpc }));
        const roasChart: MetricPoint[] = months.map((d) => ({ month: chartLabel(d.month + "-01"), value: d.roas * 100 }));
        const crChart: MetricPoint[] = months.map((d) => ({ month: chartLabel(d.month + "-01"), value: d.clicks > 0 ? (d.conversions / d.clicks) * 100 : 0 }));

        // Bullets helper
        const cBullets = (label: string, curV: number, prevV: number, format: string, yoyPctVal?: number | null) => {
          const mom = pct(curV, prevV);
          let line = `${label}: ${fmt(prevV, format)} → ${fmt(curV, format)} (${mom != null ? (mom > 0 ? "+" : "") + mom + "% m/m" : "n.v.t."})`;
          if (yoyPctVal != null) line += `, j/j ${yoyPctVal > 0 ? "+" : ""}${yoyPctVal}%`;
          return line;
        };

        // LLM call for country-specific analysis (now with CPC data)
        const countryPrompt = `Schrijf per-metric koppen en analyse voor ${cName} binnen het account van ${clientName}.
Dit is een LANDSECTIE binnen een breder rapport. Houd het kort en specifiek voor ${cName}.
ELKE KOP MOET CONCLUDEREND ZIJN — bevat een oorzaak of gevolg, niet alleen een observatie.
FOUT: "Zichtbaarheid stijgt met 82%" ← alleen observatie
GOED: "Zichtbaarheid in ${cName} stijgt met 82% door actieve opschaling van het bereik" ← bevat oorzaak

## Data ${cName}
- Impressies: ${cBullets("Impressies", cur.impressions, p.impressions, "number")}
- Klikken: ${cBullets("Klikken", cur.clicks, p.clicks, "number")}
- CPC: ${cBullets("CPC", cCpc, pCpc, "currency")}
- Conversies: ${cBullets("Conversies", cur.conversions, p.conversions, "number", yoyConv)}
- Omzet: ${cBullets("Omzet", cur.conversions_value, p.conversions_value, "currency", yoyRev)}
- Kosten: ${cBullets("Kosten", cur.cost, p.cost, "currency", yoyCost)}
- ROAS: ${cBullets("ROAS", cRoas * 100, pRoas * 100, "percent", yoyRoas)}
- CPA: ${cBullets("CPA", cCpa, pCpa, "currency", yoyCpa)}

Retourneer ALLEEN valid JSON:
{
  "impressies": { "heading": "string", "body": "string (1-2 zinnen)" },
  "cpc": { "heading": "string", "body": "string (1-2 zinnen)" },
  "conversies": { "heading": "string", "body": "string (1-2 zinnen)" },
  "omzet_roas": { "heading": "string", "body": "string (1-2 zinnen)" }
}`;

        let countryLlm: Record<string, { heading: string; body: string }> = {};
        try {
          const cRes = await callOpenRouter({
            apiKey,
            systemPrompt: buildReportPrompt(clientName),
            userMessage: countryPrompt,
            maxTokens: 2048,
            jsonMode: true,
            label: `country-report-${cc}`,
          });
          countryLlm = JSON.parse(cRes.output);
        } catch { /* use defaults */ }

        const cMetrics: MetricSection[] = [
          {
            id: `${cc}_impressies`,
            label: `${cName} | Impressies`,
            heading: countryLlm.impressies?.heading ?? `Impressies ${cName}`,
            body: countryLlm.impressies?.body ?? "",
            bullets: [
              cBullets("Impressies", cur.impressions, p.impressions, "number"),
              cBullets("Klikken", cur.clicks, p.clicks, "number"),
              cBullets("CTR", cur.impressions > 0 ? (cur.clicks / cur.impressions) * 100 : 0, p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0, "decimal"),
            ],
            chartData: countryChartData("impressions"),
            chartData2: ctrChart,
            chartLabel: `Impressies (${cc})`,
            chartLabel2: `CTR (${cc})`,
            chartType: "bar",
            chartType2: "line",
          },
          {
            id: `${cc}_cpc`,
            label: `${cName} | CPC`,
            heading: countryLlm.cpc?.heading ?? `CPC ${cName}`,
            body: countryLlm.cpc?.body ?? "",
            bullets: [
              cBullets("CPC", cCpc, pCpc, "currency"),
              cBullets("Kosten", cur.cost, p.cost, "currency", yoyCost),
            ],
            chartData: cpcChart,
            chartLabel: `CPC (${cc})`,
            chartType: "line",
          },
          {
            id: `${cc}_conversies`,
            label: `${cName} | Conversies`,
            heading: countryLlm.conversies?.heading ?? `Conversies ${cName}`,
            body: countryLlm.conversies?.body ?? "",
            bullets: [
              cBullets("Conversies", cur.conversions, p.conversions, "number", yoyConv),
              cBullets("Conversieratio", cur.clicks > 0 ? (cur.conversions / cur.clicks) * 100 : 0, p.clicks > 0 ? (p.conversions / p.clicks) * 100 : 0, "decimal"),
            ],
            chartData: countryChartData("conversions"),
            chartData2: crChart,
            chartLabel: `Conversies (${cc})`,
            chartLabel2: `Conversieratio (${cc})`,
            chartType: "bar",
            chartType2: "line",
          },
          {
            id: `${cc}_omzet`,
            label: `${cName} | Omzet & ROAS`,
            heading: countryLlm.omzet_roas?.heading ?? `Omzet & ROAS ${cName}`,
            body: countryLlm.omzet_roas?.body ?? "",
            bullets: [
              cBullets("Omzet", cur.conversions_value, p.conversions_value, "currency", yoyRev),
              cBullets("Kosten", cur.cost, p.cost, "currency", yoyCost),
              cBullets("ROAS", cRoas * 100, pRoas * 100, "percent", yoyRoas),
            ],
            chartData: countryChartData("conversions_value"),
            chartData2: roasChart,
            chartLabel: `Omzet (${cc})`,
            chartLabel2: `ROAS (${cc})`,
            chartType: "bar",
            chartType2: "line",
          },
        ];

        return { countryCode: cc, countryName: cName, kpiCards: cKpis, metricSections: cMetrics } as CountrySection;
      });

      const countryResults = await Promise.all(countryPromises);
      countrySections = countryResults.filter((cs): cs is CountrySection => cs !== null);
    }

    // ── Build final report structure ─────────────────────────────

    const reportData: ReportData = {
      title: `Maandrapportage ${reportMonthLabel} ${lastMonthYear} — ${clientName}`,
      reportMonth: reportMonthLabel,
      reportYear: lastMonthYear,
      kpiCards,
      metricSections,
      actionSection: llmData.action_section ?? { heading: "Acties komende maand", body: "" },
      planningSection: llmData.planning_section ?? { heading: "Planning", body: "" },
      summaryHeadline: (llmData as Record<string, unknown>).summary_headline as string | undefined,
      summarySubtitle: (llmData as Record<string, unknown>).summary_subtitle as string | undefined,
      countrySections: countrySections && countrySections.length > 0 ? countrySections : undefined,
    };

    // ── Save to Supabase ─────────────────────────────────────────

    const reportDate = `${lastMonthYear}-${String(lastMonth).padStart(2, "0")}-01`;

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "save_outputs",
      message: "Rapport opslaan...",
    });
    const { data: row, error: insertErr } = await supabase
      .from("client_reports")
      .insert({
        client_id: clientId,
        report_date: reportDate,
        report_month: lastMonth,
        report_year: lastMonthYear,
        title: reportData.title,
        sections: reportData, // Store ENTIRE report structure as JSONB
        model_used: response.model,
        tokens_used: response.tokensUsed,
        status: "draft",
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[client-reports] Insert failed:", insertErr.message);
      await markProgressFailed(supabase, {
        jobId,
        errorMessage: insertErr.message,
        partialOutputExists: true,
      });
      return Response.json({ ...reportData, reportId: null, saved: false });
    }

    await markProgressCompleted(supabase, {
      jobId,
      message: "Rapport gereed.",
      metadata: {
        report_id: row.id,
        report_month: lastMonth,
        report_year: lastMonthYear,
      },
    });

    return Response.json({ ...reportData, jobId, reportId: row.id, saved: true });
  } catch (err) {
    console.error("[client-reports] Generation failed:", err);
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "Rapport generatie mislukt",
    });
    return Response.json({ error: err instanceof Error ? err.message : "Rapport generatie mislukt" }, { status: 500 });
  }
}

// ── GET: List reports ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });

  const { data, error } = await supabase
    .from("client_reports")
    .select("id, report_date, report_month, report_year, title, status, created_at")
    .eq("client_id", clientId)
    .order("report_date", { ascending: false })
    .limit(24);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ reports: data ?? [] });
}

// ── PATCH: Update report ──────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  let reportId: string;
  let sections: unknown;
  let title: string | undefined;
  let status: string | undefined;
  try {
    const body = await request.json();
    reportId = body.report_id;
    sections = body.sections;
    title = body.title;
    status = body.status;
    if (!reportId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { report_id }" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (sections) updates.sections = sections;
  if (title) updates.title = title;
  if (status) updates.status = status;

  const { error } = await supabase.from("client_reports").update(updates).eq("id", reportId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
