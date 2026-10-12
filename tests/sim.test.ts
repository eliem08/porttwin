/**
 * Tests for the porttwin discrete-event simulation engine.
 * All stochastic behavior is seeded — these tests are fully deterministic.
 */
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/sim/rng";
import { runSimulation, generateTrucks, SNAPSHOT_EVERY_MIN } from "../src/sim/engine";
import { DEFAULT_PARAMS, presetParams } from "../src/sim/scenarios";
import type { SimParams } from "../src/sim/types";

function tinyParams(over: Partial<SimParams> = {}): SimParams {
  return {
    ...DEFAULT_PARAMS,
    seed: 7,
    simHours: 6,
    trucksPerDay: 300,
    ...over,
  };
}

describe("rng", () => {
  it("is deterministic for a fixed seed", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("differs across seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("draws uniform values in [0, 1)", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("arrival generation", () => {
  it("produces trucks sorted by arrival time", () => {
    const trucks = generateTrucks(tinyParams(), mulberry32(7));
    for (let i = 1; i < trucks.length; i++) {
      expect(trucks[i].arrivalTime).toBeGreaterThanOrEqual(
        trucks[i - 1].arrivalTime
      );
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = generateTrucks(tinyParams(), mulberry32(7)).map((t) => t.arrivalTime);
    const b = generateTrucks(tinyParams(), mulberry32(7)).map((t) => t.arrivalTime);
    expect(a).toEqual(b);
  });

  it("generates the expected volume of walk-ins without TAS", () => {
    const trucks = generateTrucks(tinyParams({ simHours: 24 }), mulberry32(7));
    // Thinning is stochastic; allow ±15% around the 300 target.
    expect(trucks.length).toBeGreaterThan(255);
    expect(trucks.length).toBeLessThan(345);
  });

  it("assigns appointments when TAS is on", () => {
    const trucks = generateTrucks(
      tinyParams({ appointmentSystem: true, appointmentShare: 0.8, simHours: 24 }),
      mulberry32(7)
    );
    const appt = trucks.filter((t) => t.hasAppointment).length;
    // 0.8 share minus ~8% no-shows → roughly 0.7–0.8 of arrivals.
    expect(appt / trucks.length).toBeGreaterThan(0.6);
    expect(appt / trucks.length).toBeLessThan(0.85);
  });

  it("handles zero demand without crashing", () => {
    const trucks = generateTrucks(tinyParams({ trucksPerDay: 0 }), mulberry32(7));
    expect(trucks).toEqual([]);
  });
});

describe("runSimulation", () => {
  it("is fully deterministic for a fixed seed", () => {
    const a = runSimulation(tinyParams());
    const b = runSimulation(tinyParams());
    expect(a.kpis).toEqual(b.kpis);
    expect(a.series.map((s) => s.gateQueue)).toEqual(
      b.series.map((s) => s.gateQueue)
    );
  });

  it("emits snapshots on a fixed cadence with non-decreasing time", () => {
    const { series } = runSimulation(tinyParams({ simHours: 6 }));
    expect(series.length).toBeGreaterThan(3);
    for (let i = 1; i < series.length; i++) {
      expect(series[i].t).toBeGreaterThan(series[i - 1].t);
      expect(series[i].t - series[i - 1].t).toBeLessThanOrEqual(
        SNAPSHOT_EVERY_MIN + 1e-9
      );
    }
    expect(series[0].t).toBe(0);
  });

  it("conserves trucks: completed never exceeds arrivals", () => {
    const { kpis, series } = runSimulation(tinyParams({ simHours: 12 }));
    expect(kpis.completedTrucks).toBeLessThanOrEqual(kpis.totalTrucks);
    const last = series[series.length - 1];
    expect(last.completedTrucks).toBe(kpis.completedTrucks);
  });

  it("returns zero KPIs for zero demand", () => {
    const { kpis } = runSimulation(tinyParams({ trucksPerDay: 0 }));
    expect(kpis.completedTrucks).toBe(0);
    expect(kpis.throughputTeuPerDay).toBe(0);
    expect(kpis.avgWaitMin).toBe(0);
    expect(kpis.maxQueue).toBe(0);
  });

  it("crisis preset saturates the gates (throughput ≈ gate capacity)", () => {
    const { kpis } = runSimulation(presetParams("crisis"));
    // 3 gates × 16 h × 60 min / 3.6 min ≈ 800 trucks/day theoretical max.
    expect(kpis.throughputTrucksPerDay).toBeGreaterThan(600);
    expect(kpis.throughputTrucksPerDay).toBeLessThan(950);
    // Demand (2600) far exceeds capacity → extreme waits.
    expect(kpis.avgWaitMin).toBeGreaterThan(120);
    expect(kpis.gateUtilization).toBeGreaterThan(0.95);
  });

  it("TAS cuts the maximum queue by at least 40% vs crisis (same seed)", () => {
    const crisis = runSimulation(presetParams("crisis")).kpis;
    const tas = runSimulation({ ...presetParams("tas"), seed: 42 }).kpis;
    const reduction = 1 - tas.maxQueue / crisis.maxQueue;
    expect(reduction).toBeGreaterThan(0.4);
  });

  it("TAS + night gate recovers throughput toward pre-crisis levels", () => {
    const crisis = runSimulation(presetParams("crisis")).kpis;
    const fixed = runSimulation(presetParams("tas-night")).kpis;
    // Recovery should at least double crisis throughput and approach ~2,800 TEU/day.
    expect(fixed.throughputTeuPerDay).toBeGreaterThan(
      crisis.throughputTeuPerDay * 1.8
    );
    expect(fixed.throughputTeuPerDay).toBeGreaterThan(2000);
  });

  it("more gates do not reduce throughput on average (monotonicity)", () => {
    const base = { ...presetParams("tas"), seed: 42 };
    let t3 = 0;
    let t4 = 0;
    for (let s = 1; s <= 5; s++) {
      t3 += runSimulation({ ...base, seed: s }).kpis.throughputTrucksPerDay;
      t4 += runSimulation({ ...base, seed: s, numGates: 4 }).kpis.throughputTrucksPerDay;
    }
    // Averaged over seeds, extra gate capacity cannot hurt throughput.
    expect(t4 / 5).toBeGreaterThanOrEqual((t3 / 5) * 0.98);
  });

  it("CO2 scales with waiting: crisis emits more than TAS", () => {
    const crisis = runSimulation(presetParams("crisis")).kpis;
    const tas = runSimulation({ ...presetParams("tas"), seed: 42 }).kpis;
    expect(crisis.co2Tonnes).toBeGreaterThan(tas.co2Tonnes);
  });
});
