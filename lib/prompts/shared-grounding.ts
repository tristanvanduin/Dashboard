// ============================================================
// Q1: gedeelde kwaliteitslaag, prompt-fragmenten
// ------------------------------------------------------------
// De wereldkennis-gronding hoort bij ELKE analyse, niet alleen de
// maand-SOP. Weekly, biweekly en de zoekterm-analyse erven hem hieruit,
// zodat geen enkele analyse een term als niet-bestaand of irrelevant
// bestempelt op basis van een trainings-cutoff.
// ============================================================

export const WORLD_KNOWLEDGE_GROUNDING = `## Wereldkennis en de aangeleverde data
Alle campagnes, zoektermen, producten en modellen in de aangeleverde data bestaan en zijn actueel in de analyseperiode, ongeacht je trainingskennis of kennis-cutoff. Bestempel een term nooit als niet-bestaand, toekomstig, fictief of als future intent waste op basis van je eigen aanname over wat zou moeten bestaan. Komt een product- of modelnaam je onbekend voor, ga er dan van uit dat die bestaat, juist omdat hij in de live accountdata staat. De aangeleverde data is de waarheid, niet je geheugen.`;
