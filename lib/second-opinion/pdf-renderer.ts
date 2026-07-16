/**
 * Second Opinion PDF renderer — Final Premium Edition.
 *
 * Fixes:
 * - Unicode symbols replaced with ASCII-safe equivalents (Helvetica font limitation)
 * - Time horizons on priority blocks (0-7d, 0-14d, 7-30d)
 * - Business impact labels (waste, schaal, risico)
 * - Visual distinction between weak (red), unknown (gray), manual review (blue) in detail table
 * - Cleaner typography and spacing
 *
 * Structure:
 *   Page 1: Executive summary (verdict, confidence, stats, priorities with time horizons)
 *   Page 2: Category overview with enhanced scoring + confidence
 *   Page 3+: Detail checklist table with visual state distinction
 */

import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";
import {
  resolveFinalRows,
  calculateFinalSummaries,
  computeExecutiveSummary,
  isScored,
  type AuditRowResult,
  type SectionSummary,
  type AuditScore,
} from "./types";

// ── Colors ─────────────────────────────────────────────────────────────────

const orange = "#E87722";
const green = "#16a34a";
const greenLight = "#f0fdf4";
const greenBorder = "#bbf7d0";
const amber = "#d97706";
const amberLight = "#fffbeb";
const amberBorder = "#fde68a";
const red = "#dc2626";
const redLight = "#fef2f2";
const redBorder = "#fecaca";
const gray = "#6b7280";
const grayLight = "#f9fafb";
const grayBorder = "#e5e7eb";
const dark = "#111827";
const blueDark = "#1e40af";
const blueLight = "#eff6ff";
const blueBorder = "#93c5fd";

const SCORE_COLOR: Record<AuditScore, string> = {
  "Goed": green,
  "Voldoende": amber,
  "Onvoldoende": red,
  "Niet beoordeeld": blueDark,
  "Niet van toepassing": gray,
};

// Row background color based on score state
const ROW_BG: Record<AuditScore, string> = {
  "Goed": "#f0fdf4",
  "Voldoende": "#fffbeb",
  "Onvoldoende": "#fef2f2",
  "Niet beoordeeld": blueLight,
  "Niet van toepassing": grayLight,
};

const VERDICT_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  "Sterk": { bg: greenLight, text: green, border: greenBorder },
  "Voldoende": { bg: amberLight, text: amber, border: amberBorder },
  "Aandacht nodig": { bg: redLight, text: red, border: redBorder },
  "Kritiek": { bg: redLight, text: red, border: redBorder },
};

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 9, color: dark },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "bold", color: orange },
  subtitle: { fontSize: 9, color: gray, marginTop: 3 },
  brand: { fontSize: 13, fontWeight: "bold", color: orange },
  brandSub: { fontSize: 7, color: gray },
  divider: { height: 2, backgroundColor: orange, marginBottom: 14, borderRadius: 1 },
  // Verdict
  verdictCard: { padding: 12, borderRadius: 6, borderWidth: 1, marginBottom: 12 },
  verdictTitle: { fontSize: 15, fontWeight: "bold", marginBottom: 2 },
  verdictText: { fontSize: 8.5, lineHeight: 1.4 },
  // Stats
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  statBox: { flex: 1, borderRadius: 4, padding: 8, borderWidth: 0.5, borderColor: grayBorder, backgroundColor: grayLight, alignItems: "center" },
  statNumber: { fontSize: 20, fontWeight: "bold" },
  statLabel: { fontSize: 7, color: gray, marginTop: 1 },
  // Priority blocks
  priorityBlock: { flex: 1, borderRadius: 4, padding: 10, borderWidth: 0.5, marginBottom: 4 },
  priorityTitle: { fontSize: 9, fontWeight: "bold", marginBottom: 1 },
  priorityHorizon: { fontSize: 7, marginBottom: 5 },
  priorityItem: { flexDirection: "row", marginBottom: 2.5, paddingLeft: 2 },
  priorityBullet: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2, marginRight: 5 },
  priorityText: { fontSize: 7.5, flex: 1, lineHeight: 1.3 },
  priorityTag: { fontSize: 6.5, color: gray, marginLeft: 4 },
  // Summary table
  summaryHeader: { flexDirection: "row", borderBottomWidth: 1.5, borderBottomColor: orange, paddingVertical: 6, marginBottom: 2 },
  summaryRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: grayBorder, paddingVertical: 6 },
  sCol1: { width: "22%" },
  sCol2: { width: "8%", textAlign: "center" },
  sCol3: { width: "8%", textAlign: "center" },
  sCol4: { width: "14%", textAlign: "center" },
  sCol5: { width: "48%" },
  headerText: { fontSize: 7.5, fontWeight: "bold", color: orange },
  cellText: { fontSize: 7.5 },
  // Legend
  legend: { flexDirection: "row", gap: 14, marginTop: 8, marginBottom: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  legendDot: { width: 7, height: 7, borderRadius: 3.5 },
  legendText: { fontSize: 6.5, color: gray },
  // Detail table
  tableHeader: { flexDirection: "row", backgroundColor: orange, paddingVertical: 5, paddingHorizontal: 4, borderRadius: 2, marginTop: 6 },
  tableHeaderText: { fontSize: 7, fontWeight: "bold", color: "white" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: grayBorder, paddingVertical: 4, paddingHorizontal: 4, minHeight: 20 },
  colType: { width: "12%" },
  colCheck: { width: "34%" },
  colImpact: { width: "6%" },
  colComplexity: { width: "8%" },
  colScore: { width: "12%" },
  colComments: { width: "28%" },
  // Score indicator bar
  scoreBar: { width: 3, borderRadius: 1.5, marginRight: 4, minHeight: 14 },
  // Footer
  footer: { position: "absolute", bottom: 22, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 6.5, color: gray },
});

