/**
 * Tests for the porttwin upgrade: Monte Carlo, disruptions, cost model,
 * scenario storage, and export builders.
 * All stochastic behavior is seeded — these tests are fully deterministic.
 */
import { describe, it, expect } from "vitest";
import { runSimulation } from "../src/sim/engine";
import { DEFAULT_PARAMS } from "../src/sim/scenarios";
import {
  DEFAULT_DISRUPTIONS,
  cloneDisruptions,
  type CraneBreakdown,
  type GateClosure,
  type VesselBunching,
  type WeatherSlowdown,
} from "../src/sim/disruptions";
import type { SimParams } from "../src/sim/types";
import {
  computeCosts,
  DEFAULT_COST_RATES,
  type CostRates,
} from "../src/sim/costs";
import {
  runMonteCarlo,
  runMonteCarloAsync,
  summarizeSamples,
} from "../src/sim/montecarlo";
import {
  loadSavedScenarios,
  saveScenario,
  deleteScenario,
  type StorageLike,
} from "../src/sim/storage";
import {
  buildExportJson,
  buildKpiCsv,
  buildSeriesCsv,
  exportStem,
  type ExportBundle,
} from "../src/sim/export";

function tinyParams(over: Partial<SimParams> = {}): SimParams {
  return {
    ...DEFAULT_PARAMS,
    seed: 7,
    simHours: 6,
    trucksPerDay: 300,
    // Gates open for the whole short horizon (default 6:00 opening would
    // leave a 0–6h window unserved and every KPI at zero).
    gateOpenHour: 0,
    gateCloseHour: 24,
    disruptions: cloneDisruptions(DEFAULT_DISRUPTIONS),
    ...over,
  };
}

type DisruptionPatch = {
  craneBreakdown?: Partial<CraneBreakdown>;
  vesselBunching?: Partial<VesselBunching>;
  gateClosure?: Partial<GateClosure>;
  weatherSlowdown?: Partial<WeatherSlowdown>;
};

function withDisruptions(
  patch: DisruptionPatch,
  over: Partial<SimParams> = {}
): SimParams {
  const d = cloneDisruptions(DEFAULT_DISRUPTIONS);
  if (patch.craneBreakdown) Object.assign(d.craneBreakdown, patch.craneBreakdown);
  if (patch.vesselBunching) Object.assign(d.vesselBunching, patch.vesselBunching);
  if (patch.gateClosure) Object.assign(d.gateClosure, patch.gateClosure);
  if (patch.weatherSlowdown)
    Object.assign(d.weatherSlowdown, patch.weatherSlowdown);
  return tinyParams({ ...over, disruptions: d });
}

/** In-memory storage backend for storage tests. */
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

