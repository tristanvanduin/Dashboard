/**
 * Client Report PDF renderer v8 — Final Polish.
 *
 * v7→v8 changes:
 * - Line charts: SVG with thicker stroke (3pt), all attributes as strings for react-pdf compat
 * - RM logo in footer: 36px (was 24px) — clearly visible, premium
 * - Summary: KPIs 36pt, stronger visual panels
 * - Metric pages: more breathing room, chart padding refined
 * - X-axis labels: "Feb '25" format (set by API, rendered as-is)
 */

import React from "react";
import { Document, Page, Text, View, Image, Font, Svg, Path, Circle as SvgCircle, Line as SvgLine, renderToBuffer } from "@react-pdf/renderer";

Font.registerHyphenationCallback((word: string) => [word]);

// Brand Guide: Ranking Masters kleurenpalet
const c = {
  brand: "#E87722", brandLight: "#f4a460",
  blue: "#0F1D2F",          // Deep Navy (primair donker uit brand guide)
  blueAccent: "#1e3a5f",    // Royal Blue (ondersteunend)
  green: "#2D6A2E", red: "#dc2626",
  dark: "#0A1628",           // Graphite (donkerste tint uit brand guide)
  g700: "#374151", g500: "#6b7280", g400: "#9ca3af",
  g300: "#d1d5db", g200: "#e5e7eb", g100: "#f3f4f6", g50: "#f9fafb", white: "#ffffff",
};
const sp = { xs: 4, sm: 8, md: 14, lg: 22, xl: 30, xxl: 44, pad: 50 };
const E = React.createElement;

// ── Types ──

interface MP { month: string; value: number }
interface KpiCard { label: string; current: number; previous: number; changePct: number; yoyChangePct: number | null; format: "number" | "currency" | "percent" | "decimal" }
interface MetricSection { id: string; label: string; heading: string; body: string; bullets: string[]; chartData: MP[]; chartData2?: MP[]; chartLabel: string; chartLabel2?: string; chartType: "bar" | "line"; chartType2?: "bar" | "line" }
interface CountrySection {
  countryCode: string;
  countryName: string;
  kpiCards: KpiCard[];
  metricSections: MetricSection[];
}

export interface ReportPdfProps {
  clientName: string; title: string; reportMonth: string; reportYear: number;
  generatedAt: string; kpiCards: KpiCard[]; metricSections: MetricSection[];
  actionSection: { heading: string; body: string }; planningSection: { heading: string; body: string };
  summaryHeadline?: string; summarySubtitle?: string;
  countrySections?: CountrySection[];
  rmLogoUrl?: string; clientLogoUrl?: string; coverImageUrl?: string; closingImageUrl?: string;
}

// ── Helpers ──

function fmt(v: number, f: string): string {
  if (f === "currency") return `\u20AC${new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(v))}`;
  if (f === "percent") return `${v.toFixed(1)}%`;
  if (f === "decimal") return v.toFixed(2);
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}
function chgCol(pct: number, inv = false): string { return (inv ? pct < 0 : pct > 0) ? c.green : pct === 0 ? c.g500 : c.red; }
function isInv(l: string): boolean { return l === "CPA" || l === "Kosten" || l === "ACOS"; }
function fmtAx(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v < 1 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0);
}
function parseActions(text: string): Array<{ title: string; body: string }> {
  const g: Array<{ title: string; body: string }> = [];
  for (const p of text.split(/(?=\d+\.\s+)/)) { const t = p.trim(); if (!t) continue; const m = t.match(/^\d+\.\s*(.+?)(?::\s*|\n)([\s\S]*)$/); if (m) g.push({ title: m[1].trim(), body: m[2].trim() }); else g.push({ title: "", body: t }); }
  return g.length > 0 ? g : [{ title: "", body: text }];
}

// ══════════════════════════════════════════════════════════════
// FOOTER — RM logo 36px, clean alignment
// ══════════════════════════════════════════════════════════════

