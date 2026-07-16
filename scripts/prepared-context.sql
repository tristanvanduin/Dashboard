CREATE TABLE IF NOT EXISTS analysis_prepared_context (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  analysis_date DATE NOT NULL,
  prepared_at TIMESTAMPTZ DEFAULT now(),

  decision_rules JSONB NOT NULL,
  kpi_chain_account JSONB NOT NULL,
  kpi_chains_campaigns JSONB NOT NULL,
  comparison_facts_campaigns JSONB NOT NULL,
  comparison_facts_adgroups JSONB NOT NULL,

  binding_facts_text TEXT NOT NULL,
  kpi_chain_text TEXT NOT NULL,
  campaign_table_text TEXT NOT NULL,

  data_availability JSONB NOT NULL,

  UNIQUE(client_id, analysis_date)
);
