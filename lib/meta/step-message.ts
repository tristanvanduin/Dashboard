// M2 route-wiring: bouwt de per-stap data-prompt (de userMessage voor runNarrativeStep) uit de
// voorgerekende Meta-facts. Dezelfde rol als de inline Google-messages, maar gevoed door
// buildMetaStepFacts. Het model krijgt de exacte getallen aangeleverd en hoeft niet zelf te rekenen.
// Pure functie, op fixtures te testen.

const META_STEP_NAMES: Record<number, string> = {
  1: "Account Performance",
  2: "Campagnestructuur en Budget",
  3: "Ad Set en Doelgroep",
  4: "Creative Performance",
  5: "Creative Visual Deep-dive",
  6: "Placement en Platform",
  7: "Demografie en Geo",
  8: "Funnel en Attributie",
  9: "Frequency en Verzadiging",
  10: "Schedule",
  11: "Hypotheses en Sprintplanning",
};

export function metaStepName(stepNumber: number): string {
  return META_STEP_NAMES[stepNumber] ?? `Stap ${stepNumber}`;
}

export function buildMetaStepMessage(stepNumber: number, facts: unknown, clientId: string): string {
  const name = metaStepName(stepNumber);
  const factsBlock = JSON.stringify(facts ?? {}, null, 2);
  return [
    `Analyseer ${name} (stap ${stepNumber}) voor client "${clientId}".`,
    "",
    "## Voorgerekende feiten",
    "Reken uitsluitend met deze exacte, deterministisch voorgerekende getallen. Verzin geen nieuwe cijfers en herbereken niets zelf.",
    "",
    factsBlock,
  ].join("\n");
}
