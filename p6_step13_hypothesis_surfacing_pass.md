# P6 Step 13 Hypothesis Surfacing Pass

## 1. Scope
- Deterministic: deze ronde pakte alleen drie P6-doelen aan:
  - zichtbare hypotheseslaag in de uiteindelijke deliverable
  - strakkere diagnose → recommendation → task continuity in de executive laag
  - scherpere executive prioritering bij diffuse cases
- Deterministic: niet gedaan:
  - geen nieuwe infrastructuur
  - geen save-path/gate-herbouw
  - geen brede step-refactor
  - geen extra accounts buiten `gads-8794436501` en `gads-7649590091`

## 2. Startobservaties per case

### `gads-8794436501`
- Deterministic pre-P6: dit was al de sterkere SOP.
- Deterministic pre-P6 gaps:
  - hypotheses bestonden impliciet, maar waren niet expliciet zichtbaar in de stored deliverable
  - minimaal één executive recommendation bleef te step-specifiek t.o.v. de primary thread

### `gads-7649590091`
- Deterministic pre-P6: de output was bruikbaar maar diffuser.
- Deterministic pre-P6 gaps:
  - primary thread was te rauw geformuleerd
  - executive diagnose → actie continuity was niet strak genoeg
  - hypotheses waren niet expliciet zichtbaar in de stored deliverable

## 3. Gewijzigde bestanden
- [lib/prompts/sop-prompts.ts](/Users/juulr/Desktop/dashboard/lib/prompts/sop-prompts.ts)
  - nieuwe operating-detail sectie toegevoegd: `Operating detail: Hypotheses and next-month proof`
- [lib/analysis/monthly-structured.ts](/Users/juulr/Desktop/dashboard/lib/analysis/monthly-structured.ts)
  - expliciete hypothese-opbouw toegevoegd aan de operating layer
  - executive strategy-filter aangescherpt zodat promoted recommendations op hetzelfde executive surface blijven
  - thread title fallback compacter en minder ruw gemaakt voor diffuse cases
- [lib/analysis/thread-synthesis.ts](/Users/juulr/Desktop/dashboard/lib/analysis/thread-synthesis.ts)
  - helper-level thread title fallback gelijkgetrokken met de live synthese
- [lib/analysis/sop-pdf-renderer.ts](/Users/juulr/Desktop/dashboard/lib/analysis/sop-pdf-renderer.ts)
  - nieuwe hypotheselaag opgenomen in monthly operating-detail parsing
- [lib/__tests__/monthly-sop-quality.test.ts](/Users/juulr/Desktop/dashboard/lib/__tests__/monthly-sop-quality.test.ts)
  - regressies voor expliciete hypothesesurfacing en executive continuity
- [lib/__tests__/monthly-sop-export.test.ts](/Users/juulr/Desktop/dashboard/lib/__tests__/monthly-sop-export.test.ts)
  - exportfixture en verwachtingen bijgewerkt voor de extra operating-detail sectie

## 4. Implementatie per P6-doel

### P6-1. Hypotheses expliciet surfacen
- Probleem:
  - hypotheses zaten impliciet in recommendations/tasks, maar niet als aparte hypotheseslaag in de uiteindelijke output
- Oplossing:
  - een expliciete operating-detail sectie toegevoegd:
    - `Operating detail: Hypotheses and next-month proof`
  - per hypothese worden nu 4 vaste onderdelen gerenderd:
    - hypothese
    - waarom we dit denken
    - validatie of exploitation step
    - succesbeeld voor volgende maand
- Deterministic bewijs:
  - beide nieuwste `full` rows bevatten nu `## Operating detail: Hypotheses and next-month proof`
  - beide nieuwste `structured_monthly_v2` rows bevatten `operating_detail.hypotheses_and_next_month_proof`

### P6-2. Strakkere diagnose → recommendation → task continuity
- Probleem:
  - diffuse, step-level acties konden nog promoted worden terwijl ze niet op hetzelfde executive surface bleven
- Oplossing:
  - executive recommendation-promotion gefilterd op business surface
  - smalle keyword/device acties worden niet meer promoted als de primary thread op campaign-surface ligt
