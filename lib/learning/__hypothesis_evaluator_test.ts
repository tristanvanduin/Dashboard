// Verificatie van de H1 deterministische kern.
// Draaien: npx tsx lib/learning/__hypothesis_evaluator_test.ts

import { evaluateHypothesisOutcome, detectExecution, type Predicate, type ChangeEvent } from "./hypothesis-evaluator";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const cvrUp: Predicate = { metric: "CVR", direction: "increase" };
const cpaSafe: Predicate = { metric: "CPA", direction: "below", threshold: 20 };
const base = { active: true, impressions: 500, age: 16 };

function ev(opts: Partial<Parameters<typeof evaluateHypothesisOutcome>[0]> & { baseline: Record<string, number>; measured: Record<string, number> }) {
  return evaluateHypothesisOutcome({
    successPredicates: opts.successPredicates ?? [cvrUp],
    guardrailPredicates: opts.guardrailPredicates ?? [cpaSafe],
    baseline: opts.baseline,
    measured: opts.measured,
    windowImpressions: opts.windowImpressions ?? base.impressions,
    entityActive: opts.entityActive ?? base.active,
    ageInDays: opts.ageInDays ?? base.age,
  });
}

console.log("De vier verdicts");
check("accepted: success gehaald, guardrail veilig",
  ev({ baseline: { CVR: 2, CPA: 15 }, measured: { CVR: 3, CPA: 18 } }).verdict === "accepted");
check("rejected: success faalt (CVR daalt)",
  ev({ baseline: { CVR: 2, CPA: 15 }, measured: { CVR: 1.5, CPA: 14 } }).verdict === "rejected");
check("rejected: guardrail-schending wint van gehaalde success",
  ev({ baseline: { CVR: 2, CPA: 15 }, measured: { CVR: 3, CPA: 25 } }).verdict === "rejected");
check("unmeasurable: volume te laag",
  ev({ baseline: { CVR: 2, CPA: 15 }, measured: { CVR: 3, CPA: 18 }, windowImpressions: 50 }).verdict === "unmeasurable");
check("unmeasurable: entiteit gepauzeerd",
  ev({ baseline: { CVR: 2, CPA: 15 }, measured: { CVR: 3, CPA: 18 }, entityActive: false }).verdict === "unmeasurable");
check("unmeasurable: success-metric ontbreekt",
  ev({ successPredicates: [{ metric: "ROAS", direction: "increase" }], baseline: { CPA: 15 }, measured: { CPA: 18 } }).verdict === "unmeasurable");
check("expired: onmeetbaar en ouder dan 45 dagen",
  ev({ baseline: { CVR: 2, CPA: 15 }, measured: { CVR: 3, CPA: 18 }, windowImpressions: 50, ageInDays: 60 }).verdict === "expired");

console.log("\nPredicaatrichtingen");
check("increase met drempel: delta >= drempel",
  ev({ successPredicates: [{ metric: "CVR", direction: "increase", threshold: 1 }], guardrailPredicates: [], baseline: { CVR: 2 }, measured: { CVR: 3.2 } }).verdict === "accepted");
check("increase met drempel: delta te klein verwerpt",
  ev({ successPredicates: [{ metric: "CVR", direction: "increase", threshold: 1 }], guardrailPredicates: [], baseline: { CVR: 2 }, measured: { CVR: 2.3 } }).verdict === "rejected");
check("decrease met drempel: daling groot genoeg",
  ev({ successPredicates: [{ metric: "CPA", direction: "decrease", threshold: 5 }], guardrailPredicates: [], baseline: { CPA: 30 }, measured: { CPA: 24 } }).verdict === "accepted");
check("below: gemeten onder grens",
  ev({ successPredicates: [{ metric: "CPA", direction: "below", threshold: 20 }], guardrailPredicates: [], baseline: { CPA: 30 }, measured: { CPA: 18 } }).verdict === "accepted");
check("above: gemeten boven grens",
  ev({ successPredicates: [{ metric: "ROAS", direction: "above", threshold: 4 }], guardrailPredicates: [], baseline: { ROAS: 3 }, measured: { ROAS: 4.5 } }).verdict === "accepted");
check("stable: binnen band geaccepteerd",
  ev({ successPredicates: [{ metric: "CPA", direction: "stable" }], guardrailPredicates: [], baseline: { CPA: 100 }, measured: { CPA: 103 } }).verdict === "accepted");
check("stable: buiten band verworpen",
  ev({ successPredicates: [{ metric: "CPA", direction: "stable" }], guardrailPredicates: [], baseline: { CPA: 100 }, measured: { CPA: 130 } }).verdict === "rejected");

console.log("\nOutcome-detail klopt");
const out = ev({ baseline: { CVR: 2, CPA: 15 }, measured: { CVR: 3, CPA: 18 } });
const cvrJ = out.metrics.find((m) => m.metric === "CVR");
check("CVR-judgment heeft baseline, gemeten, delta", cvrJ?.baseline === 2 && cvrJ?.measured === 3 && cvrJ?.delta === 1 && cvrJ?.met === true);
const cpaJ = out.metrics.find((m) => m.metric === "CPA");
check("CPA-guardrail gemarkeerd als guardrail en gehaald", cpaJ?.kind === "guardrail" && cpaJ?.met === true);

console.log("\nUitvoeringsdetectie");
const events: ChangeEvent[] = [
  { type: "budget", entity: "Campagne X", date: "2026-03-05" },
  { type: "bid", entity: "Campagne Y", date: "2026-03-06" },
];
check("budget-event matcht 'verhoog dagbudget' op dezelfde campagne",
  detectExecution("Verhoog het dagbudget van Campagne X", "Campagne X", events, true).status === "detected");
check("evidence vermeldt het event",
  (detectExecution("Verhoog het dagbudget van Campagne X", "Campagne X", events, true).evidence ?? "").includes("budget"));
check("geen match op de entiteit met dekking geeft not_executed",
  detectExecution("Pauzeer Campagne Z", "Campagne Z", events, true).status === "not_executed");
check("event op andere entiteit telt niet",
  detectExecution("Verhoog het dagbudget van Campagne Q", "Campagne Q", events, true).status === "not_executed");
check("zonder dekking altijd unknown",
  detectExecution("Verhoog het dagbudget van Campagne X", "Campagne X", events, false).status === "unknown");
check("interventie zonder herkenbaar type valt terug op elke wijziging op de entiteit",
  detectExecution("Herzie de structuur van Campagne X", "Campagne X", events, true).status === "detected");

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
