/**
 * Dimension availability layer.
 *
 * Provides deterministic answers to:
 * - Which dimensional data is available for a given client?
 * - Which SOP sections can be supported with real data?
 * - Which dimensions are partial, missing, or require GA4?
 *
 * This is the bridge between the data layer and the analysis engine.
 * Later prompt/analysis code should check this before claiming coverage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DimensionName, DataSource } from "../types/dimensional";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DimensionStatus {
  dimension: DimensionName;
  isAvailable: boolean;
  rowCount: number;
  latestMonth: string | null;
  earliestMonth: string | null;
  monthsAvailable: number;
  isPartial: boolean;
  dataSource: DataSource;
  notes: string | null;
}

export interface ClientDimensionProfile {
  clientId: string;
  dimensions: Map<DimensionName, DimensionStatus>;
  /** Timestamp of when this profile was fetched */
  fetchedAt: string;
}

/**
 * SOP section → which dimensions it needs to produce real analysis.
 * If ALL required dimensions are available, the section is "supported".
 * If SOME are available, it's "partial".
 * If NONE are available, it's "unsupported".
 */
export type SopSectionSupport = "supported" | "partial" | "unsupported";

export interface SopSection {
  name: string;
  sopType: "monthly" | "weekly" | "biweekly";
  requiredDimensions: DimensionName[];
  optionalDimensions: DimensionName[];
  support: SopSectionSupport;
  missingRequired: DimensionName[];
  missingOptional: DimensionName[];
}

// ── SOP Section → Dimension mapping ────────────────────────────────────────

const SOP_SECTION_DEFINITIONS: Omit<SopSection, "support" | "missingRequired" | "missingOptional">[] = [
  // Monthly sections
  {
    name: "Account Performance",
    sopType: "monthly",
    requiredDimensions: ["account_monthly", "account_weekly"],
    optionalDimensions: ["device_performance", "network_performance"],
  },
  {
    name: "Campaign Performance",
    sopType: "monthly",
    requiredDimensions: ["campaign_monthly"],
    optionalDimensions: ["impression_share"],
  },
  {
    name: "Ad Group Performance",
    sopType: "monthly",
    requiredDimensions: ["adgroup_monthly"],
    optionalDimensions: ["keyword_performance"],
  },
  {
    name: "Competitor & Auction Insights",
    sopType: "monthly",
    requiredDimensions: ["impression_share"],
    optionalDimensions: [],
  },
  {
    name: "Search Term Performance",
    sopType: "monthly",
    requiredDimensions: ["search_terms_wasteful"],
    optionalDimensions: ["search_terms_monthly"],
  },
  {
    name: "Keyword Performance",
    sopType: "monthly",
    requiredDimensions: ["keyword_performance"],
    optionalDimensions: [],
  },
  {
    name: "Product Performance",
    sopType: "monthly",
    requiredDimensions: ["product_performance"],
    optionalDimensions: [],
  },
  {
    name: "Creative Performance",
    sopType: "monthly",
    requiredDimensions: ["creative_performance"],
    optionalDimensions: ["asset_group_performance"],
  },
  {
    name: "Device Performance",
    sopType: "monthly",
    requiredDimensions: ["device_performance"],
    optionalDimensions: [],
  },
  {
    name: "Geographic Performance",
    sopType: "monthly",
    requiredDimensions: ["geo_performance"],
    optionalDimensions: [],
  },
  {
    name: "Audience Performance",
    sopType: "monthly",
    requiredDimensions: ["audience_performance"],
    optionalDimensions: [],
  },
  {
    name: "Ad Schedule Analysis",
    sopType: "monthly",
    requiredDimensions: ["ad_schedule_performance"],
    optionalDimensions: [],
  },
  {
    name: "Engagement & Checkout",
    sopType: "monthly",
    requiredDimensions: ["engagement_metrics", "checkout_metrics"],
    optionalDimensions: [],
  },
  // Weekly sections
  {
    name: "Account Health Check",
    sopType: "weekly",
    requiredDimensions: ["account_weekly"],
    optionalDimensions: ["device_performance"],
  },
  {
    name: "Keyword & Zoekterm Bleeders",
    sopType: "weekly",
    requiredDimensions: ["search_terms_wasteful"],
    optionalDimensions: ["keyword_performance", "search_terms_monthly"],
  },
  {
    name: "Budget & Spend Anomalies",
    sopType: "weekly",
    requiredDimensions: ["campaign_monthly"],
    optionalDimensions: ["impression_share"],
  },
  // Biweekly sections
  {
    name: "Account Performance Check-in",
    sopType: "biweekly",
    requiredDimensions: ["account_monthly", "account_weekly"],
    optionalDimensions: [],
  },
  {
    name: "Campaign Performance Check-in",
    sopType: "biweekly",
    requiredDimensions: ["campaign_monthly"],
    optionalDimensions: [],
  },
  {
    name: "Ad Group Check-in",
    sopType: "biweekly",
    requiredDimensions: ["adgroup_monthly"],
    optionalDimensions: [],
  },
  {
    name: "Device & Engagement",
    sopType: "biweekly",
    requiredDimensions: ["device_performance"],
    optionalDimensions: ["engagement_metrics"],
  },
];

