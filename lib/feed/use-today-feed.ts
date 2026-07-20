"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { getVisibleClients } from "@/lib/visible-clients";
import {
  insightToFeedItem, recommendationToFeedItem, hypothesisToFeedItem, taskToFeedItem, overviewToFeedItems,
  type InsightRow, type RecommendationRow, type HypothesisRow, type TaskRow, type OverviewLike,
} from "./adapters";
import {
  reconcileFeed, sortBand, measuredRiskOpen, isNewSince, isOverdue,
  type FeedItem, type FeedSeverity, type FeedStateRow,
} from "./feed-item";
import { applyMockOwners, mockOperationalItems } from "./owners-mock";

// De IO-laag van de Vandaag-feed. Haalt de bestaande bronnen CROSS-CLIENT op (zichtbare
// klanten), vertaalt ze via de pure adapters, legt feed_item_state eroverheen en berekent de
// pols. Verandert geen analyse/forecast/drempel. Snooze/toewijzing/afronden schrijven alleen
// naar feed_item_state; de brondata blijft ongemoeid.

// Demo-modus staat STANDAARD UIT. De rode band (en de hele feed) moet vanaf dag één echt,
// schaars en actioneerbaar zijn — geen demo-items, ook niet met een label. Demo-modus blijft
// bestaan voor presentatie/test en zet zowel de operationele demo-kaarten als de mock-eigenaren
// aan; hij wordt uitsluitend expliciet geactiveerd via ?demo=1 in de URL.
function readDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  try { return new URLSearchParams(window.location.search).get("demo") === "1"; } catch { return false; }
}

export interface TodayPulse {
  attention: number;     // klanten met ≥1 echt critical/decision-item
  onTrack: number;       // zichtbare klanten − attention
  measuredRisk: number;  // som gemeten euro-risico (alleen echt)
  unassigned: number;    // echte critical/decision-items zonder eigenaar
  newSince: number;      // echte items nieuw sinds gisteren
  autoResolved: number;  // door de data automatisch opgeloste (eerder aangeraakte) items
  clientCount: number;
  hasMock: boolean;      // of er demo-kaarten/mock-eigenaren in beeld zijn
}

export interface TodayFeed {
  loading: boolean;
  error: string | null;
  demoMode: boolean;
  currentUser: string | null;
  bands: Record<FeedSeverity, FeedItem[]>;
  myActions: FeedItem[];
  snoozed: FeedItem[];
  pulse: TodayPulse;
  newByBand: Record<FeedSeverity, number>;
  refresh: () => void;
  snooze: (item: FeedItem, reason: string, until: string) => Promise<void>;
  assign: (item: FeedItem, owner: string) => Promise<void>;
  setStatus: (item: FeedItem, status: string) => Promise<void>;
}

