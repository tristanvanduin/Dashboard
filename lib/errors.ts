// Gedeelde foutbasis. Geeft domeinfouten een stabiele categorie voor classificatie,
// retrybaarheid en nette logging. Complementair aan lib/analysis/llm-error.ts, dat de
// LLM-specifieke classificatie doet; AppError is de algemene basis voor de rest.

export type ErrorCategory =
  | "validation"
  | "not_found"
  | "auth"
  | "permission"
  | "rate_limit"
  | "provider"
  | "network"
  | "timeout"
  | "bad_request"
  | "internal"
  | "unknown";

export interface AppErrorOptions {
  category?: ErrorCategory;
  cause?: unknown;
  context?: Record<string, unknown>;
  retryable?: boolean;
}

export class AppError extends Error {
  readonly category: ErrorCategory;
  readonly context?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.category = options.category ?? "unknown";
    this.context = options.context;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) {
      // Bewaar de oorspronkelijke fout zonder de native cause-typing af te dwingen.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

// Haalt een leesbare boodschap uit een onbekende worp, voor logging en UI.
export function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
