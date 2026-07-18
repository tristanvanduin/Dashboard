// Kanaal-agnostische renderer van een DetectionResult naar een prompt-sectie, in exact hetzelfde
// format als de Google-signaalsectie (lib/analysis/signal-section.ts): getriggerde verhalen met
// zekerheidslabel + bewijs + betekenis, plus de "gecontroleerd, niet getriggerd"-lijst zodat de
// lezer weet wat onderzocht is en stil bleef. Een lege detectie geeft een LEGE sectie, zodat een
// kanaal zonder signalen de prompt byte-identiek laat (net als bij Google).

import { type DetectionResult, type SignalStory } from "./types";

export const MAX_SIGNAL_STORIES = 6;

export function renderStory(story: SignalStory): string {
  const evidence = story.evidence
    .map((e) => `${e.metric}: ${e.value}${e.prev != null ? ` (vorige periode ${e.prev})` : ""}`)
    .join("; ");
  return `- [${story.certainty}] ${story.scope}: ${story.story} Bewijs: ${evidence}. Betekenis: ${story.actionDirection}`;
}

export interface SignalSectionResult {
  section: string;
  triggeredCount: number;
  checkedIds: string[];
}

export function renderSignalSection(merged: DetectionResult, channelLabel: string): SignalSectionResult {
  const stories = merged.triggered.slice(0, MAX_SIGNAL_STORIES);
  if (stories.length === 0) {
    return { section: "", triggeredCount: 0, checkedIds: merged.checked };
  }
  const lines: string[] = [
    `## Deterministisch gedetecteerde signalen (${channelLabel})`,
    "",
    "Deze bevindingen zijn vooraf uit de ruwe data berekend. VERPLICHT: adresseer elke getriggerde bevinding in de stap waar zij thuishoort, of weerleg haar beargumenteerd; stilzwijgend negeren is een kwaliteitsfout. Neem de zekerheidslabels letterlijk over en claim nooit meer zekerheid dan het label geeft.",
    "",
    "### Getriggerde signalen",
    ...stories.map(renderStory),
    "",
    "### Gecontroleerd, niet getriggerd",
    merged.checked.filter((id) => !stories.some((s) => s.id === id)).join(", ") || "geen",
  ];
  return { section: lines.join("\n"), triggeredCount: stories.length, checkedIds: merged.checked };
}
