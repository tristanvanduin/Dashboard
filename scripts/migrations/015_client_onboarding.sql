-- 013 (X2): onboarding-voortgang per klant.
create table if not exists client_onboarding (
  client_id    text primary key,
  steps        jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
