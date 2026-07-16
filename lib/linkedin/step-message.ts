// L2 route-wiring: bouwt de per-stap data-prompt (de userMessage voor de stap-runner) uit de
// voorgerekende LinkedIn-facts. Dezelfde rol als de Meta-versie: het model krijgt de exacte
// getallen aangeleverd en rekent niet zelf. Pure functie, op fixtures te testen.

const LINKEDIN_STEP_NAMES: Record<number, string> = {
  1: "Account Performance",
  2: "Campaign Groups en Budget",
  3: "Campaign Performance",
  4: "Creative Performance",
  5: "Demografie en ICP-fit",
  6: "Lead Gen Funnel",
  7: "Audience en Verzadiging",
  8: "Bidding en Pacing",
  9: "Hypotheses en Sprintplanning",
};

export function linkedinStepName(stepNumber: number): string {
  return LINKEDIN_STEP_NAMES[stepNumber] ?? `Stap ${stepNumber}`;
}

export function buildLinkedinStepMessage(stepNumber: number, facts: unknown, clientId: string): string {
  const name = linkedinStepName(stepNumber);
  const factsBlock = JSON.stringify(facts ?? {}, null, 2);
  return [
    `Analyseer ${name} (stap ${stepNumber}) voor client "${clientId}".`,
    "",
    "## Voorgerekende feiten",
    "Reken uitsluitend met deze exacte, deterministisch voorgerekende getallen. Verzin geen nieuwe cijfers en herbereken niets zelf. Bij LinkedIn leidt CPL, niet ROAS.",
    "",
    factsBlock,
  ].join("\n");
}
