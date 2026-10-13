"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  batchMeans,
  calibrate,
  erlangGateCheck,
  interactionHeatmap,
  ofatSensitivity,
  pairedComparison,
  presetParams,
  PRESETS,
  runFactorial,
  verifyRun,
  welchForParams,
  DOE_FACTORS,
  SWEEP_PARAMS,
  IDENTIFICATION_WARNING,
} from "@/sim";
import type {
  BatchMeansResult,
  CalibrationResult,
  DoeResult,
  OfatResult,
  HeatmapResult,
  PairedComparisonResult,
  SimParams,
  SimResult,
  WelchResult,
} from "@/sim";

type Tab = "output" | "sensitivity" | "vv" | "calibration" | "erlang" | "doe";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "output", label: "Output analysis" },
  { id: "sensitivity", label: "Sensitivity" },
  { id: "vv", label: "Verification & validation" },
  { id: "calibration", label: "Calibration" },
  { id: "erlang", label: "Erlang-C cross-check" },
  { id: "doe", label: "Experiments (DOE)" },
];

const GRID_STROKE = "rgba(255,255,255,0.06)";
const AXIS_TICK = { fill: "#8b9bb4", fontSize: 11 };

function fmt(v: number, decimals = 1): string {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function MethodNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-mist">
      {children}
    </p>
  );
}

interface ResearchPanelProps {
  params: SimParams;
  result: SimResult;
  onApplyParams?: (params: SimParams) => void;
}

export default function ResearchPanel({ params, result, onApplyParams }: ResearchPanelProps) {
  const [tab, setTab] = useState<Tab>("output");

  return (
    <section className="panel p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-white">
          Research tools — simulation science
        </h2>
        <p className="mt-0.5 text-[11px] leading-snug text-mist">
          Textbook output analysis, sensitivity, verification, calibration,
          queueing-theory cross-checks, and designed experiments. Methods
          from Law &amp; Kelton, Banks et al., Gross &amp; Harris, and
          Montgomery — assumptions stated, not hidden.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              tab === t.id
                ? "border-signal bg-signal/10 text-white"
                : "border-white/10 bg-white/[0.02] text-mist hover:border-white/25 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "output" && <OutputAnalysisTab params={params} result={result} />}
      {tab === "sensitivity" && <SensitivityTab params={params} />}
      {tab === "vv" && <VVTab result={result} />}
      {tab === "calibration" && (
        <CalibrationTab params={params} onApplyParams={onApplyParams} />
      )}
      {tab === "erlang" && <ErlangTab params={params} result={result} />}
      {tab === "doe" && <DoeTab params={params} />}
    </section>
  );
}

/* ================================================================== */
/* Output analysis: Welch + batch means + CRN                          */
/* ================================================================== */

