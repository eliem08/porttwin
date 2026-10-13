/**
 * Research-grade module tests: output analysis, V&V, calibration,
 * Erlang-C, DOE, sensitivity. Every statistical claim is checked against
 * independently computed values (textbook examples or hand calculations).
 */
import { describe, expect, it } from "vitest";
import {
  batchMeans,
  calibrate,
  confidenceInterval,
  erlangC,
  erlangGateCheck,
  flooredExponentialMean,
  flooredLognormalMean,
  interactionHeatmap,
  normalCdf,
  ofatSensitivity,
  pairedComparison,
  presetParams,
  runFactorial,
  runSimulation,
  tCdf,
  tQuantile,
  verifyRun,
  welchForParams,
  welchMovingAverage,
} from "../src/sim";
import type { SimResult, Snapshot } from "../src/sim";

/* ---------------------------------------------------------------- */
/* stats: t-distribution + helpers                                    */
/* ---------------------------------------------------------------- */

describe("t-distribution", () => {
  it("tQuantile matches textbook critical values", () => {
    // t(0.975, 9) = 2.262, t(0.975, 1) = 12.706, t(0.975, ∞) = 1.960.
    expect(tQuantile(0.975, 9)).toBeCloseTo(2.262, 2);
    expect(tQuantile(0.975, 1)).toBeCloseTo(12.706, 2);
    expect(tQuantile(0.975, 1000)).toBeCloseTo(1.962, 2);
    expect(tQuantile(0.5, 5)).toBe(0);
  });

  it("tCdf is the inverse of tQuantile", () => {
    for (const df of [1, 4, 9, 30]) {
      expect(tCdf(tQuantile(0.975, df), df)).toBeCloseTo(0.975, 6);
      expect(tCdf(tQuantile(0.1, df), df)).toBeCloseTo(0.1, 6);
    }
    expect(tCdf(0, 7)).toBeCloseTo(0.5, 9);
  });

  it("confidenceInterval uses t, not 1.96 (n = 5 hand calculation)", () => {
    // values 2,4,6,8,10: mean 6, s = √10 ≈ 3.1623, df 4, t = 2.7764.
    const ci = confidenceInterval([2, 4, 6, 8, 10]);
    expect(ci.mean).toBeCloseTo(6, 9);
    expect(ci.tCritical).toBeCloseTo(2.7764, 3);
    expect(ci.ciLow).toBeCloseTo(6 - (2.7764 * Math.sqrt(10)) / Math.sqrt(5), 2);
    expect(ci.ciHigh).toBeCloseTo(6 + (2.7764 * Math.sqrt(10)) / Math.sqrt(5), 2);
    // Wider than the (wrong) normal-approx interval for small n.
    expect(ci.halfWidth).toBeGreaterThan((1.96 * Math.sqrt(10)) / Math.sqrt(5));
  });

  it("normalCdf matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("floored expectations match hand calculations", () => {
    // E[max(1, Exp(2.5))] = 1 + 2.5·e^(−0.4) ≈ 2.6758.
    expect(flooredExponentialMean(2.5)).toBeCloseTo(1 + 2.5 * Math.exp(-0.4), 9);
    // As sigma → 0 the lognormal degenerates at its mean: floor below mean → mean.
    expect(flooredLognormalMean(5, 0.001, 1)).toBeCloseTo(5, 2);
    // Floor above the mean: expectation tends to the floor.
    expect(flooredLognormalMean(5, 0.001, 10)).toBeCloseTo(10, 2);
  });
});

/* ---------------------------------------------------------------- */
/* Welch's procedure                                                  */
/* ---------------------------------------------------------------- */

function fakeRun(queue: number[]): SimResult {
  const series: Snapshot[] = queue.map((q, i) => ({
    t: i * 15,
    gateQueue: q,
    appointmentQueue: 0,
    walkinQueue: 0,
    gatesBusy: 0,
    yardQueue: 0,
    yardBusy: 0,
    berthQueue: 0,
    berthsBusy: 0,
    completedTrucks: 0,
    completedTeu: 0,
  }));
  return {
    params: presetParams("crisis"),
    kpis: runSimulation(presetParams("crisis")).kpis,
    series,
    waitSamplesMin: [],
    verification: runSimulation(presetParams("crisis")).verification,
  };
}

