// =====================================================================
// W1: landing-page en offer-audit. Pakt de final URLs van de ads in de best converterende
// ad-groepen, scant elke pagina op message match (deterministische claims plus het
// citaten-plichtige LLM-oordeel), en levert een markdown-audit per URL. Het degradatiepad
// staat vooraan: een pagina die niet leesbaar binnenkomt (bot-blokkade, JS-zwaar, leeg)
// wordt eerlijk gerapporteerd ZONDER LLM-call. LIVE-ONGETEST: vergt de sync-taak die
// google_ads_ad_meta en google_ads_rsa_assets vult (migratie 020) plus bereikbare paginas.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callRouted } from "@/lib/analysis/llm-router";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import { buildMessageMatchFacts, buildMessageMatchPrompt, MessageMatchSchema, type MessageMatchFacts, type MessageMatchJudgement } from "@/lib/analysis/landing-message-match";
import { extractPageText } from "@/lib/analysis/page-extract";
import { saveLandingAuditHypotheses, type LandingAuditItem } from "@/lib/analysis/standalone-to-hypotheses";

const SECTION = "landing_audit_v1";
const SOP_TYPE = "landing_audit";
const DEFAULT_MAX_PAGES = 3;
const TOP_AD_GROUPS = 5;
const PAGE_EXCERPT_CHARS = 4000;
const FETCH_TIMEOUT_MS = 10000;

interface UrlAuditResult {
  url: string;
  adGroupName: string | null;
  headlines: string[];
  status: "pagina_niet_leesbaar" | "match_beoordeeld" | "oordeel_mislukt";
  facts: MessageMatchFacts | null;
  judgement: MessageMatchJudgement | null;
  reason: string | null;
}

