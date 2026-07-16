// =====================================================================
// M3: creative-vision batch-route. Twee modes: "analyze" (pixel-laag plus vision-features
// per creative, idempotent op features_version plus prompt_hash, kostenrem, concurrency 3)
// en "aggregate" (patronen per periode via het geteste aggregatePattern). LIVE-ONGETEST:
// vergt een Meta-token, gesyncte creatives met een asset-bron en de 013-migratie. De sync
// vult storage_paths en thumbnail_url nu nog niet; die vulling is een benoemde sync-rest,
// deze route telt bronloze creatives eerlijk als zonder_asset.
// =====================================================================

import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { getSupabase, getOpenRouterKey } from "@/lib/analysis/helpers";
import { callOpenRouter } from "@/lib/analysis/openrouter-client";
import { buildVisionPrompt, parseVisionResponse, VISION_PROMPT_VERSION, type CreativeVisionFeatures } from "@/lib/meta/vision/semantic";
import { analyzeAssetBuffer } from "@/lib/meta/vision/pixel";
import { aggregatePattern, type AdMetricInput, type PatternMetric } from "@/lib/meta/vision/patterns";

export const FEATURES_VERSION = 1;
const DEFAULT_MAX_NEW = 150; // de kostenrem uit de spec
const CONCURRENCY = 3;
const STORAGE_BUCKET = "meta-creatives";

interface CreativeRow {
  creative_id: string;
  format: string | null;
  title: string | null;
  body: string | null;
  image_hash: string | null;
  video_id: string | null;
  thumbnail_url: string | null;
  storage_paths: Record<string, unknown> | null;
}

function assetKeyOf(c: CreativeRow): string {
  if (c.image_hash) return c.image_hash;
  if (c.video_id) return `video_${c.video_id}_thumb`;
  return c.creative_id;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });
  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  let body: { client_id?: string; mode?: "analyze" | "aggregate" | "both"; max_new?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Verwacht JSON-body" }, { status: 400 });
  }
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  const mode = body.mode ?? "both";
  const maxNew = typeof body.max_new === "number" && body.max_new > 0 ? Math.floor(body.max_new) : DEFAULT_MAX_NEW;

  const result: Record<string, unknown> = { client_id: clientId, mode };

  if (mode === "analyze" || mode === "both") {
    result.analyze = await runAnalyze(supabase, apiKey, clientId, maxNew);
  }
  if (mode === "aggregate" || mode === "both") {
    result.aggregate = await runAggregate(supabase, clientId);
  }
  return Response.json(result);
}

