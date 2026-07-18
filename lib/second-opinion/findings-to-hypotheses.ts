// ============================================================
// SI2: second-opinion-bevindingen -> goedkeuringswachtrij
// ------------------------------------------------------------
// De deterministische second-opinion produceert een audit-scorekaart.
// De andere analyses voeden hun voorstellen in sprint_hypotheses (de
// goedkeuringswachtrij: observeren, voorstellen, goedkeuren, uitvoeren,
// evalueren). Deze mapping laat een Onvoldoende-bevinding daar ook landen,
// als voorgestelde actie met status pending.
//
// De ICE-score is niet arbitrair: impact en complexity staan al per
// controlepunt in het audit-template, en de evaluator levert een confidence.
// Die mappen direct op de ICE-schaal 1-10 (totaal = (I + C + E) / 3).
// Bewust deterministisch: geen LLM-call, zodat de second-opinion
// deterministisch blijft en de mapping volledig testbaar is.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditRowResult } from "./types";
import type { Impact, Complexity } from "./template";
import { logger } from "@/lib/logger";

export interface SprintHypothesisRow {
  client_id: string;
  analysis_id: string | null;
  hypothesis: string;
  expected_result: string;
  measurement_metric: string;
  timeframe: string;
  rationale: string;
  ice_impact: number;
  ice_confidence: number;
  ice_ease: number;
  ice_total: number;
  status: "pending";
  source: ProposalSource;
}

