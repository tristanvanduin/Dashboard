# Monthly SOP Audit

Datum audit: 2026-04-15  
Scope: Monthly SOP analyse-engine, huidige codebase, benchmark-output, Sub SOP-specificatie, historische opgeslagen SOP-runs en een live run op de huidige flow.

==================================================
DEEL A — INVENTARISATIE
==================================================

## 1. Overzicht relevante bestanden, mappen en versies

| Pad / bestandsnaam | Type | Relevantie | Gelezen | Waarom relevant |
| --- | --- | --- | --- | --- |
| `/Users/juulr/Downloads/1. Sub SOP _ Monthly Analysis (1).docx` | SOP-specificatie | Kritiek | Ja | Bron van waarheid voor stap-opbouw, logformat en vereiste analysehandelingen. |
| `/Users/juulr/Downloads/monthly-report-2026-03 (3).md` | Benchmark output | Kritiek | Ja | Referentie voor hoge score op inzicht, actionability en leesbaarheid. |
| `/Users/juulr/Downloads/Markdown broedservice.md` | Historische run-output | Hoog | Ja | Laat zien hoe de oudere step-output en acties eruitzien. |
| `/Users/juulr/Downloads/Markdown FIT Fysio.md` | Historische run-output | Hoog | Ja | Laat volumeverlies/efficiency-cases en actie-inconsistentie zien. |
| `/Users/juulr/Downloads/Markdown Minismus.md` | Historische run-output | Hoog | Ja | Laat PMAX/geo/network mix en oude renderstijl zien. |
| `/Users/juulr/Downloads/Markdown Mobiliteitexpert.md` | Historische run-output | Hoog | Ja | Laat brand/PMAX/ROAS-case en threadinstabiliteit zien. |
| `/Users/juulr/Downloads/sop_analysis_output_rows.json` | Export van opgeslagen output | Kritiek | Ja | Historische `full` en `structured_monthly_v2` runs, nodig voor versievergelijking. |
| `/Users/juulr/Downloads/sop_analysis_output_rows.csv` | Export van opgeslagen output | Hoog | Ja | Cross-check op opgeslagen secties en analyse-datums. |
| `/Users/juulr/Downloads/sop_insights_rows.csv` | Export van insights | Hoog | Ja | Laat zien wat downstream in `sop_insights` terechtkomt. |
| `/Users/juulr/Downloads/sop_recommendations_rows.csv` | Export van recommendations | Hoog | Ja | Laat zien hoe recommendation-kwaliteit en wording downstream uitpakt. |
| `/Users/juulr/Downloads/sop_tasks_rows.csv` | Export van tasks | Hoog | Ja | Laat operator-grade taaklaag en regressies zien. |
| `/Users/juulr/Downloads/sprint_hypotheses_rows.csv` | Export van hypotheses | Medium | Ja | Laat oudere sprint-hypothese kwaliteit en legacy-ruis zien. |
| `app/api/analysis/monthly/route.ts` | Route/orchestratie | Kritiek | Ja | Entrypoint van de Monthly SOP-flow. |
| `app/api/analysis/monthly/prepare/route.ts` | Prepare endpoint | Hoog | Ja | Pre-aggregatie en prepared-context flow. |
| `app/api/analysis/pdf/route.ts` | PDF export route | Kritiek | Ja | Render/export-keten vanaf opgeslagen output. |
| `lib/analysis/monthly-structured.ts` | Synthese-laag | Kritiek | Ja | Bouwt threads, final SOP, operating layer, coverage, appendix en deliverable. |
| `lib/analysis/sop-pdf-renderer.ts` | PDF renderer | Kritiek | Ja | Bepaalt pagina-opbouw, truncatie en renderstructuur. |
| `lib/analysis/thread-synthesis.ts` | Thread scoring | Kritiek | Ja | Bepaalt thread ranking, contradiction handling en ICE-spread. |
| `lib/analysis/canonicalize.ts` | Canonicalization/clustering | Kritiek | Ja | Dedupe, clustering, coverage-dimensies en normalisatie. |
| `lib/analysis/coverage-enforcer.ts` | Coverage enforcement | Hoog | Ja | Zet coverage om naar surfaced/missing/unavailable dimensies. |
| `lib/analysis/monthly-prepared-context.ts` | Prepared context builder | Hoog | Ja | Bundelt decision rules, KPI chains, comparison facts en prompt-fragmenten. |
| `lib/analysis/comparison-facts.ts` | Deterministische facts | Hoog | Ja | Levert precomputed account/campaign/ad group vergelijkingsteksten. |
| `lib/analysis/decision-rules.ts` | Deterministische actierichtingen | Hoog | Ja | Legt harde actierichting per campaign/geo/device vast. |
| `lib/analysis/kpi-chain.ts` | KPI-keten | Hoog | Ja | Maakt de backward chain van resultaat naar onderliggende metrics. |
| `lib/analysis/data-availability.ts` | Availability gating | Hoog | Ja | Vertelt per stap welke data ontbreekt. |
| `lib/analysis/step-validator.ts` | Step QA | Kritiek | Ja | Domein-purity, mathematische consistentie, ontbrekende data, etc. |
| `lib/analysis/monthly-acceptance.ts` | Acceptancerapport | Hoog | Ja | High-level acceptance criteria voor de monthly route. |
| `lib/analysis/helpers.ts` | Runtime helpers | Hoog | Ja | `getSupabase`, `runStep`, output-opslag, date helpers. |
| `lib/analysis/openrouter-client.ts` | LLM client | Hoog | Ja | Bepaalt model, retries, timeout en parse-status. |
| `lib/prompts/monthly-v2.ts` | Stap-prompts | Kritiek | Ja | SOP logformats, purity contracts, per-stap instructies. |
| `lib/prompts/sop-prompts.ts` | System prompts / benchmarks | Kritiek | Ja | Base role, benchmark framing, output discipline, prompt-builders. |
| `lib/schema/analysis-schema.ts` | Structured schema | Hoog | Ja | `StepOutputSchema`, findings, tasks, recommendations. |
| `lib/__tests__/monthly-structured.test.ts` | Test | Hoog | Ja | Validatie van synthese, appendix en breadth/diversity. |
| `lib/__tests__/monthly-sop-quality.test.ts` | Test | Hoog | Ja | Validatie van outputkwaliteit, final SOP en task/recommendation discipline. |
| `lib/__tests__/monthly-sop-export.test.ts` | Test | Hoog | Ja | Validatie van export en two-layer deliverable. |
| `lib/__tests__/thread-synthesis.test.ts` | Test | Hoog | Ja | Validatie van thread-selectie en false-positive suppressie. |
| `lib/__tests__/decision-rules.test.ts` | Test | Medium | Ja | Validatie van deterministische actierichting. |
| `lib/__tests__/kpi-chain.test.ts` | Test | Medium | Ja | Validatie van precomputed KPI-chain. |
| `scripts/monthly-pipeline-v2.sql` | SQL / context | Medium | Nee | Mogelijk relevant voor pipeline-opslag, maar niet nodig voor deze audit. |
| `lib/schema/monthly-pipeline-schema.ts` | Schema | Medium | Nee | Relevante context voor pipeline shape, maar geen primaire buglocatie. |

