// W1.4 (Z1): een run-scoped gestructureerde logger bovenop de bestaande niveau-logger.
// Verschil met lib/logger.ts: verplichte run-context (run_key, client_id, channel) en een
// gestructureerd JSON-record per regel, zodat een run achteraf reconstrueerbaar is zonder
// console-archeologie. createRunLogger faalt zonder run_key (spec-test). De recordbouw en
// de secret-redactie zijn puur en los getest; de emit en de Sentry-hook zijn de IO-rand.
//
// No-go uit de spec: geen tokens, secrets of volledige LLM-prompts op info-niveau. De
// redactie hieronder dekt velden die daar duidelijk naar heten; het blijft de
// verantwoordelijkheid van de aanroeper om geen ruwe prompt als los veld mee te geven.

import { getLogLevel, type LogLevel } from "@/lib/logger";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface RunLogContext {
  run_key: string;
  client_id?: string;
  channel?: string;
}

export interface LogRecord {
  level: LogLevel;
  ts: string;
  run_key: string;
  client_id?: string;
  channel?: string;
  step?: string;
  msg: string;
  [extra: string]: unknown;
}

const REDACT_PATTERN = /(token|secret|api[_-]?key|password|authorization|access[_-]?key)/i;
const REDACTED = "[REDACTED]";

// Vervangt waarden van velden die op een secret lijken door een placeholder. Puur.
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACT_PATTERN.test(key)) {
      out[key] = REDACTED;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactFields(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// Bouwt het gestructureerde record. Puur: geen IO, deterministisch bij een gegeven now.
export function buildLogRecord(
  level: LogLevel,
  context: RunLogContext,
  msg: string,
  fields: Record<string, unknown> = {},
  now: Date = new Date()
): LogRecord {
  const safe = redactFields(fields);
  return {
    level,
    ts: now.toISOString(),
    run_key: context.run_key,
    ...(context.client_id ? { client_id: context.client_id } : {}),
    ...(context.channel ? { channel: context.channel } : {}),
    ...safe,
    msg,
  };
}

export interface RunLogger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

// Optionele Sentry-doorgifte; alleen actief als SENTRY_DSN gezet is en de global aanwezig.
// LIVE-ONGETEST: vergt de echte Sentry-integratie.
function toSentry(record: LogRecord): void {
  if (!process.env.SENTRY_DSN) return;
  const sentry = (globalThis as { Sentry?: { captureMessage?: (m: string, level?: string) => void } }).Sentry;
  if (record.level === "warn" || record.level === "error") {
    sentry?.captureMessage?.(record.msg, record.level);
  }
}

// Maakt een logger gebonden aan een run. FAALT zonder run_key: een regel zonder run-sleutel
// is niet reconstrueerbaar en dus een programmeerfout.
export function createRunLogger(context: RunLogContext): RunLogger {
  if (!context.run_key) {
    throw new Error("createRunLogger vereist een run_key");
  }

  function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (ORDER[level] < ORDER[getLogLevel()]) return;
    const record = buildLogRecord(level, context, msg, fields);
    const line = JSON.stringify(record);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    toSentry(record);
  }

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
