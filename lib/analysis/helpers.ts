import { recordUsage, channelFromSopType } from "@/lib/analysis/o2-targets-cost";
/**
 * Shared helpers for the /api/analysis/* routes.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConversionActions, type GoogleAdsCredentials } from "../api/google-ads";
import { mergeConversionActionsWithLiveStatus } from "../client-settings";
import {
  buildGoalsSection,
  determineAccountType,
  type AccountType,
} from "../prompts/sop-prompts";
import { type OpenRouterResponse } from "./openrouter-client";
import { callRouted } from "./llm-router";

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
  /** W1.1: het ruwe goals-config-object, zodat de route de goalsSection kan herbouwen met een plausibiliteits-flag. */
  goalsConfig?: Record<string, unknown>;
}

function getGoogleAdsCredentials(): GoogleAdsCredentials | null {
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

async function getCustomerId(supabase: SupabaseClient, clientId: string): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "api_clients")
    .maybeSingle();

  if (!data?.value || !Array.isArray(data.value)) return null;
  const client = (data.value as Array<{ id: string; googleAdsCustomerId?: string }>).find((c) => c.id === clientId);
  return client?.googleAdsCustomerId ?? null;
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
    const storedActions = Array.isArray(cs.conversion_actions)
      ? (cs.conversion_actions as Array<Record<string, unknown>>).map((action) => ({
          id: String(action.id ?? ""),
          name: String(action.name ?? ""),
          category: action.category === "primary" ? "primary" as const : "secondary" as const,
          activeInAds: Boolean(action.activeInAds ?? true),
          includedInDashboard: Boolean(action.includedInDashboard),
        }))
      : [];

    let effectiveActions = storedActions;
    const credentials = getGoogleAdsCredentials();
    const customerId = credentials ? await getCustomerId(supabase, clientId) : null;
    if (credentials && customerId) {
      try {
        const liveActions = await getConversionActions(credentials, customerId);
        effectiveActions = mergeConversionActionsWithLiveStatus(storedActions, liveActions);
      } catch {
        // Keep stored settings if live refresh is unavailable.
      }
    }

    const primaryAction = effectiveActions.find(
      (action) => action.category === "primary" && action.includedInDashboard
    );

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
      goalsConfig: { ...config, accountType },
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
      goalsConfig: { ...config, accountType },
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
    goalsConfig: { ...config, accountType },
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
    created_at?: string;
  };
  select?: string;
  refreshCreatedAt?: boolean;
}

export function prepareAnalysisOutputSaveRow<T extends SaveAnalysisOutputSectionInput["row"]>(
  row: T,
  refreshCreatedAt = false
): T {
  return (refreshCreatedAt
    ? { ...row, created_at: new Date().toISOString() }
    : row) as T;
}

export async function saveAnalysisOutputSection(opts: SaveAnalysisOutputSectionInput) {
  const row = prepareAnalysisOutputSaveRow(opts.row, opts.refreshCreatedAt);
  const query = opts.supabase
    .from("sop_analysis_output")
    .upsert(row, {
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

  const response = await callRouted({
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
  /** W1.1: run-sleutel (jobId) voor de llm_usage-kostenregistratie; zonder runKey wordt niets gelogd. */
  runKey?: string;
  /** W1.1: kanaal voor de kostenregistratie; valt terug op channelFromSopType. */
  channel?: string;
  /** X3: als gezet, wordt de exacte prompt-payload als fixture weggeschreven voor replay. */
  evalCapture?: { fixtureSet: string } | null;
  /** X3: de soort aanroep voor de fixture; replay speelt standaard alleen "step". */
  evalKind?: "step" | "checkpoint" | "repair";
}): Promise<StepResult> {
  const { supabase, apiKey, clientId, sopType, systemPrompt, userMessage, periodStart, periodEnd, stepNumber, stepName, jsonMode } = opts;
  const analysisDate = new Date().toISOString().split("T")[0];

  // X3 fixture-capture: de exacte system- en user-prompt wegschrijven VOOR de call, zodat de
  // fixture er ook is als de call faalt. Capture mag de analyse-run nooit breken.
  if (opts.evalCapture?.fixtureSet && opts.runKey) {
    try {
      await supabase.from("eval_fixtures").insert({
        fixture_set: opts.evalCapture.fixtureSet,
        run_key: opts.runKey,
        step: stepNumber,
        payload: { systemPrompt, userMessage, stepName, sopType, jsonMode: jsonMode ?? false, kind: opts.evalKind ?? "step" },
      });
    } catch (captureError) {
      console.warn("[eval] fixture-capture faalde (de run gaat door):", captureError);
    }
  }

  const response = await callRouted({
    apiKey,
    systemPrompt,
    userMessage,
    maxTokens: jsonMode ? 8192 : 4096,
    jsonMode,
    label: `${sopType}-step-${stepNumber}-${stepName.toLowerCase().replace(/\s+/g, "-")}`,
  });

  if (opts.runKey) {
    void recordUsage(supabase, {
      runKey: opts.runKey,
      clientId,
      channel: opts.channel ?? channelFromSopType(sopType),
      sopType,
      stepLabel: stepName,
      model: response.model,
      promptTokens: response.promptTokens ?? 0,
      completionTokens: response.completionTokens ?? 0,
    });
  }

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
