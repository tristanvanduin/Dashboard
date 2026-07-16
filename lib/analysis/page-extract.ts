// W1 pagina-extractie: HTML naar leesbare tekst plus de H1, puur en zonder DOM-dependency.
// Bewuste beperking: dit leest de server-respons; content die pas client-side rendert blijft
// onzichtbaar, en dat is precies waarom de match-kern het degradatiepad (minimaal 200
// leesbare tekens) vooraan heeft staan. De entiteit-decodering is minimaal en gericht op
// wat in prijzen en claims voorkomt (euro, pond, ampersand, aanhalingstekens, non-breaking
// space); exotischer entiteiten degraderen naar spatie en dat is voor presence-checks prima.

export interface ExtractedPage {
  text: string;
  h1: string | null;
}

const ENTITIES: Array<[RegExp, string]> = [
  [/&euro;|&#8364;/gi, "€"],
  [/&pound;|&#163;/gi, "£"],
  [/&amp;/gi, "&"],
  [/&quot;|&#34;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
  [/&nbsp;|&#160;/gi, " "],
  [/&[a-z]+;|&#\d+;/gi, " "], // rest naar spatie
];

function decodeEntities(text: string): string {
  let out = text;
  for (const [pattern, replacement] of ENTITIES) out = out.replace(pattern, replacement);
  return out;
}

function stripBlock(html: string, tag: string): string {
  return html.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
}

export function extractPageText(html: string | null): ExtractedPage {
  if (!html) return { text: "", h1: null };

  let work = html;
  for (const tag of ["script", "style", "noscript", "svg", "iframe"]) work = stripBlock(work, tag);
  work = work.replace(/<!--[\s\S]*?-->/g, " ");

  // De H1 voor de kop-overlap, voor het strippen van de tags.
  const h1Match = work.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1Match ? decodeEntities(h1Match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null : null;

  const text = decodeEntities(work.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

  return { text, h1 };
}
