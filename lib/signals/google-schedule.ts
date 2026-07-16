// Diagnose-check 8 uit de metric-matrix: schedule-waste. Dagdelen waar geld heen gaat
// terwijl er niets terugkomt. Deterministisch uit ads_ad_schedule_performance, die
// day_of_week en hour_of_day draagt en die de maandroute al laadt.
//
// DRIE ONTWERPKEUZES:
// (1) Een slot telt pas als er GENOEG KLIKKEN zijn. Nul conversies op drie klikken is geen
//     verspilling maar een stil uur; nul conversies op tweehonderd klikken is een verhaal.
// (2) Aaneengesloten uren binnen dezelfde dag worden tot EEN dagdeel samengevoegd. Twaalf
//     losse uur-regels leest niemand; "zondag 02 tot 06 uur" wel.
// (3) De zekerheid blijft INDICATIE. Nul conversies in een venster kan ook
//     attributie-vertraging zijn (een klik vannacht die morgen converteert), en bij een
//     lange terugkijkperiode van de klant is dat reeel.

import { type DetectionResult, pct } from "./types";

export const WASTE_MIN_CLICKS = 25; // per slot; daaronder is nul conversies geen bewijs
export const WASTE_MIN_SHARE = 0.02; // een dagdeel telt vanaf twee procent van de accountkosten
export const MAX_WASTE_STORIES = 2;

const DAY_NAMES = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

export interface ScheduleSlotInput {
  dayOfWeek: number | string; // 0 tot 6, of de Google-naam (MONDAY)
  hourOfDay: number;
  cost: number;
  clicks: number;
  conversions: number;
}

interface Slot {
  day: number;
  hour: number;
  cost: number;
  clicks: number;
  conversions: number;
}

// Google levert day_of_week als naam (MONDAY); de sync kan ook een index doorgeven.
export function normalizeDay(value: number | string): number | null {
  if (typeof value === "number") return value >= 0 && value <= 6 ? value : null;
  const names = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const index = names.indexOf(String(value).trim().toUpperCase());
  return index >= 0 ? index : null;
}

export function dayLabel(day: number): string {
  return DAY_NAMES[day] ?? `dag ${day}`;
}

// Voegt aaneengesloten uren binnen dezelfde dag samen tot leesbare dagdelen.
export function groupConsecutive(slots: Slot[]): Array<{ day: number; fromHour: number; toHour: number; cost: number; clicks: number }> {
  const sorted = [...slots].sort((a, b) => a.day - b.day || a.hour - b.hour);
  const groups: Array<{ day: number; fromHour: number; toHour: number; cost: number; clicks: number }> = [];
  for (const slot of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.day === slot.day && slot.hour === last.toHour + 1) {
      last.toHour = slot.hour;
      last.cost += slot.cost;
      last.clicks += slot.clicks;
    } else {
      groups.push({ day: slot.day, fromHour: slot.hour, toHour: slot.hour, cost: slot.cost, clicks: slot.clicks });
    }
  }
  return groups;
}

export function detectScheduleWaste(input: ScheduleSlotInput[]): DetectionResult {
  const checked = ["schedule_waste"];
  if (input.length === 0) return { triggered: [], checked };

  const slots: Slot[] = [];
  for (const row of input) {
    const day = normalizeDay(row.dayOfWeek);
    if (day == null || !Number.isFinite(row.hourOfDay)) continue;
    slots.push({ day, hour: row.hourOfDay, cost: Math.max(row.cost, 0), clicks: Math.max(row.clicks, 0), conversions: Math.max(row.conversions, 0) });
  }
  const totalCost = slots.reduce((s, r) => s + r.cost, 0);
  const totalConversions = slots.reduce((s, r) => s + r.conversions, 0);
  // Zonder kosten valt er niets te verspillen, en zonder een enkele conversie in het hele
  // account is een nul-conversie-slot niets bijzonders: dan is er een groter probleem.
  if (totalCost <= 0 || totalConversions <= 0) return { triggered: [], checked };

  const dead = slots.filter((s) => s.conversions === 0 && s.clicks >= WASTE_MIN_CLICKS && s.cost > 0);
  if (dead.length === 0) return { triggered: [], checked };

  const groups = groupConsecutive(dead)
    .filter((g) => g.cost / totalCost >= WASTE_MIN_SHARE)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, MAX_WASTE_STORIES);
  if (groups.length === 0) return { triggered: [], checked };

  return {
    triggered: groups.map((g) => {
      const window = g.fromHour === g.toHour ? `${String(g.fromHour).padStart(2, "0")} uur` : `${String(g.fromHour).padStart(2, "0")} tot ${String(g.toHour + 1).padStart(2, "0")} uur`;
      const share = g.cost / totalCost;
      return {
        id: "schedule_waste",
        category: "budget_pacing" as const,
        scope: `${dayLabel(g.day)} ${window}`,
        story: `In dit dagdeel ging ${g.cost.toFixed(2)} aan kosten (${pct(share)} van het accounttotaal) naar ${g.clicks} klikken zonder een enkele conversie, terwijl het account in dezelfde periode wel converteert. Let op: een lange conversie-terugkijkperiode kan nachtelijke klikken later alsnog toeschrijven.`,
        actionDirection: "toets de biedaanpassing of uitsluiting voor dit dagdeel tegen de conversie-terugkijkperiode van de klant voordat je het dichtzet",
        certainty: "indicatie" as const,
        evidence: [
          { metric: "kosten", value: Math.round(g.cost * 100) / 100 },
          { metric: "kostenaandeel", value: Math.round(share * 1000) / 1000 },
          { metric: "klikken", value: g.clicks },
          { metric: "conversies", value: 0 },
        ],
      };
    }),
    checked,
  };
}
