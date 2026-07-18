// Zelf-draaiende test voor de geo-clone-instellingen-resolver (Fase 2). Draait via tsx.
// Kern: override wint als het veld écht ingevuld is; anders erft de waarde van het account, en
// de inherited-vlag klopt. Geldt voor branding (strings), doelen (getallen > 0) en event.

import {
  resolveGeoCloneSettings,
  resolveBranding,
  resolveGoals,
  resolveEvent,
  type AccountSettings,
} from "./geo-clone-settings";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const account: AccountSettings = {
  branding: { brandName: "RAI", primaryColor: "#08288C", accentColor: "#F16B37", secondaryColor: null, logoUrl: "https://acc/logo.png", headingFont: "Gilroy" },
  goals: { conversionsAbsolute: 5000, revenueAbsolute: 150000, roasTarget: 5, cpaTarget: 20 },
  event: { cadence: "annual", editions: [{ date: "2025-06-01", label: "2025" }] },
};

console.log("branding: override wint als ingevuld, anders erven:");
const b = resolveBranding(account.branding, { primaryColor: "#123456", brandName: "  ", logoUrl: null });
assert(b.effective.primaryColor === "#123456" && b.inherited.primaryColor === false, "ingevulde primaire kleur overschrijft");
assert(b.effective.brandName === "RAI" && b.inherited.brandName === true, "lege (whitespace) merknaam erft van account");
assert(b.effective.logoUrl === "https://acc/logo.png" && b.inherited.logoUrl === true, "null logo erft van account");
assert(b.effective.accentColor === "#F16B37" && b.inherited.accentColor === true, "ontbrekende accentkleur erft van account");

console.log("doelen: alleen getallen > 0 overschrijven:");
const g = resolveGoals(account.goals, { roasTarget: 8, conversionsAbsolute: 0, cpaTarget: undefined });
assert(g.effective.roasTarget === 8 && g.inherited.roasTarget === false, "roas 8 overschrijft");
assert(g.effective.conversionsAbsolute === 5000 && g.inherited.conversionsAbsolute === true, "conversies 0 erft van account");
assert(g.effective.cpaTarget === 20 && g.inherited.cpaTarget === true, "ontbrekende cpa erft van account");
assert(g.effective.revenueAbsolute === 150000 && g.inherited.revenueAbsolute === true, "ontbrekende omzet erft van account");

console.log("event: cadans en edities:");
const e1 = resolveEvent(account.event, { cadence: "biennial", editions: [{ date: "2024-05-01", label: "2024" }, { date: "", label: "leeg" }] });
assert(e1.effective.cadence === "biennial" && e1.inherited.cadence === false, "cadans overschrijft");
assert(e1.effective.editions!.length === 1 && e1.inherited.editions === false, "edities overschrijven (lege datum eruit gefilterd)");

const e2 = resolveEvent(account.event, { cadence: null, editions: [] });
assert(e2.effective.cadence === "annual" && e2.inherited.cadence === true, "lege cadans erft van account");
assert(e2.effective.editions!.length === 1 && e2.inherited.editions === true, "lege edities erven van account");

console.log("geheel: leeg/ontbrekend override erft volledig van account:");
const full = resolveGeoCloneSettings(account, null);
assert(full.branding.effective.brandName === "RAI" && full.branding.inherited.brandName === true, "branding volledig geërfd bij geen override");
assert(full.goals.effective.roasTarget === 5 && full.goals.inherited.roasTarget === true, "doelen volledig geërfd bij geen override");
assert(full.event.effective.cadence === "annual" && full.event.inherited.cadence === true, "event volledig geërfd bij geen override");

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle geo-clone-settings-tests geslaagd");
