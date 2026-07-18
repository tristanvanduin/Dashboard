// ============================================================
// SI7: de losse Google-analyses -> goedkeuringswachtrij
// ------------------------------------------------------------
// De vijf losse analyses (budgetallocatie, biedstrategie, impression share, RSA-copy en
// landing-audit) rekenen deterministisch voor maar landden nooit in sprint_hypotheses. Deze
// module mapt de facts van elke analyse naar EEN beknopt voorstel (net als search_terms, zodat
// de wachtrij niet volloopt) en schrijft het via saveProposalsReplacingPending onder een eigen
// bron weg. Volledig deterministisch (geen LLM), zodat het los testbaar is. Elke mapper geeft
// een lege lijst als er niets te doen is; saveProposalsReplacingPending ruimt dan de oude
// pending van die bron op.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { saveProposalsReplacingPending, type SprintHypothesisRow, type ProposalSource } from "../second-opinion/findings-to-hypotheses";
import type { BudgetAllocationSummary, BudgetFact } from "./budget-allocation-facts";
import type { BidStrategySummary, BidFact } from "./bid-strategy-facts";
import type { CampaignISFact, ImpressionShareSummary } from "./impression-share-facts";
import type { RsaInsightsFacts } from "./rsa-insights-facts";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Bouwt een rij met de ICE-velden ingevuld en het totaal afgeleid (I+C+E)/3.
function proposal(
  opts: { clientId: string; analysisId: string | null; source: ProposalSource },
  fields: Omit<SprintHypothesisRow, "client_id" | "analysis_id" | "status" | "source" | "ice_total"> & { ice_impact: number; ice_confidence: number; ice_ease: number }
): SprintHypothesisRow {
  return {
    client_id: opts.clientId,
    analysis_id: opts.analysisId,
    status: "pending",
    source: opts.source,
    ice_total: round1((fields.ice_impact + fields.ice_confidence + fields.ice_ease) / 3),
    ...fields,
  };
}

// Impact schaalt met het aantal actiepunten: meer campagnes/pagina's = grotere hefboom.
function impactFromCount(count: number, high = 3): number {
  return count >= high ? 8 : count >= 1 ? 5 : 2;
}

interface MapOpts {
  clientId: string;
  analysisId: string | null;
}

// ── 1. Budgetallocatie ──────────────────────────────────────
// Actie zodra er campagnes op- of af te schalen zijn. Vertrouwen hoger mét een doel (CPA/ROAS),
// want dan is de marginale-euro-beslissing gefundeerd i.p.v. puur op zichtbaarheid.
export function budgetAllocationToHypotheses(
  input: { summary: BudgetAllocationSummary; scaleUp: BudgetFact[]; scaleDown: BudgetFact[] },
  opts: MapOpts
): SprintHypothesisRow[] {
  const { summary, scaleUp, scaleDown } = input;
  const total = scaleUp.length + scaleDown.length;
  if (total === 0) return [];

  const up = scaleUp.slice(0, 3).map((c) => c.campaignName).join(", ");
  const down = scaleDown.slice(0, 3).map((c) => c.campaignName).join(", ");
  const parts: string[] = [];
  if (scaleUp.length) parts.push(`opschalen (${scaleUp.length}): ${up}`);
  if (scaleDown.length) parts.push(`afschalen (${scaleDown.length}): ${down}`);

  return [
    proposal({ ...opts, source: "budget_allocation" }, {
      hypothesis: `Herverdeel budget over ${total} campagne(s) naar bewezen-efficiëntere plekken`,
      expected_result: "Meer conversies/waarde bij gelijk budget doordat de marginale euro naar campagnes met kop-ruimte en betere efficiëntie gaat.",
      measurement_metric: "Account-CPA/ROAS en het aandeel budget-gelimiteerd verlies in de volgende budgetallocatie-analyse.",
      timeframe: "2 weken",
      rationale: `${summary.scaleUp} op-, ${summary.scaleDown} af-, ${summary.hold} gelijkhouden${summary.hasTarget ? " (t.o.v. doel)" : " (zonder doel; puur op zichtbaarheid)"}. ${parts.join(". ")}.`,
      ice_impact: impactFromCount(total),
      ice_confidence: summary.hasTarget ? 8 : 5,
      ice_ease: 6,
    }),
  ];
}

