// Zelf-draaiende test voor de Vandaag-feed-kern. Draait via tsx.
// Kern: band-classificatie (rood blijft schaars — analyse-findings nooit rood), de feed-state-
// overlay (snooze wint, handmatig opgelost), auto-resolve uit de data (verdwenen bron-item),
// sortering per band (tweede as = impact/ICE) en de eerlijke "Risico open" (alleen measured,
// nooit mock/geschat).

import { insightToFeedItem, recommendationToFeedItem, hypothesisToFeedItem, taskToFeedItem, overviewToFeedItems } from "./adapters";
import { applyFeedState, reconcileFeed, sortBand, measuredRiskOpen, type FeedItem, type FeedStateRow } from "./feed-item";
import { demoFeedItems, mockOwnerFor } from "./owners-mock";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}
const NOW = new Date("2026-07-20T09:00:00Z");

console.log("band-classificatie (rood blijft schaars):");
{
  // Een kritieke analyse-finding is GEEN operationele brand → nooit rood.
  const insight = insightToFeedItem({ id: "i1", client_id: "c1", sop_type: "meta_signals", insight_type: "risk", title: "CTR zakt", description: "x", severity: "critical", affected_entity: "Campagne", metric: "CTR", change_pct: -30, action_required: true, created_at: NOW.toISOString() }, "Klant A");
  assert(insight.severity === "decision", "kritieke analyse-finding met action_required => beslissing, niet rood");
  assert(insight.type === "issue" && insight.channel === "meta", "risk-type => issue, kanaal uit sop_type");

  const soft = insightToFeedItem({ id: "i2", client_id: "c1", sop_type: null, insight_type: "opportunity", title: "Kans", description: null, severity: "medium", affected_entity: null, metric: null, change_pct: 12, action_required: false, created_at: NOW.toISOString() }, "Klant A");
  assert(soft.severity === "watch" && soft.type === "signal", "kans zonder actie => volgt/signaal");
  assert(soft.impactDirection === "gain", "positieve change => gain");

  // Overdue taak = wél rood; toekomstige hoge-prio taak = beslissing.
  const overdue = taskToFeedItem({ id: "t1", client_id: "c1", title: "Fix", description: "x", priority: "high", due_date: "2026-07-19", status: "open" }, "Klant A", NOW);
  assert(overdue.severity === "critical" && overdue.type === "task", "verlopen deadline => rood");
  const future = taskToFeedItem({ id: "t2", client_id: "c1", title: "Later", description: "x", priority: "high", due_date: "2026-08-01", status: "open" }, "Klant A", NOW);
  assert(future.severity === "decision", "toekomstige hoge-prio taak => beslissing");

  // Overview: sync-fout = rood; YoY-drop = beslissing (substantieel, niet 'kapot vandaag').
  const ops = overviewToFeedItems("c2", "Klant B", { error: "429 rate limit", yoy: { convChange: -35 } });
  assert(ops.some((o) => o.id.endsWith("sync-error") && o.severity === "critical"), "sync-fout => rood");
  assert(ops.some((o) => o.id.endsWith("yoy-drop") && o.severity === "decision"), "YoY-drop => beslissing");
}

console.log("beslissingen dragen ICE:");
{
  const rec = recommendationToFeedItem({ id: "r1", client_id: "c1", sop_type: "meta_kpi", hypothesis: "Schaal Brand NL", expected_result: "+18 conversies", ice_total: 74, status: "open" }, "Klant A");
  assert(rec.severity === "decision" && rec.iceScore === 74, "aanbeveling => beslissing met ICE");
  const hyp = hypothesisToFeedItem({ id: "h1", client_id: "c1", source: "linkedin_signals", hypothesis: "Test form", expected_result: "meer leads", rationale: "x", ice_total: 61, status: "pending", created_at: NOW.toISOString() }, "Klant A");
  assert(hyp.status === "awaiting_approval" && hyp.channel === "linkedin", "pending hypothese => wacht op akkoord, kanaal uit source");
}

