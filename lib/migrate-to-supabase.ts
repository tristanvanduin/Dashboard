/**
 * One-time migration: push existing localStorage data to Supabase.
 * Run this from the browser console or call it on app mount once.
 * Safe to run multiple times — uses upsert.
 */

import { supabase } from "./supabase";

export async function migrateLocalStorageToSupabase(): Promise<{ migrated: string[]; skipped: string[] }> {
  if (!supabase) return { migrated: [], skipped: ["Supabase not configured"] };
  if (typeof window === "undefined") return { migrated: [], skipped: ["Not in browser"] };

  const migrated: string[] = [];
  const skipped: string[] = [];

  // Check if migration was already done
  const migrationKey = "rm-dashboard-supabase-migrated";
  if (localStorage.getItem(migrationKey)) {
    return { migrated: [], skipped: ["Already migrated"] };
  }

  // 1. Migrate API clients list
  try {
    const apiClientsRaw = localStorage.getItem("rm-dashboard-api-clients");
    if (apiClientsRaw) {
      const clients = JSON.parse(apiClientsRaw);
      if (Array.isArray(clients) && clients.length > 0) {
        await supabase.from("app_settings").upsert({
          key: "api_clients",
          value: clients,
          updated_at: new Date().toISOString(),
        });
        migrated.push(`api_clients (${clients.length} klanten)`);
      }
    }
  } catch (e) { skipped.push("api_clients: " + String(e)); }

  // 2. Migrate visible client IDs
  try {
    const visibleRaw = localStorage.getItem("rm-dashboard-visible-clients");
    if (visibleRaw) {
      const ids = JSON.parse(visibleRaw);
      if (Array.isArray(ids)) {
        await supabase.from("app_settings").upsert({
          key: "visible_client_ids",
          value: ids,
          updated_at: new Date().toISOString(),
        });
        migrated.push(`visible_client_ids (${ids.length} klanten)`);
      }
    }
  } catch (e) { skipped.push("visible_clients: " + String(e)); }

  // 3. Migrate per-client settings (KPI targets + conversion actions)
  try {
    const settingsPrefix = "rm-dashboard-settings-";
    const settingsToMigrate: { client_id: string; conversion_actions: any; kpi_targets: any; updated_at: string }[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(settingsPrefix)) {
        const clientId = key.replace(settingsPrefix, "");
        const raw = localStorage.getItem(key);
        if (raw) {
          const settings = JSON.parse(raw);
          settingsToMigrate.push({
            client_id: clientId,
            conversion_actions: settings.conversionActions ?? [],
            kpi_targets: settings.kpiTargets ?? {},
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    if (settingsToMigrate.length > 0) {
      await supabase.from("client_settings").upsert(settingsToMigrate);
      migrated.push(`client_settings (${settingsToMigrate.length} klanten)`);
    }
  } catch (e) { skipped.push("client_settings: " + String(e)); }

  // Mark migration as done
  localStorage.setItem(migrationKey, new Date().toISOString());
  migrated.push("Migration marker set");

  return { migrated, skipped };
}
