-- 026: doelgroep-profiel per klant voor de cross-channel doelgroep-samenhang-check
-- (lib/cross-channel/audience-coherence.ts, bedraad via /api/analysis/cross-channel).
-- Het profiel beschrijft per kanaal de GEWENSTE doelgroep per dimensie; de check vergelijkt
-- de converterende segmenten (uit linkedin_demographic_daily) tegen dit profiel en flagt een
-- strategische tegenspraak boven de drempel. Ontbreekt het profiel, dan degradeert de check
-- expliciet (geen stil gokken). Idempotent en additief.
--
-- Vorm: { "google_ads": { "job_function": ["marketing","it"], "seniority": ["senior"] },
--          "meta_ads": { ... } }  -- dimensies: job_function|seniority|industry|company_size|age|gender|geo

alter table client_settings add column if not exists audience_profile jsonb;

comment on column client_settings.audience_profile is
  'Doelgroep-profiel per kanaal per dimensie voor de cross-channel samenhang-check: {channel: {dimension: [waarden]}}. Leeg = check degradeert expliciet.';
