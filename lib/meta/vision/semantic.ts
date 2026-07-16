// M3 vision-laag: het gestructureerde attributen-contract voor de multimodale call. De
// no-go uit de spec zit STRUCTUREEL in dit schema: er bestaan hier geen kleurvelden, want
// kleur- en helderheidsclaims komen uitsluitend uit de deterministische pixel-laag
// (ATTRIBUTE_SOURCE dwingt dat af). De call zelf (temperatuur 0, een repair max) is
// build-kant; dit contract maakt hem een dunne wrapper. IO-vrij en los getest.

import { z } from "zod";

export const VISION_PROMPT_VERSION = "m3-vision-v1";

// Alle vision-attributen uit de spec, met de toegestane waarden als enums.
export const CreativeVisionSchema = z.object({
  style: z.enum(["ugc", "studio", "product", "lifestyle", "meme", "screenshot", "text_card", "3d"]),
  human_present: z.boolean(),
  human_count: z.number().int().min(0),
  face_close_up: z.boolean(),
  gaze_at_camera: z.boolean(),
  product_visible: z.boolean(),
  product_prominence: z.enum(["dominant", "aanwezig", "afwezig"]),
  text_overlay_present: z.boolean(),
  text_coverage_pct_estimate: z.number().min(0).max(100),
  ocr_text: z.string(),
  headline_in_visual: z.string(),
  text_readability: z.enum(["goed", "matig", "slecht"]),
  logo_present: z.boolean(),
  logo_position: z.enum(["linksboven", "rechtsboven", "linksonder", "rechtsonder", "midden", "afwezig"]),
  cta_in_visual: z.boolean(),
  hook_element: z.string().min(1), // wat trekt in de eerste blik de aandacht
  composition: z.enum(["center", "thirds", "collage"]),
  background: z.enum(["clean", "druk", "buiten", "binnen"]),
  color_mood: z.enum(["warm", "koel", "neutraal", "contrastrijk"]), // sfeer-etiket; de hex-waarheid komt uit de pixel-laag
  emotion: z.enum(["blij", "serieus", "urgent", "neutraal", "verrast"]),
  claim_type: z.enum(["prijs", "social_proof", "probleem_oplossing", "demo", "aanbieding", "geen"]),
  safe_zone_risk: z.boolean(), // tekst of logo in de 9:16 randzones
  confidence: z.record(z.string(), z.enum(["hoog", "laag", "estimate"])),
});

export type CreativeVisionFeatures = z.infer<typeof CreativeVisionSchema>;

// De versievaste vision-prompt: definieert ELK attribuut met de toegestane waarden en eist
// JSON-only. De ad-context (format, titel, body) helpt de OCR en het claim_type.
export function buildVisionPrompt(input: { format: string; adTitle: string; adBody: string }): { system: string; user: string; version: string } {
  const system = `Je analyseert een advertentie-visual en levert UITSLUITEND een JSON-object met exact deze velden en toegestane waarden. Beschrijf ALLEEN wat je ziet; geen performance-oordeel, geen kleuranalyse (kleuren worden elders gemeten).
- style: ugc | studio | product | lifestyle | meme | screenshot | text_card | 3d
- human_present: boolean; human_count: geheel getal; face_close_up: boolean; gaze_at_camera: boolean (kijkt een gezicht recht in de camera)
- product_visible: boolean; product_prominence: dominant | aanwezig | afwezig
- text_overlay_present: boolean; text_coverage_pct_estimate: 0 tot 100 (schatting van het tekstoppervlak); ocr_text: de letterlijke tekst in het beeld; headline_in_visual: de grootste tekstregel of leeg
- text_readability: goed | matig | slecht; logo_present: boolean; logo_position: linksboven | rechtsboven | linksonder | rechtsonder | midden | afwezig
- cta_in_visual: boolean; hook_element: wat in de eerste blik de aandacht trekt (korte zin)
- composition: center | thirds | collage; background: clean | druk | buiten | binnen
- color_mood: warm | koel | neutraal | contrastrijk (sfeer-etiket, geen meting); emotion: blij | serieus | urgent | neutraal | verrast
- claim_type: prijs | social_proof | probleem_oplossing | demo | aanbieding | geen
- safe_zone_risk: boolean (staat tekst of logo in de randzones die bij 9:16 wegvallen)
- confidence: per veld hoog | laag | estimate; markeer text_coverage_pct_estimate ALTIJD als estimate.
Antwoord met alleen het JSON-object, zonder tekst eromheen.`;
  const user = `Ad-context: format ${input.format}. Titel: "${input.adTitle}". Body: "${input.adBody}". Analyseer de meegestuurde visual.`;
  return { system, user, version: VISION_PROMPT_VERSION };
}

export type VisionParseResult = { ok: true; features: CreativeVisionFeatures } | { ok: false; reason: string };

function stripFences(text: string): string {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

// Parse met fence-stripping en veilige validatie. De ene repair-call bij een parse-fout is
// het F3-regime aan de call-kant; deze functie geeft de reden die de repair-prompt voedt.
export function parseVisionResponse(raw: string): VisionParseResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(stripFences(raw));
  } catch {
    return { ok: false, reason: "geen geldige JSON" };
  }
  const parsed = CreativeVisionSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: `schema-fout op ${first?.path.join(".") ?? "onbekend veld"}: ${first?.message ?? "ongeldig"}` };
  }
  if (parsed.data.confidence["text_coverage_pct_estimate"] !== "estimate") {
    return { ok: false, reason: "text_coverage_pct_estimate moet in confidence als estimate gemarkeerd zijn" };
  }
  return { ok: true, features: parsed.data };
}
