# P4 Monthly Quality Pass

## 1. Scope
- Deze ronde deed alleen het resterende P4-afsluitwerk: statuscheck, exact één schone live confirmatierun, uitlezen van de nieuwste geldige output en afronding van dit rapport.
- Deze ronde deed expliciet niet: nieuwe quality-features bouwen, extra refactors uitvoeren, save-path of gates wijzigen, of een nieuwe P-pass starten.

## 2. Startstatus
- P4-code bestond al in de codebase. Relevante quality-wijzigingen zaten al in [`lib/analysis/monthly-structured.ts`](/Users/juulr/Desktop/dashboard/lib/analysis/monthly-structured.ts), inclusief scherpere executive thread-framing, compactere root-cause selection, dependency-framing in recommendations en beter leesbare recommendation-headings. `(deterministic)`
- De testlaag was al groen vóór deze afrondingsronde:
  - `npx tsc --noEmit`
  - `npx tsx lib/__tests__/thread-synthesis.test.ts`
  - `npx tsx lib/__tests__/monthly-structured.test.ts`
  - `npx tsx lib/__tests__/monthly-sop-quality.test.ts`
  - `npx tsx lib/__tests__/monthly-sop-export.test.ts`
  `(deterministic)`
- Er bestond al een eerdere groene live run op `2026-04-16 07:45:35 UTC`. `(deterministic)`
- Wat nog open stond:
  - onduidelijkheid over de handmatig gestopte achtergrondrun
  - exact één schone confirmatierun
  - inhoudelijke P4-beoordeling van de nieuwste geldige output
  - afronding van dit rapport

## 3. Statuscheck
- De eerder “gestopte” achtergrondrun bleek niet save-loos te zijn. De job met `job_id = 789265c5-40c6-42cb-99d7-b5cfe7ac171e` stond in `generation_jobs` uiteindelijk op `completed` / `done` en had wel degelijk saves weggeschreven. `(deterministic)`
- Save receipts van die achtergrondrun:
  - `quality_gate_monthly_v2` op `2026-04-16T07:49:31.82+00:00`
  - `full` op `2026-04-16T07:49:31.893+00:00`
  - `structured_monthly_v2` op `2026-04-16T07:49:31.993+00:00`
  `(deterministic)`
- De P4-codewijzigingen waren nog aanwezig in de relevante bestanden. Ik heb dit direct geverifieerd via code-search op onder meer:
  - `executiveRootCauseFromThread`
  - `applyExecutiveRecommendationDependencies`
  - route-labeled recommendation headings
  `(deterministic)`
- Conclusie van de statuscheck:
  - al bewezen: P4-code aanwezig, testlaag groen, minstens één groene P4-live run bestond al
  - nog te bewijzen: één nieuwe schone confirmatierun en inhoudelijke beoordeling van de nieuwste geldige output

## 4. Live confirmatierun
- Doelaccount: `gads-3853096192`
- Verse `job_id`: `bfe8842e-ef79-4ebf-bb29-a55bf19929b0`

- Commands:
```bash
curl -sS -o /tmp/p4-confirm-prepare.body -w '%{http_code}\n' \
  -X POST http://localhost:3000/api/analysis/monthly/prepare \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"gads-3853096192"}'

curl -sS -o /tmp/p4-confirm-monthly.body -w '%{http_code}\n' \
  -X POST http://localhost:3000/api/analysis/monthly \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"gads-3853096192","job_id":"bfe8842e-ef79-4ebf-bb29-a55bf19929b0"}'

curl -sS -o /tmp/p4-confirm-pdf.pdf -D /tmp/p4-confirm-pdf.headers -w '%{http_code}\n' \
  'http://localhost:3000/api/analysis/pdf?client_id=gads-3853096192&sop_type=monthly&client_name=gads-3853096192'
```

- HTTP statuses:
  - prepare: `200`
  - monthly: `200`
  - pdf: `200`
  `(deterministic)`

- Monthly route outcome:
  - `structured.saved = true`
  - `structured.findings = 30`
  - `structured.acceptance.passed = true`
  - `structured.qualityGate.state = "passed"`
  - `structured.qualityGate.invalid_steps = []`
  `(deterministic)`

