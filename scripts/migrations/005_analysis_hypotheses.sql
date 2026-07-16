-- 005 (H1): hypotheses met baseline, venster en verdict.
create table if not exists analysis_hypotheses (
  id                  bigint generated always as identity primary key,
  run_key             text not null,
  client_id           text not null,
  channel             text not null,
  sop_type            text not null,
  route               text,
  entity_type         text,
  entity_name         text,
  intervention        text not null,
  success_predicates  jsonb not null default '[]'::jsonb,
  guardrail_predicates jsonb not null default '[]'::jsonb,
  window_days         integer not null default 7,
  baseline            jsonb,
  evaluate_after      date not null,
  status              text not null default 'open' check (status in ('open','accepted','rejected','unmeasurable','expired')),
  execution_status    text not null default 'unknown' check (execution_status in ('unknown','detected','confirmed','not_executed')),
  execution_evidence  text,
  outcome             jsonb,
  evaluated_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_hypotheses_due on analysis_hypotheses (status, evaluate_after);
create index if not exists idx_hypotheses_client on analysis_hypotheses (client_id, created_at desc);
