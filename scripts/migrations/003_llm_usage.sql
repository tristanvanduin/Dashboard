-- 003 (O2): LLM-kostengrootboek per call, gekoppeld aan een run via run_key.
-- Geconsolideerd in W0.1: de rijkere juni-vorm (channel, sop_type, step_label) plus
-- call_label als vrij label uit de container-vorm. cost_eur is null bij een model
-- zonder bekende prijs; dat maakt een partieel totaal expliciet. Idempotent.

create table if not exists llm_usage (
  id uuid primary key default gen_random_uuid(),
  run_key text not null,
  client_id text,
  channel text,
  sop_type text,
  step_label text,
  call_label text,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  cost_eur numeric(10,4),
  created_at timestamptz not null default now()
);
create index if not exists idx_llm_usage_run on llm_usage (run_key);
create index if not exists idx_llm_usage_client on llm_usage (client_id, created_at);

comment on table llm_usage is
  'LLM-verbruik per call (O2). run_key koppelt aan de run; channel, sop_type en step_label maken kosten per kanaal en stap analyseerbaar. cost_eur null bij onbekend model.';
