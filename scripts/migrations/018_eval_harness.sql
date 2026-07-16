-- 018 (X3): het eval-harnas. Fixtures voor exacte replay, runs met de scorekaart, en de
-- outputs per stap. Een eval-run schrijft NOOIT naar de productie-outputtabellen (spec-
-- isolatie-eis); deze drie tabellen zijn het volledige eval-domein.
create table if not exists eval_fixtures (
  id           bigint generated always as identity primary key,
  fixture_set  text not null,
  run_key      text not null,
  step         integer not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_eval_fixtures_set on eval_fixtures (fixture_set, step);

create table if not exists eval_runs (
  id                    bigint generated always as identity primary key,
  fixture_set           text not null,
  model                 text not null,
  judge_model           text,
  judge_prompt_version  text,
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  scorecard             jsonb,
  judge_result          jsonb
);
create index if not exists idx_eval_runs_set on eval_runs (fixture_set, model);

create table if not exists eval_outputs (
  id           bigint generated always as identity primary key,
  eval_run_id  bigint not null references eval_runs(id) on delete cascade,
  step         integer not null,
  output       text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_eval_outputs_run on eval_outputs (eval_run_id, step);

alter table eval_fixtures enable row level security;
alter table eval_runs enable row level security;
alter table eval_outputs enable row level security;
