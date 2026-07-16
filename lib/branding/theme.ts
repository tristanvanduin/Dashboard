// Brand-guide-theming: uit de visuele identiteit van een event (kleuren, logo, font uit de
// brand guide) de complete thema-tokens maken, zodat het RAI-eventdashboard zich per event in
// de eigen huisstijl toont in plaats van in het Ranking Masters-blauw. Puur en los getest; de
// tool zet de tokens als CSS-variabelen (shadcn) per event. Ontbreekt of klopt een veld niet,
// dan valt het terug op de RM-tokens, zodat er altijd een geldig, leesbaar thema is.

// De thema-relevante velden van een brand guide. De creatieve velden (tone of voice, verboden
// woorden) leven elders; dit is puur de visuele identiteit voor het dashboard.
export interface BrandVisualIdentity {
  primaryColor?: string | null;
  accentColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
  headingFont?: string | null;
}

export interface EventTheme {
  primary: string;
  primaryForeground: string;
  accent: string;
  accentForeground: string;
  secondary: string;
  background: string;
  foreground: string;
  card: string;
  border: string;
  logoUrl: string | null;
  headingFont: string;
}

// De Ranking Masters-tokens uit globals.css; de terugval als er geen of een onvolledige brand
// guide is.
export const DEFAULT_THEME: EventTheme = {
  primary: "#08288C",
  primaryForeground: "#ffffff",
  accent: "#F16B37",
  accentForeground: "#ffffff",
  secondary: "#f0f2f8",
  background: "#f9fafc",
  foreground: "#1a1a2e",
  card: "#ffffff",
  border: "#E1E5F2",
  logoUrl: null,
  headingFont: "Gilroy, Ubuntu, sans-serif",
};

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

export function isValidHex(color: string | null | undefined): boolean {
  return typeof color === "string" && HEX_RE.test(color.trim());
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// WCAG relatieve luminantie (0 tot 1).
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// Kiest witte of donkere tekst op een achtergrondkleur, wat het beste contrast geeft. Zo
// blijft het thema leesbaar ongeacht de merk-kleur van het event.
export function contrastForeground(backgroundHex: string): string {
  if (!isValidHex(backgroundHex)) return "#ffffff";
  const bgLum = relativeLuminance(hexToRgb(backgroundHex));
  const whiteContrast = contrastRatio(1.0, bgLum);
  const darkLum = relativeLuminance(hexToRgb(DEFAULT_THEME.foreground));
  const darkContrast = contrastRatio(bgLum, darkLum);
  return whiteContrast >= darkContrast ? "#ffffff" : DEFAULT_THEME.foreground;
}

// Resolveert het complete thema uit de visuele identiteit. Elk kleurveld wordt gevalideerd;
// een geldige hex wordt overgenomen, anders valt dat veld terug op de default. De voorgrond-
// kleuren worden berekend voor leesbaarheid. Geen identiteit betekent het volledige RM-thema.
export function resolveEventTheme(identity: BrandVisualIdentity | null | undefined): EventTheme {
  if (!identity) return { ...DEFAULT_THEME };

  const primary = isValidHex(identity.primaryColor) ? identity.primaryColor!.trim() : DEFAULT_THEME.primary;
  const accent = isValidHex(identity.accentColor) ? identity.accentColor!.trim() : DEFAULT_THEME.accent;
  const secondary = isValidHex(identity.secondaryColor) ? identity.secondaryColor!.trim() : DEFAULT_THEME.secondary;

  return {
    primary,
    primaryForeground: contrastForeground(primary),
    accent,
    accentForeground: contrastForeground(accent),
    secondary,
    background: DEFAULT_THEME.background,
    foreground: DEFAULT_THEME.foreground,
    card: DEFAULT_THEME.card,
    border: DEFAULT_THEME.border,
    logoUrl: typeof identity.logoUrl === "string" && identity.logoUrl.trim() ? identity.logoUrl.trim() : null,
    headingFont: typeof identity.headingFont === "string" && identity.headingFont.trim() ? identity.headingFont.trim() : DEFAULT_THEME.headingFont,
  };
}

// De thema-tokens als shadcn CSS-variabelen, klaar om per event op de dashboard-container te
// zetten. De tool overschrijft hiermee de default-variabelen alleen binnen het eventscherm.
export function themeToCssVars(theme: EventTheme): Record<string, string> {
  return {
    "--primary": theme.primary,
    "--primary-foreground": theme.primaryForeground,
    "--accent": theme.accent,
    "--accent-foreground": theme.accentForeground,
    "--secondary": theme.secondary,
    "--background": theme.background,
    "--foreground": theme.foreground,
    "--card": theme.card,
    "--border": theme.border,
    "--font-heading": theme.headingFont,
  };
}
