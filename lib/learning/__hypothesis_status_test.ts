// Test voor de beslis-kern van hypotheses. Deterministisch, geen IO.
// Draaien: npx tsx lib/learning/__hypothesis_status_test.ts

import { decideTransition, isActionable, isHypothesisStatus, HYPOTHESIS_STATUSES } from "./hypothesis-status";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const NU = "2026-07-15T10:00:00.000Z";
const van = (status: string | null, accepted_at: string | null = null) => ({ status, accepted_at });

// ── De toegestane overgangen ──
const aangenomen = decideTransition({ current: van("pending"), next: "accepted", now: NU });
assert(aangenomen.ok && aangenomen.patch.status === "accepted", "een voorstel kan aangenomen worden");
assert(aangenomen.ok && aangenomen.patch.accepted_at === NU, "de acceptatie zet accepted_at: het startpunt van het meetvenster");

const afgewezen = decideTransition({ current: van("pending"), next: "rejected", reason: "budget ontbreekt dit kwartaal", now: NU });
assert(afgewezen.ok && afgewezen.patch.status === "rejected" && afgewezen.patch.decision_reason === "budget ontbreekt dit kwartaal", "een voorstel kan afgewezen worden met een reden");
assert(afgewezen.ok && !("rationale" in afgewezen.patch), "de patch raakt rationale NIET aan: die kolom draagt de onderbouwing van het voorstel en mag niet gewist worden door een beslissing");
assert(afgewezen.ok && afgewezen.patch.decided_at === NU, "elke beslissing legt vast wanneer hij genomen is");
assert(afgewezen.ok && afgewezen.patch.accepted_at === undefined, "een afwijzing zet GEEN accepted_at");

const afgerond = decideTransition({ current: van("accepted", NU), next: "completed", now: "2026-08-01T10:00:00.000Z" });
assert(afgerond.ok && afgerond.patch.status === "completed", "een aangenomen hypothese kan afgerond worden");
assert(afgerond.ok && afgerond.patch.accepted_at === undefined, "afronden raakt accepted_at NIET aan: het meetvenster houdt zijn vaste startpunt");

const bedacht = decideTransition({ current: van("accepted", NU), next: "rejected", reason: "voortschrijdend inzicht", by: "tristan", now: NU });
assert(bedacht.ok, "een aangenomen hypothese mag alsnog afgewezen worden");
assert(bedacht.ok && bedacht.patch.decided_by === "tristan", "de beslisser wordt vastgelegd als hij is meegegeven");

// ── De weigeringen ──
// Dezelfde status opnieuw is idempotent, want de bestaande route herpusht bij een tweede
// accept bewust de gekoppelde taken. De KERN van de bugfix zit in accepted_at.
const zelfde = decideTransition({ current: van("accepted", "2026-07-01T09:00:00.000Z"), next: "accepted", now: NU });
assert(zelfde.ok && zelfde.idempotent, "dezelfde status opnieuw zetten mag: een tweede accept herpusht bewust de taken");
assert(zelfde.ok && zelfde.patch.accepted_at === undefined, "DE BUGFIX: een tweede accept schrijft accepted_at NIET opnieuw, anders verschuift het meetvenster van de evaluator");
assert(aangenomen.ok && !aangenomen.idempotent, "de echte overgang is niet idempotent");

const heropend = decideTransition({ current: van("rejected"), next: "accepted", now: NU });
assert(!heropend.ok && heropend.reason.includes("eindtoestand"), "een afgewezen hypothese kan niet heropend worden; maak een nieuwe");
assert(!decideTransition({ current: van("completed"), next: "accepted", now: NU }).ok, "afgerond is ook een eindtoestand");

const overslaan = decideTransition({ current: van("pending"), next: "completed", now: NU });
assert(!overslaan.ok && overslaan.reason.includes("alleen naar accepted of rejected"), "een voorstel kan niet afgerond worden zonder eerst aangenomen te zijn");

const zonderReden = decideTransition({ current: van("pending"), next: "rejected", now: NU });
assert(!zonderReden.ok && zonderReden.reason.includes("vereist een reden"), "een afwijzing zonder reden is geen beslissing maar een klik");
assert(!decideTransition({ current: van("pending"), next: "rejected", reason: "   ", now: NU }).ok, "witruimte is geen reden");

const onbekend = decideTransition({ current: van("kwijt"), next: "accepted", now: NU });
assert(!onbekend.ok && onbekend.reason.includes("onbekend"), "een onbekende huidige status degradeert eerlijk in plaats van te raden");

// ── De default ──
const zonderStatus = decideTransition({ current: van(null), next: "accepted", now: NU });
assert(zonderStatus.ok, "een lege status telt als pending, conform de kolomdefault");

// ── De guard voor SI5 ──
assert(isActionable("accepted") && !isActionable("pending") && !isActionable("rejected") && !isActionable(null), "alleen een aangenomen hypothese is actionable; dat is de SI5-gate");
assert(isHypothesisStatus("accepted") && !isHypothesisStatus("verzonnen") && HYPOTHESIS_STATUSES.length === 4, "de statuslijst is gesloten");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
