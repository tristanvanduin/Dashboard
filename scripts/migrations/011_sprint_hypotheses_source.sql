-- SI2: bron-kolom voor sprint_hypotheses.
-- Laat de goedkeuringswachtrij onderscheid maken tussen voorstellen uit de
-- LLM-analyses (default 'analysis') en uit de deterministische second-opinion
-- ('second_opinion'). Bestaande rijen krijgen via de default 'analysis'.
-- Idempotent: veilig om meerdere keren te draaien.

ALTER TABLE sprint_hypotheses
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'analysis';

-- Voor filteren van de wachtrij per bron.
CREATE INDEX IF NOT EXISTS idx_sh_source ON sprint_hypotheses(client_id, source, status);
