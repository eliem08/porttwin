# PortTwin — acceptance criteria for a supervised pilot

> **PortTwin is NOT a validated digital twin.** It is a *verified*
> simulation engine: the code provably conserves entities, reproduces
> its own seeds bit-identically, and computes its statistics correctly.
> Real-world accuracy is a separate claim that requires measured
> operational data — which does not exist yet. The twin becomes
> *validated* only when criteria 7 and 8 are MET and a supervised pilot
> (criterion 10) succeeds.

Statuses: **MET** · **NOT MET** · **BLOCKED-ON-REAL-DATA**.

## Software correctness (MET — no real data needed)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Entity conservation holds exactly under randomized stress | **MET** | D1: residual exactly 0 across 40 randomized disruption combinations × seeds (`tests/phased.test.ts`) |
| 2 | Event queue processes events in chronological order | **MET** | D2: (time, sequence) ordering under heavy simultaneous-arrival load; B1 audit tests |
| 3 | Runs are reproducible from seeds | **MET** | D3: 50-seed sweep, bit-identical KPIs/verification; B4 |
| 4 | KPI definitions consistent across code paths | **MET** | D4: KPIs vs independent recomputation (waits, throughput, utilization, CO₂, system time); B3 |
| 5 | Statistics machinery correct on known ground truth | **MET** | D5: Student-t CI empirical coverage **94.3%** at nominal 95% (600 reps × n=12, Normal(100,15)); B5 |
| 6 | Paired-comparison variance reduction on structural changes | **MET** | D6: 3→4 gates corr 0.69, paired CI 1.7× narrower; 8→10 cranes corr 0.78, 2.1× narrower; B6 |
| 7 | Performance scales ~linearly; documented | **MET** | `docs/PERFORMANCE.md`: 200 reps × 24 h in 0.75 s, 200 reps × 7 d in 4.4 s; no superlinear degradation |
| 8 | Validation-data schemas versioned and enforced | **MET** | `src/sim/datasets.ts`, `SCHEMA_VERSION = "1.0.0"`, version-gated validator; D8 |
| 9 | Calibration → held-out workflow exercised end to end | **MET** | D7: calibrate on synthetic set A, evaluate on held-out set B with fresh seeds; `evaluateParams` in `src/sim/calibration.ts`. **Machinery only** — proves the workflow runs, not real-world accuracy |
| 10 | Copy honesty: no "validated digital twin" claims | **MET** | Phase C qualified copy; this document's prominent statement; `docs/LIMITATIONS.md` |

## Real-world accuracy (BLOCKED — needs measured data)

| # | Criterion | Status | Evidence / what is missing |
|---|---|---|---|
| 11 | Calibrated against measured operational data | **BLOCKED-ON-REAL-DATA** | No measured dataset exists. Need: `dataKind: "measured"` dataset per `src/sim/datasets.ts` — daily throughput, hourly gate queues, wait summaries over several weeks. From: **terminal operator** (TOS exports) and/or **ANP** (gate logs, published stats) |
| 12 | Validated against independent held-out observations | **BLOCKED-ON-REAL-DATA** | Same data ask as 11, split into calibration and held-out periods the model never saw during fitting. The machinery is ready (criterion 9); the data is not |
| 13 | Cost assumptions measured, not illustrative | **BLOCKED-ON-REAL-DATA** | All cost line items currently `illustrative`. Need: demurrage/detention rates, truck operating costs from the operator or ANP tariff schedules |
| 14 | Supervised pilot with the terminal operator | **NOT MET** | Requires 11 + 12 first, plus an operator agreement defining the pilot's scope, success metrics, and a supervision arrangement. No approach made yet |

## The real-data ask (for the terminal operator / ANP)

To unblock criteria 11–13, PortTwin needs:

1. **Hourly gate queue lengths** — trucks waiting at the gate, per hour, several weeks (validates queue dynamics).
2. **Daily throughput** — TEU and trucks processed per day (validates volume).
3. **Gate-wait summaries** — per-day mean / p50 / p95 / max wait in minutes (validates the KPI the crisis reporting cites).
4. **Service measurements** — trucks served and busy-minutes per stage, or direct service-time samples (validates the service distributions).
5. **Cost inputs** — demurrage/detention rates, truck operating cost per hour (grounds the cost panel).

All five have versioned schemas waiting in `src/sim/datasets.ts`
(`SCHEMA_VERSION = "1.0.0"`). The `validateValidationDataset` export
checks any payload before it touches the calibration machinery.
