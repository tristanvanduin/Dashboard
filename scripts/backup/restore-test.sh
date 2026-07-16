#!/usr/bin/env bash
# W1.5 (Z2): restore-bewijs. Restored de laatste dump naar een scratch-database, verzamelt
# de rijaantallen, draait de geteste assertions en schrijft een regel in backup_restore_log.
# LIVE-ONGETEST: vergt SCRATCH_DATABASE_URL, GPG en de dump uit de bucket. Dit is de PROEF
# die in Wave LIVE (WL.1) echt gedraaid moet worden; zonder een geslaagde run is Z2 niet af.
set -euo pipefail
: "${SCRATCH_DATABASE_URL:?SCRATCH_DATABASE_URL vereist}"
: "${DUMP_GPG:?pad naar het versleutelde dumpbestand vereist}"
: "${MANIFEST:?pad naar het manifest vereist}"

START="$(date +%s)"
WORK="$(mktemp -d)"
CORE_TABLES=(ads_account_monthly ads_campaign_monthly ads_keyword_performance_monthly ads_search_terms_monthly generation_jobs)

# 1. Ontsleutelen en decomprimeren
gpg --batch --yes --decrypt --output "$WORK/dump.sql.gz" "$DUMP_GPG"
gunzip "$WORK/dump.sql.gz"

# 2. Scratch leegmaken en restoren
psql "$SCRATCH_DATABASE_URL" -c "drop schema if exists public cascade; create schema public;"
psql "$SCRATCH_DATABASE_URL" < "$WORK/dump.sql"

# 3. Actuele rijaantallen verzamelen
{
  echo "{"
  for i in "${!CORE_TABLES[@]}"; do
    t="${CORE_TABLES[$i]}"
    c="$(psql "$SCRATCH_DATABASE_URL" -tAc "select count(*) from ${t}")"
    sep=","; [ "$i" -eq $(( ${#CORE_TABLES[@]} - 1 )) ] && sep=""
    echo "  \"${t}\": ${c}${sep}"
  done
  echo "}"
} > "$WORK/actual.json"

# 4. Geteste assertions
if npx tsx scripts/backup/verify-restore.ts "$MANIFEST" "$WORK/actual.json"; then RESULT="ok"; else RESULT="failed"; fi
DURATION=$(( $(date +%s) - START ))

# 5. Logregel in backup_restore_log (migratie 016)
psql "$SCRATCH_DATABASE_URL" -c "insert into backup_restore_log (test_date, dump_file, result, duration_s) values (current_date, '$(basename "$DUMP_GPG")', '${RESULT}', ${DURATION});" || true
echo "Restore-test ${RESULT} in ${DURATION}s"
[ "$RESULT" = "ok" ]
