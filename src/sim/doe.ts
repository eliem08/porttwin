/**
 * Design of experiments (DOE) — full factorial runner.
 *
 * Textbook basis: Montgomery, "Design and Analysis of Experiments"
 * (9th ed., Wiley, 2017), Ch. 5 — a 2^k factorial design varies k
 * factors over 2 levels each (low/high, coded −1/+1) in all 2^k
 * combinations. Unlike OFAT, it estimates INTERACTIONS: whether the
 * effect of one factor depends on the level of another.
 *
 * Each cell is run with R replications (CRN seeds shared across cells).
 * Effects are estimated by the Yates-style contrast method:
 *   main effect of A = mean(response at A=high) − mean(response at A=low)
 *   interaction AB = mean(response where A·B=+1) − mean(response where A·B=−1)
 * For a 2-factor design the interaction plot shows two lines (B low/high
 * vs A); non-parallel lines = interaction. For 3 factors, all two-way
 * interactions plus the three-way interaction are reported.
 *
 * Levels: numeric factors use base × (1 ± levelDelta); boolean factors
 * (appointment system, grain priority) use false/true. The user picks
 * 2 or 3 factors from the curated list.
 */

import { runSimulation } from "./engine";
import type { SimParams } from "./types";

export type DoeKpi = "throughputTeuPerDay" | "avgWaitMin" | "maxQueue";

export interface DoeFactor {
  key: keyof SimParams;
  label: string;
  boolean?: boolean;
}

export const DOE_FACTORS: DoeFactor[] = [
  { key: "numGates", label: "Active gates" },
  { key: "gateServiceMeanMin", label: "Gate service time" },
  { key: "trucksPerDay", label: "Truck demand" },
  { key: "appointmentSystem", label: "Appointment system", boolean: true },
  { key: "morningPeakFactor", label: "Morning peak" },
  { key: "yardCranes", label: "Yard cranes" },
];

export interface DoeCell {
  /** Coded levels: −1 = low, +1 = high, in factor order. */
  coded: number[];
  /** Actual parameter values used. */
  values: Array<number | boolean>;
  /** Mean KPI across replications. */
  mean: number;
  /** Standard deviation across replications. */
  std: number;
}

export interface DoeEffect {
  /** "A", "B", "AB", "ABC", ... */
  label: string;
  /** Human-readable name, e.g. "Active gates" or "Gates × Service time". */
  name: string;
  /** Effect estimate in KPI units. */
  effect: number;
  /** Effect as % of the grand mean. */
  relativeEffect: number;
}

export interface DoeResult {
  factors: DoeFactor[];
  kpi: DoeKpi;
  replications: number;
  cells: DoeCell[];
  /** Grand mean across all cells. */
  grandMean: number;
  effects: DoeEffect[];
  /**
   * For a 2-factor design: interaction-plot data — for each level of
   * factor B, the KPI mean at factor A low and high.
   */
  interactionPlot: Array<{
    series: string;
    low: number;
    high: number;
  }> | null;
}

function levelValue(
  base: SimParams,
  factor: DoeFactor,
  coded: number,
  delta: number
): number | boolean {
  const current = base[factor.key];
  if (factor.boolean) return coded > 0;
  if (typeof current !== "number") throw new Error(`DOE: factor ${String(factor.key)} is not numeric`);
  const value = current * (1 + coded * delta);
  // Integer-valued parameters (gates, cranes, demand) stay integers.
  if (Number.isInteger(current)) return Math.max(1, Math.round(value));
  return value;
}

const FACTOR_LETTERS = ["A", "B", "C"];

/** All 2^k sign patterns, in standard (Yates) order. */
function signPatterns(k: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < 2 ** k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      // Factor j flips every 2^j runs — standard order.
      row.push(Math.floor(i / 2 ** j) % 2 === 0 ? -1 : 1);
    }
    out.push(row);
  }
  return out;
}

/**
 * Full 2^k factorial. `delta` is the relative perturbation for numeric
 * factors (default 0.2 = ±20%). `kpi` selects the response.
 */
export function runFactorial(
  base: SimParams,
  factors: DoeFactor[],
  kpi: DoeKpi,
  replications = 5,
  delta = 0.2,
  baseSeed?: number
): DoeResult {
  const k = factors.length;
  if (k < 2 || k > 3) throw new Error("runFactorial: choose 2 or 3 factors");
  if (!Number.isInteger(replications) || replications < 2) {
    throw new Error("runFactorial: need at least 2 replications per cell");
  }
  const seed0 = baseSeed ?? base.seed;
  const patterns = signPatterns(k);

  const cells: DoeCell[] = [];
  for (const coded of patterns) {
    let params = { ...base };
    const values: Array<number | boolean> = [];
    for (let j = 0; j < k; j++) {
      const v = levelValue(base, factors[j], coded[j], delta);
      values.push(v);
      params = { ...params, [factors[j].key]: v };
    }
    const samples: number[] = [];
    for (let i = 0; i < replications; i++) {
      const r = runSimulation({ ...params, seed: seed0 + i }, undefined, {
        includeSeries: false,
      });
      samples.push(r.kpis[kpi]);
    }
    const m = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance =
      samples.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, samples.length - 1);
    cells.push({ coded, values, mean: m, std: Math.sqrt(variance) });
  }

  const grandMean = cells.reduce((s, c) => s + c.mean, 0) / cells.length;

  // Effects via contrasts: effect = (Σ sign·cellMean) / 2^(k−1).
  const effects: DoeEffect[] = [];
  // Main effects.
  for (let j = 0; j < k; j++) {
    const contrast = cells.reduce((s, c) => s + c.coded[j] * c.mean, 0);
    const effect = contrast / 2 ** (k - 1);
    effects.push({
      label: FACTOR_LETTERS[j],
      name: factors[j].label,
      effect,
      relativeEffect: grandMean !== 0 ? effect / Math.abs(grandMean) : 0,
    });
  }
  // Two-way interactions.
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      const contrast = cells.reduce((s, c) => s + c.coded[a] * c.coded[b] * c.mean, 0);
      const effect = contrast / 2 ** (k - 1);
      effects.push({
        label: `${FACTOR_LETTERS[a]}${FACTOR_LETTERS[b]}`,
        name: `${factors[a].label} × ${factors[b].label}`,
        effect,
        relativeEffect: grandMean !== 0 ? effect / Math.abs(grandMean) : 0,
      });
    }
  }
  // Three-way interaction (k = 3).
  if (k === 3) {
    const contrast = cells.reduce(
      (s, c) => s + c.coded[0] * c.coded[1] * c.coded[2] * c.mean,
      0
    );
    const effect = contrast / 2 ** (k - 1);
    effects.push({
      label: "ABC",
      name: `${factors[0].label} × ${factors[1].label} × ${factors[2].label}`,
      effect,
      relativeEffect: grandMean !== 0 ? effect / Math.abs(grandMean) : 0,
    });
  }

  // Interaction plot for the 2-factor case: factor B series × factor A axis.
  let interactionPlot: DoeResult["interactionPlot"] = null;
  if (k === 2) {
    interactionPlot = [-1, 1].map((bLevel) => {
      const lowCell = cells.find((c) => c.coded[0] === -1 && c.coded[1] === bLevel)!;
      const highCell = cells.find((c) => c.coded[0] === 1 && c.coded[1] === bLevel)!;
      return {
        series: `${factors[1].label} ${bLevel > 0 ? "high" : "low"}`,
        low: lowCell.mean,
        high: highCell.mean,
      };
    });
  }

  return { factors, kpi, replications, cells, grandMean, effects, interactionPlot };
}
