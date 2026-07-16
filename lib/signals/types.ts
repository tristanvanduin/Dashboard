// Het signaal-engine-frame: de gedeelde vorm voor alle signaalverhalen (zie
// SIGNAALVERHALEN_bibliotheek.md). Een verhaal is een deterministische trigger over meerdere
// metrics plus de menselijke diagnose. Detectors leveren de GETRIGGERDE verhalen met hun
// evidence, en daarnaast de lijst van gecheckte verhalen: de SOP en de knop tonen zo ook wat
// onderzocht is en stil bleef, want "niets gevonden" is alleen geruststellend als je weet
// wat er gezocht is. Platformbreed; de categorie-modules vullen dit frame.

export type SignalCategory =
  | "veiling_concurrentie"
  | "zichtbaarheid_vraag"
  | "kwaliteit"
  | "creative"
  | "conversie_meting"
  | "budget_pacing"
  | "zoektermen_intentie"
  | "cross_channel";

// Bewezen binnen platform: de metrics van het eigen kanaal dragen het verhaal volledig.
// Indicatie: het verhaal is aannemelijk maar een bevestigingsbron ontbreekt.
// Verklaringskandidaat: cross-channel correlatie plus timing; consistent met, nooit bewezen.
export type SignalCertainty = "bewezen_binnen_platform" | "indicatie" | "verklaringskandidaat";

export interface SignalEvidence {
  metric: string;
  value: number | string;
  prev?: number | string | null;
}

export interface SignalStory {
  id: string;
  category: SignalCategory;
  scope: string; // waar het verhaal over gaat: een campagne, het account, een kanaal
  story: string; // de menselijke diagnose in een of twee zinnen
  actionDirection: string; // wat dit betekent, of expliciet: geen actie, extern
  certainty: SignalCertainty;
  evidence: SignalEvidence[];
}

export interface DetectionResult {
  triggered: SignalStory[];
  checked: string[]; // de ids van alle verhalen die deze detector heeft onderzocht
}

// Hulpfuncties die elke detector nodig heeft.

export function relDelta(now: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((now - prev) / prev) * 1000) / 1000;
}

export function pct(v: number): string {
  return `${Math.round(v * 1000) / 10}%`;
}

export function mergeDetections(results: DetectionResult[]): DetectionResult {
  return {
    triggered: results.flatMap((r) => r.triggered),
    checked: [...new Set(results.flatMap((r) => r.checked))],
  };
}