- Deterministic bewijs:
  - `gads-7649590091` nieuwste stored output:
    - primary thread: `Campagne: 2. PMAX_Behandeling vraagt een scherpere maanddiagnose.`
    - alle final recommendations object: `2. PMAX_Behandeling`
    - alle final tasks object: `2. PMAX_Behandeling`

### P6-3. Scherpere executive prioritering
- Probleem:
  - diffuse cases vielen nog te snel terug op ruwe metric-framing
- Oplossing:
  - thread title fallback omgezet van ruwe `label: metric` naar compactere probleemframing
  - live synthese en helperlogica gelijkgetrokken
- Trade-off:
  - deterministic: dit maakt de executive thread bruikbaarder, maar het lost diffuse ranking niet volledig op
  - inferred: vooral bij `gads-7649590091` is de continuity duidelijk verbeterd, terwijl de threadformulering zelf nog beter kan

## 5. Tests

Deterministic gedraaid:
- `npx tsc --noEmit`
- `npx tsx lib/__tests__/thread-synthesis.test.ts`
- `npx tsx lib/__tests__/monthly-structured.test.ts`
- `npx tsx lib/__tests__/monthly-sop-quality.test.ts`
- `npx tsx lib/__tests__/monthly-sop-export.test.ts`

Deterministic uitslag:
- `thread-synthesis`: `8 passed, 0 failed`
- `monthly-structured`: `72 passed, 0 failed`
- `monthly-sop-quality`: `123 passed, 0 failed`
- `monthly-sop-export`: `17 passed, 0 failed`

Nieuwe regressiedekking:
- expliciete hypothesesurfacing in de deliverable
- executive recommendations blijven op het primary PMAX-surface in diffuse cases
- exportlaag neemt de nieuwe hypothesis-sectie mee

## 6. Rerun-resultaten

### `gads-8794436501`
- Deterministic prepare:
  - response bevat `prepared_context_id: b09af1b9-5322-484d-a261-7c4468b31f15`
  - `analysis_date: 2026-03-30`
- Deterministic monthly rerun:
  - `job_id: 4FDE1928-9197-4EB5-B9CB-ACC6F2C8F0D0`
  - `generation_jobs.status: completed`
  - `message: Maandelijkse SOP-analyse gereed.`
- Deterministic quality/save:
  - `quality_gate_monthly_v2`
    - `id: 3bce83f5-8036-46f6-8d47-b81b51a83b3a`
    - `created_at: 2026-04-16T13:32:31.412+00:00`
  - `full`
    - `id: 28424917-8b1e-44bf-923b-3836d3d1e37c`
    - `created_at: 2026-04-16T13:32:31.478+00:00`
  - `structured_monthly_v2`
    - `id: 59e39032-e058-4012-abbc-f69c1e46d54b`
    - `created_at: 2026-04-16T13:32:31.550+00:00`
  - acceptance: `passed = true`
  - invalid steps: `[]`
- Deterministic pdf:
  - `200 application/pdf 167387`

### `gads-7649590091`
- Deterministic prepare:
  - response bevat `prepared_context_id: bdc44cc3-df8d-4678-8c8a-2721e659f2af`
  - `analysis_date: 2026-03-30`
- Deterministic monthly rerun:
  - `job_id: DF4CB837-4EFA-4D6B-A8A0-B2A97597E576`
  - `generation_jobs.status: completed`
  - `message: Maandelijkse SOP-analyse gereed.`
- Deterministic quality/save:
  - `quality_gate_monthly_v2`
    - `id: ccec7daf-bd6e-4609-b54c-2227da7a1cc6`
    - `created_at: 2026-04-16T13:32:23.782+00:00`
  - `full`
    - `id: 433baa4a-6695-4195-966b-6321f0600a31`
    - `created_at: 2026-04-16T13:32:23.877+00:00`
  - `structured_monthly_v2`
    - `id: ae7254fd-5478-4c6b-a289-1a32a08ff351`
    - `created_at: 2026-04-16T13:32:23.952+00:00`
  - acceptance: `passed = true`
  - invalid steps: `[]`
- Deterministic pdf:
  - `200 application/pdf 165661`

## 7. Kwaliteitsbeoordeling per case

### `gads-8794436501`
- Deterministic primary thread:
  - `Campagne: UK-MPC - Apple - Generic - Automated mist vraag door budgetbeperking.`