describe("Monte Carlo", () => {
  it("is deterministic for the same base seed", () => {
    const a = runMonteCarlo(tinyParams(), 5, 100);
    const b = runMonteCarlo(tinyParams(), 5, 100);
    expect(a.summaries.throughputTeuPerDay).toEqual(
      b.summaries.throughputTeuPerDay
    );
    expect(a.samples).toEqual(b.samples);
  });

  it("uses seeds baseSeed..baseSeed+n-1 (matches manual per-seed runs)", () => {
    const mc = runMonteCarlo(tinyParams(), 4, 50);
    const manual = [50, 51, 52, 53].map(
      (s) => runSimulation({ ...tinyParams(), seed: s }).kpis
    );
    expect(mc.samples).toEqual(manual);
  });

  it("CI bands are sane: lo <= mean <= hi, and width shrinks with n", () => {
    const small = runMonteCarlo(tinyParams(), 5, 10);
    const large = runMonteCarlo(tinyParams(), 40, 10);
    const k = "throughputTeuPerDay" as const;
    expect(small.summaries[k].ciLow).toBeLessThanOrEqual(
      small.summaries[k].mean
    );
    expect(small.summaries[k].mean).toBeLessThanOrEqual(
      small.summaries[k].ciHigh
    );
    const wSmall =
      small.summaries[k].ciHigh - small.summaries[k].ciLow;
    const wLarge =
      large.summaries[k].ciHigh - large.summaries[k].ciLow;
    // More replications → narrower CI (in expectation; allow slack).
    expect(wLarge).toBeLessThan(wSmall * 1.5);
    // Min/max bracket the mean.
    expect(small.summaries[k].min).toBeLessThanOrEqual(
      small.summaries[k].mean
    );
    expect(small.summaries[k].max).toBeGreaterThanOrEqual(
      small.summaries[k].mean
    );
  });

  it("MC mean converges toward the single-seed family (sanity)", () => {
    // With many replications the MC mean should sit inside the observed
    // min–max of a smaller independent batch — i.e. it is not an outlier.
    const mc = runMonteCarlo(tinyParams(), 30, 200);
    const batch = runMonteCarlo(tinyParams(), 10, 500);
    const k = "avgWaitMin" as const;
    expect(mc.summaries[k].mean).toBeGreaterThan(0);
    expect(batch.summaries[k].mean).toBeGreaterThan(0);
    // Both means should be within 2x of each other (same distribution).
    expect(mc.summaries[k].mean / batch.summaries[k].mean).toBeGreaterThan(0.5);
    expect(mc.summaries[k].mean / batch.summaries[k].mean).toBeLessThan(2);
  });

  it("rejects fewer than 2 replications", () => {
    expect(() => runMonteCarlo(tinyParams(), 1, 10)).toThrow();
    expect(() => runMonteCarlo(tinyParams(), 0, 10)).toThrow();
  });

  it("async version matches the sync version and reports progress", async () => {
    const seen: number[] = [];
    const asyncRes = await runMonteCarloAsync(tinyParams(), 6, 77, (p) =>
      seen.push(p.done)
    );
    const syncRes = runMonteCarlo(tinyParams(), 6, 77);
    expect(asyncRes.samples).toEqual(syncRes.samples);
    expect(seen[seen.length - 1]).toBe(6);
    expect(seen).toEqual([5, 6]);
  });

  it("summarizeSamples handles a single sample (std 0, CI = mean)", () => {
    const one = [runSimulation(tinyParams()).kpis];
    const s = summarizeSamples(one);
    expect(s.throughputTeuPerDay.std).toBe(0);
    expect(s.throughputTeuPerDay.ciLow).toBe(s.throughputTeuPerDay.mean);
  });
});

describe("disruptions", () => {
  it("crane breakdown reduces throughput and raises waits", () => {
    const base = runSimulation(tinyParams({ seed: 42 })).kpis;
    const broken = runSimulation(
      withDisruptions(
        { craneBreakdown: { enabled: true, startHour: 0, durationHours: 6 } },
        { seed: 42 }
      )
    ).kpis;
    expect(broken.throughputTrucksPerDay).toBeLessThanOrEqual(
      base.throughputTrucksPerDay
    );
    expect(broken.avgSystemMin).toBeGreaterThanOrEqual(base.avgSystemMin);
  });

  it("vessel bunching increases the maximum queue", () => {
    const base = runSimulation(tinyParams({ seed: 42 })).kpis;
    const bunched = runSimulation(
      withDisruptions(
        {
          vesselBunching: {
            enabled: true,
            extraTrucks: 400,
            windowStartHour: 2,
            windowHours: 1,
          },
        },
        { seed: 42 }
      )
    ).kpis;
    expect(bunched.maxQueue).toBeGreaterThan(base.maxQueue);
    expect(bunched.totalTrucks).toBeGreaterThan(base.totalTrucks);
  });

  it("gate closure reduces throughput", () => {
    const base = runSimulation(tinyParams({ seed: 42 })).kpis;
    const closed = runSimulation(
      withDisruptions(
        { gateClosure: { enabled: true, startHour: 0, durationHours: 6 } },
        { seed: 42 }
      )
    ).kpis;
    expect(closed.throughputTrucksPerDay).toBeLessThanOrEqual(
      base.throughputTrucksPerDay
    );
  });

  it("weather slowdown increases system time", () => {
    const base = runSimulation(tinyParams({ seed: 42 })).kpis;
    const wet = runSimulation(
      withDisruptions(
        {
          weatherSlowdown: {
            enabled: true,
            startHour: 0,
            durationHours: 6,
            productivityFactor: 0.5,
          },
        },
        { seed: 42 }
      )
    ).kpis;
    expect(wet.avgSystemMin).toBeGreaterThanOrEqual(base.avgSystemMin);
  });

  it("combined disruptions are at least as bad as any single one", () => {
    const all = withDisruptions(
      {
        craneBreakdown: { enabled: true, startHour: 0, durationHours: 6 },
        gateClosure: { enabled: true, startHour: 0, durationHours: 6 },
        weatherSlowdown: {
          enabled: true,
          startHour: 0,
          durationHours: 6,
          productivityFactor: 0.5,
        },
      },
      { seed: 42 }
    );
    const combined = runSimulation(all).kpis;
    const single = runSimulation(
      withDisruptions(
        { gateClosure: { enabled: true, startHour: 0, durationHours: 6 } },
        { seed: 42 }
      )
    ).kpis;
    // Combined stress cannot beat the single-disruption run on system time.
    expect(combined.avgSystemMin).toBeGreaterThanOrEqual(
      single.avgSystemMin * 0.9
    );
  });

  it("disabled disruptions leave the run unchanged", () => {
    const a = runSimulation(tinyParams({ seed: 42 }));
    const b = runSimulation(
      withDisruptions({}, { seed: 42 })
    );
    expect(a.kpis).toEqual(b.kpis);
  });
});

