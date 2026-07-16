/**
 * Deterministic guardrails for search term analysis.
 *
 * Runs AFTER LLM classification to catch and correct unsafe recommendations.
 * Policy layers:
 *   1. Core protection (converting terms, brand terms, low spend)
 *   2. Intent-specific policy (competitor, commercial, informational)
 *   3. Negative keyword safety (phrase vs exact, risk flagging)
 *   4. Cluster consistency (same theme = same action)
 *   5. Review readiness (derive actionReadiness, evidenceLevel, safer alternatives)
 */

import type { SearchTermVerdict } from "../schema/search-term-schema";

interface TermWithData extends SearchTermVerdict {
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  campaignName: string;
  adGroupName: string;
}

// ── Intent normalization ───────────────────────────────────────────────────

const INTENT_NORMALIZE: Record<string, string> = {
  "transactional": "generic_commercial",
  "informational": "generic_informational",
  "competitor": "branded_competitor",
  "brand": "branded_own",
};

function normalizeIntent(v: TermWithData): void {
  if (v.intentType && INTENT_NORMALIZE[v.intentType]) {
    v.intentType = INTENT_NORMALIZE[v.intentType] as typeof v.intentType;
  }
}

// ── Core guardrails ────────────────────────────────────────────────────────

export function applySearchTermGuardrails(verdicts: TermWithData[]): TermWithData[] {
  // Phase 1: Per-term guardrails
  for (const v of verdicts) {
    normalizeIntent(v);

    // ── Rule 1: Converting terms are ALWAYS keep ──
    if (v.conversions > 0) {
      if (v.recommendedAction !== "keep") {
        v.saferAlternativeAction = v.recommendedAction;
        v.saferAlternativeReason = `Origineel aanbevolen: ${v.recommendedAction}. Overschreven omdat term ${v.conversions} conversie(s) heeft.`;
        v.recommendedAction = "keep";
        v.verdict = "relevant";
        v.relevanceScore = Math.max(v.relevanceScore, 4);
        v.confidence = "high";
        v.reason = `Term heeft ${v.conversions} conversie(s) — altijd behouden.`;
      }
      v.evidenceLevel = "deterministic";
    }

    // ── Rule 2: Brand campaign terms ──
    const lowerCampaign = v.campaignName.toLowerCase();
    const isBrandCampaign = lowerCampaign.includes("brand") || lowerCampaign.includes("merknaam");
    if (isBrandCampaign && v.recommendedAction !== "keep") {
      v.saferAlternativeAction = v.recommendedAction;
      v.saferAlternativeReason = `Origineel: ${v.recommendedAction}. Overschreven: term zit in branded campagne.`;
      v.recommendedAction = "keep";
      v.verdict = "relevant";
      v.relevanceScore = Math.max(v.relevanceScore, 4);
      v.confidence = "high";
      v.intentType = "branded_own";
      v.reason = `Term in branded campagne — altijd behouden.`;
    }

    // ── Rule 3: Low spend → downgrade aggressive actions ──
    if (v.cost < 5 && v.conversions === 0 && (v.recommendedAction === "negative_exact" || v.recommendedAction === "negative_phrase")) {
      v.saferAlternativeAction = v.recommendedAction;
      v.saferAlternativeReason = `Origineel: ${v.recommendedAction}. Te weinig spend (${v.cost.toFixed(2)} euro) voor betrouwbare uitsluiting.`;
      v.recommendedAction = "monitor";
      v.confidence = "low";
      v.commercialityLevel = v.commercialityLevel ?? "low";
    }

    // ── Rule 4: Competitor terms — never phrase negative, prefer investigate ──
    if (v.intentType === "branded_competitor") {
      if (v.recommendedAction === "negative_phrase") {
        v.saferAlternativeAction = "negative_phrase";
        v.saferAlternativeReason = "Phrase-uitsluiting op concurrent is te risicovol — kan bredere queries blokkeren.";
        v.recommendedAction = v.cost > 50 && v.conversions === 0 ? "negative_exact" : "investigate";
        v.riskFlag = true;
      }
      if (v.recommendedAction === "negative_exact" && v.cost < 50) {
        v.saferAlternativeAction = "negative_exact";
        v.saferAlternativeReason = `Concurrent met slechts ${v.cost.toFixed(2)} euro spend — investigate is veiliger.`;
        v.recommendedAction = "investigate";
      }
      v.requiresHumanReview = true;
    }

    // ── Rule 5: Core commercial terms — protect from reckless exclusion ──
    if ((v.intentType === "generic_commercial" || v.intentType === "product_specific" || v.intentType === "category_broad") && v.conversions === 0) {
      if (v.recommendedAction === "negative_exact" || v.recommendedAction === "negative_phrase") {
        if (v.relevanceScore >= 3) {
          // Relevant commercial term with 0 conversions = probably execution problem, not bad traffic
          v.saferAlternativeAction = v.recommendedAction;
          v.saferAlternativeReason = `Relevante commerciele term (score ${v.relevanceScore}) met 0 conversies. Probleem kan liggen bij landingspagina, prijs, of campagnestructuur — niet bij de zoekterm zelf.`;
          v.recommendedAction = "investigate";
          v.requiresHumanReview = true;
        }
      }
    }

    // ── Rule 6: Informational terms — never phrase negative ──
    if (v.intentType === "generic_informational" && v.recommendedAction === "negative_phrase") {
      v.saferAlternativeAction = "negative_phrase";
      v.saferAlternativeReason = "Phrase-uitsluiting op informatieve termen is te breed — kan waardevolle varianten blokkeren.";
      v.recommendedAction = "negative_exact";
      v.riskFlag = true;
    }

    // ── Rule 7: Short term phrase negative = always risky ──
    if (v.recommendedAction === "negative_phrase") {
      const wordCount = v.searchTerm.trim().split(/\s+/).length;
      if (wordCount <= 2) {
        v.riskFlag = true;
        v.requiresHumanReview = true;
        v.exclusionRisk = "high";
        v.saferAlternativeAction = "negative_exact";
        v.saferAlternativeReason = `Phrase-uitsluiting op kort zoekwoord (${wordCount} woorden) blokkeert potentieel veel traffic.`;
      }
    }

    // ── Rule 8: Very few clicks → lower confidence ──
    if (v.clicks <= 2 && v.confidence === "high") {
      v.confidence = "medium";
    }

    // ── Rule 9: Set defaults for missing fields ──
    if (!v.confidence) v.confidence = "medium";
    if (!v.intentType) v.intentType = "unknown";
    if (v.riskFlag === undefined) v.riskFlag = false;
    if (v.requiresHumanReview === undefined) v.requiresHumanReview = false;

    // ── Rule 10: Derive commercialityLevel ──
    if (!v.commercialityLevel) {
      if (v.intentType === "generic_commercial" || v.intentType === "product_specific" || v.intentType === "branded_own") {
        v.commercialityLevel = "high";
      } else if (v.intentType === "category_broad" || v.intentType === "problem_solution" || v.intentType === "local_intent") {
        v.commercialityLevel = "medium";
      } else if (v.intentType === "generic_informational" || v.intentType === "navigational") {
        v.commercialityLevel = "low";
      } else {
        v.commercialityLevel = "none";
      }
    }

    // ── Rule 11: Derive exclusionRisk ──
    if (!v.exclusionRisk) {
      if (v.recommendedAction === "negative_phrase") v.exclusionRisk = "high";
      else if (v.recommendedAction === "negative_exact" && v.commercialityLevel !== "none") v.exclusionRisk = "medium";
      else if (v.recommendedAction === "negative_exact") v.exclusionRisk = "low";
      else v.exclusionRisk = "low";
    }

    // ── Rule 12: Derive actionReadiness ──
    if (v.recommendedAction === "keep" || v.recommendedAction === "monitor") {
      v.actionReadiness = "monitor";
    } else if (v.confidence === "high" && v.recommendedAction === "negative_exact" && v.intentType === "out_of_scope") {
      v.actionReadiness = "direct_action";
    } else if (v.recommendedAction === "investigate" || v.requiresHumanReview) {
      v.actionReadiness = "investigate_first";
    } else if (v.confidence === "high" && !v.riskFlag) {
      v.actionReadiness = "direct_action";
    } else {
      v.actionReadiness = "investigate_first";
    }

    // ── Rule 13: Derive evidenceLevel ──
    if (!v.evidenceLevel) {
      if (v.conversions > 0) v.evidenceLevel = "deterministic";
      else if (v.confidence === "high") v.evidenceLevel = "inferred";
      else v.evidenceLevel = "weak_signal";
    }
  }

  // Phase 2: Cluster consistency — same n-gram pattern = consistent action
  applyClusterConsistency(verdicts);

  return verdicts;
}

