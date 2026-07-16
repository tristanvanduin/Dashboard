-- Fix: impressions en clicks kolommen naar bigint
-- integer max = 2.147.483.647, te klein voor geaggregeerde land-totalen

ALTER TABLE ads_country_monthly
  ALTER COLUMN impressions TYPE bigint,
  ALTER COLUMN clicks TYPE bigint;

ALTER TABLE ads_country_weekly
  ALTER COLUMN impressions TYPE bigint,
  ALTER COLUMN clicks TYPE bigint;

ALTER TABLE ads_campaign_country_monthly
  ALTER COLUMN impressions TYPE bigint,
  ALTER COLUMN clicks TYPE bigint;
