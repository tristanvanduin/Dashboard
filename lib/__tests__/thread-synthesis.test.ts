import { synthesizeThreads } from "../analysis/thread-synthesis";
import type { IssueCluster } from "../analysis/canonicalize";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function cluster(overrides: Partial<IssueCluster>): IssueCluster {
  return {
    cluster_id: "cluster_1",
    issue_cluster: "geo_allocation",
    canonical_entity_name: "Duitsland",
    display_label: "Land: Duitsland",
    entity_scope: "country",
    entity_identity_key: "country::de",
    canonical_geo_id: "de",
    parent_campaign: null,
    parent_adgroup: null,
    canonical_metric: "ROAS",
    related_finding_ids: ["f_001"],
    dominant_severity: "high",
    dominant_confidence: "high",
    root_cause_summary: "Spend verschuift naar een inefficiënt landcluster.",
    evidence_summary: "Land: Duitsland ROAS 0.86x (-43%).",
    actionability: "direct_action",
    coverage_dimensions: ["geography"],
    findings: [] as IssueCluster["findings"],
    action_required: true,
    finding_count: 1,
    severity_score: 4,
    ...overrides,
  };
}

console.log("\n=== Thread Synthesis Tests ===\n");

console.log("1. Root cause group outranks derivative symptom");
{
  const output = synthesizeThreads([
    cluster({
      cluster_id: "cluster_geo",
      issue_cluster: "geo_allocation",
      display_label: "Land: Duitsland",
      canonical_geo_id: "de",
      severity_score: 8,
      finding_count: 2,
      coverage_dimensions: ["geography", "campaign", "adgroup"],
      evidence_summary: "Duitsland trekt spend weg tegen zwakke blended ROAS.",
    }),
    cluster({
      cluster_id: "cluster_network",
      issue_cluster: "network_quality",
      display_label: "YouTube | Campagne: Bestseller_RM",
      entity_scope: "network",
      entity_identity_key: "network::youtube::bestseller_rm",
      canonical_geo_id: "de",
      canonical_metric: "CPA",
      severity_score: 7,
      finding_count: 1,
      coverage_dimensions: ["network", "campaign"],
      evidence_summary: "YouTube inventory lekt budget weg.",
    }),
    cluster({
      cluster_id: "cluster_mobile",
      issue_cluster: "mobile_opportunity",
      display_label: "Device: Mobile",
      entity_scope: "device",
      entity_identity_key: "device::mobile",
      canonical_geo_id: "de",
      canonical_metric: "CVR",
      severity_score: 12,
      finding_count: 4,
      coverage_dimensions: ["device"],
      evidence_summary: "Mobiele CVR daalt hard, maar lijkt afgeleid.",
    }),
  ]);

  assert(Boolean(output.primary_thread), "primary thread exists");
  assert(!/mobile/i.test(output.primary_thread?.title || ""), `primary thread should not be mobile symptom, got "${output.primary_thread?.title}"`);
}

console.log("2. False-positive/context threads stay out of top problem set");
{
  const output = synthesizeThreads([
    cluster({
      cluster_id: "cluster_positive",
      issue_cluster: "pmax_cannibalization",
      display_label: "PMax Best Sellers",
      dominant_severity: "positive",
      action_required: false,
      actionability: "monitor",
      evidence_summary: "Volume verschuift naar PMax zonder duidelijke blended schade.",
    }),
    cluster({
      cluster_id: "cluster_budget",
      issue_cluster: "search_budget_cap",
      display_label: "Campagne: Search NL",
      entity_scope: "campaign",
      entity_identity_key: "campaign::search_nl",
      canonical_metric: "Search Lost IS (Budget)",
      severity_score: 9,
      finding_count: 2,
      coverage_dimensions: ["campaign", "competitor"],
      evidence_summary: "Vraag wordt afgekapt door budgetverlies.",
    }),
  ]);

  assert(output.false_positives.length >= 1, "contextual/positive cluster should move to false positive layer");
  assert(output.supporting_threads.length <= 3, "supporting threads stay bounded");
}

console.log("3. Geo thread broadens to country surface when DE evidence spans multiple scopes");
{
  const output = synthesizeThreads([
    cluster({
      cluster_id: "cluster_geo_country",
      issue_cluster: "geo_allocation",
      display_label: "Land: Duitsland",
      entity_scope: "country",
      entity_identity_key: "country::de",
      canonical_geo_id: "de",
      canonical_metric: "ROAS",
      severity_score: 11,
      finding_count: 2,
      coverage_dimensions: ["geography", "campaign"],
      evidence_summary: "Duitsland blijft accountbreed inefficiënt.",
    }),
    cluster({
      cluster_id: "cluster_geo_adgroup",
      issue_cluster: "geo_allocation",
      display_label: "Ad group: DE (Shopping-bleeder_RM)",
      entity_scope: "adgroup",
      entity_identity_key: "adgroup::de_bleeder",
      canonical_geo_id: "de",
      canonical_metric: "CPA",
      severity_score: 12,
      finding_count: 1,
      coverage_dimensions: ["geography", "adgroup"],
      evidence_summary: "DE adgroup is een smalle uiting van hetzelfde Germany-probleem.",
    }),
    cluster({
      cluster_id: "cluster_geo_campaign",
      issue_cluster: "geo_allocation",
      display_label: "Campagne: Duitsland Core",
      entity_scope: "campaign",
      entity_identity_key: "campaign::de_core",
      canonical_geo_id: "de",
      canonical_metric: "Spend",
      severity_score: 8,
      finding_count: 1,
      coverage_dimensions: ["campaign", "geography"],
      evidence_summary: "Campagnebudget blijft naar DE verschuiven.",
    }),
  ]);

  assert(/duitsland/i.test(output.primary_thread?.title || ""), "broader Germany surface should win the thread title");
  assert(!/ad group: de/i.test(output.primary_thread?.title || ""), "narrow DE ad group title should not win when country evidence exists");
}

console.log("4. Search-term waste loses from a broader deterministic campaign driver");
{
  const output = synthesizeThreads([
    cluster({
      cluster_id: "cluster_query",
      issue_cluster: "search_term_waste",
      display_label: "Zoekterm: kippenvoerbak",
      entity_scope: "searchterm",
      entity_identity_key: "searchterm::kippenvoerbak",
      parent_campaign: "Catch-all Shopping",
      canonical_metric: "CPA",
      severity_score: 10,
      finding_count: 1,
      coverage_dimensions: ["search_term"],
      evidence_summary: "Zoekterm blaast CPA op zonder conversies.",
    }),
    cluster({
      cluster_id: "cluster_campaign",
      issue_cluster: "product_mix",
      display_label: "Campagne: PMAX Broedmachine @ Best Sellers",
      canonical_entity_name: "PMAX Broedmachine @ Best Sellers",
      entity_scope: "campaign",
      entity_identity_key: "campaign::pmax_broedmachine_best_sellers",
      canonical_metric: "CVR",
      severity_score: 13,
      finding_count: 2,
      coverage_dimensions: ["campaign", "pmax_product_asset_groups"],
      evidence_summary: "Extreme spend-schaling verwatert CVR en rendement op campagneniveau.",
    }),
  ]);

  assert(!/zoektermverspilling/i.test(output.primary_thread?.title || ""), `query thread should not win when a broader campaign driver exists, got "${output.primary_thread?.title}"`);
  assert(/pmax|campagne/i.test(output.primary_thread?.title || ""), "broader campaign surface should become the primary thread");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
