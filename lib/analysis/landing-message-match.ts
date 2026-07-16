// W1 landing-page message-match: sluit de belofte in de advertentie aan op de pagina? De
// kern splitst in een deterministisch deel (claims uit de ad-copy, letterlijke presence op
// de paginatekst, de prijs-vergelijking, de kop-overlap) en een LLM-oordeel voor de
// semantische match dat het X3-judge-principe volgt: geen oordeel zonder letterlijk citaat
// uit BEIDE bronnen. Het degradatiepad staat vooraan: een pagina die niet leesbaar binnenkomt
// (bot-blokkade, JS-zware pagina, leeg) stopt de audit EERLIJK voordat er een LLM aan te pas
// komt. IO-vrij; de fetch en de route zijn build-kant.

import { z } from "zod";

export const MESSAGE_MATCH_PROMPT_VERSION = "w1-match-v1";
export const MIN_READABLE_PAGE_CHARS = 200;

export type ClaimType = "prijs" | "percentage" | "snelheid_levering" | "gratis" | "garantie";

export interface AdClaim {
  type: ClaimType;
  text: string; // de bron-zin of het bron-fragment uit de ad
  normalized: string;
}

const PRICE_PATTERN = /(?:€|£|\$)\s?\d{1,4}(?:[.,]\d{2})?|\b\d{1,4}[.,]\d{2}\s?(?:€|euro)\b/gi;
const PERCENT_PATTERN = /\b\d{1,2}\s?%/g;
const SPEED_PATTERN = /\b(same[- ]day|next[- ]day|vandaag (?:besteld|verzonden)|morgen in huis|binnen \d+ (?:uur|dagen)|24 uur|snelle levering|gratis verzending)\b/gi;
const FREE_PATTERN = /\b(gratis|free)\b/gi;
const GUARANTEE_PATTERN = /\b(garantie|guarantee|niet[- ]goed[- ]geld[- ]terug|\d+ dagen retour)\b/gi;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizePrice(raw: string): string {
  const digits = raw.replace(/[^\d.,]/g, "").replace(",", ".");
  const value = Number.parseFloat(digits);
  return Number.isFinite(value) ? value.toFixed(2) : normalize(raw);
}

