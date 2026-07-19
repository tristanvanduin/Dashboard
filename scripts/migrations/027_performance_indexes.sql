-- 027: prestatie-indexen op de grote tabellen. Elke dashboard- en analyse-query filtert op
-- client_id plus een periode (month / week_start / date), maar de grote tabellen hadden alleen
-- een primary-key-index — dus full table scans over honderdduizenden rijen zodra er echte data
-- staat. Deze samengestelde indexen (client_id first, dan de tijd-as) dekken de vaste
-- filtervorm. Idempotent; CONCURRENTLY kan niet binnen de Management-API-transactie, dus plain
-- CREATE INDEX IF NOT EXISTS (acceptabel: eenmalige migratie, tabellen zijn nog klein).

create index if not exists idx_stm_client_month on ads_search_terms_monthly (client_id, month);
create index if not exists idx_stw_client_week on ads_search_terms_wasteful (client_id, week_start);
-- schedule-tabel heeft geen tijd-kolom; wordt op client_id + cost desc (limit 200) bevraagd.
create index if not exists idx_asp_client_cost on ads_ad_schedule_performance (client_id, cost desc);
create index if not exists idx_kpm_client_month on ads_keyword_performance_monthly (client_id, month);
create index if not exists idx_creative_client_month on ads_creative_performance (client_id, month);
create index if not exists idx_device_client_month on ads_device_performance_monthly (client_id, month);
create index if not exists idx_adgroup_client_month on ads_adgroup_monthly (client_id, month);
create index if not exists idx_network_client_month on ads_network_performance_monthly (client_id, month);
create index if not exists idx_cm_client_month on ads_campaign_monthly (client_id, month);
create index if not exists idx_cis_client_month on ads_campaign_impression_share (client_id, month);
create index if not exists idx_am_client_month on ads_account_monthly (client_id, month);
create index if not exists idx_aw_client_week on ads_account_weekly (client_id, week_start);

-- Kanaal-dagtabellen: de signaal-/funnel-/KPI-routes filteren op client_id + date.
create index if not exists idx_mad_client_date on meta_account_daily (client_id, date);
create index if not exists idx_mcd_client_date on meta_campaign_daily (client_id, date);
create index if not exists idx_madl_client_date on meta_ad_daily (client_id, date);
create index if not exists idx_lad_client_date on linkedin_account_daily (client_id, date);
create index if not exists idx_lcd_client_date on linkedin_campaign_daily (client_id, date);
create index if not exists idx_ldd_client_date on linkedin_demographic_daily (client_id, date);

-- sop_analysis_output wordt per (client_id, sop_type, section) opgevraagd door elke analyse-GET.
create index if not exists idx_sao_client_type_section on sop_analysis_output (client_id, sop_type, section, analysis_date desc);
