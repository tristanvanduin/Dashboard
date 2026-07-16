-- L1: LinkedIn Ads datamodel.
-- Per entiteitsniveau en tijdsgrein een tabel met brede, getypeerde metriekkolommen plus
-- een raw jsonb voor het volledige API-payload. Demografie in EEN long-format tabel met de
-- zes member-pivottypes als eersteklas data (de unieke analysewaarde van LinkedIn), met
-- coverage_pct op de TOTAL-samenvattingsrij. Raakt geen bestaande Google- of Meta-tabellen.
-- Idempotent: veilig om meerdere keren te draaien. Kolomnamen exact gelijk aan lib/linkedin/rows.ts.

-- ── Connectie en sync-administratie ─────────────────────────────────────────────

create table if not exists linkedin_connections (
  client_id text primary key,
  ad_account_urn text,
  token_ref text,
  refresh_token_ref text,
  token_expires_at timestamptz,
  refresh_expires_at timestamptz,
  status text,
  last_sync_at timestamptz,
  last_error text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists linkedin_sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  scope text,
  rows_upserted jsonb,
  calls_made integer,
  status text,
  error text
);
create index if not exists idx_linkedin_sync_runs_client on linkedin_sync_runs (client_id, started_at);

-- ── Entiteiten ──────────────────────────────────────────────────────────────────

create table if not exists linkedin_campaign_groups (
  group_urn text primary key,
  client_id text not null,
  name text,
  status text,
  total_budget numeric,
  start_date date,
  end_date date,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_linkedin_campaign_groups_client on linkedin_campaign_groups (client_id);

create table if not exists linkedin_campaigns (
  campaign_urn text primary key,
  group_urn text,
  client_id text not null,
  name text,
  status text,
  type text,
  objective_type text,
  cost_type text,
  daily_budget numeric,
  unit_cost numeric,
  bid_strategy text,
  offsite_delivery_enabled boolean,
  targeting_summary jsonb,
  audience_count_estimate bigint,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_linkedin_campaigns_client on linkedin_campaigns (client_id);
create index if not exists idx_linkedin_campaigns_group on linkedin_campaigns (group_urn);

create table if not exists linkedin_creatives (
  creative_urn text primary key,
  campaign_urn text,
  client_id text not null,
  status text,
  format text,
  post_urn text,
  post_text text,
  headline text,
  cta_label text,
  landing_url text,
  image_storage_path text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_linkedin_creatives_client on linkedin_creatives (client_id);
create index if not exists idx_linkedin_creatives_campaign on linkedin_creatives (campaign_urn);

-- ── Dagelijkse performance per entiteitsniveau ──────────────────────────────────
-- Identieke metriekkolommen; entity_urn draagt de account-, campagne- of creative-URN.

create table if not exists linkedin_account_daily (
  client_id text not null,
  date date not null,
  entity_urn text not null,
  impressions bigint,
  clicks bigint,
  spend numeric,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  landing_page_clicks bigint,
  one_click_lead_form_opens bigint,
  one_click_leads bigint,
  external_website_conversions bigint,
  post_click_conversions bigint,
  conversion_value numeric,
  cpl numeric,
  form_completion_rate numeric,
  video_starts bigint,
  video_views bigint,
  video_completions bigint,
  video_completion_rate numeric,
  total_engagements bigint,
  follows bigint,
  reactions bigint,
  comments bigint,
  shares bigint,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, entity_urn)
);
create index if not exists idx_linkedin_account_daily_lookup on linkedin_account_daily (client_id, date);

create table if not exists linkedin_campaign_daily (
  client_id text not null,
  date date not null,
  entity_urn text not null,
  impressions bigint,
  clicks bigint,
  spend numeric,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  landing_page_clicks bigint,
  one_click_lead_form_opens bigint,
  one_click_leads bigint,
  external_website_conversions bigint,
  post_click_conversions bigint,
  conversion_value numeric,
  cpl numeric,
  form_completion_rate numeric,
  video_starts bigint,
  video_views bigint,
  video_completions bigint,
  video_completion_rate numeric,
  total_engagements bigint,
  follows bigint,
  reactions bigint,
  comments bigint,
  shares bigint,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, entity_urn)
);
create index if not exists idx_linkedin_campaign_daily_lookup on linkedin_campaign_daily (client_id, date);

create table if not exists linkedin_creative_daily (
  client_id text not null,
  date date not null,
  entity_urn text not null,
  impressions bigint,
  clicks bigint,
  spend numeric,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  landing_page_clicks bigint,
  one_click_lead_form_opens bigint,
  one_click_leads bigint,
  external_website_conversions bigint,
  post_click_conversions bigint,
  conversion_value numeric,
  cpl numeric,
  form_completion_rate numeric,
  video_starts bigint,
  video_views bigint,
  video_completions bigint,
  video_completion_rate numeric,
  total_engagements bigint,
  follows bigint,
  reactions bigint,
  comments bigint,
  shares bigint,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, entity_urn)
);
create index if not exists idx_linkedin_creative_daily_lookup on linkedin_creative_daily (client_id, date);

-- ── Demografie (long format, zes member-pivottypes) ─────────────────────────────
-- Een rij per segment per dag. coverage_pct staat op de samenvattingsrij (pivot_value_urn = TOTAL):
-- som van de zichtbare segment-impressies gedeeld door het dagtotaal, zodat privacy-onderdrukking
-- expliciet en eerlijk naar L2 gaat.

create table if not exists linkedin_demographic_daily (
  client_id text not null,
  date date not null,
  level text not null,
  entity_urn text not null,
  pivot_type text not null,
  pivot_value_urn text not null,
  impressions bigint,
  clicks bigint,
  spend numeric,
  leads bigint,
  conversions bigint,
  coverage_pct numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, level, entity_urn, pivot_type, pivot_value_urn)
);
create index if not exists idx_linkedin_demographic_daily_lookup on linkedin_demographic_daily (client_id, date);
create index if not exists idx_linkedin_demographic_daily_pivot on linkedin_demographic_daily (client_id, pivot_type, date);

-- ── URN-label cache ─────────────────────────────────────────────────────────────
-- Vertaalt functie-, industrie- en regio-URNs naar leesbare namen; val terug op de URN
-- als een label ontbreekt. Globaal (niet per client).

create table if not exists linkedin_urn_labels (
  urn text primary key,
  label text,
  taxonomy text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Optioneel: lead-form responses (alleen bij de leadgen-permissie) ─────────────
-- Blijft optioneel; zonder de permissie wordt de funnel-stap in L2 gevoed met form_opens
-- en leads uit adAnalytics in plaats van deze tabellen.

create table if not exists linkedin_lead_forms (
  form_urn text primary key,
  client_id text not null,
  name text,
  status text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_linkedin_lead_forms_client on linkedin_lead_forms (client_id);

create table if not exists linkedin_lead_form_daily (
  client_id text not null,
  date date not null,
  form_urn text not null,
  opens bigint,
  submissions bigint,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, form_urn)
);
create index if not exists idx_linkedin_lead_form_daily_lookup on linkedin_lead_form_daily (client_id, date);

-- ── Addendum uit consolidatie W0.1 (juni-set) ──
alter table linkedin_connections add column if not exists currency text;

-- RLS: enable-regels voor deze tabellen activeren bij de eigen fase-deploy NA O1 (zie 017_rls_lockdown.sql).
