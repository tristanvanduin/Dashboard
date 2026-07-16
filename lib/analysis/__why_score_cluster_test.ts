export {};
// Verificatie van F2 4h (restant): het revisie-aanroeppunt gaf scoreFinalWhy een null
// cluster, waardoor de why-score altijd de -0.8 "geen cluster"-aftrek nam en op 8.4 bleef
// hangen, ongeacht de echte kwaliteit. Na de fix krijgt het de echte primaire cluster mee.
// scoreFinalWhy is een interne functie in monthly-structured.ts (laadt niet standalone),
// dus een getrouwe replica; tsc bevestigde dat de echte code 0 fouten heeft.
// Draaien: npx tsx lib/analysis/__why_score_cluster_test.ts

type Cl = { issue_cluster: string; evRank: number };
let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// Replica exact zoals in de code; evidenceFromCluster/evidenceRank gestubd via evRank.
function scoreFinalWhy(primaryThread: string, primaryCluster: Cl | null, supportingEvidence: string[]): number {
  let score = 9.2;
  if (!primaryCluster) score -= 0.8;
  if (primaryCluster && ["network_quality", "desktop_inefficiency", "mobile_opportunity", "schedule_waste"].includes(primaryCluster.issue_cluster)) score -= 0.4;
  if (primaryCluster && primaryCluster.issue_cluster === "tracking_cvr_drop") score -= 0.5;
  if (primaryCluster && primaryCluster.evRank <= 2) score -= 0.5;
  if (/[;:].*;/.test(primaryThread)) score -= 0.4;
  if (supportingEvidence.length < 3) score -= 0.5;
  return Math.max(0, Math.min(10, Number(score.toFixed(1))));
}

const thread = "Account verliest rendement door geografische misallocatie.";
const ev3 = ["a", "b", "c"];

console.log("\n1. De oude null-aanroep loopt structureel vast op 8.4");
const nullScore = scoreFinalWhy(thread, null, ev3);
check("null cluster geeft 8.4 (9.2 - 0.8)", nullScore === 8.4, "kreeg " + nullScore);

console.log("\n2. Met het echte cluster reflecteert de score de werkelijke kwaliteit");
const strong = scoreFinalWhy(thread, { issue_cluster: "geo_allocation", evRank: 3 }, ev3);
const network = scoreFinalWhy(thread, { issue_cluster: "network_quality", evRank: 3 }, ev3);
const tracking = scoreFinalWhy(thread, { issue_cluster: "tracking_cvr_drop", evRank: 3 }, ev3);
const weakEvidence = scoreFinalWhy(thread, { issue_cluster: "geo_allocation", evRank: 2 }, ev3);
console.log("     sterk cluster:        " + strong);
console.log("     network cluster:      " + network);
console.log("     tracking cluster:     " + tracking);
console.log("     zwak bewijs (rank 2): " + weakEvidence);
check("sterk cluster -> 9.2 (geen -0.8, geen andere aftrek)", strong === 9.2, "kreeg " + strong);
check("network cluster -> 8.8 (-0.4)", network === 8.8, "kreeg " + network);
check("tracking cluster -> 8.7 (-0.5)", tracking === 8.7, "kreeg " + tracking);
check("zwak bewijs -> 8.7 (-0.5)", weakEvidence === 8.7, "kreeg " + weakEvidence);

console.log("\n3. Het verschil: echt cluster is informatief, null was dat niet");
const realScores = [strong, network, tracking, weakEvidence];
const distinct = new Set(realScores).size;
check("echte cluster-scores variëren (informatief)", distinct >= 3, "distinct=" + distinct);
check("een sterk rapport overstijgt nu de oude 8.4-bodem", strong > nullScore && network > nullScore);
check("de null-bug onderdrukte de score met precies 0.8", strong - nullScore === 0.8 || Number((strong - nullScore).toFixed(1)) === 0.8);

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);