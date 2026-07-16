/**
 * Country utilities for multi-country SEA dashboard.
 *
 * Uses Google Ads geo_target_constant criterion IDs for reliable
 * country detection — NOT campaign naming conventions.
 */

// ── Country code → Dutch name mapping ─────────────────────────────────────

export const COUNTRY_MAP: Record<string, string> = {
  NL: "Nederland",
  DE: "Duitsland",
  BE: "België",
  FR: "Frankrijk",
  UK: "Verenigd Koninkrijk",
  GB: "Verenigd Koninkrijk",
  AT: "Oostenrijk",
  CH: "Zwitserland",
  ES: "Spanje",
  IT: "Italië",
  PT: "Portugal",
  PL: "Polen",
  SE: "Zweden",
  DK: "Denemarken",
  NO: "Noorwegen",
  FI: "Finland",
  IE: "Ierland",
  LU: "Luxemburg",
  US: "Verenigde Staten",
  CA: "Canada",
  AU: "Australië",
};

// ── Google Ads criterion ID → country code mapping ────────────────────────
// These are the geo_target_constant IDs used by Google Ads for country-level targeting.

export const CRITERION_ID_TO_COUNTRY: Record<number, string> = {
  2276: "DE",
  2528: "NL",
  2250: "FR",
  2840: "US",
  2826: "GB",
  2724: "ES",
  2380: "IT",
  2056: "BE",
  2040: "AT",
  2756: "CH",
  2620: "PT",
  2616: "PL",
  2752: "SE",
  2208: "DK",
  2578: "NO",
  2246: "FI",
  2372: "IE",
  2442: "LU",
  2124: "CA",
  2036: "AU",
};

export const COUNTRY_TO_CRITERION_ID: Record<string, number> = Object.fromEntries(
  Object.entries(CRITERION_ID_TO_COUNTRY).map(([id, code]) => [code, Number(id)])
);

/** All supported country codes */
export const COUNTRY_CODES = Object.keys(COUNTRY_MAP);

/**
 * Get the Dutch name for a country code, or the code itself as fallback.
 */
export function countryLabel(code: string): string {
  return COUNTRY_MAP[code.toUpperCase()] ?? code.toUpperCase();
}

/**
 * Convert a geo_target_constant ID or country_code to a country code.
 * Handles both "2528" (criterion ID) and "NL" (ISO code) inputs.
 */
export function resolveCountryCode(geoTargetId: string | number | null, countryCode?: string | null): string | null {
  // If we have a direct country code, use it
  if (countryCode && COUNTRY_MAP[countryCode.toUpperCase()]) {
    return countryCode.toUpperCase();
  }
  // Try criterion ID
  if (geoTargetId) {
    const id = typeof geoTargetId === "string" ? parseInt(geoTargetId, 10) : geoTargetId;
    return CRITERION_ID_TO_COUNTRY[id] ?? null;
  }
  return null;
}

// ── Campaign name → country code detection (fallback only) ────────────────

const COUNTRY_PATTERN = new RegExp(
  `(?:^|[\\s_\\-|/])(?:${COUNTRY_CODES.join("|")})(?:$|[\\s_\\-|/])`,
  "i"
);

/**
 * Detect country code from a campaign name. FALLBACK only — prefer geo data.
 */
export function detectCountryFromName(campaignName: string): string | null {
  const match = campaignName.match(COUNTRY_PATTERN);
  if (!match) return null;
  const cleaned = match[0].replace(/[\s_\-|/]/g, "").toUpperCase();
  return COUNTRY_MAP[cleaned] ? cleaned : null;
}

// ── Search term language → country detection ─────────────────────────────

const GERMAN_CHARS = /[üöäß]/i;
const GERMAN_WORDS = /\b(und|für|zum|zur|mit|der|die|das|ein|eine|aus|auf|bei|nach|von|nicht|oder|ist|wir|ihr|über|unter|kaufen|günstig|bestellen|preis|größe|farbe|schwarz|weiß|blau|rot|grün|groß|klein)\b/i;
const FRENCH_CHARS = /[éèêëàâùûçœæ]/i;
const FRENCH_WORDS = /\b(le|la|les|du|des|de|pour|avec|dans|sur|par|pas|que|qui|est|sont|une|aux|mon|ton|son|cette|ces|noir|blanc|bleu|rouge|vert|prix|achat|acheter|taille|couleur|petit|grand)\b/i;

/**
 * Detect the likely country/language of a search term.
 * Returns country codes the term likely belongs to.
 *
 * - German patterns → ["DE"]
 * - French patterns → ["FR"]
 * - Dutch/neutral → ["NL", "BE"] (can't distinguish Dutch from Flemish)
 */
export function detectSearchTermCountries(searchTerm: string): string[] {
  const t = searchTerm.toLowerCase();

  // German: specific characters or common German words
  if (GERMAN_CHARS.test(t) || GERMAN_WORDS.test(t)) {
    return ["DE"];
  }

  // French: specific characters or common French words
  if (FRENCH_CHARS.test(t) || FRENCH_WORDS.test(t)) {
    return ["FR"];
  }

  // Default: Dutch-speaking markets (Netherlands + Belgium)
  return ["NL", "BE"];
}

/**
 * Detect all country codes from a list of campaign names.
 */
export function detectCountriesFromCampaigns(campaignNames: string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of campaignNames) {
    const code = detectCountryFromName(name);
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => code);
}
