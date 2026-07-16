/**
 * Enrichment matrix: determines which expert layers to apply per SOP type.
 *
 * Replaces the ad-hoc layer selection that was scattered across route handlers.
 * Each SOP type gets a consistent, configurable set of context layers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "../prompts/sop-prompts";
import {
  fetchStrategicContext,
  calculatePortfolioAnalysis,
  fetchHypothesisTracking,
  calculateLeadingIndicators,
  fetchSectorBenchmarks,
  fetchEnhancedChangeHistory,
  calculateGeoContext,
} from "./expert-layers";
import { computePmaxInsights, type PmaxInsights } from "./pmax-expert-layer";
import {
  getDimensionAvailability,
  buildAvailabilitySummary,
  type ClientDimensionProfile,
} from "./dimension-availability";

// ── Types ──────────────────────────────────────────────────────────────────

export type SopType = "monthly" | "weekly" | "biweekly";

export interface EnrichmentContext {
  strategicContext: string;
  portfolioAnalysis: string;
  hypothesisTracking: string;
  leadingIndicators: string;
  sectorBenchmarks: string;
  changeHistory: string;
  /** Summary of which analysis dimensions are available for this client */
  dimensionAvailability: string;
  /** Full dimension profile for programmatic use */
  dimensionProfile: ClientDimensionProfile | null;
  /** PMAX intelligence context */
  pmaxContext: string;
  /** Full PMAX insights for programmatic use */
  pmaxInsights: PmaxInsights | null;
  /** Geographic/country performance context */
  geoContext: string;
}

/**
 * Which layers are enabled per SOP type.
 *
 * Monthly: all layers (full deep-dive)
 * Weekly: no portfolio or hypothesis (quick health check)
 * Biweekly: no portfolio or leading indicators (check-in against monthly)
 */
const ENRICHMENT_MATRIX: Record<SopType, {
  strategicContext: boolean;
  portfolioAnalysis: boolean;
  hypothesisTracking: boolean;
  leadingIndicators: boolean;
  sectorBenchmarks: boolean;
  changeHistory: boolean;
}> = {
  monthly: {
    strategicContext: true,
    portfolioAnalysis: true,
    hypothesisTracking: true,
    leadingIndicators: true,
    sectorBenchmarks: true,
    changeHistory: true,
  },
  weekly: {
    strategicContext: true,
    portfolioAnalysis: false,
    hypothesisTracking: false,
    leadingIndicators: true,
    sectorBenchmarks: true,
    changeHistory: true,
  },
  biweekly: {
    strategicContext: true,
    portfolioAnalysis: false,
    hypothesisTracking: true,
    leadingIndicators: false,
    sectorBenchmarks: true,
    changeHistory: true,
  },
};

// ── Builder ────────────────────────────────────────────────────────────────

interface EnrichmentOpts {
  supabase: SupabaseClient;
  clientId: string;
  accountType: AccountType;
  sopType: SopType;
  /** Required for strategic context date filtering */
  analysisDate: string;
  /** Required for portfolio analysis — pass campaignData + campaignMetaData */
  campaignData?: Record<string, unknown>[];
  campaignMetaData?: Record<string, unknown>[];
}

/**
 * Build the enrichment context for an analysis run.
 * Only fetches layers enabled in the enrichment matrix for the given SOP type.
 * All layers run in parallel for performance.
 */
export async function buildEnrichmentContext(opts: EnrichmentOpts): Promise<EnrichmentContext> {
  const { supabase, clientId, accountType, sopType, analysisDate, campaignData, campaignMetaData } = opts;
  const matrix = ENRICHMENT_MATRIX[sopType];

  const result: EnrichmentContext = {
    strategicContext: "",
    portfolioAnalysis: "",
    hypothesisTracking: "",
    leadingIndicators: "",
    sectorBenchmarks: "",
    changeHistory: "",
    dimensionAvailability: "",
    dimensionProfile: null,
    pmaxContext: "",
    pmaxInsights: null,
    geoContext: "",
  };

  // Build array of parallel fetches based on matrix
  const tasks: Promise<void>[] = [];

  if (matrix.strategicContext) {
    tasks.push(
      fetchStrategicContext(supabase, clientId, analysisDate)
        .then((v) => { result.strategicContext = v; })
        .catch((e) => { console.error("[enrichment] strategicContext failed:", e); })
    );
  }

  if (matrix.portfolioAnalysis && campaignData && campaignMetaData) {
    tasks.push(
      calculatePortfolioAnalysis(supabase, clientId, campaignData, campaignMetaData)
        .then((v) => { result.portfolioAnalysis = v; })
        .catch((e) => { console.error("[enrichment] portfolioAnalysis failed:", e); })
    );
  }

  if (matrix.hypothesisTracking) {
    tasks.push(
      fetchHypothesisTracking(supabase, clientId)
        .then((v) => { result.hypothesisTracking = v; })
        .catch((e) => { console.error("[enrichment] hypothesisTracking failed:", e); })
    );
  }

  if (matrix.leadingIndicators) {
    tasks.push(
      calculateLeadingIndicators(supabase, clientId)
        .then((v) => { result.leadingIndicators = v; })
        .catch((e) => { console.error("[enrichment] leadingIndicators failed:", e); })
    );
  }

  if (matrix.sectorBenchmarks) {
    tasks.push(
      fetchSectorBenchmarks(supabase, accountType, clientId)
        .then((v) => { result.sectorBenchmarks = v; })
        .catch((e) => { console.error("[enrichment] sectorBenchmarks failed:", e); })
    );
  }

  if (matrix.changeHistory) {
    tasks.push(
      fetchEnhancedChangeHistory(supabase, clientId)
        .then((v) => { result.changeHistory = v; })
        .catch((e) => { console.error("[enrichment] changeHistory failed:", e); })
    );
  }

  // Always compute PMAX insights (only produces output if PMAX campaigns exist)
  tasks.push(
    computePmaxInsights(supabase, clientId)
      .then((insights) => {
        result.pmaxInsights = insights;
        result.pmaxContext = insights.promptContext;
      })
      .catch((e) => { console.error("[enrichment] pmaxInsights failed:", e); })
  );

  // Always compute geo context (only produces output if multi-country)
  tasks.push(
    calculateGeoContext(supabase, clientId)
      .then((v) => { result.geoContext = v; })
      .catch((e) => { console.error("[enrichment] geoContext failed:", e); })
  );

  // Always fetch dimension availability (lightweight query)
  tasks.push(
    getDimensionAvailability(supabase, clientId)
      .then((profile) => {
        result.dimensionProfile = profile;
        result.dimensionAvailability = buildAvailabilitySummary(profile, sopType);
      })
      .catch((e) => { console.error("[enrichment] dimensionAvailability failed:", e); })
  );

  await Promise.all(tasks);
  return result;
}
