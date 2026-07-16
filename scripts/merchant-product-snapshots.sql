create table if not exists public.merchant_product_snapshots (
  id bigint generated always as identity primary key,
  client_id text not null,
  account_id text not null,
  offer_id text not null,
  product_name text null,
  title text not null,
  normalized_title text not null,
  brand text null,
  product_type text null,
  product_type_l1 text null,
  product_type_l2 text null,
  product_type_l3 text null,
  product_type_l4 text null,
  product_type_l5 text null,
  custom_label_0 text null,
  custom_label_1 text null,
  custom_label_2 text null,
  custom_label_3 text null,
  custom_label_4 text null,
  link text null,
  availability text null,
  price numeric(10,2) null,
  sale_price numeric(10,2) null,
  condition text null,
  language_code text null,
  feed_label text null,
  channel text null,
  custom_attributes_jsonb jsonb null,
  source_payload_jsonb jsonb null,
  snapshot_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_product_snapshots_client_offer_unique unique (client_id, account_id, offer_id)
);

alter table public.client_settings
  add column if not exists merchant_account_id text null,
  add column if not exists merchant_feed_label text null,
  add column if not exists merchant_content_language text null,
  add column if not exists merchant_channel text null;

alter table public.merchant_product_snapshots
  add column if not exists price numeric(10,2) null,
  add column if not exists sale_price numeric(10,2) null,
  add column if not exists condition text null;

create index if not exists merchant_product_snapshots_client_idx
  on public.merchant_product_snapshots (client_id);
create index if not exists merchant_product_snapshots_offer_idx
  on public.merchant_product_snapshots (offer_id);
create index if not exists merchant_product_snapshots_normalized_title_idx
  on public.merchant_product_snapshots (normalized_title);
create index if not exists merchant_product_snapshots_label0_idx
  on public.merchant_product_snapshots (custom_label_0);
create index if not exists merchant_product_snapshots_label1_idx
  on public.merchant_product_snapshots (custom_label_1);
create index if not exists merchant_product_snapshots_label2_idx
  on public.merchant_product_snapshots (custom_label_2);
create index if not exists merchant_product_snapshots_label3_idx
  on public.merchant_product_snapshots (custom_label_3);
create index if not exists merchant_product_snapshots_label4_idx
  on public.merchant_product_snapshots (custom_label_4);
create index if not exists merchant_product_snapshots_snapshot_at_idx
  on public.merchant_product_snapshots (snapshot_at desc);

alter table public.merchant_product_snapshots enable row level security;

drop policy if exists "service role merchant snapshots read" on public.merchant_product_snapshots;
create policy "service role merchant snapshots read"
  on public.merchant_product_snapshots
  for select
  to service_role
  using (true);

drop policy if exists "service role merchant snapshots write" on public.merchant_product_snapshots;
create policy "service role merchant snapshots write"
  on public.merchant_product_snapshots
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.set_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists merchant_product_snapshots_set_updated_at on public.merchant_product_snapshots;
create trigger merchant_product_snapshots_set_updated_at
before update on public.merchant_product_snapshots
for each row
execute function public.set_timestamp_updated_at();
