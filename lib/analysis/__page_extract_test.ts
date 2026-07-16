// Test voor de W1 pagina-extractie. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__page_extract_test.ts

import { extractPageText } from "./page-extract";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const html = `<!DOCTYPE html><html><head><title>Shop</title><style>.x{color:red}</style><script>var tracking = "geheim";</script></head>
<body><!-- hero -->
<h1>Personaliseer <span>je hoesje</span></h1>
<noscript>Zet javascript aan</noscript>
<p>Prijs: &euro;19,95 &amp; gratis   verzending.</p>
<div>Same day shipment &pound;2</div>
</body></html>`;

const page = extractPageText(html);
assert(!page.text.includes("tracking") && !page.text.includes("color:red") && !page.text.includes("javascript aan"), "scripts, styles en noscript zijn volledig gestript inclusief hun inhoud");
assert(page.h1 === "Personaliseer je hoesje", "de H1 wordt apart geextraheerd, ook met tags erin");
assert(page.text.includes("€19,95") && page.text.includes("& gratis verzending") && page.text.includes("£2"), "euro, pond en ampersand decoderen zodat prijzen en claims leesbaar blijven");
assert(!page.text.includes("  ") && !page.text.includes("hero"), "whitespace collapset en comments verdwijnen");
assert(page.text.includes("Same day shipment"), "de gewone tekst blijft intact");

const leeg = extractPageText(null);
assert(leeg.text === "" && leeg.h1 === null, "null-input degradeert netjes naar leeg");
assert(extractPageText("<html><body></body></html>").h1 === null, "zonder H1 is de kop null");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
