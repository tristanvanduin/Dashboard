/**
 * O4: LLM model-routing en fallback (kern, op de bestaande OpenRouter-provider).
 *
 * De call-plek zegt alleen WAT hij nodig heeft via het label; de router kiest het model
 * en een fallback-keten. Productiegedrag is hier ongewijzigd: elke echte stap blijft op het
 * sterke model, met een fallback erachter. Kosten besparen doe je door specifieke stappen in
 * STEP_TIER op "light" te zetten NA verificatie op Minismus.
 *
 * De tweede provider (Copilot of Azure) en de deployment-beschikbaarheid zitten niet in deze
 * kern; die zijn gated op het platform-antwoord (zie O4_llm_model_routing.md).
 */

import {
  callOpenRouter,
  type OpenRouterRequest,
  type OpenRouterResponse,
} from "./openrouter-client";

// Model-catalogus. Model-ID's van de directe Gemini-endpoint (zonder google/-prefix). De
// fallback is bewust OOK een Gemini-model, zodat een fout nooit terugvalt op een betaald
// account bij een andere provider. Bevestig de exacte strings tegen het Gemini-aanbod van
// jullie key (models.list).
export const MODEL_CATALOG = {
  strong: "gemini-3-flash-preview",
  cheap: "gemini-flash-lite-latest",
  crossFallback: "gemini-2.5-flash",
} as const;

export type Tier = "heavy" | "medium" | "light";

// Tier naar modelketen: primair eerst, daarna fallback. De cross-model fallback staat achteraan,
// zodat bij een falen van het primaire model een ander model het overneemt.
const TIER_CHAIN: Record<Tier, string[]> = {
  heavy: [MODEL_CATALOG.strong, MODEL_CATALOG.crossFallback],
  medium: [MODEL_CATALOG.strong, MODEL_CATALOG.crossFallback],
  light: [MODEL_CATALOG.cheap, MODEL_CATALOG.strong],
};

const DEFAULT_TIER: Tier = "heavy";

// Per stapnummer een tier. Leeg betekent: alles heavy, dus geen gedragswijziging. Zet hier
// specifieke stappen op "light" of "medium" om kosten te besparen, pas na verificatie.
const STEP_TIER: Record<number, Tier> = {
  // voorbeeld: 1: "light",
};

/** Leidt de tier af uit het call-label (bv. "monthly-step-3-findings" of "monthly-full"). */
export function resolveTier(
  label: string,
  stepTier: Record<number, Tier> = STEP_TIER
): Tier {
  const m = /step-(\d+)/.exec(label);
  if (m) return stepTier[Number(m[1])] ?? DEFAULT_TIER;
  return DEFAULT_TIER;
}

/** Resolvet de tier plus de modelketen voor een label. */
export function resolveChain(
  label: string,
  stepTier?: Record<number, Tier>
): { tier: Tier; chain: string[] } {
  const tier = resolveTier(label, stepTier);
  return { tier, chain: TIER_CHAIN[tier] };
}

export type RoutedRequest = Omit<OpenRouterRequest, "model">;

/**
 * Voert een LLM-call uit volgens de routing: probeert de modellen in de keten op volgorde en
 * valt bij een fout naar het volgende. Geeft het eerste succes terug; de response meldt welk
 * model bediende. De caller is injecteerbaar voor tests.
 */
export async function callRouted(
  opts: RoutedRequest,
  callFn: (req: OpenRouterRequest) => Promise<OpenRouterResponse> = callOpenRouter
): Promise<OpenRouterResponse> {
  const { chain } = resolveChain(opts.label ?? "unknown");
  let lastError: Error | null = null;
  for (const model of chain) {
    try {
      return await callFn({ ...opts, model, temperature: opts.temperature ?? 0 });
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error("callRouted: geen model in de keten");
}
