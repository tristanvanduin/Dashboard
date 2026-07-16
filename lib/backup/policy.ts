// W1.5 (Z2): de pure backup-policy. De foutgevoelige beslissingen (welke backups
// verwijderen, of een restore geslaagd is) staan hier, IO-vrij en los getest; de
// shell-scripts en node-helpers roepen dit aan. Verkeerde retentie wist backups die je
// nodig hebt, dus dit is bewust een getest onderdeel en geen shell-eenregelaar.

// Bestandsnaamconventie: backup_YYYY-MM-DD_<sha>.sql.gz.gpg. De datum draagt de retentie,
// de git-sha maakt reconstrueerbaar tegen welke codeversie de dump hoort.
export function buildDumpFilename(date: Date, gitSha: string): string {
  const dag = date.toISOString().split("T")[0];
  const sha = (gitSha || "unknown").slice(0, 12);
  return `backup_${dag}_${sha}.sql.gz.gpg`;
}

// De datum uit een dumpbestandsnaam; null als het patroon niet klopt (dan blijft het
// bestand met rust: nooit iets verwijderen dat je niet kunt dateren).
export function parseDumpDate(filename: string): string | null {
  const m = filename.match(/backup_(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

export interface RetentionPolicy {
  dailyKeep: number; // de nieuwste N dagelijkse dumps
  monthlyKeep: number; // plus een per maand voor de laatste M oudere maanden
}

export const DEFAULT_RETENTION: RetentionPolicy = { dailyKeep: 30, monthlyKeep: 12 };

// Grandfather-father-son: houd de nieuwste dailyKeep dumps, plus de nieuwste dump per
// kalendermaand voor monthlyKeep oudere maanden. Alles daarbuiten mag weg. Niet-dateerbare
// bestanden blijven altijd behouden.
export function selectBackupsToDelete(
  filenames: string[],
  policy: RetentionPolicy = DEFAULT_RETENTION
): { keep: string[]; remove: string[] } {
  const dated: Array<{ file: string; date: string }> = [];
  const keep = new Set<string>();

  for (const file of filenames) {
    const date = parseDumpDate(file);
    if (date) dated.push({ file, date });
    else keep.add(file); // onbekend formaat: nooit verwijderen
  }

  dated.sort((a, b) => b.date.localeCompare(a.date)); // nieuwste eerst

  // De nieuwste dailyKeep blijven.
  dated.slice(0, policy.dailyKeep).forEach((d) => keep.add(d.file));

  // Uit de oudere: de nieuwste per maand, tot monthlyKeep maanden.
  const ouder = dated.slice(policy.dailyKeep);
  const nieuwstePerMaand = new Map<string, string>(); // YYYY-MM -> file
  for (const d of ouder) {
    const maand = d.date.slice(0, 7);
    if (!nieuwstePerMaand.has(maand)) nieuwstePerMaand.set(maand, d.file);
  }
  [...nieuwstePerMaand.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, policy.monthlyKeep)
    .forEach(([, file]) => keep.add(file));

  const remove = filenames.filter((f) => !keep.has(f));
  return { keep: filenames.filter((f) => keep.has(f)), remove };
}

// Het manifest dat bij de dump wordt meegeschreven: tabel naar rijaantal op dump-moment.
export type BackupManifest = Record<string, number>;

export const RESTORE_TOLERANCE = 0.02; // rijaantallen binnen 2 procent van de bron

export interface AssertionResult {
  table: string;
  expected: number;
  actual: number;
  ok: boolean;
  detail: string;
}

// Vergelijkt de gerestorede rijaantallen met het manifest binnen de tolerantie. Een
// verwacht aantal van 0 eist exact 0. Een ontbrekende tabel telt als 0 rijen (fail).
export function verifyRestore(
  manifest: BackupManifest,
  actual: Record<string, number>,
  tolerance: number = RESTORE_TOLERANCE
): { ok: boolean; results: AssertionResult[] } {
  const results: AssertionResult[] = [];
  for (const [table, expected] of Object.entries(manifest)) {
    const got = actual[table] ?? 0;
    let ok: boolean;
    if (expected === 0) {
      ok = got === 0;
    } else {
      ok = Math.abs(got - expected) / expected <= tolerance;
    }
    results.push({
      table,
      expected,
      actual: got,
      ok,
      detail: ok
        ? `${got} rijen binnen tolerantie van ${expected}`
        : `${got} rijen wijkt te veel af van ${expected}`,
    });
  }
  return { ok: results.every((r) => r.ok), results };
}

// De rij voor backup_restore_log (migratie 016): test_date, dump_file, result, duration_s, notes.
export function buildRestoreLogRow(input: {
  testDate: string;
  dumpFile: string;
  ok: boolean;
  durationS?: number;
  notes?: string;
}): Record<string, unknown> {
  return {
    test_date: input.testDate,
    dump_file: input.dumpFile,
    result: input.ok ? "ok" : "failed",
    duration_s: input.durationS ?? null,
    notes: input.notes ?? null,
  };
}
