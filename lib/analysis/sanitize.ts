/**
 * Output sanitization for LLM responses.
 *
 * Fixes:
 * - Mojibake (â‚¬ → €, Ã« → ë, Ã¯ → ï, etc.)
 * - Duplicate headings in assembled output
 * - Trailing whitespace / excessive newlines
 */

// ── Mojibake fixes ─────────────────────────────────────────────────────────

const MOJIBAKE_MAP: [RegExp, string][] = [
  [/â‚¬/g, "€"],
  [/Ã«/g, "ë"],
  [/Ã¯/g, "ï"],
  [/Ã©/g, "é"],
  [/Ã¨/g, "è"],
  [/Ã¶/g, "ö"],
  [/Ã¼/g, "ü"],
  [/Ã¤/g, "ä"],
  [/Ã‰/g, "É"],
  [/Ã€/g, "À"],
  [/Ã³/g, "ó"],
  [/Ã­/g, "í"],
  [/Ã¡/g, "á"],
  [/Ã /g, "à"],
  [/Ã§/g, "ç"],
  [/Ã±/g, "ñ"],
  [/â€™/g, "'"],
  [/â€˜/g, "'"],
  [/â€œ/g, '"'],
  [/â€\u009d/g, '"'],
  [/â€"/g, "–"],
  [/â€"/g, "—"],
  [/â€¦/g, "…"],
  [/Â /g, " "],       // non-breaking space mojibake
  [/\u00a0/g, " "],   // actual non-breaking space → normal space
  [/\ufeff/g, ""],    // BOM character
];

/**
 * Fix common mojibake patterns from UTF-8 double-encoding.
 */
export function fixMojibake(text: string): string {
  let result = text;
  for (const [pattern, replacement] of MOJIBAKE_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ── Heading deduplication ──────────────────────────────────────────────────

/**
 * Remove duplicate markdown headings that occur when step output
 * already contains the heading and the assembly adds another one.
 *
 * For example, prevents:
 *   ## Account Performance
 *   ## Stap 1: Account Performance
 *   ...
 */
export function deduplicateHeadings(text: string): string {
  const lines = text.split("\n");
  const seen = new Set<string>();
  const result: string[] = [];

  const normalizeHeading = (value: string): string => value
    .replace(/^Stap \d+:\s*/i, "")
    .replace(/^stap \d+\s*[-–—:]\s*/i, "")
    .replace(/^Step \d+:\s*/i, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^#+\s*/, "")
    .trim()
    .toLowerCase();

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length; // 1=#, 2=##, 3=###, 4=####
      const normalized = normalizeHeading(headingMatch[2]);

      // Keep H1/H2 for structure, but still record their normalized titles so
      // repeated H3 wrappers ("### Stap 1: Account Performance") can be dropped.
      if (level <= 2) {
        seen.add(normalized);
      } else if (seen.has(normalized)) {
        continue;
      } else {
        seen.add(normalized);
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

// ── Whitespace cleanup ─────────────────────────────────────────────────────

/**
 * Clean up excessive whitespace and newlines.
 */
export function cleanWhitespace(text: string): string {
  return text
    .replace(/\n{4,}/g, "\n\n\n")  // max 3 consecutive newlines
    .replace(/[ \t]+$/gm, "")       // trailing whitespace per line
    .trim();
}

// ── Combined sanitizer ─────────────────────────────────────────────────────

/**
 * Apply all sanitization steps to LLM output text.
 */
export function sanitizeOutput(text: string): string {
  let result = fixMojibake(text);
  result = deduplicateHeadings(result);
  result = cleanWhitespace(result);
  return result;
}
