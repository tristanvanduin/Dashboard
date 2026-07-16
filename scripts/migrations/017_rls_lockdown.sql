-- 015 (O1): RLS-lockdown over ALLE bestaande public-tabellen.
-- WAARSCHUWING: alleen draaien op het moment van de O1 auth-deploy.
-- Eerder draaien breekt de huidige (open) app: de anon key verliest leesrechten.
-- Dit blok dekt ook alle ads_* legacy-tabellen en alles wat hierboven al is aangemaakt.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('drop policy if exists authenticated_read on public.%I', r.tablename);
    execute format('create policy authenticated_read on public.%I for select to authenticated using (true)', r.tablename);
  end loop;
end $$;
-- Schrijfrechten: bewust GEEN policies. Alle writes lopen via server routes met de service role.
-- Uitzonderingen (client-side writes uit de O1 preflight-inventaris) krijgen per tabel
-- een smalle policy in een aparte, gedocumenteerde migratie.
