// ============================================================
// SEC1: data-sanitization voor LLM-payloads
// ------------------------------------------------------------
// Weert wat nooit naar een LLM mag (secrets) en maskeert PII (e-mails) uit de
// payload-tekst voordat die naar de provider gaat, en geeft een rapport terug
// dat de audit-log (SEC4) kan vastleggen.
//
// Bewust chirurgisch: campagne-, zoekterm- en productnamen blijven staan, omdat
// de analyse die nodig heeft en ze in de output terugkomen (zie shared-grounding:
// de aangeleverde data is de waarheid). Een blanco PII-tokenisatie zou de
// analyse breken. Daarom alleen ondubbelzinnige doelen: secrets en e-mails.
//
// Pure functie, geen side effects. Wordt aangeroepen op het ene chokepoint
// (callOpenRouter), zodat elke LLM-call gedekt is.
// ============================================================

export interface SanitizationHit {
  category: "secret" | "email" | "custom";
  name: string;
  count: number;
}

export interface SanitizationReport {
  clean: boolean;
  redactedSecrets: number;
  maskedEmails: number;
  hits: SanitizationHit[];
}

export interface SanitizeOptions {
  maskEmails?: boolean; // standaard true
  extraPatterns?: { name: string; regex: RegExp; replacement: string }[];
}

// Secret-toewijzing eerst: behoud de sleutelnaam, redigeer de waarde.
// Bijv. "api_key: sk-abc..." wordt "api_key: [REDACTED_SECRET]".
const SECRET_ASSIGNMENT =
  /(\b(?:api[_-]?key|apikey|secret|token|password|passwd|authorization|auth[_-]?token)\b["']?\s*[:=]\s*)(["']?)([A-Za-z0-9._\-]{12,})(["']?)/gi;

// Daarna losse, hoog-entropische secret-tokens.
const SECRET_TOKEN_RULES: { name: string; regex: RegExp; replacement: string }[] = [
  { name: "openai_openrouter_key", regex: /\bsk-(?:or-v1-)?[A-Za-z0-9]{20,}\b/g, replacement: "[REDACTED_SECRET]" },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: "[REDACTED_SECRET]" },
  { name: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_SECRET]" },
  { name: "bearer_token", regex: /\bBearer\s+[A-Za-z0-9._\-]{20,}/g, replacement: "Bearer [REDACTED_SECRET]" },
];

const EMAIL = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

/**
 * Saneert een payload-tekst: redigeert secrets en (optioneel) maskeert e-mails.
 * Geeft de gesaneerde tekst plus een rapport van wat is geredigeerd.
 */
export function sanitizeLLMPayload(
  text: string,
  opts: SanitizeOptions = {}
): { sanitized: string; report: SanitizationReport } {
  if (typeof text !== "string" || text.length === 0) {
    return { sanitized: text, report: { clean: true, redactedSecrets: 0, maskedEmails: 0, hits: [] } };
  }

  const maskEmails = opts.maskEmails !== false;
  const hits: SanitizationHit[] = [];
  let redactedSecrets = 0;
  let maskedEmails = 0;
  let out = text;

  // 1. Secret-toewijzingen (behoud sleutel, redigeer waarde).
  {
    let n = 0;
    out = out.replace(SECRET_ASSIGNMENT, (_m, pre, q1, _val, q2) => {
      n++;
      return `${pre}${q1}[REDACTED_SECRET]${q2}`;
    });
    if (n > 0) { hits.push({ category: "secret", name: "secret_assignment", count: n }); redactedSecrets += n; }
  }

  // 2. Losse secret-tokens.
  for (const rule of SECRET_TOKEN_RULES) {
    let n = 0;
    out = out.replace(rule.regex, () => { n++; return rule.replacement; });
    if (n > 0) { hits.push({ category: "secret", name: rule.name, count: n }); redactedSecrets += n; }
  }

  // 3. E-mails.
  if (maskEmails) {
    let n = 0;
    out = out.replace(EMAIL, () => { n++; return "[EMAIL]"; });
    if (n > 0) { hits.push({ category: "email", name: "email", count: n }); maskedEmails += n; }
  }

  // 4. Optionele extra-patronen (bijv. strengere RAI-regels later).
  if (opts.extraPatterns) {
    for (const p of opts.extraPatterns) {
      let n = 0;
      out = out.replace(p.regex, () => { n++; return p.replacement; });
      if (n > 0) hits.push({ category: "custom", name: p.name, count: n });
    }
  }

  return {
    sanitized: out,
    report: { clean: hits.length === 0, redactedSecrets, maskedEmails, hits },
  };
}