## 2. Bestanden die ik expliciet echt heb gelezen

Deterministic:
- De Sub SOP docx.
- De benchmark markdown.
- De 4 historische markdown-runs.
- De 6 gedeelde CSV/JSON exportbestanden.
- `app/api/analysis/monthly/route.ts`
- `app/api/analysis/monthly/prepare/route.ts`
- `app/api/analysis/pdf/route.ts`
- `lib/analysis/monthly-structured.ts`
- `lib/analysis/sop-pdf-renderer.ts`
- `lib/analysis/thread-synthesis.ts`
- `lib/analysis/canonicalize.ts`
- `lib/analysis/coverage-enforcer.ts`
- `lib/analysis/monthly-prepared-context.ts`
- `lib/analysis/comparison-facts.ts`
- `lib/analysis/decision-rules.ts`
- `lib/analysis/kpi-chain.ts`
- `lib/analysis/data-availability.ts`
- `lib/analysis/step-validator.ts`
- `lib/analysis/monthly-acceptance.ts`
- `lib/analysis/helpers.ts`
- `lib/analysis/openrouter-client.ts`
- `lib/prompts/monthly-v2.ts`
- `lib/prompts/sop-prompts.ts`
- `lib/schema/analysis-schema.ts`
- De relevante monthly/thread/export tests.
- De Next.js route-handler documentatie in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.

## 3. Bestanden die waarschijnlijk relevant zijn, maar die ik niet volledig heb hoeven gebruiken

Deterministic:
- `scripts/monthly-pipeline-v2.sql`
- `lib/schema/monthly-pipeline-schema.ts`
- Progress/job helpers buiten de direct relevante route-calls.
- Sync-routes buiten de merchant-scope fout die in de live run boven kwam.

Toelichting:
- Deze bestanden zijn randvoorwaardelijk of infrastructuur-gerelateerd, maar niet de primaire oorzaak van de geobserveerde Monthly SOP-kwaliteitsgaten.

## 4. Relevante codepaden voor de Monthly SOP

Deterministic:
- Promptlaag: `lib/prompts/monthly-v2.ts`, `lib/prompts/sop-prompts.ts`
- Runtime/orchestratie: `app/api/analysis/monthly/route.ts`, `lib/analysis/helpers.ts`
- Preprocessing/precompute: `app/api/analysis/monthly/prepare/route.ts`, `lib/analysis/monthly-prepared-context.ts`, `lib/analysis/comparison-facts.ts`, `lib/analysis/decision-rules.ts`, `lib/analysis/kpi-chain.ts`, `lib/analysis/data-availability.ts`
- Canonicalization/clustering/threading: `lib/analysis/canonicalize.ts`, `lib/analysis/thread-synthesis.ts`, `lib/analysis/coverage-enforcer.ts`
- Synthese/executive+operating+appendix: `lib/analysis/monthly-structured.ts`
- Validation/QA: `lib/analysis/step-validator.ts`, `lib/analysis/monthly-acceptance.ts`, `lib/analysis/monthly-structured.ts`
- Rendering/export: `app/api/analysis/pdf/route.ts`, `lib/analysis/sop-pdf-renderer.ts`
- Tests/evaluaties: `lib/__tests__/monthly-structured.test.ts`, `lib/__tests__/monthly-sop-quality.test.ts`, `lib/__tests__/monthly-sop-export.test.ts`, `lib/__tests__/thread-synthesis.test.ts`

==================================================
DEEL B — BEGRIP VAN HET SYSTEEM
==================================================

## End-to-end flow van de huidige Monthly SOP

### 1. Input en data

Deterministic:
- De monthly route haalt live data uit Supabase op via `app/api/analysis/monthly/route.ts`.
- Bij een aanwezige `analysis_prepared_context` gebruikt de route prepared context en slaat hij een deel van de zware account/campaign queries over.
- Voor step-specifieke analyses blijven ruwe datafeeds bestaan, zoals search terms, creative, device, geo, network, checkout, etc.
- Client goals/account type komen uit `fetchClientContext()` in `lib/analysis/helpers.ts`.

### 2. Preprocessing / precompute

Deterministic:
- `app/api/analysis/monthly/prepare/route.ts` en `lib/analysis/monthly-prepared-context.ts` bouwen:
  - decision rules
  - KPI-chain op account- en campagneniveau
  - comparison facts
  - campaign comparison tables
  - data-availability prompt notes