// ── Analyze: pixel-laag plus vision-features per creative. ──
async function runAnalyze(supabase: NonNullable<ReturnType<typeof getSupabase>>, apiKey: string, clientId: string, maxNew: number) {
  const visionModel = process.env.META_VISION_MODEL || undefined; // default multimodaal model van de client
  const prompt = buildVisionPrompt({ format: "", adTitle: "", adBody: "" });
  const promptHash = createHash("sha256").update(VISION_PROMPT_VERSION + prompt.system).digest("hex").slice(0, 16);

  const [{ data: creatives, error: creativeError }, { data: existing }] = await Promise.all([
    supabase
      .from("meta_creatives")
      .select("creative_id, format, title, body, image_hash, video_id, thumbnail_url, storage_paths")
      .eq("client_id", clientId),
    supabase
      .from("meta_creative_visual_features")
      .select("creative_id, asset_key, prompt_hash")
      .eq("client_id", clientId)
      .eq("features_version", FEATURES_VERSION),
  ]);
  if (creativeError) return { error: `creatives laden faalde: ${creativeError.message}` };

  const done = new Set((existing ?? []).filter((e) => e.prompt_hash === promptHash).map((e) => `${e.creative_id}|${e.asset_key}`));
  const rows = (creatives ?? []) as CreativeRow[];
  const candidates = rows.filter((c) => !done.has(`${c.creative_id}|${assetKeyOf(c)}`));
  const capped = candidates.slice(0, maxNew);

  const counters = { total_creatives: rows.length, already_current: rows.length - candidates.length, planned: capped.length, capped_out: candidates.length - capped.length, analyzed: 0, failed: 0, zonder_asset: 0 };

  for (const batch of chunk(capped, CONCURRENCY)) {
    await Promise.all(
      batch.map(async (creative) => {
        try {
          const buffer = await loadAssetBuffer(supabase, creative);
          if (!buffer) {
            counters.zonder_asset += 1;
            return;
          }
          const pixel = await analyzeAssetBuffer(buffer);
          // Normaliseer naar jpeg (max 512) voor de multimodale call: consistent mediatype, lage kosten.
          const jpeg = await sharp(buffer).resize(512, 512, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
          const visionPrompt = buildVisionPrompt({ format: creative.format ?? "unknown", adTitle: creative.title ?? "", adBody: creative.body ?? "" });

          let features: CreativeVisionFeatures | null = null;
          let lastReason = "";
          for (let attempt = 0; attempt < 2 && !features; attempt += 1) {
            const suffix = attempt === 0 ? "" : `\n\nJe vorige antwoord was ongeldig (${lastReason}). Antwoord UITSLUITEND met het JSON-object conform de velden en toegestane waarden.`;
            const response = await callOpenRouter({
              apiKey,
              ...(visionModel ? { model: visionModel } : {}),
              systemPrompt: visionPrompt.system,
              userMessage: visionPrompt.user + suffix,
              maxTokens: 2048,
              jsonMode: true,
              temperature: 0,
              label: "meta-creative-vision",
              imageBase64: jpeg.toString("base64"),
              imageMediaType: "image/jpeg",
            });
            const parsed = parseVisionResponse(response.output);
            if (parsed.ok) features = parsed.features;
            else lastReason = parsed.reason;
          }
          if (!features) {
            counters.failed += 1;
            return;
          }

          const { error: upsertError } = await supabase.from("meta_creative_visual_features").upsert(
            {
              creative_id: creative.creative_id,
              asset_key: assetKeyOf(creative),
              client_id: clientId,
              analyzed_at: new Date().toISOString(),
              features_version: FEATURES_VERSION,
              model: visionModel ?? null,
              prompt_hash: promptHash,
              width: pixel.width,
              height: pixel.height,
              aspect_ratio: pixel.aspectRatio,
              dominant_colors: pixel.dominantColors,
              avg_brightness: pixel.avgBrightness,
              contrast: pixel.contrast,
              saturation: pixel.saturation,
              is_dark_mode: pixel.isDarkMode,
              style: features.style,
              human_present: features.human_present,
              human_count: features.human_count,
              face_close_up: features.face_close_up,
              gaze_at_camera: features.gaze_at_camera,
              product_visible: features.product_visible,
              product_prominence: features.product_prominence,
              text_overlay_present: features.text_overlay_present,
              text_coverage_pct_estimate: features.text_coverage_pct_estimate,
              ocr_text: features.ocr_text,
              headline_in_visual: features.headline_in_visual,
              text_readability: features.text_readability,
              logo_present: features.logo_present,
              logo_position: features.logo_position,
              cta_in_visual: features.cta_in_visual,
              hook_element: features.hook_element,
              composition: features.composition,
              background: features.background,
              color_mood: features.color_mood,
              emotion: features.emotion,
              claim_type: features.claim_type,
              safe_zone_risk: features.safe_zone_risk,
              confidence: features.confidence,
              raw_vision: features,
            },
            { onConflict: "creative_id,asset_key" }
          );
          if (upsertError) {
            counters.failed += 1;
            return;
          }
          counters.analyzed += 1;
        } catch {
          counters.failed += 1;
        }
      })
    );
  }
  return counters;
}

async function loadAssetBuffer(supabase: NonNullable<ReturnType<typeof getSupabase>>, creative: CreativeRow): Promise<Buffer | null> {
  const paths = creative.storage_paths ? Object.values(creative.storage_paths).filter((v): v is string => typeof v === "string" && v.length > 0) : [];
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(STORAGE_BUCKET).download(paths[0]);
    if (data) return Buffer.from(await data.arrayBuffer());
  }
  if (creative.thumbnail_url) {
    try {
      const response = await fetch(creative.thumbnail_url);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
    } catch {
      return null;
    }
  }
  return null;
}

// ── Aggregate: patronen per periode via het geteste aggregatePattern. ──
const PATTERN_ATTRIBUTES = ["style", "human_present", "face_close_up", "gaze_at_camera", "product_prominence", "text_overlay_present", "text_readability", "composition", "background", "color_mood", "emotion", "claim_type", "safe_zone_risk", "is_dark_mode"] as const;
const PATTERN_METRICS: PatternMetric[] = ["link_ctr", "hook_rate", "hold_rate", "cvr", "cpa", "roas"];

interface AdTotals {
  adId: string;
  impressions: number;
  linkClicks: number;
  spend: number;
  conversions: number;
  conversionValue: number;
  video3s: number;
  thruplay: number;
}

function metricValueOf(ad: AdTotals, metric: PatternMetric): number | null {
  if (metric === "link_ctr") return ad.impressions > 0 ? ad.linkClicks / ad.impressions : null;
  if (metric === "hook_rate") return ad.impressions > 0 ? ad.video3s / ad.impressions : null;
  if (metric === "hold_rate") return ad.video3s > 0 ? ad.thruplay / ad.video3s : null;
  if (metric === "cvr") return ad.linkClicks > 0 ? ad.conversions / ad.linkClicks : null;
  if (metric === "cpa") return ad.conversions > 0 ? ad.spend / ad.conversions : null;
  return ad.spend > 0 ? ad.conversionValue / ad.spend : null;
}

