import {
  checkSopCoverage,
  type CoverageDimension,
  type IssueCluster,
  type SopCoverage,
} from "@/lib/analysis/canonicalize";

export interface CoverageEnforcementResult {
  coverage: SopCoverage[];
  surfacedDimensions: CoverageDimension[];
  missingAvailableDimensions: CoverageDimension[];
  unavailableDimensions: CoverageDimension[];
  traceabilityOk: boolean;
}

export function enforceSopCoverage(
  clusters: IssueCluster[],
  dimensionAvailability: Partial<Record<CoverageDimension, boolean>>
): CoverageEnforcementResult {
  const coverage = checkSopCoverage(clusters, dimensionAvailability);
  const surfacedDimensions = coverage
    .filter((row) => row.status === "covered")
    .map((row) => row.dimension);
  const missingAvailableDimensions = coverage
    .filter((row) => row.status === "no_signal" && row.data_available)
    .map((row) => row.dimension);
  const unavailableDimensions = coverage
    .filter((row) => row.status === "data_unavailable")
    .map((row) => row.dimension);

  const traceabilityOk = coverage.every((row) => {
    if (row.status !== "covered") return true;
    return row.surfaced_cluster_ids.every((clusterId) => clusters.some((cluster) => cluster.cluster_id === clusterId));
  });

  return {
    coverage,
    surfacedDimensions,
    missingAvailableDimensions,
    unavailableDimensions,
    traceabilityOk,
  };
}
