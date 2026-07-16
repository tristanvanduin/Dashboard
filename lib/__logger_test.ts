// Verificatie van de gedeelde logger en foutbasis.
// Draaien: npx tsx lib/__logger_test.ts

import { logger, setLogLevel, getLogLevel } from "./logger";
import { AppError, isAppError, toErrorMessage } from "./errors";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

type Rec = { m: string; t: string };
function capture(fn: () => void): Rec[] {
  const rec: Rec[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a: unknown[]) => { rec.push({ m: "log", t: a.map(String).join(" ") }); };
  console.warn = (...a: unknown[]) => { rec.push({ m: "warn", t: a.map(String).join(" ") }); };
  console.error = (...a: unknown[]) => { rec.push({ m: "error", t: a.map(String).join(" ") }); };
  try { fn(); } finally { console.log = orig.log; console.warn = orig.warn; console.error = orig.error; }
  return rec;
}

const startLevel = getLogLevel();

console.log("1. Niveau-gating");
setLogLevel("info");
{
  const rec = capture(() => { logger.debug("d"); logger.info("i"); logger.warn("w"); logger.error("e"); });
  check("debug onderdrukt op info", !rec.some((r) => r.t.includes("d") && r.t.includes("DEBUG")));
  check("info, warn, error zichtbaar op info", rec.length === 3);
}
setLogLevel("warn");
{
  const rec = capture(() => { logger.debug("d"); logger.info("i"); logger.warn("w"); logger.error("e"); });
  check("alleen warn en error op warn", rec.length === 2 && rec.every((r) => /WARN|ERROR/.test(r.t)));
}
setLogLevel("error");
{
  const rec = capture(() => { logger.info("i"); logger.warn("w"); logger.error("e"); });
  check("alleen error op error", rec.length === 1 && rec[0].m === "error");
}

console.log("\n2. Routering naar de juiste console-methode");
setLogLevel("debug");
{
  const rec = capture(() => { logger.debug("d"); logger.info("i"); logger.warn("w"); logger.error("e"); });
  check("error gaat naar console.error", rec.some((r) => r.m === "error" && r.t.includes("ERROR")));
  check("warn gaat naar console.warn", rec.some((r) => r.m === "warn" && r.t.includes("WARN")));
  check("debug en info gaan naar console.log", rec.filter((r) => r.m === "log").length === 2);
}

console.log("\n3. Scope-prefix via child");
{
  const rec = capture(() => { logger.child("sync").error("kapot"); logger.child("a").child("b").info("genest"); });
  check("scope verschijnt in de regel", rec.some((r) => r.t.includes("[sync]")));
  check("geneste scope wordt samengevoegd", rec.some((r) => r.t.includes("[a:b]")));
}

setLogLevel(startLevel);

console.log("\n4. Foutbasis AppError");
{
  const e = new AppError("mislukt", { category: "rate_limit", retryable: true, context: { clientId: "c1" } });
  check("category gezet", e.category === "rate_limit");
  check("retryable gezet", e.retryable === true);
  check("context bewaard", e.context?.clientId === "c1");
  check("is een Error", e instanceof Error);
  check("isAppError true", isAppError(e));
  check("isAppError false op gewone fout", !isAppError(new Error("x")));
  const def = new AppError("zonder opties");
  check("defaults: unknown en niet retryable", def.category === "unknown" && def.retryable === false);
}

console.log("\n5. toErrorMessage");
{
  check("Error.message", toErrorMessage(new Error("boem")) === "boem");
  check("string ongewijzigd", toErrorMessage("plat") === "plat");
  check("object naar JSON", toErrorMessage({ a: 1 }) === '{"a":1}');
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
