# Canonieke migratieset (W0.1, geconsolideerd 2 juli 2026)

Dit is de ENIGE geldige migratieset. De juni-zip (sql_migraties.zip) en de losse
container-bestanden zijn hierin geconsolideerd en daarmee vervallen. Regel 7 van
MASTERPLAN_V2: nooit een tabel in twee bestanden; elke schemawijziging is een
idempotent addendum plus een kolom-diff tegen de code.

## Draaivolgorde

Strikt oplopend, 000 tot en met 017, per fase (niet alles vooraf). De runner (000)
registreert elke toegepaste migratie met checksum in schema_migrations.

- 000 schema_migrations: de runner-administratie. Altijd eerst.
- 001 user_roles: bij fase O1 (W1.2).
- 002 client_targets, 003 llm_usage: bij fase O2-wiring (W1.1).
- 004 analysis_runs_alerts: bij fase O3 (W1.3). PREFLIGHT UITGEVOERD: breidt het
  bestaande generation_jobs uit (geen parallelle tabel), plus alerts_log en de
  analysis_schedule-kolom op client_settings.
- 005 analysis_hypotheses, 010 hypothese_uitkomst, 011 sprint_hypotheses_source: bij de
  H- en E-wiring (W2.3, W2.4).
- 006 analysis_tasks: bij fase H2 (W2.4).
- 007 meta: bij de Meta-live-gang (WL.4). Container-basis (code-aligned, entity_id)
  plus juni-addenda: meta_connections (token_ref, currency, account_timezone),
  meta_creatives, meta_change_log, en campagne-metadata (buying_type, bid_strategy,
  start_time, stop_time).
- 008 linkedin: bij de LinkedIn-live-gang (WL.5). Container-basis (code-aligned,
  entity_urn, conversion_value enkelvoud) plus addendum currency op linkedin_connections.
- 009 linkedin_icp: samen met 008.
- 012 expert_layers: dekt ads_leading_indicators, ads_portfolio_analysis,
  sop_client_context, sop_hypothesis_tracking (de code verwacht ze al).
- 013 meta_vision: bij fase M3 (W3.2).
- 014 blended_view: GUARD, NIET DRAAIEN buiten fase X1 (W3.4). De Google-TODO's en de
  W0.1-aanvulling (entity_id, entity_urn, conversions_value versus conversion_value)
  moeten eerst vervangen zijn.
- 015 client_onboarding: bij fase X2 (W3.5).
- 016 backup_restore_log: bij fase Z2 (W1.5).
- 017 rls_lockdown: GUARD, uitsluitend samen met de O1-deploy (WL.3). Nooit eerder,
  anders sluit de lockdown de huidige open app buiten.

## Consolidatie-beslissingen (uit ANALYSE_VOOR_MASTERPLAN_V2, sectie 2a)

De code is de waarheid. Voor elke tabel waar gebouwde code tegen schrijft won de
container-definitie (kolommen exact gelijk aan lib/meta/rows.ts en lib/linkedin/rows.ts).
De juni-set bleef leidend voor de nog-niet-gebouwde fases. Drie juni-verrijkingen zijn
als addenda overgenomen: currency op beide connections, meta_campaigns-metadata, en de
rijkere llm_usage (channel, sop_type, step_label; call_label behouden als vrij label).

Mapping oud naar nieuw: juni 009 werd 013, juni 012 werd 014, juni 013 werd 015, juni
014 werd 016, juni 015 werd 017. Vervallen (geconsolideerd): juni 002, 003, 007, 008,
010, 011; container meta-tables.sql, expert-layers.sql, e1-hypothese-uitkomst.sql,
h1-analysis-hypotheses.sql, si2-sprint-hypotheses-source.sql en de ongenummerde
bestanden in scripts/migrations.

## Verificatie-uitslag (2 juli 2026)

41 tabellen in de set, nul dubbel gedefinieerd; kolom-diff tegen rows.ts schoon voor
de daily- en demografietabellen; alle 30 door de code verwachte tabellen die niet in
het productieschema staan zijn door precies een migratie gedekt; geen em-dashes;
suite en tsc groen na de consolidatie.
