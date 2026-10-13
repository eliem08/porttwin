# ◈ PortTwin — Digital Twin of the Port of Casablanca

**Test the fix before you pour the concrete.** An interactive, expert-grade digital twin of the Port of Casablanca's landside operations: a discrete-event simulation of truck arrivals → gates → yard → berths, with scenario controls, KPI dashboards, and a live animated port schematic.

> **Live demo:** [porttwin.vercel.app](https://porttwin.vercel.app) *(production deployment — the sales pitch)*

---

## The problem

The Port of Casablanca handles **~65% of Morocco's foreign trade**. In October 2026 it entered its worst landside congestion crisis on record:

| Metric | Before | Crisis |
|---|---|---|
| Throughput | ~2,800 containers/day | **~800 containers/day (−70%)** |
| Truck waiting time | normal | **up to 12 hours** |
| Gate lanes | 3 | 3 — no appointment system |

Five interlocking causes: diverted Tanger Med traffic, record grain imports, importers squatting on containers in-port, slow customs at only 3 gates, and total truck chaos with **no appointment system**.

Ports like **Rotterdam and Singapore** don't debate fixes like this in committee — they test them in a digital twin first. PortTwin brings that capability to Casablanca.

## What this is

A **discrete-event simulation** of the port's landside chain, wrapped in a polished web app:

- **Simulation engine** (`src/sim/`) — decoupled, importable TypeScript; zero UI dependencies. Seeded and fully deterministic.
- **Scenario lab** (`/demo`) — toggles and sliders for every lever: appointment system on/off, appointment share, no-show rate, active gates (1–4), gate hours incl. night gate, customs speed, yard cranes, berths, grain share/priority.
- **KPI dashboard** — throughput (TEU/day), average truck wait, max queue length, gate utilization, CO₂ from idling; side-by-side comparison against the crisis baseline with charts.
- **Monte Carlo** — re-run any scenario N times (default 30) with different seeds; every KPI gets a mean and a 95% confidence interval so a board sees uncertainty, not one lucky draw.
- **Disruption lab** — toggle crane breakdown, vessel bunching, gate closure, and weather slowdown, alone or combined, and watch KPIs and costs move.
- **Cost model** — dollar estimates per scenario (demurrage/detention, truck waiting, fuel/idling, crane-hours, carbon) with editable rates and deltas vs the crisis baseline.
- **Saved scenarios** — name and store full setups (every slider, toggle, and disruption) in the browser; reload them anytime.
- **Export** — download the time series as CSV, the KPI comparison as CSV, or the full reproducible bundle (params + KPIs + costs + Monte Carlo) as JSON.
- **Guided demo** — a 3-step narrative (crisis → Rotterdam-style TAS → TAS + night gate) for first-time viewers.
- **Animated port schematic** — the twin visualized live: gates, queues, yard cranes, berths.

### Scenario results (from the live model, seed 42)

| Scenario | Throughput | Avg truck wait | Max queue | CO₂/day |
|---|---|---|---|---|
| Status quo — crisis | 1,203 TEU/day | 393 min | 857 trucks | 14.2 t |
| Rotterdam-style TAS | 1,733 TEU/day | 43 min | 396 trucks (**−54%**) | 2.3 t |
| TAS + night gate | 2,296 TEU/day | 3 min | 19 trucks | 0.2 t |

The direction and magnitude line up with published research: a Moroccan ENSEM Casablanca study modeling a dynamic truck appointment system on **real Casablanca port data** measured a **−62% maximum queue length**, 7.8% of trucks rescheduled against preference, and 785 t/year CO₂ saved.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js 16 App (Vercel)                   │
│  ┌──────────────┐   ┌───────────────────────────────────────┐   │
│  │  / (landing) │   │  /demo                                │   │
│  │  marketing + │   │  ┌─────────────┐  ┌────────────────┐   │   │
│  │  ROI pitch   │   │  │ControlPanel │  │ PortMap (SVG)  │   │   │
│  └──────────────┘   │  │ (PARAM_META │  │ animated twin  │   │   │
│                     │  │  driven)    │  └────────────────┘   │   │
│                     │  └─────────────┘  ┌────────────────┐   │   │
│                     │  ┌─────────────┐  │ KPI cards +    │   │   │
│                     │  │ GuidedTour  │  │ recharts       │   │   │
│                     │  │ (3 presets) │  │ dashboards     │   │   │
│                     │  └─────────────┘  └────────────────┘   │   │
│                     └───────────────────────────────────────┘   │
│                                    │ runs in-browser, <100 ms    │
│                                    ▼                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  src/sim — decoupled simulation engine (no UI deps)       │  │
│  │  rng.ts (mulberry32) → types.ts → engine.ts (event heap) │  │
│  │  → scenarios.ts (presets + param metadata)               │  │
│  │  → disruptions.ts → costs.ts → montecarlo.ts             │  │
│  │  → storage.ts (saved scenarios) → export.ts (CSV/JSON)   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Model internals:** non-homogeneous Poisson arrivals (morning surge 6–10 AM) via thinning; appointment holders get evenly spread slots across operating hours with configurable no-shows, served from a priority lane; three-stage tandem queue — gates (lognormal service, customs speed), yard cranes, berths; gate operating hours (night gate = 24h); grain priority at the yard; snapshots every 15 sim-minutes drive charts and the animation.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000  (landing at /, twin at /demo)
npm test         # vitest — 69 tests, all deterministic (seeded)
npm run build    # production build
```

### New in this version

```ts
import {
  runSimulation, presetParams,           // base engine
  runMonteCarlo, runMonteCarloAsync,     // N replications + 95% CI
  computeCosts, DEFAULT_COST_RATES,      // $ estimates per scenario
  saveScenario, loadSavedScenarios,      // named scenarios (localStorage)
  buildSeriesCsv, buildExportJson,       // CSV / JSON export
  cloneDisruptions,                      // disruption bundles
  // --- research-grade output analysis (see "Simulation science" below) ---
  welchForParams, batchMeans, pairedComparison,  // Welch, batch means, CRN
  verifyRun,                             // V&V: Little's Law, conservation, utilization
  calibrate,                             // fit-to-data (random search + warning)
  erlangGateCheck,                       // M/M/c analytical cross-check
  runFactorial, ofatSensitivity,         // DOE + OFAT tornado + interaction heatmap
  confidenceInterval, tQuantile,         // Student-t statistics
} from "./src/sim";

// Monte Carlo: 30 replications, seeds 42..71
const mc = runMonteCarlo(presetParams("tas"), 30, 42);
console.log(mc.summaries.throughputTeuPerDay); // { mean, std, ciLow, ciHigh, min, max }

// Costs: demurrage, waiting, fuel, crane-hours, carbon
const result = runSimulation(presetParams("tas"));
console.log(computeCosts(result.kpis, result.waitSamplesMin).total); // $/day
```

### Use the engine standalone

```ts
import { runSimulation, presetParams } from "./src/sim";

const result = runSimulation({ ...presetParams("tas"), seed: 7 });
console.log(result.kpis.throughputTeuPerDay); // ~1733
console.log(result.series[0]);               // snapshots every 15 min
```

## Project structure

```
porttwin/
├── src/
│   ├── sim/                  # simulation engine (UI-agnostic)
│   │   ├── rng.ts            # seeded PRNG + distributions
│   │   ├── types.ts          # SimParams, Truck, Snapshot, Kpis
│   │   ├── engine.ts         # discrete-event core (binary-heap event queue)
│   │   ├── scenarios.ts      # crisis / TAS / TAS+night presets + control metadata
│   │   ├── disruptions.ts    # crane breakdown, bunching, gate closure, weather
│   │   ├── costs.ts          # $ cost model (demurrage, waiting, fuel, cranes, CO₂)
│   │   ├── montecarlo.ts     # N-replication runs + 95% CI summaries (Student-t)
│   │   ├── stats.ts          # t-distribution (exact), CIs, floored-service expectations
│   │   ├── outputAnalysis.ts # Welch warm-up, batch means, CRN paired comparison
│   │   ├── vv.ts             # verification: Little's Law, conservation, utilization
│   │   ├── calibration.ts    # fit-to-data random search + identification warning
│   │   ├── erlang.ts         # M/M/c Erlang-C analytical cross-check
│   │   ├── sensitivity.ts    # OFAT tornado + 2-factor interaction heatmap
│   │   ├── doe.ts            # full 2^k factorial experiments (Montgomery)
│   │   ├── storage.ts        # saved scenarios (localStorage, injectable backend)
│   │   ├── export.ts         # CSV / JSON export builders
│   │   └── index.ts
│   ├── app/
│   │   ├── page.tsx          # marketing landing page
│   │   ├── demo/page.tsx     # the twin: controls, KPIs, charts, guided tour
│   │   ├── layout.tsx
│   │   └── globals.css       # "harbor at night" design system
│   └── components/
│       ├── PortMap.tsx       # animated SVG port schematic + playback
│       ├── ControlPanel.tsx  # PARAM_META-driven scenario controls
│       ├── DisruptionsPanel.tsx  # 4 toggleable, combinable disruptions
│       ├── CostPanel.tsx     # cost breakdown + editable rates
│       ├── MonteCarloPanel.tsx   # replications, progress, CI table + bands
│       ├── SavedScenariosPanel.tsx  # save/load named scenarios
│       ├── ExportBar.tsx     # CSV / JSON downloads
│       └── ResearchPanel.tsx # 6 research tabs: output analysis, sensitivity,
│                              # V&V, calibration, Erlang-C, DOE
├── tests/
│   ├── sim.test.ts         # 17 vitest tests (determinism, KPIs, scenario deltas)
│   ├── upgrade.test.ts     # 27 tests (Monte Carlo, disruptions, costs, storage, export)
│   └── research.test.ts    # 25 tests (t-stats, Welch, batch means, CRN, V&V,
│                              # Erlang-C textbook values, calibration, DOE, OFAT)
└── README.md
```

## Why this — the ROI case

For a port authority evaluating a truck appointment system:

1. **Demurrage math.** Cutting average truck wait from 393 → 3 minutes removes roughly **6,500 idle truck-hours per day** — driver time, diesel, and storage fees that currently push small importers toward bankruptcy.
2. **Throughput is revenue.** Recovering ~1,100 TEU/day of gate capacity at typical handling tariffs pays back a TAS software project in weeks, not years — with zero concrete poured.
3. **Carbon.** Idling trucks emit 14.2 t CO₂/day in the crisis run vs 0.2 t fixed. The ENSEM study measured 785 t/year saved on real data.
4. **De-risked decisions.** Every "what-if" — night gates, a 4th gate, grain priority — gets tested in the twin first, with reproducible numbers for the board.

*Illustrative figures from the stylized model — plug in your tariffs for exact numbers.*

## Simulation science — methods

The Research panel applies textbook simulation methodology. Every method states its assumptions in-app; nothing is presented as more rigorous than it is.

- **Confidence intervals use the Student-t distribution** (df = n − 1), not the 1.96 normal factor — the normal factor is only the df → ∞ limit and understates uncertainty for modest replication counts (Law & Kelton, Ch. 9).
- **Welch's moving-average procedure** visualizes the initial transient across replications. The twin is a *terminating* simulation (one 24 h day, starts empty), so the ramp-up is real behaviour and is reported, **not deleted**. Deletion would be appropriate for a steady-state study.
- **Batch means** builds a CI from a single run's time series. It assumes approximate stationarity; this day is strongly non-stationary (morning peak), so the batch-means CI is indicative only — replication CIs remain primary.
- **Common random numbers (CRN)**: two scenarios run with the same seed stream; the comparison uses a paired-t CI on per-replication differences. The panel also shows the independent-streams CI so the variance reduction is visible, not assumed. CRN helps less when a structural change (e.g. TAS on/off) reshuffles the random stream.
- **Verification & validation**: the engine proves its own bookkeeping — conservation of flow (exact integer equality), Little's Law L = λ·W (using truncated sojourns, which is what makes the identity hold on a terminating run), and per-stage utilization identities using the *exact floored* service-time expectations (the engine floors service times, which raises the exponential berth mean by ~7%; ignoring the floor makes the check fail systematically — that failure is how the floor was caught). These verify internal consistency only, not validity against the real port.
- **Calibration** ("fit to data") runs a random search minimizing weighted squared relative error against pasted observed KPIs, and always shows the identification warning: fitting 3 parameters to 3 KPIs is identification-thin — a good fit proves the model *can* reproduce those KPIs, not that the parameters are the true ones.
- **Erlang-C cross-check**: an analytical M/M/c computation for the gate, shown next to the simulation. M/M/c assumes Poisson arrivals, exponential service, and steady state — all violated here on purpose — so divergence is expected and explained. When ρ ≥ 1 the analytical model has no steady state and the panel says so instead of printing a number.
- **Design of experiments**: full 2^k factorial (k = 2 or 3) with Yates-contrast effect estimates and an interaction plot. OFAT tornado + 2-factor heatmap cover screening; DOE covers interactions.

### References

- Law, A. M., & Kelton, W. D. (2015). *Simulation Modeling and Analysis*, 5th ed. McGraw-Hill.
- Banks, J., Carson, J. S., Nelson, B. L., & Nicol, D. M. (2010). *Discrete-Event System Simulation*, 5th ed. Pearson.
- Gross, D., Shortle, J. F., Thompson, J. M., & Harris, C. M. (2018). *Fundamentals of Queueing Theory*, 5th ed. Wiley.
- Montgomery, D. C. (2017). *Design and Analysis of Experiments*, 9th ed. Wiley.
- Welch, P. D. (1983). The statistical analysis of simulation results. In S. S. Lavenberg (Ed.), *The Computer Performance Modeling Handbook*. Academic Press.

## Honest limitations

- **Stylized, not calibrated.** Parameters are chosen to reproduce the crisis narrative (throughput collapse, 12h waits); the model is **not fitted to live port data**. The −54% queue reduction is the model's output; the −62% figure is from the ENSEM study on real data.
- **Landside only.** Vessel scheduling, rail, and labor shifts are out of scope; the berth stage is a simplified loading server.
- **One representative day.** The default horizon is 24h; multi-day dynamics (weekend effects, vessel bunching) are not modeled. *Vessel bunching* in the disruption lab is a truck-arrival burst, not a vessel schedule.
- **Cost rates are illustrative.** Dollar figures use plausible default rates (see `DEFAULT_COST_RATES`), not official port tariffs. "Demurrage" is a truck-hour proxy — the twin is landside and does not simulate vessels, so vessel demurrage per se is out of scope. Plug in real rates before quoting numbers.
- **Monte Carlo CIs are Student-t** (mean ± t(0.975, n−1)·s/√n). With few replications the bands are honestly wide — that is the point.
- **Calibration is identification-thin.** Fitting 3 parameters to 3 KPIs cannot identify the true parameters; a low residual only shows the model can reproduce those KPIs. Real calibration needs time-series data, more KPIs than parameters, and hold-out validation.
- **Welch warm-up is diagnostic only.** The model is a terminating 24 h simulation; no warm-up deletion is applied, because the ramp-up is real behaviour.
- **Disruptions are stylized.** A crane breakdown removes one crane for a window; it does not model repair logistics, spare parts, or cascading maintenance. Weather scales yard handling times only — it does not affect gates or berths.
- **No live data feeds.** A production twin would ingest gate logs, GPS, and TOS data — the engine is structured to accept that (see `Snapshot`/`SimParams`), but no connectors are built.

## Roadmap

- Live data ingestion (gate logs, truck GPS) to calibrate arrival/service distributions
- Vessel schedule integration and berth planning module
- Multi-day horizons and PDF board-report export
- Multi-scenario comparison view (run 2–3 scenarios side by side)

## License

MIT — see [LICENSE](LICENSE).
