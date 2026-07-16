-- O2: tijdsgebonden targets per klant, kanaal en metric. Vervangt het platte kpiTargets-object
-- (roasTarget, cpaTarget, DEFAULT 0) door versioned targets met geldigheidsperiodes, zodat een
-- verkeerd of verouderd target niet meer de hele analyse vervuilt en er nooit tegen 0 wordt
-- vergeleken. Idempotent en additief: de oude velden blijven read-only staan tot de UI om is en
-- worden in een opvolg-migratie verwijderd.

create table if not exists client_targets (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  channel text not null,          -- google_ads / meta_ads / linkedin_ads
  metric text not null,           -- cpa / roas / cpl / conversions / spend / conversion_value
  target_value numeric not null,
  valid_from date not null,       -- de eerste van de ingangsmaand
  valid_to date,                  -- null = open einde
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (client_id, channel, metric, valid_from)
);
create index if not exists idx_client_targets_lookup on client_targets (client_id, channel);

comment on table client_targets is
  'Versioned targets per klant, kanaal en metric (O2). resolveTargets pakt per metric de rij met de laatste valid_from <= de geanalyseerde maand waarvoor valid_to null of >= de maand is. Nul of ontbrekend betekent expliciet: geen target.';

-- Eenmalige migratie van bestaande niet-nul kpiTargets naar google_ads-rijen met valid_from de
-- eerste van de huidige maand. Alleen uitvoeren als de oude waarden in een Supabase-tabel staan;
-- pas de bron-subquery aan op de werkelijke opslag (volg lib/client-settings.ts). Idempotent via
-- de unique-constraint plus on conflict do nothing. Voorbeeld, aan te passen aan de echte brontabel:
--
-- insert into client_targets (client_id, channel, metric, target_value, valid_from, note, created_by)
-- select client_id, 'google_ads', 'cpa', cpa_target, date_trunc('month', now())::date, 'Migratie uit kpiTargets', 'system'
-- from client_settings where cpa_target is not null and cpa_target > 0
-- on conflict (client_id, channel, metric, valid_from) do nothing;
--
-- insert into client_targets (client_id, channel, metric, target_value, valid_from, note, created_by)
-- select client_id, 'google_ads', 'roas', roas_target, date_trunc('month', now())::date, 'Migratie uit kpiTargets', 'system'
-- from client_settings where roas_target is not null and roas_target > 0
-- on conflict (client_id, channel, metric, valid_from) do nothing;
