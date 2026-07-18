-- 024 (R1): RAI event-configuratie per klant. Slaat per klant een lijst van beurzen/geo-clones
-- op met hun cadans (jaarlijks/2-jaarlijks/anders) en de datums van de afgelopen edities. Deze
-- input voedt de event-relatieve vergelijking en forecast (lib/rai/event-comparison + event-
-- forecast): daarmee weet het dashboard met WELKE vorige editie de huidige data vergeleken moet
-- worden. Idempotent en additief.
--
-- Vorm: { "events": [ { "id": "...", "name": "GreenTech Amsterdam", "abbrev": "GTA",
--   "cadence": "annual" | "biennial" | "custom", "editions": [ { "date": "2026-03-17",
--   "label": "2026" } ] } ] }
--
-- Bewust op client_settings (jsonb), spiegelt kpi_targets/brand_guide. Zodra geo-clones een
-- eigen entiteit-laag krijgen, verhuist dit per geo-clone; tot dan draagt de events-lijst de
-- geo-clone-splitsing.
alter table client_settings add column if not exists rai_events jsonb;

comment on column client_settings.rai_events is
  'R1: beurs/geo-clone event-configuratie: { events: [{ id, name, abbrev, cadence, editions:[{date,label}] }] }. Voedt de event-relatieve vergelijking en forecast.';
