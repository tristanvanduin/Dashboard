// Verificatie van de E5 prioriteringskern.
// Draaien: npx tsx lib/learning/__prioritize_queue_test.ts
import { prioritizeQueue, summarizePlan, type QueueHypothesis } from "./prioritize-queue";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}
function h(id: string, total: number, impact = 5, conf = 5, ease = 5, source: string | null = "analysis"): QueueHypothesis {
  return { id, hypothesis: id, source, iceImpact: impact, iceConfidence: conf, iceEase: ease, iceTotal: total };
}

console.log("Rangschikking op ICE");
const ranked = prioritizeQueue([h("a", 4), h("b", 8), h("c", 6)]);
check("hoogste ICE eerst", ranked[0].id === "b" && ranked[1].id === "c" && ranked[2].id === "a");
check("rang 1,2,3 toegekend", ranked[0].rank === 1 && ranked[2].rank === 3);
check("score is ice_total", ranked[0].score === 8);

console.log("\nTie-breaks");
const tie = prioritizeQueue([h("low-impact", 6, 3), h("high-impact", 6, 9)]);
check("bij gelijk total wint hogere impact", tie[0].id === "high-impact");
const fullTie = prioritizeQueue([h("first", 6, 5, 5, 5), h("second", 6, 5, 5, 5)]);
check("volledige gelijkstand behoudt invoervolgorde", fullTie[0].id === "first" && fullTie[1].id === "second");

console.log("\nSprintcapaciteit");
const many = prioritizeQueue([h("a", 9), h("b", 8), h("c", 7), h("d", 6), h("e", 5), h("f", 4)], { sprintCapacity: 3 });
check("top 3 in de sprint", many.filter(x => x.placement === "sprint").length === 3);
check("rest naar de backlog", many.filter(x => x.placement === "backlog").length === 3);
check("de juiste in de sprint", many.filter(x => x.placement === "sprint").map(x => x.id).join(",") === "a,b,c");
const def = prioritizeQueue([h("a",9),h("b",8),h("c",7),h("d",6),h("e",5),h("f",4)]);
check("default-capaciteit is 5", def.filter(x => x.placement === "sprint").length === 5);
const zero = prioritizeQueue([h("a", 9)], { sprintCapacity: 0 });
check("capaciteit 0 zet alles op backlog", zero[0].placement === "backlog");

console.log("\nLege wachtrij en samenvatting");
check("lege wachtrij geeft lege lijst", prioritizeQueue([]).length === 0);
const plan = prioritizeQueue([h("a", 9, 5, 5, 5, "second_opinion"), h("b", 8, 5, 5, 5, "search_terms"), h("c", 2, 5, 5, 5, "second_opinion")], { sprintCapacity: 2 });
const sum = summarizePlan(plan);
check("samenvatting telt sprint en backlog", sum.sprintCount === 2 && sum.backlogCount === 1);
check("samenvatting spreidt per bron", sum.bySource["second_opinion"] === 2 && sum.bySource["search_terms"] === 1);

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
