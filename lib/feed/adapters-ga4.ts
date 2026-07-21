// GA4 → Vandaag-feed. Pure adapter (geen IO): een GA4-SignalStory wordt een FeedItem, precies
// zoals lib/feed/adapters.ts de andere bronnen mapt. GA4-signalen komen op de CROSS-band (ze
// gaan over de website, niet één advertentiekanaal). De tracking break is operationeel-urgent
// → critical. impactType volgt de certainty: GA4 draagt het verhaal aannemelijk maar niet
// bewezen (indicatie) → estimated, en zonder euro-waarde telt het niet mee in het gemeten
// euro-risico. Zo geen valse zekerheid.

import type { FeedItem, ImpactType } from "./feed-item";
import type { SignalStory } from "@/lib/signals/types";

const nowIso = (): string => new Date().toISOString();
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const impactForCertainty = (c: SignalStory["certainty"]): ImpactType =>
  c === "bewezen_binnen_platform" ? "measured" : "estimated";

// Eén GA4-signaal → één feed-kaart. `createdAt` mag meegegeven worden zodat de "nieuw sinds
// gisteren"-teller klopt; standaard nu.
export function ga4SignalToFeedItem(
  story: SignalStory,
  clientId: string,
  clientName: string,
  createdAt: string = nowIso(),
): FeedItem {
  const clientUrl = `/client/${clientId}`;
  // De tracking break is de enige GA4-feedvorm in de MVP en is per definitie kritiek/operationeel.
  const isTracking = story.category === "conversie_meting";
  return {
    id: `ga4:${clientId}:${story.id}`,
    clientId,
    clientName,
    channel: "cross",
    severity: isTracking ? "critical" : "decision",
    type: isTracking ? "issue" : "signal",
    status: "new",
    ownerId: null, ownerName: null, ownerIsMock: false,
    title: isTracking ? "GA4: key events vallen weg (mogelijk kapotte meting)" : clip(story.scope, 90),
    explanation: clip(story.story, 200),
    impactValue: null,
    impactLabel: "website-meting mogelijk kapot — verifieer GA4-tag",
    impactType: impactForCertainty(story.certainty),
    impactDirection: "risk",
    primaryAction: { kind: "investigate", label: "Onderzoek" },
    secondaryActions: [{ kind: "assign", label: "Wijs toe" }, { kind: "snooze", label: "Snooze" }],
    source: "tracking",
    createdAt,
    updatedAt: createdAt,
    dueAt: null, snoozedUntil: null, snoozeReason: null,
    resolvedAt: null, autoResolved: false, resolutionReason: null,
    iceScore: null,
    clientUrl, actionUrl: clientUrl,
    isMock: false,
  };
}
