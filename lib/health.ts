// W1.4 (Z1): de pure health-evaluatie. Neemt per kanaal verzamelde metrieken en levert
// een compacte lijst checks (ok, warn, fail) met een feitelijke toelichting. IO-vrij en
// los getest; /api/health/client verzamelt de metrieken en roept dit aan. Ontwerpprincipe
// uit de spec: het paneel maakt bestaand inzicht zichtbaar, het verzint geen waarheid, en
// een kanaal krijgt GEEN oordeel over metrieken die het niet heeft (null wordt overgeslagen).

export type HealthStatus = "ok" | "warn" | "fail";

export interface HealthCheck {
  key: string;
  status: HealthStatus;
  detail: string;
}

// Drempels expliciet, zodat ze op een plek staan en in de test vastliggen.
export const SYNC_STALE_FAIL_HOURS = 48; // twee gemiste dagcycli is duidelijk stuk
export const SYNC_STALE_WARN_HOURS = 30; // een cyclus te laat is een waarschuwing
export const VOLUME_DEVIATION_WARN = 0.5; // meer dan 50 procent afwijking is een flag
export const COVERAGE_WARN_PCT = 50; // demografie-coverage onder dit is een warn

// De per-kanaal verzamelde metrieken. Elk veld dat null is, levert geen check op.
export interface ChannelHealthInput {
  channel: string;
  connected: boolean;
  lastSuccessfulSyncAt?: string | null;
  datasetsAvailable?: number | null;
  datasetsTotal?: number | null;
  recentRowCount?: number | null; // rijen over de laatste 7 dagen
  baselineDailyAvg?: number | null; // 30-daags daggemiddelde
  yesterdayPresent?: boolean | null;
  coveragePct?: number | null; // bijvoorbeeld LinkedIn-demografie-coverage
  tokenStatus?: "ok" | "expiring" | "expired" | null;
  enrichmentDegraded?: boolean | null;
  now?: Date;
}

export interface ChannelHealth {
  channel: string;
  status: HealthStatus;
  checks: HealthCheck[];
}

function worst(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  return "ok";
}

export function evaluateChannelHealth(input: ChannelHealthInput): ChannelHealth {
  // No-go: geen oordelen op een niet-gekoppeld kanaal.
  if (!input.connected) {
    return { channel: input.channel, status: "ok", checks: [] };
  }

  const now = input.now ?? new Date();
  const checks: HealthCheck[] = [];

  // 1. Sync-versheid uit de laatste geslaagde sync.
  if (input.lastSuccessfulSyncAt !== undefined) {
    if (!input.lastSuccessfulSyncAt) {
      checks.push({ key: "sync_freshness", status: "fail", detail: "nog nooit succesvol gesynct" });
    } else {
      const uren = (now.getTime() - new Date(input.lastSuccessfulSyncAt).getTime()) / 3_600_000;
      if (uren >= SYNC_STALE_FAIL_HOURS) {
        checks.push({ key: "sync_freshness", status: "fail", detail: `laatste geslaagde sync ${Math.round(uren)} uur geleden` });
      } else if (uren >= SYNC_STALE_WARN_HOURS) {
        checks.push({ key: "sync_freshness", status: "warn", detail: `laatste geslaagde sync ${Math.round(uren)} uur geleden` });
      } else {
        checks.push({ key: "sync_freshness", status: "ok", detail: `laatste geslaagde sync ${Math.round(uren)} uur geleden` });
      }
    }
  }

  // 2. Dataset-compleetheid (Google: datasets_available versus datasets_total).
  if (input.datasetsAvailable != null && input.datasetsTotal != null && input.datasetsTotal > 0) {
    const ontbreekt = input.datasetsTotal - input.datasetsAvailable;
    if (ontbreekt <= 0) {
      checks.push({ key: "datasets", status: "ok", detail: `${input.datasetsAvailable} van ${input.datasetsTotal} datasets aanwezig` });
    } else if (input.datasetsAvailable === 0) {
      checks.push({ key: "datasets", status: "fail", detail: "geen enkele dataset aanwezig" });
    } else {
      checks.push({ key: "datasets", status: "warn", detail: `${ontbreekt} van ${input.datasetsTotal} datasets ontbreken` });
    }
  }

  // 3. Volume: de laatste 7 dagen tegen het 30-daags daggemiddelde.
  if (input.recentRowCount != null && input.baselineDailyAvg != null && input.baselineDailyAvg > 0) {
    if (input.recentRowCount === 0) {
      checks.push({ key: "volume", status: "fail", detail: "geen rijen in de laatste 7 dagen" });
    } else {
      const recentDaggemiddelde = input.recentRowCount / 7;
      const afwijking = (recentDaggemiddelde - input.baselineDailyAvg) / input.baselineDailyAvg;
      if (Math.abs(afwijking) > VOLUME_DEVIATION_WARN) {
        const richting = afwijking < 0 ? "gedaald" : "gestegen";
        checks.push({ key: "volume", status: "warn", detail: `dagvolume ${richting} met ${Math.round(Math.abs(afwijking) * 100)} procent tegenover het 30-daags gemiddelde` });
      } else {
        checks.push({ key: "volume", status: "ok", detail: "dagvolume in lijn met het gemiddelde" });
      }
    }
  }

  // 4. Aanwezigheid van gisteren-data (daily-kanalen).
  if (input.yesterdayPresent != null) {
    checks.push(
      input.yesterdayPresent
        ? { key: "yesterday", status: "ok", detail: "data van gisteren aanwezig" }
        : { key: "yesterday", status: "fail", detail: "geen data van gisteren" }
    );
  }

  // 5. Coverage (bijvoorbeeld LinkedIn-demografie).
  if (input.coveragePct != null) {
    checks.push(
      input.coveragePct < COVERAGE_WARN_PCT
        ? { key: "coverage", status: "warn", detail: `demografie-coverage ${Math.round(input.coveragePct)} procent` }
        : { key: "coverage", status: "ok", detail: `demografie-coverage ${Math.round(input.coveragePct)} procent` }
    );
  }

  // 6. Token-status.
  if (input.tokenStatus != null) {
    if (input.tokenStatus === "expired") checks.push({ key: "token", status: "fail", detail: "token verlopen" });
    else if (input.tokenStatus === "expiring") checks.push({ key: "token", status: "warn", detail: "token verloopt binnenkort" });
    else checks.push({ key: "token", status: "ok", detail: "token geldig" });
  }

  // 7. Enrichment-degradatie uit de laatste run (het bekende stil-degraderen-punt).
  if (input.enrichmentDegraded != null) {
    checks.push(
      input.enrichmentDegraded
        ? { key: "enrichment", status: "warn", detail: "enrichment gedegradeerd in de laatste run" }
        : { key: "enrichment", status: "ok", detail: "enrichment volledig in de laatste run" }
    );
  }

  return { channel: input.channel, status: worst(checks.map((c) => c.status)), checks };
}

