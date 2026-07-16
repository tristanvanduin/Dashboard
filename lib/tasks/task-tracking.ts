// W2.4 (H2): de pure taakopvolging-kern. De foutgevoelige beslissingen (dedupe over runs,
// wel of niet opnieuw aanbevelen) staan hier, IO-vrij en los getest. De persist naar
// analysis_tasks en de schrijf-API zijn dunne wrappers hieromheen. Migratie 006 definieert
// de tabel; deze module levert de rijen en de feed-forward-context.

import type { FinalSopTask } from "@/lib/analysis/monthly-structured";

export type TaskStatus = "open" | "in_progress" | "done" | "skipped" | "wont_do";
export type ExecutionStatus = "unknown" | "detected" | "confirmed";
export type DeadlineHint = "direct" | "deze_week" | "deze_maand" | null;

export interface TaskContext {
  runKey: string;
  clientId: string;
  channel: string;
  sopType: string;
}

// De rij zoals analysis_tasks hem verwacht (migratie 006). deadline_hint blijft null bij
// extractie: de finale taak draagt hem niet, hij wordt in de sprint-tab gezet of later
// afgeleid. status start op open.
export interface TaskRow {
  run_key: string;
  client_id: string;
  channel: string;
  sop_type: string;
  task_number: number;
  linked_recommendation: number | null;
  handeling: string;
  entity_name: string | null;
  meet_via: string | null;
  deadline_hint: DeadlineHint;
  status: TaskStatus;
}

// Normaliseert handeling plus entiteit tot een dedupe-sleutel: kleine letters, getrimd,
// witruimte samengevouwen, leestekens weg. Zo matcht dezelfde aanbeveling over maanden heen.
export function normalizeTaskKey(handeling: string, entityName: string | null | undefined): string {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return `${norm(handeling)}::${norm(entityName ?? "")}`;
}

// Zet de taken uit de finale output om naar rijen. Puur.
export function extractTasksFromOutput(tasks: FinalSopTask[], context: TaskContext): TaskRow[] {
  return tasks.map((task, index) => ({
    run_key: context.runKey,
    client_id: context.clientId,
    channel: context.channel,
    sop_type: context.sopType,
    task_number: index + 1,
    linked_recommendation: typeof task.linked_recommendation === "number" ? task.linked_recommendation : null,
    handeling: task.handeling,
    entity_name: task.object || null,
    meet_via: task.meet_via || null,
    deadline_hint: null,
    status: "open",
  }));
}

export interface ExistingOpenTask {
  id: number;
  handeling: string;
  entity_name: string | null;
  occurrence_count: number;
}

export interface TaskPersistPlan {
  toInsert: TaskRow[];
  toIncrement: Array<{ id: number; occurrence_count: number; last_run_key: string }>;
}

// De dedupe-plan: een nieuwe taak die qua genormaliseerde sleutel een bestaande OPEN taak
// raakt, wordt niet gedupliceerd maar verhoogt de occurrence-teller met de laatste run_key.
// Zo stapelt de lijst niet elke maand met dezelfde aanbevelingen. Nieuwe taken worden
// ingevoegd. Puur.
export function planTaskPersist(newTasks: TaskRow[], existingOpen: ExistingOpenTask[]): TaskPersistPlan {
  const openByKey = new Map<string, ExistingOpenTask>();
  for (const t of existingOpen) openByKey.set(normalizeTaskKey(t.handeling, t.entity_name), t);

  const toInsert: TaskRow[] = [];
  const toIncrement: TaskPersistPlan["toIncrement"] = [];
  const gezienInDezeRun = new Set<string>();

  for (const task of newTasks) {
    const key = normalizeTaskKey(task.handeling, task.entity_name);
    if (gezienInDezeRun.has(key)) continue; // dubbele taak binnen dezelfde run: eenmalig
    gezienInDezeRun.add(key);

    const bestaand = openByKey.get(key);
    if (bestaand) {
      toIncrement.push({ id: bestaand.id, occurrence_count: bestaand.occurrence_count + 1, last_run_key: task.run_key });
    } else {
      toInsert.push(task);
    }
  }
  return { toInsert, toIncrement };
}

export interface PriorTask {
  handeling: string;
  entity_name: string | null;
  status: TaskStatus;
  execution_status: ExecutionStatus;
  deadline_hint: DeadlineHint;
}

// De feed-forward-context "Taakstatus vorige cyclus" voor de prepared context van de
// volgende run. Lege lijst geeft een lege string, dus geen gedragswijziging voor een
// eerste run. Niet-uitgevoerde taken met deadline direct worden expliciet ge-escaleerd,
// zodat de stapinstructies ze kunnen opvoeren.
export function buildTaskStatusGrounding(priorTasks: PriorTask[]): string {
  if (priorTasks.length === 0) return "";
  const lines: string[] = ["## Taakstatus vorige cyclus"];

  const uitgevoerd = priorTasks.filter((t) => t.status === "done");
  const openstaand = priorTasks.filter((t) => t.status !== "done" && t.status !== "wont_do" && t.status !== "skipped");

  if (uitgevoerd.length > 0) {
    lines.push("Afgeronde taken (niet opnieuw aanbevelen tenzij de metrics aantoonbaar terugvielen):");
    for (const t of uitgevoerd) lines.push(`- ${t.handeling}${t.entity_name ? ` (${t.entity_name})` : ""}`);
  }

  if (openstaand.length > 0) {
    lines.push("Nog openstaande taken:");
    for (const t of openstaand) {
      const escalatie = t.deadline_hint === "direct" ? " LET OP: deadline direct, escaleer deze expliciet." : "";
      const detectie = t.execution_status === "detected" ? " (uitvoering gedetecteerd, nog niet bevestigd)" : "";
      lines.push(`- [${t.status}] ${t.handeling}${t.entity_name ? ` (${t.entity_name})` : ""}${detectie}.${escalatie}`);
    }
  }

  lines.push("Baseer opvolging op deze status. Verzin geen taken die hier niet staan.");
  return lines.join("\n");
}

export const RERECOMMEND_WORSE_THRESHOLD = 0.2; // 20 procent slechter dan bij afronding

// Deterministische her-aanbeveel-check voor een afgeronde taak: alleen opnieuw aanbevelen
// als dezelfde entiteit en metric minstens 20 procent slechter zijn dan bij afronding.
// Richting: voor metrics waar hoger beter is (bijv. ROAS, conversies) is een daling
// slechter; geef higherIsBetter mee. Puur.
export function shouldReRecommendExecutedTask(
  valueAtCompletion: number,
  currentValue: number,
  higherIsBetter: boolean,
  threshold: number = RERECOMMEND_WORSE_THRESHOLD
): boolean {
  if (valueAtCompletion === 0) return false; // geen basis om tegen af te zetten
  const relatieveVerandering = (currentValue - valueAtCompletion) / Math.abs(valueAtCompletion);
  const verslechtering = higherIsBetter ? -relatieveVerandering : relatieveVerandering;
  return verslechtering >= threshold;
}
