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
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Model internals:** non-homogeneous Poisson arrivals (morning surge 6–10 AM) via thinning; appointment holders get evenly spread slots across operating hours with configurable no-shows, served from a priority lane; three-stage tandem queue — gates (lognormal service, customs speed), yard cranes, berths; gate operating hours (night gate = 24h); grain priority at the yard; snapshots every 15 sim-minutes drive charts and the animation.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000  (landing at /, twin at /demo)
npm test         # vitest — 17 tests, all deterministic (seeded)
npm run build    # production build
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
│   │   └── index.ts
│   ├── app/
│   │   ├── page.tsx          # marketing landing page
│   │   ├── demo/page.tsx     # the twin: controls, KPIs, charts, guided tour
│   │   ├── layout.tsx
│   │   └── globals.css       # "harbor at night" design system
│   └── components/
│       ├── PortMap.tsx       # animated SVG port schematic + playback
│       └── ControlPanel.tsx  # PARAM_META-driven scenario controls
├── tests/sim.test.ts         # 17 vitest tests (determinism, KPIs, scenario deltas)
└── README.md
```

## Why this — the ROI case

For a port authority evaluating a truck appointment system:

1. **Demurrage math.** Cutting average truck wait from 393 → 3 minutes removes roughly **6,500 idle truck-hours per day** — driver time, diesel, and storage fees that currently push small importers toward bankruptcy.
2. **Throughput is revenue.** Recovering ~1,100 TEU/day of gate capacity at typical handling tariffs pays back a TAS software project in weeks, not years — with zero concrete poured.
3. **Carbon.** Idling trucks emit 14.2 t CO₂/day in the crisis run vs 0.2 t fixed. The ENSEM study measured 785 t/year saved on real data.
4. **De-risked decisions.** Every "what-if" — night gates, a 4th gate, grain priority — gets tested in the twin first, with reproducible numbers for the board.

*Illustrative figures from the stylized model — plug in your tariffs for exact numbers.*

## Honest limitations

- **Stylized, not calibrated.** Parameters are chosen to reproduce the crisis narrative (throughput collapse, 12h waits); the model is **not fitted to live port data**. The −54% queue reduction is the model's output; the −62% figure is from the ENSEM study on real data.
- **Landside only.** Vessel scheduling, rail, and labor shifts are out of scope; the berth stage is a simplified loading server.
- **One representative day.** The default horizon is 24h; multi-day dynamics (weekend effects, vessel bunching) are not modeled.
- **No live data feeds.** A production twin would ingest gate logs, GPS, and TOS data — the engine is structured to accept that (see `Snapshot`/`SimParams`), but no connectors are built.

## Roadmap

- Live data ingestion (gate logs, truck GPS) to calibrate arrival/service distributions
- Vessel schedule integration and berth planning module
- Cost module with configurable tariffs for board-ready ROI sheets
- Multi-day horizons and what-if comparison export (PDF)

## License

MIT — see [LICENSE](LICENSE).