- Deze fragmenten worden daarna in de stap-prompts ingevoegd zodat het model minder hoeft te rekenen.

### 3. Analysis steps

Deterministic:
- De route draait 13 inhoudelijke SOP-stappen.
- Stap 7 is opgesplitst in 7A en 7B en daarna samengevoegd.
- Er zijn 3 checkpoints.
- Stap 9 heeft een hardcoded fallback zonder LLM-call als audience-data ontbreekt.
- Elke step-output wordt geparsed, gevalideerd en opgeslagen.

### 4. Thread-selectie

Deterministic:
- Clustering gebeurt in `lib/analysis/canonicalize.ts`.
- Threadfamilies en scoring gebeuren in `lib/analysis/thread-synthesis.ts`.
- In `lib/analysis/monthly-structured.ts` bouwt `createThreads()` de gerankte threadset.
- De primary thread is uiteindelijk `threads[0]`, en de executive laag gebruikt die in `buildFinalSopSynthesis()`.

Waar wordt de primary thread gekozen:
- `createThreads()` in `lib/analysis/monthly-structured.ts`
- Onderliggende cluster/thread scoring:
  - `scoreCluster()` in `lib/analysis/thread-synthesis.ts`
  - `scoreThreadGroup()` en `executiveThreadScore()` in `lib/analysis/monthly-structured.ts`

### 5. Root cause logica

Deterministic:
- `dominantRootCause()` in `lib/analysis/monthly-structured.ts` reduceert een cluster tot een dominante oorzaak.
- `buildFinalSopSynthesis()` gebruikt vervolgens:
  - `primaryThread`
  - `primaryCluster`
  - `dominantRootCause(primaryCluster)`
  voor de executive root cause.

### 6. Recommendations / tasks / mapping

Deterministic:
- Eerste laag:
  - `buildRecommendationsFromStepActions()` promoot step-actions.
  - Alternatief: `buildRecommendationForThread()` genereert thread-based recommendations.
- Daarna:
  - `deduplicateAndResolve()`
  - `buildTasksFromRecommendations()`
  - `buildFinalRecommendations()`
  - `buildFinalTasks()`
- Operating mapping:
  - `buildOperatingDetailLayer()`
  - `route_task_map`
  - `execution_detail`
  - `step_backed_rationale`

Waar recommendation/task mapping zit:
- Thread/task/recommendation generation in `lib/analysis/monthly-structured.ts`
- Supporting traceability in `buildOperatingDetailLayer()`

### 7. Rendering / output

Deterministic:
- `buildStructuredMonthlyOutput()` bouwt:
  - `final_sop`
  - `operating_detail`
  - `coverage_markdown`
  - `appendix_markdown`
  - `deliverable_markdown`
- `section = "full"` in `sop_analysis_output` wordt gevuld met `structured.deliverable_markdown`.
- `section = "structured_monthly_v2"` bewaart de rich structured payload.
- `app/api/analysis/pdf/route.ts` haalt `full` + `structured_monthly_v2` op en geeft die door aan `renderSopPdf()`.
- `lib/analysis/sop-pdf-renderer.ts` maakt de cover, executive pages, operating pages, coverage appendix en per-step appendix.

Waar leesbaarheid / renderstructuur wordt bepaald:
- `renderFinalSopMarkdown()` in `lib/analysis/monthly-structured.ts`
- `renderOperatingDetailMarkdown()` in `lib/analysis/monthly-structured.ts`
- `buildAppendixMarkdown()` in `lib/analysis/monthly-structured.ts`
- `buildMonthlyPdfViewModel()` en appendix-grouping in `lib/analysis/sop-pdf-renderer.ts`

### 8. Checks / QA / acceptance

Deterministic:
- Stapniveau:
  - `validateStepOutput()` in `lib/analysis/step-validator.ts`
- Eindniveau:
  - `validateMonthlyAcceptance()` in `lib/analysis/monthly-acceptance.ts`
  - `validateFinalSopSynthesis()`
  - `validateOperatingDetailLayer()`
  - `validateMonthlyDeliverableCompleteness()`
  - `validateStructuredOutputConsistency()`

Waar SOP-dekking wordt afgedwongen:
- Promptlaag:
  - SOP logformats en werkwijze-checklists in `lib/prompts/monthly-v2.ts`
- Coveragelaag:
  - `checkSopCoverage()` in `lib/analysis/canonicalize.ts`
  - `enforceSopCoverage()` in `lib/analysis/coverage-enforcer.ts`
  - `buildCoverageMarkdown()` in `lib/analysis/monthly-structured.ts`

Waar acceptance/evaluatielogica zit:
- `validateStepOutput()`
- `validateMonthlyAcceptance()`
- `validateFinalSopSynthesis()`
- `validateOperatingDetailLayer()`
- `validateMonthlyDeliverableCompleteness()`

### 9. Wat ontbreekt of niet hard genoeg wordt afgedwongen

Deterministic:
- Een mislukte `validateMonthlyAcceptance()` blokkeert de route niet.
- Een ongeldige stap-validatie blokkeert de route niet.
- Een stap kan `valid: false` zijn en tóch wordt de full output opgeslagen en de PDF exporteerbaar.

Inferred:
- De architectuur wil hardere QA, maar de huidige runtime gebruikt de validators vooral als observability en niet als harde stop.

==================================================
DEEL C — BENCHMARK-ANALYSE
==================================================

## 1. Wat de benchmark inhoudelijk sterk maakt

Deterministic:
- De benchmark opent met een scherpe headline en primary thread.
- Hij kiest één hoofdprobleem en behandelt andere signalen als ondersteunend of secundair.
- Hij redeneert achterwaarts van resultaat naar mechanisme.
- Hij sluit expliciet uit wat niet het hoofdprobleem is.
- Hij ordent acties in tijd en afhankelijkheden.