describe("Welch moving average", () => {
  it("detects warm-up on synthetic transient data", () => {
    // Queue decays from 100 toward a plateau of 10 (exponential transient).
    const transient = Array.from({ length: 40 }, (_, i) => 10 + 90 * Math.exp(-i / 4));
    const runs = [fakeRun(transient), fakeRun(transient), fakeRun(transient)];
    const w = welchMovingAverage(runs, (s) => s.gateQueue, 5);
    expect(w.times.length).toBe(40);
    expect(w.movingAverage[0]).toBeCloseTo(100, 6);
    expect(w.movingAverage[39]).toBeCloseTo(10, 0);
    // Warm-up is detected strictly inside the run, after the transient.
    expect(w.warmupMin).not.toBeNull();
    expect(w.warmupMin!).toBeGreaterThan(0);
    expect(w.warmupMin!).toBeLessThan(40 * 15);
  });

  it("settled series reports warm-up at the start", () => {
    const flat = Array.from({ length: 20 }, () => 7);
    const w = welchMovingAverage([fakeRun(flat), fakeRun(flat)], (s) => s.gateQueue, 3);
    expect(w.warmupMin).toBe(0);
  });

  it("runs on real simulations and returns matching lengths", () => {
    const w = welchForParams(presetParams("crisis"), 3, 42, 5);
    expect(w.replications).toBe(3);
    expect(w.times.length).toBe(w.ensembleMean.length);
    expect(w.times.length).toBe(w.movingAverage.length);
    expect(w.times[0]).toBe(0);
  });
});

/* ---------------------------------------------------------------- */
/* Batch means                                                        */
/* ---------------------------------------------------------------- */

describe("batch means", () => {
  it("CI covers the grand mean on a real run", () => {
    const r = runSimulation(presetParams("crisis"));
    const bm = batchMeans(r, 8);
    expect(bm.batches).toBe(8);
    expect(bm.batchMeans.length).toBe(8);
    expect(bm.ci.ciLow).toBeLessThanOrEqual(bm.grandMean);
    expect(bm.ci.ciHigh).toBeGreaterThanOrEqual(bm.grandMean);
    expect(bm.ci.tCritical).toBeCloseTo(tQuantile(0.975, 7), 6);
  });

  it("throws on a too-short series", () => {
    const r = runSimulation({ ...presetParams("crisis"), simHours: 1 });
    expect(() => batchMeans(r, 10)).toThrow();
  });
});

/* ---------------------------------------------------------------- */
/* CRN paired comparison                                              */
/* ---------------------------------------------------------------- */

describe("common random numbers", () => {
  it("paired CI is narrower than independent CI on the same comparison", () => {
    const base = presetParams("crisis");
    const moreGates = { ...presetParams("crisis"), numGates: 4 };
    const cmp = pairedComparison(base, moreGates, 20, 42, (r) => r.kpis.avgWaitMin);
    expect(cmp.differences.length).toBe(20);
    expect(cmp.correlation).toBeGreaterThan(0);
    expect(cmp.pairedNarrower).toBe(true);
    expect(cmp.pairedCI.halfWidth).toBeLessThan(cmp.independentCI.halfWidth);
    // Adding a gate must reduce waits: the paired CI excludes zero.
    expect(cmp.pairedCI.ciHigh).toBeLessThan(0);
  });

  it("paired CI agrees with independent CI when there is no effect", () => {
    const base = presetParams("crisis");
    const cmp = pairedComparison(base, base, 10, 42, (r) => r.kpis.avgWaitMin);
    expect(cmp.differences.every((d) => d === 0)).toBe(true);
    expect(cmp.pairedCI.mean).toBe(0);
    expect(cmp.pairedCI.halfWidth).toBe(0);
  });
});

/* ---------------------------------------------------------------- */
/* V&V                                                                */
/* ---------------------------------------------------------------- */

