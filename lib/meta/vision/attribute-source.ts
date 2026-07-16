// M3: de ATTRIBUTE_SOURCE-kaart. Elk creative-attribuut heeft precies een bron:
// pixel (deterministisch, sharp) of vision (het multimodale model). Kleur- en
// helderheidclaims horen ALTIJD bij pixel; de vision-laag mag ze niet leveren. Dit is de
// spec-eis letterlijk: "kleur-claims komen NIET uit de vision-laag maar uit de pixel-laag".
// Puur en los getest.

export type FeatureSource = "pixel" | "vision";

export const ATTRIBUTE_SOURCE: Record<string, FeatureSource> = {
  // Pixel-laag: deterministisch, geen LLM.
  width: "pixel",
  height: "pixel",
  aspect_ratio: "pixel",
  dominant_colors: "pixel",
  avg_brightness: "pixel",
  contrast: "pixel",
  saturation: "pixel",
  is_dark_mode: "pixel",
  // Vision-laag: het multimodale model.
  style: "vision",
  human_present: "vision",
  human_count: "vision",
  face_close_up: "vision",
  gaze_at_camera: "vision",
  product_visible: "vision",
  product_prominence: "vision",
  text_overlay_present: "vision",
  text_coverage_pct_estimate: "vision",
  ocr_text: "vision",
  headline_in_visual: "vision",
  text_readability: "vision",
  logo_present: "vision",
  logo_position: "vision",
  cta_in_visual: "vision",
  hook_element: "vision",
  composition: "vision",
  background: "vision",
  color_mood: "vision",
  emotion: "vision",
  claim_type: "vision",
  safe_zone_risk: "vision",
};

// De attributen die een kleur- of helderheidclaim dragen; deze mogen nooit uit de
// vision-laag komen, ook niet als iemand per ongeluk color_mood ermee verwart (color_mood
// is een sfeerlabel van de vision-laag, geen hex-claim, en blijft dus terecht vision).
const COLOR_CLAIM_ATTRIBUTES = new Set(["dominant_colors", "avg_brightness", "contrast", "saturation", "is_dark_mode"]);

export class InvalidAttributeSourceError extends Error {}

// De guard: gooit als een kleur-claim-attribuut wordt aangeboden vanuit de vision-laag.
// Wordt aangeroepen op het punt waar vision-output wordt samengevoegd met pixel-output,
// zodat een vision-model dat toch een kleurveld invult nooit stilzwijgend wordt geaccepteerd.
export function assertAttributeSource(attribute: string, claimedSource: FeatureSource): void {
  const trueSource = ATTRIBUTE_SOURCE[attribute];
  if (trueSource == null) {
    throw new InvalidAttributeSourceError(`onbekend attribuut: ${attribute}`);
  }
  if (COLOR_CLAIM_ATTRIBUTES.has(attribute) && claimedSource === "vision") {
    throw new InvalidAttributeSourceError(`${attribute} is een kleur-claim en moet uit de pixel-laag komen, niet uit vision`);
  }
  if (trueSource !== claimedSource) {
    throw new InvalidAttributeSourceError(`${attribute} hoort bij ${trueSource}, niet bij ${claimedSource}`);
  }
}
