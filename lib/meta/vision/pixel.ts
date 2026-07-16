// M3 pixel-wrapper: sharp decodeert, de pure kern rekent. De spec schrijft het 64x64-sample
// voor de dominante kleuren voor; brightness, contrast en saturatie rekenen op hetzelfde
// sample (statistisch ruim voldoende en snel). De originele afmetingen komen uit de
// metadata, niet uit het sample. Alle rekenlogica leeft in pixel-core.ts (los getest);
// dit bestand doet uitsluitend de decode en is daarmee de enige sharp-afhankelijke plek.

import sharp from "sharp";
import { analyzePixels, type PixelFeatures, type RgbPixel } from "./pixel-core";

const SAMPLE_SIZE = 64; // spec 5a: resize naar 64x64 voor de kleur-kwantisatie

export interface AssetPixelFeatures extends PixelFeatures {
  width: number;
  height: number;
  aspectRatio: number;
}

// Decodeert een beeldbuffer (png, jpeg, webp) naar RGB-pixels op het sample-formaat.
export async function extractRgbPixels(buffer: Buffer): Promise<RgbPixel[]> {
  const raw = await sharp(buffer).resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const pixels: RgbPixel[] = [];
  for (let i = 0; i + 2 < raw.length; i += 3) {
    pixels.push({ r: raw[i], g: raw[i + 1], b: raw[i + 2] });
  }
  return pixels;
}

// De volledige pixel-laag voor een asset: metadata voor de echte afmetingen, het sample voor
// de metingen.
export async function analyzeAssetBuffer(buffer: Buffer): Promise<AssetPixelFeatures> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const pixels = await extractRgbPixels(buffer);
  return {
    ...analyzePixels(pixels),
    width,
    height,
    aspectRatio: height > 0 ? Math.round((width / height) * 1000) / 1000 : 0,
  };
}
