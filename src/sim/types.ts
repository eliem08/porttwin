/**
 * Shared types for the Port of Casablanca digital twin simulation.
 *
 * The model is a three-stage tandem queue representing landside operations:
 *
 *   arrivals ──▶ GATE (c = numGates servers) ──▶ YARD (c = yardCranes)
 *              ──▶ BERTH (c = numBerths) ──▶ completed
 *
 * Trucks queue at the gate when all gates are busy or gates are closed.
 * An optional truck-appointment system (TAS) flattens the arrival profile by
 * spreading appointment holders across evenly spaced slots; walk-ins keep a
 * peaky arrival profile and wait in a lower-priority lane.
 */

/** Tunable parameters of one simulation run. All times in minutes unless noted. */
export interface SimParams {
  /** Integer seed for the deterministic PRNG. */
  seed: number;
  /** Simulated horizon in hours (e.g. 24). */
  simHours: number;
  /** Attempted truck arrivals per 24 h (scaled to simHours). */
  trucksPerDay: number;
  /** Arrival-rate multiplier inside the morning peak window. */
  morningPeakFactor: number;
  /** [startHour, endHour] of the morning peak (24h clock). */
  peakWindow: [number, number];
  /** Arrival-rate multiplier during night hours (0–5h). */
  nightFactor: number;

  /** Master switch for the truck appointment system. */
  appointmentSystem: boolean;
  /** Share of trucks holding an appointment when TAS is on (0..1). */
  appointmentShare: number;
  /** Share of appointment holders that never show up (0..1). */
  noShowRate: number;

  /** Number of gate lanes (1..4). */
  numGates: number;
  /** Gate opening hour (24h clock). */
  gateOpenHour: number;
  /** Gate closing hour; 24 means gates never close. */
  gateCloseHour: number;
  /** Mean gate service time per truck (customs + checks). */
  gateServiceMeanMin: number;
  /** Lognormal shape parameter for gate service time. */
  gateServiceSigma: number;

  /** Number of yard cranes (parallel handling servers). */
  yardCranes: number;
  /** Mean yard handling time per truck. */
  yardHandleMeanMin: number;

  /** Number of berths (parallel loading servers). */
  numBerths: number;
  /** Mean berth loading time per truck. */
  berthLoadMeanMin: number;

  /** Share of trucks carrying grain (record grain imports). */
  grainShare: number;
  /** When true, grain trucks jump the yard queue. */
  grainPriority: boolean;

  /** TEU per truck, uniform integer in [min, max]. */
  teuPerTruck: [number, number];
  /** kg of CO2 emitted per hour a truck idles in the gate queue. */
  co2KgPerIdleHour: number;
}

/** A truck moving through the simulated port. */
export interface Truck {
  id: number;
  arrivalTime: number; // minutes since sim start
  hasAppointment: boolean;
  slotTime: number | null; // scheduled slot (min), if any
  teu: number;
  isGrain: boolean;
  gateStartTime: number | null;
  gateWaitMin: number;
}

/** State snapshot sampled on a fixed cadence for charts/animation. */
export interface Snapshot {
  /** Minutes since sim start. */
  t: number;
  /** Total trucks waiting at the gate (both lanes). */
  gateQueue: number;
  appointmentQueue: number;
  walkinQueue: number;
  gatesBusy: number;
  yardQueue: number;
  yardBusy: number;
  berthQueue: number;
  berthsBusy: number;
  completedTrucks: number;
  completedTeu: number;
}

/** Aggregate key performance indicators for one run. */
export interface Kpis {
  /** Containers (TEU) fully processed per 24 h. */
  throughputTeuPerDay: number;
  /** Trucks fully processed per 24 h. */
  throughputTrucksPerDay: number;
  /** Mean gate waiting time in minutes (served trucks). */
  avgWaitMin: number;
  /** Maximum observed gate queue length. */
  maxQueue: number;
  /** Fraction of gate open-hours during which all gates were busy. */
  gateUtilization: number;
  yardUtilization: number;
  berthUtilization: number;
  /** Tonnes of CO2 from trucks idling in the gate queue. */
  co2Tonnes: number;
  /** Total truck arrivals generated. */
  totalTrucks: number;
  /** Trucks that completed all three stages. */
  completedTrucks: number;
  /** Mean end-to-end time (arrival → berth completion), minutes. */
  avgSystemMin: number;
}

/** Full result of one simulation run. */
export interface SimResult {
  params: SimParams;
  kpis: Kpis;
  /** Snapshots sampled every `snapshotEveryMin` (see engine). */
  series: Snapshot[];
}

/** Optional callback invoked with each snapshot as the sim runs. */
export type SnapshotCallback = (snapshot: Snapshot) => void;
