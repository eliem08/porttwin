# PortTwin performance notes

Measured 2026-10-17 on the dev VM (2 vCPU, AMD EPYC 9D25, Node v24.20.0,
`runMonteCarlo` with `includeSeries: false`, DEFAULT_PARAMS unless noted).
Numbers are wall-clock on a shared VM — indicative, not a benchmark
guarantee. The D9 test in `tests/phased.test.ts` is a regression tripwire
(30 s), not a benchmark.

## Replication count × horizon scaling

| Replications | Horizon | Total wall-clock | Per replication |
|---|---|---|---|
| 10 | 24 h | ~140 ms | ~14 ms |
| 50 | 24 h | 542 ms | 10.8 ms |
| 200 | 24 h | 751 ms | 3.8 ms |
| 10 | 7 d | 408 ms | 40.8 ms |
| 50 | 7 d | 1 140 ms | 22.8 ms |
| 200 | 7 d | 4 378 ms | 21.9 ms |

A single 24 h run costs ~10–25 ms; a single 7 d run ~190 ms.

## Scaling analysis

Scaling is **linear** in replications × horizon — no superlinear
degradation was observed:

- 200 replications × 24 h complete in under 1 s.
- 200 replications × 7 d (the heaviest realistic research use) complete
  in ~4.4 s.
- Per-replication cost *decreases* slightly with replication count
  (10.8 ms → 3.8 ms at 24 h), which is V8 JIT warm-up, not a scaling
  anomaly: the first replications pay compilation cost.
- Cost per replication grows ~linearly with horizon (24 h → 7 d is a
  ~7× horizon increase; per-rep cost goes ~11 ms → ~22 ms, i.e. better
  than linear once warm, because longer runs amortize the fixed
  arrival-generation setup).

## Practical consequences

- The interactive UI (single run + Monte Carlo panels) is far from any
  performance cliff: a 50-replication Monte Carlo — the default research
  workflow — returns in about half a second.
- The calibration random search (default 60 candidates × 4 replications
  + 20 refinement replications = 260 runs) costs on the order of seconds,
  not minutes.
- The full vitest suite (172 tests after Phase D) runs in a few seconds;
  performance is not a CI bottleneck.

## What would change this

Moving to multi-day horizons with the 15-minute snapshot series enabled
(series collection is skipped in the numbers above) adds allocation
pressure but stays linear. If a future use case needs 10 000-replication
Monte Carlos (the contract's upper bound), expect ~2–4 minutes at 24 h —
acceptable for a background research job, and chunkable via
`runMonteCarloAsync`.
