-- 014 (X1): blended maandview. NIET DRAAIEN buiten fase X1.
-- W0.1-aanvulling: naast de bestaande Google-TODO's moeten OOK de Meta- en LinkedIn-
-- verwijzingen herschreven worden op de canonieke kolommen uit 007 en 008:
-- entity_id (meta daily), entity_urn (linkedin daily), conversions_value (Google, meervoud)
-- versus conversion_value (Meta en LinkedIn, enkelvoud). Mismatch = view-fout, geen dataschade.
-- 012 (X1): blended maandview over de kanalen heen.
-- LET OP: pas uitvoeren tijdens X1, NA verificatie van de kolomnamen van ads_account_monthly
-- (Google draait op maand-grein; Meta en LinkedIn worden hier vanaf dag-grein geaggregeerd).
-- De TODO-markeringen hieronder MOETEN vervangen worden door de echte kolomnamen uit de
-- bestaande Google-tabellen voordat deze file draait. Mismatch = view-fout, geen dataschade.
--
-- Spelregel voor de UI (X1): bedragen alleen optellen over kanalen met GELIJKE valuta;
-- anders per valuta groeperen. Elk kanaal meet bovendien zijn eigen attributie, dus de
-- blended som is indicatief; de view levert de bouwstenen, de voetnoot hoort in de UI.

create or replace view blended_account_monthly as
select
  client_id,
  month,                                   -- TODO: verifieer kolomnaam (maand-kolom in ads_account_monthly)
  'google_ads'::text  as channel,
  null::text          as currency,         -- TODO: valuta-bron voor Google bevestigen of hardcoden per account
  impressions,                             -- TODO: verifieer kolomnaam
  clicks,                                  -- TODO: verifieer kolomnaam
  cost                as spend,            -- TODO: verifieer kolomnaam (cost of spend)
  conversions,                             -- TODO: verifieer kolomnaam
  conversion_value,                        -- TODO: verifieer kolomnaam
  null::numeric       as leads
from ads_account_monthly

union all

select
  m.client_id,
  (date_trunc('month', m.date))::date as month,
  'meta_ads'::text    as channel,
  c.currency,
  sum(m.impressions)                  as impressions,
  sum(m.link_clicks)                  as clicks,
  sum(m.spend)                        as spend,
  sum(m.conversions)                  as conversions,
  sum(m.conversion_value)             as conversion_value,
  sum(m.leads)                        as leads
from meta_account_daily m
left join meta_connections c using (client_id)
group by m.client_id, date_trunc('month', m.date), c.currency

union all

select
  l.client_id,
  (date_trunc('month', l.date))::date as month,
  'linkedin_ads'::text as channel,
  c.currency,
  sum(l.impressions)                   as impressions,
  sum(l.clicks)                        as clicks,
  sum(l.spend)                         as spend,
  sum(l.external_website_conversions)  as conversions,
  sum(l.conversion_value)              as conversion_value,
  sum(l.one_click_leads)::numeric      as leads
from linkedin_account_daily l
left join linkedin_connections c using (client_id)
group by l.client_id, date_trunc('month', l.date), c.currency;
