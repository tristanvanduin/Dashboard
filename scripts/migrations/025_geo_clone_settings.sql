-- 025: per geo-clone een eigen laag instellingen (branding, doelstellingen, event-datums) MET
-- account-fallback. Fase 2 van de geo-clone-projecten. Elke beurs/geo-clone binnen een account
-- (onderscheiden door de afkorting in de campagnenaam, bijv. GRT/GRA/GRN) kan afwijkende
-- branding, doelen en edities hebben; laat een veld leeg, dan valt de resolver terug op het
-- account-niveau (client_settings.brand_guide / kpi_targets / rai_events). Idempotent en
-- additief. De fallback-logica zelf leeft in lib/rai/geo-clone-settings.ts (los getest).
--
-- Sleutel: (client_id, geo_clone) waarbij geo_clone de afkorting is (hoofdletters), dezelfde
-- sleutel die het dashboard als beurs-scope gebruikt.
--
-- Vormen (jsonb, allemaal optioneel — leeg = erf van account):
--   branding: { brandName, primaryColor, accentColor, secondaryColor, logoUrl, headingFont }
--   goals:    { conversionsAbsolute, revenueAbsolute, roasTarget, cpaTarget }
--   event:    { cadence: "annual"|"biennial"|"custom", editions: [{ date, label }] }

-- client_id is text (spiegelt client_settings/client_notes; er is geen aparte clients-tabel).
create table if not exists geo_clone_settings (
  client_id  text    not null,
  geo_clone  text    not null,
  branding   jsonb,
  goals      jsonb,
  event      jsonb,
  updated_at timestamptz not null default now(),
  primary key (client_id, geo_clone)
);

comment on table geo_clone_settings is
  'Fase 2 geo-clone-projecten: per (client_id, geo_clone) afwijkende branding/goals/event met account-fallback (zie lib/rai/geo-clone-settings.ts). Leeg veld = erf van client_settings.';

create index if not exists geo_clone_settings_client_idx on geo_clone_settings (client_id);
