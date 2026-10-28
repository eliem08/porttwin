/**
 * Phase B correctness audit — probing tests for the discrete-event core
 * and statistics. Each section maps to an audit item:
 *
 *  B1 event ordering (incl. tie-breaking determinism)
 *  B2 entity conservation (no duplication / loss / double processing)
 *  B3 KPI definition + unit consistency
 *  B4 seed reproducibility (end-to-end determinism)
 *  B5 confidence intervals on replication-level observations, Student-t
 *  B6 common random numbers (seed-level CRN + honest limitation)
 *  B7 calibration underdetermination guard
 *  B8 cost model measured-vs-assumed provenance
 *  B9 saved-scenario validation (incompatible payloads cannot crash)
 *
 * All stochastic behavior is seeded — these tests are fully deterministic.
 */
import { describe, it, expect } from "vitest";
import { EventQueue, generateTrucks, runSimulation } from "../src/sim/engine";
import { mulberry32 } from "../src/sim/rng";
import { DEFAULT_PARAMS, presetParams } from "../src/sim/scenarios";
import { cloneDisruptions, DEFAULT_DISRUPTIONS } from "../src/sim/disruptions";
import { runMonteCarlo } from "../src/sim/montecarlo";
import {
  confidenceInterval,
  mean,
  sampleStd,
  tQuantile,
} from "../src/sim/stats";
import { pairedComparison } from "../src/sim/outputAnalysis";
import { calibrate } from "../src/sim/calibration";
import { computeCosts } from "../src/sim/costs";
import {
  loadSavedScenarios,
  saveScenario,
  type StorageLike,
} from "../src/sim/storage";
import {
  SCENARIO_SCHEMA_VERSION,
  validateSimParams,
  validateScenarioEntry,
} from "../src/sim/validate";
import { verifyRun } from "../src/sim/vv";
import type { Disruptions } from "../src/sim/disruptions";
import type { SimParams, Truck } from "../src/sim/types";

function stubTruck(id: number): Truck {
  return {
    id,
    arrivalTime: 0,
    hasAppointment: false,
    slotTime: null,
    teu: 1,
    isGrain: false,
    gateStartTime: null,
    gateWaitMin: 0,
  };
}

function tinyParams(over: Partial<SimParams> = {}): SimParams {
  return {
    ...DEFAULT_PARAMS,
    seed: 7,
    simHours: 6,
    trucksPerDay: 300,
    ...over,
  };
}

/** Busy enough that gate waits are non-zero and vary across replications. */
function busyParams(over: Partial<SimParams> = {}): SimParams {
  return {
    ...DEFAULT_PARAMS,
    seed: 7,
    simHours: 12,
    trucksPerDay: 2600,
    numGates: 3,
    gateServiceMeanMin: 3.6,
    ...over,
  };
}

function memStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

/* ------------------------------------------------------------------ */
/* B1 — event ordering, including tie-breaking determinism             */
/* ------------------------------------------------------------------ */

