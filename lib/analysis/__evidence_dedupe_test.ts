// Verificatie van de F7 4b genormaliseerde evidence-dedupe.
// Draaien: npx tsx lib/analysis/__evidence_dedupe_test.ts
import { dedupeEvidenceLines, normalizeEvidenceKey } from "./evidence-dedupe";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("Het beschreven bug-geval (echte formats)");
// Bullet eindigt op ": cause", finding-regel op ". cause", zelfde kop.
const bullet = "Brand Search — Impression Share verlies 32% (+5%): budget te laag";
const finding = "Brand Search — Impression Share verlies 32% (+5%). Budget structureel te laag ingesteld [Bevestigd in stap 4]";
const out = dedupeEvidenceLines([bullet, finding]);
check("bullet en finding-regel (zelfde kop) worden 1 regel", out.length === 1, `kreeg ${out.length}`);
check("de rijkste (langste) regel blijft", out[0] === finding);

console.log("\nVerschillende waarde blijft gescheiden");
const v1 = "Brand Search — Impression Share verlies 32% (+5%). oorzaak A";
const v2 = "Brand Search — Impression Share verlies 18% (+2%). oorzaak B";
check("zelfde entiteit/metric maar andere waarde blijft 2 regels", dedupeEvidenceLines([v1, v2]).length === 2);

console.log("\nVerschillende metric blijft");
const m1 = "Campagne X — CVR 1.2% (-3%). daling";
const m2 = "Campagne X — CPC 0.62 (+10%). stijging";
check("zelfde entiteit andere metric blijft 2 regels", dedupeEvidenceLines([m1, m2]).length === 2);
check("decimaal in de waarde breekt de sleutel niet", normalizeEvidenceKey(m1) === normalizeEvidenceKey("Campagne X — CVR 1.2% (-3%). andere cause"));

console.log("\nCap op 2");
const three = dedupeEvidenceLines([
  "A — m1 10% (+1%). x",
  "B — m2 20% (+2%). y",
  "C — m3 30% (+3%). z",
]);
check("max 2 regels", three.length === 2);

console.log("\nLege en witruimte-regels");
check("lege regels gefilterd", dedupeEvidenceLines(["", "  ", "Echte regel hier"]).length === 1);

console.log("\nnormalizeEvidenceKey");
check("suffix gestript", normalizeEvidenceKey("ROAS daalt [Bevestigd in stap 7]: x") === normalizeEvidenceKey("ROAS daalt"));
check("interpunctie en casing genegeerd", normalizeEvidenceKey("CVR mobile") === normalizeEvidenceKey("cvr (mobile)"));

console.log("\nRijkste blijft ongeacht volgorde");
const longFirst = dedupeEvidenceLines([
  "Brand Search — IS verlies 32% (+5%). uitgebreide oorzaak met veel detail",
  "Brand Search — IS verlies 32% (+5%): kort",
]);
check("langere blijft ook als die eerst komt", longFirst.length === 1 && longFirst[0].includes("uitgebreide oorzaak"));

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