- Save receipts van de confirmatierun:
  - `quality_gate_monthly_v2`
    - `id = c64de4a9-e018-4182-837f-6d3b6021ecfc`
    - `created_at = 2026-04-16T07:57:01.68+00:00`
  - `full`
    - `id = 7fec232f-2bd4-45a7-8318-2c4e1e226dac`
    - `created_at = 2026-04-16T07:57:01.751+00:00`
  - `structured_monthly_v2`
    - `id = 04d57b5b-7f6d-4385-9f97-a4bbddd62d96`
    - `created_at = 2026-04-16T07:57:01.844+00:00`
  `(deterministic)`

- PDF status:
  - `HTTP/1.1 200 OK`
  - `content-type: application/pdf`
  - `content-disposition: attachment; filename="SOP-Maandelijks-2026-04-16.pdf"`
  `(deterministic)`

## 5. Kwaliteitsbeoordeling van de nieuwste geldige run
- Beoordeelde run:
  - `structured_monthly_v2 = 04d57b5b-7f6d-4385-9f97-a4bbddd62d96`
  - gekoppelde `full = 7fec232f-2bd4-45a7-8318-2c4e1e226dac`
  `(deterministic)`

- Primary thread:
  - `Duitsland trekt disproportioneel budget zonder rendementsmatch.`
  - Dit is duidelijk beter dan de pre-P4-formulering `Geo-allocatie rond Land: DE is uit balans.` omdat het nu meteen het business-probleem noemt in plaats van alleen een abstract allocatieframe. `(deterministic)`

- Executive root cause:
  - `Duitsland absorbeert 31.6% van de spend met een efficiency ratio van slechts 0.52.`
  - Deze zin is compact, niet meer afgekapt en blijft netjes op hetzelfde Germany-surface als de primary thread. `(deterministic)`
  - Kwalitatieve caveat: de zin beschrijft vooral impact en efficiency, maar nog niet volledig het achterliggende mechanisme tussen hoge klikinteresse en lage koopintentie. Daardoor is hij sterker dan pre-P4, maar nog niet op benchmarkniveau. `(inferred)`

- Recommendations/tasks continuity:
  - Alle final recommendations en alle tasks blijven op `Duitsland`.
  - De drie routes zijn nu logisch geordend:
    - `containment`
    - `recovery`
    - `controlled scale`
  - Recovery start pas na containment-stabilisatie.
  - Controlled scale start pas na een geslaagde hersteltest.
  `(deterministic)`

- `What is NOT the problem`:
  - De huidige run bevat nog geen echte inhoudelijke negatieve selectie.
  - De executive markdown valt terug op:
    - `Geen expliciete schone positive signalen geselecteerd.`
  - Dit is functioneel veilig, maar kwalitatief duidelijk zwakker dan de benchmark, die expliciet false alternatives uitsluit. `(deterministic)`

- Action ordering / dependencies:
  - De executive layer laat nu een duidelijke volgorde zien van beperken → gecontroleerd herstellen → pas daarna opschalen.
  - Dat is inhoudelijk bruikbaarder dan de pre-P4-variant, waarin dependencies minder expliciet waren. `(deterministic)`

- Monitoring / success criteria:
  - Positief:
    - recommendations bevatten meetmetric en beslisregels
    - `success_next_month.weekly_monitoring_checklist = ["ROAS","CPA","CVR"]`
  - Zwak:
    - floor scenario in de success-framing is grammaticaal en inhoudelijk nog niet strak genoeg geformuleerd
    - er ontbreekt een expliciete managementsamenvatting van wanneer Duitsland weer “veilig schaalbaar” is
  `(deterministic voor aanwezigheid, inferred voor kwaliteitswaardering)`

- Executive readability:
  - Verbeterd:
    - primary thread is compacter en scherper
    - route-labels in recommendations helpen
    - dependencies zijn beter leesbaar
  - Nog zwak:
    - supporting evidence bullet 1 is te zwaar en bevat samengestapelde clausules
    - `what is NOT the problem` is een placeholder
    - success framing is nog niet elegant genoeg
  `(deterministic voor outputvorm, inferred voor leesbaarheidsbeoordeling)`

## 6. Benchmarkvergelijking
- Rubric-scorevergelijking:

