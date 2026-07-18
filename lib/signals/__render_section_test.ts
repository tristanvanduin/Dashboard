// Verificatie van de sectie-renderer en de kanaal-sectie-bouwers (wiring-kern).
// Draaien: npx tsx lib/signals/__render_section_test.ts

import { renderSignalSection } from "./render-section";
import { buildMetaSignalSection, type MetaAdSignalInput } from "./meta-creative";
import { buildLinkedInSignalSection, type LinkedInEntitySignalInput } from "./linkedin-signals";
import { type DetectionResult } from "./types";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("\n1. Lege detectie geeft lege sectie");
{
  const empty: DetectionResult = { triggered: [], checked: ["x", "y"] };
  const r = renderSignalSection(empty, "Meta");
  check("lege sectie-string", r.section === "");
  check("triggeredCount 0", r.triggeredCount === 0);
  check("checkedIds behouden", r.checkedIds.length === 2);
}

console.log("\n2. Getriggerde detectie rendert het format");
{
  const det: DetectionResult = {
    triggered: [{
      id: "x", category: "creative", scope: "Camp > Ad",
      story: "Iets is mis.", actionDirection: "doe iets", certainty: "bewezen_binnen_platform",
      evidence: [{ metric: "frequentie", value: 4.2 }, { metric: "CTR", value: 0.01, prev: 0.02 }],
    }],
    checked: ["x", "y", "z"],
  };
  const r = renderSignalSection(det, "Meta");
  check("bevat kop met kanaal", r.section.includes("(Meta)"));
  check("bevat getriggerde-sectie", r.section.includes("### Getriggerde signalen"));
  check("bevat zekerheidslabel", r.section.includes("[bewezen_binnen_platform]"));
  check("bevat vorige-periode-bewijs", r.section.includes("vorige periode 0.02"));
  check("gecontroleerd-niet-getriggerd bevat y en z, niet x", r.section.includes("y, z") && !r.section.match(/niet getriggerd\n.*\bx\b/));
  check("triggeredCount 1", r.triggeredCount === 1);
}

console.log("\n3. Meta-sectie-bouwer end-to-end");
{
  const ad: MetaAdSignalInput = {
    entityId: "1", adName: "Moe", campaignName: "C", impressions: 5000,
    frequency: 3.6, hookRate: 0.3, holdRate: 0.2, linkCtr: 0.006, cpa: 20, roas: 3,
    qualityRanking: "BELOW_AVERAGE_10", engagementRanking: "AVERAGE", conversionRanking: "AVERAGE",
    prevLinkCtr: 0.01, prevCpa: 20,
  };
  const r = buildMetaSignalSection({ ads: [ad], levels: [{ scope: "account", frequency: 5, impressions: 100000 }] });
  check("Meta-sectie niet leeg", r.section.length > 0 && r.triggeredCount >= 1);
  check("lege Meta-input geeft lege sectie", buildMetaSignalSection({ ads: [], levels: [] }).section === "");
}

console.log("\n4. LinkedIn-sectie-bouwer end-to-end");
{
  const e: LinkedInEntitySignalInput = {
    entityUrn: "u", name: "Camp", impressions: 10000, clicks: 100,
    ctr: 0.01, cpl: 70, formOpens: 200, formCompletionRate: 0.05,
    videoCompletionRate: 0.3, prevCtr: 0.01, prevCpl: 40,
  };
  const r = buildLinkedInSignalSection({ entities: [e], targets: { cplTarget: 50 } });
  check("LinkedIn-sectie niet leeg", r.section.includes("(LinkedIn)") && r.triggeredCount >= 1);
  check("lege LinkedIn-input geeft lege sectie", buildLinkedInSignalSection({ entities: [] }).section === "");
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