function OutputAnalysisTab({ params, result }: { params: SimParams; result: SimResult }) {
  const [welchReps, setWelchReps] = useState(10);
  const [welch, setWelch] = useState<WelchResult | null>(null);
  const [welchRunning, setWelchRunning] = useState(false);
  const [batchCount, setBatchCount] = useState(10);
  const [batch, setBatch] = useState<BatchMeansResult | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [comparePreset, setComparePreset] = useState("tas-night");
  const [compareKpi, setCompareKpi] = useState<"avgWaitMin" | "throughputTeuPerDay" | "maxQueue">("avgWaitMin");
  const [crnReps, setCrnReps] = useState(20);
  const [crn, setCrn] = useState<PairedComparisonResult | null>(null);
  const [crnRunning, setCrnRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const welchData = useMemo(() => {
    if (!welch) return [];
    return welch.times.map((t, i) => ({
      h: Number((t / 60).toFixed(2)),
      ensemble: welch.ensembleMean[i],
      movingAvg: welch.movingAverage[i],
    }));
  }, [welch]);

  const runWelch = () => {
    setWelchRunning(true);
    setError(null);
    window.setTimeout(() => {
      try {
        setWelch(welchForParams(params, welchReps, params.seed, 5));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Welch failed");
      } finally {
        setWelchRunning(false);
      }
    }, 30);
  };

  const runBatch = () => {
    setBatchError(null);
    try {
      setBatch(batchMeans(result, batchCount));
    } catch (e) {
      setBatch(null);
      setBatchError(e instanceof Error ? e.message : "Batch means failed");
    }
  };

  const runCrn = () => {
    setCrnRunning(true);
    setError(null);
    window.setTimeout(() => {
      try {
        const other = presetParams(comparePreset);
        const pick = (r: SimResult) => r.kpis[compareKpi];
        setCrn(pairedComparison(params, other, crnReps, params.seed, pick));
      } catch (e) {
        setError(e instanceof Error ? e.message : "CRN comparison failed");
      } finally {
        setCrnRunning(false);
      }
    }, 30);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Welch */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white">
          Welch&apos;s moving-average procedure — warm-up diagnostic
        </h3>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-mist">
            Replications
            <input type="number" className="num-input w-20" value={welchReps} min={3} max={50}
              onChange={(e) => setWelchReps(Math.min(50, Math.max(3, Number(e.target.value) || 3)))} />
          </label>
          <button type="button" className="btn-primary" disabled={welchRunning} onClick={runWelch}>
            {welchRunning ? "Running…" : "Run Welch"}
          </button>
        </div>
        {welch && (
          <div className="mt-3">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={welchData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="h" type="number" domain={["dataMin", "dataMax"]} tick={AXIS_TICK}
                  tickFormatter={(v: number) => `${v}h`} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0a1424", border: "1px solid rgba(255,255,255,0.15)", fontSize: 11 }} />
                <Line type="monotone" dataKey="ensemble" name="Ensemble mean queue" stroke="#fb7185" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="movingAvg" name="Moving avg (w=5)" stroke="#fbbf24" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-1 text-[11px] text-mist">
              {welch.warmupMin !== null
                ? `Transient settles around ${(welch.warmupMin / 60).toFixed(1)} h (moving average within ±10% of the plateau).`
                : "Transient never settles within ±10% of the plateau — the day is dominated by its ramp-up."}{" "}
              This is a <strong className="text-white">terminating</strong> simulation (one 24 h day, starts empty):
              the ramp-up is real behaviour and is <strong className="text-white">not deleted</strong>.
              Warm-up deletion applies to steady-state studies. Law &amp; Kelton, Ch. 9.
            </p>
          </div>
        )}
      </div>

      {/* Batch means */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white">
          Batch means — CI from a single run
        </h3>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-mist">
            Batches
            <input type="number" className="num-input w-20" value={batchCount} min={4} max={24}
              onChange={(e) => setBatchCount(Math.min(24, Math.max(4, Number(e.target.value) || 10)))} />
          </label>
          <button type="button" className="btn-primary" onClick={runBatch}>Compute</button>
        </div>
        {batchError && <p className="mt-2 text-xs text-coral">{batchError}</p>}
        {batch && (
          <p className="mt-2 text-xs leading-relaxed text-mist">
            Mean gate queue <strong className="text-white">{fmt(batch.grandMean, 1)} trucks</strong>,{" "}
            batch-means 95% CI [{fmt(batch.ci.ciLow, 1)}, {fmt(batch.ci.ciHigh, 1)}] from{" "}
            {batch.batches} batches of {batch.batchSize} snapshots (t-critical {batch.ci.tCritical.toFixed(3)}).
          </p>
        )}
        <MethodNote>
          Batch means assumes approximate stationarity within the run. This day is strongly
          non-stationary (morning peak), so treat the batch-means CI as indicative — the
          replication CI in the Monte Carlo panel remains the primary inference.
        </MethodNote>
      </div>

      {/* CRN */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white">
          Common random numbers — paired scenario comparison
        </h3>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-mist">
            Compare current scenario vs
            <select className="num-input" value={comparePreset} onChange={(e) => setComparePreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-mist">
            KPI
            <select className="num-input" value={compareKpi} onChange={(e) => setCompareKpi(e.target.value as typeof compareKpi)}>
              <option value="avgWaitMin">Avg wait (min)</option>
              <option value="throughputTeuPerDay">Throughput (TEU/day)</option>
              <option value="maxQueue">Max queue (trucks)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-mist">
            Replications
            <input type="number" className="num-input w-20" value={crnReps} min={2} max={100}
              onChange={(e) => setCrnReps(Math.min(100, Math.max(2, Number(e.target.value) || 20)))} />
          </label>
          <button type="button" className="btn-primary" disabled={crnRunning} onClick={runCrn}>
            {crnRunning ? "Running…" : "Run paired comparison"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-coral">{error}</p>}
        {crn && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-mist">
                  <th className="py-2 pr-2 font-medium">Method</th>
                  <th className="py-2 pr-2 text-right font-medium">Mean difference</th>
                  <th className="py-2 text-right font-medium">95% CI</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/5">
                  <td className="py-2 pr-2 font-medium text-white">Paired (CRN)</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-white">{fmt(crn.pairedCI.mean, 1)}</td>
                  <td className="py-2 text-right tabular-nums text-signal">
                    {fmt(crn.pairedCI.ciLow, 1)} – {fmt(crn.pairedCI.ciHigh, 1)}
                  </td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-2 pr-2 font-medium text-white">Independent streams</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-white">{fmt(crn.independentCI.mean, 1)}</td>
                  <td className="py-2 text-right tabular-nums text-mist">
                    {fmt(crn.independentCI.ciLow, 1)} – {fmt(crn.independentCI.ciHigh, 1)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-relaxed text-mist">
              Paired output correlation r = {crn.correlation.toFixed(2)}.{" "}
              {crn.pairedNarrower
                ? `CRN narrowed the CI by ${fmt((1 - crn.pairedCI.halfWidth / crn.independentCI.halfWidth) * 100, 0)}% — same seeds, shared randomness.`
                : "CRN did not narrow the CI here — the scenarios consume the random stream too differently (e.g. TAS on/off reshuffles arrivals)."}
            </p>
          </div>
        )}
        <MethodNote>
          Both scenarios run with the SAME seed stream (seed + i). Shared randomness induces
          positive correlation, shrinking the variance of the difference. The independent CI
          (Welch–Satterthwaite) is shown so the gain is visible, not assumed.
        </MethodNote>
      </div>
    </div>
  );
}

/* ================================================================== */
/* V&V                                                                  */
/* ================================================================== */

function VVTab({ result }: { result: SimResult }) {
  const report = useMemo(() => verifyRun(result), [result]);
  return (
    <div className="flex flex-col gap-3">
      <p className={`rounded-lg border px-3 py-2 text-xs font-medium ${report.allPassed ? "border-signal/40 bg-signal/10 text-signal" : "border-coral/40 bg-coral/10 text-coral"}`}>
        {report.allPassed
          ? "✓ All verification checks pass — the engine's bookkeeping is internally consistent."
          : "✗ At least one verification check failed — the engine has a bookkeeping problem."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-mist">
              <th className="py-2 pr-2 font-medium">Check</th>
              <th className="py-2 pr-2 text-right font-medium">Left</th>
              <th className="py-2 pr-2 text-right font-medium">Right</th>
              <th className="py-2 pr-2 text-right font-medium">Rel. error</th>
              <th className="py-2 text-right font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {report.checks.map((c) => (
              <tr key={c.id} className="border-b border-white/5 align-top">
                <td className="py-2 pr-2">
                  <span className="font-medium text-white">{c.name}</span>
                  <span className="block text-[11px] text-mist">{c.identity}</span>
                </td>
                <td className="py-2 pr-2 text-right tabular-nums text-mist">{fmt(c.lhs, 1)}</td>
                <td className="py-2 pr-2 text-right tabular-nums text-mist">{fmt(c.rhs, 1)}</td>
                <td className="py-2 pr-2 text-right tabular-nums text-mist">
                  {Number.isFinite(c.relativeError) ? `${(c.relativeError * 100).toFixed(1)}%` : "—"}
                  <span className="block text-[10px]">tol {(c.tolerance * 100).toFixed(0)}%</span>
                </td>
                <td className={`py-2 text-right font-semibold ${c.passed ? "text-signal" : "text-coral"}`}>
                  {c.passed ? "PASS" : "FAIL"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2">
        {report.checks.map((c) => (
          <p key={c.id} className="text-[11px] leading-relaxed text-mist">
            <strong className="text-white">{c.name}:</strong> {c.note}
          </p>
        ))}
      </div>
      <MethodNote>
        Verification (is the code right?) is not validation (is the model the right model?).
        These checks prove internal consistency only. Validation against the real port needs
        observed data — that is what the Calibration tab is for.
      </MethodNote>
    </div>
  );
}

/* ================================================================== */
/* Erlang-C                                                             */
/* ================================================================== */

function ErlangTab({ params, result }: { params: SimParams; result: SimResult }) {
  const check = useMemo(() => erlangGateCheck(params), [params]);
  const simWait = result.kpis.avgWaitMin;
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-xs">
          <tbody>
            <tr className="border-b border-white/5">
              <td className="py-2 pr-2 text-mist">Arrival rate λ (open hours)</td>
              <td className="py-2 text-right font-semibold tabular-nums text-white">{fmt(check.arrivalRatePerMin, 3)} trucks/min</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 pr-2 text-mist">Service rate μ per gate</td>
              <td className="py-2 text-right font-semibold tabular-nums text-white">{fmt(check.serviceRatePerMin, 3)} /min</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 pr-2 text-mist">Servers c (gates)</td>
              <td className="py-2 text-right font-semibold tabular-nums text-white">{params.numGates}</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 pr-2 text-mist">Utilization ρ = λ / (c·μ)</td>
              <td className={`py-2 text-right font-semibold tabular-nums ${check.stable ? "text-white" : "text-coral"}`}>
                {fmt(check.rho, 3)} {check.stable ? "(stable)" : "(ρ ≥ 1 — no steady state)"}
              </td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 pr-2 text-mist">P(arrival waits) — Erlang-C</td>
              <td className="py-2 text-right font-semibold tabular-nums text-white">
                {check.probWait !== null ? `${(check.probWait * 100).toFixed(1)}%` : "—"}
              </td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 pr-2 text-mist">Mean wait — analytical M/M/c</td>
              <td className="py-2 text-right font-semibold tabular-nums text-white">
                {check.meanWait !== null ? `${fmt(check.meanWait, 1)} min` : "— (unstable)"}
              </td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 pr-2 text-mist">Mean wait — simulation</td>
              <td className="py-2 text-right font-semibold tabular-nums text-signal">{fmt(simWait, 1)} min</td>
            </tr>
          </tbody>
        </table>
      </div>
      <MethodNote>
        The M/M/c model assumes Poisson arrivals, exponential service, steady state, and no
        blocking. The simulation has a morning peak, lognormal service, a finite horizon, and
        downstream queues — so divergence is EXPECTED, not a failure. In an overloaded regime
        (ρ ≥ 1) the analytical model has no steady state at all, while the simulation still
        reports the (growing) queue. Agreement within a factor of ~2 in a stable regime says
        the engine&apos;s queueing physics is plausible. Gross &amp; Harris et al., Ch. 2.
      </MethodNote>
    </div>
  );
}

/* ================================================================== */
/* Sensitivity: OFAT tornado + interaction heatmap                     */
/* ================================================================== */

function SensitivityTab({ params }: { params: SimParams }) {
  const [kpi, setKpi] = useState<"throughputTeuPerDay" | "avgWaitMin" | "maxQueue" | "co2Tonnes">("avgWaitMin");
  const [reps, setReps] = useState(8);
  const [ofat, setOfat] = useState<OfatResult | null>(null);
  const [heat, setHeat] = useState<HeatmapResult | null>(null);
  const [running, setRunning] = useState<"ofat" | "heat" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runOfat = () => {
    setRunning("ofat");
    setError(null);
    setHeat(null);
    window.setTimeout(() => {
      try {
        setOfat(ofatSensitivity(params, kpi, reps, 0.2, params.seed));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sensitivity failed");
      } finally {
        setRunning(null);
      }
    }, 30);
  };

  const runHeat = () => {
    if (!ofat || ofat.rows.length < 2) return;
    setRunning("heat");
    setError(null);
    window.setTimeout(() => {
      try {
        const [rA, rB] = ofat.rows.slice(0, 2);
        const pA = SWEEP_PARAMS.find((p) => p.key === rA.key)!;
        const pB = SWEEP_PARAMS.find((p) => p.key === rB.key)!;
        setHeat(interactionHeatmap(params, pA, pB, kpi, 5, [-0.2, -0.1, 0, 0.1, 0.2], params.seed));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Heatmap failed");
      } finally {
        setRunning(null);
      }
    }, 30);
  };

  const tornadoData = useMemo(() => {
    if (!ofat) return [];
    return ofat.rows.map((r) => ({
      label: r.label,
      effect: r.effect,
      fill: r.effect >= 0 ? "#fb7185" : "#fbbf24",
    }));
  }, [ofat]);

  const heatMin = useMemo(() => {
    if (!heat) return 0;
    return Math.min(...heat.grid.flat());
  }, [heat]);
  const heatMax = useMemo(() => {
    if (!heat) return 1;
    return Math.max(...heat.grid.flat());
  }, [heat]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-mist">
          KPI
          <select className="num-input" value={kpi} onChange={(e) => setKpi(e.target.value as typeof kpi)}>
            <option value="avgWaitMin">Avg wait (min)</option>
            <option value="throughputTeuPerDay">Throughput (TEU/day)</option>
            <option value="maxQueue">Max queue (trucks)</option>
            <option value="co2Tonnes">CO₂ (t/day)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-mist">
          Replications per setting
          <input type="number" className="num-input w-20" value={reps} min={2} max={30}
            onChange={(e) => setReps(Math.min(30, Math.max(2, Number(e.target.value) || 8)))} />
        </label>
        <button type="button" className="btn-primary" disabled={running !== null} onClick={runOfat}>
          {running === "ofat" ? "Running…" : "Run OFAT sweep"}
        </button>
      </div>
      {error && <p className="text-xs text-coral">{error}</p>}

      {ofat && (
        <>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white">
              Tornado — effect of ±20% on {kpi === "avgWaitMin" ? "avg wait" : kpi}
            </h3>
            <ResponsiveContainer width="100%" height={Math.max(200, ofat.rows.length * 26)}>
              <BarChart data={tornadoData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} width={130} />
                <Tooltip contentStyle={{ background: "#0a1424", border: "1px solid rgba(255,255,255,0.15)", fontSize: 11 }} />
                <Bar dataKey="effect" name="Effect (high − low)">
                  {tornadoData.map((d) => (
                    <Cell key={d.label} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-1 text-[11px] text-mist">
              Base {kpi === "avgWaitMin" ? "avg wait" : kpi}: {fmt(ofat.baseMean, 1)} · {ofat.replications}{" "}
              replications per setting, CRN seeds. Amber = raising the parameter lowers the KPI;
              coral = raising it raises the KPI.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white">
              Interaction heatmap — two most sensitive parameters
            </h3>
            <p className="mb-2 text-[11px] text-mist">
              {ofat.rows[0]?.label} × {ofat.rows[1]?.label}, each at −20%, −10%, 0, +10%, +20%.
            </p>
            <button type="button" className="btn-primary" disabled={running !== null} onClick={runHeat}>
              {running === "heat" ? "Running…" : "Run 5×5 grid"}
            </button>
            {heat && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-center text-xs">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-left text-[11px] font-medium text-mist">
                        {heat.paramA.label} ↓ / {heat.paramB.label} →
                      </th>
                      {heat.levels.map((l) => (
                        <th key={l} className="px-2 py-1 text-[11px] font-medium text-mist">
                          {l > 0 ? "+" : ""}{Math.round(l * 100)}%
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heat.grid.map((row, i) => (
                      <tr key={heat.levels[i]}>
                        <td className="px-2 py-1 text-left text-[11px] font-medium text-mist">
                          {heat.levels[i] > 0 ? "+" : ""}{Math.round(heat.levels[i] * 100)}%
                        </td>
                        {row.map((v, j) => {
                          const t = heatMax > heatMin ? (v - heatMin) / (heatMax - heatMin) : 0;
                          return (
                            <td
                              key={j}
                              className="px-2 py-1.5 tabular-nums text-white"
                              style={{ background: `rgba(251, 191, 36, ${0.08 + t * 0.55})` }}
                              title={`${fmt(v, 1)}`}
                            >
                              {fmt(v, 0)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[11px] text-mist">
                  If the effect of one parameter changes across the other&apos;s levels, the grid
                  shows non-parallel structure — that is an interaction OFAT cannot see.
                </p>
              </div>
            )}
          </div>
        </>
      )}
      <MethodNote>
        OFAT perturbs one parameter at a time (±20%). It cannot detect interactions — a
        parameter that only matters in combination looks flat here. The heatmap and the DOE
        tab cover that gap.
      </MethodNote>
    </div>
  );
}

/* ================================================================== */
/* Calibration                                                         */
/* ================================================================== */

function CalibrationTab({ params, onApplyParams }: { params: SimParams; onApplyParams?: (p: SimParams) => void }) {
  const [obsWait, setObsWait] = useState("");
  const [obsThroughput, setObsThroughput] = useState("900");
  const [obsQueue, setObsQueue] = useState("");
  const [candidates, setCandidates] = useState(40);
  const [cal, setCal] = useState<CalibrationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCal = () => {
    setRunning(true);
    setError(null);
    window.setTimeout(() => {
      try {
        const observed: { avgWaitMin?: number; throughputTeuPerDay?: number; maxQueue?: number } = {};
        const w = Number(obsWait);
        const t = Number(obsThroughput);
        const q = Number(obsQueue);
        if (obsWait.trim() !== "" && Number.isFinite(w) && w > 0) observed.avgWaitMin = w;
        if (obsThroughput.trim() !== "" && Number.isFinite(t) && t > 0) observed.throughputTeuPerDay = t;
        if (obsQueue.trim() !== "" && Number.isFinite(q) && q > 0) observed.maxQueue = q;
        if (Object.keys(observed).length === 0) {
          throw new Error("Enter at least one observed KPI.");
        }
        setCal(calibrate(params, observed, { candidates, searchReplications: 4, refineReplications: 20 }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Calibration failed");
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-mist">
        Paste observed KPIs from the real port and the tool searches parameters to fit them.
        Throughput is pre-filled with 900 TEU/day — the midpoint of the 800–1,000 range
        reported in the press for the October 2026 crisis. Replace it with your own data.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-mist">
          Observed avg wait (min)
          <input type="number" className="num-input w-28" value={obsWait} placeholder="e.g. 360"
            onChange={(e) => setObsWait(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-mist">
          Observed throughput (TEU/day)
          <input type="number" className="num-input w-32" value={obsThroughput}
            onChange={(e) => setObsThroughput(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-mist">
          Observed max queue (trucks)
          <input type="number" className="num-input w-28" value={obsQueue} placeholder="e.g. 250"
            onChange={(e) => setObsQueue(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-mist">
          Candidates
          <input type="number" className="num-input w-20" value={candidates} min={5} max={200}
            onChange={(e) => setCandidates(Math.min(200, Math.max(5, Number(e.target.value) || 40)))} />
        </label>
        <button type="button" className="btn-primary" disabled={running} onClick={runCal}>
          {running ? "Searching…" : "Fit to data"}
        </button>
      </div>
      {error && <p className="text-xs text-coral">{error}</p>}

      {cal && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-mist">
            Loss: <strong className="text-white">{cal.startLoss.toFixed(4)}</strong> (starting
            scenario) → <strong className="text-signal">{cal.bestLoss.toFixed(4)}</strong>{" "}
            (best fit), {cal.candidatesEvaluated} candidates searched over{" "}
            {cal.searchedParams.join(", ")}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-mist">
                  <th className="py-2 pr-2 font-medium">KPI</th>
                  <th className="py-2 pr-2 text-right font-medium">Observed</th>
                  <th className="py-2 pr-2 text-right font-medium">Fitted</th>
                  <th className="py-2 text-right font-medium">Rel. error</th>
                </tr>
              </thead>
              <tbody>
                {cal.best.fit.map((f) => (
                  <tr key={f.key} className="border-b border-white/5">
                    <td className="py-2 pr-2 font-medium text-white">
                      {cal.targets.find((t) => t.key === f.key)?.label}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-mist">{fmt(f.observed, 1)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-white">{fmt(f.simulated, 1)}</td>
                    <td className={`py-2 text-right tabular-nums ${Math.abs(f.relativeError) < 0.1 ? "text-signal" : "text-coral"}`}>
                      {(f.relativeError * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-mist">
                  <th className="py-2 pr-2 font-medium">Best-fit parameter</th>
                  <th className="py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {cal.searchedParams.map((key) => (
                  <tr key={key} className="border-b border-white/5">
                    <td className="py-2 pr-2 font-medium text-white">
                      {key === "trucksPerDay" ? "Truck demand" : key === "gateServiceMeanMin" ? "Gate service time" : "Morning peak"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-white">
                      {fmt(cal.best.params[key] as number, key === "trucksPerDay" ? 0 : 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {onApplyParams && (
            <button
              type="button"
              className="btn-primary w-fit"
              onClick={() => onApplyParams(cal.best.params)}
            >
              Apply best-fit parameters to the scenario
            </button>
          )}
          <p className="rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-[11px] leading-relaxed text-coral">
            ⚠ {IDENTIFICATION_WARNING}
          </p>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* DOE                                                                 */
/* ================================================================== */

function DoeTab({ params }: { params: SimParams }) {
  const [selected, setSelected] = useState<string[]>(["numGates", "gateServiceMeanMin"]);
  const [kpi, setKpi] = useState<"throughputTeuPerDay" | "avgWaitMin" | "maxQueue">("avgWaitMin");
  const [reps, setReps] = useState(5);
  const [doe, setDoe] = useState<DoeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: string) => {
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= 3) return prev;
      return [...prev, key];
    });
  };

  const runDoe = () => {
    setRunning(true);
    setError(null);
    window.setTimeout(() => {
      try {
        const factors = DOE_FACTORS.filter((f) => selected.includes(String(f.key)));
        setDoe(runFactorial(params, factors, kpi, reps, 0.2, params.seed));
      } catch (e) {
        setError(e instanceof Error ? e.message : "DOE failed");
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  const interactionData = useMemo(() => {
    if (!doe?.interactionPlot) return [];
    return [
      { level: "A low", ...Object.fromEntries(doe.interactionPlot.map((s, i) => [`s${i}`, s.low])) },
      { level: "A high", ...Object.fromEntries(doe.interactionPlot.map((s, i) => [`s${i}`, s.high])) },
    ];
  }, [doe]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-mist">
        Full 2<sup>k</sup> factorial: pick 2–3 factors, each at low (−20%) and high (+20%) —
        boolean factors use off/on. Every combination runs {reps} replications. Unlike OFAT,
        this estimates <strong className="text-white">interactions</strong>. Montgomery, Ch. 5.
      </p>
      <div className="flex flex-wrap gap-2">
        {DOE_FACTORS.map((f) => {
          const active = selected.includes(String(f.key));
          return (
            <button
              key={String(f.key)}
              type="button"
              onClick={() => toggle(String(f.key))}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${active ? "border-signal bg-signal/10 text-white" : "border-white/10 bg-white/[0.02] text-mist hover:border-white/25 hover:text-white"}`}
            >
              {f.label} {active ? `(${DOE_FACTORS.findIndex((x) => x.key === f.key) >= 0 ? "ABCD"[selected.indexOf(String(f.key))] : ""})` : ""}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-mist">
          Response KPI
          <select className="num-input" value={kpi} onChange={(e) => setKpi(e.target.value as typeof kpi)}>
            <option value="avgWaitMin">Avg wait (min)</option>
            <option value="throughputTeuPerDay">Throughput (TEU/day)</option>
            <option value="maxQueue">Max queue (trucks)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-mist">
          Replications per cell
          <input type="number" className="num-input w-20" value={reps} min={2} max={30}
            onChange={(e) => setReps(Math.min(30, Math.max(2, Number(e.target.value) || 5)))} />
        </label>
        <button type="button" className="btn-primary" disabled={running || selected.length < 2} onClick={runDoe}>
          {running ? "Running…" : `Run 2^${selected.length} factorial`}
        </button>
      </div>
      {error && <p className="text-xs text-coral">{error}</p>}

      {doe && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-mist">
                  <th className="py-2 pr-2 font-medium">Effect</th>
                  <th className="py-2 pr-2 text-right font-medium">Estimate</th>
                  <th className="py-2 text-right font-medium">% of grand mean</th>
                </tr>
              </thead>
              <tbody>
                {doe.effects.map((e) => (
                  <tr key={e.label} className="border-b border-white/5">
                    <td className="py-2 pr-2">
                      <span className="font-semibold text-white">{e.label}</span>{" "}
                      <span className="text-mist">{e.name}</span>
                    </td>
                    <td className={`py-2 pr-2 text-right tabular-nums ${e.effect >= 0 ? "text-coral" : "text-signal"}`}>
                      {e.effect >= 0 ? "+" : ""}{fmt(e.effect, 1)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-mist">
                      {e.relativeEffect >= 0 ? "+" : ""}{(e.relativeEffect * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-mist">
            Grand mean: {fmt(doe.grandMean, 1)} · {doe.cells.length} cells × {doe.replications} replications.
          </p>

          {doe.interactionPlot && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white">
                Interaction plot — {doe.factors[0].label} × {doe.factors[1].label}
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={interactionData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="level" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
                  <Tooltip contentStyle={{ background: "#0a1424", border: "1px solid rgba(255,255,255,0.15)", fontSize: 11 }} />
                  {doe.interactionPlot.map((s, i) => (
                    <Line key={s.series} type="monotone" dataKey={`s${i}`} name={s.series}
                      stroke={i === 0 ? "#fbbf24" : "#2dd4bf"} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-1 text-[11px] text-mist">
                Non-parallel lines = interaction: the effect of {doe.factors[0].label} depends on
                the level of {doe.factors[1].label}.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
