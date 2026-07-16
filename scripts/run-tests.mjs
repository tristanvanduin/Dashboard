// Eenvoudige testrunner: draait alle tsx-script-tests onder lib/ en aggregeert.
// Slaag-signaal is de exit-code (de tests roepen process.exit(1) bij falen).
// Gebruik: npm test
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/(__.*_test|\.test)\.ts$/.test(e) && !/_demo\.ts$/.test(e)) out.push(p);
  }
  return out;
}

const tests = walk("lib").sort();
console.log(`${tests.length} testbestanden gevonden\n`);
let passed = 0, failed = 0;
const failures = [];
for (const t of tests) {
  const r = spawnSync("npx", ["tsx", t], { encoding: "utf8", timeout: 120000 });
  if (r.status === 0) { passed++; process.stdout.write("."); }
  else { failed++; failures.push(t); process.stdout.write("F"); }
}
console.log(`\n\n${passed} geslaagd, ${failed} gefaald van ${tests.length}`);
if (failures.length) {
  console.log("\nGefaald:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("Alle tests groen.");
