/**
 * Sensitivity analysis — which levers actually matter?
 *
 * 1. ONE-FACTOR-AT-A-TIME (OFAT): each numeric parameter is perturbed
 *    ±20% (integers rounded, clamped to the control-panel bounds) while
 *    all others stay at base. Each perturbed setting is evaluated with a
 *    small Monte Carlo (default 8 replications, CRN seeds shared with the
 *    base run so differences are not swamped by seed noise). Effects are
 *    ranked by |Δ| on the chosen KPI and shown as a tornado diagram.
 *    OFAT limitation, stated in the UI: it cannot see interactions — a
 *    parameter that only matters in combination with another looks flat
 *    here. The interaction heatmap and the DOE module cover that gap.
 *
 * 2. TWO-FACTOR INTERACTION HEATMAP: for the two parameters most
 *    sensitive on the chosen KPI, a 5×5 grid of (−20%, −10%, 0, +10%,
 *    +20%) combinations is evaluated (small MC each). If the effect of
 *    factor A changes with the level of factor B, the heatmap shows
 *    non-parallel structure — that IS an interaction.
 */

import { runSimulation } from "./engine";
import type { Kpis, SimParams } from "./types";

export type SensitivityKpi = "throughputTeuPerDay" | "avgWaitMin" | "maxQueue" | "co2Tonnes";

/** Numeric parameters swept by OFAT, with their control-panel bounds. */
export interface SweepParam {
  key: keyof SimParams;
  label: string;
  min: number;
  max: number;
  integer?: boolean;
}

export const SWEEP_PARAMS: SweepParam[] = [
  { key: "trucksPerDay", label: "Truck demand", min: 800, max: 4000, integer: true },
  { key: "morningPeakFactor", label: "Morning peak", min: 1, max: 4 },
  { key: "nightFactor", label: "Night arrivals", min: 0, max: 1 },
  { key: "appointmentShare", label: "Appointment share", min: 0, max: 1 },
  { key: "noShowRate", label: "No-show rate", min: 0, max: 0.3 },
  { key: "numGates", label: "Active gates", min: 1, max: 4, integer: true },
  { key: "gateServiceMeanMin", label: "Gate service time", min: 1, max: 8 },
  { key: "gateServiceSigma", label: "Gate service variability", min: 0.1, max: 1.2 },
  { key: "yardCranes", label: "Yard cranes", min: 2, max: 12, integer: true },
  { key: "yardHandleMeanMin", label: "Yard handling time", min: 2, max: 15 },
  { key: "numBerths", label: "Berths", min: 1, max: 5, integer: true },
  { key: "berthLoadMeanMin", label: "Berth loading time", min: 1, max: 8 },
  { key: "grainShare", label: "Grain share", min: 0, max: 0.6 },
];

export interface OfatRow {
  key: keyof SimParams;
  label: string;
  lowValue: number;
  highValue: number;
  lowMean: number;
  highMean: number;
  /** (high − low) effect on the KPI, in KPI units. */
  effect: number;
  /** Effect relative to the base KPI value. */
  relativeEffect: number;
}

export interface OfatResult {
  kpi: SensitivityKpi;
  baseMean: number;
  replications: number;
  rows: OfatRow[]; // sorted by |effect| descending
}

function perturb(
  base: SimParams,
  param: SweepParam,
  factor: number
): SimParams | null {
  const current = base[param.key];
  if (typeof current !== "number") return null;
  let value = current * factor;
  if (param.integer) value = Math.round(value);
  value = Math.min(param.max, Math.max(param.min, value));
  if (value === current) return null; // perturbation had no effect (e.g. clamped)
  return { ...base, [param.key]: value };
}

function mcMean(
  params: SimParams,
  kpi: SensitivityKpi,
  replications: number,
  baseSeed: number
): number {
  let sum = 0;
  for (let i = 0; i < replications; i++) {
    const r = runSimulation({ ...params, seed: baseSeed + i }, undefined, {
      includeSeries: false,
    });
    sum += r.kpis[kpi];
  }
  return sum / Math.max(1, replications);
}

/**
 * OFAT sweep. CRN: every setting uses the same seed sequence, so the
 * low/high/base differences are paired, not independent noise.
 */
export function ofatSensitivity(
  base: SimParams,
  kpi: SensitivityKpi,
  replications = 8,
  delta = 0.2,
  baseSeed?: number
): OfatResult {
  const seed0 = baseSeed ?? base.seed;
  const baseMean = mcMean(base, kpi, replications, seed0);
  const rows: OfatRow[] = [];
  for (const param of SWEEP_PARAMS) {
    const low = perturb(base, param, 1 - delta);
    const high = perturb(base, param, 1 + delta);
    if (!low || !high) continue;
    const lowMean = mcMean(low, kpi, replications, seed0);
    const highMean = mcMean(high, kpi, replications, seed0);
    const effect = highMean - lowMean;
    rows.push({
      key: param.key,
      label: param.label,
      lowValue: low[param.key] as number,
      highValue: high[param.key] as number,
      lowMean,
      highMean,
      effect,
      relativeEffect: baseMean !== 0 ? effect / Math.abs(baseMean) : 0,
    });
  }
  rows.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return { kpi, baseMean, replications, rows };
}

/* ------------------------------------------------------------------ */
/* Two-factor interaction heatmap                                     */
/* ------------------------------------------------------------------ */

export interface HeatmapResult {
  paramA: SweepParam;
  paramB: SweepParam;
  kpi: SensitivityKpi;
  /** Relative perturbations applied, e.g. [-0.2, -0.1, 0, 0.1, 0.2]. */
  levels: number[];
  /** grid[i][j] = KPI mean at paramA level i, paramB level j. */
  grid: number[][];
  /** Base (0,0) cell value. */
  baseMean: number;
  replications: number;
}

/**
 * 5×5 interaction grid for two parameters. `levels` are relative
 * perturbations of the base values. CRN seeds shared across all cells.
 */
export function interactionHeatmap(
  base: SimParams,
  paramA: SweepParam,
  paramB: SweepParam,
  kpi: SensitivityKpi,
  replications = 5,
  levels: number[] = [-0.2, -0.1, 0, 0.1, 0.2],
  baseSeed?: number
): HeatmapResult {
  const seed0 = baseSeed ?? base.seed;
  const grid: number[][] = [];
  for (const la of levels) {
    const row: number[] = [];
    for (const lb of levels) {
      let p = { ...base };
      for (const [param, level] of [
        [paramA, la],
        [paramB, lb],
      ] as Array<[SweepParam, number]>) {
        const current = p[param.key];
        if (typeof current !== "number") continue;
        let value = current * (1 + level);
        if (param.integer) value = Math.round(value);
        value = Math.min(param.max, Math.max(param.min, value));
        p = { ...p, [param.key]: value };
      }
      row.push(mcMean(p, kpi, replications, seed0));
    }
    grid.push(row);
  }
  const mid = levels.indexOf(0);
  return {
    paramA,
    paramB,
    kpi,
    levels,
    grid,
    baseMean: mid >= 0 ? grid[mid][mid] : grid[0][0],
    replications,
  };
}
