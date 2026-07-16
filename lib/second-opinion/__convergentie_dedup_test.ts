// Verificatie van de convergentie-dedup en de veilige schrijfvolgorde.
// SI1 en SI2 verversen de pending van hun eigen bron zonder dubbel toe te voegen, en
// verliezen nooit pending bij een mislukte insert (eerst insert, dan pas delete).
// Mock-supabase, geen DB. Draaien: npx tsx lib/second-opinion/__convergentie_dedup_test.ts

import { saveAuditFindingsAsHypotheses } from "./findings-to-hypotheses";
import type { AuditRowResult } from "./types";
import { saveSearchTermVerdictsAsHypotheses, type SearchTermVerdictInput } from "../analysis/search-terms-to-hypotheses";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

type Op = { type: "select" | "insert" | "delete"; table: string; filters?: Record<string, unknown>; rowCount?: number };

function makeMock(cfg: { oldPending?: string[]; insertFails?: boolean } = {}) {
  const ops: Op[] = [];
  const old = cfg.oldPending ?? [];
  const from = (table: string) => ({
    select(_cols: string) {
      const filters: Record<string, unknown> = {};
      const b = {
        eq(k: string, v: unknown) { filters[k] = v; return b; },
        then(res: (r: { data: { id: string }[]; error: null }) => void) {
          ops.push({ type: "select", table, filters });
          res({ data: old.map((id) => ({ id })), error: null });
        },
      };
      return b;
    },
    insert(rows: unknown[]) {
      return {
        then(res: (r: { error: { message: string } | null }) => void) {
          ops.push({ type: "insert", table, rowCount: rows.length });
          res({ error: cfg.insertFails ? { message: "insert faalde" } : null });
        },
      };
    },
    delete() {
      const filters: Record<string, unknown> = {};
      const b = {
        eq(k: string, v: unknown) { filters[k] = v; return b; },
        in(k: string, v: unknown[]) { filters[k] = v; return b; },
        then(res: (r: { error: null }) => void) {
          ops.push({ type: "delete", table, filters });
          res({ error: null });
        },
      };
      return b;
    },
  });
  return { client: { from } as unknown as SupabaseClient, ops };
}

function finding(p: Partial<AuditRowResult>): AuditRowResult {
  return {
    templateId: 1, section: "Bieding / Budget", controlPoint: "Is het budget toereikend?",
    impact: "Midden", complexity: "Midden", score: "Goed", comments: "",
    supportStatus: "supported", evidenceSources: [], confidence: "medium", method: "deterministic", ...p,
  };
}
function verdict(p: Partial<SearchTermVerdictInput>): SearchTermVerdictInput {
  return { searchTerm: "term", recommendedAction: "monitor", cost: 0, conversions: 0, ...p };
}

(async () => {
  // 1. SI2 met bestaande pending en een nieuwe bevinding: veilige volgorde select, insert, delete.
  const m = makeMock({ oldPending: ["old-1", "old-2"] });
  const n = await saveAuditFindingsAsHypotheses(m.client, [finding({ score: "Onvoldoende" })], { clientId: "c1", analysisId: "run-1" });
  console.log("SI2: veilige volgorde select, insert, dan pas delete");
  check("drie ops in de juiste volgorde", m.ops.map(o => o.type).join(",") === "select,insert,delete", JSON.stringify(m.ops.map(o => o.type)));
  check("insert komt voor delete (geen verlies bij falen)", m.ops.findIndex(o => o.type === "insert") < m.ops.findIndex(o => o.type === "delete"));
  check("select filtert op client, bron en pending", m.ops[0].filters?.client_id === "c1" && m.ops[0].filters?.source === "second_opinion" && m.ops[0].filters?.status === "pending");
  check("delete verwijdert exact de oude ids", Array.isArray(m.ops[2].filters?.id) && (m.ops[2].filters?.id as string[]).join(",") === "old-1,old-2");
  check("aantal teruggegeven", n === 1);

  // 2. SI2 met een MISLUKTE insert: oude pending blijft staan, geen delete. De bug-fix.
  const mf = makeMock({ oldPending: ["old-1"], insertFails: true });
  const nf = await saveAuditFindingsAsHypotheses(mf.client, [finding({ score: "Onvoldoende" })], { clientId: "c1", analysisId: "run-1" });
  console.log("\nSI2: mislukte insert verliest geen pending (de bug-fix)");
  check("geen delete na mislukte insert", !mf.ops.some(o => o.type === "delete"), JSON.stringify(mf.ops.map(o => o.type)));
  check("returnt 0 bij mislukte insert", nf === 0);

  // 3. SI2 zonder bevinding maar met stale pending: alleen opschonen, geen insert.
  const m2 = makeMock({ oldPending: ["old-1"] });
  await saveAuditFindingsAsHypotheses(m2.client, [finding({ score: "Goed" })], { clientId: "c1", analysisId: "run-1" });
  console.log("\nSI2: zonder probleem de stale pending opschonen, geen insert");
  check("select dan delete, geen insert", m2.ops.map(o => o.type).join(",") === "select,delete", JSON.stringify(m2.ops.map(o => o.type)));

  // 4. SI2 eerste run zonder bestaande pending: alleen insert, geen overbodige delete.
  const m0 = makeMock({ oldPending: [] });
  await saveAuditFindingsAsHypotheses(m0.client, [finding({ score: "Onvoldoende" })], { clientId: "c1", analysisId: "run-1" });
  console.log("\nSI2: eerste run zonder oude pending, geen overbodige delete");
  check("select dan insert, geen delete", m0.ops.map(o => o.type).join(",") === "select,insert", JSON.stringify(m0.ops.map(o => o.type)));

  // 5. SI1 met negatives: dezelfde veilige volgorde en bron search_terms.
  const m3 = makeMock({ oldPending: ["old-x"] });
  await saveSearchTermVerdictsAsHypotheses(m3.client, [verdict({ recommendedAction: "negative_exact", cost: 50 })], { clientId: "c2", analysisId: null });
  console.log("\nSI1: veilige volgorde en bron search_terms");
  check("select, insert, delete", m3.ops.map(o => o.type).join(",") === "select,insert,delete", JSON.stringify(m3.ops.map(o => o.type)));
  check("select filtert op bron search_terms", m3.ops[0].filters?.source === "search_terms" && m3.ops[0].filters?.client_id === "c2");

  // 6. SI1 zonder negatives: alleen opschonen.
  const m4 = makeMock({ oldPending: ["old-x"] });
  await saveSearchTermVerdictsAsHypotheses(m4.client, [verdict({ recommendedAction: "monitor" })], { clientId: "c2", analysisId: null });
  console.log("\nSI1: zonder negatives alleen opschonen");
  check("select dan delete, geen insert", m4.ops.map(o => o.type).join(",") === "select,delete", JSON.stringify(m4.ops.map(o => o.type)));

  console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
  if (failed > 0) process.exit(1);
})();
