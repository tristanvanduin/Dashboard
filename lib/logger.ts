// Gedeelde, niveau-bewuste logger. Routeert onder water naar console, maar geeft een
// consistent formaat, een instelbaar minimumniveau (LOG_LEVEL) en een scope-prefix via
// child(). Vervangt verspreide console.error/console.warn-aanroepen door een enkel
// controlepunt, zodat logging te leveln en te filteren is.

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveMinLevel(): LogLevel {
  const raw = typeof process !== "undefined" ? process.env.LOG_LEVEL : undefined;
  const env = raw ? raw.toLowerCase() : undefined;
  if (env === "debug" || env === "info" || env === "warn" || env === "error") return env;
  return "info";
}

let minLevel: LogLevel = resolveMinLevel();

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function getLogLevel(): LogLevel {
  return minLevel;
}

function enabled(level: LogLevel): boolean {
  return ORDER[level] >= ORDER[minLevel];
}

function emit(level: LogLevel, scope: string | undefined, args: unknown[]): void {
  if (!enabled(level)) return;
  const prefix = scope ? `[${level.toUpperCase()}][${scope}]` : `[${level.toUpperCase()}]`;
  const line = [prefix, ...args];
  if (level === "error") console.error(...line);
  else if (level === "warn") console.warn(...line);
  else console.log(...line);
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(scope: string): Logger;
}

function make(scope?: string): Logger {
  return {
    debug: (...args: unknown[]) => emit("debug", scope, args),
    info: (...args: unknown[]) => emit("info", scope, args),
    warn: (...args: unknown[]) => emit("warn", scope, args),
    error: (...args: unknown[]) => emit("error", scope, args),
    child: (childScope: string) => make(scope ? `${scope}:${childScope}` : childScope),
  };
}

export const logger: Logger = make();
