/**
 * Data freshness check for SOP pre-flight.
 *
 * Before running a SOP analysis, check whether the required data
 * is present and fresh enough in Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type FreshnessStatus = "fresh" | "stale" | "missing" | "partial" | "unknown";

export interface FreshnessCheck {
  clientId: string;
  freshnessStatus: FreshnessStatus;
  lastSyncAt: string | null;
  hoursSinceSync: number | null;
  hasAccountMonthly: boolean;
  hasAccountWeekly: boolean;
  hasCampaignMonthly: boolean;
  /** Detailed message for the user */
  message: string;
  /** Whether the SOP should proceed */
  canProceed: boolean;
}

/**
 * Check data freshness for a client before running SOP analysis.
 *
 * Rules:
 * - "fresh": synced within 24 hours → proceed normally
 * - "stale": synced >24 hours ago → proceed with warning
 * - "missing": never synced or no data → block with actionable error
 * - "partial": some datasets missing → proceed with warning
 */
export async function checkDataFreshness(
  supabase: SupabaseClient,
  clientId: string,
  requiredTables: string[] = ["ads_account_monthly", "ads_account_weekly", "ads_campaign_monthly"]
): Promise<FreshnessCheck> {
  // Check client sync status
  const { data: syncStatus } = await supabase
    .from("client_sync_status")
    .select("last_sync_at, last_sync_status, freshness_status, datasets_available")
    .eq("client_id", clientId)
    .maybeSingle();

  // Check if required tables have data
  const checks = await Promise.all(
    requiredTables.map(async (table) => {
      const { count } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("client_id", clientId);
      return { table, hasData: (count ?? 0) > 0 };
    })
  );

  const hasAccountMonthly = checks.find((c) => c.table === "ads_account_monthly")?.hasData ?? false;
  const hasAccountWeekly = checks.find((c) => c.table === "ads_account_weekly")?.hasData ?? false;
  const hasCampaignMonthly = checks.find((c) => c.table === "ads_campaign_monthly")?.hasData ?? false;
  const allPresent = checks.every((c) => c.hasData);
  const somePresent = checks.some((c) => c.hasData);

  const lastSyncAt = syncStatus?.last_sync_at as string | null;
  let hoursSinceSync: number | null = null;
  if (lastSyncAt) {
    hoursSinceSync = Math.round((Date.now() - new Date(lastSyncAt).getTime()) / (1000 * 60 * 60));
  }

  // Determine freshness
  if (!somePresent) {
    return {
      clientId,
      freshnessStatus: "missing",
      lastSyncAt,
      hoursSinceSync,
      hasAccountMonthly,
      hasAccountWeekly,
      hasCampaignMonthly,
      message: "Geen Google Ads data in Supabase. Sync de data eerst via de Sync knop in het dashboard.",
      canProceed: false,
    };
  }

  if (!allPresent) {
    const missing = checks.filter((c) => !c.hasData).map((c) => c.table).join(", ");
    return {
      clientId,
      freshnessStatus: "partial",
      lastSyncAt,
      hoursSinceSync,
      hasAccountMonthly,
      hasAccountWeekly,
      hasCampaignMonthly,
      message: `Sommige datasets ontbreken: ${missing}. De analyse kan beperkt zijn.`,
      canProceed: true, // proceed with what we have
    };
  }

  if (!lastSyncAt || (hoursSinceSync !== null && hoursSinceSync > 48)) {
    return {
      clientId,
      freshnessStatus: "stale",
      lastSyncAt,
      hoursSinceSync,
      hasAccountMonthly,
      hasAccountWeekly,
      hasCampaignMonthly,
      message: lastSyncAt
        ? `Data is ${hoursSinceSync} uur oud. Overweeg te synchroniseren voor de meest actuele analyse.`
        : "Data aanwezig maar sync-status onbekend.",
      canProceed: true,
    };
  }

  return {
    clientId,
    freshnessStatus: "fresh",
    lastSyncAt,
    hoursSinceSync,
    hasAccountMonthly,
    hasAccountWeekly,
    hasCampaignMonthly,
    message: `Data is actueel (gesynchroniseerd ${hoursSinceSync} uur geleden).`,
    canProceed: true,
  };
}