function stripFences(text: string): string {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

async function fetchPageHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RankingMastersAudit/1.0)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function renderAuditMarkdown(results: UrlAuditResult[], analysisMonth: string): string {
  const lines: string[] = [`# Landing-page en offer-audit`, "", `Basis: de ads in de best converterende ad-groepen van ${analysisMonth}.`, ""];
  for (const r of results) {
    lines.push(`## ${r.url}`);
    lines.push("");
    lines.push(`Ad-groep: ${r.adGroupName ?? "onbekend"}. Headlines in de ads: ${r.headlines.slice(0, 5).map((h) => `"${h}"`).join(", ")}.`);
    lines.push("");
    if (r.status === "pagina_niet_leesbaar") {
      lines.push(`**Pagina niet leesbaar.** ${r.reason}`);
      lines.push("");
      continue;
    }
    if (r.facts && r.facts.status === "leesbaar") {
      lines.push(`Deterministisch: ${r.facts.coveragePct}% van de ad-claims komt terug op de pagina${r.facts.priceMismatch ? "; LET OP: de PRIJS in de ad wijkt af van de pagina" : ""}. Kop-overlap ${Math.round(r.facts.h1Overlap.ratio * 100)}%.`);
      lines.push("");
      for (const check of r.facts.claims) {
        lines.push(`- [${check.status}] ${check.claim.type}: "${check.claim.normalized}"${check.evidence ? ` (${check.evidence.slice(0, 120)})` : ""}`);
      }
      lines.push("");
    }
    if (r.status === "match_beoordeeld" && r.judgement) {
      lines.push(`**Match-oordeel: ${r.judgement.overall_score} van 10.** Grootste gap: ${r.judgement.grootste_gap}`);
      lines.push("");
      for (const j of r.judgement.oordeel_per_claim) {
        lines.push(`- ${j.oordeel}: "${j.claim}". Ad: "${j.citaat_ad.slice(0, 100)}"${j.citaat_pagina ? `. Pagina: "${j.citaat_pagina.slice(0, 100)}"` : ""}`);
      }
      lines.push("");
      lines.push(`Aanbeveling: ${r.judgement.aanbeveling}`);
      lines.push("");
    } else if (r.status === "oordeel_mislukt") {
      lines.push(`**Het match-oordeel mislukte** (${r.reason}); de deterministische bevindingen hierboven staan wel vast.`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });
  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  let body: { client_id?: string; max_pages?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Verwacht JSON-body" }, { status: 400 });
  }
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  const maxPages = typeof body.max_pages === "number" && body.max_pages > 0 ? Math.floor(body.max_pages) : DEFAULT_MAX_PAGES;

  // ── 1. De best converterende ad-groepen uit de laatste maand keyword-data. ──
  const { data: keywordRows, error: keywordError } = await supabase
    .from("ads_keyword_performance_monthly")
    .select("month, campaign_name, ad_group_name, conversions")
    .eq("client_id", clientId)
    .order("month", { ascending: false })
    .limit(4000);
  if (keywordError) return Response.json({ error: `Keyword-data laden faalde: ${keywordError.message}` }, { status: 500 });
  if (!keywordRows || keywordRows.length === 0) return Response.json({ error: "Geen keyword-data voor deze klant" }, { status: 404 });

  const latestMonth = String(keywordRows[0].month).slice(0, 7);
  const conversionsByGroup = new Map<string, number>();
  for (const row of keywordRows) {
    if (String(row.month).slice(0, 7) !== latestMonth) continue;
    const key = row.ad_group_name as string;
    if (!key) continue;
    conversionsByGroup.set(key, (conversionsByGroup.get(key) ?? 0) + Number(row.conversions ?? 0));
  }
  const topGroups = [...conversionsByGroup.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_AD_GROUPS).map(([name]) => name);
  if (topGroups.length === 0) return Response.json({ error: "Geen ad-groepen met data in de laatste maand" }, { status: 404 });

  // ── 2. De final URLs van de ads in die groepen, plus hun copy. ──
  const [{ data: adMeta }, { data: assetRows }] = await Promise.all([
    supabase.from("google_ads_ad_meta").select("ad_id, ad_group_name, final_url").eq("client_id", clientId).in("ad_group_name", topGroups),
    supabase.from("google_ads_rsa_assets").select("ad_id, field_type, asset_text, impressions, month").eq("client_id", clientId),
  ]);
  const urlToAds = new Map<string, { adGroupName: string | null; adIds: string[] }>();
  for (const groupName of topGroups) {
    for (const meta of (adMeta ?? []).filter((m) => m.ad_group_name === groupName)) {
      const url = (meta.final_url as string | null)?.trim();
      if (!url) continue;
      const entry = urlToAds.get(url) ?? { adGroupName: groupName, adIds: [] };
      entry.adIds.push(meta.ad_id as string);
      urlToAds.set(url, entry);
    }
  }
  if (urlToAds.size === 0) {
    return Response.json({ error: "Geen final URLs gevonden; de sync op google_ads_ad_meta (migratie 020) moet eerst vullen" }, { status: 404 });
  }

  const copyForAds = (adIds: string[]) => {
    const relevant = (assetRows ?? []).filter((a) => adIds.includes(a.ad_id as string) && String(a.month).slice(0, 7) === latestMonth);
    const pick = (fieldType: string, top: number) =>
      [...new Map(relevant.filter((a) => a.field_type === fieldType).sort((a, b) => Number(b.impressions ?? 0) - Number(a.impressions ?? 0)).map((a) => [String(a.asset_text).trim().toLowerCase(), String(a.asset_text)])).values()].slice(0, top);
    return { headlines: pick("HEADLINE", 8), descriptions: pick("DESCRIPTION", 4) };
  };

  // ── 3. Per unieke URL: fetch, extract, facts, en het pad. ──
  const analysisDate = new Date().toISOString().split("T")[0];
  const results: UrlAuditResult[] = [];
  for (const [url, { adGroupName, adIds }] of [...urlToAds.entries()].slice(0, maxPages)) {
    const { headlines, descriptions } = copyForAds(adIds);
    const html = await fetchPageHtml(url);
    const page = extractPageText(html);
    const facts = buildMessageMatchFacts({ headlines, descriptions, pageText: page.text, h1: page.h1 });

    if (facts.status === "pagina_niet_leesbaar") {
      results.push({ url, adGroupName, headlines, status: "pagina_niet_leesbaar", facts, judgement: null, reason: facts.reason });
      continue;
    }
    if (headlines.length === 0 && descriptions.length === 0) {
      results.push({ url, adGroupName, headlines, status: "oordeel_mislukt", facts, judgement: null, reason: "geen ad-copy in de asset-data voor deze ads" });
      continue;
    }

    const prompt = buildMessageMatchPrompt({
      adCopy: `HEADLINES:\n${headlines.map((h) => `- ${h}`).join("\n")}\nDESCRIPTIONS:\n${descriptions.map((d) => `- ${d}`).join("\n")}`,
      pageExcerpt: page.text.slice(0, PAGE_EXCERPT_CHARS),
      facts,
    });

    let judgement: MessageMatchJudgement | null = null;
    let lastIssues = "";
    for (let attempt = 0; attempt < 2 && !judgement; attempt += 1) {
      const suffix = attempt === 0 ? "" : `\n\nJe vorige antwoord voldeed niet aan het schema: ${lastIssues}. Antwoord UITSLUITEND met het gecorrigeerde JSON-object.`;
      const response = await callRouted({
        apiKey,
        systemPrompt: prompt.system,
        userMessage: prompt.user + suffix,
        maxTokens: 4096,
        jsonMode: true,
        temperature: 0,
        label: "landing-audit",
      });
      void recordUsage(supabase, {
        runKey: `landing-audit-${clientId}-${analysisDate}`,
        clientId,
        channel: "google_ads",
        sopType: SOP_TYPE,
        stepLabel: "Landing audit",
        model: response.model,
        promptTokens: response.promptTokens ?? 0,
        completionTokens: response.completionTokens ?? 0,
      });
      try {
        const parsed = MessageMatchSchema.safeParse(JSON.parse(stripFences(response.output)));
        if (parsed.success) judgement = parsed.data;
        else lastIssues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      } catch {
        lastIssues = "geen geldige JSON";
      }
    }

    results.push(
      judgement
        ? { url, adGroupName, headlines, status: "match_beoordeeld", facts, judgement, reason: null }
        : { url, adGroupName, headlines, status: "oordeel_mislukt", facts, judgement: null, reason: lastIssues || "oordeel niet geldig na een repair" }
    );
  }

  // ── 4. Render, opslag, response. ──
  const markdown = renderAuditMarkdown(results, latestMonth);
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId,
      sop_type: SOP_TYPE,
      analysis_date: analysisDate,
      period_start: `${latestMonth}-01`,
      period_end: `${latestMonth}-01`,
      section: SECTION,
      output: markdown,
      model_used: "router",
      tokens_used: 0,
      step_number: 1,
      step_name: "Landing audit",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  // Voed de goedkeuringswachtrij: prijsafwijkingen en lage match-scores tot één voorstel.
  const auditItems: LandingAuditItem[] = results.map((r) => ({
    url: r.url,
    readable: r.facts?.status === "leesbaar",
    priceMismatch: r.facts?.status === "leesbaar" ? r.facts.priceMismatch : false,
    overallScore: r.judgement?.overall_score ?? null,
    grootsteGap: r.judgement?.grootste_gap ?? null,
  }));
  await saveLandingAuditHypotheses(supabase, auditItems, { clientId, analysisId: null });

  return Response.json({
    markdown,
    paginas: results.length,
    beoordeeld: results.filter((r) => r.status === "match_beoordeeld").length,
    niet_leesbaar: results.filter((r) => r.status === "pagina_niet_leesbaar").length,
  });
}
