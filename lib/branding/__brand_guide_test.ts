// Test voor het brand-guide-datamodel en de validatie. Deterministisch, geen IO.
// Draaien: npx tsx lib/branding/__brand_guide_test.ts

import { validateBrandGuide, emptyBrandGuide, type BrandGuide } from "./brand-guide";
import { resolveEventTheme } from "./theme";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Een volledige, bevestigde guide als basis.
function volledig(): BrandGuide {
  return {
    brandName: "GreenTech",
    proposition: "De toekomst van tuinbouwtechnologie, vandaag",
    visual: { primaryColor: "#1E7A3D", accentColor: "#F5C518", secondaryColor: null, logoUrl: "https://cdn/gt.svg", headingFont: "Poppins" },
    toneOfVoice: { dos: ["helder en zakelijk"], donts: ["geen jargon"] },
    keyMessages: ["de toekomst van tuinbouwtechnologie"],
    forbiddenWords: ["goedkoop", "revolutionair"],
    mandatoryElements: ["RAI-logo in de footer"],
    audienceLanguage: "zakelijk Nederlands en Engels",
    examples: { good: ["Ontdek de nieuwste tuinbouwinnovaties"], bad: ["Goedkope deals nu!"] },
    confirmedByClient: true,
  };
}

// ── Lege guide ──
const leeg = emptyBrandGuide("Test");
const vLeeg = validateBrandGuide(leeg);
assert(vLeeg.valid, "een lege guide met naam is goed gevormd (geen blokkerende fouten)");
assert(!vLeeg.themingReady, "zonder kleur is de guide niet theming-ready");
assert(!vLeeg.creativeReady, "een lege guide is niet creative-ready");
assert(vLeeg.warnings.length >= 4, "een lege guide geeft meerdere waarschuwingen over ontbrekende velden");

// ── Volledige, bevestigde guide ──
const v = validateBrandGuide(volledig());
assert(v.valid && v.themingReady && v.creativeReady, "een volledige, bevestigde guide is geldig, theming-ready en creative-ready");
assert(v.errors.length === 0, "geen fouten bij een volledige guide");

// ── De visuele identiteit voedt de theming ──
const theme = resolveEventTheme(volledig().visual);
assert(theme.primary === "#1E7A3D" && theme.primaryForeground === "#ffffff", "de brand guide voedt het thema met leesbaar contrast");

// ── Blokkerende fouten ──
const geenNaam = validateBrandGuide({ ...volledig(), brandName: "" });
assert(!geenNaam.valid && geenNaam.errors.some((e) => e.includes("merknaam")), "ontbrekende merknaam is een fout");
const slechteHex = validateBrandGuide({ ...volledig(), visual: { ...volledig().visual, primaryColor: "groen" } });
assert(!slechteHex.valid && slechteHex.errors.some((e) => e.includes("primaire kleur")), "ongeldige hex is een fout");
assert(!slechteHex.themingReady && !slechteHex.creativeReady, "een ongeldige guide is nergens ready");

// ── Creative-readiness vereist klant-bevestiging (mens-in-de-lus) ──
const nietBevestigd = validateBrandGuide({ ...volledig(), confirmedByClient: false });
assert(nietBevestigd.valid && !nietBevestigd.creativeReady, "een volledige maar niet-bevestigde guide is NIET creative-ready");
assert(nietBevestigd.themingReady, "theming mag wel zonder bevestiging, alleen creatieve uitvoer niet");

// ── Creative-readiness vereist de creatieve velden ──
const geenVoorbeelden = validateBrandGuide({ ...volledig(), examples: { good: [], bad: [] } });
assert(!geenVoorbeelden.creativeReady, "zonder voorbeeldzinnen niet creative-ready (agents leunen erop)");
const geenVerboden = validateBrandGuide({ ...volledig(), forbiddenWords: [] });
assert(!geenVerboden.creativeReady, "zonder verboden woorden niet creative-ready");

// ── Conflict-check: verboden woord in een kernboodschap ──
const conflict = validateBrandGuide({ ...volledig(), forbiddenWords: ["toekomst"], keyMessages: ["de toekomst van tuinbouw"] });
assert(conflict.warnings.some((w) => w.includes("toekomst") && w.includes("kernboodschap")), "een verboden woord in een kernboodschap geeft een waarschuwing");

// ── Theming-ready zonder creative-ready ──
const alleenVisueel: BrandGuide = { ...emptyBrandGuide("Aquatech"), visual: { primaryColor: "#0B4F6C", accentColor: null, secondaryColor: null, logoUrl: null, headingFont: null } };
const vVisueel = validateBrandGuide(alleenVisueel);
assert(vVisueel.themingReady && !vVisueel.creativeReady, "een guide met alleen een kleur is theming-ready maar niet creative-ready");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

// ── M4-adapter: de merkcontext uit de guide voor de creative-briefing ──
import { brandContextForBriefing } from "./brand-guide";
{
  let p2 = 0, f2 = 0;
  const a2 = (c: boolean, l: string) => { if (c) p2++; else { f2++; console.error(`  FAIL: ${l}`); } };
  const ctx = brandContextForBriefing(volledig());
  a2(ctx.brandName === "GreenTech" && ctx.proposition.includes("tuinbouwtechnologie"), "adapter levert naam en propositie");
  a2(ctx.brandColors.length === 2 && ctx.brandColors[0] === "#1E7A3D", "adapter levert alleen de geldige merkkleuren (primair en accent)");
  a2(ctx.forbiddenWords.includes("goedkoop") && ctx.toneOfVoice.dos.length === 1, "adapter geeft de creatieve grenzen mee zodat een concept binnen het merk blijft");
  a2(ctx.mandatoryElements.includes("RAI-logo in de footer"), "adapter geeft de verplichte elementen mee");

  // Ongeldige kleur komt niet mee als brandkleur
  const metSlechteKleur = brandContextForBriefing({ ...volledig(), visual: { ...volledig().visual, secondaryColor: "geen-hex" } });
  a2(metSlechteKleur.brandColors.length === 2, "een ongeldige kleur wordt niet als merkkleur doorgegeven");

  // Propositie ontbreekt geeft een waarschuwing, geen blokkade
  const geenProp = validateBrandGuide({ ...volledig(), proposition: "" });
  a2(geenProp.valid && geenProp.warnings.some((w) => w.includes("kernpropositie")), "ontbrekende propositie is een waarschuwing, geen fout");
  a2(geenProp.creativeReady, "een ontbrekende propositie blokkeert creative-readiness niet (M4 gebruikt wat er is)");

  console.log(`\n=== M4-adapter: ${p2} passed, ${f2} failed ===\n`);
  if (f2 > 0) process.exit(1);
}