export function useTodayFeed(): TodayFeed {
  const [rawItems, setRawItems] = useState<FeedItem[] | null>(null);
  const [stateRows, setStateRows] = useState<FeedStateRow[]>([]);
  const [autoResolved, setAutoResolved] = useState(0);
  const [clientCount, setClientCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setCurrentUser(d?.email ?? null)).catch(() => {});
    setDemoMode(readDemoMode());
  }, []);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); setRawItems([]); return; }
    let cancelled = false;
    setRawItems(null); setError(null);

    const clients = getVisibleClients();
    const nameById = new Map(clients.map((c) => [c.id, c.name]));
    const ids = clients.map((c) => c.id);
    setClientCount(ids.length);
    if (ids.length === 0) { setRawItems([]); return; }
    const now = new Date();
    const nm = (id: string) => nameById.get(id) ?? id;

    async function load() {
      // Bron-tabellen cross-client (alleen open/pending + recent, met limieten).
      const [insights, recs, hyps, tasks, stateRes] = await Promise.all([
        sb!.from("sop_insights").select("id, client_id, sop_type, insight_type, title, description, severity, affected_entity, metric, change_pct, action_required, created_at").in("client_id", ids).order("created_at", { ascending: false }).limit(150),
        sb!.from("sop_recommendations").select("id, client_id, sop_type, hypothesis, expected_result, ice_total, status, created_at").in("client_id", ids).eq("status", "open").limit(150),
        sb!.from("sprint_hypotheses").select("id, client_id, source, hypothesis, expected_result, rationale, ice_total, status, created_at").in("client_id", ids).eq("status", "pending").limit(150),
        sb!.from("sop_tasks").select("id, client_id, title, description, priority, due_date, status").in("client_id", ids).eq("status", "open").limit(150),
        sb!.from("feed_item_state").select("*").in("client_id", ids),
      ]);

      if (cancelled) return;
      const firstErr = insights.error || recs.error || hyps.error || tasks.error;
      if (firstErr) { setError(firstErr.message); setRawItems([]); return; }

      // feed_item_state kan nog niet bestaan (migratie 029 niet toegepast) — degradeer netjes.
      const state: FeedStateRow[] = stateRes.error ? [] : ((stateRes.data ?? []) as unknown as FeedStateRow[]);

      const items: FeedItem[] = [
        ...((insights.data ?? []) as unknown as InsightRow[]).map((r) => insightToFeedItem(r, nm(r.client_id))),
        ...((recs.data ?? []) as unknown as RecommendationRow[]).map((r) => recommendationToFeedItem(r, nm(r.client_id))),
        ...((hyps.data ?? []) as unknown as HypothesisRow[]).map((r) => hypothesisToFeedItem(r, nm(r.client_id))),
        ...((tasks.data ?? []) as unknown as TaskRow[]).map((r) => taskToFeedItem(r, nm(r.client_id), now)),
      ];

      // Operationele signalen uit de overview-endpoint (echt, 1 call voor alle Google-klanten).
      const gads = clients.filter((c) => c.id.startsWith("gads-"));
      if (gads.length > 0) {
        try {
          const customerIds = gads.map((c) => c.id.replace("gads-", "")).join(",");
          const res = await fetch(`/api/google-ads/overview?customerIds=${customerIds}`);
          const data = await res.json();
          for (const acc of (data.accounts ?? []) as Array<OverviewLike & { customerId: string }>) {
            const cid = `gads-${acc.customerId}`;
            if (!ids.includes(cid)) continue;
            items.push(...overviewToFeedItems(cid, nm(cid), acc));
          }
        } catch { /* overview optioneel; feed werkt zonder */ }
      }
      if (cancelled) return;

      // Alleen in demo-modus: mock-eigenaren op echte items + gelabelde operationele demo-kaarten.
      // Standaard blijft de feed volledig echt (owners komen dan enkel uit feed_item_state).
      let withOwners = demoMode ? applyMockOwners(items) : items;
      if (demoMode) withOwners = [...withOwners, ...mockOperationalItems(clients)];

      const { items: active, snoozed, autoResolvedCount } = reconcileFeed(withOwners, state, now);
      setStateRows(state);
      setAutoResolved(autoResolvedCount);
      setRawItems(active.concat(snoozed)); // snoozed apart weer gefilterd in useMemo
    }

    load().catch((e) => { if (!cancelled) { setError(String(e)); setRawItems([]); } });
    return () => { cancelled = true; };
  }, [tick, demoMode]);

  const derived = useMemo(() => {
    const all = rawItems ?? [];
    const active = all.filter((i) => i.status !== "snoozed" && i.status !== "resolved");
    const snoozed = all.filter((i) => i.status === "snoozed");
    const bands: Record<FeedSeverity, FeedItem[]> = {
      critical: sortBand(active.filter((i) => i.severity === "critical"), "critical"),
      decision: sortBand(active.filter((i) => i.severity === "decision"), "decision"),
      watch: sortBand(active.filter((i) => i.severity === "watch"), "watch"),
    };
    const now = new Date();
    // "Mijn acties vandaag" = DEZELFDE feed, gefilterd. Geen tweede bron, en nooit mock-items.
    const myActions = active.filter((i) =>
      !i.isMock && (isOverdue(i.dueAt, now) || (currentUser != null && i.ownerName === currentUser))
    );

    // Pols — alleen ECHTE data telt (mock-kaarten uitgesloten).
    const real = active.filter((i) => !i.isMock);
    const attentionItems = real.filter((i) => i.severity === "critical" || i.severity === "decision");
    const attentionClients = new Set(attentionItems.map((i) => i.clientId));
    const newByBand: Record<FeedSeverity, number> = {
      critical: real.filter((i) => i.severity === "critical" && isNewSince(i.createdAt, now)).length,
      decision: real.filter((i) => i.severity === "decision" && isNewSince(i.createdAt, now)).length,
      watch: real.filter((i) => i.severity === "watch" && isNewSince(i.createdAt, now)).length,
    };
    const pulse: TodayPulse = {
      attention: attentionClients.size,
      onTrack: Math.max(0, clientCount - attentionClients.size),
      measuredRisk: measuredRiskOpen(active),
      unassigned: attentionItems.filter((i) => !i.ownerName).length,
      newSince: newByBand.critical + newByBand.decision + newByBand.watch,
      autoResolved,
      clientCount,
      hasMock: active.some((i) => i.isMock || i.ownerIsMock),
    };
    return { bands, myActions, snoozed, pulse, newByBand };
  }, [rawItems, currentUser, clientCount, autoResolved]);

  const upsertState = useCallback(async (item: FeedItem, patch: Partial<FeedStateRow>) => {
    const sb = supabase;
    if (!sb) return;
    const existing = stateRows.find((s) => s.item_key === item.id);
    const row: FeedStateRow = {
      item_key: item.id, client_id: item.clientId, source: item.source,
      assigned_owner: existing?.assigned_owner ?? null,
      snoozed_until: existing?.snoozed_until ?? null,
      snooze_reason: existing?.snooze_reason ?? null,
      feed_status: existing?.feed_status ?? null,
      updated_by: currentUser, updated_at: new Date().toISOString(),
      ...patch,
    };
    const { error: upErr } = await sb.from("feed_item_state").upsert(row, { onConflict: "item_key" });
    if (upErr) { setError(`Kon feed-state niet opslaan (migratie 029 toegepast?): ${upErr.message}`); return; }
    refresh();
  }, [stateRows, currentUser, refresh]);

  const snooze = useCallback((item: FeedItem, reason: string, until: string) =>
    upsertState(item, { snoozed_until: until, snooze_reason: reason, feed_status: "snoozed" }), [upsertState]);
  const assign = useCallback((item: FeedItem, owner: string) =>
    upsertState(item, { assigned_owner: owner }), [upsertState]);
  const setStatus = useCallback((item: FeedItem, status: string) =>
    upsertState(item, { feed_status: status }), [upsertState]);

  return {
    loading: rawItems === null,
    error,
    demoMode,
    currentUser,
    bands: derived.bands,
    myActions: derived.myActions,
    snoozed: derived.snoozed,
    pulse: derived.pulse,
    newByBand: derived.newByBand,
    refresh,
    snooze, assign, setStatus,
  };
}
