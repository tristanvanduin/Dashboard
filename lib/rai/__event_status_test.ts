// Test voor de R1 status- en pacing-laag. Deterministisch, geen IO.
// Draaien: npx tsx lib/rai/__event_status_test.ts

import { streamStatusFromForecast, budgetPacing, CRITICAL_THRESHOLD, PACING_BAND } from "./event-status";
import type { StreamForecast } from "./event-forecast";
import type { Edition } from "./event-time-axis";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function fc(pct: number | null, confidence: StreamForecast["confidence"] = "gemiddeld"): StreamForecast {
  return { method: "vorige_editie_sjabloon", daysToFairNow: 15, currentCumulative: 100, projectedFinal: pct == null ? null : 100, target: 100, projectedVsTargetPct: pct, willHitTarget: pct == null ? null : pct >= 1, confidence, note: "" };
}

// ── Stream-stoplicht uit de forecast ──
assert(streamStatusFromForecast(fc(1.09)).status === "op_koers", "projectie boven target: op koers");
assert(streamStatusFromForecast(fc(1.0)).status === "op_koers", "projectie precies op target: op koers");
assert(streamStatusFromForecast(fc(0.92)).status === "aandacht", "projectie tussen 0,85 en 1,0: aandacht");
assert(streamStatusFromForecast(fc(0.7)).status === "kritiek", "projectie ver onder target: kritiek");
assert(streamStatusFromForecast(fc(null)).status === "onbekend", "geen projectie of target: onbekend");
assert(streamStatusFromForecast(fc(0.84)).status === "kritiek" && streamStatusFromForecast(fc(0.85)).status === "aandacht", "de grens ligt op 0,85");

// ── Guard: kritiek uit een lage-zekerheid forecast wordt aandacht ──
const laagKritiek = streamStatusFromForecast({ ...fc(0.6), method: "tempo_extrapolatie", confidence: "laag" });
assert(laagKritiek.status === "aandacht" && laagKritiek.reason.includes("onzekere tempo-extrapolatie"), "een kritiek-oordeel uit een onzekere tempo-forecast wordt afgezwakt naar aandacht met uitleg");
// Maar een lage-zekerheid die WEL op koers is blijft op koers
assert(streamStatusFromForecast({ ...fc(1.1), confidence: "laag" }).status === "op_koers", "lage zekerheid maar boven target blijft op koers");
// En een gemiddelde zekerheid die kritiek is blijft kritiek
assert(streamStatusFromForecast(fc(0.6, "gemiddeld")).status === "kritiek", "kritiek met gemiddelde zekerheid blijft kritiek");

// ── Budget-pacing ──
// Venster van 40 dagen: campagnestart 1 maart, beurs 10 april.
const ed: Edition = { editionId: "e", campaignStartDate: "2026-03-01", fairStartDate: "2026-04-10", fairEndDate: "2026-04-12" };
// Op D-20 (21 maart) is 20/40 = 50% van het venster verstreken. Gepland totaal 10000, dus tot nu 5000.
const opPace = budgetPacing({ edition: ed, plannedTotalBudget: 10000, actualSpendToDate: 5100, asOfDate: "2026-03-21" });
assert(opPace.plannedToDate === 5000 && opPace.status === "op_pace", "op D-20 met de helft besteed volgens plan: op pace");
const over = budgetPacing({ edition: ed, plannedTotalBudget: 10000, actualSpendToDate: 7000, asOfDate: "2026-03-21" });
assert(over.status === "overbesteding" && over.reason.includes("op"), "veel meer dan gepland besteed: overbesteding");
const onder = budgetPacing({ edition: ed, plannedTotalBudget: 10000, actualSpendToDate: 3000, asOfDate: "2026-03-21" });
assert(onder.status === "onderbesteding" && onder.reason.includes("blijft budget liggen"), "veel minder dan gepland: onderbesteding");

// Binnen de band blijft op pace: 5000 gepland, 5400 werkelijk = ratio 1,08 < 1,1
assert(budgetPacing({ edition: ed, plannedTotalBudget: 10000, actualSpendToDate: 5400, asOfDate: "2026-03-21" }).status === "op_pace", "binnen 10 procent van het plan is op pace");

// Zonder gepland budget: onbekend
assert(budgetPacing({ edition: ed, plannedTotalBudget: null, actualSpendToDate: 5000, asOfDate: "2026-03-21" }).status === "onbekend", "zonder gepland budget: onbekend");

// Voorbij de beurs: alles gepland verstreken
const naBeurs = budgetPacing({ edition: ed, plannedTotalBudget: 10000, actualSpendToDate: 9500, asOfDate: "2026-04-20" });
assert(naBeurs.plannedToDate === 10000, "na de beurs is het volledige geplande budget verstreken");

assert(CRITICAL_THRESHOLD === 0.85 && PACING_BAND === 0.1, "de drempels staan op 0,85 en een pacing-band van 10 procent");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
