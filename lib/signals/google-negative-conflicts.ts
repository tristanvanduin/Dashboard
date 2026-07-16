// Categorie G: de negative-keyword-conflictchecker. Een negative die een eigen positief
// zoekwoord blokkeert, is een zoekwoord dat niet kan draaien. Google's eigen
// conflict-rapport hanteert dezelfde definitie: blokkeert de negative de TEKST van het
// zoekwoord zelf.
//
// DE ECHTE GOOGLE-REGELS, want een benadering hier levert vals alarm:
// - negative BROAD "goedkoop schoenen": blokkeert elke zoekopdracht die AL die woorden
//   bevat, in willekeurige volgorde.
// - negative PHRASE "goedkope schoenen": blokkeert als die woorden als GROEP op VOLGORDE
//   voorkomen; er mag tekst omheen staan.
// - negative EXACT "goedkope schoenen": blokkeert alleen die zoekopdracht LETTERLIJK.
// - Negatives matchen GEEN close variants: geen meervouden, geen typefouten. Dat is precies
//   waarom een conflictchecker nodig is en niet met de hand te doen: "schoen" blokkeert
//   "schoenen" NIET, maar "schoenen" blokkeert "goedkope schoenen" WEL.
//
// DE ERNST VERSCHILT PER MATCH-TYPE VAN HET POSITIEVE ZOEKWOORD, en dat is de nuance die
// deze checker bruikbaar maakt: een geblokkeerd EXACT- of PHRASE-zoekwoord is volledig
// dood, want het kan alleen op zijn eigen term draaien. Een geblokkeerd BROAD-zoekwoord is
// dood op zijn KERNTERM maar kan nog op verwante zoekopdrachten draaien. Beide zijn een
// probleem, maar het eerste is een noodgeval en het tweede een aanscherping.

import { type DetectionResult } from "./types";

export const MAX_CONFLICT_STORIES = 3;

export interface PositiveKeyword {
  campaignName: string;
  adGroupName: string;
  keywordText: string;
  matchType: string;
  cost: number;
  conversions: number;
}

export interface NegativeKeyword {
  level: "campaign" | "ad_group" | "shared_set";
  campaignName: string;
  adGroupName: string;
  listName: string;
  keywordText: string;
  matchType: string;
}

// Google negeert leestekens in zoekwoorden; woordgrenzen blijven staan.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    if (needle.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

/** Blokkeert deze negative de gegeven zoekopdracht of zoekwoordtekst? */
export function negativeBlocks(negative: { keywordText: string; matchType: string }, targetText: string): boolean {
  const neg = tokenize(negative.keywordText);
  const target = tokenize(targetText);
  if (neg.length === 0 || target.length === 0) return false;

  switch (negative.matchType.trim().toUpperCase()) {
    case "BROAD":
      // Alle woorden aanwezig, volgorde maakt niet uit. Geen close variants.
      return neg.every((word) => target.includes(word));
    case "PHRASE":
      return containsSequence(target, neg);
    case "EXACT":
      return neg.length === target.length && neg.every((word, i) => target[i] === word);
    default:
      // Een onbekend match-type niet gokken: een vals conflict kost vertrouwen.
      return false;
  }
}

/** Geldt deze negative voor dit zoekwoord? Het bereik verschilt per niveau. */
export function negativeApplies(negative: NegativeKeyword, positive: PositiveKeyword): boolean {
  if (negative.campaignName !== positive.campaignName) return false;
  // Een adgroep-negative raakt alleen zijn eigen adgroep; campagne- en lijst-negatives
  // raken de hele campagne.
  if (negative.level === "ad_group") return negative.adGroupName === positive.adGroupName;
  return true;
}

export interface Conflict {
  positive: PositiveKeyword;
  negative: NegativeKeyword;
  volledigDood: boolean; // een exact- of phrase-zoekwoord kan alleen op zijn eigen term draaien
}

export function findConflicts(positives: PositiveKeyword[], negatives: NegativeKeyword[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const positive of positives) {
    for (const negative of negatives) {
      if (!negativeApplies(negative, positive)) continue;
      if (!negativeBlocks(negative, positive.keywordText)) continue;
      const type = positive.matchType.trim().toUpperCase();
      conflicts.push({ positive, negative, volledigDood: type === "EXACT" || type === "PHRASE" });
      break; // een zoekwoord is al dood bij de eerste blokkade; meer melden voegt niets toe
    }
  }
  return conflicts;
}

function bronVan(negative: NegativeKeyword): string {
  if (negative.level === "shared_set") return `de gedeelde lijst "${negative.listName}"`;
  if (negative.level === "ad_group") return `de adgroep ${negative.adGroupName}`;
  return "de campagne";
}

export function detectNegativeConflicts(input: { positives: PositiveKeyword[]; negatives: NegativeKeyword[] }): DetectionResult {
  const checked = ["negative_conflict"];
  if (input.positives.length === 0 || input.negatives.length === 0) return { triggered: [], checked };

  const conflicts = findConflicts(input.positives, input.negatives)
    // De pijnlijkste eerst: een zoekwoord dat ooit converteerde en nu geblokkeerd staat, is
    // stil weggevallen omzet. Daarna op kosten, want dat is bewezen relevantie.
    .sort((a, b) => b.positive.conversions - a.positive.conversions || b.positive.cost - a.positive.cost)
    .slice(0, MAX_CONFLICT_STORIES);
  if (conflicts.length === 0) return { triggered: [], checked };

  return {
    triggered: conflicts.map(({ positive, negative, volledigDood }) => ({
      id: "negative_conflict",
      category: "zoektermen_intentie" as const,
      scope: `${positive.campaignName} > ${positive.adGroupName}: "${positive.keywordText}"`,
      story:
        `Het zoekwoord "${positive.keywordText}" (${positive.matchType}) wordt geblokkeerd door de negative "${negative.keywordText}" (${negative.matchType}) uit ${bronVan(negative)}. ` +
        (volledigDood
          ? `Een ${positive.matchType}-zoekwoord kan alleen op zijn eigen term draaien, dus dit zoekwoord staat volledig stil.`
          : `Een broad-zoekwoord kan nog op verwante zoekopdrachten draaien, maar niet meer op zijn eigen kernterm.`) +
        (positive.conversions > 0
          ? ` Het leverde in deze periode nog ${positive.conversions} conversies op ${positive.cost.toFixed(2)} kosten, dus de blokkade is recent of gedeeltelijk.`
          : ` Het leverde in deze periode niets op, wat past bij een blokkade die al langer staat.`),
      actionDirection: volledigDood
        ? `haal de negative "${negative.keywordText}" weg of scherp hem aan tot phrase of exact, of pauzeer het zoekwoord bewust; nu betaalt niemand ervoor maar staat het wel in de structuur`
        : `toets of de negative "${negative.keywordText}" te breed staat; hij haalt de kernterm van dit zoekwoord weg`,
      certainty: "bewezen_binnen_platform" as const,
      evidence: [
        { metric: "conversies zoekwoord", value: positive.conversions },
        { metric: "kosten zoekwoord", value: Math.round(positive.cost * 100) / 100 },
        { metric: "niveau negative", value: negative.level },
      ],
    })),
    checked,
  };
}
