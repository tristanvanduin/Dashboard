// Categorie G: broad-drift. Het spend-aandeel via broad stijgt terwijl de conversieratio van
// die broad-termen achterblijft bij de gerichte match-types. Verhaal: de targeting verwatert,
// er verschuift geld van efficientie naar verspilling.
//
// DE NUANCE DIE IN HET VERHAAL HOORT: sinds de aggregatie-fix is match_type het DOMINANTE
// match-type van een zoekterm in die maand, niet een exacte uitsplitsing. "Broad-kosten" is
// dus de spend van termen die overwegend via broad binnenkwamen. Voor de vraag "hoeveel van
// ons geld loopt via broad en wat levert het op" is dat precies scherp genoeg, maar het
// verhaal claimt geen eurogenauwe uitsplitsing.
//
// NEAR_EXACT en NEAR_PHRASE horen bij de GERICHTE kant: dat zijn close variants van exact en
// phrase, geen broad. Ze meetellen als broad zou de drift structureel overdrijven.
// UNKNOWN, UNSPECIFIED en leeg zijn niet toe te wijzen en vallen buiten BEIDE kanten: die
// gokken zou de aandelen vervuilen.

import { type DetectionResult, pct } from "./types";

export const BROAD_SHARE_RISE_PP = 0.05; // vijf procentPUNT stijging van het spend-aandeel
export const BROAD_CVR_GAP = 0.3; // de broad-conversieratio ligt minstens dertig procent lager
export const BROAD_MIN_CLICKS = 100; // per kant per maand, anders is de conversieratio ruis
export const BROAD_MIN_COST_SHARE = 0.1; // onder tien procent van de kosten is broad geen verhaal

export type MatchClass = "broad" | "gericht" | "onbekend";

export function classifyMatchType(matchType: string | null | undefined): MatchClass {
  const value = String(matchType ?? "").trim().toUpperCase();
  if (value === "BROAD") return "broad";
  if (value === "EXACT" || value === "PHRASE" || value === "NEAR_EXACT" || value === "NEAR_PHRASE") return "gericht";
  return "onbekend";
}

export interface SearchTermRow {
  month: string; // YYYY-MM
  matchType: string | null;
  cost: number;
  clicks: number;
  conversions: number;
}

interface Side {
  cost: number;
  clicks: number;
  conversions: number;
}

const empty = (): Side => ({ cost: 0, clicks: 0, conversions: 0 });

function split(rows: SearchTermRow[]): { broad: Side; gericht: Side; toewijsbaar: number } {
  const broad = empty();
  const gericht = empty();
  for (const row of rows) {
    const target = classifyMatchType(row.matchType) === "broad" ? broad : classifyMatchType(row.matchType) === "gericht" ? gericht : null;
    if (!target) continue;
    target.cost += Math.max(row.cost, 0);
    target.clicks += Math.max(row.clicks, 0);
    target.conversions += Math.max(row.conversions, 0);
  }
  return { broad, gericht, toewijsbaar: broad.cost + gericht.cost };
}

export function detectBroadDrift(input: { rows: SearchTermRow[]; periodMonth: string; prevMonth: string }): DetectionResult {
  const checked = ["broad_drift"];
  const monthKey = (m: string) => String(m).slice(0, 7);

  const now = split(input.rows.filter((r) => monthKey(r.month) === input.periodMonth));
  const prev = split(input.rows.filter((r) => monthKey(r.month) === input.prevMonth));
  // Zonder toewijsbare kosten in BEIDE maanden valt er niets te vergelijken.
  if (now.toewijsbaar <= 0 || prev.toewijsbaar <= 0) return { triggered: [], checked };

  const shareNow = now.broad.cost / now.toewijsbaar;
  const sharePrev = prev.broad.cost / prev.toewijsbaar;
  const shareRise = shareNow - sharePrev; // in procentpunten: een aandeel vergelijk je zo

  // Voorwaarde 1: broad moet materieel zijn EN materieel gestegen zijn.
  if (shareNow < BROAD_MIN_COST_SHARE || shareRise < BROAD_SHARE_RISE_PP) return { triggered: [], checked };

  // Voorwaarde 2: beide kanten moeten genoeg volume hebben voor een conversieratio.
  if (now.broad.clicks < BROAD_MIN_CLICKS || now.gericht.clicks < BROAD_MIN_CLICKS) return { triggered: [], checked };

  const broadCvr = now.broad.conversions / now.broad.clicks;
  const gerichtCvr = now.gericht.conversions / now.gericht.clicks;
  // Converteert de gerichte kant zelf niet, dan is er geen maatstaf en is dit een ander verhaal.
  if (gerichtCvr <= 0) return { triggered: [], checked };

  const cvrGap = (gerichtCvr - broadCvr) / gerichtCvr;
  if (cvrGap < BROAD_CVR_GAP) return { triggered: [], checked };

  return {
    triggered: [
      {
        id: "broad_drift",
        category: "zoektermen_intentie" as const,
        scope: "account (zoektermen met een toewijsbaar match-type)",
        story: `Het kostenaandeel van zoektermen die overwegend via broad binnenkomen ging van ${pct(sharePrev)} naar ${pct(shareNow)} van de toewijsbare zoekterm-kosten, terwijl die broad-termen ${pct(cvrGap)} slechter converteren dan de gerichte match-types (${(broadCvr * 100).toFixed(2)} procent tegen ${(gerichtCvr * 100).toFixed(2)} procent). Er verschuift dus geld naar de kant die minder oplevert. Let op: het match-type is het dominante type per zoekterm per maand, geen eurogenauwe uitsplitsing.`,
        actionDirection:
          "vraag de specialist of deze broad-inzet BEDOELD is voor volume of prospecting, met een eigen doel en een eigen budget, of dat het een onbewust stuurloos lek is; pas daarna is de keuze tussen negatives, match-type-discipline of accepteren te maken",
        certainty: "indicatie" as const,
        evidence: [
          { metric: "kostenaandeel broad", value: Math.round(shareNow * 1000) / 1000, prev: Math.round(sharePrev * 1000) / 1000 },
          { metric: "conversieratio broad", value: Math.round(broadCvr * 10000) / 10000, prev: Math.round(gerichtCvr * 10000) / 10000 },
          { metric: "kosten broad", value: Math.round(now.broad.cost * 100) / 100 },
          { metric: "klikken broad", value: now.broad.clicks },
        ],
      },
    ],
    checked,
  };
}
