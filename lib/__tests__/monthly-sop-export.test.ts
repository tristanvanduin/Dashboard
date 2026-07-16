import { buildMonthlyPdfViewModel } from "../analysis/sop-pdf-renderer";
import {
  validateMonthlyDeliverableCompleteness,
  type FinalSopSynthesis,
  type OperatingDetailLayer,
} from "../analysis/monthly-structured";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

const finalSop: FinalSopSynthesis = {
  primary_thread: "Post-click verkeer breekt na de klik waardoor winstgevend volume verdund wordt.",
  root_cause: "De dominante oorzaak is een routing- en funnelbreuk op high-intent verkeer. Daardoor blijven kliksignalen sterk terwijl afspraken uitblijven.",
  supporting_evidence: [
    "Utrecht branded CVR stort in terwijl branded intent overeind blijft.",
    "High-intent zoektermen genereren spend zonder conversie en wijzen op post-click frictie.",
    "Advertentiebelofte en landingspagina sluiten niet meer op elkaar aan.",
  ],
  what_is_not_the_problem: [
    "Haarlem branded blijft schoon winstgevend.",
  ],
  recommendations: [
    {
      route: "validation",
      handeling: "Valideer eerst de branded funnel.",
      object: "Utrecht branded campagne",
      doel: "Voorkomt dat bied- of budgetingrepen op een meet- of funnelbreuk worden gebaseerd.",
      meet_via: "CVR, formulier-completion rate",
      voorwaarde: "Gebruik 7 dagen schone meetdata.",
      beslisregel: "Ga alleen door als de funnel valide blijkt.",
      risico: "Zonder validatie blijft elke vervolgstap onzuiver.",
    },
    {
      route: "containment",
      handeling: "Verlaag tijdelijk de bieddruk.",
      object: "Utrecht branded campagne",
      doel: "Beperkt directe spend-lekkage.",
      meet_via: "CPA, spend per dag",
      voorwaarde: "Laat merkverkeer live maar begrensd.",
      beslisregel: "Houd alleen aan als CPA daalt.",
      risico: "Te veel rem kan zichtbaarheid beperken.",
      alternative_route: "Recovery: herbouw de route in een aparte testset.",
    },
    {
      route: "recovery",
      handeling: "Herbouw de lokale branded route.",
      object: "Utrecht branded campagne en landingspagina",
      doel: "Herstelt winstgevend high-intent verkeer.",
      meet_via: "CVR, CPA, lead rate",
      voorwaarde: "Pas live na gevalideerde meting.",
      beslisregel: "Continueer alleen als CVR materieel herstelt.",
      risico: "Nieuwe structuur kan tijdelijk leerverlies geven.",
    },
  ],
  tasks: [
    {
      linked_recommendation: 1,
      handeling: "Controleer tracking en formulierpad.",
      object: "Utrecht branded landingspagina",
      meet_via: "Formulier-completion rate, call-tracking",
      voorwaarde: "Test mobiel en desktop apart.",
      beslisregel: "Escaleer direct als een meetstap niet afvuurt.",
      risico: "Verborgen trackingfouten maskeren het echte probleem.",
    },
    {
      linked_recommendation: 2,
      handeling: "Verlaag branded bieddruk.",
      object: "Utrecht branded campagne",
      meet_via: "CPA, spend per dag",
      voorwaarde: "Geen andere grote campagnewijzigingen in dezelfde week.",
      beslisregel: "Rollback deels als zichtbaarheid instort zonder CPA-herstel.",
      risico: "Merkvraag kan te hard worden afgeremd.",
    },
    {
      linked_recommendation: 3,
      handeling: "Bouw een Utrecht-only hersteltest.",
      object: "Utrecht branded RSA en Utrecht landingspagina",
      meet_via: "CVR, CPA",
      voorwaarde: "Pas live na schone validatie.",
      beslisregel: "Stop de test als CVR niet herstelt binnen 150 klikken.",
      risico: "Te brede test maakt de oorzaak opnieuw diffuus.",
    },
  ],
  qa_self_check: {
    chosen_primary_thread: "Post-click verkeer breekt na de klik waardoor winstgevend volume verdund wordt.",
    rejected_alternative_threads: ["Budget-cap", "Puur geo-probleem"],
    why_score_estimate: 8.8,
    actionability_score_estimate: 8.8,
    red_flags_remaining: ["Geen checkout-funneldata beschikbaar."],
  },
  markdown: `## Primary thread

Post-click verkeer breekt na de klik waardoor winstgevend volume verdund wordt.

## Root cause

De dominante oorzaak is een routing- en funnelbreuk op high-intent verkeer. Daardoor blijven kliksignalen sterk terwijl afspraken uitblijven.

## Supporting evidence

- Utrecht branded CVR stort in terwijl branded intent overeind blijft.
- High-intent zoektermen genereren spend zonder conversie en wijzen op post-click frictie.
- Advertentiebelofte en landingspagina sluiten niet meer op elkaar aan.

## What is NOT the problem

- Haarlem branded blijft schoon winstgevend.

## Recommendations

Recommendation 1
Handeling: Valideer eerst de branded funnel.
Object: Utrecht branded campagne
Doel: Voorkomt dat bied- of budgetingrepen op een meet- of funnelbreuk worden gebaseerd.
Meet via: CVR, formulier-completion rate
Voorwaarde: Gebruik 7 dagen schone meetdata.
Beslisregel: Ga alleen door als de funnel valide blijkt.
Risico: Zonder validatie blijft elke vervolgstap onzuiver.

Recommendation 2
Handeling: Verlaag tijdelijk de bieddruk.
Object: Utrecht branded campagne
Doel: Beperkt directe spend-lekkage.
Meet via: CPA, spend per dag
Voorwaarde: Laat merkverkeer live maar begrensd.
Beslisregel: Houd alleen aan als CPA daalt.
Risico: Te veel rem kan zichtbaarheid beperken.
Alternative route: Recovery: herbouw de route in een aparte testset.

Recommendation 3
Handeling: Herbouw de lokale branded route.
Object: Utrecht branded campagne en landingspagina
Doel: Herstelt winstgevend high-intent verkeer.
Meet via: CVR, CPA, lead rate
Voorwaarde: Pas live na gevalideerde meting.
Beslisregel: Continueer alleen als CVR materieel herstelt.
Risico: Nieuwe structuur kan tijdelijk leerverlies geven.

## Tasks

Task 1
Linked recommendation: 1
Handeling: Controleer tracking en formulierpad.
Object: Utrecht branded landingspagina
Meet via: Formulier-completion rate, call-tracking
Voorwaarde: Test mobiel en desktop apart.
Beslisregel: Escaleer direct als een meetstap niet afvuurt.
Risico: Verborgen trackingfouten maskeren het echte probleem.

Task 2
Linked recommendation: 2
Handeling: Verlaag branded bieddruk.
Object: Utrecht branded campagne
Meet via: CPA, spend per dag
Voorwaarde: Geen andere grote campagnewijzigingen in dezelfde week.
Beslisregel: Rollback deels als zichtbaarheid instort zonder CPA-herstel.
Risico: Merkvraag kan te hard worden afgeremd.

Task 3
Linked recommendation: 3
Handeling: Bouw een Utrecht-only hersteltest.
Object: Utrecht branded RSA en Utrecht landingspagina
Meet via: CVR, CPA
Voorwaarde: Pas live na schone validatie.
Beslisregel: Stop de test als CVR niet herstelt binnen 150 klikken.
Risico: Te brede test maakt de oorzaak opnieuw diffuus.

## QA self-check

Chosen primary thread: Post-click verkeer breekt na de klik waardoor winstgevend volume verdund wordt.
Rejected alternative threads: Budget-cap; Puur geo-probleem
Why-score estimate (0-10): 8.8
Actionability-score estimate (0-10): 8.8
Red flags remaining: Geen checkout-funneldata beschikbaar.`,
};

