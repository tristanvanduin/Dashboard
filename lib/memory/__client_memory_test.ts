// Verificatie van de E1 memory-leeslaag. Mock-supabase, geen DB.
// Draaien: npx tsx lib/memory/__client_memory_test.ts

import { getClientMemory } from "./client-memory";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

type Result = { data?: unknown[] | null; error?: { message: string } | null };

function makeMock(config: { reports?: Result; hypos?: Result }): SupabaseClient {
  const client = {
    from(table: string) {
      const r = table === "client_reports" ? (config.reports ?? { data: [], error: null })
        : table === "sprint_hypotheses" ? (config.hypos ?? { data: [], error: null })
        : { data: [], error: null };
      const b = {
        select() { return b; },
        eq() { return b; },
        order() { return b; },
        then(resolve: (x: { data: unknown[] | null; error: { message: string } | null }) => void) {
          resolve({ data: r.data ?? null, error: r.error ?? null });
        },
      };
      return b;
    },
  };
  return client as unknown as SupabaseClient;
}

(async () => {
  // --- Happy path ---
  const m1 = makeMock({
    reports: { data: [{ report_month: 3, report_year: 2026, status: "final", report_date: "2026-03-01" }], error: null },
    hypos: { data: [{ hypothesis: "Verhoog budget", status: "accepted", source: "second_opinion", ice_total: 7, outcome: "Impression share gestegen", result_met: true, learning: "Budget was de bottleneck", created_at: "2026-03-02T10:00:00Z" }], error: null },
  });
  const mem = await getClientMemory(m1, "c1");
  console.log("Happy path: rapporten en hypotheses correct gevormd");
  check("clientId gezet", mem.clientId === "c1");
  check("een rapport, juist gevormd", mem.reports.length === 1 && mem.reports[0].month === 3 && mem.reports[0].year === 2026 && mem.reports[0].status === "final");
  check("een hypothese, juist gevormd", mem.hypotheses.length === 1 && mem.hypotheses[0].hypothesis === "Verhoog budget" && mem.hypotheses[0].status === "accepted");
  check("bron en ICE meegelezen", mem.hypotheses[0].source === "second_opinion" && mem.hypotheses[0].iceTotal === 7);
  check("uitkomst-velden meegelezen", mem.hypotheses[0].outcome === "Impression share gestegen" && mem.hypotheses[0].resultMet === true && mem.hypotheses[0].learning === "Budget was de bottleneck");

  // --- Nullable uitkomst (nog niet geevalueerd) ---
  const m2 = makeMock({
    hypos: { data: [{ hypothesis: "Test", status: "pending", source: "search_terms", ice_total: 5, outcome: null, result_met: null, learning: null, created_at: "2026-03-02T10:00:00Z" }], error: null },
  });
  const mem2 = await getClientMemory(m2, "c1");
  console.log("\nNog niet geevalueerde hypothese: uitkomst null, geen crash");
  check("uitkomst-velden zijn null", mem2.hypotheses[0].outcome === null && mem2.hypotheses[0].resultMet === null && mem2.hypotheses[0].learning === null);

  // --- Zachte fout per bron ---
  const m3 = makeMock({
    reports: { data: null, error: { message: "leesfout" } },
    hypos: { data: [{ hypothesis: "Blijft", status: "pending", source: null, ice_total: 4, outcome: null, result_met: null, learning: null, created_at: "2026-03-02T10:00:00Z" }], error: null },
  });
  const mem3 = await getClientMemory(m3, "c1");
  console.log("\nLeesfout in rapporten blokkeert de hypotheses niet");
  check("rapporten leeg bij fout", mem3.reports.length === 0);
  check("hypotheses nog steeds geleverd", mem3.hypotheses.length === 1 && mem3.hypotheses[0].source === null);

  console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
  if (failed > 0) process.exit(1);
})();
