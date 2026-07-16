// Het brand-guide-datamodel: de ene bron met twee gezichten. De visuele velden voeden de
// dashboard-theming (via resolveEventTheme), de creatieve velden voeden de uitvoer-agents. De
// validator zegt niet alleen of de guide klopt, maar ook of hij klaar is voor theming en, als
// harde poort, voor creatieve uitvoer. IO-vrij en los getest; de opslag (client_settings of
// een tabel) en de invoer-UI zijn de laag eromheen.

import { isValidHex, type BrandVisualIdentity } from "./theme";

export interface BrandToneOfVoice {
  dos: string[];
  donts: string[];
}

export interface BrandExamples {
  good: string[];
  bad: string[];
}

export interface BrandGuide {
  brandName: string;
  // Gezicht 1: de visuele identiteit voor het dashboard.
  visual: BrandVisualIdentity;
  // Gezicht 2: de creatieve regels voor de uitvoer-agents.
  proposition: string; // de kernpropositie in een zin (door M4 gebruikt als merkcontext)
  toneOfVoice: BrandToneOfVoice;
  keyMessages: string[];
  forbiddenWords: string[];
  mandatoryElements: string[];
  audienceLanguage: string;
  examples: BrandExamples;
  // De mens-in-de-lus-poort: de klant heeft de guide bevestigd. Zonder dit geen creatieve
  // uitvoer, ook al is alles ingevuld.
  confirmedByClient: boolean;
}

export interface BrandGuideValidation {
  valid: boolean; // goed gevormd, geen blokkerende fouten
  themingReady: boolean; // heeft een eigen visuele identiteit voor het dashboard
  creativeReady: boolean; // klaar EN bevestigd voor de uitvoer-agents
  errors: string[];
  warnings: string[];
}

function nonEmpty(list: string[] | undefined | null): boolean {
  return Array.isArray(list) && list.some((s) => typeof s === "string" && s.trim().length > 0);
}

// Valideert een brand guide. Blokkerende fouten maken hem ongeldig (bijv. een ongeldige hex);
// waarschuwingen wijzen op ontbrekende velden die de readiness beperken maar niet blokkeren.
export function validateBrandGuide(guide: BrandGuide): BrandGuideValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!guide.brandName || !guide.brandName.trim()) {
    errors.push("merknaam ontbreekt");
  }

  // Visuele velden: aanwezige kleuren moeten geldige hex zijn (fout), anders alleen een
  // waarschuwing dat het dashboard terugvalt op de standaard.
  const colorFields: Array<[keyof BrandVisualIdentity, string]> = [
    ["primaryColor", "primaire kleur"],
    ["accentColor", "accentkleur"],
    ["secondaryColor", "secundaire kleur"],
  ];
  for (const [field, label] of colorFields) {
    const val = guide.visual?.[field];
    if (val != null && String(val).trim() !== "" && !isValidHex(String(val))) {
      errors.push(`${label} is geen geldige hex-code`);
    }
  }
  if (!isValidHex(guide.visual?.primaryColor ?? null)) {
    warnings.push("geen geldige primaire kleur, het dashboard gebruikt de standaardhuisstijl");
  }
  if (!guide.visual?.logoUrl || !String(guide.visual.logoUrl).trim()) {
    warnings.push("geen logo ingesteld");
  }

  // Creatieve velden: waarschuwingen bij ontbreken; ze bepalen de creative-readiness.
  const hasTone = nonEmpty(guide.toneOfVoice?.dos) || nonEmpty(guide.toneOfVoice?.donts);
  const hasMessages = nonEmpty(guide.keyMessages);
  const hasForbidden = nonEmpty(guide.forbiddenWords);
  const hasExamples = nonEmpty(guide.examples?.good) || nonEmpty(guide.examples?.bad);
  if (!hasTone) warnings.push("geen tone of voice (do's en don'ts)");
  if (!hasMessages) warnings.push("geen kernboodschappen");
  if (!guide.proposition || !guide.proposition.trim()) warnings.push("geen kernpropositie (M4-briefing gebruikt wat er is)");
  if (!hasForbidden) warnings.push("geen verboden woorden");
  if (!hasExamples) warnings.push("geen voorbeeldzinnen");

  // Sanity: een verboden woord dat in een kernboodschap staat is een conflict.
  if (hasForbidden && hasMessages) {
    const messagesText = guide.keyMessages.join(" ").toLowerCase();
    for (const word of guide.forbiddenWords) {
      const w = word.trim().toLowerCase();
      if (w && messagesText.includes(w)) {
        warnings.push(`verboden woord "${word}" komt voor in een kernboodschap`);
      }
    }
  }

  const valid = errors.length === 0;
  const themingReady = valid && isValidHex(guide.visual?.primaryColor ?? null);
  const creativeReady = valid && guide.confirmedByClient === true && hasTone && hasMessages && hasForbidden && hasExamples;

  return { valid, themingReady, creativeReady, errors, warnings };
}

// Lege guide als startpunt voor de invoer-UI.
export function emptyBrandGuide(brandName = ""): BrandGuide {
  return {
    brandName,
    proposition: "",
    visual: { primaryColor: null, accentColor: null, secondaryColor: null, logoUrl: null, headingFont: null },
    toneOfVoice: { dos: [], donts: [] },
    keyMessages: [],
    forbiddenWords: [],
    mandatoryElements: [],
    audienceLanguage: "",
    examples: { good: [], bad: [] },
    confirmedByClient: false,
  };
}


// De merkcontext die de M4-creative-briefing nodig heeft, uit de brand guide getrokken. Zo is
// de brand guide de ene bron: de briefing leest hier de naam, propositie, kernboodschappen en
// de dominante merkkleuren, plus de creatieve grenzen (tone, verboden woorden, verplichte
// elementen) zodat een concept binnen het merk blijft. Alleen geldige hex-kleuren komen mee.
export interface BriefingBrandContext {
  brandName: string;
  proposition: string;
  keyMessages: string[];
  brandColors: string[];
  toneOfVoice: BrandToneOfVoice;
  forbiddenWords: string[];
  mandatoryElements: string[];
}

export function brandContextForBriefing(guide: BrandGuide): BriefingBrandContext {
  const colors = [guide.visual?.primaryColor, guide.visual?.accentColor, guide.visual?.secondaryColor]
    .filter((c): c is string => isValidHex(c ?? null))
    .map((c) => c.trim());
  return {
    brandName: guide.brandName,
    proposition: guide.proposition ?? "",
    keyMessages: guide.keyMessages ?? [],
    brandColors: colors,
    toneOfVoice: guide.toneOfVoice ?? { dos: [], donts: [] },
    forbiddenWords: guide.forbiddenWords ?? [],
    mandatoryElements: guide.mandatoryElements ?? [],
  };
}
