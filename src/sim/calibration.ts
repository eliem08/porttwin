/**
 * Calibration framework — "fit to data" mode.
 *
 * The user pastes observed KPIs from the real port (e.g. average wait,
 * throughput, max queue — the figures reported in the press for the
 * October 2026 crisis), and the tool searches key parameters to minimize
 * a weighted squared relative error:
 *
 *   loss = Σ_k w_k · ((sim_k − obs_k) / obs_k)²
 *
 * Search: random search over a bounded box around the current scenario
 * (default ±50% on trucksPerDay, gateServiceMeanMin, morningPeakFactor),
 * each candidate evaluated with a small fixed-seed Monte Carlo, then the
 * best candidate is re-evaluated with more replications for a stable
 * estimate. Weights default to equal; the UI lets the user up-weight
 * the KPI they trust most (e.g. throughput is usually better measured
 * than max queue).
 *
 * HONESTY — identification: fitting 3 parameters to 3 KPIs is
 * identification-thin. Many parameter combinations can reproduce the
 * same three numbers, so a good fit does NOT prove the parameters are
 * the true ones — it proves the model CAN reproduce those KPIs. The
 * panel reports the residual per KPI and warns explicitly against
 * treating best-fit parameters as measured truth. A real calibration
 * would use time-series data (hourly queue lengths), more KPIs than
 * parameters, and hold-out validation — none of which three numbers
 * provide. See Banks et al., "Discrete-Event System Simulation"
 * (5th ed., Pearson, 2010), Ch. 10 on input modeling and validation.
 */

import { runSimulation } from "./engine";
import type { Kpis, SimParams } from "./types";
import { mulberry32 } from "./rng";

export interface ObservedKpis {
  /** Observed average gate wait in minutes (optional). */
  avgWaitMin?: number;
  /** Observed throughput in TEU/day (optional). */
  throughputTeuPerDay?: number;
  /** Observed max gate queue in trucks (optional). */
  maxQueue?: number;
  /** Observed average system time in minutes (optional). */
  avgSystemMin?: number;
}

export interface CalibrationTarget {
  key: keyof ObservedKpis;
  label: string;
  observed: number;
  unit: string;
  /** Weight in the loss (default 1). */
  weight: number;
}

export interface CalibrationCandidate {
  params: SimParams;
  /** Loss at the search-stage replication count. */
  loss: number;
  /** Per-KPI simulated means and relative errors. */
  fit: Array<{
    key: keyof ObservedKpis;
    observed: number;
    simulated: number;
    relativeError: number;
  }>;
}

export interface CalibrationResult {
  targets: CalibrationTarget[];
  /** Best candidate after refinement. */
  best: CalibrationCandidate;
  /** Loss of the starting scenario (for "did calibration help?"). */
  startLoss: number;
  /** Loss of the best candidate. */
  bestLoss: number;
  /** Number of candidates evaluated. */
  candidatesEvaluated: number;
  /** Parameters that were searched (keys). */
  searchedParams: Array<keyof SimParams>;
  /** Identification warning — always included, always shown. */
  identificationWarning: string;
}

export const IDENTIFICATION_WARNING =
  "Identification warning: fitting 3 parameters to 3 KPIs is identification-thin. " +
  "Many parameter combinations reproduce the same three numbers, so a low residual does NOT " +
  "prove these are the true parameters — it proves the model can reproduce those KPIs. " +
  "Treat best-fit values as a plausible scenario, not measured truth. Real calibration needs " +
  "time-series data, more KPIs than parameters, and hold-out validation.";

export interface CalibrationSearchParam {
  key: keyof SimParams;
  label: string;
  /** Relative bounds around the base value, e.g. [0.5, 1.5] = ±50%. */
  lowFactor: number;
  highFactor: number;
  integer?: boolean;
}

export const DEFAULT_SEARCH_PARAMS: CalibrationSearchParam[] = [
  { key: "trucksPerDay", label: "Truck demand", lowFactor: 0.5, highFactor: 1.5, integer: true },
  { key: "gateServiceMeanMin", label: "Gate service time", lowFactor: 0.5, highFactor: 1.5 },
  { key: "morningPeakFactor", label: "Morning peak", lowFactor: 0.5, highFactor: 1.5 },
];