async function runAggregate(supabase: NonNullable<ReturnType<typeof getSupabase>>, clientId: string) {
  const today = new Date();
  const firstOfThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(firstOfThisMonth.getTime() - 24 * 3600 * 1000);
  const d90Start = new Date(today.getTime() - 90 * 24 * 3600 * 1000);
  const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const periods = [
    { label: "laatste_volle_maand", start: iso(lastMonthStart), end: iso(lastMonthEnd) },
    { label: "laatste_90_dagen", start: iso(d90Start), end: iso(yesterday) },
  ];

  const [{ data: ads }, { data: features }] = await Promise.all([
    supabase.from("meta_ads").select("ad_id, creative_id").eq("client_id", clientId),
    supabase.from("meta_creative_visual_features").select(("creative_id, " + PATTERN_ATTRIBUTES.join(", ")) as "*").eq("client_id", clientId).eq("features_version", FEATURES_VERSION),
  ]);
  const adToCreative = new Map<string, string>((ads ?? []).filter((a) => a.creative_id).map((a) => [a.ad_id as string, a.creative_id as string]));
  const featureByCreative = new Map<string, Record<string, unknown>>(((features ?? []) as unknown as Array<Record<string, unknown>>).map((f) => [f.creative_id as string, f]));

  const output: Record<string, unknown> = {};
  for (const period of periods) {
    const { data: daily, error: dailyError } = await supabase
      .from("meta_ad_daily")
      .select("entity_id, impressions, link_clicks, spend, conversions, conversion_value, video_3s_views, video_thruplay")
      .eq("client_id", clientId)
      .gte("date", period.start)
      .lte("date", period.end);
    if (dailyError) {
      output[period.label] = { error: dailyError.message };
      continue;
    }

    const totals = new Map<string, AdTotals>();
    for (const row of daily ?? []) {
      const adId = row.entity_id as string;
      const t = totals.get(adId) ?? { adId, impressions: 0, linkClicks: 0, spend: 0, conversions: 0, conversionValue: 0, video3s: 0, thruplay: 0 };
      t.impressions += Number(row.impressions ?? 0);
      t.linkClicks += Number(row.link_clicks ?? 0);
      t.spend += Number(row.spend ?? 0);
      t.conversions += Number(row.conversions ?? 0);
      t.conversionValue += Number(row.conversion_value ?? 0);
      t.video3s += Number(row.video_3s_views ?? 0);
      t.thruplay += Number(row.video_thruplay ?? 0);
      totals.set(adId, t);
    }

    // Alleen ads met een geanalyseerde creative doen mee.
    const adsWithFeatures = [...totals.values()].filter((t) => {
      const creativeId = adToCreative.get(t.adId);
      return creativeId != null && featureByCreative.has(creativeId);
    });

    let written = 0;
    for (const attribute of PATTERN_ATTRIBUTES) {
      const values = new Set(
        adsWithFeatures.map((t) => String(featureByCreative.get(adToCreative.get(t.adId) as string)?.[attribute] ?? "")).filter((v) => v !== "" && v !== "null" && v !== "undefined")
      );
      for (const value of values) {
        const groupAds = adsWithFeatures.filter((t) => String(featureByCreative.get(adToCreative.get(t.adId) as string)?.[attribute]) === value);
        for (const metric of PATTERN_METRICS) {
          const adInputs: AdMetricInput[] = groupAds
            .map((t) => ({ adId: t.adId, impressions: t.impressions, conversions: t.conversions, metricValue: metricValueOf(t, metric) }))
            .filter((a): a is AdMetricInput => a.metricValue != null);
          const allInputs = adsWithFeatures
            .map((t) => ({ impressions: t.impressions, metricValue: metricValueOf(t, metric) }))
            .filter((a): a is { impressions: number; metricValue: number } => a.metricValue != null);
          const totalWeight = allInputs.reduce((s, a) => s + a.impressions, 0);
          if (totalWeight === 0 || adInputs.length === 0) continue;
          // Impressie-gewogen account-gemiddelde, consistent met de weging aan de patroonkant.
          const accountAvg = allInputs.reduce((s, a) => s + a.metricValue * a.impressions, 0) / totalWeight;

          const pattern = aggregatePattern({ attribute, value, metric, ads: adInputs, accountAvg });
          if (!pattern) continue;

          const { error: upsertError } = await supabase.from("meta_creative_patterns").upsert(
            {
              client_id: clientId,
              period_start: period.start,
              period_end: period.end,
              attribute: pattern.attribute,
              value: pattern.value,
              metric: pattern.metric,
              n_ads: pattern.nAds,
              impressions: pattern.impressions,
              conversions: pattern.conversions,
              pattern_value: pattern.patternValue,
              account_avg: pattern.accountAvg,
              lift_pct: pattern.liftPct,
              evidence_level: pattern.evidenceLevel,
              computed_at: new Date().toISOString(),
            },
            { onConflict: "client_id,period_start,attribute,value,metric" }
          );
          if (!upsertError) written += 1;
        }
      }
    }
    output[period.label] = { ads_met_features: adsWithFeatures.length, patronen_geschreven: written, periode: `${period.start} tot ${period.end}` };
  }
  return output;
}
