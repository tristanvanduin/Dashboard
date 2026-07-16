/**
 * Manages which clients are visible in the sidebar.
 * Persisted in Supabase (app_settings table) so all users see the same set.
 * Falls back to localStorage if Supabase is not configured.
 */

import { getAllClients } from "./clients";
import { supabase } from "./supabase";

const STORAGE_KEY = "rm-dashboard-visible-clients";
const SUPABASE_KEY = "visible_client_ids";

// In-memory cache
let cachedVisibleIds: string[] | null = null;

export function getVisibleClientIds(): string[] {
  const allClients = getAllClients();
  if (typeof window === "undefined") return allClients.map((c) => c.id);

  // Return cached if available
  if (cachedVisibleIds) {
    return cachedVisibleIds.filter((id) => allClients.some((c) => c.id === id));
  }

  // Try localStorage
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const ids: string[] = JSON.parse(stored);
      cachedVisibleIds = ids;
      return ids.filter((id) => allClients.some((c) => c.id === id));
    }
  } catch { /* ignore */ }

  return allClients.map((c) => c.id);
}

export async function setVisibleClientIds(ids: string[]): Promise<void> {
  cachedVisibleIds = ids;

  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }

  // Persist to Supabase
  if (supabase) {
    await supabase.from("app_settings").upsert({
      key: SUPABASE_KEY,
      value: ids,
      updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Load visible client IDs from Supabase into cache.
 * Call on app mount.
 */
export async function loadVisibleClientIds(): Promise<void> {
  if (!supabase) return;

  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SUPABASE_KEY)
    .maybeSingle();

  if (data?.value && Array.isArray(data.value)) {
    cachedVisibleIds = data.value;
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.value));
    }
  }
}

export function getVisibleClients() {
  const allClients = getAllClients();
  const visibleIds = new Set(getVisibleClientIds());
  return allClients.filter((c) => visibleIds.has(c.id));
}
