export {};
// Verificatie van F2 4g: de hasDoubleConditional grammatica-guard en de eerlijke
// QA-aftrek. De functies zitten in monthly-structured.ts (laadt niet standalone door
// vele runtime-imports), dus getrouwe replica's. De kern: hasDoubleConditional vangt de
// bredere dubbele-condities die build 3's hasMalformedDecisionRule (drie vaste frasen)
// mist, en geeft geen vals alarm op legitieme regels met twee clauses.
// Draaien: npx tsx lib/analysis/__beslisregel_guard_test.ts

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// --- Replica's exact zoals in de code ---
function hasMalformedDecisionRule(text: string): boolean {
  return /Continueer alleen als doorzetten alleen als|doorzetten alleen als doorzetten alleen als|ga alleen door [^.\n]*ga pas door/i.test(text);
}
function hasDoubleConditional(text: string): boolean {
  return / als [^.;]{3,60} alleen [^.;]{3,60} als /i.test(text)
    || /\balleen als\b[^.;]*\balleen als\b/i.test(text);
}

// Misvormde regels uit de echte generatie-paden (zie monthly-structured.ts 2938 + condition-bronnen)
const doubled_doorzetten = "Continueer alleen als doorzetten alleen als CVR verbetert; stop of schaal af als de metric uitblijft.";
const doubled_behoud = "Continueer alleen als behoud de uitsluiting alleen als waste spend daalt; stop of schaal af als de metric uitblijft.";

// Legitieme regels uit decisionRuleForRoute (3150+)
const legit_recovery = "Continueer alleen als CVR verbetert; stop de herstelroute als CVR niet aantoonbaar verbetert.";
const legit_validation = "Ga alleen door naar containment of recovery als CVR verbetert; stop escalatie als de validatie de hoofdverklaring niet bevestigt.";
const legit_scale = "Schaal alleen op als CVR verbetert; rollback direct als efficiency verslechtert.";
const legit_containment = "Houd deze route alleen aan als CPA binnen de meetperiode verbetert; rollback of verscherp de ingreep als de schade actief blijft.";

console.log("\n1. hasDoubleConditional vangt de 'alleen als'-doublings, OOK die build 3 mist");
check("doubled (doorzetten) gevangen", hasDoubleConditional(doubled_doorzetten));
check("doubled (behoud de uitsluiting) gevangen door 4g", hasDoubleConditional(doubled_behoud));
check("  ... terwijl build 3's detector deze MIST (dat is de toegevoegde waarde)", !hasMalformedDecisionRule(doubled_behoud));

console.log("\n1b. Eerlijke grens: de guard MIST de heterogene proza-wikkelingen (en dat is precies waarom 4e nodig is)");
// "Herstel is pas geloofwaardig als ROAS" gewrapt -> "als ... als ..."-nesting, GEEN dubbele "alleen als".
// "Bevestig ... dat ..." gewrapt -> "als bevestig ... dat ...". Beide zijn misvormd maar buiten het bereik
// van een "alleen als"-guard. Renderen uit een gestructureerd predicaat (4e) raakt nooit deze proza.
const nested_als = "Ga alleen door met containment of recovery als herstel is pas geloofwaardig als ROAS verbetert";
const wrapped_dat = "Continueer alleen als bevestig binnen 1-2 weken dat CVR niet verslechtert; stop of schaal af als de metric uitblijft.";
check("guard MIST de 'als...als'-nesting (beperking; 4e lost dit bij de bron op)", !hasDoubleConditional(nested_als));
check("guard MIST de gewrapte 'dat'-conditie (beperking; 4e lost dit bij de bron op)", !hasDoubleConditional(wrapped_dat));

console.log("\n2. Geen vals alarm op legitieme regels (ook niet met twee clauses)");
check("legit recovery niet gevlagd", !hasDoubleConditional(legit_recovery));
check("legit validation niet gevlagd", !hasDoubleConditional(legit_validation));
check("legit controlled scale niet gevlagd", !hasDoubleConditional(legit_scale));
check("legit containment niet gevlagd", !hasDoubleConditional(legit_containment));
// expliciet de gevaarlijke vals-positief: twee aparte legitieme 'alleen als'-clauses
check("twee legitieme 'alleen als'-clauses over ; heen niet gevlagd",
  !hasDoubleConditional("Continueer alleen als CVR verbetert; schaal alleen als ROAS stabiel blijft."));

// --- Replica van scoreFinalActionability met de 4g-aftrek ---
function scoreActionability(rules: string[]): number {
  let score = 9.2;
  // (aantallen-checks weggelaten; we isoleren de beslisregel-aftrek)
  const doubleHits = rules.filter((r) => hasDoubleConditional(r)).length;
  score -= doubleHits * 1.0;
  return Math.max(0, Math.min(10, Number(score.toFixed(1))));
}

console.log("\n3. De eerlijke QA-aftrek reageert op dubbele condities");
{
  const cleanScore = scoreActionability([legit_recovery, legit_validation, legit_scale]);
  const oneDoubled = scoreActionability([legit_recovery, doubled_behoud, legit_scale]);
  const twoDoubled = scoreActionability([doubled_doorzetten, doubled_behoud, legit_scale]);
  console.log("     schoon: " + cleanScore + "  een dubbel: " + oneDoubled + "  twee dubbel: " + twoDoubled);
  check("schone set scoort hoog (9.2)", cleanScore === 9.2);
  check("een dubbele conditie kost precies 1.0", oneDoubled === 8.2);
  check("twee dubbele condities kosten 2.0", twoDoubled === 7.2);
  check("een dubbele regel die build 3 zou missen, drukt de score nu wel", oneDoubled < cleanScore);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);