describe("verification & validation", () => {
  it("all checks pass on every preset (seed 42)", () => {
    for (const id of ["crisis", "tas", "tas-night"]) {
      const vv = verifyRun(runSimulation(presetParams(id)));
      expect(vv.conservationResidual).toBe(0);
      expect(vv.allPassed).toBe(true);
      for (const c of vv.checks) {
        expect(c.passed).toBe(true);
      }
    }
  });

  it("all checks pass across seeds and with disruptions", () => {
    for (const seed of [1, 7, 99]) {
      const p = { ...presetParams("crisis"), seed };
      const vv = verifyRun(runSimulation(p));
      expect(vv.allPassed).toBe(true);
    }
    // Crane breakdown + gate closure keep the identities intact.
    const disrupted = presetParams("crisis");
    disrupted.disruptions.craneBreakdown.enabled = true;
    disrupted.disruptions.gateClosure.enabled = true;
    expect(verifyRun(runSimulation(disrupted)).allPassed).toBe(true);
  });

  it("weather disruption skips the yard identity without failing", () => {
    const p = presetParams("crisis");
    p.disruptions.weatherSlowdown.enabled = true;
    const vv = verifyRun(runSimulation(p));
    const yard = vv.checks.find((c) => c.id === "util-yard")!;
    expect(yard.passed).toBe(true);
    expect(yard.note).toMatch(/Skipped/);
    expect(vv.allPassed).toBe(true);
  });
});

/* ---------------------------------------------------------------- */
/* Erlang-C                                                           */
/* ---------------------------------------------------------------- */

