/**
 * Monte Carlo replication: run the same scenario N times with different
 * seeds and summarize each KPI with a mean and a 95% confidence interval.
 *
 * Seeds are derived deterministically from the scenario's base seed
 * (baseSeed + replication index), so the whole Monte Carlo run is
 * reproducible. Confidence intervals use the normal approximation
 * mean ± 1.96 · s / √n, which is standard for n ≥ 30 replications.
 *
 * Two entry points:
 *  - runMonteCarlo: synchronous, for tests and scripts.
 *  - runMonteCarloAsync: yields to the event loop every few replications
 *    and reports progress, so the browser UI stays responsive.
 */

import { runSimulation } from "./engine";
import type { Kpis, SimParams } from "./types";

export interface KpiSummary {
  /** Mean across replications. */
  mean: number;
  /** Sample standard deviation across replications. */
  std: number;
  /** Lower bound of the 95% confidence interval for the mean. */
  ciLow: number;
  /** Upper bound of the 95% confidence interval for the mean. */
  ciHigh: number;
  /** Min / max observed across replications. */
  min: number;
  max: number;
}

export interface MonteCarloResult {
  replications: number;
  baseSeed: number;
  /** Per-KPI summaries. */
  summaries: Record<keyof Kpis, KpiSummary>;
  /** Raw per-replication KPIs (for custom analysis / export). */
  samples: Kpis[];
}

const KPI_KEYS: Array<keyof Kpis> = [
  "throughputTeuPerDay",
  "throughputTrucksPerDay",
  "avgWaitMin",
  "maxQueue",
  "gateUtilization",
  "yardUtilization",
  "berthUtilization",
  "co2Tonnes",
  "totalTrucks",
  "completedTrucks",
  "avgSystemMin",
  "totalWaitHours",
  "totalSystemHours",
  "yardCraneHours",
  "berthCraneHours",
];

function summarize(values: number[]): KpiSummary {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / Math.max(1, n);
  const variance =
    n > 1
      ? values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1)
      : 0;
  const std = Math.sqrt(variance);
  const margin = n > 0 ? 1.96 * (std / Math.sqrt(n)) : 0;
  return {
    mean,
    std,
    ciLow: mean - margin,
    ciHigh: mean + margin,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/** Summarize an already-collected sample of KPIs. Exported for tests. */
export function summarizeSamples(samples: Kpis[]): Record<keyof Kpis, KpiSummary> {
  const out = {} as Record<keyof Kpis, KpiSummary>;
  for (const key of KPI_KEYS) {
    out[key] = summarize(samples.map((s) => s[key]));
  }
  return out;
}

/**
 * Run `replications` simulations of `params` with seeds
 * baseSeed, baseSeed + 1, …, baseSeed + replications − 1.
 * Throws on invalid input (replications < 2, non-finite seed).
 */
export function runMonteCarlo(
  params: SimParams,
  replications: number,
  baseSeed?: number
): MonteCarloResult {
  if (!Number.isInteger(replications) || replications < 2) {
    throw new Error("Monte Carlo requires at least 2 replications");
  }
  const seed0 = baseSeed ?? params.seed;
  if (!Number.isFinite(seed0)) throw new Error("Monte Carlo requires a finite seed");
  const samples: Kpis[] = [];
  for (let i = 0; i < replications; i++) {
    const result = runSimulation(
      { ...params, seed: Math.floor(seed0) + i },
      undefined,
      { includeSeries: false }
    );
    samples.push(result.kpis);
  }
  return {
    replications,
    baseSeed: Math.floor(seed0),
    summaries: summarizeSamples(samples),
    samples,
  };
}

export interface MonteCarloProgress {
  done: number;
  total: number;
}

/**
 * Async Monte Carlo: same result as runMonteCarlo, but yields to the event
 * loop every `chunkSize` replications and calls `onProgress` after each
 * chunk, so a progress bar can update and the page stays responsive.
 */
export async function runMonteCarloAsync(
  params: SimParams,
  replications: number,
  baseSeed?: number,
  onProgress?: (p: MonteCarloProgress) => void,
  chunkSize = 5
): Promise<MonteCarloResult> {
  if (!Number.isInteger(replications) || replications < 2) {
    throw new Error("Monte Carlo requires at least 2 replications");
  }
  const seed0 = Math.floor(baseSeed ?? params.seed);
  if (!Number.isFinite(seed0)) throw new Error("Monte Carlo requires a finite seed");
  const samples: Kpis[] = [];
  for (let i = 0; i < replications; i++) {
    const result = runSimulation(
      { ...params, seed: seed0 + i },
      undefined,
      { includeSeries: false }
    );
    samples.push(result.kpis);
    if ((i + 1) % chunkSize === 0 || i === replications - 1) {
      onProgress?.({ done: i + 1, total: replications });
      // Yield so React can paint the progress bar.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return {
    replications,
    baseSeed: seed0,
    summaries: summarizeSamples(samples),
    samples,
  };
}
