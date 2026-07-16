import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken, type GoogleAdsCredentials } from "@/lib/api/google-ads";
import { logger } from "@/lib/logger";

const MERCHANT_API_BASE = "https://merchantapi.googleapis.com/products/v1";
const DEFAULT_CACHE_HOURS = 24;

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /merchant_product_snapshots/i.test(message) && /schema cache|does not exist|relation/i.test(message);
}

export interface MerchantProductSnapshot {
  client_id: string;
  account_id: string;
  offer_id: string;
  product_name: string | null;
  title: string;
  normalized_title: string;
  brand: string | null;
  product_type: string | null;
  product_type_l1: string | null;
  product_type_l2: string | null;
  product_type_l3: string | null;
  product_type_l4: string | null;
  product_type_l5: string | null;
  custom_label_0: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  custom_label_4: string | null;
  link: string | null;
  availability: string | null;
  price: number | null;
  sale_price: number | null;
  condition: string | null;
  language_code: string | null;
  feed_label: string | null;
  channel: string | null;
  custom_attributes_jsonb: Record<string, unknown> | null;
  source_payload_jsonb: Record<string, unknown> | null;
  snapshot_at: string;
  is_active: boolean;
}

export interface MerchantSyncResult {
  tracker: "fresh_cache" | "stale_cache" | "synced" | "unavailable";
  products: MerchantProductSnapshot[];
  message: string;
}

