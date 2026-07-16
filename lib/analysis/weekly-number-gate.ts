// W2.5 (W2): de deterministische number-gate voor de weekly- en biweekly-cadans. Spiegelt
// de logica van containsUngroundedNumber uit F5 (dezelfde regexes voor percentages en
// euro's) maar levert naast de detectie ook de lijst ongegronde cijfers en een geschoonde
// tekst, zodat een korte health check geen verzonnen impact bevat. IO-vrij en los getest;
// de routes halen de toegestane cijfers uit de gegronde analyse-output en passen dit toe op
// de geextraheerde aanbevelingen en taken.

// Dezelfde patronen als F5, bewust identiek gehouden om niet te divergeren.
const PCT_RE = /(\d+(?:[.,]\d+)?)\s*(?:%|procent)/gi;
const EUR_RE = /(?:€|EUR)\s*(\d+(?:[.,]\d+)?)/gi;

const PCT_MARKER = "[percentage niet uit data]";
const EUR_MARKER = "[bedrag niet uit data]";

// Haalt alle percentages en eurobedragen uit een gegronde tekst; deze vormen de toegestane
// set waartegen aanbevelingen worden getoetst.
export function extractGroundedNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PCT_RE)) out.push(Math.round(parseFloat(m[1].replace(",", "."))));
  for (const m of text.matchAll(EUR_RE)) out.push(Math.round(parseFloat(m[1].replace(",", "."))));
  return out.filter((v) => !Number.isNaN(v));
}

export interface GateResult {
  text: string;
  hadUngrounded: boolean;
  ungrounded: number[];
}

// Toetst een aanbeveling- of taaktekst tegen de toegestane cijfers. Een percentage of
// eurobedrag dat niet in de set zit is ongegrond: het wordt door een neutrale markering
// vervangen en gerapporteerd. Vensters als "1-2 weken" tellen niet, net als in F5.
export function gateUngroundedNumbers(text: string, allowedNumbers: number[]): GateResult {
  const allowed = new Set(allowedNumbers.map((v) => Math.round(v)));
  const ungrounded: number[] = [];

  let out = text.replace(PCT_RE, (match, n) => {
    const v = Math.round(parseFloat(String(n).replace(",", ".")));
    if (Number.isNaN(v) || allowed.has(v)) return match;
    ungrounded.push(v);
    return PCT_MARKER;
  });
  out = out.replace(EUR_RE, (match, n) => {
    const v = Math.round(parseFloat(String(n).replace(",", ".")));
    if (Number.isNaN(v) || allowed.has(v)) return match;
    ungrounded.push(v);
    return EUR_MARKER;
  });

  return { text: out, hadUngrounded: ungrounded.length > 0, ungrounded };
}

// Past de gate toe op een set string-velden van een item (aanbeveling of taak) en geeft het
// geschoonde item terug plus of er iets gemarkeerd is. Onbekende of niet-string velden
// blijven ongemoeid.
export function gateItemFields<T extends Record<string, unknown>>(
  item: T,
  fields: string[],
  allowedNumbers: number[]
): { item: T; hadUngrounded: boolean; ungrounded: number[] } {
  const clone: Record<string, unknown> = { ...item };
  const ungrounded: number[] = [];
  for (const field of fields) {
    const value = clone[field];
    if (typeof value === "string") {
      const res = gateUngroundedNumbers(value, allowedNumbers);
      clone[field] = res.text;
      if (res.hadUngrounded) ungrounded.push(...res.ungrounded);
    }
  }
  return { item: clone as T, hadUngrounded: ungrounded.length > 0, ungrounded };
}