// ── Cluster consistency ────────────────────────────────────────────────────

function applyClusterConsistency(verdicts: TermWithData[]): void {
  // Group by 2-gram overlap for simple clustering
  const clusters = new Map<string, TermWithData[]>();

  for (const v of verdicts) {
    const words = v.searchTerm.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    // Generate 2-grams as cluster keys
    for (let i = 0; i < words.length - 1; i++) {
      const key = `${words[i]} ${words[i + 1]}`;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(v);
    }
    // Also use single significant words for short terms
    if (words.length === 1 && words[0].length > 4) {
      if (!clusters.has(words[0])) clusters.set(words[0], []);
      clusters.get(words[0])!.push(v);
    }
  }

  // For clusters with 3+ terms: ensure consistency
  for (const [key, group] of clusters) {
    if (group.length < 3) continue;

    // Check for mixed actions on same cluster
    const actions = new Set(group.map((v) => v.recommendedAction));
    if (actions.size <= 1) {
      // Consistent — assign cluster key
      for (const v of group) v.clusterKey = v.clusterKey ?? key;
      continue;
    }

    // Mixed actions — check if some are aggressive while others are not
    const hasKeep = group.some((v) => v.recommendedAction === "keep");
    const hasNegative = group.some((v) => v.recommendedAction === "negative_exact" || v.recommendedAction === "negative_phrase");

    if (hasKeep && hasNegative) {
      // Contradiction: same theme has both keep and negative — downgrade negatives to investigate
      for (const v of group) {
        if (v.recommendedAction === "negative_exact" || v.recommendedAction === "negative_phrase") {
          v.saferAlternativeAction = v.recommendedAction;
          v.saferAlternativeReason = `Cluster "${key}" bevat ook relevante termen — uitsluiting is inconsistent.`;
          v.recommendedAction = "investigate";
          v.requiresHumanReview = true;
          v.riskFlag = true;
        }
        v.clusterKey = key;
      }
    } else {
      // Assign cluster key for review grouping
      for (const v of group) v.clusterKey = v.clusterKey ?? key;
    }
  }
}