## 2. Waarom de benchmark hoog scoort

### Inzicht (“waarom”)

Deterministic:
- De benchmark verbindt KPI’s causally in een keten in plaats van ze los op te sommen.
- Er is een heldere hoofdthread: “quality erosion in Search, concentrated in one campaign and one keyword.”
- Onderliggende threads worden geduid als verklarend of relativerend, niet als extra hoofdproblemen.

### Actionability

Deterministic:
- De benchmark heeft een expliciet action plan met:
  - immediate
  - short-term
  - medium-term
- Dependencies zijn benoemd.
- Monitoring checklist staat expliciet apart.
- “What success looks like next month” maakt succescriteria concreet.

### Leesbaarheid

Deterministic:
- Heldere executive framing.
- Logische sectievolgorde.
- Weinig padding.
- Geen JSON-blokken midden in de deliverable.
- Korte thread-essentie, daarna pas nuance.

## 3. Waarom de benchmark ondanks sterke kwaliteit mogelijk geen perfecte SOP-dekking heeft

Inferred:
- De benchmark is sterker als executive document dan als volledige SOP-uitput.
- Hij bevat niet zichtbaar de volledige 13-staps uitwerking in SOP-logformat.
- Daardoor scoort hij vermoedelijk hoger op management-readability dan op letterlijke SOP-dekking per werkwijze/tab/logformat.

## 4. Welke keuzes de benchmark beter maken dan de huidige output

Deterministic:
- Headline/executive framing staat bovenaan.
- Eén hoofdthread krijgt prioriteit boven meerdere bijna-gelijke threads.
- “What is not the problem” voorkomt verkeerde actie op schijnsignalen.
- De actievolgorde is gekoppeld aan causal logic, niet alleen aan losse symptomen.
- Dependencies voorkomen dat acties elkaar tegenspreken.
- Monitoring en succesbeeld maken de output bestuurbaar.

## 5. Concreet aangewezen patronen

Deterministic:
- Headline / executive framing: aanwezig.
- Backward chain / causale keten: sterk aanwezig.
- Keuze van 1 hoofdthread: aanwezig.
- Afbakening van wat NIET het probleem is: aanwezig.
- Volgorde van acties: aanwezig.
- Dependencies: expliciet aanwezig.
- Monitoring: expliciet aanwezig.
- Caveats: expliciet aanwezig.
- Succesbeeld voor volgende maand: expliciet aanwezig.

==================================================
DEEL D — SUB SOP CROSS-CHECK
==================================================

## Matrix per SOP-stap

| SOP stap | Vereist? | Wat moet er precies gebeuren? | Welke data is nodig? | Gebruikt huidige engine dit al? | Kwaliteit huidige implementatie |
| --- | --- | --- | --- | --- | --- |
| 1. Account Performance | Ja | Backward KPI chain, targetstatus, trend, week-validatie, YoY/seizoen | account monthly, weekly, targets, benchmarks | Ja | Gedeeltelijk goed. KPI-chain en targets zijn ingebouwd, maar stap lekt nog naar geo/campaign en bevat math/domain warnings. |
| 2. Campaign Performance | Ja | Twee werkwijzen: account performance verklaren + campagne-evaluatie, week-validatie, trend/breuklijn | campaign monthly, campaign YoY, metadata, change history, prepared facts | Ja | Gedeeltelijk. Sterke prompt en prepared facts, maar output kiest nog verkeerde sub-signalen en mixt entity-niveaus. |
| 3. Ad Group Performance | Ja | Campagnebevindingen verklaren op ad group-niveau, trend, change history | adgroup monthly, stap 2 context | Ja | Gedeeltelijk. Ad group diepte is aanwezig, maar narratief blijft domeingrenzen overschrijden. |
| 4. Competitor / Auction Insights | Ja | Volume verklaren via budget vs rank, vraag vs budget, impression share trends | campaign impression share, change history, stap 2/3 context | Ja | Gedeeltelijk. Promptdiscipline is goed, maar acties springen soms naar keyword/geo-domein. |
| 5. Keyword Performance | Ja | Match type, buckets, QS, campagne/adgroup verklaring | keyword monthly, QS-data, stap 2/3 context | Ja | Gedeeltelijk/zwak. Prompt is sterk, maar live run had parse salvage, te weinig findings en gebrek aan concrete cijfers. |
| 6. Product Performance | Ja | Custom labels/categorieën, SKU-niveau, Merchant context | product monthly, Merchant Center / product performance | Ja | Gedeeltelijk. Logica aanwezig, maar merchant sync gaf 403 scopes en verzwakt de stap. |
| 7. Search Term Performance | Ja | Zoektermclassificatie + acties + besparingspotentieel | wasteful search terms, product/keyword context | Ja | Gedeeltelijk goed. 7A/7B-split werkt, maar acties kunnen nog op verkeerd entity-level landen. |
| 8. Creative Performance | Ja | Asset/ad copy analyse over meerdere tijdframes | creative performance, 14/30/60/90d context | Ja | Gedeeltelijk. Multi-timeframe prompt is goed, maar live run had math inconsistency. |
| 9. Audience Performance | Ja | Audience types analyseren of compact fallback als data ontbreekt | audience monthly | Ja | Goed als fallback, gedeeltelijk als inhoud. Geen hallucinatie, maar bij geen data is dit alleen een noodoutput. |
| 10. Device & Engagement | Ja | Deviceanalyse plus bounce/engagement/session duration | device performance + engagement metrics | Ja | Gedeeltelijk goed. Instructies zijn aanwezig, maar narratief overschrijdt nog domeinen. |
| 11. Geografische Performance | Ja | Volledige geo-analyse met efficiency ratio, reallocatie-logica, trend | country monthly, country YoY | Ja | Goedste inhoudelijke deep-dive in de live run, maar threadselectie kan geo soms te dominant maken. |
| 12. Checkout / Schedule / Network | Ja | Alle drie uitvoeren, compacte no-data handling | checkout funnel, schedule, network | Ja | Zwak in live run. Step 12 was daadwerkelijk invalid door “data niet beschikbaar” versus deterministic findings. |
| 13. Hypotheses & Sprintplanning / synthese | Ja | Synthese, prioriteren, hypotheses, acties | alle steps + checkpoints | Ja | Architectonisch sterk, maar live output had malformed decision rules en continuity-gaten tussen diagnose en actie. |

