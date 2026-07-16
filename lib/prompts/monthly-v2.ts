import {
  MONTHLY_STEP1_INSTRUCTION,
  MONTHLY_STEP2_INSTRUCTION,
  MONTHLY_STEP3_INSTRUCTION,
  MONTHLY_STEP4_INSTRUCTION,
  MONTHLY_STEP5_INSTRUCTION as MONTHLY_SEARCH_TERM_INSTRUCTION,
  MONTHLY_STEP6_INSTRUCTION as MONTHLY_CREATIVE_INSTRUCTION,
  MONTHLY_STEP8_INSTRUCTION as MONTHLY_GEO_INSTRUCTION,
  MONTHLY_STEP9_INSTRUCTION as MONTHLY_NETWORK_SCHEDULE_INSTRUCTION,
} from "@/lib/prompts/sop-prompts";

export const SOP_LOG_FORMATS: Record<number, string> = {
  1: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Gebruik dit format voor je bevindingen. Vervang alle tekst tussen [ ] door echte waarden.
De percentages en getallen hieronder zijn VOORBEELDEN van de structuur, NIET de echte waarden.
Vul ALTIJD de echte waarden uit de data in.

FORMAT:
"Het verschil van [werkelijk %] met [naam doelstelling] is te verklaren door [KPI A], [KPI B], [KPI C] - [KPI A] [stijgt/daalt] Maand op Maand met [werkelijk %] - dit ligt in lijn met de ontwikkeling van de afgelopen [aantal] maanden, waarin [KPI A] gemiddeld met [werkelijk %] [steeg/daalde] Maand op Maand - [KPI A] toont de afgelopen 2 maanden een [opwaartse/neerwaartse] trend van [startwaarde] naar [eindwaarde]."

Herhaal dit format voor elke relevante bevinding.`,
  2: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden uit de analyse.

FORMAT Werkwijze A (verklaring account performance):
"[Campagne X] & [Campagne Y] dragen sterk bij aan de [opwaartse/neerwaartse] trend van [KPI A] - [Campagne X] kent [KPI A] welke [werkelijk %] [hoger/lager] is dan het account gemiddelde en [steeg/daalde] met [werkelijk %] laatste maand ten opzichte van de maand daarvoor - Over de afgelopen 3 maanden vertoont [KPI A] een [opwaartse/neerwaartse] trend binnen [Campagne X] van [startwaarde] naar [eindwaarde] - [Er is geen terugkerende Trend geïdentificeerd / Er is een terugkerend patroon: ...]."

FORMAT Werkwijze B (campagne evaluatie):
"[Campagne X] presteert [bovengemiddeld/ondergemiddeld] afgelopen maand, waarbij [KPI A] [werkelijk %] [stijgt/daalt] ten opzichte van voorgaande maand en [KPI B] [werkelijk %] [stijgt/daalt] ten opzichte van voorgaande maand - In week [weeknummer of datum] is een breuklijn te identificeren, sinds dit moment presteert de campagne [werkelijk %] [meer/minder] op [KPI A] en [werkelijk %] [meer/minder] op [KPI B] dan het accountgemiddelde"

Voer BEIDE werkwijzen uit. Gebruik het juiste format per werkwijze.`,
  3: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden uit de analyse.

FORMAT Werkwijze A (verklaring campagne performance):
"[Ad Group X] & [Ad Group Y] dragen sterk bij aan de [opwaartse/neerwaartse] trend van [KPI A] - [Ad Group X] kent [KPI A] welke [werkelijk %] [hoger/lager] is dan het campagne gemiddelde en [steeg/daalde] met [werkelijk %] laatste maand ten opzichte van de maand daarvoor - Over de afgelopen 3 maanden vertoont [KPI A] een [opwaartse/neerwaartse] trend binnen [Ad Group X] van [startwaarde] naar [eindwaarde] - [Er is geen terugkerende Trend geïdentificeerd / Er is een terugkerend patroon: ...]."

FORMAT Werkwijze B (ad group evaluatie):
"[Ad Group X] presteert [bovengemiddeld/ondergemiddeld] afgelopen maand, waarbij [KPI A] [werkelijk %] [stijgt/daalt] ten opzichte van voorgaande maand en [KPI B] [werkelijk %] [stijgt/daalt] ten opzichte van voorgaande maand - In week [weeknummer of datum] is een breuklijn te identificeren, sinds dit moment presteert de ad group [werkelijk %] [meer/minder] op [KPI A] en [werkelijk %] [meer/minder] op [KPI B] dan het campagne gemiddelde"

Voer BEIDE werkwijzen uit.`,
  4: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden.

FORMAT:
"In [campagne / ad group naam] is sinds [maand/datum] een [dalende/stijgende] [KPI A] zichtbaar - sinds de week van [datum] is de [KPI A] [stabiel in een range tussen X en Y / verder gedaald naar X]"`,
  5: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden.

FORMAT Match Type analyse:
"[Match Type A] heeft afgelopen maand een [werkelijk %] [hogere/lagere] CTR, bij [werkelijk %] vertoningen [meer/minder], met [werkelijk %] klikken [meer/minder] dan [Match Type B] - de CPC is [werkelijk %] [hoger/lager] [en genereert X conversies / maar genereert geen conversies] afgelopen maand."

FORMAT Keyword bucket:
"[Keyword A] was voorgaande maand [en de maand daarvoor] geïdentificeerd als '[bucket naam]' - in de Trend Charts is te zien dat de vertoningen sinds [datum] [scherp toeneemt/afneemt] met een [dalende/stijgende] CTR; in dezelfde periode neemt het aantal klikken [gestaag toe/af], waarbij het aantal conversies [achterblijft/meegroeit]"`,
  6: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden.

FORMAT Custom Label / Categorie:
"[Custom Label X / Category X] presteert [bovengemiddeld/ondergemiddeld] afgelopen maand, waarbij [KPI A] [werkelijk %] [hoger/lager] is dan het account gemiddelde - In week [weeknummer] is een breuklijn te identificeren, sinds dit moment presteert [label/categorie] [werkelijk %] [meer/minder] op [KPI A] en [werkelijk %] [meer/minder] op [KPI B] dan het campagne gemiddelde"

FORMAT SKU-niveau:
"[X]% van de Ad Spend gaat naar 'under-index' items, terwijl [Y]% van de omzet uit 'over-index' komt - [SKU A], [SKU B], [SKU C] presteren ondermaats in [Campagne X]; deze sku's kennen een Ad Spend van €[bedrag] met een ROAS van [waarde]"

Als Merchant Center data ontbreekt: schrijf EXACT "Werkwijze A (Custom Labels/Categories): data niet beschikbaar door ontbrekende Merchant Center koppeling." en ga door.`,
  7: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden.

FORMAT Match Type:
"[Match Type A] heeft afgelopen maand een [werkelijk %] [hogere/lagere] CTR, bij [werkelijk %] vertoningen [meer/minder], met [werkelijk %] klikken [meer/minder] dan [Match Type B] - de CPC is [werkelijk %] [hoger/lager] [en genereert X conversies / maar genereert geen conversies]"

FORMAT Search Term bucket:
"[Search Term A] was voorgaande maand [en de maand daarvoor] geïdentificeerd als '[bucket]' - binnen [Campagne X] spendeerde deze zoekterm €[bedrag] bij [aantal] klikken en genereerde daarbij [aantal] conversies"`,
  8: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden.

FORMAT Asset:
"[Asset X] presteert sinds tijdframe [14/30/60/90] dagen [bovengemiddeld/ondergemiddeld/gemiddeld] - op tijdframe [volgende] presteerde deze [gemiddeld/anders], terwijl op tijdframe [volgende] deze [bovengemiddeld/ondergemiddeld] presteerde - kijkende naar de asset is dit te verklaren door [seasonality / creatieve moeheid / marktverandering / ...]"

FORMAT Ad Copy:
Zelfde structuur als Asset maar dan voor headlines/descriptions.

Analyseer per asset TYPE en vergelijk over ALLE beschikbare tijdframes.`,
  9: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden.

FORMAT:
"[Audience segment X] presteert [bovengemiddeld/ondergemiddeld] afgelopen maand, waarbij [KPI A] en [KPI B] [werkelijk %] [hoger/lager] liggen dan het gemiddelde - sinds week [weeknummer] is er een [neerwaartse/opwaartse] trend zichtbaar waarbij [KPI A] van [startwaarde] naar [eindwaarde] [daalt/stijgt] en [KPI B] van [startwaarde] naar [eindwaarde] [daalt/stijgt]"

Herhaal voor elk audience type. Als geen data beschikbaar: schrijf alleen "Audience data niet beschikbaar." en de standaard actie.`,
  10: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden.

FORMAT Device:
"[Device A] presteerde afgelopen maand [bovengemiddeld/ondergemiddeld], dit blijkt uit [KPI A] die [werkelijk %] [hoger/lager] dan gemiddeld ligt en [KPI B] die [werkelijk %] [hoger/lager] dan gemiddeld ligt - ook op engagement presteert [Device A] [bovengemiddeld/ondergemiddeld], [Engagement KPI] ligt [werkelijk %] [hoger/lager] dan het gemiddelde afgelopen maand"

FORMAT Engagement trend:
"De [bounce rate / engagement rate] neemt afgelopen maand [toe/af] naar [waarde] - deze significante [stijging/daling], van [startwaarde] naar [eindwaarde], is zichtbaar vanaf [datum]"

Als engagement KPI's ontbreken: schrijf EXACT "Engagement KPI data niet beschikbaar." en ga door.`,
  11: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden.

FORMAT:
"Binnen [Campagne X] presteert [Geografisch gebied Y] [bovengemiddeld/ondergemiddeld] afgelopen maand - dit blijkt uit [KPI A] ([werkelijk %] [bovengemiddeld/ondergemiddeld]), [KPI B] ([werkelijk %] [bovengemiddeld/ondergemiddeld]) en [KPI C] ([werkelijk %] [bovengemiddeld/ondergemiddeld]) - deze [bovengemiddelde/ondergemiddelde] performance is waarneembaar sinds [datum] en [stijgt/daalt] sindsdien van [startwaarde] naar [eindwaarde]."`,
  12: `## VERPLICHT Log-format (format is vast, waarden zijn DYNAMISCH uit echte data)

Vervang alle tekst tussen [ ] door echte waarden.

FORMAT Checkout:
"De drop-off van [checkout fase X] naar [checkout fase Y] is [werkelijk %] - deze [verhoogde/verlaagde] drop-off is zichtbaar op de 'this month' en 'last 14 days' funnels"
Als checkout data ontbreekt: schrijf EXACT "Checkout funnel data niet beschikbaar." en ga door.

FORMAT Schedule:
"[Weekdag X] presteert [bovengemiddeld/ondergemiddeld] over de laatste 2 maanden op [KPI A] ([werkelijk %] [hoger/lager] dan gemiddeld) en [KPI B] ([werkelijk %] [hoger/lager] dan gemiddeld) - op basis van de afgelopen 4 maanden [blijft deze observatie in stand / is dit een recent patroon]"

FORMAT Network:
"[Netwerk X] presteerde afgelopen maand [bovengemiddeld/ondergemiddeld] op [KPI A] ([werkelijk %] [hoger/lager] dan gemiddeld) en [KPI B] ([werkelijk %] [hoger/lager] dan gemiddeld) - op basis van de afgelopen 2 maanden [blijft deze observatie in stand / is dit een recent patroon]"

Voer ALLE drie werkwijzen uit.`,
  13: `Stap 13 heeft geen specifiek logformat; het is een synthese-stap. Gebruik de bevindingen in hun oorspronkelijke logformats.`,
};

export const STEP_PURITY_CONTRACTS: Record<number, string> = {
  1: `### Step-Purity Contract
- Doel: accountstatus, KPI-keten, target-gap en trendstatus duiden
- Leidende databronnen: account month-data, targets, YoY/MoM, change history, benchmarks
- Mag beoordelen: account en hooguit campagne-allocatie als accountverklaring
- Primaire metrics: Conversies, Omzet, Spend, ROAS/CPA, CVR, CTR, CPC
- Mag concluderen: status, target-gap, trendrichting, waarschijnlijke bottleneck in de KPI-keten
- Mag NIET concluderen: keyword/search term/feed/creative/audience/device/geo/network als definitieve hoofdoorzaak
- deterministic: direct zichtbaar in accountdata en targets
- inferred/hypothesis/unknown: oorzaak buiten accountniveau of zonder voldoende historie
- Acties: alleen accountbrede containment, pacing, tracking-check of allocatiesignaal; geen diepe domein-ingrepen`,
  2: `### Step-Purity Contract
- Doel: campagneverschillen, allocatie en winnaar/verliezer-patronen identificeren
- Leidende databronnen: campagnedata, budgetsignalen, target-gap, benchmarkcontext
- Mag beoordelen: campagnes en campagneportfolio
- Primaire metrics: Spend, Conversies, ROAS/CPA, Search IS, CVR
- Mag concluderen: welke campagnes het accountverschil dragen en of allocatie scheef is
- Mag NIET concluderen: zoektermen, feed, creative, audience, geo of network als definitieve root cause
- Acties: campagnebudget, targets, campagneprioriteit; geen negatives/feedfixes`,
  3: `### Step-Purity Contract
- Doel: verklaren welke ad groups/subclusters de campagnethread dragen
- Leidende databronnen: ad group performance en clusterverdeling
- Mag beoordelen: ad groups binnen de eerder benoemde campagnes
- Primaire metrics: Spend, Conversies, ROAS/CPA, CVR, CTR
- Mag concluderen: welk subcluster het probleem of de kans concentreert
- Mag NIET concluderen: auction pressure, zoektermen, feed, creative, geo, network of checkout als hoofdverklaring
- Acties: adgroup-bijsturing of structuur, geen feed/negative/geo-ingrepen`,
  4: `### Step-Purity Contract
- Doel: auction pressure, rank, impression share en budget caps isoleren
- Leidende databronnen: auction insights, impression share, budget/rank metrics
- Mag beoordelen: campagne/account vraagcapture
- Primaire metrics: Impression Share, Lost IS (Budget), Lost IS (Rank), overlap/ranking
- Mag concluderen: of vraagverlies door competitie of budget komt
- Mag NIET concluderen: feed, creative, search term, geo of audience root cause
- Acties: budget/rank/bidding-richting, nog geen diepe kanaal- of assortimentsingrepen`,
  5: `### Step-Purity Contract
- Doel: keyword-kwaliteit, match types en QS-mechaniek beoordelen
- Leidende databronnen: keyword performance, match type verdeling, quality score
- Mag beoordelen: keywords, keywordgroepen, gekoppelde campagnes/ad groups
- Primaire metrics: CTR, CPC, CVR, CPA, ROAS, QS
- Mag concluderen: welke keywords vraagkwaliteit of efficiency verklaren
- Mag NIET concluderen: search term routing, feed/SKU, geo, audience, network of checkout als hoofdclaim
- Acties: keyword/match type/QS-richting; geen search term-uitsluitingen als hoofdactie`,
  6: `### Step-Purity Contract
- Doel: productmix, feed en SKU-drivers verklaren
- Leidende databronnen: product performance, custom labels, Merchant Center verrijking
- Mag beoordelen: producten, SKU's, labels, categorieën en productgroepen
- Primaire metrics: Spend, Conversies, ROAS, CVR, Omzet, indexatie over labels/categorieën
- Mag concluderen: of assortiment, feed of mix de performance drijft
- Mag NIET concluderen: audience, geo, network of schedule als hoofdverklaring
- Acties: containment op verlieslatende SKU's en recovery via feed/mix/productstructuur`,
  7: `### Step-Purity Contract
- Doel: zoektermintentie, routing en veilige uitsluitbaarheid bepalen
- Leidende databronnen: search term data plus context uit keyword/productstappen
- Mag beoordelen: search terms en hun routing naar campagnes/ad groups/producten
- Primaire metrics: Wasteful Spend, Conversies, CVR, ROAS, intentclassificatie
- Mag concluderen: irrelevante intent, modifier mismatch, routing mismatch of veilige uitsluiting
- Mag NIET concluderen: creative, geo, audience, network of checkout als hoofdverklaring
- Acties: containment via veilige uitsluiting, recovery via routing/LP/feed/structuur; geen brede accountconclusies`,
  8: `### Step-Purity Contract
- Doel: creative/asset/message mismatch toetsen
- Leidende databronnen: asset- en ad-copy performance over meerdere windows
- Mag beoordelen: creatives, assets, ad copy en gekoppelde campagnes/ad groups
- Primaire metrics: CTR, CVR, ROAS, asset/ad performance labels
- Mag concluderen: message-market mismatch of creatieve sterkte/zwakte
- Mag NIET concluderen: keyword/search term/feed/geo/network als primaire root cause
- Acties: creative containment of herstel via asset/copy-iteraties`,
  9: `### Step-Purity Contract
- Doel: audience-segmenten als versterker of ontkrachter van de hoofdthread beoordelen
- Leidende databronnen: audience-dimensies en spend share
- Mag beoordelen: age, gender, income, in-market, affinity en gekoppelde campagnes
- Primaire metrics: Spend share, CVR, CPA, ROAS
- Mag concluderen: audience-inefficiency of juist ondersteunende pockets
- Mag NIET concluderen: geo, feed, network, search term of creative als hoofdverklaring
- Acties: audience-bijsturing of monitoring; geen feed/search term-ingrepen`,
  10: `### Step-Purity Contract
- Doel: device- en engagementsignalen scheiden in oorzaak, symptoom of bevestiging
- Leidende databronnen: device KPI's en engagementmetrics
- Mag beoordelen: mobile/desktop/tablet en eventueel campaign overlays
- Primaire metrics: CVR, CPA, ROAS, CTR, engagement rate, bounce rate
- Mag concluderen: device-verschillen en of engagement de thread ondersteunt
- Mag NIET concluderen: geo, network, search term of productmix als hoofdverklaring
- Acties: device containment of device-test; geen geo/network/feed maatregelen`,
  11: `### Step-Purity Contract
- Doel: geografische under- en overperformance isoleren
- Leidende databronnen: land/regio performance, trends en spend share
- Mag beoordelen: landen/regio's en gekoppelde campagnecontext
- Primaire metrics: ROAS, CPA, Spend share, Conversies, YoY/MoM
- Mag concluderen: waar geo-allocatie het account schaadt of helpt
- Mag NIET concluderen: search term, feed, audience, network of checkout als primaire oorzaak
- Acties: containment via budget/exclusie en recovery via aparte geo-setup als verdedigbaar`,
  12: `### Step-Purity Contract
- Doel: checkout, planning en netwerk als downstream verklarers of beperkingen toetsen
- Leidende databronnen: funnel, schedule, network mix
- Mag beoordelen: checkoutstappen, dagdelen, netwerken en device-doorsnedes
- Primaire metrics: drop-off rates, CPA/ROAS per uur/netwerk, spend share
- Mag concluderen: of verlies in funnel, planning of inventory ontstaat
- Mag NIET concluderen: feed, keyword/search term, audience of geo als primaire root cause
- Acties: network/schedule containment of checkout-validatie/herstelroute`,
  13: `### Step-Purity Contract
- Doel: alleen synthese, prioritering en sprintvertaling
- Leidende databronnen: checkpoints en geconsolideerde step outputs
- Mag beoordelen: threads, prioriteiten, hypotheses, aanbevelingen en taken
- Primaire metrics: cross-step support, impact, evidence level, ICE
- Mag concluderen: hoofdverhaal, prioriteiten, containment vs recovery keuzes
- Mag NIET concluderen: nieuwe diepgaande analyses die niet in eerdere stappen bewezen zijn
- Acties/hypotheses: promoveren uit step-actions; weak evidence blijft hypothesis-driven`,
};

