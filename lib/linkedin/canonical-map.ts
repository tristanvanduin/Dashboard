// L2 data-laag: de LinkedIn canonical metric map voor de claim-consistentie-guard (F4). Levert
// dezelfde Map-vorm als de Google en Meta buildCanonicalMetricMap (sleutels via canonicalKey,
// zodat dezelfde validateFindingClaims werkt), maar uit de LinkedIn-kolommen en met de LinkedIn-
// KPI's waar CPL leidt. Aggregeert de daily-rijen naar de laatste volledige accountmaand en
// ankert alle entiteiten op diezelfde maand. Pure functie, op fixtures te testen.

import { canonicalKey, type CanonicalMetricMap } from "@/lib/analysis/claim-consistency";
import { aggregateMonthly, groupBy, type LinkedInComputeRow, type MonthlyMetrics } from "./prepared-compute";

// Zet de canonical KPI-waarden van een entiteit (laatste maand) in de map, met LinkedIn's KPI-namen.
function setEntityMonth(map: CanonicalMetricMap, name: string, entityType: "account" | "campaign", monthly: MonthlyMetrics | undefined): void {
  if (!monthly) return;
  const set = (metric: string, value: number | null) => {
    if (value !== null && Number.isFinite(value)) map.set(canonicalKey(name, entityType, metric), value);
  };
  set("CPL", monthly.cpl);
  set("CTR", monthly.ctr_pct);
  set("CPC", monthly.cpc);
  set("CPM", monthly.cpm);
  set("Spend", monthly.spend);
  set("Leads", monthly.leads);
  set("Form completion rate", monthly.form_completion_rate_pct);
}

export function buildLinkedinCanonicalMetricMap(campaignRows: LinkedInComputeRow[], accountRows: LinkedInComputeRow[]): CanonicalMetricMap {
  const map: CanonicalMetricMap = new Map();

  const accountMonthly = aggregateMonthly(accountRows);
  const analysisMonth = accountMonthly.length ? accountMonthly[accountMonthly.length - 1].month : null;

  // Alle entiteiten ankeren op dezelfde analysemaand (de laatste volledige accountmaand), zodat de
  // canonical waarden bij dezelfde periode horen als de prepared facts. Een campagne met alleen
  // oudere data valt zo weg.
  const monthFor = (rows: LinkedInComputeRow[]): MonthlyMetrics | undefined => {
    const monthly = aggregateMonthly(rows);
    if (analysisMonth) return monthly.find((m) => m.month === analysisMonth);
    return monthly.length ? monthly[monthly.length - 1] : undefined;
  };

  setEntityMonth(map, "account", "account", accountMonthly.length ? accountMonthly[accountMonthly.length - 1] : undefined);

  for (const [urn, rows] of groupBy(campaignRows, (r) => r.entityUrn ?? "")) {
    const name = rows.find((r) => r.entityName)?.entityName ?? urn ?? "";
    if (!name) continue;
    setEntityMonth(map, name, "campaign", monthFor(rows));
  }

  return map;
}
