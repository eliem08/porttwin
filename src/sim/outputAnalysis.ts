/**
 * Proper output analysis for simulation results (Law & Kelton Ch. 9).
 *
 * Three textbook methods, each with the assumptions stated in the UI:
 *
 * 1. WELCH'S MOVING-AVERAGE PROCEDURE — detect the warm-up / transient.
 *    Run R replications, average the performance measure across replications
 *    at each time point, then smooth with a moving average of window w.
 *    The smoothed curve shows where the initial transient dies out.
 *    HONESTY NOTE: this twin is a TERMINATING simulation (one 24 h day,
 *    starts empty). The ramp-up is real behaviour, not bias to delete —
 *    so the warm-up point is reported as a diagnostic and NOT deleted.
 *    Deletion would be appropriate for a steady-state (multi-day) study.
 *
 * 2. BATCH MEANS — a CI from a SINGLE long run. Split one run's time
 *    series into m batches, treat batch means as approximately i.i.d.,
 *    and build a t-CI on their mean. Assumes approximate stationarity
 *    within the run; for a strongly non-stationary day (morning peak)
 *    the batch-means CI is indicative only — replication CIs remain
 *    the primary inference. Reported with that caveat.
 *
 * 3. COMMON RANDOM NUMBERS (CRN) + PAIRED COMPARISON — compare two
 *    scenarios with the SAME seed stream (seed + i for both). Shared
 *    randomness induces positive correlation between the two outputs, so
 *    the variance of the DIFFERENCE shrinks and the paired-t CI on the
 *    mean difference is tighter than the independent-samples CI. CRN
 *    works best when the two scenarios consume the random stream in
 *    similar ways (e.g. same arrivals, different gate count); it helps
 *    less when a structural change (TAS on/off) reshuffles the stream.
 *    The panel shows both CIs so the gain is visible, not assumed.
 */

import { runSimulation } from "./engine";
import { confidenceInterval, mean, sampleStd, tQuantile, type ConfidenceInterval } from "./stats";
import type { SimParams, SimResult, Snapshot } from "./types";

/* ------------------------------------------------------------------ */
/* Welch's moving-average procedure                                    */
/* ------------------------------------------------------------------ */

export interface WelchResult {
  /** Time points (minutes) of the averaged series. */
  times: number[];
  /** Ensemble mean across replications at each time point. */
  ensembleMean: number[];
  /** Moving average of the ensemble mean (window `window`). */
  movingAverage: number[];
  /** Moving-average window used. */
  window: number;
  /**
   * First time (minutes) after which the moving average stays within
   * `tolerance` (relative) of the post-warm-up plateau for the remainder
   * of the run. Null when no such point exists (transient never settles).
   * Diagnostic only — see module header on terminating simulations.
   */
  warmupMin: number | null;
  /** Replications used. */
  replications: number;
}

/**
 * Welch's procedure on a performance measure extracted from each
 * replication's snapshot series (default: gate queue length).
 * Requires all replications to share the same snapshot cadence.
 */
export function welchMovingAverage(
  runs: SimResult[],
  pick: (s: Snapshot) => number = (s) => s.gateQueue,
  window = 5,
  tolerance = 0.1
): WelchResult {
  if (runs.length === 0) throw new Error("welchMovingAverage: need at least one run");
  if (!Number.isInteger(window) || window < 1) {
    throw new Error("welchMovingAverage: window must be a positive integer");
  }
  const n = runs[0].series.length;
  if (n === 0) throw new Error("welchMovingAverage: runs have no snapshot series");
  for (const r of runs) {
    if (r.series.length !== n) {
      throw new Error("welchMovingAverage: all runs must share the same series length");
    }
  }
  const times = runs[0].series.map((s) => s.t);
  const ensembleMean: number[] = [];
  for (let i = 0; i < n; i++) {
    ensembleMean.push(mean(runs.map((r) => pick(r.series[i]))));
  }
  const movingAverage: number[] = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - window + 1);
    movingAverage.push(mean(ensembleMean.slice(lo, i + 1)));
  }
  // Plateau: mean of the last quarter of the moving average.
  const plateauStart = Math.floor((n * 3) / 4);
  const plateau = mean(movingAverage.slice(plateauStart));
  let warmupMin: number | null = null;
  if (Number.isFinite(plateau) && plateau !== 0) {
    for (let i = 0; i < n; i++) {
      const rest = movingAverage.slice(i);
      const settled = rest.every(
        (v) => Math.abs(v - plateau) <= tolerance * Math.abs(plateau)
      );
      if (settled) {
        warmupMin = times[i];
        break;
      }
    }
  }
  return { times, ensembleMean, movingAverage, window, warmupMin, replications: runs.length };
}

/**
 * Convenience runner: R replications of `params` with seeds
 * baseSeed … baseSeed + R − 1, returning the Welch analysis.
 */
export function welchForParams(
  params: SimParams,
  replications: number,
  baseSeed?: number,
  window = 5
): WelchResult {
  const seed0 = baseSeed ?? params.seed;
  const runs: SimResult[] = [];
  for (let i = 0; i < replications; i++) {
    runs.push(runSimulation({ ...params, seed: seed0 + i }));
  }
  return welchMovingAverage(runs, (s) => s.gateQueue, window);
}

/* ------------------------------------------------------------------ */
/* Batch means                                                         */
/* ------------------------------------------------------------------ */

