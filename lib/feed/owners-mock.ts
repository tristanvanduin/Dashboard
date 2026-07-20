// ⚠️ DEMO-DATA — één geïsoleerde plek. Bewust behouden als ontwikkel-/reviewmogelijkheid voor
// wanneer er (nog) geen live data is. Verschijnt UITSLUITEND in demo-mode (?demo=1 of de env-
// flag); wordt nooit in de standaardervaring geïnjecteerd en telt daarbuiten nergens mee.
//
// Twee rollen:
//  1. mockOwnerFor / applyMockOwners — kennen (demo) eigenaren toe aan echte items in demo-mode,
//     zodat de eigenaar-dimensie te beoordelen is. ownerIsMock blijft true; een echte toewijzing
//     (feed_item_state) overschrijft dit en zet ownerIsMock op false.
//  2. demoFeedItems — een volledige, zelfstandige set demo-kaarten die ELK kaarttype en elke
//     status toont (tracking-break, budgetissue, spend-anomalie, beslissing, taak, snooze,
//     eigenaar/niet-toegewezen, impact gemeten/geschat). Alles isMock = true → duidelijke badge.

import type { FeedItem } from "./feed-item";

export const MOCK_TEAM = ["Tristan", "Sander", "Gabrielle"] as const;

// Demo-teller voor "Automatisch opgelost" zodat die in demo-mode niet leeg oogt.
export const DEMO_AUTO_RESOLVED = 2;

// Deterministische, stabiele verdeling: ~1 op de 4 blijft "Niet toegewezen" zodat de
// triage-status zichtbaar is. Puur demo — géén echte toewijzing.
export function mockOwnerFor(clientId: string): { id: string; name: string } | null {
  let h = 0;
  for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) >>> 0;
  const bucket = h % 4;
  if (bucket === 3) return null;
  const name = MOCK_TEAM[h % MOCK_TEAM.length];
  return { id: `mock:${name}`, name };
}

// Kent (demo) eigenaren toe aan echte items die er nog geen hebben. Laat echte toewijzingen staan.
export function applyMockOwners(items: FeedItem[]): FeedItem[] {
  return items.map((i) => {
    if (i.ownerName) return i;
    const o = mockOwnerFor(i.clientId);
    if (!o) return i;
    return { ...i, ownerId: o.id, ownerName: o.name, ownerIsMock: true };
  });
}

// Vaste demo-klanten wanneer er geen echte zichtbare klanten zijn (volledig los van live data).
const DEMO_CLIENTS = [
  { id: "demo-greentech", name: "GreenTech (demo)" },
  { id: "demo-horeca", name: "RAI Horecava (demo)" },
  { id: "demo-fysio", name: "FIT Fysio (demo)" },
];

const iso = (d: Date): string => d.toISOString();
const plusDays = (base: Date, n: number): string => { const d = new Date(base); d.setDate(d.getDate() + n); return iso(d); };