## Belangrijkste Sub SOP-conclusie

Deterministic:
- De engine dekt de meeste SOP-stappen architectonisch af.
- De grootste gaten zitten niet meer in “bestaat deze stap?”, maar in:
  - domeinzuiverheid
  - causal discipline
  - echte enforcement
  - continuity van diagnose naar actie
  - no-data/evidence-consistentie

==================================================
DEEL E — ANALYSE VAN ALLE EERDERE SOP-RUNS
==================================================

## Geanalyseerde run-bronnen

Deterministic:
- 4 volledige markdown-runs uit Downloads.
- Historische `full` rows uit `sop_analysis_output_rows.json`.
- Historische `structured_monthly_v2` rows uit `sop_analysis_output_rows.json`.
- Downstream rows uit `sop_insights_rows.csv`, `sop_recommendations_rows.csv`, `sop_tasks_rows.csv`, `sprint_hypotheses_rows.csv`.
- 1 live run op 2026-04-15 voor client `gads-3853096192`.

## Patronen over de runs heen

### 1. Wisselende primary thread voor dezelfde case

Deterministic:
- `gads-3853096192`
  - 2026-04-13 structured: primary thread = meetrisico.
  - 2026-04-14 structured: primary thread = netwerkkwaliteit / YouTube-lekkage.
  - 2026-04-15 live: primary thread = Duitsland geo-allocatie.
- `gads-8714777147`
  - Benchmark: hoofdthread = Search quality erosion.
  - 2026-04-14 structured: primary thread = België geo.
  - Andere run-output voor dezelfde client trekt richting schedule side-thread (`kippenhek_RM - Saturday 17:00`).

Beoordeling:
- Dit is een echte stabiliteitsissue, geen cosmetische variatie.

### 2. Root cause en recommendations lopen niet stabiel op hetzelfde entity-level

Deterministic:
- Live run 2026-04-15:
  - Primary thread/root cause: Duitsland geo mismatch.
  - Recommendation 2: desktop bid adjustment op `DE (1. Shopping-core_RM)`.
- Dat is niet per se onjuist, maar het containment-mechanisme schuift van geo-probleem naar device-actie zonder expliciete hiërarchie.

### 3. Oude runs zijn rijker, maar rommeliger

Deterministic:
- Oudere markdown-runs bevatten veel diepere per-step inhoud.
- Ze bevatten ook:
  - veel JSON-blokken midden in markdown
  - cross-step boilerplate
  - dubbeling
  - oude executive/planachtige structuur
  - inconsistente adviesrichting

### 4. Nieuwe runs zijn strakker, maar soms te dun of verkeerd geprioriteerd

Deterministic:
- Nieuwe structured outputs hebben:
  - compacte executive laag
  - operating detail layer
  - canonicalization
  - thread synthesis
  - PDF/export logic
- Maar:
  - threadkeuze blijft instabiel
  - malformed decision rules komen nog door
  - not-the-problem is vaak leeg
  - invalid step output stopt de route niet

### 5. Tegenstrijdige of instabiele actie-richting

Deterministic:
- Downstream recommendation/task rows laten nog steeds meerdere stijlen zien:
  - oude vage acties
  - legacy sprint-hypotheses
  - nieuwe containment/recovery/validation routes
- In de historische outputs bestaan voor vergelijkbare problemen zowel budget push als budget rem-adviezen zonder voldoende expliciete beslisregel.

### 6. Negatieve selectie is vaak zwak

Deterministic:
- Het benchmark-document heeft sterke “what is not the problem” afbakening.
- Live run 2026-04-15 heeft:
  - `What is NOT the problem`
  - maar inhoudelijk: “Geen expliciete schone positive signalen geselecteerd.”

Beoordeling:
- De structuur is aanwezig, maar de diagnostische kracht is inhoudelijk zwakker dan gewenst.

## Wat verbeterd is tussen versies

Deterministic:
- Prepared context en deterministic facts verminderen rekentaken voor het model.
- SOP logformats en data-availability fallbacks bestaan nu expliciet.
- 7A/7B split voorkomt een oude step-7 merge-bug.
- Final SOP + operating detail + appendix bestaan als first-class deliverable.
- PDF/export kan de two-layer plus per-step appendix renderen.

## Wat nog instabiel is

Deterministic:
- Primary thread keuze.
- Causale continuïteit van thread naar recommendation/task.
- Math consistency binnen narratives.
- Step purity.
- No-data versus evidence consistency.
- Hard gating van acceptance/validator failures.

==================================================
DEEL F — GAP-ANALYSE
==================================================

