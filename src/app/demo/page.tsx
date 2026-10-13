"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  Legend,
} from "recharts";
import {
  runSimulation,
  presetParams,
  PRESETS,
  DEFAULT_PARAMS,
  DEFAULT_COST_RATES,
  computeCostsForResult,
  describeDisruptions,
  anyDisruptionActive,
} from "@/sim";
import type {
  CostRates,
  Disruptions,
  MonteCarloResult,
  SimParams,
  SimResult,
} from "@/sim";
import PortMap from "@/components/PortMap";
import ControlPanel from "@/components/ControlPanel";
import DisruptionsPanel from "@/components/DisruptionsPanel";
import CostPanel from "@/components/CostPanel";
import MonteCarloPanel from "@/components/MonteCarloPanel";
import SavedScenariosPanel from "@/components/SavedScenariosPanel";
import ExportBar from "@/components/ExportBar";

const SIGNAL = "var(--color-signal)";
const CORAL = "var(--color-coral)";
const CRANE = "var(--color-crane)";
const GRID_STROKE = "rgba(255,255,255,0.06)";
const AXIS_TICK = { fill: "#8b9bb4", fontSize: 11 };
const BAR_FILLS = [CORAL, SIGNAL, CRANE];

type TooltipEntry = {
  name?: string | number;
  value?: number | string;
  dataKey?: string | number;
  color?: string;
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
};

function QueueTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const hour = typeof label === "number" ? label : Number(label);
  return (
    <div className="ptw-tooltip">
      <p className="text-[11px] font-semibold text-white">
        {Number.isFinite(hour) ? `${hour.toFixed(1)} h` : String(label ?? "")}
      </p>
      <ul className="mt-1.5 space-y-1">
        {payload.map((entry) => (
          <li key={String(entry.dataKey)} className="flex items-center gap-2 text-[11px]">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="text-mist">{entry.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-white">
              {typeof entry.value === "number" ? Math.round(entry.value) : String(entry.value ?? "—")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScenarioTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const value = typeof entry?.value === "number" ? entry.value : Number(entry?.value);
  return (
    <div className="ptw-tooltip">
      <p className="text-[11px] font-semibold text-white">{String(label ?? "")}</p>
      <p className="mt-1 text-[11px] text-mist">
        Throughput{" "}
        <span className="font-semibold tabular-nums text-white">
          {Number.isFinite(value) ? `${Math.round(value).toLocaleString("en-US")} TEU/day` : "—"}
        </span>
      </p>
    </div>
  );
}

function deltaChip(
  value: number,
  base: number,
  goodWhenUp: boolean,
): { text: string; good: boolean } {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) {
    return { text: "—", good: true };
  }
  const pct = ((value - base) / base) * 100;
  const rounded = Math.abs(pct) < 0.5 ? 0 : Math.round(pct);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  const good = goodWhenUp ? rounded >= 0 : rounded <= 0;
  return { text: `${sign}${Math.abs(rounded)}%`, good };
}

function storyOf(preset: (typeof PRESETS)[number]): string[] {
  return Array.isArray(preset.story) ? preset.story : [String(preset.story)];
}

type KpiCard = {
  key: string;
  label: string;
  value: string;
  unit: string;
  delta: string;
  good: boolean;
};

export default function DemoPage() {
  const [params, setParams] = useState<SimParams>(() => presetParams("crisis"));
  const [activePreset, setActivePreset] = useState<string>("crisis");
  const [result, setResult] = useState<SimResult>(() => runSimulation(presetParams("crisis")));
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tourFreePlay, setTourFreePlay] = useState(false);
  const [costRates, setCostRates] = useState<CostRates>(DEFAULT_COST_RATES);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const firstRun = useRef(true);

  const baseline = useMemo(() => runSimulation(presetParams("crisis")), []);
  const baselineCosts = useMemo(
    () => computeCostsForResult(baseline, costRates),
    [baseline, costRates]
  );
  const currentCosts = useMemo(
    () => computeCostsForResult(result, costRates),
    [result, costRates]
  );
  const activeDisruptions = useMemo(
    () => describeDisruptions(params.disruptions),
    [params.disruptions]
  );
  const disruptionsOn = anyDisruptionActive(params.disruptions);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setComputing(true);
    const timer = window.setTimeout(() => {
      try {
        setResult(runSimulation(params));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown simulation error");
      } finally {
        setComputing(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [params]);

  const applyPreset = useCallback((id: string) => {
    setParams((prev) => ({ ...presetParams(id), seed: prev.seed }));
    setActivePreset(id);
  }, []);

  const onChange = useCallback((patch: Partial<SimParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
    setActivePreset("custom");
  }, []);

  const onDisruptionsChange = useCallback((disruptions: Disruptions) => {
    setParams((prev) => ({ ...prev, disruptions }));
    setActivePreset("custom");
  }, []);

  const onLoadSaved = useCallback(
    (loadedParams: SimParams, loadedDisruptions: Disruptions) => {
      setParams({ ...loadedParams, disruptions: loadedDisruptions });
      setActivePreset("custom");
      setError(null);
    },
    []
  );

  const onReset = useCallback(() => {
    const target = activePreset === "custom" ? "crisis" : activePreset;
    setParams(presetParams(target));
    if (activePreset === "custom") setActivePreset("crisis");
  }, [activePreset]);

  const resetToCrisis = useCallback(() => {
    setParams({ ...DEFAULT_PARAMS, ...presetParams("crisis") });
    setActivePreset("crisis");
    setError(null);
  }, []);

  const selectPreset = useCallback(
    (id: string) => {
      applyPreset(id);
      setTourStep((current) => {
        if (current === null) return null;
        const index = PRESETS.findIndex((preset) => preset.id === id);
        return index >= 0 ? index : null;
      });
    },
    [applyPreset],
  );

  const goToStep = useCallback(
    (index: number) => {
      const preset = PRESETS[index];
      if (!preset) return;
      setTourStep(index);
      applyPreset(preset.id);
    },
    [applyPreset],
  );

  const startTour = useCallback(() => {
    setTourFreePlay(false);
    goToStep(0);
  }, [goToStep]);

  const exitTour = useCallback(() => {
    setTourStep(null);
    setTourFreePlay(false);
  }, []);

  const tourActive = tourStep !== null;
  const tourPreset = tourStep !== null ? PRESETS[tourStep] : undefined;

  const queueData = useMemo(() => {
    const baseSeries = baseline.series;
    return result.series.map((point, index) => {
      const basePoint = baseSeries[index];
      return {
        h: Number((point.t / 60).toFixed(2)),
        queue: point.gateQueue,
        baseline: basePoint ? basePoint.gateQueue : undefined,
      };
    });
  }, [result, baseline]);

  const scenarioData = useMemo(
    () =>
      PRESETS.map((preset) => ({
        name: preset.name,
        teu: Math.round(runSimulation(presetParams(preset.id)).kpis.throughputTeuPerDay),
      })),
    [],
  );

  const kpiCards = useMemo<KpiCard[]>(() => {
    const cur = result.kpis;
    const base = baseline.kpis;

    const wait =
      cur.avgWaitMin >= 120
        ? { value: (cur.avgWaitMin / 60).toFixed(1), unit: "h" }
        : { value: String(Math.round(cur.avgWaitMin)), unit: "min" };

    const rows: Array<{
      key: string;
      label: string;
      value: string;
      unit: string;
      raw: number;
      base: number;
      goodWhenUp: boolean;
    }> = [
      {
        key: "throughput",
        label: "Throughput",
        value: Math.round(cur.throughputTeuPerDay).toLocaleString("en-US"),
        unit: "TEU/day",
        raw: cur.throughputTeuPerDay,
        base: base.throughputTeuPerDay,
        goodWhenUp: true,
      },
      {
        key: "wait",
        label: "Avg truck wait",
        value: wait.value,
        unit: wait.unit,
        raw: cur.avgWaitMin,
        base: base.avgWaitMin,
        goodWhenUp: false,
      },
      {
        key: "queue",
        label: "Max queue",
        value: String(Math.round(cur.maxQueue)),
        unit: "trucks",
        raw: cur.maxQueue,
        base: base.maxQueue,
        goodWhenUp: false,
      },
      {
        key: "util",
        label: "Gate utilization",
        value: String(Math.round(cur.gateUtilization * 100)),
        unit: "%",
        raw: cur.gateUtilization,
        base: base.gateUtilization,
        goodWhenUp: true,
      },
      {
        key: "co2",
        label: "CO₂/day",
        value: cur.co2Tonnes.toFixed(1),
        unit: "t",
        raw: cur.co2Tonnes,
        base: base.co2Tonnes,
        goodWhenUp: false,
      },
    ];

    return rows.map((row) => {
      const chip = deltaChip(row.raw, row.base, row.goodWhenUp);
      return {
        key: row.key,
        label: row.label,
        value: row.value,
        unit: row.unit,
        delta: chip.text,
        good: chip.good,
      };
    });
  }, [result, baseline]);

  const showBaseline = activePreset !== "crisis";
  const hasQueueData = queueData.length > 0;
  const hasScenarioData = scenarioData.length > 0;

  return (
    <div className="min-h-screen bg-abyss text-white">
      <div className="grid-bg min-h-screen">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-abyss/85 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href="/"
                className="shrink-0 text-sm text-mist transition hover:text-white"
              >
                ← PortTwin
              </Link>
              <span className="hidden h-4 w-px bg-white/15 sm:block" />
              <h1 className="truncate text-sm font-semibold tracking-tight text-white sm:text-base">
                Digital Twin — Live Simulation
              </h1>
            </div>
            <a
              href="https://github.com/porttwin"
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-mist transition hover:border-white/30 hover:text-white"
            >
              GitHub
            </a>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-6">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => {
              const active = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectPreset(preset.id)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    active
                      ? "border-signal bg-signal/10"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  }`}
                >
                  <span
                    className={`block text-sm font-semibold ${active ? "text-white" : "text-mist"}`}
                  >
                    {preset.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-mist">{preset.tagline}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setActivePreset("custom");
                setTourStep(null);
              }}
              className={`rounded-lg border px-3 py-2 text-left transition ${
                activePreset === "custom"
                  ? "border-signal bg-signal/10"
                  : "border-white/10 bg-white/[0.02] hover:border-white/25"
              }`}
            >
              <span
                className={`block text-sm font-semibold ${
                  activePreset === "custom" ? "text-white" : "text-mist"
                }`}
              >
                Custom
              </span>
              <span className="mt-0.5 block text-[11px] text-mist">
                Sandbox — tune every control
              </span>
            </button>
          </div>

          {error && (
            <div className="panel mt-4 flex flex-col gap-3 border-coral/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-coral">Simulation failed: {error}</p>
              <button type="button" className="btn-primary shrink-0" onClick={resetToCrisis}>
                Reset to crisis defaults
              </button>
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="lg:sticky lg:top-[68px] lg:self-start">
              <ControlPanel
                params={params}
                onChange={onChange}
                onReset={onReset}
                disabled={tourActive && !tourFreePlay}
              />
            </aside>

            <div className="min-w-0 space-y-4">
              {tourActive && tourPreset ? (
                <section className="panel p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-signal/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-signal">
                          Step {tourStep + 1} of {PRESETS.length}
                        </span>
                        <h2 className="text-sm font-semibold text-white">{tourPreset.name}</h2>
                      </div>
                      <p className="mt-1 text-xs text-mist">{tourPreset.tagline}</p>
                    </div>
                    <button
                      type="button"
                      onClick={exitTour}
                      className="shrink-0 rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-mist transition hover:border-white/30 hover:text-white"
                    >
                      Exit tour
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {storyOf(tourPreset).map((paragraph, index) => (
                      <p key={index} className="text-sm leading-relaxed text-mist">
                        {paragraph}
                      </p>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      {PRESETS.map((preset, index) => (
                        <span
                          key={preset.id}
                          className={`h-1.5 rounded-full transition-all ${
                            index === tourStep ? "w-6 bg-signal" : "w-1.5 bg-white/20"
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-mist">
                        <input
                          type="checkbox"
                          checked={tourFreePlay}
                          onChange={(event) => setTourFreePlay(event.target.checked)}
                          className="h-3.5 w-3.5 accent-signal"
                        />
                        Free play
                      </label>
                      <button
                        type="button"
                        disabled={tourStep === 0}
                        onClick={() => goToStep(tourStep - 1)}
                        className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-mist transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        disabled={tourStep >= PRESETS.length - 1}
                        onClick={() => goToStep(tourStep + 1)}
                        className="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-mist">
                    <span className="font-semibold text-white">New here?</span> Take the 3-step
                    guided demo: crisis → TAS → TAS + night gate.
                  </p>
                  <button type="button" className="btn-primary shrink-0" onClick={startTour}>
                    Start guided demo
                  </button>
                </section>
              )}

              <section>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                  {kpiCards.map((card) => (
                    <div key={card.key} className="panel relative overflow-hidden p-4">
                      {computing && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0 animate-pulse bg-white/[0.05]"
                        />
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[11px] uppercase tracking-wider text-mist">
                          {card.label}
                        </span>
                        <span
                          title="Change vs crisis baseline"
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                            card.good ? "bg-signal/15 text-signal" : "bg-coral/15 text-coral"
                          }`}
                        >
                          {card.delta}
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="kpi-num text-2xl font-semibold tabular-nums text-white">
                          {card.value}
                        </span>
                        <span className="text-xs text-mist">{card.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-mist">
                  Deltas compare against the crisis baseline. Seed {params.seed} · deterministic
                  engine.
                  {disruptionsOn && (
                    <>
                      {" "}
                      Active disruptions: {activeDisruptions.join(" · ")}.
                    </>
                  )}
                </p>
              </section>

              <div className="grid gap-4 xl:grid-cols-2">
                <CostPanel
                  current={currentCosts}
                  baseline={baselineCosts}
                  rates={costRates}
                  onRatesChange={setCostRates}
                />
                <DisruptionsPanel
                  disruptions={params.disruptions}
                  onChange={onDisruptionsChange}
                />
              </div>

              <MonteCarloPanel
                params={params}
                singleRun={result.kpis}
                onResult={setMcResult}
              />

              <div className="grid gap-4 xl:grid-cols-2">
                <SavedScenariosPanel
                  params={params}
                  disruptions={params.disruptions}
                  onLoad={onLoadSaved}
                />
                <ExportBar
                  current={result}
                  baseline={baseline}
                  scenarioLabel={
                    activePreset === "custom" ? "custom" : activePreset
                  }
                  rates={costRates}
                  costs={currentCosts}
                  monteCarlo={mcResult}
                />
              </div>

              <section className="panel overflow-hidden">
                <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <h2 className="text-sm font-semibold text-white">Live port schematic</h2>
                  <span className="text-[11px] text-mist">
                    {activePreset === "custom" ? "Custom scenario" : "Preset scenario"}
                  </span>
                </header>
                <div className="p-3">
                  <PortMap series={result.series} />
                </div>
              </section>

              <div className="grid gap-4 xl:grid-cols-2">
                <section className="panel p-4">
                  <header className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-white">Gate queue over 24h</h2>
                    <span className="text-[11px] text-mist">trucks waiting</span>
                  </header>
                  {hasQueueData ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={queueData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="queueFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={SIGNAL} stopOpacity={0.45} />
                            <stop offset="100%" stopColor={SIGNAL} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                        <XAxis
                          dataKey="h"
                          type="number"
                          domain={["dataMin", "dataMax"]}
                          tick={AXIS_TICK}
                          tickFormatter={(value: number) => `${value}h`}
                          axisLine={false}
                          tickLine={false}
                          minTickGap={24}
                        />
                        <YAxis
                          tick={AXIS_TICK}
                          axisLine={false}
                          tickLine={false}
                          width={44}
                          allowDecimals={false}
                        />
                        <Tooltip content={<QueueTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                        <Area
                          type="monotone"
                          dataKey="queue"
                          name="Current scenario"
                          stroke={SIGNAL}
                          strokeWidth={2}
                          fill="url(#queueFill)"
                        />
                        {showBaseline && (
                          <Area
                            type="monotone"
                            dataKey="baseline"
                            name="Crisis baseline"
                            stroke={CORAL}
                            strokeWidth={1.5}
                            strokeDasharray="5 4"
                            fill="none"
                          />
                        )}
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-[260px] items-center justify-center text-sm text-mist">
                      No data
                    </div>
                  )}
                </section>

                <section className="panel p-4">
                  <header className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-white">Throughput by scenario</h2>
                    <span className="text-[11px] text-mist">TEU/day</span>
                  </header>
                  {hasScenarioData ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart
                        data={scenarioData}
                        margin={{ top: 24, right: 8, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={AXIS_TICK}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={AXIS_TICK}
                          axisLine={false}
                          tickLine={false}
                          width={52}
                          allowDecimals={false}
                        />
                        <Tooltip content={<ScenarioTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                        <Bar
                          dataKey="teu"
                          name="Throughput"
                          radius={[4, 4, 0, 0]}
                          label={{ position: "top", fill: "#e2e8f0", fontSize: 11 }}
                        >
                          {scenarioData.map((entry, index) => (
                            <Cell key={entry.name} fill={BAR_FILLS[index % BAR_FILLS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-[260px] items-center justify-center text-sm text-mist">
                      No data
                    </div>
                  )}
                </section>
              </div>

              <section className="panel p-4">
                <p className="text-xs leading-relaxed text-mist">
                  <span className="font-semibold text-white">Methodology.</span> Stylized
                  discrete-event model (seeded, deterministic). Not calibrated to live port data.
                  See README.
                </p>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