function lossFor(
  sim: Pick<Kpis, "avgWaitMin" | "throughputTeuPerDay" | "maxQueue" | "avgSystemMin">,
  targets: CalibrationTarget[]
): { loss: number; fit: CalibrationCandidate["fit"] } {
  let loss = 0;
  const fit: CalibrationCandidate["fit"] = [];
  for (const t of targets) {
    const simulated = sim[t.key] as number;
    const rel = t.observed !== 0 ? (simulated - t.observed) / Math.abs(t.observed) : 0;
    loss += t.weight * rel * rel;
    fit.push({ key: t.key, observed: t.observed, simulated, relativeError: rel });
  }
  return { loss, fit };
}

function mcMeanKpis(
  params: SimParams,
  replications: number,
  baseSeed: number
): Kpis {
  const keys: Array<keyof Kpis> = [
    "avgWaitMin",
    "throughputTeuPerDay",
    "maxQueue",
    "avgSystemMin",
  ];
  const acc = {} as Record<string, number>;
  for (const k of keys) acc[k] = 0;
  for (let i = 0; i < replications; i++) {
    const r = runSimulation({ ...params, seed: baseSeed + i }, undefined, {
      includeSeries: false,
    });
    for (const k of keys) acc[k] += r.kpis[k];
  }
  const out = {} as Record<string, number>;
  for (const k of keys) out[k] = acc[k] / Math.max(1, replications);
  return out as unknown as Kpis;
}

/**
 * Random-search calibration. Deterministic for a fixed `searchSeed`.
 * `searchReplications` = MC size per candidate during search (default 4);
 * the winner is refined with `refineReplications` (default 20).
 */
export function calibrate(
  base: SimParams,
  observed: ObservedKpis,
  options: {
    searchParams?: CalibrationSearchParam[];
    candidates?: number;
    searchReplications?: number;
    refineReplications?: number;
    baseSeed?: number;
    searchSeed?: number;
    weights?: Partial<Record<keyof ObservedKpis, number>>;
  } = {}
): CalibrationResult {
  const targets: CalibrationTarget[] = [];
  const labels: Record<keyof ObservedKpis, [string, string]> = {
    avgWaitMin: ["Avg gate wait", "min"],
    throughputTeuPerDay: ["Throughput", "TEU/day"],
    maxQueue: ["Max queue", "trucks"],
    avgSystemMin: ["Avg system time", "min"],
  };
  for (const key of Object.keys(observed) as Array<keyof ObservedKpis>) {
    const value = observed[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    targets.push({
      key,
      label: labels[key][0],
      observed: value,
      unit: labels[key][1],
      weight: options.weights?.[key] ?? 1,
    });
  }
  if (targets.length === 0) {
    throw new Error("calibrate: provide at least one observed KPI");
  }

  const searchParams = options.searchParams ?? DEFAULT_SEARCH_PARAMS;
  const candidates = options.candidates ?? 60;
  const searchReps = options.searchReplications ?? 4;
  const refineReps = options.refineReplications ?? 20;
  const baseSeed = options.baseSeed ?? base.seed;
  const rng = mulberry32(options.searchSeed ?? 12345);

  const startKpis = mcMeanKpis(base, searchReps, baseSeed);
  const startLoss = lossFor(startKpis, targets).loss;

  let bestParams = base;
  let bestLoss = Infinity;
  let bestFit: CalibrationCandidate["fit"] = [];

  // Candidate 0 is the starting scenario itself: calibration never
  // returns a worse fit than where it started.
  const candidateList: SimParams[] = [base];
  for (let i = 0; i < candidates; i++) {
    let candidate = { ...base };
    for (const sp of searchParams) {
      const current = base[sp.key];
      if (typeof current !== "number") continue;
      const lo = current * sp.lowFactor;
      const hi = current * sp.highFactor;
      let value = lo + (hi - lo) * rng();
      if (sp.integer) value = Math.round(value);
      candidate = { ...candidate, [sp.key]: value };
    }
    candidateList.push(candidate);
  }

  for (const candidate of candidateList) {
    const kpis = mcMeanKpis(candidate, searchReps, baseSeed);
    const { loss, fit } = lossFor(kpis, targets);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestParams = candidate;
      bestFit = fit;
    }
  }

  // Refine the winner with more replications for a stable estimate.
  const refinedKpis = mcMeanKpis(bestParams, refineReps, baseSeed);
  const refined = lossFor(refinedKpis, targets);

  return {
    targets,
    best: { params: bestParams, loss: refined.loss, fit: refined.fit },
    startLoss,
    bestLoss: refined.loss,
    candidatesEvaluated: candidateList.length,
    searchedParams: searchParams.map((s) => s.key),
    identificationWarning: IDENTIFICATION_WARNING,
  };
}
