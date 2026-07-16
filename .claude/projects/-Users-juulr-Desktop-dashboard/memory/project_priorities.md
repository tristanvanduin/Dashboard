---
name: Development Priorities Q2 2026
description: Prioriteitenlijst voor doorontwikkeling dashboard — afgestemd op 8 april 2026
type: project
---

## Development Priorities — Dashboard

### Prioriteit 1: Sync UI + Scheduled Sync
- Sync knop per client in dashboard header
- Freshness badge (vers/stale/missing) zichtbaar
- Cron-route voor nachtelijke automatische sync
- Sync status in client settings
- **Waarom:** SOP's falen als data niet gesync'd is — #1 vertrouwensprobleem

### Prioriteit 2: Weekly/Biweekly SOP hardening naar monthly niveau
- Structured findings extraction (Zod) voor weekly + biweekly
- Action gating toepassen op weekly/biweekly output
- Vergelijkbaar kwaliteitsniveau als monthly multi-step pipeline
- **Waarom:** Kritische reviewer ziet kwaliteitsverschil tussen SOP types

### Prioriteit 3: Client rapportage feature (NIEUW)
- Automatische rapportage per client op basis van:
  - Sprintplanning + uitgevoerde taken
  - Change historie
  - SOP uitkomsten (monthly/biweekly/weekly)
  - Geüploade rapportage templates uit klantenmap (Bestanden)
- PDF output per client
- Rapportage opslaan in Bestanden > Rapportages map
- **Waarom:** Operationeel zeer waardevol — bespaart uren handmatig rapportagewerk

### Prioriteit 4: PMAX Deep Intelligence Dashboard
- PMAX tab met network mix chart
- Asset group performance tabel
- Placement waste top-10
- Search category analyse
- Asset quality overzicht
- **Waarom:** Concurrentievoordeel — bijna niemand levert dit geautomatiseerd

### Prioriteit 5: Search Terms historische trend + bulk acties
- Vergelijk huidige run met vorige run
- Markeer terugkerende waste termen
- Toon trend per zoekterm over tijd
- Bulk actie suggesties voor herhaalde patronen
- **Waarom:** Maakt search term analyse veel sterker en actie-gerichter

### Prioriteit 6: Client health portfolio dashboard
- Overzichtspagina alle 66 clients
- Health scores per client
- Freshness status
- Laatste SOP datum
- Alerts voor clients die aandacht nodig hebben
- **Waarom:** Schaalbaarheid — met 66 clients moet je snel zien wie aandacht nodig heeft

---

## Status per onderdeel (8 april 2026)

| Onderdeel | Niveau | Notitie |
|-----------|--------|---------|
| Monthly SOP | 8/10 | Sterkste flow, multi-step, Zod, action gating |
| Weekly SOP | 7/10 | Single-pass, mist structured extraction |
| Biweekly SOP | 7/10 | Zelfde als weekly |
| Second Opinion | 8.5/10 | PDF + editbaar + executive summary |
| Search Terms | 8/10 | 160/160 coverage, guardrails, intent model |
| Forecast | 7.5/10 | Engine solide, UI basic |
| Sync Pipeline | 8/10 | Werkt via API, mist UI + cron |
| PMAX Intelligence | 6/10 | Data in Supabase, expert layer basic |
| Data Reliability | 7/10 | Assessment + mode switching werkt |
| Conversion Lag | 8/10 | Per-client configureerbaar + UI |
