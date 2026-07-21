// GA4 als VERKLARENDE CONTEXT voor de kanaal-SOP's. Dit is de herbruikbare laag waarmee een SOP
// GA4-context ophaalt zonder eigen GA4-logica: één call → een gelabeld promptContext-blok dat
// naast het bestaande data-reliability-blok in de SOP-prompt wordt geschoven. GA4 VERRIJKT de
// SOP; de bestaande SOP-logica wordt niet vervangen.
//
// Vier gescheiden signaal-soorten (zoals afgesproken): media-signaal, website/funnel-signaal,
// tracking-signaal, CRO-signaal. Plus de bewijs-basis: elke conclusie moet expliciet aangeven of
// ze op platform-, GA4-, gecombineerde of geschatte data rust (EvidenceBasis).
//
// Geen valse zekerheid:
//  - availability "absent" → promptContext = "" (nul promptwijziging; de SOP draait zonder GA4).
//  - onvolledige GA4-data → als beperking gelabeld.
//  - GA4 mag platformconclusies verklaren/nuanceren, niet overschrijven zonder bewijs.

import { fetchGa4Dataset, type Ga4Deps } from "./data-access";
import { buildGa4TrackingSignals } from "./signals";
import type { Ga4Availability, Ga4Channel, Ga4DailyRow, Ga4Dataset, EvidenceBasis } from "./types";
import type { DetectionResult } from "@/lib/signals/types";
import type { ChannelId } from "@/lib/analysis/channel-adapter";

export interface Ga4ContextBlock {
  availability: Ga4Availability;
  promptContext: string;       // klaar om in de SOP-prompt te injecteren ("" als GA4 absent)
  defaultEvidenceBasis: EvidenceBasis; // waar de SOP standaard op rust als GA4 (deels) meespreekt
  limitations: string[];
  signals: DetectionResult;    // de getriggerde GA4-signalen (voor de wachtrij/feed)
}

const CHANNEL_OF_SOP: Record<ChannelId, Ga4Channel> = {
  google_ads: "google",
  meta_ads: "meta",
  linkedin_ads: "linkedin",
};

// Deterministische bewijs-basis-resolver (de "guard" achter het expliciete evidenceBasis-veld).
// Bepaalt objectief waar een conclusie op mág rusten, gegeven of GA4 beschikbaar is, of GA4 is
// gebruikt, en of het cijfer geschat is. Voorkomt dat "ga4"/"combined" wordt geclaimd zonder data.
export function resolveEvidenceBasis(opts: {
  ga4Available: boolean;
  usedGa4: boolean;
  usedPlatform: boolean;
  isEstimated: boolean;
}): EvidenceBasis {
  if (opts.isEstimated) return "estimated";
  if (opts.usedGa4 && !opts.ga4Available) return "platform"; // kan geen GA4 claimen zonder data
  if (opts.usedGa4 && opts.usedPlatform && opts.ga4Available) return "combined";
  if (opts.usedGa4 && opts.ga4Available) return "ga4";
  return "platform";
}

const CHANNEL_LABEL: Record<Ga4Channel, string> = { google: "Google", meta: "Meta", linkedin: "LinkedIn", other: "Overig (organisch/direct)" };

interface Windowed { sessions: number; engaged: number; key: number; funnel: Record<string, number> }
function windowAgg(rows: Ga4DailyRow[], fromDays: number, toDays: number): Windowed {
  const now = Date.now();
  const acc: Windowed = { sessions: 0, engaged: 0, key: 0, funnel: {} };
  for (const r of rows) {
    const age = (now - Date.parse(r.date)) / 86_400_000;
    if (!Number.isFinite(age) || age < fromDays || age >= toDays) continue;
    acc.sessions += r.sessions; acc.engaged += r.engagedSessions; acc.key += r.keyEvents;
    for (const [k, v] of Object.entries(r.funnel)) acc.funnel[k] = (acc.funnel[k] ?? 0) + v;
  }
  return acc;
}

const pctS = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : "—");

// Bouwt het GA4-contextblok voor één kanaal-SOP. `deps` draagt de Supabase-client (voor de
// config-lookup) en optioneel `now` voor tests.
export async function channelGa4Context(clientId: string, channel: ChannelId, deps: Ga4Deps = {}): Promise<Ga4ContextBlock> {
  const dataset = await fetchGa4Dataset(clientId, deps);
  return buildGa4ContextBlock(dataset, channel);
}

