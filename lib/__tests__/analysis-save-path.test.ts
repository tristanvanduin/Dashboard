import { prepareAnalysisOutputSaveRow } from "../analysis/helpers";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("\n=== Analysis Save Path Tests ===\n");

console.log("1. refreshCreatedAt stamps a fresh created_at on artifact saves");
{
  const baseRow = {
    client_id: "client-1",
    sop_type: "monthly",
    analysis_date: "2026-04-15",
    period_start: "2026-03-01",
    period_end: "2026-03-31",
    section: "full",
    output: "body",
    model_used: "test-model",
    tokens_used: 123,
  };

  const refreshed = prepareAnalysisOutputSaveRow(baseRow, true) as typeof baseRow & { created_at?: string };
  assert(typeof refreshed.created_at === "string", "created_at should be added");
  assert(!Number.isNaN(Date.parse(refreshed.created_at || "")), "created_at should be parseable");
}

console.log("2. no refresh keeps the row shape stable");
{
  const baseRow = {
    client_id: "client-1",
    sop_type: "monthly",
    analysis_date: "2026-04-15",
    period_start: "2026-03-01",
    period_end: "2026-03-31",
    section: "structured_monthly_v2",
    output: "{}",
    model_used: "test-model",
    tokens_used: 456,
  };

  const untouched = prepareAnalysisOutputSaveRow(baseRow, false) as typeof baseRow & { created_at?: string };
  assert(!("created_at" in untouched), "created_at should stay absent without refresh");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
