/**
 * Verification & validation (V&V) panel — the model proves itself.
 *
 * Verification (is the code right?) uses identities that MUST hold for
 * any correct discrete-event implementation, checked against the run's
 * own bookkeeping:
 *
 * 1. CONSERVATION OF FLOW — every generated truck is either completed
 *    or still in the system at the horizon end. Exact integer equality;
 *    any violation is a bug, not noise.
 *
 * 2. LITTLE'S LAW — L = λ·W for the whole system. L is the time-average
 *    number in system (rectangle rule over snapshots), λ is arrivals per
 *    minute, and W is the mean sojourn over ALL arrivals with trucks
 *    still in flight counted up to the horizon end (truncated sojourn).
 *    The truncation is what makes the identity hold on a TERMINATING
 *    run: ∫L dt = Σ truncated sojourns holds sample-path by sample-path.
 *    The remaining gap is only the rectangle-rule error of the snapshot
 *    integration, hence the 10% tolerance. Using completed-trucks-only
 *    W here would be wrong (it excludes in-flight trucks that L counts)
 *    — an earlier version of this check did exactly that and failed by
 *    79% on the TAS preset, which is how the bug was caught.
 *    See Law & Kelton Ch. 1 / Banks et al. Ch. 10 on verification.
 *
 * 3. UTILIZATION IDENTITIES — per stage, measured busy time must equal
 *    (starts × E[service]) within sampling error, because busy time is
 *    literally the sum of realized service times. The expectations use
 *    the EXACT floored distributions the engine draws from: the engine
 *    floors service times at 0.5 / 1 / 1 minutes, which raises the
 *    exponential berth mean by ~7% (E[max(1, Exp(μ))] = 1 + μe^(−1/μ)).
 *    Ignoring the floor makes the berth check fail systematically — an
 *    earlier version did, and the failure exposed the floor.
 *
 * Validation (is the model the right model?) against the real port is
 * NOT claimed here — the model is stylized, not fitted to live data.
 * The calibration module is where observed data enters, with its own
 * warnings. This panel verifies internal consistency only, and says so.
 */

import type { SimResult } from "./types";
import {
  flooredExponentialMean,
  flooredLognormalMean,
} from "./stats";

export interface VVCheck {
  id: string;
  name: string;
  /** One-line statement of the identity being tested. */
  identity: string;
  /** Left-hand side of the identity. */
  lhs: number;
  /** Right-hand side of the identity. */
  rhs: number;
  /** |lhs − rhs| / max(|rhs|, tiny), as a fraction. */
  relativeError: number;
  /** Tolerance (fraction) for a pass. */
  tolerance: number;
  passed: boolean;
  /** Why a failure/gap is expected, if it is. */
  note: string;
}

export interface VVReport {
  checks: VVCheck[];
  /** True when every check passes. */
  allPassed: boolean;
  /** Exact conservation residual (must be 0). */
  conservationResidual: number;
}

const DEFAULT_TOLERANCES = {
  littlesLaw: 0.1,
  utilization: 0.1,
};

function makeCheck(
  id: string,
  name: string,
  identity: string,
  lhs: number,
  rhs: number,
  tolerance: number,
  note: string
): VVCheck {
  const denom = Math.max(Math.abs(rhs), 1e-9);
  const relativeError = Math.abs(lhs - rhs) / denom;
  return {
    id,
    name,
    identity,
    lhs,
    rhs,
    relativeError,
    tolerance,
    passed: relativeError <= tolerance,
    note,
  };
}

/** Run all V&V checks on one simulation result. */
export function verifyRun(
  result: SimResult,
  tolerances: { littlesLaw?: number; utilization?: number } = {}
): VVReport {
  const tolL = tolerances.littlesLaw ?? DEFAULT_TOLERANCES.littlesLaw;
  const tolU = tolerances.utilization ?? DEFAULT_TOLERANCES.utilization;
  const v = result.verification;
  const p = result.params;
  const horizonMin = p.simHours * 60;

  const checks: VVCheck[] = [];

  // 1. Conservation of flow — exact.
  const conservationResidual = v.totalArrivals - (v.completed + v.inSystemEnd);
  checks.push({
    id: "conservation",
    name: "Conservation of flow",
    identity: "arrivals = completed + in system at horizon end",
    lhs: v.totalArrivals,
    rhs: v.completed + v.inSystemEnd,
    relativeError: v.totalArrivals > 0 ? Math.abs(conservationResidual) / v.totalArrivals : 0,
    tolerance: 0,
    passed: conservationResidual === 0,
    note: "Exact integer bookkeeping. Any residual ≠ 0 is an engine bug.",
  });

  // 2. Little's Law — truncated-sojourn W makes this hold on a
  // terminating run; residual gap is snapshot rectangle-rule error.
  const lambda = horizonMin > 0 ? v.totalArrivals / horizonMin : 0;
  const meanSojourn = v.meanSojournAllMin;
  const L = v.meanInSystem ?? 0;
  checks.push(
    makeCheck(
      "littles-law",
      "Little's Law (whole system)",
      "L = λ × W (W = mean truncated sojourn, all arrivals)",
      L,
      lambda * meanSojourn,
      tolL,
      "Residual gap is the rectangle-rule error of the 15-min snapshot integration of L(t)."
    )
  );

  // 3a. Gate utilization identity. The engine floors gate service at
  // 0.5 min, so use the exact floored-lognormal expectation.
  const gateExpected = flooredLognormalMean(
    p.gateServiceMeanMin,
    p.gateServiceSigma,
    0.5
  );
  checks.push(
    makeCheck(
      "util-gate",
      "Gate utilization identity",
      "busy time = starts × E[max(0.5, lognormal service)]",
      v.gateBusyMin,
      v.gateStarts * gateExpected,
      tolU,
      "Sampling variation of realized service times; tightens with more trucks."
    )
  );

  // 3b. Yard utilization identity. Yard service is lognormal with mean
  // yardHandleMeanMin; the weather disruption scales service times by
  // 1/productivity, so the identity only holds when no weather
  // disruption is active. Report it as informational otherwise.
  const weatherOn = p.disruptions?.weatherSlowdown?.enabled ?? false;
  if (!weatherOn) {
    const yardExpected = flooredLognormalMean(p.yardHandleMeanMin, 0.4, 1);
    checks.push(
      makeCheck(
        "util-yard",
        "Yard utilization identity",
        "busy time = starts × E[max(1, lognormal handling)]",
        v.yardBusyMin,
        v.yardStarts * yardExpected,
        tolU,
        "Sampling variation of realized lognormal handling times."
      )
    );
  } else {
    checks.push({
      id: "util-yard",
      name: "Yard utilization identity",
      identity: "busy time = starts × E[handling] (weather-adjusted — skipped)",
      lhs: v.yardBusyMin,
      rhs: NaN,
      relativeError: NaN,
      tolerance: tolU,
      passed: true,
      note: "Skipped: the weather disruption scales yard service times, so the unadjusted identity does not apply.",
    });
  }

  // 3c. Berth utilization identity. The engine floors berth service at
  // 1 min, so use E[max(1, Exp(μ))] = 1 + μe^(−1/μ), not μ.
  const berthExpected = flooredExponentialMean(p.berthLoadMeanMin);
  checks.push(
    makeCheck(
      "util-berth",
      "Berth utilization identity",
      "busy time = starts × E[max(1, exponential loading)]",
      v.berthBusyMin,
      v.berthStarts * berthExpected,
      tolU,
      "Sampling variation of realized exponential loading times."
    )
  );

  return {
    checks,
    allPassed: checks.every((c) => c.passed),
    conservationResidual,
  };
}
