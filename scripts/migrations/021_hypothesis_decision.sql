-- 021 (H1): de BESLISLAAG op hypotheses. Tot nu toe zette NIETS in de codebase een
-- hypothese ooit op accepted: de status-workflow bestond alleen als kolom met default
-- pending, waardoor accepted_at altijd null bleef en de lerende loop niet kon sluiten.
--
-- BEWUST NIET HIERIN: outcome, result_met, learning en evaluated_at. Migratie 010 voegde
-- die al toe, exact voor dit doel ("laat de memory-laag teruglezen wat een afgerond
-- voorstel opleverde"). De evaluator schrijft daarom naar die bestaande kolommen, want
-- client-memory.ts leest ze al en prefereert hypotheses met een uitkomst. Een parallelle
-- verdict-kolom zou de memory-laag blind maken voor precies de uitkomsten die hij hoort te
-- tonen.
--
-- decision_reason is een EIGEN kolom en niet rationale: rationale draagt de onderbouwing
-- van het VOORSTEL (waarom stelde de analyse dit voor) en die overschrijven met een
-- afwijs-reden zou de geschiedenis vernietigen.
alter table sprint_hypotheses add column if not exists decision_reason text;
alter table sprint_hypotheses add column if not exists decided_at timestamptz;
alter table sprint_hypotheses add column if not exists decided_by text;

-- De metriek-onderbouwing bij de uitkomst: welke baseline, welke meting, welk predicaat.
-- outcome (010) draagt het verdict als tekst, learning (010) de leesbare reden; dit veld
-- draagt de cijfers eronder.
alter table sprint_hypotheses add column if not exists verdict_metrics jsonb;

-- De werkvoorraad van de evaluator: aangenomen en nog niet geevalueerd.
create index if not exists idx_sprint_hypotheses_evaluatie
  on sprint_hypotheses (client_id, accepted_at)
  where status = 'accepted' and evaluated_at is null;