// Claims uit de ad-copy: elke regel wordt op de vijf typen gescand; een regel kan meerdere
// claims dragen (bijv. een prijs en gratis verzending).
export function extractAdClaims(lines: string[]): AdClaim[] {
  const claims: AdClaim[] = [];
  const seen = new Set<string>();
  const push = (type: ClaimType, text: string, normalized: string) => {
    const key = `${type}|${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ type, text, normalized });
  };
  for (const line of lines) {
    for (const m of line.match(PRICE_PATTERN) ?? []) push("prijs", line, normalizePrice(m));
    for (const m of line.match(PERCENT_PATTERN) ?? []) push("percentage", line, normalize(m).replace(/\s/g, ""));
    for (const m of line.match(SPEED_PATTERN) ?? []) push("snelheid_levering", line, normalize(m));
    for (const m of line.match(FREE_PATTERN) ?? []) push("gratis", line, normalize(m));
    for (const m of line.match(GUARANTEE_PATTERN) ?? []) push("garantie", line, normalize(m));
  }
  return claims;
}

export type ClaimStatus = "gevonden_letterlijk" | "gevonden_deels" | "ontbreekt" | "prijs_wijkt_af";

export interface ClaimCheck {
  claim: AdClaim;
  status: ClaimStatus;
  evidence: string | null; // het pagina-fragment rond de vondst, of de afwijkende prijs
}

function excerptAround(pageNorm: string, needle: string, radius = 60): string {
  const index = pageNorm.indexOf(needle);
  if (index < 0) return needle;
  return pageNorm.slice(Math.max(0, index - radius), index + needle.length + radius).trim();
}

// De deterministische presence-check. Prijs is speciaal: een ANDER bedrag op de pagina is
// geen "ontbreekt" maar een mismatch, en dat is de gevaarlijkste vorm (belofte gebroken).
export function checkClaimsOnPage(claims: AdClaim[], pageText: string): ClaimCheck[] {
  const pageNorm = normalize(pageText);
  const pagePrices = new Set((pageText.match(PRICE_PATTERN) ?? []).map(normalizePrice));

  return claims.map((claim) => {
    if (claim.type === "prijs") {
      if (pagePrices.has(claim.normalized)) {
        return { claim, status: "gevonden_letterlijk" as const, evidence: excerptAround(pageNorm, claim.normalized.replace(".", ",").replace(/\.00$/, "")) || claim.normalized };
      }
      if (pagePrices.size > 0) {
        return { claim, status: "prijs_wijkt_af" as const, evidence: `ad zegt ${claim.normalized}, pagina toont ${[...pagePrices].join(", ")}` };
      }
      return { claim, status: "ontbreekt" as const, evidence: null };
    }
    if (pageNorm.includes(claim.normalized)) {
      return { claim, status: "gevonden_letterlijk" as const, evidence: excerptAround(pageNorm, claim.normalized) };
    }
    const tokens = claim.normalized.split(" ").filter((t) => t.length > 3);
    if (tokens.length > 0 && tokens.every((t) => pageNorm.includes(t))) {
      return { claim, status: "gevonden_deels" as const, evidence: excerptAround(pageNorm, tokens[0]) };
    }
    return { claim, status: "ontbreekt" as const, evidence: null };
  });
}

// De kop-overlap: hoe goed dekt de beste headline de H1 (token-overlap, 0 tot 1).
export function headlineH1Overlap(headlines: string[], h1: string | null): { ratio: number; bestHeadline: string | null } {
  if (!h1 || headlines.length === 0) return { ratio: 0, bestHeadline: null };
  const h1Tokens = new Set(normalize(h1).split(" ").filter((t) => t.length > 3));
  if (h1Tokens.size === 0) return { ratio: 0, bestHeadline: null };
  let best = { ratio: 0, bestHeadline: null as string | null };
  for (const headline of headlines) {
    const tokens = normalize(headline).split(" ").filter((t) => t.length > 3);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => h1Tokens.has(t)).length;
    const ratio = Math.round((hits / tokens.length) * 100) / 100;
    if (ratio > best.ratio) best = { ratio, bestHeadline: headline };
  }
  return best;
}

export type MessageMatchFacts =
  | {
      status: "leesbaar";
      claims: ClaimCheck[];
      coveragePct: number; // aandeel claims gevonden (letterlijk of deels)
      priceMismatch: boolean;
      h1Overlap: { ratio: number; bestHeadline: string | null };
    }
  | { status: "pagina_niet_leesbaar"; reason: string };

// De volledige deterministische voorcompute, met het degradatiepad vooraan.
export function buildMessageMatchFacts(input: { headlines: string[]; descriptions: string[]; pageText: string | null; h1: string | null }): MessageMatchFacts {
  const pageText = input.pageText?.trim() ?? "";
  if (pageText.length < MIN_READABLE_PAGE_CHARS) {
    return {
      status: "pagina_niet_leesbaar",
      reason: `de pagina leverde ${pageText.length} leesbare tekens (minimaal ${MIN_READABLE_PAGE_CHARS}); vermoedelijk een bot-blokkade, een JS-zware pagina of een lege respons. De audit stopt hier eerlijk, er is geen basis voor een oordeel.`,
    };
  }
  const claims = extractAdClaims([...input.headlines, ...input.descriptions]);
  const checks = checkClaimsOnPage(claims, pageText);
  const found = checks.filter((c) => c.status === "gevonden_letterlijk" || c.status === "gevonden_deels").length;
  return {
    status: "leesbaar",
    claims: checks,
    coveragePct: checks.length > 0 ? Math.round((found / checks.length) * 1000) / 10 : 100,
    priceMismatch: checks.some((c) => c.status === "prijs_wijkt_af"),
    h1Overlap: headlineH1Overlap(input.headlines, input.h1),
  };
}

// ── Het LLM-contract voor de semantische match (X3-judge-principe: citaten verplicht). ──
const ClaimJudgementSchema = z
  .object({
    claim: z.string().min(1),
    oordeel: z.enum(["matched", "partial", "missing"]),
    citaat_ad: z.string().min(1),
    citaat_pagina: z.string(),
  })
  .refine((c) => c.oordeel === "missing" || c.citaat_pagina.trim().length > 0, {
    message: "matched of partial vereist een letterlijk citaat uit de pagina",
  });

export const MessageMatchSchema = z.object({
  overall_score: z.number().min(0).max(10),
  oordeel_per_claim: z.array(ClaimJudgementSchema).min(1),
  grootste_gap: z.string().min(1),
  aanbeveling: z.string().min(1),
});

export type MessageMatchJudgement = z.infer<typeof MessageMatchSchema>;

export function buildMessageMatchPrompt(input: { adCopy: string; pageExcerpt: string; facts: Extract<MessageMatchFacts, { status: "leesbaar" }> }): { system: string; user: string; version: string } {
  const system = `Je beoordeelt message match: sluit de belofte in de advertentie aan op de bestemmingspagina. REGELS: het pagina-excerpt hieronder is je ENIGE bron over de pagina; elk oordeel matched of partial draagt een LETTERLIJK citaat uit de advertentie EN uit de pagina; zonder pagina-citaat is het oordeel ongeldig; wees streng, een 8 of hoger betekent dat elke kernbelofte letterlijk terugkomt. Antwoord UITSLUITEND met JSON conform het schema.`;
  const user = `## Advertentie-copy\n${input.adCopy}\n\n## Deterministische voorcompute\n${JSON.stringify({ coveragePct: input.facts.coveragePct, priceMismatch: input.facts.priceMismatch, h1Overlap: input.facts.h1Overlap, claims: input.facts.claims.map((c) => ({ type: c.claim.type, claim: c.claim.normalized, status: c.status })) })}\n\n## Pagina-excerpt\n${input.pageExcerpt}\n\nLever het oordeel als JSON: { "overall_score", "oordeel_per_claim": [{ "claim", "oordeel", "citaat_ad", "citaat_pagina" }], "grootste_gap", "aanbeveling" }.`;
  return { system, user, version: MESSAGE_MATCH_PROMPT_VERSION };
}