describe("Erlang-C", () => {
  it("matches textbook M/M/c values", () => {
    // M/M/2, λ=1, μ=1: a=1, C = 1/3, Wq = C/(cμ−λ) = 1/3.
    const r = erlangC(1, 1, 2);
    expect(r.stable).toBe(true);
    expect(r.probWait).toBeCloseTo(1 / 3, 9);
    expect(r.meanWait).toBeCloseTo(1 / 3, 9);
    expect(r.meanQueue).toBeCloseTo(1 / 3, 9);
    expect(r.meanInSystem).toBeCloseTo(1 + 1 / 3, 9);
    // M/M/1, λ=0.5, μ=1: Wq = ρ/(μ−λ) = 1.
    const r1 = erlangC(0.5, 1, 1);
    expect(r1.probWait).toBeCloseTo(0.5, 9);
    expect(r1.meanWait).toBeCloseTo(1, 9);
  });

  it("reports instability instead of a number when ρ ≥ 1", () => {
    const r = erlangC(3, 1, 2);
    expect(r.stable).toBe(false);
    expect(r.rho).toBeGreaterThanOrEqual(1);
    expect(r.meanWait).toBeNull();
    expect(r.probWait).toBeNull();
  });

  it("gate cross-check returns finite values for the crisis preset", () => {
    const p = presetParams("crisis");
    const r = erlangGateCheck(p);
    expect(r.arrivalRatePerMin).toBeGreaterThan(0);
    expect(r.serviceRatePerMin).toBeCloseTo(1 / p.gateServiceMeanMin, 9);
    // Crisis gate is overloaded: ρ > 1, so no steady state — honest null.
    expect(r.stable).toBe(false);
    const tas = erlangGateCheck(presetParams("tas-night"));
    expect(tas.arrivalRatePerMin).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------- */
/* Calibration                                                        */
/* ---------------------------------------------------------------- */

describe("calibration", () => {
  it("reduces error vs the starting point and never returns worse", () => {
    // "Observed" = the crisis preset's own KPIs; start from the TAS preset.
    const target = runSimulation(presetParams("crisis"));
    const observed = {
      avgWaitMin: target.kpis.avgWaitMin,
      throughputTeuPerDay: target.kpis.throughputTeuPerDay,
      maxQueue: target.kpis.maxQueue,
    };
    const res = calibrate(presetParams("tas"), observed, {
      candidates: 25,
      searchReplications: 3,
      refineReplications: 8,
    });
    expect(res.candidatesEvaluated).toBe(26); // 25 random + starting point
    expect(res.bestLoss).toBeLessThanOrEqual(res.startLoss);
    expect(res.best.fit.length).toBe(3);
    expect(res.identificationWarning).toMatch(/identification/i);
    expect(res.searchedParams).toContain("trucksPerDay");
  });

  it("throws with no observed KPIs", () => {
    expect(() => calibrate(presetParams("crisis"), {})).toThrow();
  });
});

/* ---------------------------------------------------------------- */
/* DOE                                                                */
/* ---------------------------------------------------------------- */

describe("design of experiments", () => {
  it("2-factor factorial: effects match hand-computed contrasts", () => {
    const base = presetParams("crisis");
    const factors = [
      { key: "numGates" as const, label: "Active gates" },
      { key: "gateServiceMeanMin" as const, label: "Gate service time" },
    ];
    const res = runFactorial(base, factors, "avgWaitMin", 3, 0.2, 42);
    expect(res.cells.length).toBe(4);
    expect(res.grandMean).toBeCloseTo(
      res.cells.reduce((s, c) => s + c.mean, 0) / 4,
      9
    );
    // Main effect of A = mean(high A) − mean(low A), computed directly.
    const highA = res.cells.filter((c) => c.coded[0] === 1);
    const lowA = res.cells.filter((c) => c.coded[0] === -1);
    const effectA =
      highA.reduce((s, c) => s + c.mean, 0) / 2 -
      (lowA.reduce((s, c) => s + c.mean, 0) / 2);
    expect(res.effects.find((e) => e.label === "A")!.effect).toBeCloseTo(effectA, 9);
    // Interaction plot: two series, low/high of A.
    expect(res.interactionPlot).toHaveLength(2);
    expect(res.interactionPlot![0]).toHaveProperty("low");
    expect(res.interactionPlot![0]).toHaveProperty("high");
    // More gates must help waits: main effect of gates is negative.
    expect(res.effects.find((e) => e.label === "A")!.effect).toBeLessThan(0);
  });

  it("3-factor factorial has 8 cells and a three-way term", () => {
    const base = presetParams("crisis");
    const factors = [
      { key: "numGates" as const, label: "Active gates" },
      { key: "gateServiceMeanMin" as const, label: "Gate service time" },
      { key: "yardCranes" as const, label: "Yard cranes" },
    ];
    const res = runFactorial(base, factors, "throughputTeuPerDay", 2, 0.2, 42);
    expect(res.cells.length).toBe(8);
    expect(res.effects.map((e) => e.label)).toContain("ABC");
    expect(res.interactionPlot).toBeNull(); // only defined for k = 2
  });

  it("rejects anything but 2 or 3 factors", () => {
    const base = presetParams("crisis");
    expect(() =>
      runFactorial(base, [{ key: "numGates", label: "Gates" }], "avgWaitMin", 2)
    ).toThrow();
  });
});

/* ---------------------------------------------------------------- */
/* Sensitivity                                                        */
/* ---------------------------------------------------------------- */

describe("sensitivity analysis", () => {
  it("OFAT ranks effects and includes the gate lever", () => {
    const res = ofatSensitivity(presetParams("crisis"), "avgWaitMin", 4, 0.2, 42);
    expect(res.rows.length).toBeGreaterThan(5);
    // Sorted by |effect| descending.
    for (let i = 1; i < res.rows.length; i++) {
      expect(Math.abs(res.rows[i - 1].effect)).toBeGreaterThanOrEqual(
        Math.abs(res.rows[i].effect)
      );
    }
    const gates = res.rows.find((r) => r.key === "numGates")!;
    expect(gates).toBeDefined();
    // More gates → shorter waits: high − low effect is negative.
    expect(gates.effect).toBeLessThan(0);
    expect(res.baseMean).toBeGreaterThan(0);
  });

  it("interaction heatmap is a 5×5 grid with the base on the diagonal centre", () => {
    const base = presetParams("crisis");
    const heat = interactionHeatmap(
      base,
      { key: "numGates", label: "Active gates", min: 1, max: 4, integer: true },
      { key: "gateServiceMeanMin", label: "Gate service time", min: 1, max: 8 },
      "avgWaitMin",
      3,
      [-0.2, -0.1, 0, 0.1, 0.2],
      42
    );
    expect(heat.grid.length).toBe(5);
    expect(heat.grid[0].length).toBe(5);
    expect(heat.grid[2][2]).toBeCloseTo(heat.baseMean, 9);
    for (const row of heat.grid) {
      for (const v of row) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
