/**
 * Client list — combines hardcoded demo clients with API-discovered accounts.
 *
 * API accounts (from Google Ads MCC) are stored in localStorage after
 * being fetched via the settings page. The sidebar and dashboard read
 * from this combined list.
 */

export interface Client {
  id: string;
  name: string;
  /** Google Ads customer ID (if linked to API) */
  googleAdsCustomerId?: string;
  /** Whether this is a real API-connected account or demo data */
  source: "demo" | "google-ads" | "meta-ads";
}

// Hardcoded demo clients (used when no API is connected)
export const DEMO_CLIENTS: Client[] = [
  { id: "broedservice", name: "Broedservice", source: "demo" },
  { id: "bruidsmode-haarlem", name: "Bruidsmode Haarlem", source: "demo" },
  { id: "confidence-for-all", name: "Confidence for all", source: "demo" },
  { id: "fit-fysio", name: "FIT Fysio", source: "demo" },
  { id: "ocean-queens", name: "Ocean Queens", source: "demo" },
  { id: "ranking-masters", name: "Ranking Masters", source: "demo" },
  { id: "wobblez", name: "Wobblez", source: "demo" },
  { id: "mobiliteitexpert", name: "Mobiliteitexpert", source: "demo" },
  { id: "mpc", name: "MPC", source: "demo" },
  { id: "minismus", name: "Minismus", source: "demo" },
  { id: "sabe", name: "Sabe", source: "demo" },
];

import { supabase } from "./supabase";
import { isDemoMode } from "./demo/demo-mode";
import { DEMO_GREENTECH_ID, DEMO_GREENTECH_NAME } from "./demo/greentech-mock";

const API_CLIENTS_KEY = "rm-dashboard-api-clients";
const SUPABASE_CLIENTS_KEY = "api_clients";

/** Save API-discovered accounts to localStorage + Supabase */
export function saveApiClients(apiClients: Client[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(API_CLIENTS_KEY, JSON.stringify(apiClients));
  window.dispatchEvent(new Event("clients-changed"));

  // Persist to Supabase
  if (supabase) {
    supabase.from("app_settings").upsert({
      key: SUPABASE_CLIENTS_KEY,
      value: apiClients,
      updated_at: new Date().toISOString(),
    }).then(() => {});
  }
}

/** Get API-discovered accounts from localStorage (sync) */
export function getApiClients(): Client[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(API_CLIENTS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

/** Load API clients from Supabase into localStorage cache */
export async function loadApiClients(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SUPABASE_CLIENTS_KEY)
    .maybeSingle();

  if (data?.value && Array.isArray(data.value) && data.value.length > 0) {
    if (typeof window !== "undefined") {
      localStorage.setItem(API_CLIENTS_KEY, JSON.stringify(data.value));
      window.dispatchEvent(new Event("clients-changed"));
    }
  }
}

/** Clear API clients */
export function clearApiClients(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(API_CLIENTS_KEY);
  window.dispatchEvent(new Event("clients-changed"));

  if (supabase) {
    supabase.from("app_settings").delete().eq("key", SUPABASE_CLIENTS_KEY).then(() => {});
  }
}

/**
 * Get all available clients.
 * Returns real API-connected accounts. In demo-mode (?demo=1 of NEXT_PUBLIC_DEMO_MODE) wordt
 * de fictieve demo-klant "demo-greentech" toegevoegd zodat de hele app zonder live data te
 * reviewen is; buiten demo-mode verandert er niets.
 */
export function getAllClients(): Client[] {
  const api = getApiClients();
  if (isDemoMode() && !api.some((c) => c.id === DEMO_GREENTECH_ID)) {
    return [{ id: DEMO_GREENTECH_ID, name: DEMO_GREENTECH_NAME, source: "demo" }, ...api];
  }
  return api;
}

/**
 * Legacy export — returns empty array server-side, API clients client-side.
 * Components should use getAllClients() for reactivity.
 */
export const clients: Client[] = typeof window === "undefined"
  ? []
  : [];
