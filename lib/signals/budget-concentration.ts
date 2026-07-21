// Budget-concentratie: stapelt het budget in één entiteit (campagne/adset), en presteert die
// dan ook? Twee risico's die geen creative-detector vangt: (1) het budget concentreert in een
// ONDERpresteerder — waste-at-scale; (2) het budget hangt voor het gros aan één entiteit —
// een single-point-of-failure, los van de efficiëntie. Kanaal-agnostisch: Meta en LinkedIn
// voeden dezelfde detector met hun campagne/adset-totalen. Ratio's uit periodetotalen,
// drempels op volume; eigen-platform-rekenkunde. Puur, los getest.

import { type DetectionResult, type SignalStory, type SignalEvidence } from "./types";

export interface BudgetEntityRow {
  name: string;
  spend: number;
  conversions: number;
}

export const CONC_MIN_ENTITIES = 3;            // onder dit aantal is "concentratie" betekenisloos
export const CONC_MIN_TOTAL_CONVERSIONS = 10;  // minimaal volume om CPA's te vergelijken
export const CONC_TOP_SHARE = 0.5;             // top-entiteit draagt >= 50% van de spend
export const CONC_CPA_MULT = 1.3;              // en converteert >= 1,3× de gemiddelde CPA => waste-at-scale
export const CONC_RISK_SHARE = 0.65;           // >= 65% in één entiteit => concentratierisico (ongeacht CPA)

const eurS = (v: number | null): string => (v == null || !Number.isFinite(v) ? "n.v.t." : `€${Math.round(v * 100) / 100}`);
const pctI = (v: number): string => `${Math.round(v * 100)}%`;
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });

export function buildBudgetConcentrationSignals(entities: BudgetEntityRow[], opts: { channelLabel: string; idPrefix: string }): DetectionResult {
  const id = `${opts.idPrefix}_concentratie`;
  const active = entities.filter((e) => e.spend > 0);
  const totalSpend = active.reduce((s, e) => s + e.spend, 0);
  const totalConv = active.reduce((s, e) => s + e.conversions, 0);
  if (active.length < CONC_MIN_ENTITIES || totalSpend <= 0 || totalConv < CONC_MIN_TOTAL_CONVERSIONS) {
    return { triggered: [], checked: [id] };
  }

  const sorted = [...active].sort((a, b) => b.spend - a.spend);
  const top = sorted[0];
  const topShare = top.spend / totalSpend;
  const accountCpa = div(totalSpend, totalConv)!;
  const topCpa = div(top.spend, top.conversions);

  // (1) Concentratie in een onderpresteerder: veel budget, slechtere CPA dan het gemiddelde.
  if (topShare >= CONC_TOP_SHARE && (topCpa == null || topCpa >= accountCpa * CONC_CPA_MULT)) {
    const cpaText = topCpa == null
      ? `converteert niet (geen conversies)`
      : `converteert tegen ${eurS(topCpa)} CPA — ${Math.round((topCpa / accountCpa) * 10) / 10}× het ${opts.channelLabel}-gemiddelde (${eurS(accountCpa)})`;
    return {
      triggered: [{
        id: `${opts.idPrefix}_concentratie_onderpresteerder`,
        category: "budget_pacing",
        scope: top.name,
        story: `Op ${opts.channelLabel} draagt '${top.name}' ${pctI(topShare)} van de spend maar ${cpaText}: het budget stapelt in een onderpresteerder.`,
        actionDirection: `verlaag het budgetaandeel van '${top.name}' en herverdeel naar de efficiëntere campagnes, of onderzoek waarom deze zoveel budget trekt bij een slechtere CPA`,
        certainty: "bewezen_binnen_platform",
        evidence: [
          ev("entiteit", top.name),
          ev("spend-aandeel", pctI(topShare)),
          ev("CPA", topCpa == null ? "geen conversies" : eurS(topCpa)),
          ev(`${opts.channelLabel}-gemiddelde CPA`, eurS(accountCpa)),
        ],
      }],
      checked: [id],
    };
  }

  // (2) Concentratierisico: het gros hangt aan één entiteit, ongeacht de efficiëntie.
  if (topShare >= CONC_RISK_SHARE) {
    return {
      triggered: [{
        id: `${opts.idPrefix}_concentratie_risico`,
        category: "budget_pacing",
        scope: top.name,
        story: `Op ${opts.channelLabel} hangt ${pctI(topShare)} van de spend aan één entiteit ('${top.name}'): een single-point-of-failure — als die verzadigt of wegvalt, valt het gros van het resultaat weg.`,
        actionDirection: `overweeg te diversifiëren (extra campagnes/adsets of doelgroepen) zodat het resultaat niet aan één entiteit hangt; dit is een risico-, geen efficiëntie-signaal`,
        certainty: "indicatie",
        evidence: [ev("entiteit", top.name), ev("spend-aandeel", pctI(topShare)), ev("CPA", eurS(topCpa))],
      }],
      checked: [id],
    };
  }

  return { triggered: [], checked: [id] };
}