function Foot({ left, rmLogoUrl }: { left: string; rmLogoUrl?: string }) {
  return E(View, { style: { position: "absolute", bottom: 16, left: sp.pad, right: sp.pad, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, fixed: true },
    E(Text, { style: { fontSize: 7, color: c.g400 } }, left),
    E(View, { style: { flexDirection: "row", alignItems: "center", gap: 10 } },
      E(Text, { style: { fontSize: 7, color: c.g400 }, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `${pageNumber} / ${totalPages}` }),
      rmLogoUrl ? E(Image, { src: rmLogoUrl, style: { height: 70, width: 70, objectFit: "contain" as const } }) : null,
    ),
  );
}

function Lbl({ text }: { text: string }) { return E(Text, { style: { fontSize: 7.5, fontWeight: "bold", color: c.brand, textTransform: "uppercase", letterSpacing: 1, marginBottom: sp.md } }, text); }
function Accent() { return E(View, { style: { width: 32, height: 3, backgroundColor: c.brand, borderRadius: 1.5, marginBottom: sp.lg } }); }
function Bul({ items }: { items: string[] }) {
  // Detect sub-bullets: lines starting with "Jaar-op-jaar:" are sub-items of the previous main bullet
  return E(View, { style: { marginBottom: sp.lg } },
    ...items.map((it, i) => {
      const isSub = it.startsWith("Jaar-op-jaar:");
      return E(View, { key: i, style: { flexDirection: "row", marginBottom: isSub ? 2 : 5, paddingLeft: isSub ? 16 : 0 } },
        E(Text, { style: { fontSize: isSub ? 7.5 : 8.5, fontWeight: "bold", color: isSub ? c.g500 : c.dark, width: 10 } }, isSub ? "\u2013" : "\u2022"),
        E(Text, { style: { fontSize: isSub ? 7.5 : 8.5, fontWeight: isSub ? "normal" : "bold", color: isSub ? c.g500 : c.dark, flex: 1, lineHeight: 1.5 } }, it),
      );
    }),
  );
}

// ══════════════════════════════════════════════════════════════
// BAR CHART (View-based)
// ══════════════════════════════════════════════════════════════

function ChartBar({ data, label, h = 120 }: { data: MP[]; label?: string; h?: number }) {
  if (!data.length) return null;
  const mx = Math.max(...data.map((d) => d.value), 1);
  const steps = 4; const yW = 44;
  return E(View, {},
    label ? E(Text, { style: { fontSize: 7, color: c.g500, marginBottom: sp.sm } }, label) : null,
    E(View, { style: { flexDirection: "row" } },
      E(View, { style: { width: yW, height: h, justifyContent: "space-between", alignItems: "flex-end", paddingRight: 6 } },
        ...Array.from({ length: steps + 1 }, (_, i) => E(Text, { key: i, style: { fontSize: 6, color: c.g400 } }, fmtAx(mx - (mx / steps) * i))),
      ),
      E(View, { style: { flex: 1, height: h } },
        ...Array.from({ length: steps + 1 }, (_, i) => E(View, { key: `g${i}`, style: { position: "absolute", top: (h / steps) * i, left: 0, right: 0, height: 0.5, backgroundColor: i === steps ? c.g300 : c.g100 } })),
        E(View, { style: { position: "absolute", bottom: 0, left: 2, right: 2, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-evenly" } },
          ...data.map((d, i) => {
            const bh = Math.max(Math.round((d.value / mx) * h), 2);
            const last = i === data.length - 1;
            const w = Math.max(Math.floor(300 / data.length) - 3, 7);
            return E(View, { key: i, style: { width: w, height: bh, borderRadius: 2, backgroundColor: last ? c.brand : c.brandLight, opacity: last ? 1 : 0.55 } });
          }),
        ),
      ),
    ),
    E(View, { style: { flexDirection: "row", justifyContent: "space-evenly", paddingLeft: yW, marginTop: 6 } },
      ...data.map((d, i) => E(Text, { key: i, style: { fontSize: 5, color: c.g400, textAlign: "center" } }, d.month)),
    ),
  );
}

// ══════════════════════════════════════════════════════════════
// LINE CHART (SVG-based with real Path line)
// ══════════════════════════════════════════════════════════════

function ChartLine({ data, label, h = 100 }: { data: MP[]; label?: string; h?: number }) {
  if (!data.length) return null;
  const vals = data.map((d) => d.value);
  const mx = Math.max(...vals);
  const mn = Math.min(...vals);
  const rng = mx - mn || 1;
  const steps = 4;
  const yW = 44;
  const svgW = 320;
  const svgH = h;
  const px = 12;
  const py = 10;
  const plotW = svgW - px * 2;
  const plotH = svgH - py * 2;

  const pts = data.map((d, i) => ({
    x: px + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2),
    y: py + plotH - ((d.value - mn) / rng) * plotH,
  }));

  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const gridYs = Array.from({ length: steps + 1 }, (_, i) => py + (plotH / steps) * i);

  return E(View, {},
    label ? E(Text, { style: { fontSize: 7, color: c.g500, marginBottom: sp.sm } }, label) : null,
    E(View, { style: { flexDirection: "row" } },
      E(View, { style: { width: yW, height: svgH, justifyContent: "space-between", alignItems: "flex-end", paddingRight: 6, paddingVertical: py } },
        ...Array.from({ length: steps + 1 }, (_, i) => E(Text, { key: i, style: { fontSize: 6, color: c.g400 } }, fmtAx(mx - (rng / steps) * i))),
      ),
      E(Svg, { width: svgW, height: svgH, viewBox: `0 0 ${svgW} ${svgH}`, style: { overflow: "visible" as unknown as undefined } },
        // Gridlines
        ...gridYs.map((gy, i) =>
          E(SvgLine, { key: `g${i}`, x1: "0", y1: String(gy), x2: String(svgW), y2: String(gy), stroke: i === steps ? c.g300 : c.g100, strokeWidth: "0.5" }),
        ),
        // THE LINE — connecting path, 3pt stroke, brand orange
        E(Path, { d: pathD, stroke: c.brand, strokeWidth: "3", fill: "none" }),
        // Subtle dots on each point (except last)
        ...pts.slice(0, -1).map((p, i) =>
          E(SvgCircle, { key: `d${i}`, cx: String(p.x), cy: String(p.y), r: "2.5", fill: c.brandLight }),
        ),
        // Last point — larger highlighted dot with white center ring
        pts.length > 0 ? E(SvgCircle, { cx: String(pts[pts.length - 1].x), cy: String(pts[pts.length - 1].y), r: "5.5", fill: c.brand }) : null,
        pts.length > 0 ? E(SvgCircle, { cx: String(pts[pts.length - 1].x), cy: String(pts[pts.length - 1].y), r: "2.5", fill: c.white }) : null,
      ),
    ),
    E(View, { style: { flexDirection: "row", justifyContent: "space-between", paddingLeft: yW, marginTop: 6 } },
      ...data.map((dp, i) => E(Text, { key: i, style: { fontSize: 5, color: c.g400, textAlign: "center", flex: 1 } }, dp.month)),
    ),
  );
}

function Chart({ data, type, label, h }: { data: MP[]; type: "bar" | "line"; label?: string; h?: number }) {
  return type === "line" ? ChartLine({ data, label, h }) : ChartBar({ data, label, h });
}

// ══════════════════════════════════════════════════════════════
// COVER PAGE TEMPLATE
// ══════════════════════════════════════════════════════════════
//
// Layout (landscape A4 = 842 x 595 pt):
//
//  ┌───────────────────────────┬──┬─────────────────────────┐
//  │                           │  │  Grey triangle          │
//  │   COVER PHOTO (50%)       │B │  (accent, top-right)    │
//  │   (full-bleed, cropped)   │L │                         │
//  │                           │U │  "Maandrapportage"      │
//  │                           │E │   (28pt, bold)          │
//  │                           │  │  ── orange bar ──       │
//  │                           │4 │                         │
//  │                           │p │  ┌──────────────────┐   │
//  │   Falls back to solid     │t │  │  CLIENT LOGO     │   │
//  │   blue if no photo        │  │  │  (80pt, hero)    │   │
//  │                           │  │  └──────────────────┘   │
//  │                           │  │                         │
//  │                           │  │  Maart 2026             │
//  │                           │  │                         │
//  │                           │  │           ┌──────────┐  │
//  │                           │  │           │ RM LOGO  │  │
//  │                           │  │           │  50×50   │  │
//  └───────────────────────────┴──┴───────────┴──────────┘  │
//

// Load default cover photo as base64
let defaultCoverPhotoUri: string | undefined;
try {
  const coverPath = require("path").join(process.cwd(), "public", "images", "cover-photo.jpg");
  if (require("fs").existsSync(coverPath)) {
    defaultCoverPhotoUri = `data:image/jpeg;base64,${require("fs").readFileSync(coverPath).toString("base64")}`;
  }
} catch { /* no cover photo */ }

function CoverPage(p: {
  clientName: string; reportMonth: string; reportYear: number;
  generatedAt: string; rmLogoUrl?: string; clientLogoUrl?: string;
  coverImageUrl?: string;
}) {
  const hasClientLogo = !!p.clientLogoUrl;
  const hasRmLogo = !!p.rmLogoUrl;
  const photoSrc = p.coverImageUrl || defaultCoverPhotoUri;
  const hasPhoto = !!photoSrc;

  return E(Page, { size: "A4", orientation: "landscape", style: { padding: 0, fontFamily: "Helvetica", flexDirection: "row" } },

    // ── LEFT: Photo or blue (45%) — slightly less than half for subtlety ──
    hasPhoto
      ? E(View, { style: { width: "43%", overflow: "hidden" } },
          E(Image, { src: photoSrc!, style: { width: "100%", height: "100%", objectFit: "cover" as const, objectPosition: "30% center" as const, opacity: 0.85 } }),
        )
      : E(View, { style: { width: "43%", backgroundColor: c.blue } }),

    // ── MIDDLE: Blue accent stripe ──
    E(View, { style: { width: 4, backgroundColor: c.blue } }),

    // ── RIGHT: White content ──
    E(View, { style: { flex: 1, backgroundColor: c.white, paddingHorizontal: 60, paddingTop: 80, paddingBottom: 50, justifyContent: "space-between" } },

      // ── TOP: Title + Client branding ──
      E(View, {},
        E(Text, { style: { fontSize: 28, fontWeight: "bold", color: c.dark } }, "Maandrapportage"),
        E(View, { style: { width: 40, height: 4, backgroundColor: c.brand, borderRadius: 2, marginTop: sp.md, marginBottom: sp.xxl } }),

        hasClientLogo
          ? E(Image, { src: p.clientLogoUrl!, style: { height: 80, maxWidth: 300, objectFit: "contain" as const, marginBottom: sp.xl } })
          : E(Text, { style: { fontSize: 30, fontWeight: "bold", color: c.dark, marginBottom: sp.xl } }, p.clientName),

        E(Text, { style: { fontSize: 16, color: c.g500, marginTop: sp.sm } }, `${p.reportMonth} ${p.reportYear}`),
      ),

      // ── BOTTOM-RIGHT: RM logo ──
      E(View, { style: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-end", marginRight: -20, marginBottom: -10 } },
        hasRmLogo
          ? E(Image, { src: p.rmLogoUrl!, style: { height: 130, width: 130, objectFit: "contain" as const } })
          : null,
      ),
    ),
  );
}

// ══════════════════════════════════════════════════════════════
// EXECUTIVE SUMMARY
// ══════════════════════════════════════════════════════════════

function SummaryPage(p: { kpiCards: KpiCard[]; reportMonth: string; reportYear: number; clientName: string; rmLogoUrl?: string; summaryHeadline?: string; summarySubtitle?: string }) {
  const row1 = p.kpiCards.slice(0, 3);
  const row2 = p.kpiCards.slice(3);
  return E(Page, { size: "A4", orientation: "landscape", style: { padding: sp.pad, fontFamily: "Helvetica", fontSize: 9, color: c.dark } },
    E(View, { style: { position: "absolute", top: 0, left: 0, right: 0, height: 4, backgroundColor: c.brand } }),
    Lbl({ text: `Samenvatting ${p.reportMonth} ${p.reportYear}` }),
    // Concluderende headline
    p.summaryHeadline
      ? E(Text, { style: { fontSize: 18, fontWeight: "bold", color: c.dark, lineHeight: 1.3, marginBottom: sp.sm } }, p.summaryHeadline)
      : null,
    p.summarySubtitle
      ? E(Text, { style: { fontSize: 9, color: c.g500, marginBottom: sp.xl } }, p.summarySubtitle)
      : E(View, { style: { height: sp.xl } }),
    E(View, { style: { backgroundColor: c.g50, borderRadius: 8, paddingHorizontal: sp.xl, paddingVertical: sp.xxl, marginBottom: sp.lg } },
      E(View, { style: { flexDirection: "row", gap: sp.xxl } }, ...row1.map((k) => KpiBlock(k))),
    ),
    row2.length > 0 ? E(View, { style: { backgroundColor: c.g50, borderRadius: 8, paddingHorizontal: sp.xl, paddingVertical: sp.xxl } },
      E(View, { style: { flexDirection: "row", gap: sp.xxl } },
        ...row2.map((k) => KpiBlock(k)),
        ...Array.from({ length: Math.max(0, 3 - row2.length) }, (_, i) => E(View, { key: `f${i}`, style: { flex: 1 } })),
      ),
    ) : null,
    Foot({ left: `${p.clientName}  |  ${p.reportMonth} ${p.reportYear}`, rmLogoUrl: p.rmLogoUrl }),
  );
}

function KpiBlock(kpi: KpiCard) {
  const cc = chgCol(kpi.changePct, isInv(kpi.label));
  return E(View, { key: kpi.label, style: { flex: 1 } },
    E(View, { style: { flexDirection: "row", justifyContent: "space-between", marginBottom: sp.sm } },
      E(Text, { style: { fontSize: 9, color: c.g500 } }, kpi.label),
      E(Text, { style: { fontSize: 12, fontWeight: "bold", color: cc } }, `${kpi.changePct > 0 ? "+" : ""}${kpi.changePct}%`),
    ),
    E(Text, { style: { fontSize: 36, fontWeight: "bold", color: c.dark, marginBottom: sp.xs } }, fmt(kpi.current, kpi.format)),
    E(Text, { style: { fontSize: 8, color: c.g400 } }, `(${fmt(kpi.previous, kpi.format)})`),
    kpi.yoyChangePct != null ? E(Text, { style: { fontSize: 7, color: c.g400, marginTop: 2 } }, `YoY: ${kpi.yoyChangePct > 0 ? "+" : ""}${kpi.yoyChangePct}%`) : null,
    E(View, { style: { height: 2, backgroundColor: c.g200, marginTop: sp.md } }),
  );
}

// ══════════════════════════════════════════════════════════════
// METRIC PAGE
// ══════════════════════════════════════════════════════════════

function MetricPage(p: { section: MetricSection; clientName: string; rmLogoUrl?: string }) {
  const s = p.section;
  const dual = !!(s.chartData2 && s.chartLabel2);
  return E(Page, { size: "A4", orientation: "landscape", style: { padding: sp.pad, fontFamily: "Helvetica", fontSize: 9, color: c.dark } },
    E(View, { style: { position: "absolute", top: 0, left: 0, width: 4, height: 140, backgroundColor: c.blue } }),
    E(View, { style: { flexDirection: "row", flex: 1 } },
      E(View, { style: { width: "55%", paddingRight: sp.xxl } },
        Lbl({ text: s.label }),
        Accent(),
        E(Text, { style: { fontSize: 18, fontWeight: "bold", color: c.dark, lineHeight: 1.3, marginBottom: sp.xl } }, s.heading),
        Bul({ items: s.bullets }),
        E(Text, { style: { fontSize: 8.5, color: c.g700, lineHeight: 1.65 } }, s.body),
      ),
      E(View, { style: { width: "45%", paddingTop: sp.xl } },
        Chart({ data: s.chartData, type: s.chartType, label: s.chartLabel, h: dual ? 115 : 165 }),
        dual ? E(View, { style: { marginTop: sp.xxl } }, Chart({ data: s.chartData2!, type: s.chartType2 ?? "line", label: s.chartLabel2, h: 100 })) : null,
      ),
    ),
    Foot({ left: `${p.clientName}  |  Maandrapportage`, rmLogoUrl: p.rmLogoUrl }),
  );
}

// ══════════════════════════════════════════════════════════════
// ACTIONS + PLANNING
// ══════════════════════════════════════════════════════════════

function ActionPage(p: { actionSection: { heading: string; body: string }; planningSection: { heading: string; body: string }; clientName: string; rmLogoUrl?: string }) {
  const groups = parseActions(p.actionSection.body);
  return E(Page, { size: "A4", orientation: "landscape", style: { padding: sp.pad, fontFamily: "Helvetica", fontSize: 9, color: c.dark } },
    E(View, { style: { position: "absolute", top: 0, left: 0, right: 0, height: 4, backgroundColor: c.brand } }),
    E(View, { style: { flexDirection: "row", flex: 1 } },
      E(View, { style: { width: "55%", paddingRight: sp.xxl } },
        Lbl({ text: "Acties komende maand" }),
        Accent(),
        E(Text, { style: { fontSize: 16, fontWeight: "bold", color: c.dark, lineHeight: 1.3, marginBottom: sp.xl } }, p.actionSection.heading),
        ...groups.map((g, i) => E(View, { key: i, style: { flexDirection: "row", marginBottom: sp.lg } },
          E(Text, { style: { fontSize: 16, fontWeight: "bold", color: c.brand, width: 28 } }, String(i + 1)),
          E(View, { style: { flex: 1 } },
            g.title ? E(Text, { style: { fontSize: 10, fontWeight: "bold", color: c.dark, marginBottom: 3 } }, g.title) : null,
            E(Text, { style: { fontSize: 8.5, color: c.g700, lineHeight: 1.6 } }, g.body),
          ),
        )),
      ),
      E(View, { style: { width: "45%", paddingLeft: sp.xl, borderLeftWidth: 1, borderLeftColor: c.g200 } },
        Lbl({ text: "Planning & Vooruitblik" }),
        Accent(),
        E(Text, { style: { fontSize: 16, fontWeight: "bold", color: c.dark, lineHeight: 1.3, marginBottom: sp.lg } }, p.planningSection.heading),
        E(Text, { style: { fontSize: 8.5, color: c.g700, lineHeight: 1.7 } }, p.planningSection.body),
      ),
    ),
    Foot({ left: `${p.clientName}  |  Maandrapportage`, rmLogoUrl: p.rmLogoUrl }),
  );
}

// ══════════════════════════════════════════════════════════════
// DOCUMENT
// ══════════════════════════════════════════════════════════════
// COUNTRY DIVIDER PAGE (blue page with country name)
// ══════════════════════════════════════════════════════════════

function CountryDividerPage(p: { countryName: string; reportMonth: string; reportYear: number; rmLogoUrl?: string }) {
  return E(Page, { size: "A4", orientation: "landscape", style: { padding: 0, fontFamily: "Helvetica", flexDirection: "row" } },
    // Blue left half
    E(View, { style: { width: "50%", backgroundColor: c.blue, justifyContent: "center", paddingHorizontal: 60 } },
      E(Text, { style: { fontSize: 32, fontWeight: "bold", color: c.white, lineHeight: 1.2 } }, `Voortgang SEA`),
      E(Text, { style: { fontSize: 32, fontWeight: "bold", color: c.white, lineHeight: 1.2 } }, `${p.countryName}.`),
      p.rmLogoUrl
        ? E(Image, { src: p.rmLogoUrl, style: { width: 50, height: 50, objectFit: "contain" as const, marginTop: sp.xxl, opacity: 0.8 } })
        : null,
    ),
    // White right half (empty, premium whitespace)
    E(View, { style: { width: "50%", backgroundColor: c.white } }),
    // Blue accent stripe
    E(View, { style: { position: "absolute", top: 0, left: "50%", width: 4, height: "100%", backgroundColor: c.blue } }),
  );
}

// ══════════════════════════════════════════════════════════════
// COUNTRY SUMMARY PAGE (KPIs for a specific country)
// ══════════════════════════════════════════════════════════════

function CountrySummaryPage(p: { kpiCards: KpiCard[]; countryName: string; reportMonth: string; reportYear: number; clientName: string; rmLogoUrl?: string }) {
  const row1 = p.kpiCards.slice(0, 3);
  const row2 = p.kpiCards.slice(3);
  return E(Page, { size: "A4", orientation: "landscape", style: { padding: sp.pad, fontFamily: "Helvetica", fontSize: 9, color: c.dark } },
    E(View, { style: { position: "absolute", top: 0, left: 0, right: 0, height: 4, backgroundColor: c.brand } }),
    Lbl({ text: `${p.countryName} | Samenvatting ${p.reportMonth} ${p.reportYear}` }),
    E(View, { style: { height: sp.xxl } }),
    E(View, { style: { backgroundColor: c.g50, borderRadius: 8, paddingHorizontal: sp.xl, paddingVertical: sp.xxl, marginBottom: sp.lg } },
      E(View, { style: { flexDirection: "row", gap: sp.xxl } }, ...row1.map((k) => KpiBlock(k))),
    ),
    row2.length > 0 ? E(View, { style: { backgroundColor: c.g50, borderRadius: 8, paddingHorizontal: sp.xl, paddingVertical: sp.xxl } },
      E(View, { style: { flexDirection: "row", gap: sp.xxl } },
        ...row2.map((k) => KpiBlock(k)),
        ...Array.from({ length: Math.max(0, 3 - row2.length) }, (_, i) => E(View, { key: `f${i}`, style: { flex: 1 } })),
      ),
    ) : null,
    Foot({ left: `${p.clientName}  |  ${p.countryName}  |  ${p.reportMonth} ${p.reportYear}`, rmLogoUrl: p.rmLogoUrl }),
  );
}

// ══════════════════════════════════════════════════════════════
// DOCUMENT
// ══════════════════════════════════════════════════════════════

function Doc(p: ReportPdfProps) {
  return E(Document, {},
    CoverPage({ clientName: p.clientName, reportMonth: p.reportMonth, reportYear: p.reportYear, generatedAt: p.generatedAt, rmLogoUrl: p.rmLogoUrl, clientLogoUrl: p.clientLogoUrl, coverImageUrl: p.coverImageUrl }),
    SummaryPage({ kpiCards: p.kpiCards, reportMonth: p.reportMonth, reportYear: p.reportYear, clientName: p.clientName, rmLogoUrl: p.rmLogoUrl, summaryHeadline: p.summaryHeadline, summarySubtitle: p.summarySubtitle }),
    ...p.metricSections
      .filter((section) => section.heading && section.heading.trim().length > 0 && (section.bullets.length > 0 || section.body.trim().length > 0 || section.chartData.length > 0))
      .map((section) => MetricPage({ section, clientName: p.clientName, rmLogoUrl: p.rmLogoUrl })),
    ActionPage({ actionSection: p.actionSection, planningSection: p.planningSection, clientName: p.clientName, rmLogoUrl: p.rmLogoUrl }),
    // Country sections (if multi-country)
    ...(p.countrySections ?? []).flatMap((cs) => [
      CountryDividerPage({ countryName: cs.countryName, reportMonth: p.reportMonth, reportYear: p.reportYear, rmLogoUrl: p.rmLogoUrl }),
      CountrySummaryPage({ kpiCards: cs.kpiCards, countryName: cs.countryName, reportMonth: p.reportMonth, reportYear: p.reportYear, clientName: p.clientName, rmLogoUrl: p.rmLogoUrl }),
      ...cs.metricSections
        .filter((section) => section.heading && section.heading.trim().length > 0 && (section.bullets.length > 0 || section.body.trim().length > 0 || section.chartData.length > 0))
        .map((section) => MetricPage({ section, clientName: p.clientName, rmLogoUrl: p.rmLogoUrl })),
    ]),
  );
}

export async function renderReportPdf(opts: ReportPdfProps): Promise<Buffer> {
  return await renderToBuffer(Doc(opts));
}