// De volledige demo-set. `clients` mag echte zichtbare klanten zijn; bij nul valt hij terug op
// vaste demo-klanten zodat de cockpit ook zonder enige configuratie te beoordelen is.
export function demoFeedItems(clients: { id: string; name: string }[], now: Date): FeedItem[] {
  const pool = clients.length > 0 ? clients : DEMO_CLIENTS;
  const c = (i: number) => pool[i % pool.length];

  const d = (over: Partial<FeedItem> & { id: string; clientId: string; clientName: string; severity: FeedItem["severity"]; type: FeedItem["type"]; title: string }): FeedItem => ({
    channel: "google", status: "new",
    ownerId: null, ownerName: null, ownerIsMock: false,
    explanation: "", impactValue: null, impactLabel: "", impactType: "estimated", impactDirection: "neutral",
    primaryAction: { kind: "view", label: "Bekijk" },
    secondaryActions: [{ kind: "assign", label: "Wijs toe" }, { kind: "snooze", label: "Snooze" }],
    createdAt: iso(now), updatedAt: iso(now),
    dueAt: null, snoozedUntil: null, snoozeReason: null,
    resolvedAt: null, autoResolved: false, resolutionReason: null,
    iceScore: null, clientUrl: `/client/${over.clientId}`, actionUrl: `/client/${over.clientId}`,
    source: "signal", isMock: true,
    ...over,
  });

  const owner = (name: string) => ({ ownerId: `mock:${name}`, ownerName: name, ownerIsMock: true });

  return [
    // ── Kapot / tijdkritisch ──
    d({
      id: "demo:tracking-break", clientId: c(2).id, clientName: c(2).name, channel: "google",
      severity: "critical", type: "issue", title: "Conversietracking mogelijk kapot",
      explanation: "0 conversies geregistreerd sinds 3 dagen terwijl klikken doorlopen.",
      impactType: "measured", impactDirection: "risk", impactValue: 390, impactLabel: "3 dagen data kwijt · €390 blind besteed",
      primaryAction: { kind: "view", label: "Los op" },
    }),
    d({
      id: "demo:spend-anomaly", clientId: c(0).id, clientName: c(0).name, channel: "meta",
      severity: "critical", type: "signal", title: "Spend-anomalie gedetecteerd",
      explanation: "Spend +180% t.o.v. het 7-daags gemiddelde zonder navenante conversies.",
      impactType: "measured", impactDirection: "risk", impactValue: 260, impactLabel: "€260 waste sinds gisteren, oplopend",
      primaryAction: { kind: "view", label: "Los op" },
    }),
    d({
      id: "demo:budget-exhausted", clientId: c(1).id, clientName: c(1).name, channel: "google",
      severity: "critical", type: "issue", title: "Dagbudget vroeg uitgeput",
      explanation: "Budget 100% verbruikt om 11:20 op dag 14 — campagne staat de rest van de dag stil.",
      impactType: "estimated", impactDirection: "risk", impactLabel: "~€180/dag gemiste vertoningen",
      ...owner("Sander"), dueAt: plusDays(now, 0), primaryAction: { kind: "view", label: "Verhoog budget" },
    }),
    d({
      id: "demo:task-overdue", clientId: c(2).id, clientName: c(2).name, channel: "google",
      severity: "critical", type: "task", title: "tROAS bijstellen — deadline verlopen",
      explanation: "Actie uit vorige sprint nog niet uitgevoerd.",
      impactDirection: "neutral", impactLabel: "deadline verlopen", ...owner("Gabrielle"),
      dueAt: plusDays(now, -2), primaryAction: { kind: "resolve", label: "Afronden" },
    }),

    // ── Beslissing gevraagd ──
    d({
      id: "demo:decision-reduce", clientId: c(0).id, clientName: c(0).name, channel: "google",
      severity: "decision", type: "decision", title: "Search EU — ROAS ver onder target",
      explanation: "ROAS 1,1 vs target 3,0 terwijl spend +45% MoM groeit. Richting: reduce.",
      iceScore: 82, impactType: "estimated", impactDirection: "gain", impactValue: 1240, impactLabel: "~€1.240/mnd onrendabele spend besparen",
      status: "awaiting_approval", ...owner("Tristan"),
      primaryAction: { kind: "approve", label: "Keur goed" }, secondaryActions: [{ kind: "investigate", label: "Onderzoek" }, { kind: "snooze", label: "Snooze" }],
    }),
    d({
      id: "demo:decision-expand", clientId: c(1).id, clientName: c(1).name, channel: "google",
      severity: "decision", type: "decision", title: "Brand NL — verliest volume op budget",
      explanation: "Haalt target met 22% budget-verlies op impression share — kandidaat om op te schalen.",
      iceScore: 74, impactType: "estimated", impactDirection: "gain", impactLabel: "+18 conversies/mnd bij opschalen",
      status: "awaiting_approval", primaryAction: { kind: "approve", label: "Keur goed" },
      secondaryActions: [{ kind: "investigate", label: "Onderzoek" }, { kind: "assign", label: "Wijs toe" }],
    }),

    // ── Volgt / deze week ──
    d({
      id: "demo:fatigue", clientId: c(0).id, clientName: c(0).name, channel: "meta",
      severity: "watch", type: "signal", title: "3 creatives onder hun CTR-piek",
      explanation: "Vermoeidheid gedetecteerd — plan een refresh.",
      impactType: "measured", impactDirection: "risk", impactLabel: "CTR −38% t.o.v. piek", ...owner("Sander"),
    }),
    d({
      id: "demo:funnel", clientId: c(2).id, clientName: c(2).name, channel: "linkedin",
      severity: "watch", type: "signal", title: "Funnel: form-open → lead −24%",
      explanation: "Over de recente 4 weken vs de 4 weken ervoor.",
      impactType: "estimated", impactDirection: "risk", impactLabel: "~−6 leads/mnd als trend doorzet",
    }),

    // ── Gesnoozed (demonstreert de snooze-status) ──
    d({
      id: "demo:snoozed", clientId: c(1).id, clientName: c(1).name, channel: "google",
      severity: "decision", type: "decision", title: "Negative keywords uitbreiden",
      explanation: "Gesnoozed tot na de beursweek.",
      iceScore: 55, impactType: "estimated", impactDirection: "gain", impactLabel: "verwacht: minder waste",
      status: "snoozed", snoozedUntil: plusDays(now, 3), snoozeReason: "wacht op klant-akkoord", ...owner("Gabrielle"),
    }),
  ];
}
