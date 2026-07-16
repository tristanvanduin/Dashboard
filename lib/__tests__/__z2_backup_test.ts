// Test voor W1.5 (Z2): de pure backup-policy plus de nieuwe backup-events.
// Deterministisch, geen IO. Draaien: npx tsx lib/__tests__/__z2_backup_test.ts

import { buildDumpFilename, parseDumpDate, selectBackupsToDelete, verifyRestore, buildRestoreLogRow, DEFAULT_RETENTION } from "../backup/policy";
import { buildSlackPayload, shouldSendAlert, type AlertEvent } from "../notifications";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Bestandsnaam ──
const naam = buildDumpFilename(new Date("2026-07-03T05:00:00Z"), "091b164abcdef0123456");
assert(naam === "backup_2026-07-03_091b164abcde.sql.gz.gpg", "bestandsnaam draagt datum en ingekorte git-sha");
assert(parseDumpDate(naam) === "2026-07-03", "de datum is terug te parsen");
assert(parseDumpDate("willekeurig.sql") === null, "een onbekend patroon geeft null");
assert(buildDumpFilename(new Date("2026-07-03T05:00:00Z"), "").includes("unknown"), "zonder sha valt het terug op unknown");

// ── Retentie: helper om N dagen aan dumps te maken ──
function dumps(vanaf: string, dagen: number): string[] {
  const start = new Date(vanaf);
  const out: string[] = [];
  for (let i = 0; i < dagen; i += 1) {
    const d = new Date(start.getTime() - i * 86_400_000);
    out.push(buildDumpFilename(d, "sha0"));
  }
  return out;
}

// 40 opeenvolgende dagelijkse dumps: de nieuwste 30 blijven, de oudere 10 vallen onder de
// maandregel (dezelfde maand, dus maar een blijft er per maand).
const veertig = dumps("2026-07-03", 40);
const res = selectBackupsToDelete(veertig, DEFAULT_RETENTION);
assert(res.keep.includes(veertig[0]) && res.keep.includes(veertig[29]), "de nieuwste 30 dagelijkse blijven");
assert(res.keep.length + res.remove.length === 40, "elke dump zit in keep of remove");
assert(res.keep.length >= 30, "minstens de 30 dagelijkse blijven behouden");

// Oudere maanden: een dump per maand blijft, tot 12 maanden terug
const perMaand: string[] = [];
for (let m = 0; m < 18; m += 1) {
  // 18 opeenvolgende maanden in 2024 en 2025, allemaal ouder dan het dagelijkse venster
  // van juli 2026, zodat ze zuiver onder de maandregel concurreren.
  perMaand.push(buildDumpFilename(new Date(Date.UTC(2024, m, 1)), "sha0"));
}
const oud = selectBackupsToDelete([...dumps("2026-07-03", 30), ...perMaand], DEFAULT_RETENTION);
const behoudenMaanden = oud.keep.filter((f) => perMaand.includes(f));
assert(behoudenMaanden.length <= 12, "hooguit 12 maandelijkse dumps blijven behouden");
assert(oud.remove.length > 0, "de oudste maanden voorbij 12 worden verwijderd");

// Niet-dateerbare bestanden worden nooit verwijderd
const metOnbekend = selectBackupsToDelete([...dumps("2026-07-03", 5), "handmatig_export.sql", "README.md"]);
assert(metOnbekend.keep.includes("handmatig_export.sql") && metOnbekend.keep.includes("README.md"), "onbekende bestanden blijven altijd behouden");

// ── Restore-assertions ──
const manifest = { ads_account_monthly: 8, ads_campaign_monthly: 46, ads_search_terms_monthly: 3792 };
const perfect = verifyRestore(manifest, { ads_account_monthly: 8, ads_campaign_monthly: 46, ads_search_terms_monthly: 3792 });
assert(perfect.ok, "exact gelijke aantallen slagen");
const binnenTol = verifyRestore(manifest, { ads_account_monthly: 8, ads_campaign_monthly: 46, ads_search_terms_monthly: 3760 });
assert(binnenTol.ok, "een afwijking binnen 2 procent slaagt (3760 van 3792)");
const buitenTol = verifyRestore(manifest, { ads_account_monthly: 8, ads_campaign_monthly: 46, ads_search_terms_monthly: 3000 });
assert(!buitenTol.ok, "een afwijking buiten 2 procent faalt");
assert(buitenTol.results.find((r) => r.table === "ads_search_terms_monthly")?.ok === false, "de falende tabel is aanwijsbaar");
const ontbreekt = verifyRestore(manifest, { ads_account_monthly: 8, ads_campaign_monthly: 46 });
assert(!ontbreekt.ok, "een ontbrekende tabel telt als 0 rijen en faalt");
const nulVerwacht = verifyRestore({ lege_tabel: 0 }, { lege_tabel: 0 });
assert(nulVerwacht.ok, "een verwacht aantal van 0 met 0 rijen slaagt");
assert(!verifyRestore({ lege_tabel: 0 }, { lege_tabel: 3 }).ok, "0 verwacht maar 3 gevonden faalt");

// ── Log-rij conform 016 ──
const rij = buildRestoreLogRow({ testDate: "2026-07-03", dumpFile: naam, ok: true, durationS: 42, notes: "maandtest" });
assert(rij.test_date === "2026-07-03" && rij.dump_file === naam && rij.result === "ok" && rij.duration_s === 42 && rij.notes === "maandtest", "de log-rij matcht de 016-kolommen");
assert(buildRestoreLogRow({ testDate: "2026-07-03", dumpFile: naam, ok: false }).result === "failed", "een mislukte test geeft result failed");

// ── Nieuwe backup-events ──
const gefaald: AlertEvent = { type: "backup_failed", kernfeit: "pg_dump exit 1" };
assert(buildSlackPayload(gefaald).text.includes("Backup mislukt"), "backup_failed heeft een kop");
assert(buildSlackPayload({ type: "backup_restore_failed", kernfeit: "assertie faalde" }).text.includes("Restore-test mislukt"), "backup_restore_failed heeft een kop");
assert(buildSlackPayload({ type: "backup_restore_ok", kernfeit: "maandtest groen" }).text.includes("Restore-test geslaagd"), "backup_restore_ok heeft een kop");
const nu = new Date("2026-07-03T12:00:00Z");
assert(shouldSendAlert(gefaald, new Date(nu.getTime() - 5 * 3_600_000), nu) === false, "backup_failed volgt de 6-uurs dedupe");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
