-- 004 (O3): run-administratie en alert-dedupe. Bestandsnaam is historisch.
-- PREFLIGHT UITGEVOERD (3 juli 2026): het bestaande progress-systeem is generation_jobs
-- plus generation_job_events (lib/progress/server.ts) en beide bestaan in productie.
-- Conform de no-go (geen dubbele administratie) BREIDT deze migratie generation_jobs uit
-- in plaats van een parallelle analysis_runs te maken. job_id is al de run_key waarmee
-- W1.1 de llm_usage-kosten koppelt. Duurmeting uit 756 echte stap-fases: mediaan 11s,
-- p90 44s; de pump-batchgrootte is 5 stappen per invocatie (budget 240s).

alter table generation_jobs add column if not exists channel text;
alter table generation_jobs add column if not exists sop_type text;
alter table generation_jobs add column if not exists period_start date;
alter table generation_jobs add column if not exists period_end date;
alter table generation_jobs add column if not exists attempts integer not null default 0;
alter table generation_jobs add column if not exists scheduled_for timestamptz;
alter table generation_jobs add column if not exists triggered_by text;

create index if not exists idx_generation_jobs_pump on generation_jobs (status, scheduled_for);
create index if not exists idx_generation_jobs_period on generation_jobs (client_id, job_type, period_end);

comment on column generation_jobs.attempts is
  'O3: retry-teller. failed met attempts 0 gaat na minimaal 30 minuten terug naar pending met attempts 1; een tweede mislukking is definitief (run_failed_final-alert).';
comment on column generation_jobs.scheduled_for is
  'O3: het geplande moment; de pump claimt de oudste pending run (status plus scheduled_for-index).';

-- Schedule-configuratie per klant (spec 5c staat uitbreiding van client_settings toe;
-- volgt het kpi_targets-patroon): { "enabled": true, "day_of_month": 2, "channels": [] }.
alter table client_settings add column if not exists analysis_schedule jsonb;

comment on column client_settings.analysis_schedule is
  'O3: maandplanning per klant: enabled, day_of_month (clamp naar de laatste dag in korte maanden), channels.';

-- Alert-dedupe (5d): zelfde (client_id, event_type) maximaal 1 per 6 uur, behalve
-- analysis_completed en analysis_blocked; die zijn het nieuws en gaan altijd door.
create table if not exists alerts_log (
  id uuid primary key default gen_random_uuid(),
  client_id text,
  event_type text not null,
  dedupe_key text not null,
  sent_at timestamptz not null default now()
);
create index if not exists idx_alerts_log_dedupe on alerts_log (dedupe_key, sent_at);
