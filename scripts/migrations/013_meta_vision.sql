-- 009 (M3): creative vision features (pixel-laag plus semantische laag) en pattern-aggregatie.

create table if not exists meta_creative_visual_features (
  creative_id        text not null,
  asset_key          text not null,
  client_id          text not null,
  analyzed_at        timestamptz not null default now(),
  features_version   integer not null default 1,
  model              text,
  prompt_hash        text,
  -- Pixel-laag (deterministisch, sharp)
  width              integer,
  height             integer,
  aspect_ratio       numeric(6,3),
  dominant_colors    jsonb,
  avg_brightness     numeric(6,2),
  contrast           numeric(6,2),
  saturation         numeric(6,2),
  is_dark_mode       boolean,
  -- Vision-laag (gestructureerd, temperature 0, Zod-gevalideerd)
  style              text check (style in ('ugc','studio','product','lifestyle','meme','screenshot','text_card','3d','unknown')),
  human_present      boolean,
  human_count        integer,
  face_close_up      boolean,
  gaze_at_camera     boolean,
  product_visible    boolean,
  product_prominence text check (product_prominence in ('dominant','aanwezig','afwezig')),
  text_overlay_present boolean,
  text_coverage_pct_estimate numeric(5,2),
  ocr_text           text,
  headline_in_visual text,
  text_readability   text check (text_readability in ('goed','matig','slecht')),
  logo_present       boolean,
  logo_position      text,
  cta_in_visual      boolean,
  hook_element       text,
  composition        text check (composition in ('center','thirds','collage','unknown')),
  background         text,
  color_mood         text,
  emotion            text,
  claim_type         text check (claim_type in ('prijs','social_proof','probleem_oplossing','demo','aanbieding','geen')),
  safe_zone_risk     boolean,
  confidence         jsonb,
  raw_vision         jsonb,
  created_at         timestamptz not null default now(),
  primary key (creative_id, asset_key)
);
create index if not exists idx_visual_features_client on meta_creative_visual_features (client_id, features_version);

create table if not exists meta_creative_patterns (
  id            bigint generated always as identity primary key,
  client_id     text not null,
  period_start  date not null,
  period_end    date not null,
  attribute     text not null,
  value         text not null,
  metric        text not null check (metric in ('link_ctr','hook_rate','hold_rate','cvr','cpa','roas')),
  n_ads         integer not null,
  impressions   bigint not null,
  conversions   numeric(12,2),
  pattern_value numeric(14,5),
  account_avg   numeric(14,5),
  lift_pct      numeric(8,2),
  evidence_level text not null check (evidence_level in ('deterministic','inferred')),
  computed_at   timestamptz not null default now(),
  unique (client_id, period_start, attribute, value, metric)
);
create index if not exists idx_creative_patterns_lookup on meta_creative_patterns (client_id, period_start, evidence_level);

-- RLS (activeren zodra O1 live is): enable plus authenticated_read per tabel, zie 015.
