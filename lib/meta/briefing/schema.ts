// M4 briefing-contract: het schema waar de builder (een LLM-call die UITSLUITEND
// formuleert, temperatuur 0,2, build-kant) aan moet voldoen, met de spec-no-go's als
// refines: 3 tot 5 concepten plus precies een bewust experiment, geen concept zonder
// referentie naar bewijs of zonder expliciet test-label, en een testhypothese in het
// F5-regime met een guardrail die disjunct is van de success-metric. De grounded-getallen-
// gate (containsUngroundedNumber, F5) draait aan de route-kant over de hele output.

import { z } from "zod";
import type { BriefingSelection } from "./selection";
import type { BriefingBrandContext } from "@/lib/branding/brand-guide";

export const BRIEFING_PROMPT_VERSION = "m4-briefing-v1";

const HexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const HypothesisSchema = z
  .object({
    verwachting: z.string().min(1),
    successMetric: z.string().min(1),
    guardrailMetric: z.string().min(1),
    meetvensterDagen: z.number().int().min(7).max(60),
    accept: z.string().min(1),
    reject: z.string().min(1),
  })
  .refine((h) => h.guardrailMetric.trim().toLowerCase() !== h.successMetric.trim().toLowerCase(), {
    message: "de guardrail-metric moet disjunct zijn van de success-metric (F5-regime)",
  });

const ConceptSchema = z
  .object({
    naam: z.string().min(1),
    doelEnFunnelfase: z.string().min(1),
    format: z.string().min(1),
    aantalVarianten: z.number().int().min(1).max(6),
    specs: z.object({
      ratio_1_1: z.string().min(1),
      ratio_4_5: z.string().min(1),
      ratio_9_16: z.string().min(1), // inclusief safe-zones, de spec noemt 9:16 expliciet
    }),
    hook: z.string().min(1), // wat er in de eerste seconde of het eerste beeld gebeurt
    visueleRichting: z.object({
      stijl: z.string().min(1),
      mensProduct: z.string().min(1),
      compositie: z.string().min(1),
      kleurpaletHex: z.array(HexSchema).min(1), // uit de pixel-laag van de winnaars
    }),
    tekstOverlay: z.object({
      gebruiken: z.boolean(),
      maxDekkingPct: z.number().min(0).max(100),
      leesbaarheidEis: z.string().min(1),
    }),
    copyRichtingEnCta: z.string().min(1),
    referentieAds: z.array(z.string()),
    referentiePatronen: z.array(z.string()),
    testhypothese: HypothesisSchema,
    isExperiment: z.boolean(),
    experimentRedenatie: z.string().nullable(), // de gap-redenatie; verplicht bij het experiment
  })
  .superRefine((concept, ctx) => {
    if (concept.isExperiment) {
      if (!concept.experimentRedenatie || concept.experimentRedenatie.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "het experiment moet de gap-redenatie dragen (waarom dit gat kansrijk is)" });
      }
      if (!/onbewezen/i.test(concept.naam)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'het experiment moet expliciet "onbewezen" in de naam dragen (test-label)' });
      }
    } else {
      if (concept.referentieAds.length === 0 || concept.referentiePatronen.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "een concept zonder referentie-ads en referentie-patronen is niet toegestaan (geen concept zonder bewijs)" });
      }
    }
  });

export const BriefingSchema = z
  .object({
    kop: z.object({
      klant: z.string().min(1),
      periodeBasis: z.string().min(1),
      doelstelling: z.string().min(1),
      funnelfocus: z.string().min(1),
    }),
    watWerkt: z
      .array(
        z.object({
          richtlijn: z.string().min(1), // een zin met het bewijs erin, zoals de spec voorschrijft
          referentiePatroon: z.string().min(1),
        })
      )
      .max(6),
    donts: z.array(z.object({ richtlijn: z.string().min(1), referentiePatroon: z.string().min(1) })).max(3),
    vervangingsurgentie: z.array(z.object({ adId: z.string().min(1), instructie: z.string().min(1) })),
    concepten: z.array(ConceptSchema).min(3).max(6),
    productieChecklist: z.object({
      aantallenPerConceptEnPlacement: z.string().min(1),
      naamgevingsconventie: z.string().min(1), // concept-slug in de adnaam, zodat de volgende analyse herkent
      aanleverformaten: z.string().min(1),
    }),
  })
  .refine((b) => b.concepten.filter((c) => c.isExperiment).length === 1, {
    message: "de briefing bevat precies een bewust experiment (niet nul, niet twee)",
  })
  .refine((b) => b.concepten.filter((c) => !c.isExperiment).length >= 3 && b.concepten.filter((c) => !c.isExperiment).length <= 5, {
    message: "drie tot vijf bewezen concepten plus het ene experiment",
  });

export type CreativeBriefing = z.infer<typeof BriefingSchema>;

// De builder-prompt: formuleert UITSLUITEND. Elke referentie en elk getal komt uit de
// aangeleverde selectie; de route gate't de output daarnaast met containsUngroundedNumber.
export function buildBriefingPrompt(input: {
  selection: Extract<BriefingSelection, { status: "voldoende_bewijs" }>;
  brand: BriefingBrandContext;
  kop: { klant: string; periodeBasis: string; doelstelling: string; funnelfocus: string };
}): { system: string; user: string; version: string } {
  const system = `Je bent een creative strateeg. Je FORMULEERT een briefing voor designers en video-editors op basis van UITSLUITEND de aangeleverde patronen, gaps en merkcontext. REGELS: (1) elk getal in je output staat letterlijk in de input; je berekent of verzint niets; (2) elk concept refereert aan aangeleverde patroon-labels en ad-ids; (3) precies EEN concept is het experiment, draagt "onbewezen" in de naam en bouwt op de aangeleverde gap-redenatie in plaats van referentie-ads; (4) elke testhypothese heeft een guardrail-metric die verschilt van de success-metric; (5) gebruik de merkkleuren en het aangeleverde kleurpalet (hex) letterlijk; respecteer de verboden woorden; (6) antwoord UITSLUITEND met JSON conform het schema; (7) de briefing moet door een designer zonder vragen uitvoerbaar zijn: concreet, geen jargon zonder uitleg.`;

  const user = `## Kop
${JSON.stringify(input.kop)}

## Merkcontext
${JSON.stringify(input.brand)}

## Bewezen patronen (positief, gesorteerd op gewicht)
${JSON.stringify(input.selection.positives.map((s) => ({ label: `${s.pattern.attribute}=${s.pattern.value}`, metric: s.pattern.metric, liftPct: Math.round(s.pattern.liftPct * 1000) / 10, nAds: s.pattern.nAds, impressions: s.pattern.impressions })))}

## Don'ts (negatieve patronen)
${JSON.stringify(input.selection.donts.map((s) => ({ label: `${s.pattern.attribute}=${s.pattern.value}`, metric: s.pattern.metric, liftPct: Math.round(s.pattern.liftPct * 1000) / 10, nAds: s.pattern.nAds, impressions: s.pattern.impressions })))}

## Vervangingsurgentie (winnaars met fatigue)
${JSON.stringify(input.selection.replacements)}

## Het experiment-gat
${JSON.stringify(input.selection.experiment)}

Lever de volledige briefing als JSON conform het schema.`;

  return { system, user, version: BRIEFING_PROMPT_VERSION };
}
