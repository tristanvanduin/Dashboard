-- 022 (categorie G): de negatieve zoekwoorden, de laatste ontbrekende datalaag voor de
-- conflictchecker. Drie niveaus, want een negative kan op alle drie leven en een checker
-- die er een mist geeft VALSE GERUSTSTELLING: "geen conflicten" terwijl de hoofdbron niet
-- gekeken is. Gedeelde lijsten zijn juist bij een agency de gebruikelijke manier.
--
-- level: 'campaign' | 'ad_group' | 'shared_set'
-- Bij shared_set draagt list_name de lijstnaam en campaign_name de campagne waaraan de lijst
-- gekoppeld is. Een lijst aan meerdere campagnes levert dus meerdere rijen op; dat is
-- bedoeld, want een conflict is altijd per campagne.
--
-- LET OP de lege strings in plaats van null: Postgres staat geen expressies (coalesce) toe
-- in een PRIMARY KEY, dus de optionele niveaus krijgen '' als default. Daardoor blijft de
-- sleutel een gewone kolommenlijst en werkt de upsert-onConflict.
create table if not exists ads_negative_keywords (
  client_id      text not null,
  level          text not null check (level in ('campaign', 'ad_group', 'shared_set')),
  campaign_name  text not null default '',
  ad_group_name  text not null default '',
  list_name      text not null default '',
  keyword_text   text not null,
  match_type     text not null,
  synced_at      timestamptz not null default now(),
  primary key (client_id, level, campaign_name, ad_group_name, list_name, keyword_text, match_type)
);
create index if not exists idx_negative_keywords_client on ads_negative_keywords (client_id);

alter table ads_negative_keywords enable row level security;
