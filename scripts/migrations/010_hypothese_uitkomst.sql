-- E1: uitkomst en learning op een hypothese.
-- Laat de memory-laag teruglezen wat een afgerond voorstel opleverde, zodat de
-- eindevaluatie en do-not-repeat erop kunnen bouwen. Bij het voorstel zelf, geen
-- aparte tabel die uit de pas kan lopen.
-- Idempotent: veilig om meerdere keren te draaien.

ALTER TABLE sprint_hypotheses
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS result_met boolean,
  ADD COLUMN IF NOT EXISTS learning text,
  ADD COLUMN IF NOT EXISTS evaluated_at timestamptz;
