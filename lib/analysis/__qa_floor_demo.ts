export {};
// Demonstratie dat de verwijderde QA-floor (Math.max(8.5, ...)) de echte scores verborg.
// Draaien: npx tsx lib/analysis/__qa_floor_demo.ts
//
// De echte scoringsfuncties (scoreFinalWhy, scoreFinalActionability) zitten in
// monthly-structured.ts, dat door zijn vele runtime-imports niet standalone laadt.
// Daarom repliceren we hier hun EXACTE rekenlogica (1-op-1 overgenomen uit de bron)
// en parametriseren we de detector-uitkomsten. De echte code-edit is de
// floor-verwijdering op regel 4390-4391; die is zelf-evident correct.

// Exacte replica van scoreFinalWhy (bron: monthly-structured.ts:3624).
function scoreFinalWhy(opts: {
  primaryClusterNull: boolean;
  threadHasSemicolonPattern: boolean; // /[;:].*;/ op de primaryThread
  supportingEvidenceCount: number;
}): number {
  let score = 9.2;
  if (opts.primaryClusterNull) score -= 0.8; // !primaryCluster
  // de cluster-afhankelijke aftrekken vuren niet wanneer de cluster null is
  if (opts.threadHasSemicolonPattern) score -= 0.4;
  if (opts.supportingEvidenceCount < 3) score -= 0.5;
  return Math.max(0, Math.min(10, Number(score.toFixed(1))));
}

// Exacte replica van scoreFinalActionability (bron: monthly-structured.ts:3635).
function scoreFinalActionability(opts: {
  recommendationsLength: number;
  tasksLength: number;
  recHasMalformedRule: boolean;
  taskHasMalformedRule: boolean;
  taskHasPlaceholder: boolean;
}): number {
  let score = 9.2;
  if (opts.recommendationsLength < 3) score -= 0.6;
  if (opts.tasksLength < 4) score -= 0.6;
  if (opts.recHasMalformedRule) score -= 0.8;
  if (opts.taskHasMalformedRule) score -= 0.8;
  if (opts.taskHasPlaceholder) score -= 1.0;
  return Math.max(0, Math.min(10, Number(score.toFixed(1))));
}

const FLOOR = 8.5;
function floored(real: number): number {
  return Math.max(FLOOR, real); // wat de oude code rapporteerde
}

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
}

console.log("\n1. De why-score op de echte call-site (cluster = null) kan NOOIT boven 8.4 komen");
{
  // beste geval op de call-site: cluster null, nette thread, genoeg evidence
  const best = scoreFinalWhy({ primaryClusterNull: true, threadHasSemicolonPattern: false, supportingEvidenceCount: 5 });
  console.log(`     beste why-score met null cluster = ${best} | floor rapporteerde = ${floored(best)}`);
  check("echte why-max is 8.4 (door de altijd-vurende null-cluster-aftrek)", best === 8.4, `was ${best}`);
  check("de floor overschreef dit naar 8.5 (altijd, want 8.4 < 8.5)", floored(best) === 8.5);
}

console.log("\n2. Met dunne onderbouwing zakt de why-score verder, de floor verborg dat");
{
  const thin = scoreFinalWhy({ primaryClusterNull: true, threadHasSemicolonPattern: true, supportingEvidenceCount: 2 });
  console.log(`     echte why-score = ${thin} | floor rapporteerde = ${floored(thin)}`);
  check("echte score is 7.5", thin === 7.5, `was ${thin}`);
  check("floor verborg het als 8.5 (gat van 1.0)", floored(thin) === 8.5 && 8.5 - thin === 1.0);
}

console.log("\n3. Een MISVORMDE beslisregel (die de audit echt vond) verlaagt actionability, de floor verborg dat");
{
  const withMalformed = scoreFinalActionability({ recommendationsLength: 3, tasksLength: 4, recHasMalformedRule: true, taskHasMalformedRule: false, taskHasPlaceholder: false });
  console.log(`     echte actionability = ${withMalformed} | floor rapporteerde = ${floored(withMalformed)}`);
  check("echte score is 8.4 ondanks een misvormde regel", withMalformed === 8.4, `was ${withMalformed}`);
  check("floor rapporteerde 8.5, dus QA zag 'goed' terwijl er een misvormde regel was", floored(withMalformed) === 8.5);
}

console.log("\n4. Realistisch zwakke output: weinig recs, weinig taken, misvormde regel, placeholder");
{
  const weak = scoreFinalActionability({ recommendationsLength: 2, tasksLength: 3, recHasMalformedRule: true, taskHasMalformedRule: false, taskHasPlaceholder: true });
  console.log(`     echte actionability = ${weak} | floor rapporteerde = ${floored(weak)}`);
  check("echte score is 6.2", weak === 6.2, `was ${weak}`);
  check("floor verborg een 6.2 als 8.5 (gat van 2.3)", floored(weak) === 8.5 && Number((8.5 - weak).toFixed(1)) === 2.3);
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald`);
console.log("Kernpunt: de why-score kon op de call-site nooit boven 8.4, dus de floor van 8.5 was ALTIJD een fabricatie, niet af en toe.\n");
if (failed > 0) process.exit(1);