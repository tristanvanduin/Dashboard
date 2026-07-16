// Test voor de brand-guide-theming-laag. Deterministisch, geen IO.
// Draaien: npx tsx lib/branding/__theme_test.ts

import { isValidHex, contrastForeground, resolveEventTheme, themeToCssVars, DEFAULT_THEME, type BrandVisualIdentity } from "./theme";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Hex-validatie ──
assert(isValidHex("#08288C") && isValidHex("#fff") && isValidHex("#F16B37"), "geldige hex-codes (6 en 3 cijfers)");
assert(!isValidHex("08288C") && !isValidHex("#12345") && !isValidHex("blauw") && !isValidHex(null), "ongeldige waarden falen");

// ── Contrast-voorgrond ──
assert(contrastForeground("#08288C") === "#ffffff", "op donker blauw hoort witte tekst");
assert(contrastForeground("#F5F5B0") === DEFAULT_THEME.foreground, "op lichtgeel hoort donkere tekst");
assert(contrastForeground("#000000") === "#ffffff", "op zwart hoort witte tekst");
assert(contrastForeground("#FFFFFF") === DEFAULT_THEME.foreground, "op wit hoort donkere tekst");
assert(contrastForeground("nietvalide") === "#ffffff", "een ongeldige kleur valt veilig terug op wit");

// ── Terugval op RM bij geen identiteit ──
const geen = resolveEventTheme(null);
assert(geen.primary === "#08288C" && geen.accent === "#F16B37", "geen identiteit geeft het volledige RM-thema");
assert(geen.logoUrl === null, "geen identiteit geeft geen logo");

// ── Geldige merk-kleuren overnemen, met berekende voorgrond ──
const groen: BrandVisualIdentity = { primaryColor: "#1E7A3D", accentColor: "#F5C518", logoUrl: "https://cdn/greentech.svg", headingFont: "Poppins, sans-serif" };
const t = resolveEventTheme(groen);
assert(t.primary === "#1E7A3D" && t.accent === "#F5C518", "de merk-kleuren worden overgenomen");
assert(t.primaryForeground === "#ffffff", "witte tekst op het donkere merk-groen");
assert(t.accentForeground === DEFAULT_THEME.foreground, "donkere tekst op het lichte merk-geel");
assert(t.logoUrl === "https://cdn/greentech.svg", "het logo wordt overgenomen");
assert(t.headingFont === "Poppins, sans-serif", "het merk-font wordt overgenomen");

// ── Deels ongeldig: alleen dat veld valt terug ──
const deels: BrandVisualIdentity = { primaryColor: "#7A1E1E", accentColor: "geen-hex", logoUrl: "" };
const td = resolveEventTheme(deels);
assert(td.primary === "#7A1E1E", "de geldige primaire kleur wordt overgenomen");
assert(td.accent === DEFAULT_THEME.accent, "de ongeldige accent-kleur valt terug op de default");
assert(td.logoUrl === null, "een leeg logo-veld geeft geen logo");
assert(td.background === DEFAULT_THEME.background && td.card === DEFAULT_THEME.card, "achtergrond en kaart blijven de tool-tokens voor consistentie");

// ── CSS-variabelen ──
const vars = themeToCssVars(t);
assert(vars["--primary"] === "#1E7A3D" && vars["--primary-foreground"] === "#ffffff", "de primaire variabelen kloppen");
assert(vars["--accent"] === "#F5C518" && vars["--font-heading"] === "Poppins, sans-serif", "accent en font-variabelen kloppen");
assert(Object.keys(vars).length === 10, "alle tien de shadcn-variabelen worden geleverd");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