describe("B1 event queue ordering", () => {
  it("pops simultaneous events in insertion (sequence) order", () => {
    const q = new EventQueue();
    const rng = mulberry32(11);
    const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    // Insert in scrambled order, all at the same timestamp.
    const order = [...ids].sort(() => rng() - 0.5);
    for (const id of order) q.push(100, "gateEnd", stubTruck(id));
    const popped: number[] = [];
    let ev = q.pop();
    while (ev) {
      popped.push(ev.truck.id);
      ev = q.pop();
    }
    // Sequence tie-break = FIFO among simultaneous events: pop order must
    // equal insertion order (`order`), even though ids were scrambled.
    expect(popped).toEqual(order);
  });

  it("pops in non-decreasing (time, sequence) order", () => {
    const q = new EventQueue();
    const rng = mulberry32(23);
    for (let i = 0; i < 500; i++) {
      q.push(Math.floor(rng() * 50), "gateEnd", stubTruck(i));
    }
    let prevTime = -Infinity;
    let prevSeq = -Infinity;
    let ev = q.pop();
    while (ev) {
      expect(
        ev.time > prevTime || (ev.time === prevTime && ev.seq >= prevSeq)
      ).toBe(true);
      prevTime = ev.time;
      prevSeq = ev.seq;
      ev = q.pop();
    }
  });

  it("interleaved push/pop always returns the current minimum", () => {
    const q = new EventQueue();
    const rng = mulberry32(37);
    const ref: Array<{ time: number; seq: number }> = [];
    let seq = 0;
    // Mirror the heap's (time, seq) contract in a reference list.
    for (let step = 0; step < 300; step++) {
      if (rng() < 0.6 || ref.length === 0) {
        const time = Math.floor(rng() * 100);
        q.push(time, "yardEnd", stubTruck(seq));
        ref.push({ time, seq });
        seq++;
      } else {
        ref.sort((a, b) => a.time - b.time || a.seq - b.seq);
        const want = ref.shift()!;
        const got = q.pop()!;
        expect(got.time).toBe(want.time);
        expect(got.seq).toBe(want.seq);
      }
    }
  });

  it("identical arrival streams produce identical event sequences", () => {
    // End-to-end: same seed → same trajectory (also covered in B4, but
    // here we assert the event-driven path specifically).
    const a = runSimulation(tinyParams(), undefined, { includeSeries: true });
    const b = runSimulation(tinyParams(), undefined, { includeSeries: true });
    expect(a.series.map((s) => s.t)).toEqual(b.series.map((s) => s.t));
    expect(a.series.map((s) => s.gateQueue)).toEqual(
      b.series.map((s) => s.gateQueue)
    );
  });
});

/* ------------------------------------------------------------------ */
/* B2 — entity conservation                                            */
/* ------------------------------------------------------------------ */