export interface BatchMeansResult {
  /** Number of batches. */
  batches: number;
  /** Batch size in snapshots. */
  batchSize: number;
  /** Mean of each batch. */
  batchMeans: number[];
  /** t-CI on the grand mean from the batch means. */
  ci: ConfidenceInterval;
  /** Grand mean (equals the mean of the raw series). */
  grandMean: number;
}

/**
 * Batch-means CI from one run's snapshot series (default: gate queue).
 * The series is truncated to a whole number of batches; the remainder
 * snapshots are dropped and reported via `droppedSnapshots`.
 * Throws when the series is too short for the requested batch count.
 */
export function batchMeans(
  result: SimResult,
  batchCount = 10,
  pick: (s: Snapshot) => number = (s) => s.gateQueue
): BatchMeansResult & { droppedSnapshots: number } {
  const values = result.series.map(pick);
  if (values.length < batchCount * 2) {
    throw new Error(
      `batchMeans: need at least ${batchCount * 2} snapshots, got ${values.length}`
    );
  }
  const batchSize = Math.floor(values.length / batchCount);
  const used = batchSize * batchCount;
  const batchMeans: number[] = [];
  for (let b = 0; b < batchCount; b++) {
    batchMeans.push(mean(values.slice(b * batchSize, (b + 1) * batchSize)));
  }
  return {
    batches: batchCount,
    batchSize,
    batchMeans,
    ci: confidenceInterval(batchMeans),
    grandMean: mean(values.slice(0, used)),
    droppedSnapshots: values.length - used,
  };
}

/* ------------------------------------------------------------------ */
/* Common random numbers + paired comparison                           */
/* ------------------------------------------------------------------ */

export interface PairedComparisonResult {
  replications: number;
  baseSeed: number;
  /** Per-replication KPI values under scenario A and B. */
  pairsA: number[];
  pairsB: number[];
  /** Per-replication differences (B − A). */
  differences: number[];
  /** Paired-t CI on the mean difference (CRN). */
  pairedCI: ConfidenceInterval;
  /**
   * Independent-samples CI on the mean difference (Welch–Satterthwaite),
   * i.e. what you would report if the two scenarios had used unrelated
   * random streams. Shown so the CRN variance reduction is visible.
   */
  independentCI: ConfidenceInterval;
  /** Sample correlation between A and B outputs (CRN should make it positive). */
  correlation: number;
  /** True when the paired CI is strictly narrower than the independent CI. */
  pairedNarrower: boolean;
}

/**
 * Compare two scenarios with COMMON RANDOM NUMBERS: both run with seeds
 * baseSeed … baseSeed + replications − 1, so replication i of A shares
 * its random stream with replication i of B. The comparison is on the
 * per-replication differences, with a paired-t CI. `pick` selects the
 * KPI being compared (default: average wait).
 */
export function pairedComparison(
  paramsA: SimParams,
  paramsB: SimParams,
  replications: number,
  baseSeed?: number,
  pick: (r: SimResult) => number = (r) => r.kpis.avgWaitMin
): PairedComparisonResult {
  if (!Number.isInteger(replications) || replications < 2) {
    throw new Error("pairedComparison: need at least 2 replications");
  }
  const seed0 = Math.floor(baseSeed ?? paramsA.seed);
  const pairsA: number[] = [];
  const pairsB: number[] = [];
  for (let i = 0; i < replications; i++) {
    pairsA.push(
      pick(
        runSimulation({ ...paramsA, seed: seed0 + i }, undefined, {
          includeSeries: false,
        })
      )
    );
    pairsB.push(
      pick(
        runSimulation({ ...paramsB, seed: seed0 + i }, undefined, {
          includeSeries: false,
        })
      )
    );
  }
  const differences = pairsA.map((a, i) => pairsB[i] - a);
  const pairedCI = confidenceInterval(differences);

  // Independent-samples (Welch–Satterthwaite) CI on the same data.
  const mA = mean(pairsA);
  const mB = mean(pairsB);
  const vA = sampleStd(pairsA) ** 2;
  const vB = sampleStd(pairsB) ** 2;
  const n = replications;
  const se = Math.sqrt(vA / n + vB / n);
  const dfNum = (vA / n + vB / n) ** 2;
  const dfDen = (vA / n) ** 2 / (n - 1) + (vB / n) ** 2 / (n - 1);
  const df = dfDen > 0 ? dfNum / dfDen : 1;
  const tCrit = tQuantile(0.975, df);
  const diffMean = mB - mA;
  const independentCI: ConfidenceInterval = {
    n,
    mean: diffMean,
    std: se * Math.sqrt(n),
    halfWidth: tCrit * se,
    ciLow: diffMean - tCrit * se,
    ciHigh: diffMean + tCrit * se,
    tCritical: tCrit,
  };

  // Pearson correlation between the paired outputs.
  const sdA = sampleStd(pairsA);
  const sdB = sampleStd(pairsB);
  let correlation = 0;
  if (sdA > 0 && sdB > 0) {
    const cov =
      pairsA.reduce((s, a, i) => s + (a - mA) * (pairsB[i] - mB), 0) / (n - 1);
    correlation = cov / (sdA * sdB);
  }

  return {
    replications,
    baseSeed: seed0,
    pairsA,
    pairsB,
    differences,
    pairedCI,
    independentCI,
    correlation,
    pairedNarrower: pairedCI.halfWidth < independentCI.halfWidth,
  };
}