// W-hefboom 4 (conversietracking-gezondheid): complementair aan lib/health-score.ts, dat de
// PERFORMANCE-anomalieen doet (conversieratio-dalingen tegen target). Dit dekt juist de
// tracking-KWALITEIT die daar niet in zit: een wegval naar nul als trackingbreuk-signaal, en
// de compleetheid van de conversie-configuratie. Puur en los getest.
export interface ConversionSeriesPoint {
  period: string;
  conversions: number;
}

// De lag-guard: valt de laatste periode nog binnen het conversielag-venster, dan kunnen de
// conversies van die periode nog rijpen en is een nul geen bewijs van een breuk.
function lastPeriodWithinConversionLag(period: string, lagDays: number | null, asOfDate: string | null): boolean {
  if (lagDays == null || lagDays <= 0 || !asOfDate) return false;
  const m = /^(\d{4})-(\d{2})/.exec(period);
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(asOfDate);
  if (!m || !a) return false;
  const periodEndMs = Date.UTC(Number(m[1]), Number(m[2]), 1); // de eerste dag na de periode-maand
  const asOfMs = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  return asOfMs < periodEndMs + lagDays * 86400000;
}

export function evaluateConversionTrackingQuality(input: {
  series: ConversionSeriesPoint[];
  hasPrimaryAction: boolean;
  conversionLagConfigured: boolean;
  conversionLagDays?: number | null;
  asOfDate?: string | null;
}): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const series = [...input.series].sort((a, b) => a.period.localeCompare(b.period));
  const values = series.map((p) => p.conversions);

  if (values.length > 0 && values.every((v) => v === 0)) {
    checks.push({ key: "conv_recorded", status: "fail", detail: "geen conversies geregistreerd in de reeks" });
  } else if (series.length >= 3) {
    // Trackingbreuk: de eerdere perioden hadden conversies, de laatste viel weg naar nul.
    const earlier = values.slice(0, -1);
    const latest = values[values.length - 1];
    const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    if (latest === 0 && earlierAvg > 0) {
      const withinLag = lastPeriodWithinConversionLag(series[series.length - 1].period, input.conversionLagDays ?? null, input.asOfDate ?? null);
      if (withinLag) {
        checks.push({ key: "conv_break", status: "warn", detail: "de laatste periode toont nul conversies maar valt nog binnen het conversielag-venster; de conversies kunnen nog rijpen, controleer na het venster opnieuw" });
      } else {
        checks.push({ key: "conv_break", status: "fail", detail: "conversieregistratie viel weg naar nul in de laatste periode, mogelijk een trackingbreuk" });
      }
    }
  }

  if (!input.hasPrimaryAction) {
    checks.push({ key: "conv_primary_action", status: "warn", detail: "geen primaire conversieactie ingesteld" });
  }
  if (!input.conversionLagConfigured) {
    checks.push({ key: "conv_lag", status: "warn", detail: "conversievertraging niet geconfigureerd" });
  }

  if (checks.length === 0) {
    checks.push({ key: "conv_tracking", status: "ok", detail: "conversieregistratie en configuratie in orde" });
  }
  return checks;
}

export interface ClientHealth {
  clientId: string;
  status: HealthStatus;
  channels: ChannelHealth[];
}

// Bundelt de kanaal-uitkomsten tot een klant-oordeel; de overall is de slechtste status
// over de gekoppelde kanalen. Niet-gekoppelde kanalen (lege checks) tellen als ok.
export function assembleClientHealth(clientId: string, channels: ChannelHealth[]): ClientHealth {
  return { clientId, status: worst(channels.map((c) => c.status)), channels };
}

// Handig voor de O3-sweep: de kanalen met een fail, voor een data_health_fail-event.
export function failingChannels(health: ClientHealth): string[] {
  return health.channels.filter((c) => c.status === "fail").map((c) => c.channel);
}
