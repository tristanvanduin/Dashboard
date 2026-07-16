-- M1: Meta (Facebook) Ads datamodel.
-- Per entiteitsniveau en tijdsgrein een tabel met brede, getypeerde metriekkolommen
-- plus een raw jsonb voor het volledige API-payload. Breakdowns in EEN long-format
-- tabel (breakdown_type, breakdown_value), zodat het aantal tabellen niet explodeert.
-- Raakt geen bestaande Google-tabellen. Idempotent: veilig om meerdere keren te draaien.

-- ── Entiteiten ────────────────────────────────────────────────────────────────

create table if not exists meta_campaigns (
  campaign_id text primary key,
  client_id text not null,
  name text,
  objective text,
  status text,
  effective_status text,
  daily_budget numeric,
  lifetime_budget numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_meta_campaigns_client on meta_campaigns (client_id);

create table if not exists meta_adsets (
  adset_id text primary key,
  campaign_id text,
  client_id text not null,
  name text,
  status text,
  effective_status text,
  optimization_goal text,
  billing_event text,
  daily_budget numeric,
  bid_amount numeric,
  destination_type text,
  learning_stage_info jsonb,
  targeting_summary jsonb,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_meta_adsets_client on meta_adsets (client_id);
create index if not exists idx_meta_adsets_campaign on meta_adsets (campaign_id);

create table if not exists meta_ads (
  ad_id text primary key,
  adset_id text,
  campaign_id text,
  client_id text not null,
  name text,
  status text,
  effective_status text,
  creative_id text,
  created_time timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_meta_ads_client on meta_ads (client_id);
create index if not exists idx_meta_ads_adset on meta_ads (adset_id);

-- ── Daily metrieken per niveau ────────────────────────────────────────────────
-- Vier tabellen met dezelfde getypeerde metriekkolommen. entity_id is het id van
-- het niveau (account, campaign, adset, ad). Uniek op (client_id, date, entity_id).
-- Money en ratio's numeric, tellingen bigint. Afgeleide kolommen (hook_rate,
-- hold_rate, ctr_link, cpa, roas) worden bij sync berekend en hier opgeslagen.

create table if not exists meta_account_daily (
  client_id text not null,
  date date not null,
  entity_id text not null,
  impressions bigint,
  views bigint,
  reach bigint,
  frequency numeric,
  clicks_all bigint,
  link_clicks bigint,
  spend numeric,
  cpm numeric,
  cpc_link numeric,
  ctr_link numeric,
  conversions numeric,
  conversion_value numeric,
  purchase_roas numeric,
  cpa numeric,
  roas numeric,
  leads numeric,
  add_to_cart numeric,
  initiate_checkout numeric,
  landing_page_views numeric,
  video_3s_views bigint,
  video_thruplay bigint,
  video_p25 bigint,
  video_p50 bigint,
  video_p75 bigint,
  video_p100 bigint,
  post_engagement bigint,
  hook_rate numeric,
  hold_rate numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, entity_id)
);
create index if not exists idx_meta_account_daily_lookup on meta_account_daily (client_id, date);

create table if not exists meta_campaign_daily (like meta_account_daily including all);
create table if not exists meta_adset_daily (like meta_account_daily including all);

-- Ad-level krijgt de drie ranking-kolommen extra.
create table if not exists meta_ad_daily (
  client_id text not null,
  date date not null,
  entity_id text not null,
  impressions bigint,
  views bigint,
  reach bigint,
  frequency numeric,
  clicks_all bigint,
  link_clicks bigint,
  spend numeric,
  cpm numeric,
  cpc_link numeric,
  ctr_link numeric,
  conversions numeric,
  conversion_value numeric,
  purchase_roas numeric,
  cpa numeric,
  roas numeric,
  leads numeric,
  add_to_cart numeric,
  initiate_checkout numeric,
  landing_page_views numeric,
  video_3s_views bigint,
  video_thruplay bigint,
  video_p25 bigint,
  video_p50 bigint,
  video_p75 bigint,
  video_p100 bigint,
  post_engagement bigint,
  hook_rate numeric,
  hold_rate numeric,
  quality_ranking text,
  engagement_rate_ranking text,
  conversion_rate_ranking text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, entity_id)
);
create index if not exists idx_meta_ad_daily_lookup on meta_ad_daily (client_id, date);

-- ── Breakdowns (long format, bewust) ──────────────────────────────────────────
-- Een rij per (dag, niveau, entiteit, breakdown_type, breakdown_value). Subset van
-- de metrieken. Voorkomt kolom- of tabel-explosie bij leeftijd, geslacht, placement,
-- device en regio.

create table if not exists meta_breakdown_daily (
  client_id text not null,
  date date not null,
  level text not null,
  entity_id text not null,
  breakdown_type text not null,
  breakdown_value text not null,
  impressions bigint,
  clicks_all bigint,
  link_clicks bigint,
  spend numeric,
  conversions numeric,
  conversion_value numeric,
  video_3s_views bigint,
  video_thruplay bigint,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, level, entity_id, breakdown_type, breakdown_value)
);
create index if not exists idx_meta_breakdown_daily_lookup on meta_breakdown_daily (client_id, date, level, breakdown_type);

-- ── Sync-administratie ────────────────────────────────────────────────────────

create table if not exists meta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  scope text,
  rows_upserted jsonb,
  status text,
  error text
);
create index if not exists idx_meta_sync_runs_client on meta_sync_runs (client_id, started_at);

-- ── Addenda uit consolidatie W0.1 (juni-set) ──

create table if not exists meta_connections (
  client_id        text primary key,
  ad_account_id    text not null,
  token_ref        text not null,
  token_expires_at timestamptz,
  currency         text,
  account_timezone text,
  status           text not null default 'active' check (status in ('active','expired','error','disabled')),
  last_sync_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists meta_creatives (
  creative_id        text primary key,
  client_id          text not null,
  format             text check (format in ('single_image','video','carousel','dynamic','catalog','unknown')),
  title              text,
  body               text,
  call_to_action_type text,
  link_url           text,
  image_hash         text,
  video_id           text,
  thumbnail_url      text,
  asset_feed         jsonb,
  storage_paths      jsonb not null default '{}'::jsonb,
  raw                jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists meta_change_log (
  id             bigint generated always as identity primary key,
  client_id      text not null,
  event_time     timestamptz not null,
  object_type    text,
  object_id      text,
  change_summary text,
  raw            jsonb,
  created_at     timestamptz not null default now(),
  unique (client_id, event_time, object_type, object_id, change_summary)
);

-- Extra campagne-metadata (juni-set):
alter table meta_campaigns add column if not exists buying_type text;
alter table meta_campaigns add column if not exists bid_strategy text;
alter table meta_campaigns add column if not exists start_time timestamptz;
alter table meta_campaigns add column if not exists stop_time timestamptz;

-- RLS: enable-regels voor deze tabellen activeren bij de eigen fase-deploy NA O1 (zie 017_rls_lockdown.sql).