| Dimensie | Wat gaat mis | Waarom gebeurt dat | Waarschijnlijke code/prompt-oorzaak | Impact |
| --- | --- | --- | --- | --- |
| SOP-dekking | Coverage markeert `campaign` als data-unavailable terwijl campagne-signalen wel aanwezig zijn | Prepared-context optimalisatie zet `campaignData` leeg, maar coverage kijkt naar `campaignData.length > 0` | `app/api/analysis/monthly/route.ts` bij `dimensionAvailability.campaign` | Kritiek |
| SOP-dekking | Step 12 kan “data niet beschikbaar” zeggen en tegelijk deterministic findings opslaan | No-data fallback en evidence-consistentie worden wel gevalideerd maar niet hard afgedwongen | `validateStepOutput()` + route slaat ondanks invalid step toch door | Kritiek |
| Inzicht / waarom | Narratives blijven domeingrenzen overschrijden en bevatten math-conflicten | Promptdiscipline is beter, maar step-validator is advisory | `lib/prompts/monthly-v2.ts`, `lib/analysis/step-validator.ts`, `app/api/analysis/monthly/route.ts` | Hoog |
| Actionability | Diagnose en actie zitten niet altijd op hetzelfde beslisniveau | Step actions worden gepromoveerd en kunnen de threadlogica overrulen | `buildRecommendationsFromStepActions()`, `buildFinalRecommendations()` | Hoog |
| Actionability | Beslisregels bevatten malformed duplicatie zoals “Continueer alleen als schaal alleen...” | String composition combineert validation-condition en route-template niet schoon | `decisionRuleForRoute()` en related final-recommendation builders in `lib/analysis/monthly-structured.ts` | Hoog |
| Leesbaarheid | Oude step-output blijft JSON-achtig in opslag; live full output is bruikbaar, maar nog lang en soms semantisch ruw | De route slaat step outputs per sectie op als raw JSON strings; executive output is compacter maar niet inhoudelijk altijd scherp | `runStep()`/section saves in `lib/analysis/helpers.ts` en `route.ts` | Medium |
| Stabiliteit thread-keuze | Zelfde case schuift tussen measurement, network, geo | Cluster scoring en promoted recommendations wegen side-threads nog te zwaar | `thread-synthesis.ts`, `createThreads()`, recommendation promotion | Kritiek |
| Causaliteit | Benchmark verklaart consequenter van symptoom naar mechanisme | Huidige engine heeft de bouwstenen, maar niet genoeg hard enforcement op story consistency | Promptlaag + validator advisory + thread/action merge | Hoog |
| Continuïteit diagnose→actie | Geo-probleem krijgt containment als desktop-bid-actie zonder expliciete route-hiërarchie | Operating mapping is aanwezig, maar action surface wordt niet hard gerespecteerd | `normalizeBusinessTarget()`, action-intent inference, final recommendation building | Hoog |
| Gebruik beschikbare data | Merchant/product verdieping blijft deels uit door externe 403-scopes | Externe Merchant API permissies onvoldoende | `syncMerchantProductSnapshots()` call in route, externe credentials/scopes | Medium |
| Robuustheid / betrouwbaarheid | Acceptance faalt, maar route geeft 200 en slaat output op | Acceptance report is niet blocking | `validateMonthlyAcceptance()` gebruik in route | Kritiek |
| Robuustheid / betrouwbaarheid | Step-validatie kan `valid: false` geven zonder runtime stop | Validator is observability, geen gate | `parseStructuredStepOutput()` + route flow | Kritiek |
| Leesbaarheid / management value | `What is NOT the problem` is vaak leeg | Executive filter is streng en geselecteerde positives zijn te schaars of te caveated | `executiveSafeNotProblem()` | Medium |
| Export bruikbaarheid | Live PDF is compleet maar telt 21 pagina’s | Two-layer + full appendix is aanwezig, maar compactheidsdoel blijft lastig | `sop-pdf-renderer.ts` grouping/truncation/page composition | Medium |

## Belangrijkste gap-conclusie

Deterministic:
- Het systeem is niet meer “te simpel”; het is nu “architectonisch rijk maar handhaaft zijn eigen kwaliteitsregels niet hard genoeg”.

==================================================
DEEL G — VOER DE HUIDIGE MONTHLY SOP UIT
==================================================

## Uitgevoerde entrypoints

Deterministic:
- `app/api/analysis/monthly/prepare/route.ts`
- `app/api/analysis/monthly/route.ts`
- `app/api/analysis/pdf/route.ts`

## Exact uitgevoerde commands / modules

Deterministic:

```bash
set -a
source .env.local
set +a
npx tsx <<'TS'
import { NextRequest } from 'next/server';
import prepareRoute from './app/api/analysis/monthly/prepare/route.ts';
const req = new NextRequest('http://localhost:3000/api/analysis/monthly/prepare', {
  method: 'POST',
  body: JSON.stringify({ client_id: 'gads-3853096192' }),
  headers: { 'content-type': 'application/json' },
});
const res = await prepareRoute.POST(req);
console.log('status', res.status);
console.log(await res.text());
TS
```

Resultaat:
- `status 200`
- `prepared_context_id = 65969dd9-51b1-4c79-9086-16e2afa2798f`
- `analysis_date = 2026-03-30`

```bash
set -a
source .env.local
set +a
npx tsx <<'TS'
import { NextRequest } from 'next/server';
import monthlyRoute from './app/api/analysis/monthly/route.ts';
import { writeFileSync } from 'node:fs';
const body = { client_id: 'gads-3853096192', job_id: 'audit-run-2026-04-15-gads-3853096192' };
const req = new NextRequest('http://localhost:3000/api/analysis/monthly', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});
const res = await monthlyRoute.POST(req);
const text = await res.text();
writeFileSync('/tmp/monthly-audit-run-gads-3853096192.json', text);
console.log('status', res.status);
console.log(text.slice(0, 4000));
TS
```

```bash
set -a
source .env.local
set +a
npx tsx <<'TS'
import { NextRequest } from 'next/server';
import pdfRoute from './app/api/analysis/pdf/route.ts';
import { writeFileSync } from 'node:fs';
const req = new NextRequest('http://localhost:3000/api/analysis/pdf?client_id=gads-3853096192&sop_type=monthly&client_name=Audit+Client', { method: 'GET' });
const res = await pdfRoute.GET(req);
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync('/tmp/monthly-audit-gads-3853096192.pdf', buf);
console.log('status', res.status);
console.log('bytes', buf.length);
TS
```

