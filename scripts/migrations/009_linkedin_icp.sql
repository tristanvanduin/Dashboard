-- L2: ICP-definitie per client op client_settings, de basis voor de ICP-fit in stap 5.
-- Vorm: { job_functions: [], seniorities: [], industries: [], company_sizes: [] } met URNs plus
-- leesbare labels. Zonder ingevulde ICP degradeert stap 5 naar beschrijvend (geen fit-score);
-- de run faalt er niet op. Idempotent en additief: raakt geen bestaande kolommen of data.

alter table if exists client_settings
  add column if not exists linkedin_icp jsonb;

comment on column client_settings.linkedin_icp is
  'LinkedIn ICP-definitie: { job_functions, seniorities, industries, company_sizes } met URNs plus labels. Leeg of null laat de ICP-fit-stap naar beschrijvend degraderen.';
