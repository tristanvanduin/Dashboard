-- Search term AI relevance analysis cache
CREATE TABLE IF NOT EXISTS search_term_analysis (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  analysis_date date NOT NULL,
  search_term text NOT NULL,
  campaign_name text,
  ad_group_name text,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  relevance_score integer NOT NULL,
  verdict text NOT NULL,
  recommended_action text NOT NULL,
  reason text NOT NULL,
  model_used text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sta_client_date ON search_term_analysis(client_id, analysis_date);
