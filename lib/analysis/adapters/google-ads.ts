// De Google Ads adapter: wrapt de BESTAANDE constanten een-op-een via de ChannelAdapter-
// interface. Geen herformulering, geen reordering. Dit is de huidige Google-pipeline,
// alleen achter de adapter-abstractie gezet. De parity-test bewijst byte-voor-byte gelijkheid.

import { registerAdapter, type ChannelAdapter } from "@/lib/analysis/channel-adapter";
import { MONTHLY_V2_STEP_INSTRUCTIONS, SOP_LOG_FORMATS, STEP_PURITY_CONTRACTS } from "@/lib/prompts/monthly-v2";
import { MONTHLY_BENCHMARKS, GOOGLE_ISSUE_CLUSTER_TEXT, GOOGLE_ENTITY_TYPE_TEXT } from "@/lib/prompts/sop-prompts";
import { LOG_FORMAT_SKELETONS, STEP_PURITY_RULES } from "@/lib/analysis/step-validator";
import { ENTITY_ALIASES, METRIC_ALIASES } from "@/lib/analysis/canonicalize";

export const googleAdsAdapter: ChannelAdapter = {
  channel: "google_ads",
  sopTypeKey: "monthly",
  stepCount: 13,
  benchmarks: MONTHLY_BENCHMARKS,
  issueClusters: GOOGLE_ISSUE_CLUSTER_TEXT.split(", "),
  entityTypes: GOOGLE_ENTITY_TYPE_TEXT.split("|"),
  stepInstructions: MONTHLY_V2_STEP_INSTRUCTIONS,
  logFormats: SOP_LOG_FORMATS,
  purityContracts: STEP_PURITY_CONTRACTS,
  logFormatSkeletons: LOG_FORMAT_SKELETONS,
  purityRules: STEP_PURITY_RULES,
  metricAliases: METRIC_ALIASES,
  entityAliases: ENTITY_ALIASES,
};

registerAdapter(googleAdsAdapter);
