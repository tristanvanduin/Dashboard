# Ontwerp: geo-clone-projecten (beurzen → geo-clones als eigen laag)

Doel: een RAI-account bevat meerdere beurzen/geo-clones (bv. GreenTech → Amsterdam, Americas,
North America), gesplitst op campagnenaam. Elke geo-clone moet een **eigen project** worden met
**eigen instellingen, branding, doelstellingen en editie-datums**, gegroepeerd onder de beurs in
het linkermenu.

## 1. De kern-observatie die alles bepaalt

Geo-clones zitten **binnen één ad-account** (één `client`), niet als aparte accounts. De splitsing
zit in de **campagnenaam** (de afkorting, bv. `GTA`/`GTAM`/`GTNA`), en `lib/rai/geo-clone-catalog.ts`
matcht die al (`matchGeoCloneByCampaignName`, `assignCampaigns`, `visibleGeoClones`).

Gevolg: een geo-clone is **geen tweede account-record**, maar een **scope/filter binnen het account**
op campagnenaam. Dat is de schone weg — geen dubbele sync, geen dubbele data, één bron.

Bestaande `client_groups` (map → clients in de sidebar) blijft bestaan voor het groeperen van
losse *accounts*; de beurs→geo-clone-structuur is een **laag daarbinnen**, per account.

## 2. Begrippen en hiërarchie

```
Account (client, = 1 ad-account)
  └─ Beurs (brand, bv. "GreenTech")          ← afgeleid uit de geo-clones in de campagnes
       ├─ Geo-clone (project, bv. "GreenTech Amsterdam" / GTA)
       ├─ Geo-clone ("GreenTech Americas" / GTAM)
       └─ Geo-clone ("GreenTech North America" / GTNA)
```

Een **geo-clone-project** = (account, afkorting). Alle data van dat project = de campagnes waarvan
de naam die afkorting draagt. Een account zonder geo-clones (bv. een agency-klant) gedraagt zich
exact als nu: geen beurs-laag, geen geo-clone-kiezer.

## 3. Datamodel

### 3.1 Welke geo-clones bestaan er per account
Twee bronnen, samengevoegd:
- **Auto-detectie**: `visibleGeoClones(campaignNames)` uit de catalogus — toont alleen varianten
  waarvan de afkorting echt in een campagnenaam voorkomt (hide-if-absent).
- **Handmatig**: de `client_settings.rai_events`-lijst die nu al bestaat (migratie 024). Elke
  entry heeft `name` + `abbrev` + `cadence` + `editions` → dat **is** precies een geo-clone-project.

De `abbrev` is de sleutel die beide verbindt: hij matcht de campagnenaam én identificeert het project.

### 3.2 Per-geo-clone instellingen (branding, doelen, datums)
Vandaag staan `kpi_targets`, `brand_guide` en `rai_events` op **account-niveau** (`client_settings`).
Voor per-geo-clone overrides:

**Voorstel: één jsonb-overlay per account, gesleuteld op afkorting.**
```
client_settings.geo_clone_overrides jsonb =
  { "GTA":  { kpiTargets?, brandGuide?, editions?, cadence? },
    "GTAM": { ... } }
```
- Ontbreekt een veld voor een geo-clone → val terug op de **account-waarde** (de huidige velden).
- Zo blijft alles backward-compatible: bestaande accounts zonder overrides werken ongewijzigd.
- Alternatief (zwaarder): een aparte tabel `geo_clone_settings (client_id, geo_clone, settings jsonb)`.
  Voorkeur: de jsonb-overlay, spiegelt het bestaande `client_settings`-patroon en kost één migratie.

### 3.3 De editie-datums horen per geo-clone
De `rai_events`-entries dragen `editions` al per event → die verhuizen conceptueel naar het
geo-clone-project. Concreet: elke `rai_events`-entry **is** een geo-clone (met `abbrev`), dus de
datums zitten al op de goede plek; alleen de koppeling entry↔campagnes via `abbrev` moet expliciet.

