// M3 pixel-laag: de deterministische pixel-waarheid waar kleur- en helderheidsclaims op
// rusten (spec 5a). Pure kern op raw RGB-input zodat alles testbaar is zonder sharp; de
// build-kant wikkelt dit met een decoder (sharp staat niet in de dependencies en is een
// preflight-punt bij de batch-route). Geen LLM, geen schattingen: dit is meten.

export interface RgbPixel {
  r: number; // 0 tot 255
  g: number;
  b: number;
}

export interface DominantColor {
  hex: string;
  coveragePct: number;
}

export interface PixelFeatures {
  dominantColors: DominantColor[]; // top 5
  avgBrightness: number; // 0 tot 100 (luminantie)
  contrast: number; // standaarddeviatie van de luminantie, 0 tot 100 schaal
  saturation: number; // gemiddelde HSL-S, 0 tot 100
  isDarkMode: boolean;
}

export const DARK_MODE_BRIGHTNESS = 35; // onder deze gemiddelde luminantie geldt het beeld als donker
const QUANT_BITS = 4; // 4 bits per kanaal: 4096 emmers, grof genoeg om tinten te clusteren

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

// Rec. 601 luminantie, geschaald naar 0 tot 100.
function luminance(p: RgbPixel): number {
  return ((0.299 * p.r + 0.587 * p.g + 0.114 * p.b) / 255) * 100;
}

// HSL-saturatie, 0 tot 100.
function hslSaturation(p: RgbPixel): number {
  const r = p.r / 255;
  const g = p.g / 255;
  const b = p.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  return s * 100;
}

// De dominante kleuren via kwantisatie: elk kanaal naar 4 bits, tel de emmers, geef de top 5
// terug als hex van het emmer-midden met het dekkingspercentage. Deterministisch en snel;
// de spec noemt kwantisatie expliciet als toegestane methode naast k-means.
export function dominantColors(pixels: RgbPixel[], top = 5): DominantColor[] {
  if (pixels.length === 0) return [];
  const shift = 8 - QUANT_BITS;
  const buckets = new Map<number, number>();
  for (const p of pixels) {
    const key = ((p.r >> shift) << (2 * QUANT_BITS)) | ((p.g >> shift) << QUANT_BITS) | (p.b >> shift);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const half = 1 << (shift - 1); // het midden van een emmer
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([key, count]) => {
      const r = ((key >> (2 * QUANT_BITS)) << shift) + half;
      const g = (((key >> QUANT_BITS) & ((1 << QUANT_BITS) - 1)) << shift) + half;
      const b = ((key & ((1 << QUANT_BITS) - 1)) << shift) + half;
      return { hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`, coveragePct: Math.round((count / pixels.length) * 1000) / 10 };
    });
}

export function analyzePixels(pixels: RgbPixel[]): PixelFeatures {
  if (pixels.length === 0) {
    return { dominantColors: [], avgBrightness: 0, contrast: 0, saturation: 0, isDarkMode: false };
  }
  const luminances = pixels.map(luminance);
  const avgBrightness = luminances.reduce((a, b) => a + b, 0) / luminances.length;
  const variance = luminances.reduce((sum, l) => sum + (l - avgBrightness) ** 2, 0) / luminances.length;
  const saturation = pixels.reduce((sum, p) => sum + hslSaturation(p), 0) / pixels.length;

  return {
    dominantColors: dominantColors(pixels),
    avgBrightness: Math.round(avgBrightness * 10) / 10,
    contrast: Math.round(Math.sqrt(variance) * 10) / 10,
    saturation: Math.round(saturation * 10) / 10,
    isDarkMode: avgBrightness < DARK_MODE_BRIGHTNESS,
  };
}
