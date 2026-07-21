-- 030: conversie-selectie per kanaal (Meta/LinkedIn), het equivalent van Google's keuze welke
-- conversie-acties meetellen. Bepaalt welke uitkomst-velden (Meta: conversions/leads; LinkedIn:
-- one_click_leads/external_website_conversions/post_click_conversions) optellen tot de conversie
-- die de KPI's, forecasts en views gebruiken. Ontbreekt de config, dan geldt de default per
-- kanaal (lib/analysis/channel-conversion-config.ts). Idempotent en additief.
--
-- Vorm: { "meta_ads": ["conversions","leads"], "linkedin_ads": ["one_click_leads"] }

alter table client_settings add column if not exists channel_conversion_config jsonb;

comment on column client_settings.channel_conversion_config is
  'Conversie-selectie per kanaal: {meta_ads: [velden], linkedin_ads: [velden]}. Bepaalt welke conversievelden meetellen. Leeg/ontbrekend = default per kanaal.';
