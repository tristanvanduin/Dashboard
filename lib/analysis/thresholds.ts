// ============================================================
// Q1: gedeelde drempel-bron
// ------------------------------------------------------------
// Eén plek voor de numerieke drempels. De deterministische
// second-opinion-evaluator (lib/second-opinion/evaluator.ts) scoort
// hierop, en de benchmark-tekst van de maand-SOP (MONTHLY_BENCHMARKS in
// lib/prompts/sop-prompts.ts) verwijst ernaar. Zo kunnen het automatische
// oordeel en de guidance aan het model niet uit elkaar lopen en de tool
// niet tegenstrijdig oordelen.
// ============================================================

// Gedeeld tussen de evaluator en de maand-benchmark:
// alarm bij impression share-verlies door budget boven dit percentage.
export const IS_LOSS_ALARM_PCT = 20;

// Gedeeld met de maand-benchmark: de PMAX-leerfase.
export const PMAX_LEARNING_WEEKS = 6;
export const PMAX_LEARNING_CONVERSIONS = 50;

// Scoringsdrempels van de second-opinion-evaluator (zoekterm-waste en PMAX-plaatsingen).
// Centraal in plaats van hardgecodeerd in de evaluator, zodat ze vindbaar en stuurbaar zijn.
export const HIGH_CPA_MULTIPLE = 3; // CPA boven dit veelvoud van het accountgemiddelde is inefficient
export const MIN_COST_HIGH_CPA = 10; // minimale spend (EUR) om een hoge-CPA-term mee te tellen
export const MIN_COST_ZERO_VALUE = 5; // minimale spend (EUR) om een conversie-zonder-omzet-term mee te tellen
export const SEARCH_WASTE_PCT_POOR = 20; // waste boven dit percentage van de spend is Onvoldoende
export const SEARCH_WASTE_PCT_MEDIOCRE = 10; // waste boven dit percentage is Voldoende
export const SEARCH_ZERO_CONV_POOR = 50; // meer dan dit aantal nul-conversie-termen is Onvoldoende
export const SEARCH_ZERO_CONV_MEDIOCRE = 20; // meer dan dit aantal nul-conversie-termen is Voldoende
export const PMAX_PLACEMENT_MIN_COST = 20; // minimale spend (EUR) om een PMAX-plaatsing als waste te tellen
