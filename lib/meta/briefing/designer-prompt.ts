// Automated Designer Prompts: de deterministische template op de M3-attributen (de
// delta-analyse-aanbeveling: templaten uit gemeten attributen is veiliger en meer gegrond
// dan vrije LLM-generatie). Puur: dezelfde concept-richting plus merkcontext geeft altijd
// exact dezelfde prompt. De content-marketeer krijgt per concept en per ratio een direct
// bruikbare genAI-prompt met een negative-prompt uit de merkregels.

import type { BriefingBrandContext } from "@/lib/branding/brand-guide";

export interface DesignerPromptInput {
  conceptNaam: string;
  stijl: string; // uit de winnaar-attributen (bijv. ugc, studio, lifestyle)
  mensProduct: string; // bijv. "mens met gezicht close-up, oogcontact, product in hand"
  compositie: string; // center | thirds | collage
  hook: string; // het element dat in de eerste blik de aandacht trekt
  kleurpaletHex: string[]; // de gemeten dominante kleuren uit de pixel-laag van winnaars
  achtergrond?: string | null; // clean | druk | buiten | binnen
  isExperiment: boolean;
}

export type DesignerRatio = "1:1" | "4:5" | "9:16";
export const DESIGNER_RATIOS: DesignerRatio[] = ["1:1", "4:5", "9:16"];

export interface DesignerPrompt {
  conceptNaam: string;
  ratio: DesignerRatio;
  label: string; // "bewezen concept" of "ONBEWEZEN TEST" voor de marketeer
  positive: string;
  negative: string;
  midjourneySuffix: string; // optioneel achter de positive te plakken voor Midjourney
}

const STANDARD_NEGATIVES = ["spelfouten of onleesbare tekst", "watermerken", "extra of verzonnen logo's", "misvormde handen of gezichten"];

function safeZoneNote(ratio: DesignerRatio): string {
  return ratio === "9:16" ? " Houd tekst en logo uit de bovenste en onderste 15 procent (safe zones voor Stories en Reels)." : "";
}

// De ene, deterministische mapping van attributen naar een genAI-prompt.
export function buildDesignerPrompt(input: DesignerPromptInput, brand: BriefingBrandContext, ratio: DesignerRatio): DesignerPrompt {
  const tone = brand.toneOfVoice.dos.length > 0 ? ` Toon: ${brand.toneOfVoice.dos.join(", ")}.` : "";
  const positive =
    `${input.stijl}-stijl advertentie-visual voor ${brand.brandName}. ` +
    `${input.mensProduct}. Compositie: ${input.compositie}${input.achtergrond ? `, achtergrond ${input.achtergrond}` : ""}. ` +
    `Blikvanger in de eerste oogopslag: ${input.hook}. ` +
    `Kleurpalet exact: ${input.kleurpaletHex.join(", ")}${brand.brandColors.length > 0 ? ` met merkkleuren ${brand.brandColors.join(", ")}` : ""}.` +
    `${tone} Beeldverhouding ${ratio}.${safeZoneNote(ratio)}`;

  const negatives = [...STANDARD_NEGATIVES, ...brand.forbiddenWords.map((w) => `het woord of thema "${w}"`), ...brand.toneOfVoice.donts];

  return {
    conceptNaam: input.conceptNaam,
    ratio,
    label: input.isExperiment ? "ONBEWEZEN TEST" : "bewezen concept",
    positive,
    negative: negatives.join(", "),
    midjourneySuffix: ` --ar ${ratio.replace(":", ":")}`,
  };
}

// Per concept de volledige set: een prompt per ratio.
export function buildDesignerPromptSet(input: DesignerPromptInput, brand: BriefingBrandContext): DesignerPrompt[] {
  return DESIGNER_RATIOS.map((ratio) => buildDesignerPrompt(input, brand, ratio));
}
