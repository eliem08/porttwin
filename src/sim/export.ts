/**
 * Export: download scenario results as CSV (time series) or JSON (full
 * result bundle). Pure string builders are exported for tests; `download`
 * is the browser-only trigger (Blob + temporary anchor).
 */

import type { CostBreakdown, CostRates } from "./costs";
import type { Disruptions } from "./disruptions";
import type { MonteCarloResult } from "./montecarlo";
import type { SimParams, SimResult } from "./types";

export interface ExportBundle {
  exportedAt: string;
  app: string;
  params: SimParams;
  disruptions: Disruptions;
  kpis: SimResult["kpis"];
  waitSamplesMin: number[];
  costs: { rates: CostRates; breakdown: CostBreakdown } | null;
  monteCarlo: {
    replications: number;
    baseSeed: number;
    summaries: MonteCarloResult["summaries"];
  } | null;
  series: SimResult["series"];
}

/** CSV: one row per 15-minute snapshot of the current run. */
export function buildSeriesCsv(result: SimResult): string {
  const header = [
    "t_min",
    "t_hours",
    "gateQueue",
    "appointmentQueue",
    "walkinQueue",
    "gatesBusy",
    "yardQueue",
    "yardBusy",
    "berthQueue",
    "berthsBusy",
    "completedTrucks",
    "completedTeu",
  ].join(",");
  const rows = result.series.map((s) =>
    [
      s.t,
      (s.t / 60).toFixed(2),
      s.gateQueue,
      s.appointmentQueue,
      s.walkinQueue,
      s.gatesBusy,
      s.yardQueue,
      s.yardBusy,
      s.berthQueue,
      s.berthsBusy,
      s.completedTrucks,
      s.completedTeu,
    ].join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}

/** CSV: one row per KPI, current scenario vs baseline, with deltas. */
export function buildKpiCsv(
  current: SimResult,
  baseline: SimResult
): string {
  const header = "kpi,current,baseline,delta_pct";
  const keys = Object.keys(current.kpis) as Array<keyof typeof current.kpis>;
  const rows = keys.map((key) => {
    const cur = current.kpis[key];
    const base = baseline.kpis[key];
    const delta =
      Number.isFinite(base) && base !== 0
        ? (((cur - base) / Math.abs(base)) * 100).toFixed(1)
        : "";
    return `${key},${cur},${base},${delta}`;
  });
  return [header, ...rows].join("\n") + "\n";
}

/** JSON: full reproducible bundle (params + KPIs + costs + MC + series). */
export function buildExportJson(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Trigger a browser download of a text file. No-op outside the browser. */
export function download(filename: string, content: string, mime: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `porttwin-<scenario>-YYYYMMDD-HHMM` filename stem. */
export function exportStem(label: string, when: Date = new Date()): string {
  const stamp = when
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 13);
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `porttwin-${slug || "scenario"}-${stamp}`;
}
