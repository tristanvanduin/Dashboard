// Test voor de H2-taakopvolging-kern (W2.4). Deterministisch, geen IO.
// Draaien: npx tsx lib/tasks/__task_tracking_test.ts

import { normalizeTaskKey, extractTasksFromOutput, planTaskPersist, buildTaskStatusGrounding, shouldReRecommendExecutedTask, type TaskContext, type ExistingOpenTask, type PriorTask } from "./task-tracking";
import type { FinalSopTask } from "@/lib/analysis/monthly-structured";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const ctx: TaskContext = { runKey: "job-2", clientId: "minismus", channel: "google_ads", sopType: "monthly" };
function taak(h: string, object: string, linked = 1): FinalSopTask {
  return { linked_recommendation: linked, handeling: h, object, meet_via: "CPA", voorwaarde: "v", beslisregel: "b", risico: "r" };
}

// ── Extractie ──
const rows = extractTasksFromOutput([taak("Verhoog budget", "Campagne A"), taak("Pauzeer zoekterm", "term xyz", 2)], ctx);
assert(rows.length === 2, "twee taken worden twee rijen");
assert(rows[0].task_number === 1 && rows[1].task_number === 2, "taaknummers oplopend");
assert(rows[0].handeling === "Verhoog budget" && rows[0].entity_name === "Campagne A" && rows[0].meet_via === "CPA", "velden overgenomen, object wordt entity_name");
assert(rows[1].linked_recommendation === 2, "linked_recommendation overgenomen");
assert(rows[0].status === "open" && rows[0].deadline_hint === null && rows[0].run_key === "job-2", "status open, deadline null, run_key gezet");

// ── Normalisatie ──
assert(normalizeTaskKey("Verhoog Budget!", "Campagne A") === normalizeTaskKey("verhoog  budget", "campagne a"), "normalisatie negeert hoofdletters, leestekens en dubbele spaties");
assert(normalizeTaskKey("Verhoog budget", "Campagne A") !== normalizeTaskKey("Verhoog budget", "Campagne B"), "verschillende entiteit geeft een andere sleutel");

// ── Dedupe-plan ──
const bestaand: ExistingOpenTask[] = [{ id: 10, handeling: "Verhoog budget", entity_name: "Campagne A", occurrence_count: 1 }];
const plan = planTaskPersist(
  extractTasksFromOutput([taak("verhoog  budget!", "campagne a"), taak("Nieuwe taak", "Campagne B")], ctx),
  bestaand
);
assert(plan.toInsert.length === 1 && plan.toInsert[0].handeling === "Nieuwe taak", "een echt nieuwe taak wordt ingevoegd");
assert(plan.toIncrement.length === 1 && plan.toIncrement[0].id === 10, "een taak die een open taak raakt verhoogt de teller in plaats van te dupliceren");
assert(plan.toIncrement[0].occurrence_count === 2 && plan.toIncrement[0].last_run_key === "job-2", "de teller gaat naar 2 met de laatste run_key");

// Dubbele taak binnen dezelfde run: eenmalig verwerkt
const dubbelInRun = planTaskPersist(extractTasksFromOutput([taak("Test", "X"), taak("test", "x")], ctx), []);
assert(dubbelInRun.toInsert.length === 1, "een dubbele taak binnen dezelfde run wordt eenmalig ingevoegd");

// Geen open taken: alles nieuw
assert(planTaskPersist(extractTasksFromOutput([taak("A", "1"), taak("B", "2")], ctx), []).toInsert.length === 2, "zonder open taken wordt alles ingevoegd");

// ── Feed-forward-formatter ──
assert(buildTaskStatusGrounding([]) === "", "lege takenlijst geeft een lege string");
const prior: PriorTask[] = [
  { handeling: "Verhoog budget", entity_name: "Campagne A", status: "done", execution_status: "confirmed", deadline_hint: "deze_week" },
  { handeling: "Fix tracking", entity_name: null, status: "open", execution_status: "unknown", deadline_hint: "direct" },
  { handeling: "Test doelgroep", entity_name: "DG1", status: "in_progress", execution_status: "detected", deadline_hint: "deze_maand" },
];
const grounding = buildTaskStatusGrounding(prior);
assert(grounding.includes("Afgeronde taken") && grounding.includes("Verhoog budget"), "afgeronde taken staan apart");
assert(grounding.includes("niet opnieuw aanbevelen tenzij"), "de her-aanbeveel-regel staat erbij");
assert(grounding.includes("[open] Fix tracking") && grounding.includes("deadline direct, escaleer"), "een openstaande taak met deadline direct wordt ge-escaleerd");
assert(grounding.includes("uitvoering gedetecteerd"), "een gedetecteerde maar onbevestigde uitvoering wordt gemeld");
assert(grounding.includes("Verzin geen taken"), "anti-hallucinatie-slotzin aanwezig");

// ── Her-aanbeveel-check ──
// ROAS (hoger is beter): van 4.0 naar 3.0 is 25 procent slechter, dus opnieuw aanbevelen
assert(shouldReRecommendExecutedTask(4.0, 3.0, true) === true, "ROAS 25 procent gedaald: opnieuw aanbevelen");
assert(shouldReRecommendExecutedTask(4.0, 3.7, true) === false, "ROAS 7,5 procent gedaald: niet opnieuw aanbevelen");
// CPA (lager is beter): van 20 naar 26 is 30 procent slechter, dus opnieuw aanbevelen
assert(shouldReRecommendExecutedTask(20, 26, false) === true, "CPA 30 procent gestegen: opnieuw aanbevelen");
assert(shouldReRecommendExecutedTask(20, 21, false) === false, "CPA 5 procent gestegen: niet opnieuw aanbevelen");
// Verbetering telt nooit als reden
assert(shouldReRecommendExecutedTask(20, 15, false) === false, "een verbetering is nooit een reden om opnieuw aan te bevelen");
assert(shouldReRecommendExecutedTask(0, 5, true) === false, "zonder basiswaarde geen her-aanbeveling");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