| Criterium | Benchmark | Huidige run | Toelichting |
|---|---:|---:|---|
| SOP-dekking | 8.5/10 | 8.0/10 | Huidige run dekt de SOP breed, maar executive negatieve selectie en success framing zijn nog dunner dan benchmark. |
| Inzicht / waarom | 9.2/10 | 8.4/10 | Benchmark koppelt impact sterker aan mechanisme; huidige run is causaal beter dan pre-P4 maar nog minder scherp in root cause en evidence-compressie. |
| Actionability | 9.0/10 | 8.5/10 | Huidige run heeft nu sterke routevolgorde en dependency-framing; benchmark blijft rijker in concrete exploit/fix volgorde en succesbeeld. |
| Leesbaarheid | 9.3/10 | 8.0/10 | Executive phrasing is verbeterd, maar benchmark wint nog op headline framing, negative selection en soepelere compacte tekst. |

- Waar de benchmark nog wint:
  - sterkere headline / executive framing
  - scherpere backward chain in de root cause
  - explicieter `what is NOT the problem`
  - sterker uitgewerkte next-month success criteria
  - compacter en schoner supporting evidence
  `(inferred)`

- Waar P4 nu wint of gelijk trekt:
  - singular Germany-thread continuity is nu veel strakker
  - recommendations/tasks blijven consequent op hetzelfde business-surface
  - dependency-ordering in executive recommendations is nu duidelijk en operator-grade
  - hard quality gates, save receipts en renderketen zijn betrouwbaarder dan in de oudere benchmarkflow
  `(deterministic voor continuity/gates, inferred voor relatieve benchmarkvergelijking)`

## 7. Wat nu aantoonbaar beter is dan pre-P4
- Primary thread ging van een abstracte geo-label naar een business-zin:
  - pre-P4: `Geo-allocatie rond Land: DE is uit balans.`
  - nu: `Duitsland trekt disproportioneel budget zonder rendementsmatch.`
  `(deterministic)`

- Executive root cause is niet meer afgekapt en blijft compact. `(deterministic)`

- Recommendations hebben nu expliciete route-labels:
  - `Recommendation 1 (containment)`
  - `Recommendation 2 (recovery)`
  - `Recommendation 3 (controlled scale)`
  `(deterministic)`

- Dependency-framing is aantoonbaar beter:
  - recovery pas na containment-stabilisatie
  - controlled scale pas na hersteltest
  `(deterministic)`

- Germany continuity bleef intact tijdens de confirmatierun:
  - primary thread: Duitsland
  - root cause: Duitsland
  - recommendations: Duitsland
  - tasks: Duitsland
  `(deterministic)`

- P4 bleef groen in live runtime:
  - acceptance passed
  - quality gate passed
  - invalid steps leeg
  - save receipts aanwezig
  - PDF export 200
  `(deterministic)`

## 8. Wat nog resteert
- `What is NOT the problem` is nog niet benchmarkwaardig; het blijft een veilige fallback in plaats van een echte negatieve selectie. `(deterministic)`
- Root cause is beter, maar nog meer impact-zin dan mechanisme-zin. Voor topniveau moet de causal chain compacter en scherper in die ene zin landen. `(inferred)`
- Supporting evidence is nog te compact-chaotisch samengeplakt, vooral in bullet 1. `(deterministic)`
- Success framing en monitoring zijn aanwezig, maar niet zo management-klaar als in de benchmark. `(inferred)`
- Executive readability is nu goed bruikbaar, maar nog net niet “hoog niveau” door de combinatie van placeholder negative selection, zware evidence-regels en matige floor-scenario-tekst. `(inferred)`

## 9. Eindoordeel
- Is P4 afgerond: `ja`. De resterende open werkzaamheden van P4 zijn nu uitgevoerd: status opgehelderd, exact één nieuwe confirmatierun gedaan, nieuwste geldige run inhoudelijk beoordeeld en dit rapport is afgerond. `(deterministic)`
- Is de Monthly SOP nu op hoog niveau: `ja, met nuance`. De engine is nu stabiel, coherent en operator-bruikbaar op executive niveau, maar haalt nog niet het hoogste benchmarkniveau op negatieve selectie, root-cause scherpte en executive polish. `(inferred)`
- Is er nu een P5 nodig: niet automatisch. De betere eerstvolgende stap is om deze versie eerst op meerdere accounts te benchmarken voordat er weer gericht wordt gesleuteld. Alleen als die bredere benchmark dezelfde executive gaps bevestigt, is een kleine P5 op negative selection + root-cause polish + evidence-compression gerechtvaardigd. `(inferred)`