## Gebruikte inputdata

Deterministic:
- Client: `gads-3853096192`
- Periode: `2025-03-01` t/m `2026-03-30`
- Model: `google/gemini-3-flash-preview-20251217`
- Bronnen:
  - live Supabase tabellen
  - prepared context
  - OpenRouter modelcalls
  - PDF export op opgeslagen output

## Output van de live run

Deterministic:
- HTTP status monthly route: `200`
- `analysisDate`: `2026-04-15`
- `totalTokens`: `674391`
- `totalLatencyMs`: `157647`
- `structured.saved`: `true`
- `findings`: `31`
- `recommendations`: `3`
- `tasks`: `6`
- `clusters`: `27`
- `displayFindings`: `40`
- `threads`: `3`
- `fullOutputChars`: `36743`

Deterministic inhoudelijk hoofdresultaat:
- Primary thread: Duitsland geo-allocatie
- Root cause: structurele mismatch in Duitse markt/propositie
- PDF export: `status 200`, `165117 bytes`, `21` page objects

## Blokkades en workarounds

### Blokkade 1 — Merchant API scopes

Deterministic:
- De live run logde:
  - `Merchant API error (403): ACCESS_TOKEN_SCOPE_INSUFFICIENT`
- Impact:
  - product/merchant verrijking is gedeeltelijk verzwakt
  - de run stopte niet volledig

### Blokkade 2 — Custom job id was geen UUID

Deterministic:
- Mijn handmatige test-run gebruikte een niet-UUID `job_id`.
- Daardoor faalde progress logging met:
  - `invalid input syntax for type uuid`
- Impact:
  - geen blokkade voor de inhoudelijke Monthly SOP-run
  - wel ruis in progress jobs

Toelichting:
- Dit is een test/workaround issue van mijn invocation, niet per se een productiebug in de route zelf.

## Of de output volledig was of deels faalde

Deterministic:
- De run was functioneel volledig:
  - 13 stappen uitgevoerd
  - structured output opgeslagen
  - PDF gerenderd
- De run was kwaliteitsmatig niet groen:
  - acceptance `passed: false`
  - step 12 `valid: false`
  - 31 unieke findings waar acceptance max 30 verwacht
  - meerdere warnings op step purity en math consistency

## Root cause van de kwaliteitsblokkades

Deterministic:
- Validators zijn observability, geen harde gate.
- Thread/action continuity is nog onvoldoende hard.
- No-data versus deterministic evidence-conflict wordt niet geblokkeerd.
- Prepared-context optimalisatie verstoort coverage-status voor campaigns.

==================================================
DEEL H — VERPLICHTE ZELFCONTROLE
==================================================

| Check | Status | Bewijs | Toelichting |
| --- | --- | --- | --- |
| 1. Heb je echt alle relevante bestanden gelezen? | Gedeeltelijk | Core monthly files, prompts, renderer, schema, historical outputs en tests zijn gelezen | De primaire Monthly SOP-keten is volledig afgedekt. Niet elke perifere infrastructuurfile is volledig gelezen. |
| 2. Heb je de benchmark echt vergeleken met de huidige output? | Ja | Benchmark markdown gelezen en vergeleken met historische en live outputs | Hoofdverschillen in causal chain, action plan, dependencies en readability zijn expliciet uitgewerkt. |
| 3. Heb je de Sub SOP stap-voor-stap gecrosscheckt? | Ja | SOP docx gelezen en in matrix omgezet | Alle 13 stappen zijn afgezet tegen data, enginegebruik en kwaliteit. |
| 4. Heb je alle eerdere SOP-runs bekeken? | Gedeeltelijk | 4 markdown-runs + opgeslagen rows + downstream exports geanalyseerd | Niet elke individuele row is volledig uitgelezen, maar de corpus is breed genoeg voor patroonanalyse. |
| 5. Heb je de huidige Monthly SOP echt uitgevoerd? | Ja | Prepare route, monthly route en PDF route live aangeroepen | Resultaten, statuscodes, tokens, latency en blockers zijn expliciet vastgelegd. |
| 6. Heb je geverifieerd welke onderdelen ontbreken of zwak zijn? | Ja | Step validations, acceptance, live output, PDF smoke, downstream rows | Gaps zijn per dimensie en codepad benoemd. |
| 7. Heb je duidelijk gemaakt welke conclusies hard bewijs hebben en welke inferenties zijn? | Ja | Audit markeert claims als deterministic of inferred | Externe of niet-hard-afdwingbare interpretaties zijn als inferred gelabeld. |

==================================================
DEEL I — STAND VAN ZAKEN
==================================================

## 1. Huidige volwassenheid van de Monthly SOP engine

Inferred:
- Architectuurvolwassenheid: hoog-midden.
- Outputvolwassenheid: midden.
- Samengevat: de engine is technisch veel verder dan een simpele prompt-chain, maar de kwaliteitshandhaving tussen stap-output, thread-selectie, synthese en export is nog niet hard genoeg om consistent hoog niveau te leveren.

## 2. Grootste 5 bottlenecks

Deterministic:
1. Validators en acceptance blokkeren de route niet, ook niet bij een invalid step.
2. Primary thread-keuze is instabiel tussen measurement, network, geo en schedule side-threads.
3. Diagnose naar recommendation/task continuity blijft inconsistent.
4. Prepared-context optimalisatie breekt delen van coverage truth.
5. No-data/evidence-consistentie is nog lek, vooral in stap 12.

## 3. Grootste 5 kansen met hoogste leverage

Inferred:
1. Maak step validation en acceptance blocking voor save/export.
2. Maak threadselectie en recommendation promotion strakker gekoppeld aan dezelfde business surface.
3. Repareer malformed decision-rule string composition.
4. Maak coverage availability prepared-context aware.
5. Versterk math/domain enforcement vóór synthese, niet alleen als warning achteraf.

