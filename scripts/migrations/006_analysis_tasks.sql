-- 006 (H2): taken uit analyses met status en uitvoeringsbewijs.
create table if not exists analysis_tasks (
  id                  bigint generated always as identity primary key,
  run_key             text not null,
  client_id           text not null,
  channel             text not null,
  sop_type            text not null,
  task_number         integer,
  linked_recommendation integer,
  hypothesis_id       bigint references analysis_hypotheses(id) on delete set null,
  handeling           text not null,
  entity_name         text,
  meet_via            text,
  deadline_hint       text check (deadline_hint in ('direct','deze_week','deze_maand')),
  status              text not null default 'open' check (status in ('open','in_progress','done','skipped','wont_do')),
  status_reason       text,
  assigned_to         text,
  execution_status    text not null default 'unknown' check (execution_status in ('unknown','detected','confirmed')),
  execution_evidence  text,
  occurrence_count    integer not null default 1,
  last_run_key        text,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_tasks_client_status on analysis_tasks (client_id, status);
create index if not exists idx_tasks_run on analysis_tasks (run_key);
