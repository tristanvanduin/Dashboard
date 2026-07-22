// Grafiek-kleuren, los van de merk-chrome. Datavisualisatie volgt een eigen functioneel palet:
// CATEGORISCHE series (bv. Google/Meta/LinkedIn) krijgen een vast, gevalideerd palet dat
// maximaal onderscheidbaar is — óók kleurenblind-veilig — en dus NIET meekleurt met het merk
// (een merk met twee tinten groen zou anders onleesbare series geven). De merkkleur gebruiken we
// alleen voor één-entiteit-metrieken (bv. de spend-balk van dít account), waar kleur identiteit
// is en geen categorische vergelijking.
//
// Het categorische palet is de gevalideerde referentievolgorde uit de dataviz-richtlijn
// (validate_palette.js: alle harde checks PASS in light-mode; CVD-veilig op de aangrenzende
// paren). Volgorde is de veiligheidsmechanisme — niet cosmetisch — dus niet herschikken.

export const CHART_CATEGORICAL = [
  "#2a78d6", // blauw
  "#eb6834", // oranje
  "#1baf7a", // aqua
  "#eda100", // geel
  "#e87ba4", // magenta
  "#008300", // groen
  "#4a3aa7", // violet
  "#e34948", // rood
] as const;

// Recessieve chrome voor grafieken (raster + as-tekst), consistent over alle charts.
export const CHART_GRID = "#eef1f6";
export const CHART_AXIS = "#64748b";

// De secondaire (lijn-)kleur naast een merk-gekleurde balk: altijd oranje, dat contrasteert met
// zowel een blauw als een groen merk-primary. De vorm (lijn vs balk) draagt het onderscheid mee.
export const CHART_LINE_SECONDARY = CHART_CATEGORICAL[1];
