-- 031: Meta uur-performance voor de dagdeel-efficiëntie-detector (lib/signals/hourly-dayparting).
-- Meta levert een hourly breakdown (hourly_stats_aggregated_by_advertiser_time_zone); die uur-data
-- middelen de dag- en maandtotalen weg, terwijl een structureel duur dagdeel (bv. nacht) stuurbaar
-- is via een bod-/budget-schema. Idempotent en additief.
--
-- LIVE-SYNC nog te bedraden: de fetch van de hourly breakdown in de Meta-sync vergt API-toegang en
-- is pas met echte keys te verifiëren. Deze tabel + de detector + de demo-mock staan klaar zodat de
-- analyse draait zodra de sync de uur-data vult.

create table if not exists meta_hourly_performance (
  client_id text not null,
  date date not null,
  hour smallint not null,               -- 0..23 in de advertiser-tijdzone
  impressions bigint,
  link_clicks bigint,
  spend numeric,
  conversions numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, hour)
);
create index if not exists idx_meta_hourly_performance_lookup on meta_hourly_performance (client_id, date);

comment on table meta_hourly_performance is
  'Meta uur-performance (hourly breakdown) per dag/uur voor de dagdeel-efficiëntie-detector. LIVE-sync nog te bedraden.';