## 4. Waar de benchmark nu nog wint

Deterministic:
- Causal clarity in één verhaal.
- Strakkere prioritering.
- Betere negatieve selectie.
- Betere dependency- en monitoringframing.
- Minder interne inconsistentie tussen diagnose en actie.

## 5. Waar dit systeem al beter is of meer potentie heeft

Deterministic:
- Deterministische precompute laag.
- Typed schema’s.
- Canonicalization / clustering / coverage.
- Two-layer deliverable met operating detail en appendix.
- Renderbare traceability tussen recommendation en tasks.

## 6. Mijn vertrouwen dat dit naar hoog niveau kan worden getild

Inferred:
- Hoog, ongeveer 8/10.

Waarom:
- De bouwstenen zijn er al.
- De problemen zitten vooral in enforcement, continuity en ranking.
- Dit vraagt een gerichte kwaliteitsronde, niet een totale herbouw.

## 7. Beste eerstvolgende stap voordat we verder prompten

Inferred:
- Niet nóg meer promptbreedte toevoegen.
- Eerst de kwaliteitsgates hard maken op de bestaande architectuur:
  - invalid step output mag niet meer naar structured save/export
  - prepared-context coverage moet kloppen
  - thread/recommendation continuity moet gefixeerd worden
  - malformed decision-rule text moet eruit

==================================================
DEEL J — VERBETERPLAN, MAAR NOG NIET BLIND BOUWEN
==================================================

| Prioriteit | Probleem | Gewenste verandering | Waar in code / prompt / architectuur | Verwacht effect | Risico | Complexiteit |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Invalid step outputs blokkeren niets | Maak step validation hard-blocking voor structured save en PDF-export | `app/api/analysis/monthly/route.ts`, `step-validator.ts`, `monthly-acceptance.ts` | Voorkomt dat mooie maar ongeldige deliverables worden opgeslagen | Kan meer runs laten falen totdat echte issues gefixt zijn | Medium |
| P0 | Acceptance false blokkeert route niet | Maak acceptance blocking of minstens “save full only on pass / partial on fail” | `app/api/analysis/monthly/route.ts` | Dwingt echte kwaliteitslat af | Meer operationele failures zichtbaar | Medium |
| P0 | Coverage-status breekt bij prepared context | Maak `dimensionAvailability` prepared-summary aware | `app/api/analysis/monthly/route.ts` | SOP-dekking rapportage wordt weer betrouwbaar | Laag | Laag |
| P0 | Malformed decision rules in final SOP | Centraliseer en saniteer route/beslisregel string building | `lib/analysis/monthly-structured.ts` | Verhoogt actionability en professionaliteit direct | Laag | Medium |
| P0 | Threadkeuze instabiel | Laat primary-thread ranking sterker sturen op business surface + continuity met selected actions | `thread-synthesis.ts`, `monthly-structured.ts` | Minder side-thread hijacks, meer stabiele executive diagnose | Middelgroot | Hoog |
| P1 | Diagnose en actie zitten soms op ander entity-level | Maak entity/action surface verplicht in recommendation promotion en final recommendation build | `buildRecommendationsFromStepActions()`, `buildFinalRecommendations()`, `buildOperatingDetailLayer()` | Betere causal continuity en operator-bruikbaarheid | Middelgroot | Hoog |
| P1 | Step purity/math warnings blijven onschadelijk | Voeg pre-synthesis rejection of repair toe voor step outputs met pure math/domain conflicts | `parseStructuredStepOutput()`, `validateStepOutput()` flow | Verhoogt betrouwbaarheid van thread synthesis | Kan extra fallback-logica nodig maken | Medium |
| P1 | Step 12 no-data conflict | Maak data-availability prompt en extraction stricter, plus downgrade evidence/severity automatisch bij no-data narratives | `data-availability.ts`, stap 12 prompt, salvage/validator flow | Minder valse zekerheid in network/schedule layer | Laag | Medium |
| P1 | Merchant verrijking is fragiel | Voeg expliciete degraded-mode note en product-step fallback toe bij Merchant 403 | monthly route / product step context | Productstap wordt eerlijker en robuuster | Externe scope blijft nodig voor topkwaliteit | Medium |
| P2 | Not-the-problem is vaak leeg | Maak safe positive selection iets rijker maar zonder caveat leakage | `executiveSafeNotProblem()` | Betere negative selection, meer benchmark-kwaliteit | Kan false positives binnenhalen als te los | Medium |
| P2 | PDF is live nog 21 pagina’s | Tighter appendix grouping/compression per low-signal step | `sop-pdf-renderer.ts` | Meer management-compact zonder operating layer te verliezen | Kans op nieuwe overcompressie | Medium |
| P2 | Downstream historical rows bevatten legacy/rommelige varianten | Voeg evaluatie-reporting toe op opgeslagen rows per run | nieuwe audit/eval helper of test harness | Maakt regressies sneller zichtbaar | Extra werk buiten main pipeline | Medium |

## Beste implementatievolgorde

Inferred:
1. Hard gating.
2. Coverage truth repair.
3. Decision-rule string hygiene.
4. Thread/recommendation continuity.
5. Step 12 / no-data / math consistency.
6. Merchant degraded mode.
7. Not-the-problem en PDF compactheid.

## Eindoordeel

Deterministic:
- Er is nu genoeg gebouwd om gericht te tweaken.
- Er is nog niet genoeg hardheid in de kwaliteitsgates om de Monthly SOP-output al “betrouwbaar hoog niveau” te noemen.

Inferred:
- De volgende ronde moet geen brede brainstorm zijn, maar een gefocuste P0/P1 kwaliteits- en continuity-pass.