const operatingDetail: OperatingDetailLayer = {
  primary_thread_anchor: finalSop.primary_thread,
  root_cause_anchor: finalSop.root_cause,
  evidence_trace: [
    {
      cluster_id: "utrecht-brand",
      heading: "Utrecht branded funnelbreuk",
      why_it_matters: "Sterke klikintentie verliest waarde na de klik in plaats van in de veiling.",
      evidence_lines: [
        "Branded CVR daalt hard terwijl zoekintentie overeind blijft.",
        "Zoektermen met hoge intentie leveren spend zonder formulierafronding op.",
      ],
      source_steps: [1, 5, 9],
    },
  ],
  route_task_map: [
    {
      recommendation_number: 1,
      route: "validation",
      recommendation_summary: "Valideer eerst de branded funnel Utrecht branded campagne",
      rationale: "Voorkomt dat containment of recovery op vervuilde meetdata wordt gestart.",
      supporting_evidence: ["Branded CVR stort in terwijl intent overeind blijft."],
      source_steps: [1, 9],
      linked_task_numbers: [1],
    },
    {
      recommendation_number: 2,
      route: "containment",
      recommendation_summary: "Verlaag tijdelijk de bieddruk Utrecht branded campagne",
      rationale: "Beperkt directe spend-lekkage terwijl de funnel wordt gevalideerd.",
      supporting_evidence: ["Spend blijft doorlopen zonder herstel in formulier-completion rate."],
      source_steps: [1, 5],
      linked_task_numbers: [2],
    },
    {
      recommendation_number: 3,
      route: "recovery",
      recommendation_summary: "Herbouw de lokale branded route Utrecht branded campagne en landingspagina",
      rationale: "Zet pas een hersteltest live nadat de valide oorzaak op post-click niveau is bevestigd.",
      supporting_evidence: ["Advertentiebelofte en landingspagina sluiten niet meer op elkaar aan."],
      source_steps: [5, 9],
      linked_task_numbers: [3],
    },
  ],
  hypotheses_and_next_month_proof: [
    {
      id: "hypothesis-1",
      title: "Hypothesis 1",
      label: "validation",
      hypothesis_number: 1,
      route: "validation",
      hypothesis: "Als Utrecht branded echt de primaire breuk verklaart, dan verwachten we dat een afgebakende validatietest leidt tot herstel in CVR.",
      why_we_think_this: "Branded CVR stort in terwijl intent overeind blijft.",
      validation_or_exploitation_step: "Valideer eerst de branded funnel.",
      success_next_month: "Volgende maand willen we zien dat branded CVR stabiliseert zonder nieuwe spend-lekkage.",
      expected_change: "De diagnose rond Utrecht branded wordt bevestigd of verworpen zonder direct in te grijpen.",
      success_metrics: ["CVR", "CPA"],
      guardrail_metrics: ["CPA", "Spend"],
      evaluation_window: "7 dagen",
      accept_if: "CVR herstelt binnen 7 dagen zonder verslechtering op CPA.",
      reject_if: "CVR herstelt niet binnen 7 dagen of CPA verslechtert.",
      linked_primary_thread: "Campagne: Utrecht branded verliest conversie-efficiëntie.",
      linked_finding_ids: ["finding-1"],
      linked_recommendation_ids: ["recommendation-1"],
      linked_task_ids: ["task-1"],
      status: "pending",
      rejected_reason: null,
      accepted_into_sprint: false,
    },
    {
      id: "hypothesis-2",
      title: "Hypothesis 2",
      label: "containment",
      hypothesis_number: 2,
      route: "containment",
      hypothesis: "Als de schade vooral in Utrecht branded zit, dan verwachten we dat een tijdelijke afbakening leidt tot stabilisatie van CPA.",
      why_we_think_this: "Spend blijft doorlopen zonder herstel in formulier-completion rate.",
      validation_or_exploitation_step: "Verlaag tijdelijk de bieddruk.",
      success_next_month: "Volgende maand moet CPA dalen zonder disproportioneel volumeverlies.",
      expected_change: "Utrecht branded veroorzaakt minder verspilling terwijl de kernprestatie stabiel blijft.",
      success_metrics: ["CPA", "Spend"],
      guardrail_metrics: ["ROAS", "Conversions"],
      evaluation_window: "7 dagen",
      accept_if: "CPA verbetert binnen 7 dagen terwijl ROAS stabiel blijft.",
      reject_if: "CPA verbetert niet of ROAS verslechtert binnen 7 dagen.",
      linked_primary_thread: "Campagne: Utrecht branded verliest conversie-efficiëntie.",
      linked_finding_ids: ["finding-1"],
      linked_recommendation_ids: ["recommendation-2"],
      linked_task_ids: ["task-2"],
      status: "pending",
      rejected_reason: null,
      accepted_into_sprint: false,
    },
  ],
  execution_detail: [
    {
      task_number: 1,
      linked_recommendation: 1,
      task_summary: "Controleer tracking en formulierpad Utrecht branded landingspagina",
      execution_detail: "Meet via formulier-completion rate en call-tracking. Voorwaarde: test mobiel en desktop apart. Beslisregel: escaleer direct als een meetstap niet afvuurt.",
      supporting_rationale: "Valideroute moet eerst schoon zijn voordat containment of recovery betekenis heeft.",
      source_steps: [1, 9],
    },
    {
      task_number: 2,
      linked_recommendation: 2,
      task_summary: "Verlaag branded bieddruk Utrecht branded campagne",
      execution_detail: "Meet via CPA en spend per dag. Voorwaarde: geen andere grote campagnewijzigingen in dezelfde week. Beslisregel: rollback deels als zichtbaarheid instort zonder CPA-herstel.",
      supporting_rationale: "Containment beperkt verlies terwijl de funnelbreuk wordt gevalideerd.",
      source_steps: [1, 5],
    },
    {
      task_number: 3,
      linked_recommendation: 3,
      task_summary: "Bouw een Utrecht-only hersteltest Utrecht branded RSA en Utrecht landingspagina",
      execution_detail: "Meet via CVR en CPA. Voorwaarde: pas live na schone validatie. Beslisregel: stop de test als CVR niet herstelt binnen 150 klikken.",
      supporting_rationale: "Recovery mag alleen volgen uit dezelfde step-backed funnelverklaring.",
      source_steps: [5, 9],
    },
  ],
  data_gaps_and_validation_notes: [
    "Geen checkout-funneldata beschikbaar.",
    "Mobiel en desktop moeten apart worden gevalideerd om false route-mixes te vermijden.",
  ],
  step_backed_rationale: [
    {
      step_number: 1,
      step_name: "Account Performance",
      conclusion: "Branded verkeer blijft klikvolume leveren maar post-click conversie zakt weg.",
      linked_clusters: ["Utrecht branded funnelbreuk"],
    },
    {
      step_number: 5,
      step_name: "Search Term Performance",
      conclusion: "High-intent zoektermen falen pas na de klik en niet in de query-intentie zelf.",
      linked_clusters: ["Utrecht branded funnelbreuk"],
    },
  ],
  markdown: `## Operating detail: Evidence trace

Context anchor: Post-click verkeer breekt na de klik waardoor winstgevend volume verdund wordt.
Root-cause anchor: De dominante oorzaak is een routing- en funnelbreuk op high-intent verkeer. Daardoor blijven kliksignalen sterk terwijl afspraken uitblijven.

Trace 1: Utrecht branded funnelbreuk
- Why it matters: Sterke klikintentie verliest waarde na de klik in plaats van in de veiling.
- Evidence: Branded CVR daalt hard terwijl zoekintentie overeind blijft.
- Evidence: Zoektermen met hoge intentie leveren spend zonder formulierafronding op.
- Source steps: 1, 5, 9

## Operating detail: Route-to-task mapping

Recommendation 1 (validation)
- Route summary: Valideer eerst de branded funnel Utrecht branded campagne
- Why this route: Voorkomt dat containment of recovery op vervuilde meetdata wordt gestart.
- Evidence tie-back: Branded CVR stort in terwijl intent overeind blijft.
- Linked tasks: 1
- Source steps: 1, 9

Recommendation 2 (containment)
- Route summary: Verlaag tijdelijk de bieddruk Utrecht branded campagne
- Why this route: Beperkt directe spend-lekkage terwijl de funnel wordt gevalideerd.
- Evidence tie-back: Spend blijft doorlopen zonder herstel in formulier-completion rate.
- Linked tasks: 2
- Source steps: 1, 5

Recommendation 3 (recovery)
- Route summary: Herbouw de lokale branded route Utrecht branded campagne en landingspagina
- Why this route: Zet pas een hersteltest live nadat de valide oorzaak op post-click niveau is bevestigd.
- Evidence tie-back: Advertentiebelofte en landingspagina sluiten niet meer op elkaar aan.
- Linked tasks: 3
- Source steps: 5, 9

## Operating detail: Hypotheses and next-month proof

Hypothesis 1 (validation)
- Hypothesis: Als Utrecht branded echt de primaire breuk verklaart, dan moet validatie op CVR de hoofdverklaring bevestigen.
- Why we think this: Branded CVR stort in terwijl intent overeind blijft.
- Validation or exploitation step: Valideer eerst de branded funnel.
- Success next month: Volgende maand willen we zien dat branded CVR stabiliseert zonder nieuwe spend-lekkage.

Hypothesis 2 (containment)
- Hypothesis: Als de schade vooral in Utrecht branded zit, dan moet tijdelijke bieddrukverlaging CPA snel stabiliseren.
- Why we think this: Spend blijft doorlopen zonder herstel in formulier-completion rate.
- Validation or exploitation step: Verlaag tijdelijk de bieddruk.
- Success next month: Volgende maand moet CPA dalen zonder disproportioneel volumeverlies.

## Operating detail: Execution detail

Task 1
- Linked recommendation: 1
- Task summary: Controleer tracking en formulierpad Utrecht branded landingspagina
- Execution detail: Meet via formulier-completion rate en call-tracking. Voorwaarde: test mobiel en desktop apart. Beslisregel: escaleer direct als een meetstap niet afvuurt.
- Supporting rationale: Valideroute moet eerst schoon zijn voordat containment of recovery betekenis heeft.
- Source steps: 1, 9

Task 2
- Linked recommendation: 2
- Task summary: Verlaag branded bieddruk Utrecht branded campagne
- Execution detail: Meet via CPA en spend per dag. Voorwaarde: geen andere grote campagnewijzigingen in dezelfde week. Beslisregel: rollback deels als zichtbaarheid instort zonder CPA-herstel.
- Supporting rationale: Containment beperkt verlies terwijl de funnelbreuk wordt gevalideerd.
- Source steps: 1, 5

Task 3
- Linked recommendation: 3
- Task summary: Bouw een Utrecht-only hersteltest Utrecht branded RSA en Utrecht landingspagina
- Execution detail: Meet via CVR en CPA. Voorwaarde: pas live na schone validatie. Beslisregel: stop de test als CVR niet herstelt binnen 150 klikken.
- Supporting rationale: Recovery mag alleen volgen uit dezelfde step-backed funnelverklaring.
- Source steps: 5, 9

## Operating detail: Data gaps and validation notes

- Geen checkout-funneldata beschikbaar.
- Mobiel en desktop moeten apart worden gevalideerd om false route-mixes te vermijden.

## Operating detail: Step-backed rationale

Step 1: Account Performance
- Conclusion: Branded verkeer blijft klikvolume leveren maar post-click conversie zakt weg.
- Linked clusters: Utrecht branded funnelbreuk

Step 5: Search Term Performance
- Conclusion: High-intent zoektermen falen pas na de klik en niet in de query-intentie zelf.
- Linked clusters: Utrecht branded funnelbreuk`,
};

