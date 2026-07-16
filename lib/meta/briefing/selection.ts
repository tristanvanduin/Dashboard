// M4 selectie-laag (spec 5, selection.ts): volledig deterministisch. Kiest wat de briefing
// mag beweren (alleen deterministic-bewijs), bepaalt de gaten in de matrix voor het bewuste
// experiment, en bewaakt het eerlijke insufficient-data-pad: minder dan drie
// deterministic-patronen betekent GEEN concepten, wel een heldere lijst van wat er nodig is.
// IO-vrij en los getest; de builder (LLM, formuleert alleen) en de render zijn build-kant.

import type { PatternAggregate, ReplacementCandidate } from "../vision/patterns";

export const MAX_POSITIVE_PATTERNS = 6;
export const MAX_DONTS = 3;
export const MIN_DETERMINISTIC_FOR_CONCEPTS = 3;
export const GAP_MAX_ADS = 1; // een attribuut-waarde met 0 of 1 ads is een gat in de matrix

export interface SelectedPattern {
  pattern: PatternAggregate;
  weight: number; // |lift_pct| maal log10(impressions), de spec-sortering
}

export interface GapCandidate {
  attribute: string;
  value: string;
  nAds: number;
  reasoning: string; // waarom dit gat kansrijk is (de tegenhanger-lift)
}

export type BriefingSelection =
  | {
      status: "voldoende_bewijs";
      positives: SelectedPattern[];
      donts: SelectedPattern[];
      gaps: GapCandidate[];
      experiment: GapCandidate | null; // precies een bewust experiment (spec sectie 5 van de briefing)
      replacements: ReplacementCandidate[];
    }
  | {
      status: "onvoldoende_bewijs";
      deterministicCount: number;
      needed: string; // wat er nodig is voordat een briefing zinvol is
      replacements: ReplacementCandidate[];
    };

function weightOf(p: PatternAggregate): number {
  return Math.abs(p.liftPct) * Math.log10(Math.max(p.impressions, 10));
}

// De kern-selectie. Alleen deterministic telt als bewijs; inferred-patronen komen de
// briefing niet in (de no-go: geen concepten zonder referentie naar bewijs).
export function selectBriefingPatterns(input: {
  patterns: PatternAggregate[];
  replacements: ReplacementCandidate[];
}): BriefingSelection {
  const deterministic = input.patterns.filter((p) => p.evidenceLevel === "deterministic");

  if (deterministic.length < MIN_DETERMINISTIC_FOR_CONCEPTS) {
    return {
      status: "onvoldoende_bewijs",
      deterministicCount: deterministic.length,
      needed: `Er zijn ${deterministic.length} deterministic-patronen; voor een briefing zijn er minstens ${MIN_DETERMINISTIC_FOR_CONCEPTS} nodig. Dat vraagt per patroon minstens 3 ads met elk 5.000 impressies, en voor conversie-claims 30 conversies per patroon. Laat de huidige ads doorlopen of verbreed de creative-variatie, en draai de analyse daarna opnieuw.`,
      replacements: input.replacements,
    };
  }

  const ranked = deterministic
    .map((pattern) => ({ pattern, weight: Math.round(weightOf(pattern) * 100) / 100 }))
    .sort((a, b) => b.weight - a.weight);

  const positives = ranked.filter((s) => s.pattern.liftPct > 0).slice(0, MAX_POSITIVE_PATTERNS);
  const donts = ranked.filter((s) => s.pattern.liftPct < 0).slice(0, MAX_DONTS);

  const gaps = buildGapMatrix(input.patterns);
  const experiment = pickExperiment(gaps);

  return { status: "voldoende_bewijs", positives, donts, gaps, experiment, replacements: input.replacements };
}

// De gap-matrix: attribuut-waarde-combinaties die in de data voorkomen als patroonrij maar
// met 0 of 1 ads (nog niet echt geprobeerd). De redenatie leunt op de tegenhanger: als een
// andere waarde van hetzelfde attribuut een bewezen lift heeft, is het gat het testen waard.
export function buildGapMatrix(patterns: PatternAggregate[]): GapCandidate[] {
  const gaps: GapCandidate[] = [];
  for (const p of patterns) {
    if (p.nAds > GAP_MAX_ADS) continue;
    const counterpart = patterns
      .filter((other) => other.attribute === p.attribute && other.value !== p.value && other.evidenceLevel === "deterministic" && Math.abs(other.liftPct) > 0)
      .sort((a, b) => Math.abs(b.liftPct) - Math.abs(a.liftPct))[0];
    gaps.push({
      attribute: p.attribute,
      value: p.value,
      nAds: p.nAds,
      reasoning: counterpart
        ? `${p.attribute} is bewezen relevant (${counterpart.value}: ${counterpart.liftPct > 0 ? "plus" : "min"} ${Math.round(Math.abs(counterpart.liftPct) * 1000) / 10}% op ${counterpart.metric}); de waarde ${p.value} is met ${p.nAds} ad(s) nog vrijwel onbeproefd`
        : `${p.attribute} = ${p.value} heeft met ${p.nAds} ad(s) nog vrijwel niet gedraaid; onbekend terrein`,
    });
  }
  return gaps.sort((a, b) => (b.reasoning.includes("bewezen relevant") ? 1 : 0) - (a.reasoning.includes("bewezen relevant") ? 1 : 0));
}

// Precies een bewust experiment: het gat met de sterkste tegenhanger-redenatie wint.
export function pickExperiment(gaps: GapCandidate[]): GapCandidate | null {
  return gaps.find((g) => g.reasoning.includes("bewezen relevant")) ?? gaps[0] ?? null;
}
