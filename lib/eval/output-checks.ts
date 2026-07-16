// X3 output-checks: de deterministische kwaliteitschecks op een finale deliverable. Deze
// checks vormen de kwaliteitshelft van de scorekaart (scorecard.ts) en zijn los herbruikbaar
// (bijv. als CI-regressie op een golden set). Hergebruik boven kopie: de grounding-check
// leunt op de F5-gespiegelde functies uit weekly-number-gate (spec-no-go: geen eigen kopie
// van de guard-logica). IO-vrij en los getest.

import { extractGroundedNumbers, gateUngroundedNumbers } from "@/lib/analysis/weekly-number-gate";

export interface EvalCheckResult {
  check: "grounding" | "structuur" | "purity" | "sanitization";
  passed: boolean;
  issues: string[]; // leeg bij passed; anders concrete, citeerbare bevindingen
}

// ── Check 1: grounding. Elk percentage of eurobedrag in de output moet herleidbaar zijn
// naar de aangeleverde grounding (de deterministische pre-compute die het model kreeg). ──
export function checkGrounding(outputText: string, groundingText: string): EvalCheckResult {
  const allowed = extractGroundedNumbers(groundingText);
  const gate = gateUngroundedNumbers(outputText, allowed);
  return {
    check: "grounding",
    passed: !gate.hadUngrounded,
    issues: gate.ungrounded.map((n) => `ongegrond cijfer in de output: ${n} (niet herleidbaar naar de aangeleverde data)`),
  };
}

// ── Check 2: structuur. De verplichte secties per sop-type moeten aanwezig zijn. De secties
// zijn config-gedreven omdat de deliverable-koppen per type en versie verschillen; de caller
// levert de eisen (bijv. uit de actuele template), met een neutrale default. ──
export const DEFAULT_REQUIRED_SECTIONS: Record<string, string[]> = {
  // Aanpasbaar per deliverable-versie; dit zijn de vaste ankers van de maand-deliverable.
  monthly: ["SOP Coverage Appendix"],
};

export function checkStructure(outputText: string, requiredSections: string[]): EvalCheckResult {
  const missing = requiredSections.filter((section) => !outputText.includes(section));
  return {
    check: "structuur",
    passed: missing.length === 0,
    issues: missing.map((s) => `verplichte sectie ontbreekt: "${s}"`),
  };
}

// ── Check 3: purity. Een beslisregel of aanbeveling mag geen dubbele conditie dragen
// ("als X en als Y..."): dat is onuitvoerbaar en was een bekende kwaliteitsfout. Detectie
// per zin: twee of meer conditie-starters in een zin is een dubbele conditie. ──
const CONDITION_WORDS = /\b(als|indien|wanneer|mits|tenzij)\b/gi;

export function checkPurity(outputText: string): EvalCheckResult {
  const sentences = outputText.split(/(?<=[.!?])\s+|\n+/);
  const issues: string[] = [];
  for (const sentence of sentences) {
    const matches = sentence.match(CONDITION_WORDS);
    if (matches && matches.length >= 2) {
      const trimmed = sentence.trim().slice(0, 140);
      issues.push(`dubbele conditie in een zin (${matches.length} conditiewoorden): "${trimmed}"`);
    }
  }
  return { check: "purity", passed: issues.length === 0, issues };
}

// ── Check 4: sanitization. Onafhankelijke verificatie dat de output vrij is van em- en
// en-dashes en bekende mojibake-sporen. sanitizeOutput hoort dit al te garanderen; het
// harnas controleert het zelfstandig, want een vangnet dat op zichzelf vertrouwt meet niks. ──
const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/\u2014/g, "em-dash"],
  [/\u2013/g, "en-dash"],
  [/\uFFFD/g, "replacement character (kapotte encoding)"],
  [/â€/g, "mojibake-spoor (â€)"],
  [/Ã[©¨«¯]/g, "mojibake-spoor (Ã-reeks)"],
];

export function checkSanitization(outputText: string): EvalCheckResult {
  const issues: string[] = [];
  for (const [pattern, label] of FORBIDDEN_PATTERNS) {
    const count = (outputText.match(pattern) ?? []).length;
    if (count > 0) issues.push(`${label}: ${count} voorkomen(s)`);
  }
  return { check: "sanitization", passed: issues.length === 0, issues };
}

// ── Alle vier in een keer, voor de scorekaart. ──
export function runOutputChecks(input: {
  outputText: string;
  groundingText: string;
  requiredSections: string[];
}): EvalCheckResult[] {
  return [
    checkGrounding(input.outputText, input.groundingText),
    checkStructure(input.outputText, input.requiredSections),
    checkPurity(input.outputText),
    checkSanitization(input.outputText),
  ];
}
