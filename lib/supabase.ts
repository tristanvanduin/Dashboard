import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Supabase client singleton.
 * Returns null if env vars are not configured — all consumers must guard with `if (!supabase)`.
 */
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

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
