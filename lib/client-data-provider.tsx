"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { type ClientHistoricalData } from "./types";
import { useClientData, type ClientDataState } from "./use-client-data";
import { getClientSettings, loadClientSettings } from "./client-settings";

const ClientDataContext = createContext<ClientDataState | null>(null);

/**
 * Provider that fetches client data (API or mock) and makes it
 * available to all dashboard child components via context.
 *
 * Merges user-configured KPI targets into the data so the forecast
 * engine uses the correct targets (not the auto-generated ones).
 */
export function ClientDataProvider({ clientId, children }: { clientId: string; children: ReactNode }) {
  const clientData = useClientData(clientId);

  // Load settings from Supabase on mount (populates cache for getClientSettings)
  useEffect(() => { loadClientSettings(clientId); }, [clientId]);

  // Merge user's settings targets into the data
  const enrichedData = useMemo(() => {
    if (!clientData.data) return clientData;

    const settings = getClientSettings(clientId);
    const kpi = settings.kpiTargets;
    const originalTarget = clientData.data.targetCurrentYear;

    const convTarget = kpi.conversionsMode === "absolute"
      ? kpi.conversionsAbsolute
      : Math.round(originalTarget.conversions * (1 + kpi.conversionsGrowthPct / 100));

    const revTarget = kpi.revenueMode === "absolute"
      ? kpi.revenueAbsolute
      : Math.round(originalTarget.revenue * (1 + kpi.revenueGrowthPct / 100));

    // Derive spend target from KPI goals instead of using the API default:
    // Option 1: conversions × CPA (if both are set)
    // Option 2: revenue / ROAS (if both are set)
    // Fallback: use the API-derived target
    let spendTarget = originalTarget.adSpend;

    const effectiveConv = convTarget > 0 ? convTarget : originalTarget.conversions;
    const effectiveRev = revTarget > 0 ? revTarget : originalTarget.revenue;

    if (kpi.cpaTarget > 0 && effectiveConv > 0) {
      // Budget = conversions × target CPA
      spendTarget = Math.round(effectiveConv * kpi.cpaTarget);
    } else if (kpi.roasTarget > 0 && effectiveRev > 0) {
      // Budget = revenue / target ROAS
      spendTarget = Math.round(effectiveRev / kpi.roasTarget);
    }

    const hasUserTargets = convTarget > 0 || revTarget > 0;
    if (!hasUserTargets) return clientData;

    const mergedData: ClientHistoricalData = {
      ...clientData.data,
      targetCurrentYear: {
        conversions: convTarget > 0 ? convTarget : originalTarget.conversions,
        revenue: revTarget > 0 ? revTarget : originalTarget.revenue,
        adSpend: spendTarget,
      },
      conversionOverrides: kpi.conversionOverrides,
    };

    return { ...clientData, data: mergedData };
  }, [clientData, clientId]);

  return (
    <ClientDataContext.Provider value={enrichedData}>
      {children}
    </ClientDataContext.Provider>
  );
}

/**
 * Hook for child components to get the client's historical data.
 * Returns data with user-configured targets merged in.
 */
export function useClientHistoricalData(clientId: string): ClientHistoricalData {
  const ctx = useContext(ClientDataContext);

  // If we're inside a provider and it has data, use it
  if (ctx?.data) {
    return ctx.data;
  }

  // No fallback — all clients must have real data via the provider
  throw new Error(
    `[ClientDataProvider] Client "${clientId}" has no data. ` +
    `Ensure the component is wrapped in <ClientDataProvider>.`
  );
}

/**
 * Hook to check data loading state
 */
export function useClientDataState(): ClientDataState | null {
  return useContext(ClientDataContext);
}
