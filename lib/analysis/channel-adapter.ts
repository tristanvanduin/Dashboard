// C1: de kanaal-adapter-laag. Doel is de monthly-engine kanaal-agnostisch maken zodat
// Meta en LinkedIn dezelfde kwaliteitsmachinerie erven zonder de Google-pipeline te
// forken. Gedrag voor Google verandert met nul bytes.
//
// Fase A (dit bestand) legt de STATISCHE prompt-laag vast plus de registry: de stap-
// instructies, log-formats, purity-contracten, benchmarks, toegestane issue_clusters,
// log-format-skeletons, purity-regels en de metric- en entity-aliases. Dit is het
// leeuwendeel van de kanaal-specifieke kennis. De data-gescopete functies
// (buildPreparedContext, buildCanonicalMetricMap), de checkpoint-groepering en
// issueFamily komen in fase B erbij, met hun eigen grounding; deze interface wordt
// daar uitgebreid.

import type { AccountType } from "@/lib/prompts/sop-prompts";
import type { StepPurityRule } from "@/lib/analysis/step-validator";

export type ChannelId = "google_ads" | "meta_ads" | "linkedin_ads";

export interface ChannelAdapter {
  channel: ChannelId;
  // Sleutel die in saveAnalysisOutputSection als sop_type wordt weggeschreven.
  sopTypeKey: string;
  // Aantal deep-dive stappen (Google 13). De acceptance en gate gebruiken dit ipv een hardcoded 13.
  stepCount: number;
  // Benchmark-tekst per accounttype, ingevoegd in de system prompt.
  benchmarks: Record<AccountType, string>;
  // De issue_cluster-lijst die in het output-schema aan de LLM wordt getoond (de prompt-lijst).
  // Validatie gebruikt een eigen Zod-enum; die kan ruimer zijn dan deze prompt-lijst.
  issueClusters: readonly string[];
  // De entity_type-lijst die in het output-schema aan de LLM wordt getoond.
  entityTypes: readonly string[];
  // Per stap: de instructie, het log-format en het purity-contract (samen de stap-prompt).
  stepInstructions: Record<number, string>;
  logFormats: Record<number, string>;
  purityContracts: Record<number, string>;
  // Validator-input: log-format-skeletons (regex per stap) en de purity-regels per stap.
  logFormatSkeletons: Record<number, RegExp[]>;
  purityRules: Partial<Record<number, StepPurityRule>>;
  // Canonicalisatie-aliases voor metrieken en entiteiten.
  metricAliases: ReadonlyArray<readonly [RegExp, string]>;
  entityAliases: ReadonlyArray<readonly [RegExp, string]>;
}

const registry = new Map<ChannelId, ChannelAdapter>();

export function registerAdapter(adapter: ChannelAdapter): void {
  registry.set(adapter.channel, adapter);
}

// Onbekend kanaal geeft een nette fout (de route vertaalt die naar een 400), geen crash.
export function getAdapter(channel: string): ChannelAdapter {
  const adapter = registry.get(channel as ChannelId);
  if (!adapter) {
    throw new Error(`Onbekend kanaal: ${channel}. Geregistreerd: ${[...registry.keys()].join(", ") || "geen"}`);
  }
  return adapter;
}

export function hasAdapter(channel: string): boolean {
  return registry.has(channel as ChannelId);
}

export const DEFAULT_CHANNEL: ChannelId = "google_ads";