## 4. Scoping-mechanisme (hoe "kies ik een geo-clone")

Een `geoClone`-context (afkorting) die de hele dashboard-weergave filtert:
- URL: `/client/[clientId]?geo=GTA` (deelbaar, refreshbaar) — de voorkeur boven losse state.
- Alle datasets filteren op campagnenaam via `assignCampaigns` / `matchGeoCloneByCampaignName`.
- `geo` leeg = het hele account (huidige gedrag).
- Account-brede tabellen zonder campagnenaam (bv. account_daily) → tonen met een expliciete
  "hele account"-note wanneer een geo-clone gekozen is, want die zijn niet per geo-clone te splitsen.

## 5. Menu / sidebar

Uitbreiding van de bestaande collapsible-group-render:
```
[Account: GreenTech B.V.]            ← bestaand client-item
   ▸ GreenTech (beurs)               ← nieuwe beurs-groep (auto uit geo-clones)
       • Amsterdam (GTA)             ← geo-clone-project → /client/greentech?geo=GTA
       • Americas (GTAM)
       • North America (GTNA)
```
- Beurs-groepen worden **afgeleid** (brand → zijn geo-clones) uit `visibleGeoClones` + `rai_events`.
- Accounts zonder geo-clones tonen géén beurs-laag (blijft een plat client-item).
- Hergebruikt de bestaande inklap-logica van `client_groups` in de sidebar.

## 6. Wat dit ontsluit (waarom het de moeite waard is)

- **Vergelijking & forecast worden correct**: met cadans + editie-datums per geo-clone kan
  `lib/rai/event-comparison` + `event-forecast` de huidige editie tegen de **juiste** vorige editie
  zetten (jaarlijks/2-jaarlijks), i.p.v. kalender-MoM/YoY.
- **Eigen branding & doelen per beurs**: het dashboard themet per geo-clone (bestaande
  `resolveEventTheme`), en de KPI's/targets gelden per beurs.
- **Overzicht**: de gebruiker ziet per beurs de losse projecten netjes gegroepeerd.

## 7. Fasering (elk stuk apart bouwbaar + testbaar)

1. **Geo-clone-scope**: `geoClone`-context (URL-param) + het filteren van de bestaande views op
   campagnenaam. Toont de kiezer alleen als er geo-clones zijn. *(puur filter-werk, geen datamodel)*
2. **Per-geo-clone instellingen**: migratie `geo_clone_overrides` + de settings-UI uitbreiden zodat
   branding/doelen/datums per geo-clone kunnen (met account-fallback).
3. **Sidebar-groepering**: beurs→geo-clone in de sidebar, afgeleid uit de catalogus + `rai_events`.
4. **RAI-vergelijking/forecast-wiring**: de per-geo-clone cadans + datums voeden `lib/rai` en
   vervangen de kalender-vergelijking in de prepared context. *(de eigenlijke analyse-winst)*

## 8. Open beslissingen voor Tristan

1. **Afkortingen bevestigen**: de catalogus heeft de meeste als `confirmed: false` (best-guess:
   merkcode + locatie). Alleen `AQM` en `ICC` zijn bevestigd. Kloppen bv. `GTA/GTAM/GTNA` met jullie
   campagnenaam-conventie? Zo niet, dan corrigeren we de catalogus (triviaal).
2. **Detectie vs handmatig**: willen we de geo-clones **automatisch** uit campagnenamen tonen, of
   alleen wat je handmatig in de event-instellingen zet? (Voorstel: auto-detectie + handmatige
   aanvulling/override — het beste van beide.)
3. **Account-brede metrieken**: bij een gekozen geo-clone tonen we account_daily met een "hele
   account"-note (niet splitsbaar). Akkoord, of die kaarten verbergen in geo-clone-scope?
4. **Overrides-vorm**: de jsonb-overlay (voorkeur, licht) of een aparte `geo_clone_settings`-tabel?