- Deterministic root cause:
  - `Budget is ontoereikend om de stijgende vraag in het Apple Generic segment op te vangen bij een ROAS van 3.67x.`
- Deterministic hypotheses:
  - expliciet zichtbaar als aparte operating-detail laag
  - 3 hypotheses aanwezig
- Deterministic continuity:
  - alle final recommendations object: `UK-MPC - Apple - Generic - Automated`
  - alle final tasks object: `UK-MPC - Apple - Generic - Automated`
- Deterministic what-is-not-the-problem:
  - gevuld met 2 rejected alternatives in stored output
- Inferred beoordeling:
  - SOP-dekking: `8.2`
  - Inzicht / waarom: `8.0`
  - Actionability: `8.1`
  - Leesbaarheid: `7.9`
- Inferred oordeel:
  - dit blijft de sterkere van de twee cases
  - hypotheses zijn nu zichtbaar en bruikbaar
  - benchmark wint nog op scherpere formulering van hypothesis-copy en op een rijkere executive succesframing

### `gads-7649590091`
- Deterministic primary thread:
  - `Campagne: 2. PMAX_Behandeling vraagt een scherpere maanddiagnose.`
- Deterministic root cause:
  - `Scherpe daling in CTR (-30.5%) en impressies (-36.5%) leidt tot halvering van het klikvolume.`
- Deterministic hypotheses:
  - expliciet zichtbaar als aparte operating-detail laag
  - 3 hypotheses aanwezig
- Deterministic continuity:
  - alle final recommendations object: `2. PMAX_Behandeling`
  - alle final tasks object: `2. PMAX_Behandeling`
- Deterministic what-is-not-the-problem:
  - gevuld met 2 secundaire alternatieve threads in stored output
- Inferred beoordeling:
  - SOP-dekking: `7.8`
  - Inzicht / waarom: `7.3`
  - Actionability: `7.8`
  - Leesbaarheid: `7.2`
- Inferred oordeel:
  - deze case is duidelijk beter op continuity dan pre-P6
  - hypotheses zijn nu expliciet zichtbaar
  - de primary thread zelf blijft inhoudelijk nog te generiek verwoord; benchmarkniveau wordt hier nog niet gehaald

## 8. Wat aantoonbaar beter is
- Deterministic:
  - beide nieuwste `full` outputs bevatten nu expliciet:
    - `## Operating detail: Hypotheses and next-month proof`
  - beide nieuwste `structured_monthly_v2` outputs bevatten een echte hypotheselaag
  - `gads-7649590091` is niet meer keyword/device-fragmented in de executive recommendations/tasks; alles blijft nu op `2. PMAX_Behandeling`
  - `gads-8794436501` blijft minstens even sterk en houdt recommendations/tasks strak op de gekozen Apple Generic thread
  - de export/PDF-laag neemt de nieuwe hypothesesection mee
- Inferred:
  - de Monthly SOP voelt nu duidelijk meer als hypotheses + sprintplan output dan voor P6
  - het verschil zit niet alleen in betere interne synthese, maar in zichtbare hypothesestructuur in de uiteindelijke deliverable

## 9. Wat nog resteert
- Deterministic:
  - `gads-7649590091` gebruikt nog een te generieke executive primary-thread zin:
    - `vraagt een scherpere maanddiagnose`
- Deterministic:
  - hypothesis-copy bevat nog templated taal en kan compacter/zakelijker
- Inferred:
  - benchmark wint nog op:
    - compactere executive hypothesis framing
    - scherper onderscheid tussen hoofdverklaring en ondersteunende issues
    - rijkere success framing voor volgende maand

## 10. Eindoordeel
- Deterministic:
  - beide reruns zijn groen en hebben nieuwe geldige artifacts
  - hypotheses zijn nu expliciet zichtbaar in de uiteindelijke output
  - `gads-8794436501` blijft minstens even sterk
  - `gads-7649590091` is aantoonbaar beter op executive continuity
- Inferred:
  - de Monthly SOP voelt nu sterker aan als een echte hypotheses + sprintplan deliverable
  - benchmarkniveau is voor `gads-8794436501` dichter benaderd dan voor `gads-7649590091`
  - de grootste resterende kwaliteitsslag zit niet meer in infrastructuur of gating, maar in compactere executive phrasing voor diffuse primary threads