console.log("\n=== Monthly SOP Export Tests ===\n");

console.log("1. Monthly PDF export keeps final SOP plus operating detail instead of raw legacy tables");
{
  const viewModel = buildMonthlyPdfViewModel({
    clientName: "Demo",
    clientId: "demo",
    sopType: "monthly",
    analysisDate: "2026-04-14",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    fullOutput: `${finalSop.markdown}\n\n${operatingDetail.markdown}`,
    findings: new Array(40).fill(null).map(() => ({
      title: "Legacy finding",
      description: "Legacy finding",
      severity: "critical",
      insight_type: "performance",
      affected_entity: "Entity",
      affected_entity_type: "campaign",
      metric: "ROAS",
      current_value: 1,
      previous_value: 2,
      change_pct: -50,
      action_required: true,
    })),
    recommendations: new Array(20).fill(null).map(() => ({
      hypothesis: "Legacy recommendation",
      expected_result: "Legacy",
      measurement_metric: "ROAS",
      timeframe: "1 week",
      rationale: "Legacy",
      ice_impact: 5,
      ice_confidence: 5,
      ice_ease: 5,
      ice_total: 5,
      status: "todo",
    })),
    tasks: new Array(20).fill(null).map(() => ({
      title: "Legacy task",
      description: "Legacy task",
      action_type: "budget",
      priority: "high",
      frequency: "once",
      due_date: "2026-04-21",
      affected_campaign: "Campaign",
      status: "todo",
    })),
    finalSop,
    operatingDetail,
    coverageMarkdown: "## SOP Coverage Appendix\n\n- geography: gedekt.",
    appendixMarkdown: "## Stap 1: Account Performance\nLogregel 1.\n\nConclusie: Stap 1 conclusie.\n\n## Stap 2: Campaign Performance\nLogregel 2.\n\nConclusie: Stap 2 conclusie.",
    executiveCounts: {
      displayFindingsCount: 4,
      criticalOrHighCount: 2,
    },
  });

  assert(viewModel.usesFinalSop, "export should use strict final SOP when available");
  assert(viewModel.usesOperatingDetail, "export should include operating detail when available");
  assert(!viewModel.includeStructuredTables, "legacy structured tables should be disabled for monthly final SOP export");
  assert(viewModel.recommendationsCount === 3, "recommendation count should come from final SOP");
  assert(viewModel.tasksCount === 3, "task count should come from final SOP");
  assert(viewModel.operatingSections.length === 6, `expected 6 operating detail sections, got ${viewModel.operatingSections.length}`);
  assert(viewModel.appendixSections.some((section) => section.heading === "Stap 1: Account Performance"), "appendix should split step 1 into its own section");
  assert(viewModel.appendixSections.some((section) => section.heading === "Stap 2: Campaign Performance"), "appendix should split step 2 into its own section");
  assert(viewModel.sections.every((section) => !/Executive Snapshot/i.test(section.heading)), "legacy executive heading should be excluded");
}

