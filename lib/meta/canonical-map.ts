// M2 data-laag: de Meta canonical metric map voor de claim-consistentie-guard (F4). Levert
// dezelfde Map-vorm als de Google buildCanonicalMetricMap (sleutels via canonicalKey, zodat
// dezelfde validateFindingClaims werkt), maar uit de Meta-kolommen (conversion_value enkelvoud,
// link_clicks) en met aggregatie van de daily M1-rijen naar de laatste volledige maand.
// Pure functie, op fixtures te testen.

import { canonicalKey, type CanonicalMetricMap } from "@/lib/analysis/claim-consistency";
import { aggregateMonthly, groupBy, type MetaComputeRow, type MonthlyMetrics } from "./prepared-compute";

// Zet de canonical KPI-waarden van een entiteit (laatste maand) in de map, met Meta's KPI-namen.
function setEntityMonth(map: CanonicalMetricMap, name: string, entityType: "account" | "campaign", monthly: MonthlyMetrics | undefined): void {
  if (!monthly) return;
  const set = (metric: string, value: number | null) => {
    if (value !== null && Number.isFinite(value)) map.set(canonicalKey(name, entityType, metric), value);
  };
  set("ROAS", monthly.roas);
  set("CPA", monthly.cpa);
  set("CPC", monthly.cpc);
  set("Spend", monthly.spend);
  set("Conversies", monthly.conversions);
  set("Conversiewaarde", monthly.conversion_value);
  set("Link CTR", monthly.link_ctr_pct);
}

export function buildMetaCanonicalMetricMap(campaignRows: MetaComputeRow[], accountRows: MetaComputeRow[]): CanonicalMetricMap {
  const map: CanonicalMetricMap = new Map();

  const accountMonthly = aggregateMonthly(accountRows);
  const analysisMonth = accountMonthly.length ? accountMonthly[accountMonthly.length - 1].month : null;

  // Alle entiteiten ankeren op dezelfde analysemaand (de laatste volledige accountmaand),
  // zodat de canonical waarden bij dezelfde periode horen als de prepared facts.
  const monthFor = (rows: MetaComputeRow[]): MonthlyMetrics | undefined => {
    const monthly = aggregateMonthly(rows);
    if (analysisMonth) return monthly.find((m) => m.month === analysisMonth);
    return monthly.length ? monthly[monthly.length - 1] : undefined;
  };

  setEntityMonth(map, "account", "account", accountMonthly.length ? accountMonthly[accountMonthly.length - 1] : undefined);

  for (const [, rows] of groupBy(campaignRows, (r) => r.entity_id)) {
    const name = rows.find((r) => r.entity_name)?.entity_name ?? rows[0]?.entity_id ?? "";
    if (!name) continue;
    setEntityMonth(map, name, "campaign", monthFor(rows));
  }

  return map;
}