function withStepPurityContract(step: number, instruction: string): string {
  const logFormat = SOP_LOG_FORMATS[step] || "";
  return `${instruction}\n\n${logFormat}\n\n${STEP_PURITY_CONTRACTS[step]}`;
}

export const MONTHLY_V2_STEP_INSTRUCTIONS: Record<number, string> = {
  1: withStepPurityContract(1, MONTHLY_STEP1_INSTRUCTION),
  2: withStepPurityContract(2, `${MONTHLY_STEP2_INSTRUCTION}

## VERPLICHTE WERKWIJZEN (voer ALLE uit)

WERKWIJZE A - Verder verklaren Account Performance:
- Identificeer welke campagnes bijdragen aan de eerder gevonden KPI-verschuivingen
- Toon MoM vergelijking (Last Month vs Month Before Last)
- Bekijk Trend Charts over 3 maanden: is er een trend?
- Bekijk wekelijkse performance: zijn er terugkerende patronen?
- Log in het voorgeschreven format

WERKWIJZE B - Campagne evaluatie:
- Identificeer boven/ondergemiddeld presterende campagnes
- Toon MoM vergelijking voor deze campagnes
- Identificeer trend of breuklijn in Trend Charts
- Bevestig in week-over-week data
- Log in het voorgeschreven format

VERBODEN in acties:
- gebruik GEEN werkwoorden als "onderzoek", "analyseer", "optimaliseer" of "consolideer"
- formuleer validatie als concrete Google Ads handeling, bijvoorbeeld via aparte lijst, aparte campagne, budgetrem of target-aanpassing

Als data voor een werkwijze ontbreekt: schrijf EXACT "Werkwijze [A/B]: [reden]." in 1 zin en ga door.`),
  3: withStepPurityContract(3, `${MONTHLY_STEP3_INSTRUCTION}

## VERPLICHTE WERKWIJZEN (voer ALLE uit)

WERKWIJZE A - Verder verklaren Campagne Performance:
- Identificeer welke ad groups bijdragen aan de eerder gevonden KPI-verschuivingen
- Toon MoM vergelijking
- Bekijk Trend Charts over 3 maanden
- Controleer week-over-week patronen
- Log in het voorgeschreven format

WERKWIJZE B - Ad group evaluatie:
- Identificeer boven/ondergemiddeld presterende ad groups
- Toon MoM vergelijking voor deze ad groups
- Identificeer trend of breuklijn
- Bevestig in week-over-week data
- Log in het voorgeschreven format

Als data voor een werkwijze ontbreekt: schrijf EXACT "Werkwijze [A/B]: [reden]." in 1 zin en ga door.`),
  4: withStepPurityContract(4, `${MONTHLY_STEP4_INSTRUCTION}

## VERPLICHTE WERKWIJZE

- Bekijk Auction Insights by Month voor trend of breuklijn
- Bekijk Auction Insights by Week voor week-over-week bevestiging
- Log in het voorgeschreven format

Als data voor deze werkwijze ontbreekt: schrijf EXACT "Werkwijze A: [reden]." in 1 zin en ga door.`),
  5: withStepPurityContract(5, `## Stap 5: Keyword Performance

### Kritieke instructie
Voer ALLE werkwijzen uit:
- Werkwijze A: match type analyse + keyword bucketing
- Werkwijze B: verklaar eerder geïdentificeerde zwakke campagnes/ad groups via keywords
- Werkwijze C: quality score analyse inclusief subfactoren

### Werkwijze A
1. Vergelijk EXACT, PHRASE en BROAD op impressies, CTR, CPC, conversies, CPA en ROAS.
2. Bucket keywords als Bestseller / Bleeder / No Clicks / No Visibility.
3. Valideer outliers over 3 maanden; benoem alleen materiële patronen.

### Werkwijze B
1. Zoom expliciet in op campagnes/ad groups die in stap 2-4 als underperformer zijn benoemd.
2. Benoem welke keywords daar het probleem verklaren en welke juist winning pockets zijn.

### Werkwijze C
1. Rapporteer gemiddelde QS en range.
2. Vergelijk KPI's per QS-bucket: 1-4, 5-6, 7-10.
3. Analyseer subfactoren Expected CTR, Ad Relevance en Landing Page Experience.
4. Benoem expliciet als QS-data ontbreekt; verzin die data niet.
`),
  6: withStepPurityContract(6, `## Stap 6: Product Performance

### Kritieke instructie
Gebruik productdata verrijkt met Merchant Center.
Voer ALLE werkwijzen uit:
- Werkwijze A: custom labels + categorieën
- Werkwijze B: SKU-niveau analyse

### Werkwijze A
1. Analyseer performance per custom_label_0 en product_type_l1/l2.
2. Benoem outlier-labels en categorieën met 3-maands trendvalidatie.
3. Cross-reference met eerdere campagne- en ad group-bevindingen.

### Werkwijze B
1. Beoordeel spend-verdeling naar under-index vs over-index items.
2. Bucket SKU's als Bestseller / Bleeder / No Clicks / No Visibility.
3. Benoem top bleeders en top bestsellers.
4. Gebruik Merchant Center verrijking:
   - voorraadstatus
   - prijs / sale_price
   - custom labels
   - product type hiërarchie
`),
  7: withStepPurityContract(7, `## Stap 7: Search Term Performance

${MONTHLY_SEARCH_TERM_INSTRUCTION}

### Extra v2 instructie
Open expliciet met een verwijzing naar de patronen uit keyword- en productanalyse (stap 5 en 6).`),
  8: withStepPurityContract(8, `## Stap 8: Creative Performance

${MONTHLY_CREATIVE_INSTRUCTION}

### Extra v2 instructie
Voer zowel asset- als ad-copy analyse uit over 14d / 30d / 60d / 90d. Open expliciet met een verwijzing naar stap 7.`),
  9: withStepPurityContract(9, `## Stap 9: Audience Performance

### Kritieke instructie
Analyseer audience performance per dimensie: age, gender, income, in_market, affinity.
Als een dimensie geen materieel signaal geeft, zeg dat expliciet en ga door naar de volgende.

### Werkwijze
1. Vergelijk groepen binnen elke dimensie op ROAS, CPA, CVR en spend share.
2. Flag alleen significante outliers.
3. Valideer trends over 3 maanden.
4. Cross-reference naar eerdere bevindingen: welke audience-groepen versterken of ontkrachten de hoofdthread?
`),
  10: withStepPurityContract(10, `## Stap 10: Device & Engagement Performance

### Kritieke instructie
Vergelijk devices op KPI's en op engagementsignalen. Als engagementdata ontbreekt, noem dat expliciet.

## VERPLICHT: Engagement KPI's
Analyseer naast KPI 1-10 ook:
- Bounce Rate per device
- Engagement Rate per device
- Average Session Duration per device

Als deze data ontbreekt: schrijf EXACT "Engagement KPI data niet beschikbaar." en ga door.

### Werkwijze
1. Vergelijk MOBILE, DESKTOP en TABLET op impressies, CTR, clicks, CPC, cost, CVR, conversies, CPA en ROAS.
2. Gebruik engagement metrics als beschikbaar: bounce_rate, engagement_rate, avg_session_duration.
3. Zoom in op eerder geïdentificeerde zwakke campagnes of ad groups.
4. Benoem of device-signalen een oorzaak, symptoom of bevestiging zijn van de hoofdthread.
`),
  11: withStepPurityContract(11, `## Stap 11: Geografische Performance

${MONTHLY_GEO_INSTRUCTION}

### Extra v2 instructie
Open expliciet met een verwijzing naar stap 10 en houd de focus op regio/land performance in plaats van een brede accountsamenvatting.`),
  12: withStepPurityContract(12, `## Stap 12: Checkout, Schedule & Network Performance

### Kritieke instructie
Voer ALLE werkwijzen uit:
- Werkwijze A: checkout funnel
- Werkwijze B: ad schedule
- Werkwijze C: network
Als slechts één werkwijze data mist, benoem ALLEEN die specifieke werkwijze als data niet beschikbaar.
Zeg NIET dat de hele stap geen data heeft zolang schedule of network wel data bevat.
Maak alleen harde findings voor werkwijzen waar echt data voor aanwezig is.

### Werkwijze A — Checkout Funnel
1. Analyseer Add to Cart -> Begin Checkout -> Purchase.
2. Vergelijk this month vs last month vs 3 months ago.
3. Splits uit naar device.
4. Benoem expliciet verhoogde drop-off en welke campagnes hiermee samenhangen.

### Werkwijze B — Schedule
1. Vergelijk weekdagen en uurblokken.
2. Valideer significante verschillen over meerdere maanden indien data dat toelaat.
3. Benoem concrete budgetvensters en inefficiënte vensters.

### Werkwijze C — Network
1. Vergelijk Search, Display, YouTube en Partners.
2. Benoem of netwerkmix de hoofdthread versterkt of tegenspreekt.
3. Geef alleen concrete netwerkacties, geen vage optimalisatietaal.
`),
  13: withStepPurityContract(13, `## Stap 13: Hypotheses & Sprintplanning

### Kritieke instructie
Dit is synthese, geen nieuwe analyse. Gebruik uitsluitend checkpoint C plus de geconsolideerde step outputs.

### Taken
1. Formuleer een executive layer met:
   - Account snapshot (5 KPI's vs target)
   - primaire thread + 2 ondersteunende threads
   - top 3 prioriteiten met verwachte impact
   - action plan: week 1 / week 2-3 / week 4+
   - success criteria volgende maand
2. Formuleer exact 3 hypotheses met ICE-score spread > 2.0.
3. Genereer concrete acties en taken zonder verboden woorden.
4. Vermijd herhaling van eerdere step-dieptes; focus op synthese en prioritering.

## Aanbevelingen-generatie (STRIKT)

Je mag GEEN nieuwe aanbevelingen formuleren.
Je PROMOVEERT de beste acties uit de 13 stappen naar aanbevelingen.

Werkwijze:
1. Verzamel alle "actions" uit de 13 step outputs
2. Rangschik op verwachte_impact (hoogste eerst)
3. Neem de top 3 als aanbevelingen, LETTERLIJK overgenomen uit de stap-actie
4. Voeg alleen de ICE-score en termijn toe
5. Als een probleemcluster duidelijke underperformance toont, promoot waar mogelijk zowel:
   - een containment-route
   - een recovery-route
   binnen dezelfde synthese-aanbeveling of als expliciete alternatief-route

VERBODEN in aanbevelingen:
- "Heralloceer" (te vaag - WAT naar WAAR?)
- "Wijzig de hoofdhefboom" (onbegrijpelijk voor een klant)
- "Consolideer" / "Optimaliseer" (geen actie)
- "Definieer kanaalownership" (processtap, geen Google Ads actie)

VERPLICHT format:
"[Werkwoord] [wat] [waar] [naar welke waarde/met welk percentage]"

Voorbeeld GOED: "Verlaag dagbudget Bestseller_RM met 20% naar €128/dag"
Voorbeeld FOUT: "Heralloceer geo-budget rond Bestseller_RM"

## ICE-scoring regels (STRIKT)

De 3 aanbevelingen MOETEN een spread van minimaal 2.0 hebben
tussen de hoogste en laagste ICE-score.

Scoring-logica:
- Impact (I):
  - 9-10: Actie raakt >50% van de totale spend of het primaire KPI-target
  - 7-8: Actie raakt 20-50% van spend of een secundair target
  - 5-6: Actie raakt <20% van spend of een tertiair target
  - 3-4: Actie raakt een enkel segment zonder accountbrede impact
- Confidence (C):
  - 9-10: Bewezen door data in 3+ stappen (evidence_level = deterministic)
  - 7-8: Bewezen door data in 2 stappen
  - 5-6: Gebaseerd op 1 stap of inference
  - 3-4: Hypothese zonder directe data-ondersteuning
- Ease (E):
  - 9-10: 1 knop in Google Ads, <5 minuten
  - 7-8: Meerdere instellingen, <30 minuten
  - 5-6: Vereist feed/structuur wijziging, 1-2 uur
  - 3-4: Vereist landingspagina/propositie wijziging buiten Google Ads

Forceer differentiatie:
- De #1 aanbeveling (meest urgent, meest bewezen) MOET ICE >= 7.5 krijgen
- De #3 aanbeveling (strategisch, langere termijn) MOET ICE <= 5.5 krijgen
- Het verschil tussen #1 en #3 MOET >= 2.0 zijn

## Evidence-discipline in synthese (STRIKT)

- deterministic = mag klinken als directe actie
- inferred = mag klinken als waarschijnlijke route, niet als bewezen oplossing
- hypothesis/unknown = label expliciet als test, gecontroleerde herstelroute of onbewezen alternatief
- geef geen tegenstrijdige acties op dezelfde entiteit zonder expliciete context:
  - containment = verlies beperken
  - recovery = gecontroleerd herstel testen
  - volume push = pas na bewijs dat efficiency onder controle is
`),
};

