-- Monthly pipeline v2 additions
-- Run in Supabase SQL editor before enabling the new monthly route.

create table if not exists public.google_ads_product_performance (
  id uuid default gen_random_uuid() primary key,
  client_id text not null,
  date date not null,
  campaign_id text null,
  campaign_name text null,
  ad_group_id text null,
  ad_group_name text null,
  product_item_id text not null,
  product_title text null,
  product_type_l1 text null,
  product_type_l2 text null,
  product_type_l3 text null,
  product_type_l4 text null,
  product_type_l5 text null,
  product_brand text null,
  custom_label_0 text null,
  custom_label_1 text null,
  custom_label_2 text null,
  custom_label_3 text null,
  custom_label_4 text null,
  mc_availability text null,
  mc_price numeric(10,2) null,
  mc_sale_price numeric(10,2) null,
  mc_condition text null,
  impressions integer default 0,
  clicks integer default 0,
  cost numeric(10,2) default 0,
  conversions numeric(10,2) default 0,
  conversion_value numeric(10,2) default 0,
  ctr numeric(8,6) generated always as (
    case when impressions > 0 then clicks::numeric / impressions else 0 end
  ) stored,
  cpc numeric(10,2) generated always as (
    case when clicks > 0 then cost / clicks else 0 end
  ) stored,
  conversion_rate numeric(8,6) generated always as (
    case when clicks > 0 then conversions / clicks else 0 end
  ) stored,
  cpa numeric(10,2) generated always as (
    case when conversions > 0 then cost / conversions else 0 end
  ) stored,
  roas numeric(10,2) generated always as (
    case when cost > 0 then conversion_value / cost else 0 end
  ) stored,
  created_at timestamptz default now(),
  unique (client_id, date, campaign_id, ad_group_id, product_item_id)
);

create index if not exists idx_google_ads_product_perf_client_date
  on public.google_ads_product_performance (client_id, date);
create index if not exists idx_google_ads_product_perf_label0
  on public.google_ads_product_performance (client_id, custom_label_0);
create index if not exists idx_google_ads_product_perf_item
  on public.google_ads_product_performance (client_id, product_item_id);

create table if not exists public.google_ads_checkout_funnel (
  id uuid default gen_random_uuid() primary key,
  client_id text not null,
  date date not null,
  campaign_id text null,
  campaign_name text null,
  device text null,
  sessions integer null,
  add_to_cart_count integer default 0,
  add_to_cart_value numeric(10,2) default 0,
  begin_checkout_count integer default 0,
  begin_checkout_value numeric(10,2) default 0,
  purchase_count integer default 0,
  purchase_value numeric(10,2) default 0,
  atc_to_checkout_rate numeric(8,4) generated always as (
    case when add_to_cart_count > 0 then begin_checkout_count::numeric / add_to_cart_count else 0 end
  ) stored,
  checkout_to_purchase_rate numeric(8,4) generated always as (
    case when begin_checkout_count > 0 then purchase_count::numeric / begin_checkout_count else 0 end
  ) stored,
  overall_conversion_rate numeric(8,4) generated always as (
    case when add_to_cart_count > 0 then purchase_count::numeric / add_to_cart_count else 0 end
  ) stored,
  created_at timestamptz default now(),
  unique (client_id, date, campaign_id, device)
);

create index if not exists idx_google_ads_checkout_funnel_client
  on public.google_ads_checkout_funnel (client_id, date);

alter table public.client_settings
  add column if not exists checkout_action_map jsonb null;
