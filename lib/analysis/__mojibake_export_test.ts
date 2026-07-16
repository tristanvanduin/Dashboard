// Verificatie van de mojibake- EN no-em-dash-fix op het export-pad.
// F7 v2 verbiedt een triviale hardgecodeerde test omdat MOJIBAKE_MAP zo'n string
// sowieso vangt. Daarom gebruikt deze test twee realistische bronnen:
//  (a) accent-mojibake GEGENEREERD via een UTF-8 -> Latin-1 round-trip (de echte
//      encoding-mismatch), en
//  (b) de euro-corruptie als het EXACTE patroon dat in de deliverables voorkomt
//      (afkomstig van UTF-8 gelezen als Windows-1252; byte 0x82 wordt U+201A, niet
//      reproduceerbaar via Latin-1, dus expliciet als codepoints opgenomen).
// Plus het NIEUWE, niet-triviale gedrag: literale em dashes worden nu verwijderd.
// fixMojibake is het transform dat nu op alle export-paden draait (cleanMarkdown
// voor PDF, generateReport voor markdown). sanitize.ts heeft geen imports.
// Draaien: npx tsx lib/analysis/__mojibake_export_test.ts
import { fixMojibake } from "./sanitize";

const EM = "\u2014"; // em dash
const EN = "\u2013"; // en dash
const EURO_MOJIBAKE = "\u00e2\u201a\u00ac"; // de echte "â‚¬" zoals die in de export verschijnt

function toMojibake(s: string): string {
  return Buffer.from(s, "utf-8").toString("latin1");
}

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("\n1a. Accent-mojibake (realistisch gegenereerd via round-trip) wordt hersteld");
{
  const clean = "Belgi\u00eb met hogere conversieratio's voor Ren\u00e9 & Co in regio Noord\u00f6st";
  const corrupt = toMojibake(clean);
  console.log("     gegenereerd: " + corrupt);
  const out = fixMojibake(corrupt);
  console.log("     hersteld:    " + out);
  check("alle accenttekens hersteld (\u00eb \u00e9 \u00f6)", out.includes("Belgi\u00eb") && out.includes("Ren\u00e9") && out.includes("Noord\u00f6st"));
  check("nul \u00c3-mojibake-resten", !/\u00c3./.test(out));
}

console.log("\n1b. Euro-corruptie (het echte patroon uit de export) wordt hersteld");
{
  const corrupt = "De CPA daalde naar " + EURO_MOJIBAKE + "12,50 deze maand.";
  const out = fixMojibake(corrupt);
  console.log("     hersteld: " + out);
  check("euro hersteld (" + EURO_MOJIBAKE + " -> \u20ac)", out.includes("\u20ac12,50") && !out.includes(EURO_MOJIBAKE));
}

console.log("\n2. Het nieuwe gedrag: nul em dash in de uitvoer (jouw no-em-dash-eis)");
{
  const withEmDash = "Schaal " + toMojibake("op Belgi\u00eb") + " op " + EM + " maar gecontroleerd.";
  const out = fixMojibake(withEmDash);
  console.log("     hersteld: " + out);
  check("geen literale em dash meer", !out.includes(EM), "em dash aanwezig");
  check("geen en dash meer", !out.includes(EN), "en dash aanwezig");
  check("em dash vervangen door ' - '", /op\s+-\s+maar/.test(out), "werd: " + out);
}

console.log("\n3. Niet-triviaal: een kale literale em dash wordt nu omgezet (oude map liet die staan)");
{
  const out = fixMojibake("alpha " + EM + " beta");
  check("kale em dash -> ' - '", !out.includes(EM) && out.includes(" - "), "werd: " + out);
}

console.log("\n4. Idempotent en veilig op al-schone tekst");
{
  const clean = "ROAS 4,2 met \u20ac1.250 omzet in Belgi\u00eb.";
  check("schone tekst onveranderd", fixMojibake(clean) === clean, "werd: " + fixMojibake(clean));
  const once = fixMojibake(EURO_MOJIBAKE + "100 " + EM + " " + toMojibake("Belgi\u00eb"));
  check("dubbel toepassen verandert niets", fixMojibake(once) === once);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald");
console.log("Let op: de DEFINITIEVE test is F7 v2 paragraaf 6, een echte run met export uit een verse read en grep op 0 hits in het werkelijke artefact.\n");
if (failed > 0) process.exit(1);
