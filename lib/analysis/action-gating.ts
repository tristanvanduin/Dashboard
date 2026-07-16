/**
 * Post-processing action gating.
 *
 * Deterministically downgrades recommendations that violate gating rules:
 * - direct_action requires evidence_level=deterministic + confidence=high
 * - small waste amounts (<€50) should not be direct_action
 * - conflicting actions on the same entity get downgraded
 * - low confidence findings cannot generate direct_action recommendations
 */

import type { Finding, Recommendation } from "../schema/analysis-schema";

/**
 * Apply action gating rules to recommendations based on their linked findings.
 * Mutates the recommendations in-place and returns them.
 */
export function applyActionGating(
  findings: Finding[],
  recommendations: Recommendation[]
): Recommendation[] {
  for (const rec of recommendations) {
    const readiness = (rec as Record<string, unknown>).action_readiness as string | undefined;
    const evidenceLevel = (rec as Record<string, unknown>).evidence_level as string | undefined;
    const confidence = (rec as Record<string, unknown>).confidence as string | undefined;

    // Rule 1: direct_action requires deterministic + high confidence
    if (readiness === "direct_action") {
      if (evidenceLevel !== "deterministic" || confidence !== "high") {
        (rec as Record<string, unknown>).action_readiness = "investigate_first";
      }
    }

    // Rule 2: Check linked finding for small signals
    if (rec.finding_index !== null && rec.finding_index !== undefined) {
      const finding = findings[rec.finding_index];
      if (finding) {
        // Small waste: if change involves <€50, downgrade from direct_action
        const absValue = Math.abs(finding.current_value ?? 0);
        if (absValue < 50 && readiness === "direct_action" && finding.insight_type !== "anomaly") {
          (rec as Record<string, unknown>).action_readiness = "monitor";
        }

        // Low confidence finding → max investigate_first
        const findingConfidence = (finding as Record<string, unknown>).confidence as string | undefined;
        if (findingConfidence === "low" && readiness === "direct_action") {
          (rec as Record<string, unknown>).action_readiness = "investigate_first";
        }
      }
    }

    // Rule 3: hypothesis source → always strategic_hypothesis
    if (rec.source === "hypothesis" && readiness === "direct_action") {
      (rec as Record<string, unknown>).action_readiness = "strategic_hypothesis";
    }
  }

  // Rule 4: Detect contradictions on same entity
  const entityActions = new Map<string, Array<{ rec: Recommendation; index: number }>>();
  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    // Group by affected entity (from hypothesis text or finding entity)
    const entityKey = rec.finding_index !== null && findings[rec.finding_index]
      ? findings[rec.finding_index].entity_name
      : rec.hypothesis.slice(0, 30);

    if (!entityActions.has(entityKey)) entityActions.set(entityKey, []);
    entityActions.get(entityKey)!.push({ rec, index: i });
  }

  for (const [, group] of entityActions) {
    if (group.length <= 1) continue;

    // Check for budget up + budget down on same entity
    const budgetUp = group.some((g) => g.rec.hypothesis.toLowerCase().includes("verhoog") && g.rec.hypothesis.toLowerCase().includes("budget"));
    const budgetDown = group.some((g) => g.rec.hypothesis.toLowerCase().includes("verlaag") && g.rec.hypothesis.toLowerCase().includes("budget"));
    if (budgetUp && budgetDown) {
      // Downgrade both to investigate_first
      for (const g of group) {
        if ((g.rec as Record<string, unknown>).action_readiness === "direct_action") {
          (g.rec as Record<string, unknown>).action_readiness = "investigate_first";
        }
      }
    }

    // Check for tROAS up + tROAS down
    const roasUp = group.some((g) => g.rec.hypothesis.toLowerCase().includes("verhoog") && g.rec.hypothesis.toLowerCase().includes("roas"));
    const roasDown = group.some((g) => g.rec.hypothesis.toLowerCase().includes("verlaag") && g.rec.hypothesis.toLowerCase().includes("roas"));
    if (roasUp && roasDown) {
      for (const g of group) {
        if ((g.rec as Record<string, unknown>).action_readiness === "direct_action") {
          (g.rec as Record<string, unknown>).action_readiness = "investigate_first";
        }
      }
    }
  }

  return recommendations;
}
