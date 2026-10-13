"use client";

import { useEffect, useRef, useState } from "react";
import type { Kpis, MonteCarloResult, SimParams } from "@/sim";
import { runMonteCarloAsync } from "@/sim";

interface MonteCarloPanelProps {
  params: SimParams;
  singleRun: Kpis;
  onResult?: (result: MonteCarloResult | null) => void;
  disabled?: boolean;
}

const DISPLAY_ROWS: Array<{
  key: keyof Kpis;
  label: string;
  unit: string;
  decimals: number;
}> = [
  { key: "throughputTeuPerDay", label: "Throughput", unit: "TEU/day", decimals: 0 },
  { key: "avgWaitMin", label: "Avg truck wait", unit: "min", decimals: 1 },
  { key: "maxQueue", label: "Max queue", unit: "trucks", decimals: 0 },
  { key: "avgSystemMin", label: "Avg system time", unit: "min", decimals: 1 },
  { key: "gateUtilization", label: "Gate utilization", unit: "%", decimals: 1 },
  { key: "co2Tonnes", label: "CO₂", unit: "t/day", decimals: 2 },
];

function fmt(value: number, decimals: number, unit: string): string {
  if (unit === "%") return `${(value * 100).toFixed(decimals)}%`;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Horizontal CI bar: full range (min–max) with the 95% CI band and mean. */
function CiBar({
  summary,
  unit,
}: {
  summary: MonteCarloResult["summaries"][keyof Kpis];
  unit: string;
}) {
  const lo = unit === "%" ? summary.min * 100 : summary.min;
  const hi = unit === "%" ? summary.max * 100 : summary.max;
  const ciLo = unit === "%" ? summary.ciLow * 100 : summary.ciLow;
  const ciHi = unit === "%" ? summary.ciHigh * 100 : summary.ciHigh;
  const mean = unit === "%" ? summary.mean * 100 : summary.mean;
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) {
    return (
      <div className="flex h-4 items-center text-[10px] text-mist">
        No variation across replications
      </div>
    );
  }
  const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / span) * 100))}%`;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-4 rounded-full bg-white/[0.06]">
        {/* full range */}
        <div
          className="absolute top-1/2 h-px -translate-y-1/2 bg-white/25"
          style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }}
        />
        {/* 95% CI band */}
        <div
          className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-signal/70"
          style={{ left: pct(ciLo), width: `calc(${pct(ciHi)} - ${pct(ciLo)})` }}
          title={`95% CI ${ciLo.toFixed(1)} – ${ciHi.toFixed(1)}`}
        />
        {/* mean marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-white"
          style={{ left: pct(mean) }}
          title={`Mean ${mean.toFixed(1)}`}
        />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-mist">
        <span>{lo.toFixed(1)}</span>
        <span className="text-signal">
          95% CI {ciLo.toFixed(1)} – {ciHi.toFixed(1)}
        </span>
        <span>{hi.toFixed(1)}</span>
      </div>
    </div>
  );
}

export default function MonteCarloPanel({
  params,
  singleRun,
  onResult,
  disabled = false,
}: MonteCarloPanelProps) {
  const [replications, setReplications] = useState(30);
  const [baseSeed, setBaseSeed] = useState(params.seed);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  // Keep the base-seed input in sync when the scenario seed changes.
  useEffect(() => {
    setBaseSeed(params.seed);
  }, [params.seed]);

  // A changed scenario invalidates the previous Monte Carlo run.
  useEffect(() => {
    setResult(null);
    onResult?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const run = async () => {
    const id = ++runId.current;
    setRunning(true);
    setError(null);
    setProgress({ done: 0, total: replications });
    setResult(null);
    try {
      const mc = await runMonteCarloAsync(
        params,
        replications,
        baseSeed,
        (p) => {
          if (runId.current === id) setProgress(p);
        }
      );
      if (runId.current === id) {
        setResult(mc);
        onResult?.(mc);
      }
    } catch (err) {
      if (runId.current === id) {
        setError(err instanceof Error ? err.message : "Monte Carlo failed");
      }
    } finally {
      if (runId.current === id) {
        setRunning(false);
        setProgress(null);
      }
    }
  };

  const stale =
    result !== null &&
    (result.baseSeed !== baseSeed || result.replications !== replications);

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Monte Carlo — uncertainty bands
          </h2>
          <p className="mt-0.5 text-[11px] leading-snug text-mist">
            Re-run this scenario with different seeds. Means and 95%
            confidence intervals replace single-draw luck.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-mist">
          Replications
          <input
            type="number"
            className="num-input w-20"
            value={replications}
            min={2}
            max={200}
            step={1}
            disabled={disabled || running}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v))
                setReplications(Math.min(200, Math.max(2, v)));
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-mist">
          Base seed
          <input
            type="number"
            className="num-input w-24"
            value={baseSeed}
            disabled={disabled || running}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v)) setBaseSeed(v);
            }}
          />
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={disabled || running}
          onClick={run}
        >
          {running ? "Running…" : result ? "Re-run Monte Carlo" : "Run Monte Carlo"}
        </button>
      </div>

      {running && progress && (
        <div>
          <div className="flex justify-between text-[11px] text-mist">
            <span>
              Replication {progress.done} / {progress.total}
            </span>
            <span className="tabular-nums">
              {Math.round((progress.done / progress.total) * 100)}%
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-signal transition-all"
              style={{
                width: `${(progress.done / progress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-xs text-coral">
          Monte Carlo failed: {error}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          {stale && (
            <p className="rounded-lg border border-signal/40 bg-signal/10 px-3 py-2 text-xs text-signal">
              Scenario or settings changed since this run — re-run for fresh
              bands.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-mist">
                  <th className="py-2 pr-2 font-medium">KPI</th>
                  <th className="py-2 pr-2 text-right font-medium">This run</th>
                  <th className="py-2 pr-2 text-right font-medium">MC mean</th>
                  <th className="py-2 text-right font-medium">95% CI</th>
                </tr>
              </thead>
              <tbody>
                {DISPLAY_ROWS.map((row) => {
                  const s = result.summaries[row.key];
                  return (
                    <tr key={row.key} className="border-b border-white/5">
                      <td className="py-2 pr-2 font-medium text-white">
                        {row.label}{" "}
                        <span className="text-[11px] font-normal text-mist">
                          ({row.unit})
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-mist">
                        {fmt(singleRun[row.key], row.decimals, row.unit)}
                      </td>
                      <td className="py-2 pr-2 text-right font-semibold tabular-nums text-white">
                        {fmt(s.mean, row.decimals, row.unit)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-signal">
                        {fmt(s.ciLow, row.decimals, row.unit)} –{" "}
                        {fmt(s.ciHigh, row.decimals, row.unit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-4">
            {(
              [
                { key: "throughputTeuPerDay", label: "Throughput (TEU/day)" },
                { key: "maxQueue", label: "Max queue (trucks)" },
                { key: "avgWaitMin", label: "Avg wait (min)" },
              ] as const
            ).map((row) => (
              <div key={row.key}>
                <p className="mb-1.5 text-xs font-medium text-white">
                  {row.label}
                </p>
                <CiBar
                  summary={result.summaries[row.key]}
                  unit={row.key === "throughputTeuPerDay" ? "TEU" : ""}
                />
              </div>
            ))}
          </div>

          <p className="border-t border-white/10 pt-3 text-[11px] leading-snug text-mist">
            {result.replications} replications, seeds {result.baseSeed}–
            {result.baseSeed + result.replications - 1}. CI = mean ± 1.96·σ/√n
            (normal approximation). Wider bands mean the scenario is more
            luck-dependent.
          </p>
        </div>
      )}
    </div>
  );
}