console.log("feed-state-overlay:");
{
  const item = recommendationToFeedItem({ id: "r1", client_id: "c1", sop_type: null, hypothesis: "x", expected_result: "y", ice_total: 50, status: "open" }, "Klant A");
  const snooze: FeedStateRow = { item_key: item.id, client_id: "c1", source: "recommendation", assigned_owner: "Sander", snoozed_until: "2026-07-25T00:00:00Z", snooze_reason: "wacht op klant", feed_status: "in_progress", updated_by: "u1", updated_at: NOW.toISOString() };
  const applied = applyFeedState(item, snooze, NOW);
  assert(applied.status === "snoozed" && applied.snoozeReason === "wacht op klant", "actieve snooze wint van handmatige status");
  assert(applied.ownerName === "Sander" && applied.ownerIsMock === false, "handmatige toewijzing overschrijft owner en is niet mock");

  const resolved = applyFeedState(item, { ...snooze, snoozed_until: null, feed_status: "resolved" }, NOW);
  assert(resolved.status === "resolved" && resolved.resolvedAt != null, "handmatig opgelost zet status + resolvedAt");
}

console.log("auto-resolve uit de data:");
{
  const a = recommendationToFeedItem({ id: "r1", client_id: "c1", sop_type: null, hypothesis: "a", expected_result: "", ice_total: 40, status: "open" }, "K");
  const b = recommendationToFeedItem({ id: "r2", client_id: "c1", sop_type: null, hypothesis: "b", expected_result: "", ice_total: 40, status: "open" }, "K");
  // state voor r1 (in behandeling) + voor een verdwenen item r9 (was in behandeling).
  const state: FeedStateRow[] = [
    { item_key: a.id, client_id: "c1", source: "recommendation", assigned_owner: null, snoozed_until: null, snooze_reason: null, feed_status: "in_progress", updated_by: "u", updated_at: NOW.toISOString() },
    { item_key: "recommendation:c1:r9", client_id: "c1", source: "recommendation", assigned_owner: null, snoozed_until: null, snooze_reason: null, feed_status: "in_progress", updated_by: "u", updated_at: NOW.toISOString() },
  ];
  const res = reconcileFeed([a, b], state, NOW);
  assert(res.items.length === 2, "beide bron-items blijven actief");
  assert(res.items.find((i) => i.id === a.id)?.status === "in_progress", "state toegepast op aanwezig item");
  assert(res.autoResolvedCount === 1, "verdwenen state-item (r9) telt als automatisch opgelost");
}

console.log("sortering per band:");
{
  const mk = (id: string, over: Partial<FeedItem>): FeedItem => ({ ...recommendationToFeedItem({ id, client_id: "c1", sop_type: null, hypothesis: id, expected_result: "", ice_total: 0, status: "open" }, "K"), ...over });
  const decisions = [mk("a", { iceScore: 30, impactValue: 100 }), mk("b", { iceScore: 90, impactValue: 100 }), mk("c", { iceScore: 50, impactValue: 500 })];
  const sorted = sortBand(decisions, "decision").map((i) => i.id.split(":").pop());
  assert(sorted[0] === "c", "hoogste impact eerst");
  assert(sorted[1] === "b" && sorted[2] === "a", "bij gelijke impact: hoogste ICE eerst");
}

console.log("Risico open telt measured (echt + demo in demo-mode), nooit geschat:");
{
  const realRisk: FeedItem = { ...recommendationToFeedItem({ id: "r1", client_id: "c1", sop_type: null, hypothesis: "x", expected_result: "", ice_total: 0, status: "open" }, "K"), severity: "critical", impactType: "measured", impactDirection: "risk", impactValue: 430 };
  const estimated: FeedItem = { ...realRisk, id: "r2", impactType: "estimated", impactValue: 9999 };
  assert(measuredRiskOpen([realRisk, estimated]) === 430, "geschat effect telt nooit mee in Risico open");

  // Demo-set: een measured risico-kaart telt mee wanneer hij aanwezig is (dat is alleen in demo-mode).
  const demo = demoFeedItems([{ id: "c1", name: "K" }], NOW).find((i) => i.impactType === "measured" && i.impactDirection === "risk" && i.impactValue != null)!;
  assert(demo.isMock === true, "demo-kaart is als mock gemarkeerd");
  assert(measuredRiskOpen([realRisk, demo]) === 430 + (demo.impactValue ?? 0), "measured demo-risico telt mee binnen demo-context");
  assert(mockOwnerFor("c1") === null || typeof mockOwnerFor("c1")?.name === "string", "mockOwnerFor geeft een teamlid of Niet toegewezen");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle feed-tests geslaagd");