describe("B2 entity conservation", () => {
  const disruptionCombos: Array<[string, Disruptions]> = [
    ["none", cloneDisruptions(DEFAULT_DISRUPTIONS)],
    [
      "crane+gate+weather+bunching",
      {
        ...cloneDisruptions(DEFAULT_DISRUPTIONS),
        craneBreakdown: { enabled: true, craneIndex: 0, startHour: 8, durationHours: 4 },
        gateClosure: { enabled: true, gateIndex: 1, startHour: 6, durationHours: 8 },
        weatherSlowdown: { enabled: true, startHour: 10, durationHours: 3, productivityFactor: 0.7 },
        vesselBunching: { enabled: true, extraTrucks: 120, windowStartHour: 7, windowHours: 2 },
      },
    ],
  ];

  for (const presetId of ["crisis", "tas", "tas-night"] as const) {
    for (const seed of [1, 42]) {
      for (const [dName, disruptions] of disruptionCombos) {
        it(`conserves trucks: preset=${presetId} seed=${seed} disruptions=${dName}`, () => {
          const params = { ...presetParams(presetId), seed, disruptions };
          const r = runSimulation(params, undefined, { includeSeries: false });
          const v = r.verification;
          // Exact integer equality — any residual is an engine bug.
          expect(v.totalArrivals - (v.completed + v.inSystemEnd)).toBe(0);
          expect(verifyRun(r).conservationResidual).toBe(0);
          // Stage starts are monotone: a truck cannot start yard without
          // starting gate, etc. (no duplication, no skipping).
          expect(v.gateStarts).toBeGreaterThanOrEqual(v.yardStarts);
          expect(v.yardStarts).toBeGreaterThanOrEqual(v.berthStarts);
          expect(v.berthStarts).toBeGreaterThanOrEqual(v.completed);
          // Every gate-service start records exactly one wait sample
          // (no truck processed twice, none silently skipped).
          expect(r.waitSamplesMin.length).toBe(v.gateStarts);
          expect(r.kpis.completedTrucks).toBe(v.completed);
          expect(r.kpis.totalTrucks).toBe(v.totalArrivals);
        });
      }
    }
  }

  it("generates unique truck ids", () => {
    for (const seed of [7, 99, 1234]) {
      const trucks = generateTrucks(tinyParams({ seed }), mulberry32(seed));
      const ids = trucks.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("maxQueue is the true maximum over the whole run, not a sample", () => {
    const r = runSimulation(busyParams(), undefined, { includeSeries: true });
    const sampledMax = Math.max(...r.series.map((s) => s.gateQueue));
    expect(r.kpis.maxQueue).toBeGreaterThanOrEqual(sampledMax);
  });
});

/* ------------------------------------------------------------------ */
/* B3 — KPI definition and unit consistency                            */
/* ------------------------------------------------------------------ */

describe("B3 KPI consistency", () => {
  it("gate utilization = busy gate-minutes / available gate-minutes, in [0,1]", () => {
    for (const presetId of ["crisis", "tas", "tas-night"] as const) {
      const r = runSimulation(
        { ...presetParams(presetId), seed: 5 },
        undefined,
        { includeSeries: false }
      );
      const v = r.verification;
      expect(v.gateOpenServerMin).toBeGreaterThan(0);
      // The KPI is the raw busy/capacity ratio capped at 1: gateBusyMin
      // counts full realized service times, so service spilling past gate
      // closing can push the raw ratio marginally above 1 (saturated
      // gates at closing time). The KPI reports utilization of the open
      // window, which cannot exceed 100%.
      expect(r.kpis.gateUtilization).toBe(
        Math.min(1, v.gateBusyMin / v.gateOpenServerMin)
      );
      expect(r.kpis.gateUtilization).toBeGreaterThanOrEqual(0);
      expect(r.kpis.gateUtilization).toBeLessThanOrEqual(1);
      expect(r.kpis.yardUtilization).toBeLessThanOrEqual(1);
      expect(r.kpis.berthUtilization).toBeLessThanOrEqual(1);
    }
  });

  it("wait aggregates are mutually consistent (minutes vs hours)", () => {
    const r = runSimulation(busyParams(), undefined, { includeSeries: false });
    const waits = r.waitSamplesMin;
    expect(waits.length).toBeGreaterThan(0);
    // avgWaitMin (minutes) is the mean of the per-truck wait samples.
    expect(r.kpis.avgWaitMin).toBeCloseTo(mean(waits), 9);
    // totalWaitHours is the same sum, converted to hours.
    expect(r.kpis.totalWaitHours).toBeCloseTo(
      waits.reduce((s, w) => s + w, 0) / 60,
      9
    );
    // CO2 (tonnes) = idle truck-hours × kg per idle hour ÷ 1000.
    expect(r.kpis.co2Tonnes).toBeCloseTo(
      (r.kpis.totalWaitHours * r.params.co2KgPerIdleHour) / 1000,
      9
    );
  });

  it("throughput and system-time aggregates use consistent units", () => {
    const r = runSimulation(busyParams(), undefined, { includeSeries: false });
    // Per-day scaling: 24 / simHours.
    expect(r.kpis.throughputTrucksPerDay).toBeCloseTo(
      r.kpis.completedTrucks * (24 / r.params.simHours),
      9
    );
    // avgSystemMin (minutes) × completed = totalSystemHours × 60.
    expect(r.kpis.avgSystemMin * r.kpis.completedTrucks).toBeCloseTo(
      r.kpis.totalSystemHours * 60,
      6
    );
  });
});

/* ------------------------------------------------------------------ */
/* B4 — seed reproducibility                                           */
/* ------------------------------------------------------------------ */

describe("B4 seed reproducibility", () => {
  it("identical seeds give identical end-to-end trajectories", () => {
    const params = busyParams();
    const a = runSimulation(params);
    const b = runSimulation(params);
    expect(a.kpis).toEqual(b.kpis);
    expect(a.series).toEqual(b.series);
    expect(a.waitSamplesMin).toEqual(b.waitSamplesMin);
    expect(a.verification).toEqual(b.verification);
  });

  it("different seeds give different trajectories", () => {
    const a = runSimulation(busyParams({ seed: 1 }), undefined, {
      includeSeries: false,
    });
    const b = runSimulation(busyParams({ seed: 2 }), undefined, {
      includeSeries: false,
    });
    expect(a.kpis.avgWaitMin).not.toBe(b.kpis.avgWaitMin);
  });

  it("Monte Carlo is reproducible for a fixed base seed", () => {
    const params = tinyParams({ simHours: 4, trucksPerDay: 200 });
    const a = runMonteCarlo(params, 3, 777);
    const b = runMonteCarlo(params, 3, 777);
    expect(a.summaries.avgWaitMin.mean).toBe(b.summaries.avgWaitMin.mean);
    expect(a.samples).toEqual(b.samples);
  });
});

/* ------------------------------------------------------------------ */
/* B5 — confidence intervals: replication-level, Student-t             */
/* ------------------------------------------------------------------ */

describe("B5 confidence intervals", () => {
  it("CIs are computed on replication-level observations with t(df=n-1)", () => {
    const params = busyParams();
    const n = 5;
    const mc = runMonteCarlo(params, n, 4242);
    const samples = mc.samples.map((s) => s.avgWaitMin);
    // Independent recomputation from the raw replication samples.
    const ci = confidenceInterval(samples);
    const summary = mc.summaries.avgWaitMin;
    expect(summary.mean).toBe(ci.mean);
    expect(summary.std).toBe(ci.std);
    expect(summary.halfWidth).toBe(ci.halfWidth);
    expect(summary.ciLow).toBe(ci.ciLow);
    expect(summary.ciHigh).toBe(ci.ciHigh);
    // The critical value is t(0.975, n-1), NOT the 1.96 normal factor.
    expect(summary.ciHigh - summary.ciLow).toBeGreaterThan(0);
    const s = sampleStd(samples);
    const tCrit = (summary.ciHigh - summary.mean) * Math.sqrt(n) / s;
    expect(tCrit).toBeCloseTo(tQuantile(0.975, n - 1), 9);
    expect(tQuantile(0.975, n - 1)).toBeGreaterThan(1.96);
  });

  it("uses n-1 degrees of freedom, not within-replication samples", () => {
    // If the CI were (wrongly) built on within-replication wait samples,
    // the half-width would shrink with the truck count, not with the
    // replication count. Here we pin df = n - 1 directly.
    const values = [10, 12, 9, 11, 13];
    const ci = confidenceInterval(values);
    expect(ci.tCritical).toBeCloseTo(tQuantile(0.975, 4), 9);
    expect(ci.n).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* B6 — common random numbers                                          */
/* ------------------------------------------------------------------ */

describe("B6 common random numbers", () => {
  it("identical scenarios give zero differences (no NaN, no crash)", () => {
    const p = busyParams();
    const r = pairedComparison(p, p, 8, 42);
    expect(r.differences.every((d) => d === 0)).toBe(true);
    expect(r.pairedCI.halfWidth).toBe(0);
    expect(Number.isFinite(r.pairedCI.ciLow)).toBe(true);
    expect(Number.isFinite(r.pairedCI.ciHigh)).toBe(true);
    // Identical inputs are perfectly correlated (theory: ρ = 1).
    expect(r.correlation).toBe(1);
  });

  it("mild structural change: CRN induces positive correlation and a tighter paired CI", () => {
    const a = busyParams();
    const b = busyParams({ numGates: 4 });
    const r = pairedComparison(a, b, 10, 42);
    expect(r.correlation).toBeGreaterThan(0.5);
    expect(r.pairedNarrower).toBe(true);
    expect(r.pairedCI.halfWidth).toBeLessThan(r.independentCI.halfWidth);
  });

  it("stream reshuffle (TAS on/off) is reported honestly, not assumed", () => {
    const a = busyParams();
    const b = busyParams({ appointmentSystem: true, appointmentShare: 0.85 });
    const r = pairedComparison(a, b, 10, 42);
    // The engine uses seed-level CRN on a single shared stream; a
    // structural change desynchronizes it. The result must still report
    // both CIs and a finite correlation rather than claiming a win.
    expect(Number.isFinite(r.correlation)).toBe(true);
    expect(Number.isFinite(r.pairedCI.halfWidth)).toBe(true);
    expect(Number.isFinite(r.independentCI.halfWidth)).toBe(true);
    expect(r.differences.length).toBe(10);
  });
});

/* ------------------------------------------------------------------ */
/* B7 — calibration underdetermination guard                           */
/* ------------------------------------------------------------------ */

describe("B7 calibration guards", () => {
  const base = tinyParams({ simHours: 4, trucksPerDay: 200 });

  it("flags an underdetermined fit (1 observed KPI, 3 searched params)", () => {
    const cal = calibrate(
      base,
      { avgWaitMin: 30 },
      { candidates: 10, searchReplications: 2, refineReplications: 4, searchSeed: 1 }
    );
    expect(cal.targets.length).toBe(1);
    expect(cal.underdetermined).toBe(true);
    expect(cal.underdeterminationWarning).toMatch(/Underdetermined/);
    // The always-on identification warning is still present.
    expect(cal.identificationWarning.length).toBeGreaterThan(0);
  });

  it("does not flag a determined fit (3 observed KPIs, 3 searched params)", () => {
    const cal = calibrate(
      base,
      { avgWaitMin: 30, throughputTeuPerDay: 400, maxQueue: 50 },
      { candidates: 10, searchReplications: 2, refineReplications: 4, searchSeed: 1 }
    );
    expect(cal.underdetermined).toBe(false);
    expect(cal.underdeterminationWarning).toBeNull();
  });

  it("is deterministic for a fixed search seed", () => {
    const opts = {
      candidates: 10,
      searchReplications: 2,
      refineReplications: 4,
      searchSeed: 3,
    };
    const a = calibrate(base, { avgWaitMin: 30 }, opts);
    const b = calibrate(base, { avgWaitMin: 30 }, opts);
    expect(a.best.params).toEqual(b.best.params);
    expect(a.bestLoss).toBe(b.bestLoss);
  });
});

/* ------------------------------------------------------------------ */
/* B8 — cost model provenance                                          */
/* ------------------------------------------------------------------ */

describe("B8 cost model provenance", () => {
  it("every line item distinguishes measured inputs from assumptions", () => {
    const r = runSimulation(busyParams(), undefined, { includeSeries: true });
    const costs = computeCosts(r.kpis, r.waitSamplesMin);
    expect(costs.items.length).toBeGreaterThan(0);
    for (const item of costs.items) {
      expect(item.provenance.measured.length).toBeGreaterThan(0);
      expect(item.provenance.assumed.length).toBeGreaterThan(0);
    }
    // Total is the sum of the (rounded) line items.
    const sum = costs.items.reduce((s, i) => s + i.amount, 0);
    expect(costs.total).toBeCloseTo(sum, 2);
  });
});

/* ------------------------------------------------------------------ */
/* B9 — saved-scenario validation                                      */
/* ------------------------------------------------------------------ */

describe("B9 saved-scenario validation", () => {
  function rawStorageWith(payload: unknown): StorageLike {
    const s = memStorage();
    s.setItem("porttwin.savedScenarios.v1", JSON.stringify(payload));
    return s;
  }

  function validEntry(over: Record<string, unknown> = {}) {
    const params = JSON.parse(
      JSON.stringify({ ...DEFAULT_PARAMS, disruptions: DEFAULT_DISRUPTIONS })
    );
    const disruptions = JSON.parse(JSON.stringify(DEFAULT_DISRUPTIONS));
    return {
      name: "good",
      savedAt: new Date().toISOString(),
      version: SCENARIO_SCHEMA_VERSION,
      params,
      disruptions,
      ...over,
    };
  }

  it("round-trips a saved scenario with a schema version", () => {
    const s = memStorage();
    const list = saveScenario("crisis copy", DEFAULT_PARAMS, DEFAULT_DISRUPTIONS, s);
    expect(list[0].version).toBe(SCENARIO_SCHEMA_VERSION);
    const loaded = loadSavedScenarios(s);
    expect(loaded.length).toBe(1);
    expect(loaded[0].name).toBe("crisis copy");
    // A loaded scenario runs without NaN KPIs.
    const r = runSimulation(loaded[0].params);
    for (const v of Object.values(r.kpis)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("accepts legacy entries with no version field", () => {
    const entry = validEntry();
    delete (entry as Record<string, unknown>).version;
    const loaded = loadSavedScenarios(rawStorageWith([entry]));
    expect(loaded.length).toBe(1);
  });

  it("accepts entries with extra unknown fields (forward-compatible)", () => {
    const loaded = loadSavedScenarios(
      rawStorageWith([validEntry({ futureField: "hello", params: { ...validEntry().params, extra: 1 } })])
    );
    expect(loaded.length).toBe(1);
  });

  it("drops incompatible payloads instead of crashing", () => {
    const base = validEntry();
    const bad: unknown[] = [
      // wrong type for a numeric param
      validEntry({ params: { ...base.params, numGates: "3" } }),
      // missing disruptions bundle
      validEntry({ disruptions: undefined }),
      // non-finite seed
      validEntry({ params: { ...base.params, seed: null } }),
      // reversed peak window
      validEntry({ params: { ...base.params, peakWindow: [10, 6] } }),
      // non-numeric TEU pair (would push NaN through KPIs)
      validEntry({ params: { ...base.params, teuPerTruck: ["a", "b"] } }),
      // schema from the future — cannot be interpreted
      validEntry({ version: SCENARIO_SCHEMA_VERSION + 99 }),
      // not an object at all
      "just a string",
      42,
      null,
      // empty name
      validEntry({ name: "   " }),
    ];
    const loaded = loadSavedScenarios(rawStorageWith(bad));
    expect(loaded).toEqual([]);
  });

  it("keeps valid entries and drops only the bad ones", () => {
    const base = validEntry();
    const mixed = [
      validEntry({ name: "ok-1" }),
      validEntry({ params: { ...base.params, numGates: "3" }, name: "bad" }),
      validEntry({ name: "ok-2" }),
    ];
    const loaded = loadSavedScenarios(rawStorageWith(mixed));
    expect(loaded.map((e) => e.name)).toEqual(["ok-1", "ok-2"]);
  });

  it("validateSimParams rejects out-of-range and malformed params", () => {
    const good = JSON.parse(
      JSON.stringify({ ...DEFAULT_PARAMS, disruptions: DEFAULT_DISRUPTIONS })
    );
    expect(validateSimParams(good)).not.toBeNull();
    expect(validateSimParams({ ...good, simHours: -5 })).toBeNull();
    expect(validateSimParams({ ...good, numGates: 1.5 })).toBeNull();
    expect(validateSimParams({ ...good, appointmentShare: 2 })).toBeNull();
    expect(validateSimParams({ ...good, gateCloseHour: 6, gateOpenHour: 8 })).toBeNull();
    expect(validateSimParams({ ...good, disruptions: null })).toBeNull();
    expect(
      validateSimParams({
        ...good,
        disruptions: { ...good.disruptions, weatherSlowdown: { enabled: true } },
      })
    ).toBeNull();
  });

  it("validateScenarioEntry drops future schema versions", () => {
    expect(
      validateScenarioEntry(validEntry({ version: 999 }))
    ).toBeNull();
  });
});
