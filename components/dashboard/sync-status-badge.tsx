"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type FreshnessStatus = "fresh" | "stale" | "missing" | "partial" | "unknown";

interface SyncStatus {
  freshnessStatus: FreshnessStatus;
  lastSyncAt: string | null;
  hoursSinceSync: number | null;
  datasetsAvailable: number | null;
  datasetsTotal: number | null;
}

const STATUS_CONFIG: Record<
  FreshnessStatus,
  { label: string; color: string; bg: string; border: string; icon: React.ReactNode }
> = {
  fresh: {
    label: "Data actueel",
    color: "text-green-600",
    bg: "bg-green-50",
    border: "border-green-200",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  stale: {
    label: "Data verouderd",
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  partial: {
    label: "Data onvolledig",
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  missing: {
    label: "Geen data",
    color: "text-red-600",
    bg: "bg-red-50",
    border: "border-red-200",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  unknown: {
    label: "Status onbekend",
    color: "text-gray-500",
    bg: "bg-gray-50",
    border: "border-gray-200",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
};

function formatTimeAgo(hours: number): string {
  if (hours < 1) return "zojuist";
  if (hours < 24) return `${Math.round(hours)}u geleden`;
  const days = Math.floor(hours / 24);
  return `${days}d geleden`;
}

interface Props {
  clientId: string;
  /** Called after a successful sync so the dashboard can refresh its data */
  onSyncComplete?: () => void;
}

export function SyncStatusBadge({ clientId, onSyncComplete }: Props) {
  const [status, setStatus] = useState<SyncStatus>({
    freshnessStatus: "unknown",
    lastSyncAt: null,
    hoursSinceSync: null,
    datasetsAvailable: null,
    datasetsTotal: null,
  });
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<"success" | "error" | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!supabase) return;

    const { data } = await supabase
      .from("client_sync_status")
      .select("last_sync_at, freshness_status, datasets_available, datasets_total")
      .eq("client_id", clientId)
      .maybeSingle();

    if (data) {
      const lastSyncAt = data.last_sync_at as string | null;
      let hoursSinceSync: number | null = null;
      let freshnessStatus = (data.freshness_status as FreshnessStatus) || "unknown";

      if (lastSyncAt) {
        hoursSinceSync = (Date.now() - new Date(lastSyncAt).getTime()) / (1000 * 60 * 60);
        // Recalculate freshness based on actual hours
        if (hoursSinceSync <= 24) freshnessStatus = "fresh";
        else if (hoursSinceSync <= 48) freshnessStatus = "stale";
        else freshnessStatus = "stale";
      }

      setStatus({
        freshnessStatus,
        lastSyncAt,
        hoursSinceSync,
        datasetsAvailable: data.datasets_available as number | null,
        datasetsTotal: data.datasets_total as number | null,
      });
    } else {
      setStatus((prev) => ({ ...prev, freshnessStatus: "missing" }));
    }
  }, [clientId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function triggerSync() {
    setSyncing(true);
    setSyncResult(null);
    setSyncMessage(null);

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Sync mislukt");
      }

      const succeeded = data.datasetsSucceeded ?? data.datasets_succeeded ?? 0;
      const failed = data.datasetsFailed ?? data.datasets_failed ?? 0;
      const rows = data.totalRowsWritten ?? data.total_rows_written ?? 0;

      setSyncResult("success");
      setSyncMessage(`${succeeded} datasets, ${rows.toLocaleString("nl-NL")} rijen${failed > 0 ? `, ${failed} mislukt` : ""}`);

      // Refresh status
      await loadStatus();
      onSyncComplete?.();

      // Clear success message after 8 seconds
      setTimeout(() => {
        setSyncResult(null);
        setSyncMessage(null);
      }, 8000);
    } catch (err) {
      setSyncResult("error");
      setSyncMessage(err instanceof Error ? err.message : "Sync mislukt");

      setTimeout(() => {
        setSyncResult(null);
        setSyncMessage(null);
      }, 8000);
    } finally {
      setSyncing(false);
    }
  }

  const config = STATUS_CONFIG[status.freshnessStatus];
  const needsSync = status.freshnessStatus === "stale" || status.freshnessStatus === "missing" || status.freshnessStatus === "partial";
  const isUrgent = status.freshnessStatus === "missing" || (status.hoursSinceSync != null && status.hoursSinceSync > 48);

  return (
    <div className="flex items-center gap-2">
      {/* Freshness badge */}
      <div
        className={`flex items-center gap-1.5 text-xs ${config.color} ${config.bg} border ${config.border} rounded-lg px-3 py-1.5 ${needsSync && !syncing ? "animate-pulse" : ""}`}
      >
        {config.icon}
        <span>{config.label}</span>
        {status.hoursSinceSync != null && (
          <span className="opacity-70">({formatTimeAgo(status.hoursSinceSync)})</span>
        )}
        {status.datasetsAvailable != null && status.datasetsTotal != null && (
          <span className="opacity-70">
            {status.datasetsAvailable}/{status.datasetsTotal}
          </span>
        )}
        {needsSync && !syncing && (
          <span className={`font-semibold ml-0.5 ${isUrgent ? "text-red-600" : "text-amber-600"}`}>
            — Sync nodig{isUrgent ? "!" : ""}
          </span>
        )}
      </div>

      {/* Sync button */}
      <button
        onClick={triggerSync}
        disabled={syncing}
        className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 border transition-all ${
          syncing
            ? "bg-rm-blue/5 border-rm-blue/20 text-rm-blue cursor-wait"
            : syncResult === "success"
            ? "bg-green-50 border-green-200 text-green-600"
            : syncResult === "error"
            ? "bg-red-50 border-red-200 text-red-600"
            : needsSync
            ? "bg-rm-orange/10 border-rm-orange/40 text-rm-orange font-semibold hover:bg-rm-orange/20 cursor-pointer"
            : "bg-white border-border text-muted-foreground hover:text-rm-gray hover:border-rm-blue/40 cursor-pointer"
        }`}
        title={syncing ? "Synchroniseren..." : "Data synchroniseren met Google Ads"}
      >
        {syncing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : syncResult === "success" ? (
          <CheckCircle2 className="w-3.5 h-3.5" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5" />
        )}
        {syncing ? "Synchroniseren..." : syncResult === "success" ? "Gesynchroniseerd" : "Sync"}
      </button>

      {/* Result message */}
      {syncMessage && (
        <span
          className={`text-[10px] ${
            syncResult === "success" ? "text-green-600" : "text-red-500"
          }`}
        >
          {syncMessage}
        </span>
      )}
    </div>
  );
}