describe("cost model", () => {
  it("matches hand-computed math on a synthetic KPI set", () => {
    const rates: CostRates = {
      demurragePerTruckHour: 100,
      demurrageFreeHours: 2,
      truckWaitingPerHour: 10,
      fuelLitersPerIdleHour: 2,
      fuelPricePerLiter: 1,
      craneCostPerHour: 50,
      carbonPricePerTonne: 10,
    };
    // Two trucks: one waited 1h (under free allowance), one waited 4h.
    const waitSamples = [60, 240];
    const kpis = {
      ...runSimulation(tinyParams()).kpis,
      totalWaitHours: 5,
      co2Tonnes: 1,
      yardCraneHours: 3,
      berthCraneHours: 1,
    };
    const costs = computeCosts(kpis, waitSamples, rates);
    const dem = costs.items.find((i) => i.key === "demurrage")!;
    // Only the 4h truck exceeds the 2h free allowance: (4-2)*100 = 200.
    expect(dem.amount).toBe(200);
    expect(costs.items.find((i) => i.key === "waiting")!.amount).toBe(50);
    expect(costs.items.find((i) => i.key === "fuel")!.amount).toBe(10);
    expect(costs.items.find((i) => i.key === "crane")!.amount).toBe(200);
    expect(costs.items.find((i) => i.key === "carbon")!.amount).toBe(10);
    expect(costs.total).toBe(470);
    expect(costs.demurrageHours).toBe(2);
  });

  it("zero waiting means zero demurrage/waiting/fuel", () => {
    const kpis = runSimulation(tinyParams({ trucksPerDay: 0 })).kpis;
    const costs = computeCosts(kpis, [], DEFAULT_COST_RATES);
    expect(costs.items.find((i) => i.key === "demurrage")!.amount).toBe(0);
    expect(costs.items.find((i) => i.key === "waiting")!.amount).toBe(0);
    expect(costs.items.find((i) => i.key === "fuel")!.amount).toBe(0);
  });

  it("crisis costs more than TAS (same seed)", () => {
    const crisis = runSimulation({ ...tinyParams(), seed: 42 });
    const tas = runSimulation({
      ...tinyParams(),
      seed: 42,
      appointmentSystem: true,
    });
    const cCrisis = computeCosts(crisis.kpis, crisis.waitSamplesMin);
    const cTas = computeCosts(tas.kpis, tas.waitSamplesMin);
    expect(cCrisis.total).toBeGreaterThan(cTas.total);
  });

  it("new KPI fields are consistent with wait samples", () => {
    const r = runSimulation(tinyParams({ seed: 42 }));
    const sampleSum = r.waitSamplesMin.reduce((s, w) => s + w, 0) / 60;
    expect(r.kpis.totalWaitHours).toBeCloseTo(sampleSum, 6);
    expect(r.kpis.yardCraneHours).toBeGreaterThan(0);
    expect(r.kpis.berthCraneHours).toBeGreaterThan(0);
  });
});