// ── 2. Biedstrategie ────────────────────────────────────────
// Actie zodra er mismatches zijn (alles behalve fit). Ease matig: een strategiewissel heeft een
// leerperiode, dus niet als quick win scoren.
export function bidStrategyToHypotheses(
  input: { summary: BidStrategySummary; campaigns: BidFact[] },
  opts: MapOpts
): SprintHypothesisRow[] {
  const mismatches = input.campaigns.filter((c) => c.fit !== "fit");
  if (mismatches.length === 0) return [];

  const examples = mismatches.slice(0, 3).map((c) => `${c.campaignName} (${c.fit})`).join(", ");
  const byFit = Object.entries(input.summary.byFit)
    .filter(([fit, n]) => fit !== "fit" && n > 0)
    .map(([fit, n]) => `${n}× ${fit}`)
    .join(", ");

  return [
    proposal({ ...opts, source: "bid_strategy" }, {
      hypothesis: `Corrigeer de biedstrategie op ${mismatches.length} campagne(s) waar de fit niet klopt`,
      expected_result: "Betere sturing op het doel doordat elke campagne de biedstrategie draait die bij haar volume, waarde en doel past.",
      measurement_metric: "Aantal biedstrategie-mismatches en de doel-CPA/ROAS-realisatie in de volgende biedstrategie-analyse.",
      timeframe: "4 weken",
      rationale: `${mismatches.length} mismatch(es): ${byFit}. Voorbeelden: ${examples}.`,
      ice_impact: impactFromCount(mismatches.length),
      ice_confidence: 7,
      ice_ease: 5,
    }),
  ];
}

// ── 3. Impression share ─────────────────────────────────────
// Eén voorstel dat beide hefbomen benoemt: budget-gelimiteerd verlies (verhoog budget) en
// rang-gelimiteerd verlies (verbeter bod/kwaliteit). Vertrouwen hoog: IS-verlies is een harde
// meting uit de Google-data.
export function impressionShareToHypotheses(
  input: { summary: ImpressionShareSummary; campaigns: CampaignISFact[] },
  opts: MapOpts
): SprintHypothesisRow[] {
  const { summary } = input;
  const total = summary.raiseBudgetCandidates + summary.bidOrQualityCandidates;
  if (total === 0) return [];

  const parts: string[] = [];
  if (summary.raiseBudgetCandidates) parts.push(`${summary.raiseBudgetCandidates} budget-gelimiteerd (verhoog budget)`);
  if (summary.bidOrQualityCandidates) parts.push(`${summary.bidOrQualityCandidates} rang-gelimiteerd (verbeter bod/kwaliteit)`);
  const examples = input.campaigns
    .filter((c) => c.totalLostIs > 0)
    .slice(0, 3)
    .map((c) => c.campaignName)
    .join(", ");

  return [
    proposal({ ...opts, source: "impression_share" }, {
      hypothesis: `Herwin zichtbaarheid op ${total} campagne(s) met impression-share-verlies`,
      expected_result: "Hoger vertoningsaandeel op de converterende campagnes, waardoor meer relevante vertoningen en klikken binnenkomen.",
      measurement_metric: "Search impression share en het budget-/rang-verlies per campagne in de volgende impression-share-analyse.",
      timeframe: "2 weken",
      rationale: `${parts.join("; ")}. Grootste verliezers: ${examples || "n.v.t."}.`,
      ice_impact: impactFromCount(total),
      ice_confidence: 8,
      ice_ease: 6,
    }),
  ];
}

// ── 4. RSA-copy ─────────────────────────────────────────────
// Actie zodra er geprioriteerde schrijfopdrachten zijn. Impact bescheiden (copy is
// incrementeel), ease hoog (tekst aanpassen is snel).
export function rsaInsightsToHypotheses(
  facts: RsaInsightsFacts,
  opts: MapOpts
): SprintHypothesisRow[] {
  const actions = facts.actions ?? [];
  if (actions.length === 0) return [];

  const byKind = actions.reduce<Record<string, number>>((acc, a) => {
    acc[a.kind] = (acc[a.kind] ?? 0) + 1;
    return acc;
  }, {});
  const kinds = Object.entries(byKind).map(([k, n]) => `${n}× ${k}`).join(", ");
  const examples = actions.slice(0, 3).map((a) => a.detail).join(" · ");

  return [
    proposal({ ...opts, source: "rsa_insights" }, {
      hypothesis: `Voer ${actions.length} RSA-copy-verbetering(en) door (zwakke assets, pins, varianten)`,
      expected_result: "Sterkere advertentie-relevantie en CTR doordat zwak presterende assets vervangen worden en dominante pins losgelaten worden.",
      measurement_metric: "Aandeel BEST/GOOD-assets en de indicatieve CTR per asset in de volgende RSA-copy-analyse.",
      timeframe: "1 week",
      rationale: `${kinds}. ${examples}. ${facts.attributionNote}`,
      ice_impact: actions.length >= 3 ? 6 : 3,
      ice_confidence: 6,
      ice_ease: 7,
    }),
  ];
}

