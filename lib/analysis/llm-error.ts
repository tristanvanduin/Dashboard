// ============================================================
// SEC3 (deel): classificatie van LLM-fouten voor graceful degradation
// ------------------------------------------------------------
// Typeert een fout uit de LLM-aanroep, bepaalt of opnieuw proberen zinvol is,
// en levert een Nederlandse gebruikersboodschap. Vervangt de fragiele
// string-matching retry-beslissing in callOpenRouter en geeft een getypeerd
// signaal dat een latere fallback-UI (read-only terugval) kan tonen.
//
// Pure functie, geen side effects.
// ============================================================

export type LLMErrorType =
  | "auth"
  | "permission"
  | "rate_limit"
  | "provider"
  | "network"
  | "timeout"
  | "bad_request"
  | "unknown";

export interface LLMErrorClassification {
  type: LLMErrorType;
  retryable: boolean;
  userMessage: string;
}

const MESSAGES: Record<LLMErrorType, string> = {
  auth: "Authenticatie bij de AI-provider mislukt. De analyse kan nu niet draaien.",
  permission: "Geen toegang bij de AI-provider voor deze aanvraag.",
  rate_limit: "De AI-provider is tijdelijk overbelast. Opnieuw proberen.",
  provider: "De AI-provider gaf een serverfout. Opnieuw proberen.",
  network: "Geen verbinding met de AI-provider. Opnieuw proberen.",
  timeout: "De analyse duurde te lang en is afgebroken. Opnieuw proberen.",
  bad_request: "De aanvraag werd door de AI-provider geweigerd.",
  unknown: "Er ging iets mis bij de AI-analyse.",
};

function build(type: LLMErrorType, retryable: boolean): LLMErrorClassification {
  return { type, retryable, userMessage: MESSAGES[type] };
}

/**
 * Classificeert een LLM-fout op type, retrybaarheid en gebruikersboodschap.
 * Niet-retrybaar: auth, permission, bad_request. De rest is retrybaar.
 */
export function classifyLLMError(error: unknown): LLMErrorClassification {
  const err = error instanceof Error ? error : new Error(String(error));
  const name = err.name || "";
  const msg = err.message || "";

  // Timeout: de fetch wordt via AbortController afgebroken bij de timeout.
  if (name === "AbortError" || /\baborted?\b|time?d? ?out/i.test(msg)) {
    return build("timeout", true);
  }

  // HTTP-status uit de boodschap "OpenRouter <status>: ...".
  const statusMatch = msg.match(/OpenRouter\s+(\d{3})/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 401) return build("auth", false);
    if (status === 403) return build("permission", false);
    if (status === 429) return build("rate_limit", true);
    if (status === 400 || status === 422) return build("bad_request", false);
    if (status >= 500 && status <= 599) return build("provider", true);
    if (status >= 400 && status <= 499) return build("bad_request", false);
  }

  // Netwerkfouten (fetch faalt voordat er een status is).
  if (
    name === "TypeError" ||
    /fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|socket hang up/i.test(msg)
  ) {
    return build("network", true);
  }

  // Onbekend: behoud het bestaande gedrag (retrybaar), maar getypeerd.
  return build("unknown", true);
}