export const MONTHLY_STEP7_CLASSIFICATION_INSTRUCTION = `## Stap 7A: Search Term Classification

### Kritieke instructie
Dit is deel A van stap 7. Focus alleen op classificatie, intent en bewijssterkte.
Formuleer nog GEEN brede eindsynthese voor de stap.

### Taken
1. Classificeer zoektermen als protected_relevant, review_first, safe_to_exclude of onduidelijk.
2. Koppel termen aan keyword- en productpatronen uit stap 5 en 6.
3. Benoem alleen harde of zorgvuldig geïnfererde signalen.
4. Beperk acties tot maximaal 1 tussentijdse actie als dat echt nodig is.`;

export const MONTHLY_STEP7_ACTIONS_INSTRUCTION = `## Stap 7B: Search Term Actions & Savings

### Kritieke instructie
Dit is deel B van stap 7. Gebruik de classificatie uit deel A als waarheid.
Focus op concrete uitsluitingen, routing-acties en besparingspotentieel.
VERBODEN: Herhaal NIET het classificatie-narratief uit deel A.
Begin direct met je acties en besparingspotentieel.

### Taken
1. Neem alleen termen over die in deel A materieel of actiegericht zijn.
2. Vertaal de classificatie naar concrete Google Ads acties.
3. Kwantificeer het besparings- of verbeterpotentieel.
4. Lever de definitieve stapconclusie voor stap 7 op.`;

export function buildMonthlyCheckpointPrompt(clusterName: string): string {
  return `## Rol
Je bent de kwaliteitscontroleur van de maandelijkse SEA-analyse.
Je voert GEEN nieuwe analyse uit. Je consolideert alleen.

## Cluster
${clusterName}

## Taken
1. Dedupliceer bevindingen op entiteit + metric.
2. Markeer welke patronen bevestigd worden door 2+ stappen.
3. Noteer expliciet tegenspraken of open vragen.
4. Formuleer de primaire thread in 2-3 zinnen.
5. Houd maximaal 15 geconsolideerde bevindingen over.

## Output
Retourneer ALLEEN strict JSON met:
{
  "consolidated_findings": [
    {
      "entiteit": "string",
      "metric": "string",
      "ernst": "critical|high|medium|low|positive",
      "samenvatting": "string",
      "bevestigd_door": ["stap X"]
    }
  ],
  "primary_thread": "string",
  "confirmed_patterns": [
    { "pattern": "string", "confirmed_by": ["stap X", "stap Y"] }
  ],
  "contradictions": [
    { "finding_a": "string", "finding_b": "string", "resolution_needed": "string" }
  ],
  "running_context": "string"
}`;
}
