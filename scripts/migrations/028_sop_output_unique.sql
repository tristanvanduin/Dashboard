-- 028: KRITIEKE FIX. saveAnalysisOutputSection (lib/analysis/helpers.ts) doet een upsert met
-- onConflict "client_id,sop_type,analysis_date,section", maar die unique-constraint bestond
-- niet — alleen de primary key op id. Gevolg: ELKE losse/deterministische analyse faalde bij
-- het opslaan met 42P10 "no unique or exclusion constraint matching the ON CONFLICT
-- specification". De hele nieuwe analyse-laag (signalen, funnels, KPI-verhoudingen, ICP-fit,
-- beursanalyse) kon dus nooit output bewaren of de wachtrij voeden. Deze constraint maakt de
-- upsert geldig (nieuwe run overschrijft de sectie van dezelfde dag). Geen dubbelen aanwezig.

create unique index if not exists uq_sop_output_client_type_date_section
  on sop_analysis_output (client_id, sop_type, analysis_date, section);
