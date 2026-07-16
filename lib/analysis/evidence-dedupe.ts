// ============================================================
// F7 4b: genormaliseerde evidence-dedupe
// ------------------------------------------------------------
// De evidence-trace printte per cluster twee vrijwel identieke regels: de
// supporting-bullet en de eerste finding-regel verschillen alleen in interpunctie
// en een "[Bevestigd in stap ...]" suffix. De exacte-string unique() miste dat.
//
// Deze dedupe normaliseert (suffix en interpunctie gestript, lowercase) en houdt
// bij een gelijke sleutel de rijkste regel (langste informatie-inhoud), gecapt op
// twee regels die echt verschillende informatie dragen. Puur, geen side effects.
// ============================================================

const DEFAULT_EVIDENCE_CAP = 2;

/**
 * Normaliseert een evidence-regel tot een vergelijkingssleutel: het
 * "[Bevestigd in stap ...]" suffix en alle interpunctie weg, lowercase, witruimte
 * samengetrokken. Twee regels die alleen daarin verschillen krijgen dezelfde sleutel.
 */
export function normalizeEvidenceKey(line: string): string {
  const noSuffix = (line ?? "").replace(/\[bevestigd in stap[^\]]*\]/gi, " ");
  // Neem de kop tot de cause-scheiding (": " of ". "): die bevat entiteit, metric,
  // waarde en change. Een punt of dubbele punt direct gevolgd door een cijfer
  // (zoals 1.2% of 12:30) breekt niet, want we splitsen alleen op scheiding plus witruimte.
  const head = noSuffix.split(/[:.]\s/)[0];
  return head
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ontdubbelt evidence-regels op genormaliseerde sleutel en houdt per sleutel de
 * rijkste (langste) regel. Behoudt de eerste-voorkomen-volgorde en capt op `cap`
 * regels (standaard 2).
 */
export function dedupeEvidenceLines(lines: string[], cap: number = DEFAULT_EVIDENCE_CAP): string[] {
  const byKey = new Map<string, string>();
  const order: string[] = [];
  for (const raw of lines) {
    const line = (raw ?? "").trim();
    if (!line) continue;
    const key = normalizeEvidenceKey(line);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing == null) {
      byKey.set(key, line);
      order.push(key);
    } else if (line.length > existing.length) {
      byKey.set(key, line); // houd de rijkste regel
    }
  }
  return order.map((k) => byKey.get(k) as string).slice(0, cap);
}
