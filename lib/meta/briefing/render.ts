// M4 render: de markdown-deliverable, puur en deterministisch op de gevalideerde briefing.
// Bevat per concept de designer-prompt-set (de nieuwe feature) zodat de content-marketeer
// direct kan genereren. De PDF in de huisstijl is bewust build-kant-rest: er is geen
// bestaande PDF-renderer als bibliotheek in de codebase; markdown is de deliverable v1 en
// wordt als sectie sop_type meta_briefing opgeslagen naast de monthly.

import type { CreativeBriefing } from "./schema";
import type { BriefingSelection } from "./selection";
import { buildDesignerPromptSet, type DesignerPrompt } from "./designer-prompt";
import type { BriefingBrandContext } from "@/lib/branding/brand-guide";

function designerBlock(prompts: DesignerPrompt[]): string {
  return prompts
    .map((p) => `**${p.ratio}** (${p.label})\n\n- Prompt: ${p.positive}\n- Negative: ${p.negative}\n- Midjourney: voeg \`${p.midjourneySuffix.trim()}\` toe`)
    .join("\n\n");
}

export function renderBriefingMarkdown(briefing: CreativeBriefing, brand: BriefingBrandContext): string {
  const lines: string[] = [];
  lines.push(`# Creative briefing: ${briefing.kop.klant}`);
  lines.push("");
  lines.push(`Periode-basis: ${briefing.kop.periodeBasis}. Doelstelling: ${briefing.kop.doelstelling}. Funnelfocus: ${briefing.kop.funnelfocus}.`);
  lines.push("");

  lines.push("## Wat werkt en waarom");
  lines.push("");
  for (const w of briefing.watWerkt) lines.push(`- ${w.richtlijn} [patroon: ${w.referentiePatroon}]`);
  if (briefing.donts.length > 0) {
    lines.push("");
    lines.push("**Don'ts**");
    for (const d of briefing.donts) lines.push(`- ${d.richtlijn} [patroon: ${d.referentiePatroon}]`);
  }
  lines.push("");

  if (briefing.vervangingsurgentie.length > 0) {
    lines.push("## Vervangingsurgentie");
    lines.push("");
    for (const v of briefing.vervangingsurgentie) lines.push(`- Ad ${v.adId}: ${v.instructie}`);
    lines.push("");
  }

  lines.push("## Concepten");
  lines.push("");
  for (const [index, concept] of briefing.concepten.entries()) {
    const label = concept.isExperiment ? " [ONBEWEZEN TEST]" : "";
    lines.push(`### ${index + 1}. ${concept.naam}${label}`);
    lines.push("");
    lines.push(`Doel en funnelfase: ${concept.doelEnFunnelfase}. Format: ${concept.format}, ${concept.aantalVarianten} varianten.`);
    lines.push("");
    lines.push(`Hook: ${concept.hook}`);
    lines.push("");
    lines.push(`Visuele richting: ${concept.visueleRichting.stijl}; ${concept.visueleRichting.mensProduct}; compositie ${concept.visueleRichting.compositie}; kleurpalet ${concept.visueleRichting.kleurpaletHex.join(", ")}.`);
    lines.push("");
    lines.push(`Specs: 1:1 ${concept.specs.ratio_1_1} | 4:5 ${concept.specs.ratio_4_5} | 9:16 ${concept.specs.ratio_9_16}`);
    lines.push("");
    lines.push(`Tekst-overlay: ${concept.tekstOverlay.gebruiken ? `ja, maximaal ${concept.tekstOverlay.maxDekkingPct}% dekking, ${concept.tekstOverlay.leesbaarheidEis}` : "nee"}.`);
    lines.push("");
    lines.push(`Copy en CTA: ${concept.copyRichtingEnCta}`);
    lines.push("");
    if (concept.isExperiment) {
      lines.push(`Waarom dit experiment: ${concept.experimentRedenatie}`);
    } else {
      lines.push(`Referenties: ads ${concept.referentieAds.join(", ")}; patronen ${concept.referentiePatronen.join(", ")}.`);
    }
    lines.push("");
    lines.push(`Testhypothese: ${concept.testhypothese.verwachting}. Success: ${concept.testhypothese.successMetric}; guardrail: ${concept.testhypothese.guardrailMetric}; venster ${concept.testhypothese.meetvensterDagen} dagen. Accepteer bij: ${concept.testhypothese.accept}. Verwerp bij: ${concept.testhypothese.reject}.`);
    lines.push("");
    lines.push("**Designer-prompts (genAI, deterministisch uit de winnaar-attributen)**");
    lines.push("");
    lines.push(
      designerBlock(
        buildDesignerPromptSet(
          {
            conceptNaam: concept.naam,
            stijl: concept.visueleRichting.stijl,
            mensProduct: concept.visueleRichting.mensProduct,
            compositie: concept.visueleRichting.compositie,
            hook: concept.hook,
            kleurpaletHex: concept.visueleRichting.kleurpaletHex,
            isExperiment: concept.isExperiment,
          },
          brand
        )
      )
    );
    lines.push("");
  }

  lines.push("## Productie-checklist");
  lines.push("");
  lines.push(`- Aantallen: ${briefing.productieChecklist.aantallenPerConceptEnPlacement}`);
  lines.push(`- Naamgeving: ${briefing.productieChecklist.naamgevingsconventie}`);
  lines.push(`- Aanleverformaten: ${briefing.productieChecklist.aanleverformaten}`);
  lines.push("");

  return lines.join("\n");
}

// Het eerlijke insufficient-data-pad: een pagina, geen concepten, wel wat er nodig is en
// het ene generieke best-practice-experiment, duidelijk gelabeld.
export function renderInsufficientMarkdown(
  selection: Extract<BriefingSelection, { status: "onvoldoende_bewijs" }>,
  kop: { klant: string; periodeBasis: string }
): string {
  const lines: string[] = [];
  lines.push(`# Creative briefing: ${kop.klant}`);
  lines.push("");
  lines.push(`Periode-basis: ${kop.periodeBasis}.`);
  lines.push("");
  lines.push("## Nog onvoldoende creative-bewijs");
  lines.push("");
  lines.push(selection.needed);
  lines.push("");
  if (selection.replacements.length > 0) {
    lines.push("## Wel al urgent: vervanging");
    lines.push("");
    for (const r of selection.replacements) lines.push(`- Ad ${r.adId}: ${r.reason}; vervang met 2 varianten op hetzelfde concept.`);
    lines.push("");
  }
  lines.push("## Een generiek experiment om alvast te draaien [ONBEWEZEN TEST, best practice]");
  lines.push("");
  lines.push(
    "UGC-stijl video met een gezicht en oogcontact in de eerste seconde, product in hand, een leesbare kop van maximaal vijf woorden. Twee varianten in 9:16 en 4:5, tekst en logo buiten de safe zones. Meet 14 dagen op hook rate met CPA als guardrail. Dit is een branchebrede best practice, geen accountbewijs; behandel de uitkomst als de eerste eigen datapunten."
  );
  lines.push("");
  return lines.join("\n");
}
