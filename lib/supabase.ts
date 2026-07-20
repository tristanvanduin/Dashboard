import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isDemoMode } from "./demo/demo-mode";
import { createDemoSupabase } from "./demo/mock-supabase";
import { demoRows } from "./demo/demo-rows";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const realClient: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

/**
 * Supabase client singleton.
 * - Normaal: de echte client (of null als env-vars ontbreken; consumers guarden met `if (!supabase)`).
 * - In demo-mode (?demo=1 / NEXT_PUBLIC_DEMO_MODE): een mock-client die curated demo-rijen serveert
 *   voor de demo-klant en voor élke andere klant naar de echte client delegeert. Zo blijven echte
 *   klanten ongemoeid en werkt de demo-klant zonder backend/keys.
 */
export const supabase: SupabaseClient | null =
  isDemoMode() ? createDemoSupabase(realClient, demoRows()) : realClient;

// ── Type definitions for our tables ────────────────────────────────────────

export interface Script {
  id: string;
  title: string;
  description: string | null;
  code: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ClientNote {
  id: string;
  client_id: string;
  title: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface KpiSnapshot {
  conversions: number;
  revenue: number;
  adSpend: number;
  cpa: number;
  roas: number;
}

export interface TaskCompletion {
  id: string;
  client_id: string;
  task_id: string;
  cadence: string;
  task_text: string;
  completed_at: string;
  kpi_snapshot: KpiSnapshot;
  reminder_days: number;
  reminder_dismissed: boolean;
  followup_kpi: KpiSnapshot | null;
  followup_checked_at: string | null;
}
