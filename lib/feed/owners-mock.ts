// ⚠️ FASE-1 MOCKDATA — één geïsoleerde plek, triviaal te verwijderen in Fase 2.
//
// Twee dingen bestaan nog niet als echte data en worden hier gemockt:
//  1. Individuele eigenaren. De SOP-data kent alleen "Ranking Masters" vs "Klant" (agency vs
//     klant), geen personen. Tot echte toewijzing bestaat, verdeelt mockOwnerFor deterministisch
//     over een klein team. Elk item dat hieruit een eigenaar krijgt, houdt ownerIsMock = true,
//     zodat de UI het als demo kan labelen. Een échte toewijzing (feed_item_state.assigned_owner)
//     overschrijft dit en zet ownerIsMock op false.
//  2. Cross-client tracking-break / budget-uitputting / spend-anomalie. Die worden vandaag
//     per klant client-side afgeleid (tracking-alert, pacing-monitor) en zijn nog niet
//     cross-client beschikbaar. mockOperationalItems toont die kaarttypes met isMock = true,
//     uitgesloten van alle echte tellers (Risico open, Aandacht nodig, etc.).

import type { FeedItem } from "./feed-item";

export const MOCK_TEAM = ["Tristan", "Sander", "Gabrielle"] as const;

// Deterministische, stabiele verdeling: ~1 op de 4 blijft "Niet toegewezen" zodat de
// triage-status zichtbaar is. Puur demo — géén echte toewijzing.
export function mockOwnerFor(clientId: string): { id: string; name: string } | null {
  let h = 0;
  for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) >>> 0;
  const bucket = h % 4;
  if (bucket === 3) return null; // Niet toegewezen
  const name = MOCK_TEAM[h % MOCK_TEAM.length];
  return { id: `mock:${name}`, name };
}

// Kent (mock) eigenaren toe aan echte items die er nog geen hebben. Laat items met een echte
// eigenaar (ownerIsMock === false én ownerName gezet) ongemoeid.
export function applyMockOwners(items: FeedItem[]): FeedItem[] {
  return items.map((i) => {
    if (i.ownerName && !i.ownerIsMock) return i; // echte toewijzing blijft
    if (i.ownerName && i.ownerIsMock) return i;  // al gemockt
    const o = mockOwnerFor(i.clientId);
    if (!o) return i; // Niet toegewezen
    return { ...i, ownerId: o.id, ownerName: o.name, ownerIsMock: true };
  });
}

// Een paar volledig synthetische demo-kaarten voor de rode band, zodat de operationele
// kaarttypes zichtbaar zijn tot ze in Fase 2 echt cross-client worden afgeleid. isMock = true
// → uitgesloten van elke echte teller.
export function mockOperationalItems(clients: { id: string; name: string }[]): FeedItem[] {
  if (clients.length === 0) return [];
  const now = new Date().toISOString();
  const mk = (i: number, over: Partial<FeedItem> & { id: string; title: string }): FeedItem => {
    const c = clients[i % clients.length];
    return {
      clientId: c.id, clientName: c.name, channel: "google",
      severity: "critical", type: "issue", status: "new",
      ownerId: null, ownerName: null, ownerIsMock: false,
      explanation: "", impactValue: null, impactLabel: "", impactType: "measured",
      impactDirection: "risk", primaryAction: { kind: "view", label: "Los op" },
      secondaryActions: [{ kind: "assign", label: "Wijs toe" }, { kind: "snooze", label: "Snooze" }],
      source: "tracking", createdAt: now, updatedAt: now, dueAt: null, snoozedUntil: null, snoozeReason: null,
      resolvedAt: null, autoResolved: false, resolutionReason: null, iceScore: null,
      clientUrl: `/client/${c.id}`, actionUrl: `/client/${c.id}`, isMock: true, ...over,
    };
  };
  return [
    mk(0, { id: "mock:tracking-break", title: "Conversietracking mogelijk kapot", explanation: "0 conversies terwijl klikken doorlopen (demo).", impactLabel: "3 dagen data mogelijk kwijt", source: "tracking" }),
    mk(1, { id: "mock:budget-exhausted", title: "Dagbudget vroeg uitgeput", explanation: "Budget 100% verbruikt in de ochtend (demo).", impactLabel: "~€180/dag gemiste vertoningen", source: "pacing", impactType: "estimated" }),
  ];
}
