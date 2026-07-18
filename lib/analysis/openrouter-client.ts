/**
 * Shared OpenRouter client with retries, timeout, logging, and metadata tracking.
 *
 * Replaces the raw fetch calls in helpers.ts with a robust wrapper.
 */

import { fixMojibake } from "./sanitize";
import { sanitizeLLMPayload } from "../security/sanitize-llm-payload";
import { classifyLLMError, type LLMErrorClassification } from "./llm-error";
import { logger } from "@/lib/logger";

// LLM-endpoint. Default: Google's OpenAI-compatibele Gemini-endpoint (zelfde chat-completions-
// formaat als OpenRouter, dus de client hieronder blijft ongewijzigd). Override via LLM_BASE_URL
// als je terug wilt naar OpenRouter of een andere OpenAI-compatibele provider.
const OPENROUTER_BASE = process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-3-flash-preview";
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
  /** M3: optionele afbeelding (base64) voor multimodale calls; laat het tekstpad ongemoeid. */
  imageBase64?: string;
  imageMediaType?: string;
  /** Label for logging (e.g. "step-7-findings") */
  label?: string;
  /** Override het model voor deze call (de router zet dit; default DEFAULT_MODEL) */
  model?: string;
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
    model = DEFAULT_MODEL,
  } = opts;

  // SEC1: weer secrets en maskeer PII voordat de payload naar de provider gaat.
  // Dit is het ene chokepoint, dus elke LLM-call is gedekt.
  const sysSan = sanitizeLLMPayload(systemPrompt ?? "");
  const userSan = sanitizeLLMPayload(userMessage ?? "");
  if (!sysSan.report.clean || !userSan.report.clean) {
    const secrets = sysSan.report.redactedSecrets + userSan.report.redactedSecrets;
    const emails = sysSan.report.maskedEmails + userSan.report.maskedEmails;
    logger.warn(`[security] LLM-payload gesaneerd (${label}): secrets=${secrets}, emails=${emails}`);
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: "system", content: sysSan.sanitized },
      {
        role: "user",
        content: opts.imageBase64
          ? [
              { type: "text", text: userSan.sanitized },
              { type: "image_url", image_url: { url: `data:${opts.imageMediaType ?? "image/jpeg"};base64,${opts.imageBase64}` } },
            ]
          : userSan.sanitized,
      },
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

        // SEC3: getypeerde retry-beslissing in plaats van string-matching.
        // Niet-retrybaar (auth, permission, bad_request) stopt direct.
        if (!classifyLLMError(lastError).retryable) {
          break;
        }

        await sleep(RETRY_DELAY_MS * (attempt + 1)); // exponential-ish backoff
        continue;
      }
    }
  }

  const finalError = lastError ?? new Error(`OpenRouter call failed after ${MAX_RETRIES + 1} attempts`);
  // SEC3: hang de getypeerde classificatie aan de fout voor een fallback-laag.
  (finalError as Error & { llmError?: LLMErrorClassification }).llmError = classifyLLMError(finalError);
  throw finalError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