// Puur (los te testen): dataset + kanaal → contextblok. Alle tekstopbouw en labeling zit hier.
export function buildGa4ContextBlock(dataset: Ga4Dataset, channel: ChannelId): Ga4ContextBlock {
  const ga4Channel = CHANNEL_OF_SOP[channel];
  const signals = buildGa4TrackingSignals(dataset.rows);

  if (dataset.availability === "absent") {
    // Nul promptwijziging: de SOP draait volledig zonder GA4.
    return { availability: "absent", promptContext: "", defaultEvidenceBasis: "platform", limitations: dataset.limitations, signals: { triggered: [], checked: signals.checked } };
  }

  const channelRows = dataset.rows.filter((r) => r.channel === ga4Channel);
  const recent = windowAgg(channelRows, 0, 28);
  const prior = windowAgg(channelRows, 28, 56);
  const steps = dataset.config?.funnelSteps ?? [];

  const lines: string[] = [];
  lines.push("## GA4-CONTEXT (website/funnel — verklarende laag; vervangt platformconclusies NIET)");
  lines.push("");
  const availLabel = dataset.availability === "mock" ? "DEMO/MOCK" : dataset.availability === "partial" ? "GEDEELTELIJK" : "LIVE";
  lines.push(`Beschikbaarheid: ${availLabel} — kanaal ${CHANNEL_LABEL[ga4Channel]}.`);
  if (dataset.limitations.length > 0) {
    lines.push(`Beperkingen: ${dataset.limitations.join(" ")}`);
  }
  lines.push("");

  // 1) media-signaal — sessies uit GA4 voor dit kanaal (recent vs prior).
  lines.push(`- MEDIA-SIGNAAL: GA4 telt ${recent.sessions} sessies (28d) voor ${CHANNEL_LABEL[ga4Channel]} (vorige 28d: ${prior.sessions}). Engaged: ${pctS(recent.engaged, recent.sessions)}.`);

  // 2) website/funnel-signaal — funnel-doorstroom over de geconfigureerde stappen.
  if (steps.length >= 2) {
    const parts: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const cur = recent.funnel[steps[i]] ?? 0;
      if (i === 0) { parts.push(`${steps[i]} ${cur}`); continue; }
      const prev = recent.funnel[steps[i - 1]] ?? 0;
      parts.push(`→ ${steps[i]} ${cur} (${pctS(cur, prev)})`);
    }
    lines.push(`- WEBSITE/FUNNEL-SIGNAAL: ${parts.join(" ")}.`);
  } else {
    lines.push("- WEBSITE/FUNNEL-SIGNAAL: geen funnelstappen geconfigureerd (beperking — funnel niet te duiden).");
  }

  // 3) tracking-signaal — het deterministische break-signaal.
  if (signals.triggered.length > 0) {
    lines.push(`- TRACKING-SIGNAAL: ⚠ ${signals.triggered[0].story}`);
  } else {
    lines.push(`- TRACKING-SIGNAAL: geen breuk gedetecteerd (key events lopen door t.o.v. de basislijn).`);
  }

  // 4) CRO-signaal — key-event-ratio recent vs prior (richtinggevend).
  lines.push(`- CRO-SIGNAAL: key-event-ratio ${pctS(recent.key, recent.sessions)} (28d) vs ${pctS(prior.key, prior.sessions)} (vorige 28d).`);

  lines.push("");
  lines.push("INSTRUCTIE — bewijs-basis: label ELKE conclusie die GA4 raakt expliciet als [platform] / [ga4] / [combined] / [estimated].");
  lines.push("- Gebruik GA4 als VERKLARING/nuance bij de platformcijfers; overschrijf een platformconclusie niet zonder GA4-bewijs.");
  lines.push("- Is de GA4-data onvolledig of gemockt, of rust een uitspraak op een schatting → markeer als [estimated] en benoem de beperking.");

  return {
    availability: dataset.availability,
    promptContext: lines.join("\n"),
    defaultEvidenceBasis: "combined",
    limitations: dataset.limitations,
    signals,
  };
}
