// H1-schakel: van vrije tekst naar predicaat. De hypotheses in sprint_hypotheses zijn door
// een LLM geschreven en volledig vrij van vorm (hypothesis, expected_result,
// measurement_metric en timeframe zijn alle vier strings). De evaluator
// (evaluateHypothesisOutcome) werkt daarentegen op een strikt Predicate-contract. Deze
// parser is de ontbrekende schakel die H1 wireable maakt.
//
// De harde regel: BIJ TWIJFEL NIETS. Een hypothese die niet eenduidig te parsen is levert
// null met een reden, waarna de evaluator hem als onmeetbaar rapporteert. Een gegokt
// predicaat is erger dan geen predicaat, want het levert een verdict waar niemand op kan
// vertrouwen. Deze parser raadt daarom nooit de richting uit de metric alleen.

import type { Predicate } from "./hypothesis-evaluator";

// De canonieke metric-sleutels waar baseline en measured op ingaan.
const METRIC_ALIASES: Array<[RegExp, string]> = [
  [/\b(cpa|kosten per (acquisitie|conversie)|cost per (acquisition|conversion))\b/i, "cpa"],
  [/\broas\b/i, "roas"],
  [/\bctr\b|\bclick.?through\b|\bdoorklikratio\b/i, "ctr"],
  [/\bcpc\b|\bkosten per klik\b|\bcost per click\b/i, "cpc"],
  [/\b(conversieratio|conversion rate|cvr)\b/i, "conversion_rate"],
  [/\b(conversies|conversions)\b/i, "conversions"],
  [/\b(impressie.?aandeel|impression share|zoekaandeel)\b/i, "impression_share"],
  [/\b(impressies|impressions|vertoningen)\b/i, "impressions"],
  [/\b(klikken|clicks)\b/i, "clicks"],
  [/\b(kosten|spend|uitgaven)\b/i, "cost"],
  [/\b(omzet|revenue|conversiewaarde)\b/i, "conversions_value"],
];

// Richtingwoorden. Absolute grenzen (onder, boven) gaan VOOR relatieve richtingen, want
// "CPA onder 25" is een grens en geen daling.
const ABSOLUTE_PATTERNS: Array<[RegExp, "above" | "below"]> = [
  [/\b(onder|below|minder dan|lager dan|maximaal|hooguit|max\.?)\b/i, "below"],
  [/\b(boven|above|meer dan|hoger dan|minimaal|minstens|min\.?)\b/i, "above"],
];
const RELATIVE_PATTERNS: Array<[RegExp, "increase" | "decrease" | "stable"]> = [
  [/\b(daalt|dalen|daling|lager|omlaag|afname|afnemen|verlagen|verlaging|reduceren|minder)\b/i, "decrease"],
  [/\b(stijgt|stijgen|stijging|hoger|omhoog|toename|toenemen|verhogen|verhoging|groeit|groei|meer)\b/i, "increase"],
  [/\b(stabiel|gelijk blijven|gelijk blijft|onveranderd|niet (verslechtert|daalt|stijgt))\b/i, "stable"],
];

export interface ParsedHypothesis {
  predicate: Predicate;
  windowDays: number | null; // null als het tijdvenster niet te bepalen is
  // UNIT-VAL: de evaluator leest threshold bij increase, decrease en stable als een
  // ABSOLUTE magnitude ((b - m) >= threshold), niet als een fractie. Een tekst als "daalt
  // met 15%" is echter relatief, en de parser kent de baseline niet. Daarom reist de
  // relatieve eis hier apart mee en zet resolvePredicate hem om zodra de baseline bekend
  // is. Zonder die stap zou "15%" als 0,15 euro gelezen worden en zou elke daling van een
  // paar cent als geslaagd gelden.
  relativeThreshold?: number; // fractie, bijvoorbeeld 0,15 voor vijftien procent
}

// Zet de relatieve eis om naar de absolute magnitude die de evaluator verwacht. Zonder
// relatieve eis of zonder bruikbare baseline blijft het predicaat ongewijzigd.
export function resolvePredicate(parsed: ParsedHypothesis, baseline: Record<string, number>): Predicate {
  if (parsed.relativeThreshold == null) return parsed.predicate;
  const base = baseline[parsed.predicate.metric];
  if (typeof base !== "number" || !Number.isFinite(base) || base === 0) return parsed.predicate;
  return { ...parsed.predicate, threshold: Math.abs(base) * parsed.relativeThreshold };
}

