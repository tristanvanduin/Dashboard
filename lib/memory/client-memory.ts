// =====================================================================
// STATUS: GEBOUWD EN GETEST, MAAR NOG NIET GEWIRED (code-review must-fix 3).
// getClientMemory wordt nog niet aangeroepen. Activeren vereist een consument die het resultaat in de prompt-grounding injecteert. Neem niet aan dat de memory-laag live is.
// =====================================================================
// ============================================================
// E1: memory-leeslaag
// ------------------------------------------------------------
// Eén ingang om per client over de tijd terug te lezen wat er is gerapporteerd
// en welke voorstellen zijn gedaan, met hun status en uitkomst. Pure leeslaag
// over bestaande opslag (client_reports en sprint_hypotheses); geen nieuwe
// persistentie. Dit is de bron die de eindevaluatie (E3) en de decision-laag
// (E5) straks consumeren, zodat zij niet elk losse tabellen hoeven te bevragen.
//
// Bewust nog niet meegenomen: sop_insights/portfolio-detail (supplementair) en
// doel-versus-realisatie (vereist targets O2 en de editie-dimensie R1).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export interface MemoryReport {
  month: number;
  year: number;
  status: string; // draft, final, sent
  reportDate: string;
}

export interface MemoryHypothesis {
  hypothesis: string;
  status: string; // pending, accepted, rejected, completed
  source: string | null; // analysis, second_opinion, search_terms
  iceTotal: number;
  outcome: string | null;
  resultMet: boolean | null;
  learning: string | null;
  createdAt: string;
}

export interface ClientMemory {
  clientId: string;
  reports: MemoryReport[];
  hypotheses: MemoryHypothesis[];
}

/**
 * Leest de memory van een client: de rapporten-tijdlijn (nieuwste eerst) en de
 * hypotheses met hun status en uitkomst (nieuwste eerst). Faalt zacht per bron,
 * zodat een leesfout in de ene bron de andere niet blokkeert.
 */
export async function getClientMemory(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientMemory> {
  const reports: MemoryReport[] = [];
  const hypotheses: MemoryHypothesis[] = [];

  const { data: reportRows, error: reportErr } = await supabase
    .from("client_reports")
    .select("report_month, report_year, status, report_date")
    .eq("client_id", clientId)
    .order("report_date", { ascending: false });
  if (reportErr) {
    logger.error("[memory] Kon rapporten niet lezen:", reportErr.message);
  } else if (reportRows) {
    for (const r of reportRows as Record<string, unknown>[]) {
      reports.push({
        month: Number(r.report_month),
        year: Number(r.report_year),
        status: String(r.status),
        reportDate: String(r.report_date),
      });
    }
  }

  const { data: hypoRows, error: hypoErr } = await supabase
    .from("sprint_hypotheses")
    .select("hypothesis, status, source, ice_total, outcome, result_met, learning, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (hypoErr) {
    logger.error("[memory] Kon hypotheses niet lezen:", hypoErr.message);
  } else if (hypoRows) {
    for (const h of hypoRows as Record<string, unknown>[]) {
      hypotheses.push({
        hypothesis: String(h.hypothesis),
        status: String(h.status),
        source: h.source == null ? null : String(h.source),
        iceTotal: h.ice_total == null ? 0 : Number(h.ice_total),
        outcome: h.outcome == null ? null : String(h.outcome),
        resultMet: h.result_met == null ? null : Boolean(h.result_met),
        learning: h.learning == null ? null : String(h.learning),
        createdAt: String(h.created_at),
      });
    }
  }

  return { clientId, reports, hypotheses };
}


// E1-wiring: formatteert ClientMemory naar een beknopt grounding-blok voor de prompt.
// Puur en los testbaar. Lege memory geeft een lege string, zodat een nieuwe klant geen
// blok en dus geen gedragswijziging krijgt. De caps (3 rapporten, 8 hypotheses, uitkomst
// geprefereerd boven recent) houden het tokenbudget in toom.
export function buildClientMemoryGrounding(memory: ClientMemory): string {
  if (memory.reports.length === 0 && memory.hypotheses.length === 0) return "";
  const lines: string[] = ["## Eerdere analyses en hypotheses (client-geheugen)"];

  const recentReports = memory.reports.slice(0, 3);
  if (recentReports.length > 0) {
    lines.push("Recente rapporten:");
    for (const r of recentReports) lines.push(`- ${r.month}/${r.year} (${r.status})`);
  }

  const withOutcome = memory.hypotheses.filter((h) => h.outcome != null || h.resultMet != null).slice(0, 8);
  const toShow = withOutcome.length > 0 ? withOutcome : memory.hypotheses.slice(0, 8);
  if (toShow.length > 0) {
    lines.push("Eerdere hypotheses en uitkomsten:");
    for (const h of toShow) {
      const outcome = h.resultMet == null ? (h.outcome || h.status) : (h.resultMet ? "doel gehaald" : "doel niet gehaald");
      const learning = h.learning ? ` Learning: ${h.learning}` : "";
      lines.push(`- [${h.status}] ${h.hypothesis} (uitkomst: ${outcome}).${learning}`);
    }
  }

  lines.push("Gebruik dit om niet te herhalen wat al is geprobeerd en om voort te bouwen op wat werkte of faalde. Verzin geen geheugen dat hier niet staat.");
  return lines.join("\n");
}
