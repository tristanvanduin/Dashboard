// L2 kernstap: de ICP-fit pre-compute, het mes dat LinkedIn onderscheidt van Google en Meta.
// Volledig deterministisch: het model krijgt de uitkomsten, niet de ruwe segmenten. Berekent per
// pivot het aandeel spend en leads binnen de ICP-segmenten, de waste op expliciet niet-ICP
// segmenten, en CPL binnen versus buiten ICP. De TOTAL-samenvattingsrij levert coverage_pct en
// telt niet als segment mee, zodat onderdrukte segmenten eerlijk meewegen. Lege ICP degradeert
// naar beschrijvend (geen fit-score), zonder dat de run faalt.

import type { LinkedInDemographicRow, LinkedInPivotType } from "./types";

export interface LinkedInIcp {
  job_functions: string[];
  seniorities: string[];
  industries: string[];
  company_sizes: string[];
}

// Welk pivot-type op welke ICP-dimensie aansluit. Regio en land hebben geen ICP-dimensie.
const PIVOT_TO_ICP_KEY: Partial<Record<LinkedInPivotType, keyof LinkedInIcp>> = {
  MEMBER_JOB_FUNCTION: "job_functions",
  MEMBER_SENIORITY: "seniorities",
  MEMBER_INDUSTRY: "industries",
  MEMBER_COMPANY_SIZE: "company_sizes",
};

export interface IcpPivotFit {
  pivotType: LinkedInPivotType;
  degraded: boolean; // geen ICP-definitie voor deze pivot: alleen beschrijvend
  spendInIcpPct: number | null;
  leadsInIcpPct: number | null;
  wasteSpend: number;
  icpCpl: number | null;
  nonIcpCpl: number | null;
  largestWasteSegment: { urn: string; spend: number; leads: number } | null;
  coveragePct: number | null;
  totalSpend: number;
  totalLeads: number;
}

function round(v: number | null): number | null {
  return v == null ? null : Math.round(v * 10000) / 10000;
}
function safeDiv(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

// Berekent de ICP-fit voor een enkele pivot. De TOTAL-rij levert coverage_pct en wordt niet
// als segment meegeteld; UNKNOWN-segmenten tellen niet mee in de classificatie.
export function computeIcpFitForPivot(
  segments: LinkedInDemographicRow[],
  pivotType: LinkedInPivotType,
  icpUrns: string[]
): IcpPivotFit {
  const rows = segments.filter((s) => s.pivotType === pivotType);
  const realSegments = rows.filter((s) => s.pivotValueUrn !== "TOTAL" && s.pivotValueUrn !== "UNKNOWN");
  const totalRow = rows.find((s) => s.pivotValueUrn === "TOTAL");
  const coveragePct = totalRow?.coveragePct ?? null;

  const totalSpend = realSegments.reduce((sum, s) => sum + (s.spend ?? 0), 0);
  const totalLeads = realSegments.reduce((sum, s) => sum + (s.leads ?? 0), 0);

  if (icpUrns.length === 0) {
    return {
      pivotType, degraded: true, spendInIcpPct: null, leadsInIcpPct: null, wasteSpend: 0,
      icpCpl: null, nonIcpCpl: null, largestWasteSegment: null, coveragePct,
      totalSpend: round(totalSpend) ?? 0, totalLeads,
    };
  }

  const icpSet = new Set(icpUrns);
  let icpSpend = 0, icpLeads = 0, wasteSpend = 0, nonIcpLeads = 0;
  let largestWaste: { urn: string; spend: number; leads: number } | null = null;
  for (const s of realSegments) {
    const spend = s.spend ?? 0;
    const leads = s.leads ?? 0;
    if (icpSet.has(s.pivotValueUrn)) {
      icpSpend += spend;
      icpLeads += leads;
    } else {
      wasteSpend += spend;
      nonIcpLeads += leads;
      if (!largestWaste || spend > largestWaste.spend) {
        largestWaste = { urn: s.pivotValueUrn, spend: round(spend) ?? 0, leads };
      }
    }
  }

  return {
    pivotType,
    degraded: false,
    spendInIcpPct: round(safeDiv(icpSpend, totalSpend)),
    leadsInIcpPct: round(safeDiv(icpLeads, totalLeads)),
    wasteSpend: round(wasteSpend) ?? 0,
    icpCpl: round(safeDiv(icpSpend, icpLeads)),
    nonIcpCpl: round(safeDiv(wasteSpend, nonIcpLeads)),
    largestWasteSegment: largestWaste,
    coveragePct,
    totalSpend: round(totalSpend) ?? 0,
    totalLeads,
  };
}

// Berekent de ICP-fit over alle ICP-relevante pivots die in de data voorkomen.
export function computeIcpFit(segments: LinkedInDemographicRow[], icp: LinkedInIcp | null | undefined): IcpPivotFit[] {
  const results: IcpPivotFit[] = [];
  for (const [pivotType, icpKey] of Object.entries(PIVOT_TO_ICP_KEY) as [LinkedInPivotType, keyof LinkedInIcp][]) {
    if (!segments.some((s) => s.pivotType === pivotType)) continue;
    const icpUrns = icp?.[icpKey] ?? [];
    results.push(computeIcpFitForPivot(segments, pivotType, icpUrns));
  }
  return results;
}

// Of de ICP-definitie volledig leeg is; dan degradeert de hele ICP-stap naar beschrijvend.
export function isIcpEmpty(icp: LinkedInIcp | null | undefined): boolean {
  if (!icp) return true;
  return (
    (icp.job_functions?.length ?? 0) === 0 &&
    (icp.seniorities?.length ?? 0) === 0 &&
    (icp.industries?.length ?? 0) === 0 &&
    (icp.company_sizes?.length ?? 0) === 0
  );
}
