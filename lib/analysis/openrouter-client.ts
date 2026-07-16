/**
 * Shared OpenRouter client with retries, timeout, logging, and metadata tracking.
 *
 * Replaces the raw fetch calls in helpers.ts with a robust wrapper.
 */

import { fixMojibake } from "./sanitize";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2_000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface OpenRouterRequest {
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  /** Request JSON mode from the model */
  jsonMode?: boolean;
  /** Label for logging (e.g. "step-7-findings") */
  label?: string;
}

export interface OpenRouterResponse {
  output: string;
  model: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  retries: number;
  /** Whether the response was valid JSON (if jsonMode requested) */
  parseStatus: "ok" | "recovered" | "failed" | "not_json_mode";
}

interface RawApiResponse {
  id: string;
  model: string;
  choices: { message: { content: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ── Logging ────────────────────────────────────────────────────────────────

export interface CallLog {
  timestamp: string;
  label: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  retries: number;
  parseStatus: string;
  success: boolean;
  error?: string;
}

const callLogs: CallLog[] = [];

/** Get all logs from this process lifetime (useful for debugging/observability). */
export function getCallLogs(): readonly CallLog[] {
  return callLogs;
}

/** Get logs for the current analysis run (by label prefix). */
export function getRunLogs(prefix: string): CallLog[] {
  return callLogs.filter((l) => l.label.startsWith(prefix));
}

// ── Core client ────────────────────────────────────────────────────────────

export async function callOpenRouter(opts: OpenRouterRequest): Promise<OpenRouterResponse> {
  const {
    apiKey,
    systemPrompt,
    userMessage,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = 0.1,
    jsonMode = false,
    label = "unknown",
  } = opts;

  const body: Record<string, unknown> = {
    model: DEFAULT_MODEL,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  let lastError: Error | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://ranking-masters-dashboard.vercel.app",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${errText}`);
      }

      const data: RawApiResponse = await res.json();
      const rawOutput = data.choices?.[0]?.message?.content ?? "";
      const output = fixMojibake(rawOutput);
      const latencyMs = Date.now() - startTime;

      // Determine parse status
      let parseStatus: OpenRouterResponse["parseStatus"] = "not_json_mode";
      if (jsonMode) {
        try {
          JSON.parse(output.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
          parseStatus = "ok";
        } catch {
          parseStatus = "failed";
        }
      }

      const response: OpenRouterResponse = {
        output,
        model: data.model ?? DEFAULT_MODEL,
        tokensUsed: data.usage?.total_tokens ?? 0,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        latencyMs,
        retries,
        parseStatus,
      };

      // Log success
      callLogs.push({
        timestamp: new Date().toISOString(),
        label,
        model: response.model,
        tokensUsed: response.tokensUsed,
        latencyMs,
        retries,
        parseStatus,
        success: true,
      });

      // If JSON mode and parse failed, retry (up to MAX_RETRIES)
      if (jsonMode && parseStatus === "failed" && attempt < MAX_RETRIES) {
        retries++;
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      return response;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      lastError = err instanceof Error ? err : new Error(String(err));

      callLogs.push({
        timestamp: new Date().toISOString(),
        label,
        model: DEFAULT_MODEL,
        tokensUsed: 0,
        latencyMs,
        retries: attempt,
        parseStatus: "failed",
        success: false,
        error: lastError.message,
      });

      if (attempt < MAX_RETRIES) {
        retries++;

        // Don't retry on 4xx client errors (except 429 rate limit)
        if (lastError.message.includes("OpenRouter 4") && !lastError.message.includes("429")) {
          break;
        }

        await sleep(RETRY_DELAY_MS * (attempt + 1)); // exponential-ish backoff
        continue;
      }
    }
  }

  throw lastError ?? new Error(`OpenRouter call failed after ${MAX_RETRIES + 1} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