// Impact/complexity/confidence -> ICE-schaal 1-10.
function impactToScore(impact: Impact): number {
  return impact === "Hoog" ? 8 : impact === "Midden" ? 5 : 2;
}
// Complexer betekent minder makkelijk: Simpel hoog, Complex laag.
function complexityToEase(complexity: Complexity): number {
  return complexity === "Simpel" ? 8 : complexity === "Midden" ? 5 : 2;
}
function confidenceToScore(confidence: AuditRowResult["confidence"]): number {
  return confidence === "high" ? 8 : confidence === "medium" ? 5 : 2;
}
// Complexere fixes krijgen een langer tijdvak.
function complexityToTimeframe(complexity: Complexity): string {
  return complexity === "Simpel" ? "1 week" : complexity === "Midden" ? "2 weken" : "4 weken";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Zet de Onvoldoende-bevindingen om in voorgestelde-actie-rijen.
 * Houdt rekening met handmatige overrides (overrideScore en overrideComments gaan voor).
 * Voldoende- en hogere scores worden bewust niet omgezet: de wachtrij blijft de echte problemen.
 */
export function auditFindingsToHypotheses(
  findings: AuditRowResult[],
  opts: { clientId: string; analysisId: string }
): SprintHypothesisRow[] {
  const rows: SprintHypothesisRow[] = [];

  for (const f of findings) {
    const effectiveScore = f.overrideScore ?? f.score;
    if (effectiveScore !== "Onvoldoende") continue;

    const rationale = (f.overrideComments ?? f.comments ?? "").trim();
    const impact = impactToScore(f.impact);
    const confidence = confidenceToScore(f.confidence);
    const ease = complexityToEase(f.complexity);

    rows.push({
      client_id: opts.clientId,
      analysis_id: opts.analysisId,
      hypothesis: `Second opinion verbeterpunt in ${f.section}: ${f.controlPoint}`,
      expected_result: "Dit controlepunt verbetert van Onvoldoende naar minimaal Voldoende bij de volgende beoordeling.",
      measurement_metric: "Herbeoordeling van dit controlepunt in de second opinion.",
      timeframe: complexityToTimeframe(f.complexity),
      rationale: rationale.length > 0 ? rationale : `Controlepunt scoort Onvoldoende in de ${f.section}-sectie.`,
      ice_impact: impact,
      ice_confidence: confidence,
      ice_ease: ease,
      ice_total: round1((impact + confidence + ease) / 3),
      status: "pending",
      source: "second_opinion",
    });
  }

  // Hoogste ICE bovenaan, gelijk aan de sortering van de overige hypotheses.
  rows.sort((a, b) => b.ice_total - a.ice_total);
  return rows;
}

/**
 * Mapt de bevindingen en schrijft ze als pending voorstellen in sprint_hypotheses.
 * Aanroepen waar een second-opinion-run compleet is (findings, supabase, clientId en
 * de run-id beschikbaar). Geeft het aantal weggeschreven voorstellen terug.
 */
// SI6: "analysis" is de maandpipeline zelf (extract-structured). Alle drie de bronnen
// lopen nu via saveProposalsReplacingPending, zodat er EEN schrijfpad is met dezelfde
// veilige semantiek (insert voor delete, geaccepteerde voorstellen blijven staan).
// SI7: de losse Google-analyses voeden nu ook de wachtrij, elk via een eigen bron zodat de
// "vervang alleen mijn eigen pending"-semantiek per analyse geldt (een nieuwe budget-run
// ververst alleen budget-voorstellen, niet die van de biedstrategie).
export type ProposalSource =
  | "second_opinion"
  | "search_terms"
  | "analysis"
  | "budget_allocation"
  | "bid_strategy"
  | "impression_share"
  | "rsa_insights"
  | "landing_audit";

/**
 * Schrijft nieuwe pending voorstellen weg en vervangt de oude van dezelfde bron,
 * veilig zonder transactie. De volgorde is cruciaal: eerst de bestaande pending-ids
 * vastleggen, dan de nieuwe inserten, en de oude pas verwijderen als de insert is
 * geslaagd. Een mislukte insert verliest daardoor nooit pending voorstellen; in het
 * ergste geval blijven er dubbelen staan die de volgende run opruimt (zelfherstellend).
 * Geaccepteerde, afgewezen en afgeronde voorstellen blijven altijd staan; dat zijn al
 * genomen beslissingen.
 */
export async function saveProposalsReplacingPending(
  supabase: SupabaseClient,
  clientId: string,
  source: ProposalSource,
  rows: SprintHypothesisRow[]
): Promise<number> {
  // 1. Leg de bestaande pending-ids van deze bron vast voordat we iets wijzigen.
  const existing = await supabase
    .from("sprint_hypotheses")
    .select("id")
    .eq("client_id", clientId)
    .eq("source", source)
    .eq("status", "pending");
  if (existing.error) {
    logger.error("[" + source + "] Kon bestaande voorstellen niet lezen, schrijf overgeslagen:", existing.error.message);
    return 0; // niets gewijzigd, oude pending intact
  }
  const oldIds = ((existing.data ?? []) as { id: string }[]).map((r) => r.id);

  // 2. Geen nieuwe voorstellen: alleen de stale pending opschonen (verversen).
  if (rows.length === 0) {
    if (oldIds.length > 0) {
      const del = await supabase.from("sprint_hypotheses").delete().in("id", oldIds);
      if (del.error) logger.error("[" + source + "] Kon stale voorstellen niet opschonen:", del.error.message);
    }
    return 0;
  }

  // 3. Insert de nieuwe voorstellen.
  const ins = await supabase.from("sprint_hypotheses").insert(rows);
  if (ins.error) {
    logger.error("[" + source + "] Kon voorstellen niet opslaan, oude blijven staan:", ins.error.message);
    return 0; // insert mislukt: oude pending intact, geen verlies
  }

  // 4. Insert geslaagd: verwijder nu pas de oude pending. Faalt dit, dan blijven
  // dubbelen staan die de volgende run opruimt, nog steeds geen verlies.
  if (oldIds.length > 0) {
    const del = await supabase.from("sprint_hypotheses").delete().in("id", oldIds);
    if (del.error) logger.error("[" + source + "] Nieuwe voorstellen opgeslagen, oude opschonen mislukt (volgende run ruimt op):", del.error.message);
  }
  return rows.length;
}

/**
 * Mapt de bevindingen en schrijft ze veilig als pending voorstellen in sprint_hypotheses,
 * en vervangt de vorige pending van second_opinion. Geeft het aantal weggeschreven
 * voorstellen terug.
 */
export async function saveAuditFindingsAsHypotheses(
  supabase: SupabaseClient,
  findings: AuditRowResult[],
  opts: { clientId: string; analysisId: string }
): Promise<number> {
  const rows = auditFindingsToHypotheses(findings, opts);
  return saveProposalsReplacingPending(supabase, opts.clientId, "second_opinion", rows);
}