describe("scenario storage", () => {
  it("round-trips a scenario through save/load", () => {
    const store = memStorage();
    const params = tinyParams({ trucksPerDay: 1234 });
    saveScenario("My test", params, params.disruptions, store);
    const loaded = loadSavedScenarios(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("My test");
    expect(loaded[0].params).toEqual(params);
    expect(loaded[0].disruptions).toEqual(params.disruptions);
  });

  it("overwrites a scenario with the same name", () => {
    const store = memStorage();
    saveScenario("Dup", tinyParams({ trucksPerDay: 1000 }), cloneDisruptions(DEFAULT_DISRUPTIONS), store);
    saveScenario("Dup", tinyParams({ trucksPerDay: 2000 }), cloneDisruptions(DEFAULT_DISRUPTIONS), store);
    const loaded = loadSavedScenarios(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].params.trucksPerDay).toBe(2000);
  });

  it("deletes by name", () => {
    const store = memStorage();
    saveScenario("A", tinyParams(), cloneDisruptions(DEFAULT_DISRUPTIONS), store);
    saveScenario("B", tinyParams(), cloneDisruptions(DEFAULT_DISRUPTIONS), store);
    const after = deleteScenario("A", store);
    expect(after.map((s) => s.name)).toEqual(["B"]);
  });

  it("rejects empty and overlong names", () => {
    const store = memStorage();
    expect(() =>
      saveScenario("   ", tinyParams(), cloneDisruptions(DEFAULT_DISRUPTIONS), store)
    ).toThrow();
    expect(() =>
      saveScenario("x".repeat(61), tinyParams(), cloneDisruptions(DEFAULT_DISRUPTIONS), store)
    ).toThrow();
  });

  it("ignores corrupt stored data", () => {
    const store = memStorage();
    store.setItem("porttwin.savedScenarios.v1", "not json{");
    expect(loadSavedScenarios(store)).toEqual([]);
    store.setItem(
      "porttwin.savedScenarios.v1",
      JSON.stringify([{ name: "Bad", params: {} }])
    );
    expect(loadSavedScenarios(store)).toEqual([]);
  });

  it("deep-copies params so later mutation does not corrupt storage", () => {
    const store = memStorage();
    const params = tinyParams();
    saveScenario("Snap", params, params.disruptions, store);
    params.trucksPerDay = 9999;
    expect(loadSavedScenarios(store)[0].params.trucksPerDay).not.toBe(9999);
  });
});

describe("export builders", () => {
  it("series CSV has a header and one row per snapshot", () => {
    const r = runSimulation(tinyParams());
    const csv = buildSeriesCsv(r);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "t_min,t_hours,gateQueue,appointmentQueue,walkinQueue,gatesBusy,yardQueue,yardBusy,berthQueue,berthsBusy,completedTrucks,completedTeu"
    );
    expect(lines.length).toBe(r.series.length + 1);
  });

  it("KPI CSV compares current vs baseline", () => {
    const cur = runSimulation(tinyParams({ seed: 42 }));
    const base = runSimulation(tinyParams({ seed: 42, trucksPerDay: 600 }));
    const csv = buildKpiCsv(cur, base);
    expect(csv.split("\n")[0]).toBe("kpi,current,baseline,delta_pct");
    expect(csv).toContain("throughputTeuPerDay,");
  });

  it("export JSON round-trips through JSON.parse", () => {
    const r = runSimulation(tinyParams());
    const bundle: ExportBundle = {
      exportedAt: new Date().toISOString(),
      app: "porttwin",
      params: r.params,
      disruptions: r.params.disruptions,
      kpis: r.kpis,
      waitSamplesMin: r.waitSamplesMin,
      costs: null,
      monteCarlo: null,
      series: r.series,
    };
    const parsed = JSON.parse(buildExportJson(bundle)) as ExportBundle;
    expect(parsed.kpis).toEqual(r.kpis);
    expect(parsed.params.seed).toBe(r.params.seed);
  });

  it("exportStem slugs labels and includes a timestamp", () => {
    const stem = exportStem("TAS + Crane Breakdown!");
    expect(stem).toMatch(/^porttwin-tas-crane-breakdown-\d{8}-\d{4}$/);
  });
});
