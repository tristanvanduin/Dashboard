// W1.5 (Z2): draait de geteste restore-assertions. Argumenten: het manifest-pad (tabel
// naar verwacht rijaantal op dump-moment) en het actual-pad (tabel naar gerestored aantal,
// door restore-test.sh met psql verzameld). Exit 0 bij groen, 1 bij een afwijking buiten
// de tolerantie, zodat het shell-script en de workflow erop kunnen sturen.
import { readFileSync } from "fs";
import { verifyRestore } from "../../lib/backup/policy";

const [, , manifestPad, actualPad] = process.argv;
if (!manifestPad || !actualPad) {
  console.error("Gebruik: tsx verify-restore.ts <manifest.json> <actual.json>");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPad, "utf8"));
const actual = JSON.parse(readFileSync(actualPad, "utf8"));
const { ok, results } = verifyRestore(manifest, actual);
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.table}: ${r.detail}`);
console.log(ok ? "RESTORE OK" : "RESTORE FAILED");
process.exit(ok ? 0 : 1);
