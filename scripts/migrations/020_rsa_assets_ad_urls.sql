-- 020 (RSA plus W1): de gedeelde ad-niveau datalaag voor de RSA-copy-analyse en de
-- landing-page-audit. Twee tabellen: de asset-prestaties per maand (bron: de Google Ads API
-- ad_group_ad_asset_view, dezelfde data die het Ad copy insights script gebruikt) en de
-- ad-metadata met de final URL (bron: ad_group_ad). LET OP de meet-eigenschap: een RSA
-- toont meerdere assets tegelijk, dus asset-metrics tellen dubbel over assets heen en
-- mogen NOOIT als ad-totalen worden opgeteld; de analyse-kern draagt die note verplicht mee.
create table if not exists google_ads_rsa_assets (
  client_id          text not null,
  month              date not null,
  campaign_name      text,
  ad_group_name      text,
  ad_id              text not null,
  asset_id           text not null,
  field_type         text not null check (field_type in ('HEADLINE','DESCRIPTION')),
  asset_text         text not null,
  pinned_field       text,
  performance_label  text check (performance_label in ('BEST','GOOD','LOW','LEARNING','PENDING','UNKNOWN')),
  impressions        bigint not null default 0,
  clicks             bigint not null default 0,
  conversions        numeric(12,2) not null default 0,
  cost               numeric(14,2) not null default 0,
  synced_at          timestamptz not null default now(),
  primary key (client_id, month, ad_id, asset_id)
);
create index if not exists idx_rsa_assets_client_month on google_ads_rsa_assets (client_id, month);

create table if not exists google_ads_ad_meta (
  client_id      text not null,
  ad_id          text not null,
  campaign_name  text,
  ad_group_name  text,
  ad_type        text,
  final_url      text,
  status         text,
  updated_at     timestamptz not null default now(),
  primary key (client_id, ad_id)
);
create index if not exists idx_ad_meta_client on google_ads_ad_meta (client_id);

alter table google_ads_rsa_assets enable row level security;
alter table google_ads_ad_meta enable row level security;