// ── Helpers ────────────────────────────────────────────────────────────────

function scoreBarColor(score: AuditScore): string {
  if (score === "Goed") return green;
  if (score === "Voldoende") return amber;
  if (score === "Onvoldoende") return red;
  if (score === "Niet van toepassing") return grayBorder;
  return blueDark; // Niet beoordeeld = blue (unknown/manual)
}

// ── PDF Document ───────────────────────────────────────────────────────────

interface PdfProps {
  clientName: string;
  mode: "quick" | "full";
  rows: AuditRowResult[];
  summaries: SectionSummary[];
  generatedAt: string;
}

// Load RM logo as base64 data URI (cached at module level)
let rmLogoDataUri: string | undefined;
try {
  const logoPath = path.join(process.cwd(), "public", "images", "ranking-masters-logo.png");
  if (fs.existsSync(logoPath)) {
    rmLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  }
} catch { /* no logo */ }

function SecondOpinionPdf({ clientName, mode, rows, summaries, generatedAt }: PdfProps) {
  const dateStr = new Date(generatedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  const modeLabel = mode === "quick" ? "Snelle Audit" : "Volledige Audit";
  const exec = computeExecutiveSummary(rows);
  const vc = VERDICT_STYLE[exec.verdict] ?? VERDICT_STYLE["Voldoende"];
  const { visibleRows, nvtBySection, excludedBySection } = filterRowsForPdf(rows);

  return React.createElement(Document, {},

    // ══════════════════════════════════════════════════════════════════
    // PAGE 1: EXECUTIVE SUMMARY
    // ══════════════════════════════════════════════════════════════════
    React.createElement(Page, { size: "A4", orientation: "landscape", style: s.page },
      // Header
      React.createElement(View, { style: s.header },
        React.createElement(View, {},
          React.createElement(Text, { style: s.title }, "Second Opinion"),
          React.createElement(Text, { style: s.subtitle }, `${clientName}  |  ${modeLabel}  |  ${dateStr}`),
        ),
        React.createElement(View, { style: { flexDirection: "row", alignItems: "center", gap: 8 } },
          rmLogoDataUri
            ? React.createElement(Image, { src: rmLogoDataUri, style: { height: 32, width: 32, objectFit: "contain" as const } })
            : null,
          React.createElement(View, { style: { alignItems: "flex-end" as const } },
            React.createElement(Text, { style: s.brand }, "Ranking Masters"),
            React.createElement(Text, { style: s.brandSub }, "De #1 SEM specialist in de Benelux"),
          ),
        ),
      ),
      React.createElement(View, { style: s.divider }),

      // Verdict card
      React.createElement(View, { style: { ...s.verdictCard, backgroundColor: vc.bg, borderColor: vc.border } },
        React.createElement(View, { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" } },
          React.createElement(View, { style: { flex: 1 } },
            React.createElement(Text, { style: { ...s.verdictTitle, color: vc.text } }, `Verdict: ${exec.verdict}`),
            React.createElement(Text, { style: { ...s.verdictText } }, exec.verdictExplanation),
          ),
          React.createElement(View, { style: { alignItems: "flex-end", marginLeft: 20 } },
            React.createElement(Text, { style: { fontSize: 8, fontWeight: "bold", color: exec.auditConfidence === "Hoog" ? green : exec.auditConfidence === "Gemiddeld" ? amber : red } }, `Vertrouwen: ${exec.auditConfidence}`),
            React.createElement(Text, { style: { fontSize: 7, color: gray, marginTop: 2, textAlign: "right", maxWidth: 200 } }, exec.confidenceExplanation),
          ),
        ),
      ),

      // Stats row
      React.createElement(View, { style: s.statsRow },
        React.createElement(View, { style: s.statBox },
          React.createElement(Text, { style: { ...s.statNumber, color: dark } }, String(exec.totalChecks)),
          React.createElement(Text, { style: s.statLabel }, "Totaal"),
        ),
        React.createElement(View, { style: { ...s.statBox, borderColor: greenBorder } },
          React.createElement(Text, { style: { ...s.statNumber, color: green } }, String(exec.goodCount)),
          React.createElement(Text, { style: s.statLabel }, "Goed"),
        ),
        React.createElement(View, { style: { ...s.statBox, borderColor: amberBorder } },
          React.createElement(Text, { style: { ...s.statNumber, color: amber } }, String(exec.voldoendeCount)),
          React.createElement(Text, { style: s.statLabel }, "Voldoende"),
        ),
        React.createElement(View, { style: { ...s.statBox, borderColor: redBorder } },
          React.createElement(Text, { style: { ...s.statNumber, color: red } }, String(exec.onvoldoendeCount)),
          React.createElement(Text, { style: s.statLabel }, "Onvoldoende"),
        ),
        React.createElement(View, { style: { ...s.statBox, borderColor: blueBorder } },
          React.createElement(Text, { style: { ...s.statNumber, color: blueDark } }, String(exec.unscoredChecks)),
          React.createElement(Text, { style: s.statLabel }, "Review nodig"),
        ),
      ),

      // Priority columns with time horizons
      React.createElement(View, { style: { flexDirection: "row", gap: 10 } },
        // Direct verbeteren (0-7 dagen)
        exec.directActions.length > 0 && React.createElement(View, { style: { ...s.priorityBlock, borderColor: redBorder, backgroundColor: redLight, flex: 1 } },
          React.createElement(Text, { style: { ...s.priorityTitle, color: red } }, "Direct verbeteren"),
          React.createElement(Text, { style: { ...s.priorityHorizon, color: red } }, "Tijdshorizon: 0-7 dagen  |  Impact: Hoog"),
          ...exec.directActions.map((item, i) =>
            React.createElement(View, { key: `da-${i}`, style: s.priorityItem },
              React.createElement(View, { style: { ...s.priorityBullet, backgroundColor: red } }),
              React.createElement(Text, { style: s.priorityText }, item.controlPoint),
              React.createElement(Text, { style: s.priorityTag }, item.section),
            )
          ),
        ),
        // Eerst onderzoeken (0-14 dagen)
        exec.investigateFirst.length > 0 && React.createElement(View, { style: { ...s.priorityBlock, borderColor: amberBorder, backgroundColor: amberLight, flex: 1 } },
          React.createElement(Text, { style: { ...s.priorityTitle, color: amber } }, "Eerst onderzoeken"),
          React.createElement(Text, { style: { ...s.priorityHorizon, color: amber } }, "Tijdshorizon: 0-14 dagen  |  Impact: Hoog"),
          ...exec.investigateFirst.map((item, i) =>
            React.createElement(View, { key: `if-${i}`, style: s.priorityItem },
              React.createElement(View, { style: { ...s.priorityBullet, backgroundColor: amber } }),
              React.createElement(Text, { style: s.priorityText }, item.controlPoint),
              React.createElement(Text, { style: s.priorityTag }, item.section),
            )
          ),
        ),
        // Handmatige review (geen tijdshorizon — afhankelijk van auditor)
        exec.manualReviewItems.length > 0 && React.createElement(View, { style: { ...s.priorityBlock, borderColor: blueBorder, backgroundColor: blueLight, flex: 1 } },
          React.createElement(Text, { style: { ...s.priorityTitle, color: blueDark } }, "Handmatige review nodig"),
          React.createElement(Text, { style: { ...s.priorityHorizon, color: blueDark } }, "Niet automatisch beoordeelbaar  |  Data ontbreekt"),
          ...exec.manualReviewItems.slice(0, 4).map((item, i) =>
            React.createElement(View, { key: `mr-${i}`, style: s.priorityItem },
              React.createElement(View, { style: { ...s.priorityBullet, backgroundColor: blueDark } }),
              React.createElement(Text, { style: s.priorityText }, item.controlPoint),
              React.createElement(Text, { style: s.priorityTag }, item.section),
            )
          ),
        ),
      ),

      // Footer
      React.createElement(View, { style: s.footer },
        React.createElement(Text, { style: s.footerText }, `Gegenereerd: ${dateStr}`),
        React.createElement(View, { style: { flexDirection: "row", alignItems: "center", gap: 4 } },
          rmLogoDataUri
            ? React.createElement(Image, { src: rmLogoDataUri, style: { height: 14, width: 14, objectFit: "contain" as const } })
            : null,
          React.createElement(Text, { style: s.footerText }, "Ranking Masters  |  Second Opinion"),
        ),
      ),
    ),

    // ══════════════════════════════════════════════════════════════════
    // PAGE 2: CATEGORY OVERVIEW
    // ══════════════════════════════════════════════════════════════════
    React.createElement(Page, { size: "A4", orientation: "landscape", style: s.page },
      React.createElement(Text, { style: { fontSize: 14, fontWeight: "bold", color: orange, marginBottom: 6 } }, "Score per categorie"),

      // Legend — ASCII-safe, no Unicode symbols
      React.createElement(View, { style: s.legend },
        React.createElement(View, { style: s.legendItem },
          React.createElement(View, { style: { ...s.legendDot, backgroundColor: green } }),
          React.createElement(Text, { style: s.legendText }, "Goed (>=90% van max)"),
        ),
        React.createElement(View, { style: s.legendItem },
          React.createElement(View, { style: { ...s.legendDot, backgroundColor: amber } }),
          React.createElement(Text, { style: s.legendText }, "Voldoende (50-90%)"),
        ),
        React.createElement(View, { style: s.legendItem },
          React.createElement(View, { style: { ...s.legendDot, backgroundColor: red } }),
          React.createElement(Text, { style: s.legendText }, "Onvoldoende (<50%)"),
        ),
        React.createElement(View, { style: s.legendItem },
          React.createElement(View, { style: { ...s.legendDot, backgroundColor: blueDark } }),
          React.createElement(Text, { style: s.legendText }, "Niet beoordeeld (handmatige review)"),
        ),
      ),

      // Enhanced summary table
      React.createElement(View, { style: s.summaryHeader },
        React.createElement(Text, { style: { ...s.sCol1, ...s.headerText } }, "Categorie"),
        React.createElement(Text, { style: { ...s.sCol2, ...s.headerText } }, "Totaal"),
        React.createElement(Text, { style: { ...s.sCol3, ...s.headerText } }, "Beoordeeld"),
        React.createElement(Text, { style: { ...s.sCol4, ...s.headerText } }, "Score"),
        React.createElement(Text, { style: { ...s.sCol5, ...s.headerText } }, "Toelichting"),
      ),
      ...exec.enhancedSummaries.map((sum) =>
        React.createElement(View, { key: sum.section, style: s.summaryRow },
          React.createElement(Text, { style: { ...s.sCol1, ...s.cellText, fontWeight: "bold" } }, sum.section),
          React.createElement(Text, { style: { ...s.sCol2, ...s.cellText } }, String(sum.itemCount)),
          React.createElement(Text, { style: { ...s.sCol3, ...s.cellText } }, `${sum.scoredCount}/${sum.itemCount}`),
          React.createElement(View, { style: s.sCol4 },
            React.createElement(Text, { style: { ...s.cellText, color: SCORE_COLOR[sum.averageScore], fontWeight: "bold" } }, sum.averageScore),
          ),
          React.createElement(Text, { style: { ...s.sCol5, ...s.cellText, color: gray } },
            sum.manualReviewCount > 0
              ? `${sum.confidenceNote}. ${sum.manualReviewCount} check(s) vereisen handmatige review.`
              : sum.confidenceNote
          ),
        )
      ),

      // Footer
      React.createElement(View, { style: s.footer },
        React.createElement(Text, { style: s.footerText }, `${clientName}  |  ${modeLabel}`),
        React.createElement(View, { style: { flexDirection: "row", alignItems: "center", gap: 4 } },
          rmLogoDataUri
            ? React.createElement(Image, { src: rmLogoDataUri, style: { height: 14, width: 14, objectFit: "contain" as const } })
            : null,
          React.createElement(Text, { style: s.footerText }, "Ranking Masters  |  Second Opinion"),
        ),
      ),
    ),

    // ══════════════════════════════════════════════════════════════════
    // PAGE 3+: DETAIL CHECKLIST TABLE
    // ══════════════════════════════════════════════════════════════════
    React.createElement(Page, { size: "A4", orientation: "landscape", style: s.page, wrap: true },
      // Table header (fixed on every page)
      React.createElement(View, { style: s.tableHeader, fixed: true },
        React.createElement(Text, { style: { width: "3%", ...s.tableHeaderText } }, ""),
        React.createElement(Text, { style: { ...s.colType, ...s.tableHeaderText } }, "Type"),
        React.createElement(Text, { style: { ...s.colCheck, ...s.tableHeaderText } }, "Controle punt"),
        React.createElement(Text, { style: { ...s.colImpact, ...s.tableHeaderText } }, "Impact"),
        React.createElement(Text, { style: { ...s.colScore, ...s.tableHeaderText } }, "Score"),
        React.createElement(Text, { style: { ...s.colComments, ...s.tableHeaderText } }, "Toelichting"),
      ),
      // Detail rows — only assessed/relevant rows (filtered)
      ...visibleRows.map((row, i) => {
        const bg = i % 2 === 1 ? grayLight : "white";
        const barColor = scoreBarColor(row.score);
        // For "Niet beoordeeld" rows: show different comment style
        const isUnknown = row.score === "Niet beoordeeld";
        const commentColor = isUnknown ? blueDark : gray;
        const commentPrefix = isUnknown && row.method === "unsupported" ? "Geen data: " : "";

        return React.createElement(View, { key: row.templateId, style: { ...s.tableRow, backgroundColor: bg }, wrap: false },
          // Score indicator bar (left edge color)
          React.createElement(View, { style: { ...s.scoreBar, backgroundColor: barColor, width: "3%" } }),
          React.createElement(Text, { style: { ...s.colType, ...s.cellText, color: gray } }, row.section),
          React.createElement(Text, { style: { ...s.colCheck, ...s.cellText } }, row.controlPoint),
          React.createElement(Text, { style: { ...s.colImpact, ...s.cellText, color: row.impact === "Hoog" ? red : row.impact === "Midden" ? amber : gray } }, row.impact),
          React.createElement(Text, { style: { ...s.colScore, ...s.cellText, color: SCORE_COLOR[row.score], fontWeight: "bold" } }, row.score),
          React.createElement(Text, { style: { ...s.colComments, ...s.cellText, color: commentColor, fontStyle: isUnknown ? "italic" : "normal" } }, `${commentPrefix}${row.comments}`),
        );
      }),

      // Footer
      React.createElement(View, { style: s.footer, fixed: true },
        React.createElement(Text, { style: s.footerText }, `${clientName}  |  ${modeLabel}`),
        React.createElement(Text, { style: s.footerText, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Pagina ${pageNumber} / ${totalPages}` }),
      ),
    ),
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Determine which rows should appear in the final PDF.
 *
 * INCLUDE IF: scored (Goed/Voldoende/Onvoldoende), or manually overridden
 * COMPACT SUMMARY: "Niet van toepassing" items (shown as category note, not full rows)
 * EXCLUDE: "Niet beoordeeld" items that have NOT been manually filled in
 */
function filterRowsForPdf(rows: AuditRowResult[]): {
  visibleRows: AuditRowResult[];
  nvtBySection: Map<string, number>;
  excludedBySection: Map<string, number>;
} {
  const visibleRows: AuditRowResult[] = [];
  const nvtBySection = new Map<string, number>();
  const excludedBySection = new Map<string, number>();

  for (const row of rows) {
    const score = row.score;

    if (score === "Niet van toepassing") {
      nvtBySection.set(row.section, (nvtBySection.get(row.section) ?? 0) + 1);
      continue; // compact summary only, not as full row
    }

    if (score === "Niet beoordeeld" && !row.isOverridden) {
      excludedBySection.set(row.section, (excludedBySection.get(row.section) ?? 0) + 1);
      continue; // exclude untouched unreviewed items
    }

    visibleRows.push(row);
  }

  return { visibleRows, nvtBySection, excludedBySection };
}

export async function renderSecondOpinionPdf(opts: PdfProps): Promise<Buffer> {
  const finalRows = resolveFinalRows(opts.rows);
  const finalSummaries = calculateFinalSummaries(opts.rows);
  const doc = SecondOpinionPdf({ ...opts, rows: finalRows, summaries: finalSummaries });
  return await renderToBuffer(doc);
}
