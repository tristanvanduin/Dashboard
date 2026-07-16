/**
 * One-time import script: imports existing sprint planning CSV into Supabase.
 *
 * Usage: npx tsx scripts/import-sprint-planning.ts <client_id> <csv_path>
 * Example: npx tsx scripts/import-sprint-planning.ts gads-8714777147 ~/Downloads/sprintplanning.csv
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const STATUS_MAP: Record<string, string> = {
  "Klaar": "done",
  "To Do": "todo",
  "in Planning": "in_planning",
  "On going": "ongoing",
  "Backlog / Verlopen": "expired",
  "Backlog": "backlog",
  "Verlopen": "expired",
};

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  let currentRow: string[] = [];
  let inQuote = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (!inQuote) {
      currentRow = [];
    }

    // Simple CSV parsing with quote handling
    let field = inQuote ? currentRow[currentRow.length - 1] + "\n" : "";
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        if (inQuote) {
          currentRow[currentRow.length - 1] = field;
        } else {
          currentRow.push(field);
        }
        field = "";
      } else {
        field += ch;
      }
    }

    if (inQuote) {
      currentRow[currentRow.length - 1] = field;
      continue; // multi-line field, keep going
    }

    currentRow.push(field);

    const obj: Record<string, string> = {};
    for (let k = 0; k < headers.length; k++) {
      obj[headers[k]] = (currentRow[k] || "").trim();
    }
    rows.push(obj);
  }

  return rows;
}

async function main() {
  const clientId = process.argv[2];
  const csvPath = process.argv[3];

  if (!clientId || !csvPath) {
    console.error("Usage: npx tsx scripts/import-sprint-planning.ts <client_id> <csv_path>");
    process.exit(1);
  }

  const content = readFileSync(csvPath, "utf-8");
  const rows = parseCSV(content);

  console.log(`Parsed ${rows.length} rows from CSV`);

  // Group rows by hypothesis text
  const hypothesisGroups = new Map<string, typeof rows>();

  for (const row of rows) {
    const hyp = row["Hypothese"] || "(geen hypothese)";
    if (!hypothesisGroups.has(hyp)) hypothesisGroups.set(hyp, []);
    hypothesisGroups.get(hyp)!.push(row);
  }

  console.log(`Found ${hypothesisGroups.size} unique hypotheses`);

  for (const [hypothesis, tasks] of hypothesisGroups) {
    // Determine hypothesis status from task statuses
    const allDone = tasks.every((t) => t["Status"] === "Klaar");
    const hypStatus = allDone ? "completed" : "accepted";

    // Get metrics and timeframe from first task
    const metrics = tasks[0]["Metrics"] || null;
    const timeframe = tasks[0]["Looptijd tot Beoordeling"] || null;

    // Insert hypothesis
    const { data: inserted } = await supabase
      .from("sprint_hypotheses")
      .insert({
        client_id: clientId,
        hypothesis: hypothesis === "(geen hypothese)" ? "Import: geen hypothese" : hypothesis,
        expected_result: null,
        measurement_metric: metrics,
        timeframe,
        rationale: null,
        ice_impact: 0,
        ice_confidence: 0,
        ice_ease: 0,
        ice_total: 0,
        status: hypStatus,
        accepted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!inserted) {
      console.error(`Failed to insert hypothesis: ${hypothesis.slice(0, 50)}`);
      continue;
    }

    // Insert tasks
    const sprintItems = tasks.map((t) => ({
      client_id: clientId,
      hypothesis_id: inserted.id,
      week_number: t["Week"] ? parseInt(t["Week"]) : null,
      task: t["Taak"] || "(geen taak)",
      status: STATUS_MAP[t["Status"]] || "todo",
      owner: t["Verantwoordelijke"] || "Ranking Masters",
      metrics: t["Metrics"] || null,
      review_timeframe: t["Looptijd tot Beoordeling"] || null,
    }));

    await supabase.from("sprint_items").insert(sprintItems);
    console.log(`  ✓ ${hypothesis.slice(0, 60)}... → ${sprintItems.length} taken`);
  }

  console.log("\nImport voltooid!");
}

main().catch(console.error);
