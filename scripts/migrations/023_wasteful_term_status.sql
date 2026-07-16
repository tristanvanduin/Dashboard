-- 023 (hygiene): de zoekterm-STATUS krijgt zijn eigen kolom.
--
-- ads_search_terms_wasteful.match_type bevatte nooit een match-type. De sync mapte
-- search_term_view.status erin (ADDED, EXCLUDED, ADDED_EXCLUDED, NONE): de vraag of een
-- zoekterm al als keyword is toegevoegd of uitgesloten. De kolomnaam beloofde iets anders
-- dan hij bevatte, en lib/types/dimensional.ts documenteerde hem zelfs als "EXACT, PHRASE,
-- BROAD". Niemand las hem, dus er is geen schade, maar het is een val voor de volgende
-- lezer: die vertrouwt de naam.
--
-- Vanaf nu schrijft de sync de status naar term_status en laat hij match_type met rust.
-- De oude waarden blijven staan (ze zijn ongelezen en verwijderen zou data weggooien voor
-- niets); de kolom vult zich vanzelf niet meer met onzin. Wil je het echte match-type in
-- deze tabel, dan hoort segments.search_term_match_type in de query, met dezelfde
-- aggregatie-fix als bij ads_search_terms_monthly, want dat segment splitst rijen.
alter table ads_search_terms_wasteful add column if not exists term_status text;

comment on column ads_search_terms_wasteful.match_type is
  'VERLATEN: bevatte historisch de zoekterm-status, niet het match-type. Gebruik term_status. Wordt niet meer geschreven.';
comment on column ads_search_terms_wasteful.term_status is
  'De zoekterm-status uit search_term_view.status: ADDED, EXCLUDED, ADDED_EXCLUDED of NONE.';