interface MerchantConfig {
  merchantAccountId: string | null;
  feedLabel: string | null;
  contentLanguage: string | null;
  channel: string | null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitProductType(value: string | null): string[] {
  if (!value) return [];
  return value.split(">").map((part) => part.trim()).filter(Boolean).slice(0, 5);
}

function readString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readCustomAttributes(source: Record<string, unknown>): Record<string, unknown> | null {
  const raw = source.customAttributes || source.custom_attributes;
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function buildSnapshotRow(
  clientId: string,
  accountId: string,
  payload: Record<string, unknown>,
  snapshotAt: string
): MerchantProductSnapshot | null {
  const name = readString(payload, "name");
  const attributes = (payload.attributes || {}) as Record<string, unknown>;
  const productInput = (payload.productInput || payload.product_input || {}) as Record<string, unknown>;
  const merged = { ...productInput, ...attributes, ...payload };

  const offerId = readString(merged, "offerId", "offer_id");
  const title = readString(merged, "title");
  if (!offerId || !title) return null;

  const productType = readString(merged, "productType", "product_type");
  const productTypeLevels = splitProductType(productType);
  const customAttributes = readCustomAttributes(merged);
  const readPrice = (value: unknown): number | null => {
    if (!value || typeof value !== "object") return null;
    const payload = value as Record<string, unknown>;
    const raw = payload.amountMicros ?? payload.amount_micros ?? payload.amount;
    if (typeof raw === "number") return raw > 1000 ? raw / 1_000_000 : raw;
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? (parsed > 1000 ? parsed / 1_000_000 : parsed) : null;
    }
    return null;
  };

  return {
    client_id: clientId,
    account_id: accountId,
    offer_id: offerId,
    product_name: name,
    title,
    normalized_title: normalizeText(title),
    brand: readString(merged, "brand"),
    product_type: productType,
    product_type_l1: productTypeLevels[0] ?? null,
    product_type_l2: productTypeLevels[1] ?? null,
    product_type_l3: productTypeLevels[2] ?? null,
    product_type_l4: productTypeLevels[3] ?? null,
    product_type_l5: productTypeLevels[4] ?? null,
    custom_label_0: readString(merged, "customLabel0", "custom_label_0"),
    custom_label_1: readString(merged, "customLabel1", "custom_label_1"),
    custom_label_2: readString(merged, "customLabel2", "custom_label_2"),
    custom_label_3: readString(merged, "customLabel3", "custom_label_3"),
    custom_label_4: readString(merged, "customLabel4", "custom_label_4"),
    link: readString(merged, "link"),
    availability: readString(merged, "availability"),
    price: readPrice(merged.price),
    sale_price: readPrice(merged.salePrice ?? merged.sale_price),
    condition: readString(merged, "condition"),
    language_code: readString(merged, "contentLanguage", "content_language"),
    feed_label: readString(merged, "feedLabel", "feed_label"),
    channel: readString(merged, "channel"),
    custom_attributes_jsonb: customAttributes,
    source_payload_jsonb: payload,
    snapshot_at: snapshotAt,
    is_active: true,
  };
}

async function readMerchantConfig(
  supabase: SupabaseClient,
  clientId: string
): Promise<MerchantConfig> {
  const { data } = await supabase
    .from("client_settings")
    .select("merchant_account_id, merchant_feed_label, merchant_content_language, merchant_channel")
    .eq("client_id", clientId)
    .maybeSingle();

  return {
    merchantAccountId:
      (data?.merchant_account_id as string | null | undefined) ??
      process.env.GOOGLE_MERCHANT_ACCOUNT_ID ??
      null,
    feedLabel: (data?.merchant_feed_label as string | null | undefined) ?? process.env.GOOGLE_MERCHANT_FEED_LABEL ?? null,
    contentLanguage:
      (data?.merchant_content_language as string | null | undefined) ??
      process.env.GOOGLE_MERCHANT_CONTENT_LANGUAGE ??
      null,
    channel: (data?.merchant_channel as string | null | undefined) ?? process.env.GOOGLE_MERCHANT_CHANNEL ?? null,
  };
}

async function loadCachedSnapshots(
  supabase: SupabaseClient,
  clientId: string
): Promise<MerchantProductSnapshot[]> {
  const { data, error } = await supabase
    .from("merchant_product_snapshots")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .order("snapshot_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as MerchantProductSnapshot[]);
}

async function fetchProcessedMerchantProducts(
  credentials: GoogleAdsCredentials,
  accountId: string
): Promise<Record<string, unknown>[]> {
  const accessToken = await getAccessToken(credentials);
  const allProducts: Record<string, unknown>[] = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(`${MERCHANT_API_BASE}/accounts/${accountId}/products`);
    url.searchParams.set("pageSize", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Merchant API error (${response.status}): ${error}`);
    }

    const data = await response.json() as { products?: Record<string, unknown>[]; nextPageToken?: string };
    allProducts.push(...(data.products ?? []));
    pageToken = data.nextPageToken ?? null;
  } while (pageToken);

  return allProducts;
}

export async function syncMerchantProductSnapshots(opts: {
  supabase: SupabaseClient;
  clientId: string;
  credentials: GoogleAdsCredentials | null;
  forceRefresh?: boolean;
  maxAgeHours?: number;
}): Promise<MerchantSyncResult> {
  const { supabase, clientId, credentials, forceRefresh = false, maxAgeHours = DEFAULT_CACHE_HOURS } = opts;
  let cached: MerchantProductSnapshot[] = [];
  try {
    cached = await loadCachedSnapshots(supabase, clientId);
  } catch (error) {
    if (isMissingTableError(error)) {
      return {
        tracker: "unavailable",
        products: [],
        message: "Merchant snapshot-tabel ontbreekt; gebruik fallback context tot de migratie is uitgevoerd.",
      };
    }
    throw error;
  }
  const freshest = cached[0]?.snapshot_at ? new Date(cached[0].snapshot_at).getTime() : 0;
  const isFresh = freshest > 0 && freshest > Date.now() - maxAgeHours * 60 * 60 * 1000;

  if (cached.length > 0 && isFresh && !forceRefresh) {
    return {
      tracker: "fresh_cache",
      products: cached,
      message: `Merchant cache is vers (${cached.length} producten).`,
    };
  }

  const config = await readMerchantConfig(supabase, clientId);
  if (!config.merchantAccountId || !credentials) {
    return {
      tracker: cached.length > 0 ? "stale_cache" : "unavailable",
      products: cached,
      message: cached.length > 0
        ? "Merchant cache gebruikt omdat live Merchant-config ontbreekt."
        : "Geen Merchant-accountconfig beschikbaar.",
    };
  }

  try {
    const snapshotAt = new Date().toISOString();
    const products = await fetchProcessedMerchantProducts(credentials, config.merchantAccountId);
    const rows = products
      .map((payload) => buildSnapshotRow(clientId, config.merchantAccountId!, payload, snapshotAt))
      .filter(Boolean) as MerchantProductSnapshot[];

    const filteredRows = rows.filter((row) => {
      if (config.feedLabel && row.feed_label && row.feed_label !== config.feedLabel) return false;
      if (config.contentLanguage && row.language_code && row.language_code.toLowerCase() !== config.contentLanguage.toLowerCase()) return false;
      if (config.channel && row.channel && row.channel.toLowerCase() !== config.channel.toLowerCase()) return false;
      return true;
    });

    if (filteredRows.length > 0) {
      const { error } = await supabase
        .from("merchant_product_snapshots")
        .upsert(filteredRows, {
          onConflict: "client_id,account_id,offer_id",
          ignoreDuplicates: false,
        });
      if (error) throw error;
    }

    const latest = await loadCachedSnapshots(supabase, clientId);
    return {
      tracker: "synced",
      products: latest,
      message: `Merchant snapshot vernieuwd (${latest.length} producten).`,
    };
  } catch (error) {
    if (isMissingTableError(error)) {
      return {
        tracker: "unavailable",
        products: cached,
        message: "Merchant snapshot-tabel ontbreekt; fallback-context gebruikt.",
      };
    }
    logger.error("[merchant] sync failed:", error instanceof Error ? error.message : String(error));
    return {
      tracker: cached.length > 0 ? "stale_cache" : "unavailable",
      products: cached,
      message: cached.length > 0
        ? "Merchant sync faalde, maar bestaande snapshot blijft bruikbaar."
        : "Merchant sync faalde en er is geen snapshot beschikbaar.",
    };
  }
}
