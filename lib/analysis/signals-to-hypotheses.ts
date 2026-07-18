// ============================================================
// SI8: signaal-detecties -> goedkeuringswachtrij
// ------------------------------------------------------------
// De signaal-routes (Meta, LinkedIn, cross-channel) produceren SignalStory's met een
// zekerheidslabel. Deze generieke mapper aggregeert de getriggerde verhalen van EEN kanaal
// tot EEN beknopt voorstel (zelfde discipline als search_terms/SI7: de wachtrij loopt niet
// vol). Het ICE-vertrouwen volgt het zekerheidslabel — de wachtrij mag nooit meer zekerheid
// suggereren dan de detector claimt. Deterministisch, geen LLM, los getest.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignalStory, SignalCertainty } from "@/lib/signals/types";
import { saveProposalsReplacingPending, type SprintHypothesisRow, type ProposalSource } from "../second-opinion/findings-to-hypotheses";

export type SignalSource = Extract<ProposalSource, "meta_signals" | "linkedin_signals" | "cross_channel">;

// Zekerheid -> ICE-vertrouwen. Bewust conservatief: een verklaringskandidaat is een
// onderzoeksrichting, geen bewezen actie.
const CONFIDENCE_BY_CERTAINTY: Record<SignalCertainty, number> = {
  bewezen_binnen_platform: 8,
  indicatie: 5,
  verklaringskandidaat: 3,
};

const CHANNEL_LABEL: Record<SignalSource, string> = {
  meta_signals: "Meta",
  linkedin_signals: "LinkedIn",
  cross_channel: "cross-channel",
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Aggregeert de getriggerde signaalverhalen tot een voorstel. De hoogste zekerheid bepaalt
 * het vertrouwen; het aantal verhalen de impact. Geen verhalen: lege lijst (verversen).
 */
export function signalStoriesToHypotheses(
  stories: SignalStory[],
  source: SignalSource,
  opts: { clientId: string; analysisId: string | null }
): SprintHypothesisRow[] {
  if (stories.length === 0) return [];

  const label = CHANNEL_LABEL[source];
  const best: SignalCertainty = stories.some((s) => s.certainty === "bewezen_binnen_platform")
    ? "bewezen_binnen_platform"
    : stories.some((s) => s.certainty === "indicatie") ? "indicatie" : "verklaringskandidaat";

  const confidence = CONFIDENCE_BY_CERTAINTY[best];
  const impact = stories.length >= 3 ? 7 : stories.length === 2 ? 5 : 4;
  const ease = 5; // signaal-opvolging is onderzoek + gerichte ingreep, geen quick toggle

  // De verhalen zelf, compact: scope + kern, met het zekerheidslabel behouden.
  const detail = stories
    .slice(0, 4)
    .map((s) => `[${s.certainty}] ${s.scope}: ${s.story}`)
    .join(" ");
  const actions = [...new Set(stories.map((s) => s.actionDirection))].slice(0, 3).join(" · ");

  return [
    {
      client_id: opts.clientId,
      analysis_id: opts.analysisId,
      hypothesis: `Volg ${stories.length} gedetecteerd(e) ${label}-signa${stories.length === 1 ? "al" : "len"} op`,
      expected_result: "De onderliggende oorzaak is bevestigd of weerlegd en de bijbehorende ingreep is doorgevoerd, waarna het signaal in de volgende run dooft.",
      measurement_metric: `De signaal-detectie van ${label} in de volgende run (triggert het verhaal opnieuw?).`,
      timeframe: "2 weken",
      rationale: `${detail} Richting: ${actions}`,
      ice_impact: impact,
      ice_confidence: confidence,
      ice_ease: ease,
      ice_total: round1((impact + confidence + ease) / 3),
      status: "pending",
      source,
    },
  ];
}

/** Mapt en schrijft weg onder de eigen bron (vervangt alleen de eigen pending). */
export async function saveSignalHypotheses(
  supabase: SupabaseClient,
  stories: SignalStory[],
  source: SignalSource,
  opts: { clientId: string; analysisId: string | null }
): Promise<number> {
  return saveProposalsReplacingPending(supabase, opts.clientId, source, signalStoriesToHypotheses(stories, source, opts));
}
