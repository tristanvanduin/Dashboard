-- 001 (O1): gebruikersrollen. Draaien samen met de O1 auth-deploy.
create table if not exists user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','specialist','viewer')),
  created_at timestamptz not null default now()
);

-- Helper: rol van de ingelogde gebruiker (voor policies en checks)
create or replace function app_role() returns text
language sql stable security definer set search_path = public
as $$ select role from user_roles where user_id = auth.uid() $$;

-- RLS: eigen rij lezen, admin leest alles. Schrijven alleen via service role.
alter table user_roles enable row level security;
drop policy if exists user_roles_read on user_roles;
create policy user_roles_read on user_roles for select to authenticated
  using (auth.uid() = user_id or app_role() = 'admin');
