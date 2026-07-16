// Test voor de schedule-waste-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__google_schedule_test.ts

import { detectScheduleWaste, normalizeDay, dayLabel, groupConsecutive, WASTE_MIN_CLICKS, MAX_WASTE_STORIES, type ScheduleSlotInput } from "./google-schedule";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function slot(day: number | string, hour: number, cost: number, clicks: number, conversions: number): ScheduleSlotInput {
  return { dayOfWeek: day, hourOfDay: hour, cost, clicks, conversions };
}

// Een gezond account: maandag overdag converteert het gewoon.
const gezond = [slot(1, 9, 500, 200, 20), slot(1, 10, 500, 200, 20)];

// ── De dag-normalisatie ──
assert(normalizeDay("MONDAY") === 1 && normalizeDay("sunday") === 0 && normalizeDay(6) === 6, "de dag komt binnen als Google-naam of als index");
assert(normalizeDay("GISTEREN") === null && normalizeDay(9) === null, "onzin degradeert naar null in plaats van naar dag nul");
assert(dayLabel(0) === "zondag" && dayLabel(5) === "vrijdag", "de labels zijn Nederlands");

// ── Het groeperen ──
const groepen = groupConsecutive([
  { day: 0, hour: 2, cost: 10, clicks: 30, conversions: 0 },
  { day: 0, hour: 3, cost: 10, clicks: 30, conversions: 0 },
  { day: 0, hour: 4, cost: 10, clicks: 30, conversions: 0 },
  { day: 0, hour: 8, cost: 10, clicks: 30, conversions: 0 },
  { day: 1, hour: 5, cost: 10, clicks: 30, conversions: 0 },
]);
assert(groepen.length === 3, "aaneengesloten uren worden een dagdeel, een gat breekt de reeks, en een daggrens ook");
assert(groepen[0].fromHour === 2 && groepen[0].toHour === 4 && groepen[0].cost === 30, "het samengevoegde dagdeel telt de kosten op");
assert(groepen[1].fromHour === 8 && groepen[1].toHour === 8, "een los uur blijft een los uur");
assert(groepen[2].day === 1, "uur 5 op de volgende dag hoort niet bij uur 8 van de vorige");

// ── Het volledige patroon ──
const nacht = [
  ...gezond,
  slot("SUNDAY", 2, 60, 40, 0),
  slot("SUNDAY", 3, 60, 40, 0),
  slot("SUNDAY", 4, 60, 40, 0),
];
const gevonden = detectScheduleWaste(nacht);
assert(gevonden.triggered.length === 1, "een dagdeel met kosten en klikken maar nul conversies triggert");
const verhaal = gevonden.triggered[0];
assert(verhaal.scope === "zondag 02 tot 05 uur", "het dagdeel wordt leesbaar benoemd met een eind-uur dat het laatste uur insluit");
assert(verhaal.story.includes("180.00") && verhaal.story.includes("120 klikken"), "het verhaal draagt de opgetelde kosten en klikken");
assert(verhaal.story.includes("terugkijkperiode"), "het verhaal noemt de attributie-vertraging: nachtelijke klikken kunnen later alsnog toeschrijven");
assert(verhaal.actionDirection.includes("voordat je het dichtzet"), "de actie adviseert niet blind uitsluiten maar eerst toetsen");
assert(verhaal.certainty === "indicatie", "de zekerheid blijft indicatie vanwege diezelfde attributie-vraag");
assert(verhaal.evidence.some((e) => e.metric === "kostenaandeel"), "het bewijs draagt het aandeel, zodat de vondst op waarde te schatten is");

// ── De klik-drempel ──
const stilUur = detectScheduleWaste([...gezond, slot(0, 3, 200, WASTE_MIN_CLICKS - 1, 0)]);
assert(stilUur.triggered.length === 0, `onder ${WASTE_MIN_CLICKS} klikken is nul conversies geen bewijs maar een stil uur`);

// ── De materialiteit ──
const kruimel = detectScheduleWaste([slot(1, 9, 10000, 500, 50), slot(0, 3, 50, 40, 0)]);
assert(kruimel.triggered.length === 0, "een half procent van de kosten is geen verhaal, ook al converteert het niet");

// ── De degradaties ──
assert(detectScheduleWaste([]).triggered.length === 0 && detectScheduleWaste([]).checked.length === 1, "een leeg account degradeert netjes en meldt wel dat er gecontroleerd is");
const nergensConversies = detectScheduleWaste([slot(1, 9, 500, 200, 0), slot(0, 3, 500, 200, 0)]);
assert(nergensConversies.triggered.length === 0, "als het account NERGENS converteert is een nul-slot niets bijzonders: dan is er een groter probleem dan het schema");
assert(detectScheduleWaste([slot(1, 9, 0, 0, 0)]).triggered.length === 0, "zonder kosten valt er niets te verspillen");

// ── De begrenzing ──
const veel = detectScheduleWaste([
  ...gezond,
  slot(0, 2, 100, 40, 0), slot(1, 2, 90, 40, 0), slot(2, 2, 80, 40, 0), slot(3, 2, 70, 40, 0),
]);
assert(veel.triggered.length === MAX_WASTE_STORIES, "de sectie blijft leesbaar: maximaal twee dagdelen");
assert(veel.triggered[0].scope.startsWith("zondag"), "het duurste dagdeel staat vooraan");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
