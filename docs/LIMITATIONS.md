# PortTwin — known limitations registry

Frank list. Every entry names the resolving evidence — what would have to
be true, and shown, for the limitation to be retired. Last updated:
Phase D (2026-10-17).

> **PortTwin is NOT a validated digital twin.** It is a verified
> simulation engine (the code is right, per the V&V identities) wrapped
> in honest contracts. It becomes a *validated* twin only after
> calibration against measured operational data and a successful
> supervised pilot. See `docs/ACCEPTANCE.md`.

## 1. Uncalibrated — no real operational data

**Status:** open. **Blocks:** acceptance criteria 7, 8, 10.

The model has never been fitted to, or tested against, measured data
from the Port of Casablanca. All parameters are stylized defaults; all
validation fixtures are synthetic (engine-generated from known
parameters). Nothing in the outputs is grounded in the real port.

**Resolving evidence:** a `dataKind: "measured"` validation dataset
conforming to `src/sim/datasets.ts` (schema version 1.0.0), covering at
minimum daily throughput, hourly gate-queue lengths, and gate-wait
summaries over several weeks — from the terminal operator (TOS exports)
and/or ANP. Then: calibrate on part, validate on a held-out part, and
publish the residuals.

## 2. Stylized three-stage model

**Status:** open, by design. **Blocks:** nothing in the pilot criteria,
but bounds what the pilot may claim.

The engine models gate → yard → berth as three tandem queues. It does
NOT model vessel schedules or tides, customs inspection detail, labor
shifts, equipment maintenance logistics, rail, or the appointment
behavior of real trucking companies. Disruptions perturb the same three
stages; they are stylized, not operational scenarios.

**Resolving evidence:** a model-review session with port operations
staff confirming which mechanisms the pilot is allowed to speak about,
and a written scope statement attached to any pilot report.

## 3. Single-shared-stream CRN

**Status:** documented, open. **Blocks:** nothing — the limitation is
measured per comparison, not assumed.

Common random numbers work at seed granularity: one shared mulberry32
stream feeds arrivals and all service-time draws. Structural changes that
alter stream consumption (e.g. TAS on/off changing the arrival profile)
desynchronize the streams and degrade variance reduction. `pairedComparison`
returns the achieved `correlation` and both CIs so the gain is visible
per pair — trust the number, not the label. Verified working on mild
structural changes (D6: 3→4 gates, corr 0.69, paired CI 1.7× narrower;
8→10 yard cranes, corr 0.78, 2.1× narrower).

**Resolving evidence:** a per-stage substream discipline refactor
(separate RNG streams for arrivals, gate service, yard service, berth
service), with the D6 pairs re-run to show the correlation no longer
depends on structural similarity.

## 4. Illustrative cost assumptions

**Status:** open. **Blocks:** acceptance criterion 9.

Every cost line item is labeled `measured` vs `illustrative` (Phase C),
and today all of them are illustrative: demurrage/detention rates,
truck operating costs, CO₂ pricing. Cost outputs are order-of-magnitude
illustrations, not quotes.

**Resolving evidence:** measured cost inputs from the terminal operator
or published ANP tariff schedules, with sources recorded in the cost
assumption provenance fields.

## 5. Snapshot integration error in V&V

**Status:** documented, bounded.

`meanInSystem` is a rectangle-rule integral over 15-minute snapshots.
On horizons ≥ 12 h the Little's Law check holds within its 10%
tolerance (max observed 5.3% across the 40-scenario stress sweep); on
short 6–11 h horizons with spiky dynamics the discretization error can
reach ~13%. This is the documented numerical error of the check, not
model error. The exact invariant — entity conservation, residual
exactly 0 — holds on every scenario tested.

**Resolving evidence:** accumulate the system-area at every event time
instead of at snapshot times (engine change), then re-run the D1 sweep
to show the 6 h error collapsing to ~0.

## 6. Terminating-day scope

**Status:** by design.

Each run models one day starting empty (midnight, no trucks in system).
There is no multi-day steady state, no carry-over congestion, no weekly
seasonality. The morning ramp-up is real modeled behavior, not warm-up
bias to delete (see the Welch's-procedure notes in outputAnalysis.ts).

**Resolving evidence:** only relevant if a pilot asks multi-day
questions — then the model needs an initial-state mechanism and the
validation dataset needs multi-day coverage.

## 7. Scenario presets are narrative, not fitted

**Status:** by design.

The crisis / TAS / TAS-night presets tell a stylized story calibrated
to public reporting (throughput collapse ~2,800 → ~800 containers/day,
October 2026). They are not fitted parameters and must not be cited as
measurements of the real port.

**Resolving evidence:** same as limitation 1 — fitted parameters
replace the presets only after real calibration.
