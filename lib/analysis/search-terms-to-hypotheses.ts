// ============================================================
// SI1: zoekterm-analyse -> goedkeuringswachtrij
// ------------------------------------------------------------
// De zoekterm-analyse adviseert per term een actie (negative_exact,
// negative_phrase, monitor, investigate). De actionable negatives zijn
// concrete verbeteracties, maar landden niet in sprint_hypotheses.
//
// Deze mapping aggregeert de geadviseerde negatives tot EEN beknopt
// voorstel, niet per term, zodat de wachtrij niet volloopt. Het detail
// per term staat in search_term_analysis en in de rationale.
//
// Deterministisch, geen LLM. Hergebruikt de source-kolom van SI2 met
// bron 'search_terms'.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SprintHypothesisRow } from "../second-opinion/findings-to-hypotheses";
import { saveProposalsReplacingPending } from "../second-opinion/findings-to-hypotheses";

// Minimale invoer; structureel compatibel met de verdicts uit de route.
export interface SearchTermVerdictInput {
  searchTerm: string;
  recommendedAction: string;
  cost: number;
  conversions: number;
}

// Spend-geschaalde impact: meer verspilde spend op de geadviseerde negatives
// betekent een hogere prioriteit in de wachtrij. Drempels in euro, SI1-lokaal.
const WASTE_IMPACT_HIGH_EUR = 100;
const WASTE_IMPACT_MID_EUR = 25;

const NEGATIVE_ACTIONS = ["negative_exact", "negative_phrase"];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Aggregeert de geadviseerde uitsluitzoekwoorden tot een voorstel.
 * Geeft een lege lijst terug als er geen negatives geadviseerd zijn.
 */
export function searchTermVerdictsToHypotheses(
  verdicts: SearchTermVerdictInput[],
  opts: { clientId: string; analysisId: string | null }
): SprintHypothesisRow[] {
  const negatives = verdicts.filter((v) => NEGATIVE_ACTIONS.includes(v.recommendedAction));
  if (negatives.length === 0) return [];

  const exactCount = negatives.filter((v) => v.recommendedAction === "negative_exact").length;
  const phraseCount = negatives.filter((v) => v.recommendedAction === "negative_phrase").length;
  const totalWaste = Math.round(negatives.reduce((s, v) => s + (v.cost ?? 0), 0));

  // Voorbeelden: de duurste termen eerst, maximaal vijf.
  const examples = [...negatives]
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
    .slice(0, 5)
    .map((v) => v.searchTerm)
    .join(", ");

  const impact = totalWaste >= WASTE_IMPACT_HIGH_EUR ? 8 : totalWaste >= WASTE_IMPACT_MID_EUR ? 5 : 2;
  const confidence = 8; // de adviezen zijn al door de guardrails gecorrigeerd
  const ease = 8; // uitsluitzoekwoorden toevoegen is simpel

  const breakdown = `${exactCount} exact, ${phraseCount} phrase. Verspilde spend op deze termen: ${totalWaste} euro. Voorbeelden: ${examples}.`;

  return [
    {
      client_id: opts.clientId,
      analysis_id: opts.analysisId,
      hypothesis: `Voeg ${negatives.length} uitsluitzoekwoorden toe op basis van de zoekterm-analyse`,
      expected_result: "Minder verspilde spend op niet-converterende zoektermen, budget verschuift naar relevante termen.",
      measurement_metric: "Verspilde spend op zoektermen zonder conversies in de volgende zoekterm-analyse.",
      timeframe: "1 week",
      rationale: breakdown,
      ice_impact: impact,
      ice_confidence: confidence,
      ice_ease: ease,
      ice_total: round1((impact + confidence + ease) / 3),
      status: "pending",
      source: "search_terms",
    },
  ];
}

/**
 * Mapt de verdicts en schrijft het voorstel als pending naar sprint_hypotheses.
 * Aanroepen waar de zoekterm-analyse compleet is. Geeft het aantal voorstellen terug.
 */
export async function saveSearchTermVerdictsAsHypotheses(
  supabase: SupabaseClient,
  verdicts: SearchTermVerdictInput[],
  opts: { clientId: string; analysisId: string | null }
): Promise<number> {
  const rows = searchTermVerdictsToHypotheses(verdicts, opts);
  return saveProposalsReplacingPending(supabase, opts.clientId, "search_terms", rows);
}