export type ParseResult = { ok: true; parsed: ParsedHypothesis } | { ok: false; reason: string };

export function normalizeMetric(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const [pattern, canonical] of METRIC_ALIASES) {
    if (pattern.test(raw)) return canonical;
  }
  return null;
}

// De drempel. Een percentage is RELATIEF (0,15 voor vijftien procent), een bedrag of getal
// bij een absolute grens is de waarde zelf. De eerste match wint; zonder getal is er geen
// drempel, wat voor increase en decrease is toegestaan (dan telt elke beweging).
export function extractRelativeThreshold(text: string, direction: Predicate["direction"]): number | undefined {
  if (direction !== "increase" && direction !== "decrease" && direction !== "stable") return undefined;
  const percent = text.match(/(\d+(?:[.,]\d+)?)\s?%/);
  return percent ? Number.parseFloat(percent[1].replace(",", ".")) / 100 : undefined;
}

// De absolute grens bij above en below. Die leest de evaluator wel direct.
export function extractThreshold(text: string, direction: Predicate["direction"]): number | undefined {
  if (direction === "above" || direction === "below") {
    const amount = text.match(/(?:€|£|\$)\s?(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s?(?:euro|procent|%)?/i);
    if (amount) {
      const value = amount[1] ?? amount[2];
      if (value) return Number.parseFloat(value.replace(",", "."));
    }
  }
  return undefined;
}

// Het meetvenster uit vrije tekst. Alleen eenduidige vormen; een kwartaal- of
// campagnelabel levert null en de evaluator gebruikt dan zijn eigen verloopregel.
export function parseWindowDays(timeframe: string | null | undefined): number | null {
  if (!timeframe) return null;
  const weeks = timeframe.match(/(\d+)\s*(weken|week|weeks)/i);
  if (weeks) return Number.parseInt(weeks[1], 10) * 7;
  const days = timeframe.match(/(\d+)\s*(dagen|dag|days|day)/i);
  if (days) return Number.parseInt(days[1], 10);
  const months = timeframe.match(/(\d+)\s*(maanden|maand|months|month)/i);
  if (months) return Number.parseInt(months[1], 10) * 30;
  if (/\b(een|1)\s*(maand|month)\b/i.test(timeframe)) return 30;
  return null;
}

function detectDirection(text: string): Predicate["direction"] | null {
  for (const [pattern, direction] of ABSOLUTE_PATTERNS) {
    if (pattern.test(text)) return direction;
  }
  for (const [pattern, direction] of RELATIVE_PATTERNS) {
    if (pattern.test(text)) return direction;
  }
  return null;
}

// De hoofdfunctie. Faalt eerlijk met een reden zodra iets niet eenduidig is.
export function parseHypothesis(input: {
  expectedResult: string | null;
  measurementMetric: string | null;
  timeframe: string | null;
}): ParseResult {
  const expected = (input.expectedResult ?? "").trim();
  if (expected.length === 0) return { ok: false, reason: "geen verwacht resultaat vastgelegd, dus er valt niets te toetsen" };

  // De metric komt bij voorkeur uit het aparte veld; anders uit de verwachting zelf.
  const metric = normalizeMetric(input.measurementMetric) ?? normalizeMetric(expected);
  if (!metric) {
    return { ok: false, reason: `de meetmetric is niet herkend (${input.measurementMetric ?? "leeg"}); zonder canonieke metric is er geen baseline om tegen te meten` };
  }

  const direction = detectDirection(expected);
  if (!direction) {
    return { ok: false, reason: `de richting is niet af te leiden uit "${expected.slice(0, 60)}"; zonder richting is elk verdict een gok` };
  }

  const threshold = extractThreshold(expected, direction);
  if ((direction === "above" || direction === "below") && threshold == null) {
    return { ok: false, reason: `een absolute grens (${direction}) vereist een waarde, en die staat niet in "${expected.slice(0, 60)}"` };
  }
  const relativeThreshold = extractRelativeThreshold(expected, direction);

  return {
    ok: true,
    parsed: {
      predicate: threshold == null ? { metric, direction } : { metric, direction, threshold },
      windowDays: parseWindowDays(input.timeframe),
      ...(relativeThreshold != null ? { relativeThreshold } : {}),
    },
  };
}