console.log("2. Monthly PDF export keeps exact final SOP headings and adds a separate operating layer");
{
  const viewModel = buildMonthlyPdfViewModel({
    clientName: "Demo",
    clientId: "demo",
    sopType: "monthly",
    analysisDate: "2026-04-14",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    fullOutput: `${finalSop.markdown}\n\n${operatingDetail.markdown}`,
    finalSop,
    operatingDetail,
  });

  assert(viewModel.executiveSections.length === 7, `expected 7 final SOP sections, got ${viewModel.executiveSections.length}`);
  assert(viewModel.executiveSections[0]?.heading === "Primary thread", "first executive export section should be Primary thread");
  assert(viewModel.executiveSections[6]?.heading === "QA self-check", "last executive export section should be QA self-check");
  assert(viewModel.operatingSections[0]?.heading === "Operating detail: Evidence trace", "operating layer should start with evidence trace");
  assert(viewModel.operatingSections[2]?.heading === "Operating detail: Hypotheses and next-month proof", "operating layer should include explicit hypotheses");
  assert(viewModel.operatingSections[5]?.heading === "Operating detail: Step-backed rationale", "operating layer should end with step-backed rationale");
}

console.log("3. Deliverable completeness gate fails on final-only export and passes on two-layer export");
{
  const finalOnlyErrors = validateMonthlyDeliverableCompleteness({
    final_sop: finalSop,
    executive_markdown: finalSop.markdown,
    deliverable_markdown: finalSop.markdown,
  });
  assert(finalOnlyErrors.length > 0, "final-only export should fail completeness gate");

  const completeErrors = validateMonthlyDeliverableCompleteness({
    final_sop: finalSop,
    operating_detail: operatingDetail,
    executive_markdown: finalSop.markdown,
    deliverable_markdown: `${finalSop.markdown}\n\n${operatingDetail.markdown}`,
  });
  assert(completeErrors.length === 0, `two-layer export should pass completeness gate, got: ${completeErrors.join("; ")}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