// ── Core functions ─────────────────────────────────────────────────────────

/**
 * Fetch the dimension availability profile for a client from Supabase.
 */
export async function getDimensionAvailability(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientDimensionProfile> {
  const { data } = await supabase
    .from("ads_dimension_availability")
    .select("*")
    .eq("client_id", clientId);

  const dimensions = new Map<DimensionName, DimensionStatus>();

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const dim = row.dimension as DimensionName;
    dimensions.set(dim, {
      dimension: dim,
      isAvailable: row.is_available as boolean,
      rowCount: (row.row_count as number) || 0,
      latestMonth: (row.latest_month as string) || null,
      earliestMonth: (row.earliest_month as string) || null,
      monthsAvailable: (row.months_available as number) || 0,
      isPartial: (row.is_partial as boolean) || false,
      dataSource: (row.data_source as DataSource) || "google_ads",
      notes: (row.notes as string) || null,
    });
  }

  return {
    clientId,
    dimensions,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Check if a specific dimension is available for a client.
 * Returns false if the dimension row doesn't exist or is_available = false.
 */
export function isDimensionAvailable(
  profile: ClientDimensionProfile,
  dimension: DimensionName
): boolean {
  return profile.dimensions.get(dimension)?.isAvailable ?? false;
}

/**
 * Get all available dimension names for a client.
 */
export function getAvailableDimensions(
  profile: ClientDimensionProfile
): DimensionName[] {
  const available: DimensionName[] = [];
  for (const [dim, status] of profile.dimensions) {
    if (status.isAvailable) available.push(dim);
  }
  return available;
}

/**
 * Evaluate which SOP sections are supported for a given client.
 * Returns the full list of sections with their support status.
 */
export function evaluateSopSections(
  profile: ClientDimensionProfile,
  sopType?: "monthly" | "weekly" | "biweekly"
): SopSection[] {
  const defs = sopType
    ? SOP_SECTION_DEFINITIONS.filter((s) => s.sopType === sopType)
    : SOP_SECTION_DEFINITIONS;

  return defs.map((def) => {
    const missingRequired = def.requiredDimensions.filter(
      (d) => !isDimensionAvailable(profile, d)
    );
    const missingOptional = def.optionalDimensions.filter(
      (d) => !isDimensionAvailable(profile, d)
    );

    let support: SopSectionSupport;
    if (missingRequired.length === 0) {
      support = "supported";
    } else if (missingRequired.length < def.requiredDimensions.length) {
      support = "partial";
    } else {
      support = "unsupported";
    }

    return {
      ...def,
      support,
      missingRequired,
      missingOptional,
    };
  });
}

/**
 * Build a concise summary string of supported/unsupported sections.
 * Useful for injecting into prompts so the LLM knows what data is available.
 */
export function buildAvailabilitySummary(
  profile: ClientDimensionProfile,
  sopType: "monthly" | "weekly" | "biweekly"
): string {
  const sections = evaluateSopSections(profile, sopType);
  const supported = sections.filter((s) => s.support === "supported");
  const partial = sections.filter((s) => s.support === "partial");
  const unsupported = sections.filter((s) => s.support === "unsupported");

  const lines: string[] = [];
  lines.push("## Beschikbare analysedimensies voor dit account");

  if (supported.length > 0) {
    lines.push(`\nVolledig ondersteund (${supported.length}):`);
    for (const s of supported) {
      lines.push(`- ${s.name}`);
    }
  }

  if (partial.length > 0) {
    lines.push(`\nGedeeltelijk ondersteund (${partial.length}):`);
    for (const s of partial) {
      lines.push(`- ${s.name} (ontbreekt: ${s.missingRequired.join(", ")})`);
    }
  }

  if (unsupported.length > 0) {
    lines.push(`\nNiet beschikbaar — analyseer NIET (${unsupported.length}):`);
    for (const s of unsupported) {
      lines.push(`- ${s.name}`);
    }
  }

  lines.push("\nBELANGRIJK: Doe GEEN uitspraken over dimensies die niet beschikbaar zijn.");

  return lines.join("\n");
}