// ── 5. Landing-audit ────────────────────────────────────────
// De route houdt zijn resultaat-type intern; we nemen een kleine, ontkoppelde vorm aan zodat de
// mapper los testbaar is. Prijsafwijking is ernstig (ad belooft iets anders dan de pagina) en
// tilt de impact omhoog; verder telt een lage match-score.
export interface LandingAuditItem {
  url: string;
  readable: boolean;
  priceMismatch: boolean;
  overallScore: number | null; // 1-10 uit het match-oordeel, of null als niet beoordeeld
  grootsteGap: string | null;
}

const LOW_MATCH_SCORE = 5;

export function landingAuditToHypotheses(
  items: LandingAuditItem[],
  opts: MapOpts
): SprintHypothesisRow[] {
  const priceMismatches = items.filter((i) => i.readable && i.priceMismatch);
  const lowMatch = items.filter((i) => i.overallScore != null && i.overallScore <= LOW_MATCH_SCORE);
  const affected = new Set([...priceMismatches, ...lowMatch].map((i) => i.url));
  if (affected.size === 0) return [];

  const gaps = [...priceMismatches, ...lowMatch]
    .map((i) => (i.priceMismatch ? `${i.url}: PRIJS wijkt af` : `${i.url}: ${i.grootsteGap ?? "lage match"}`))
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .slice(0, 4)
    .join(" · ");

  const urgent = priceMismatches.length > 0;
  return [
    proposal({ ...opts, source: "landing_audit" }, {
      hypothesis: `Verbeter de message match op ${affected.size} landingspagina('s)${urgent ? " (prijsafwijking!)" : ""}`,
      expected_result: "Betere conversieratio doordat de landingspagina de belofte uit de advertentie (claims, prijs) waarmaakt.",
      measurement_metric: "Match-score en prijs-consistentie per pagina in de volgende landing-audit; conversieratio van de betrokken ad-groepen.",
      timeframe: urgent ? "1 week" : "2 weken",
      rationale: `${priceMismatches.length} prijsafwijking(en), ${lowMatch.length} lage match-score(s). ${gaps}.`,
      ice_impact: urgent ? 8 : 5,
      ice_confidence: 7,
      ice_ease: 5,
    }),
  ];
}

// ── Save-wrappers (elk vervangt alleen zijn eigen pending) ──

export function saveBudgetAllocationHypotheses(supabase: SupabaseClient, input: { summary: BudgetAllocationSummary; scaleUp: BudgetFact[]; scaleDown: BudgetFact[] }, opts: MapOpts): Promise<number> {
  return saveProposalsReplacingPending(supabase, opts.clientId, "budget_allocation", budgetAllocationToHypotheses(input, opts));
}
export function saveBidStrategyHypotheses(supabase: SupabaseClient, input: { summary: BidStrategySummary; campaigns: BidFact[] }, opts: MapOpts): Promise<number> {
  return saveProposalsReplacingPending(supabase, opts.clientId, "bid_strategy", bidStrategyToHypotheses(input, opts));
}
export function saveImpressionShareHypotheses(supabase: SupabaseClient, input: { summary: ImpressionShareSummary; campaigns: CampaignISFact[] }, opts: MapOpts): Promise<number> {
  return saveProposalsReplacingPending(supabase, opts.clientId, "impression_share", impressionShareToHypotheses(input, opts));
}
export function saveRsaInsightsHypotheses(supabase: SupabaseClient, facts: RsaInsightsFacts, opts: MapOpts): Promise<number> {
  return saveProposalsReplacingPending(supabase, opts.clientId, "rsa_insights", rsaInsightsToHypotheses(facts, opts));
}
export function saveLandingAuditHypotheses(supabase: SupabaseClient, items: LandingAuditItem[], opts: MapOpts): Promise<number> {
  return saveProposalsReplacingPending(supabase, opts.clientId, "landing_audit", landingAuditToHypotheses(items, opts));
}
