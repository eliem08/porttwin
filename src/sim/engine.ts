/**
 * Discrete-event simulation engine for the Port of Casablanca digital twin.
 *
 * Model: three-stage tandem queue (gate → yard → berth) with a non-homogeneous
 * Poisson arrival process. An optional truck-appointment system (TAS) replaces
 * the peaky walk-in arrival profile for appointment holders with evenly spread
 * slots, and serves them from a priority lane at the gate.
 *
 * The engine is UI-agnostic: `runSimulation(params)` executes the whole run
 * synchronously and returns KPIs plus a time series. Pass `onSnapshot` for
 * live progress (e.g. animation).
 */

import {
  mulberry32,
  uniform,
  uniformInt,
  exponential,
  lognormal,
  type Rng,
} from "./rng";
import type {
  SimParams,
  SimResult,
  Snapshot,
  SnapshotCallback,
  Truck,
} from "./types";

/** Snapshots are recorded every N simulated minutes. */
export const SNAPSHOT_EVERY_MIN = 15;

/* ------------------------------------------------------------------ */
/* Event queue (binary min-heap ordered by time, then sequence)        */
/* ------------------------------------------------------------------ */

type EventKind = "gateEnd" | "yardEnd" | "berthEnd";

interface SimEvent {
  time: number;
  seq: number;
  kind: EventKind;
  truck: Truck;
}

class EventQueue {
  private heap: SimEvent[] = [];
  private seqCounter = 0;

  get size(): number {
    return this.heap.length;
  }

  /** Time of the earliest event without removing it. */
  peekTime(): number {
    return this.heap.length > 0 ? this.heap[0].time : Infinity;
  }

  push(time: number, kind: EventKind, truck: Truck): void {
    const ev: SimEvent = { time, seq: this.seqCounter++, kind, truck };
    this.heap.push(ev);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): SimEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private less(a: SimEvent, b: SimEvent): boolean {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(this.heap[i], this.heap[p])) {
        [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
        i = p;
      } else break;
    }
  }

  private bubbleDown(i: number): void {
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < this.heap.length && this.less(this.heap[l], this.heap[smallest]))
        smallest = l;
      if (r < this.heap.length && this.less(this.heap[r], this.heap[smallest]))
        smallest = r;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Arrival generation                                                  */
/* ------------------------------------------------------------------ */

/** Instantaneous walk-in arrival rate (trucks/min) at sim-minute t. */
function walkinRate(tMin: number, p: SimParams, baseRate: number): number {
  const hour = (tMin / 60) % 24;
  let f = 1;
  if (hour >= p.peakWindow[0] && hour < p.peakWindow[1]) f = p.morningPeakFactor;
  else if (hour < 5) f = p.nightFactor;
  return baseRate * f;
}

/**
 * Generate the truck population for a run. Returns trucks sorted by
 * arrival time. Deterministic for a fixed seed.
 */
export function generateTrucks(p: SimParams, rng: Rng): Truck[] {
  const horizonMin = p.simHours * 60;
  const expectedTotal = Math.round((p.trucksPerDay * p.simHours) / 24);
  const trucks: Truck[] = [];
  let id = 0;

  const gateOpenMin = p.gateOpenHour * 60;
  // closeHour 24 → gates never close; represent as horizon end.
  const gateCloseMin =
    p.gateCloseHour >= 24 ? horizonMin : p.gateCloseHour * 60;
  // Appointment slots span the operating window (from midnight when 24h).
  const slotOpenMin = p.gateCloseHour >= 24 ? 0 : gateOpenMin;
  const slotCloseMin = Math.max(slotOpenMin + 1, gateCloseMin);

  if (p.appointmentSystem) {
    const nAppt = Math.round(expectedTotal * p.appointmentShare);
    const nWalk = expectedTotal - nAppt;

    // Appointment holders: evenly spread slots across gate operating hours.
    for (let i = 0; i < nAppt; i++) {
      if (rng() < p.noShowRate) continue; // no-show: slot goes unused
      const slot = uniform(rng, slotOpenMin, slotCloseMin);
      // Trucks arrive around their slot: mostly on time, some early/late.
      const arrival = Math.max(0, slot + uniform(rng, -10, 25));
      if (arrival > horizonMin) continue;
      trucks.push(makeTruck(id++, arrival, true, slot, p, rng));
    }
    // Walk-ins keep the peaky profile (thinning).
    generateWalkins(trucks, nWalk, horizonMin, p, rng, () => id++);
  } else {
    generateWalkins(trucks, expectedTotal, horizonMin, p, rng, () => id++);
  }

  trucks.sort((a, b) => a.arrivalTime - b.arrivalTime || a.id - b.id);
  return trucks;
}

function makeTruck(
  id: number,
  arrivalTime: number,
  hasAppointment: boolean,
  slotTime: number | null,
  p: SimParams,
  rng: Rng
): Truck {
  return {
    id,
    arrivalTime,
    hasAppointment,
    slotTime,
    teu: uniformInt(rng, p.teuPerTruck[0], p.teuPerTruck[1]),
    isGrain: rng() < p.grainShare,
    gateStartTime: null,
    gateWaitMin: 0,
  };
}

/** Non-homogeneous Poisson arrivals via Lewis–Shedler thinning. */
function generateWalkins(
  out: Truck[],
  count: number,
  horizonMin: number,
  p: SimParams,
  rng: Rng,
  nextId: () => number
): void {
  if (count <= 0) return;
  // Normalise the base rate so the expected count matches `count`.
  // Integrate the rate shape over the horizon numerically (1-min steps).
  let shapeIntegral = 0;
  for (let t = 0; t < horizonMin; t += 1) {
    const hour = (t / 60) % 24;
    let f = 1;
    if (hour >= p.peakWindow[0] && hour < p.peakWindow[1])
      f = p.morningPeakFactor;
    else if (hour < 5) f = p.nightFactor;
    shapeIntegral += f;
  }
  const baseRate = count / Math.max(shapeIntegral, 1e-9); // trucks per min
  const maxRate = baseRate * Math.max(p.morningPeakFactor, 1, p.nightFactor);

  let t = 0;
  let produced = 0;
  // Guard: thinning loop always terminates because maxRate > 0 when count > 0.
  while (t < horizonMin && produced < count) {
    t += exponential(rng, 1 / maxRate);
    if (t >= horizonMin) break;
    if (rng() < walkinRate(t, p, baseRate) / maxRate) {
      out.push(makeTruck(nextId(), t, false, null, p, rng));
      produced++;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main simulation                                                     */
/* ------------------------------------------------------------------ */

function gatesOpenAt(tMin: number, p: SimParams): boolean {
  if (p.gateCloseHour >= 24) return true; // 24h operation
  const hour = (tMin / 60) % 24;
  return hour >= p.gateOpenHour && hour < p.gateCloseHour;
}

export function runSimulation(
  params: SimParams,
  onSnapshot?: SnapshotCallback
): SimResult {
  const p = { ...params };
  const horizonMin = p.simHours * 60;
  const rng = mulberry32(p.seed);
  const trucks = generateTrucks(p, rng);

  const events = new EventQueue();

  // Queues
  const apptQueue: Truck[] = [];
  const walkQueue: Truck[] = [];
  const yardQueue: Truck[] = [];
  const berthQueue: Truck[] = [];

  // Server busy-until times
  const gateBusyUntil: number[] = new Array(p.numGates).fill(0);
  const yardBusyUntil: number[] = new Array(p.yardCranes).fill(0);
  const berthBusyUntil: number[] = new Array(p.numBerths).fill(0);

  // Stats
  let maxQueue = 0;
  let waitSum = 0;
  let waitedCount = 0;
  let idleCo2Kg = 0;
  let completedTrucks = 0;
  let completedTeu = 0;
  let systemSum = 0;
  let gateBusyMin = 0; // accumulated across gates while open
  let yardBusyMin = 0;
  let berthBusyMin = 0;

  const series: Snapshot[] = [];
  const emit = (t: number) => {
    const s: Snapshot = {
      t,
      gateQueue: apptQueue.length + walkQueue.length,
      appointmentQueue: apptQueue.length,
      walkinQueue: walkQueue.length,
      gatesBusy: gateBusyUntil.filter((b) => b > t).length,
      yardQueue: yardQueue.length,
      yardBusy: yardBusyUntil.filter((b) => b > t).length,
      berthQueue: berthQueue.length,
      berthsBusy: berthBusyUntil.filter((b) => b > t).length,
      completedTrucks,
      completedTeu,
    };
    series.push(s);
    onSnapshot?.(s);
  };

  const gateQueueLen = () => apptQueue.length + walkQueue.length;

  function tryStartGate(t: number): void {
    if (!gatesOpenAt(t, p)) return;
    for (let g = 0; g < p.numGates; g++) {
      if (gateBusyUntil[g] > t) continue;
      const truck = apptQueue.length > 0 ? apptQueue.shift()! : walkQueue.shift();
      if (!truck) break;
      const wait = t - truck.arrivalTime;
      truck.gateStartTime = t;
      truck.gateWaitMin = wait;
      waitSum += wait;
      waitedCount++;
      idleCo2Kg += (wait / 60) * p.co2KgPerIdleHour;
      const svc = Math.max(0.5, lognormal(rng, p.gateServiceMeanMin, p.gateServiceSigma));
      gateBusyUntil[g] = t + svc;
      gateBusyMin += svc;
      events.push(t + svc, "gateEnd", truck);
    }
  }

  function tryStartYard(t: number): void {
    for (let c = 0; c < p.yardCranes; c++) {
      if (yardBusyUntil[c] > t) continue;
      if (yardQueue.length === 0) break;
      let idx = 0;
      if (p.grainPriority) {
        idx = yardQueue.findIndex((tr) => tr.isGrain);
        if (idx === -1) idx = 0;
      }
      const truck = yardQueue.splice(idx, 1)[0];
      const svc = Math.max(1, lognormal(rng, p.yardHandleMeanMin, 0.4));
      yardBusyUntil[c] = t + svc;
      yardBusyMin += svc;
      events.push(t + svc, "yardEnd", truck);
    }
  }

  function tryStartBerth(t: number): void {
    for (let b = 0; b < p.numBerths; b++) {
      if (berthBusyUntil[b] > t) continue;
      const truck = berthQueue.shift();
      if (!truck) break;
      const svc = Math.max(1, exponential(rng, p.berthLoadMeanMin));
      berthBusyUntil[b] = t + svc;
      berthBusyMin += svc;
      events.push(t + svc, "berthEnd", truck);
    }
  }

  // Merge arrivals into the event flow: walk the sorted truck list.
  let arrivalIdx = 0;
  let nextSnapshotAt = SNAPSHOT_EVERY_MIN;
  emit(0);

  const horizonEnd = horizonMin;

  for (;;) {
    const nextArrival =
      arrivalIdx < trucks.length ? trucks[arrivalIdx].arrivalTime : Infinity;
    const nextEvent = events.peekTime();

    // Take snapshots on the fixed cadence even between events.
    const nextT = Math.min(nextArrival, nextEvent, nextSnapshotAt);
    if (nextT === Infinity || nextT > horizonEnd) break;
    const t = nextT;

    if (t >= nextSnapshotAt - 1e-9) {
      emit(t);
      nextSnapshotAt = Math.floor(t / SNAPSHOT_EVERY_MIN + 1) * SNAPSHOT_EVERY_MIN;
      continue;
    }

    if (nextArrival <= nextEvent) {
      // Process all arrivals at time t (list is sorted).
      while (
        arrivalIdx < trucks.length &&
        trucks[arrivalIdx].arrivalTime <= t + 1e-9
      ) {
        const truck = trucks[arrivalIdx++];
        if (truck.hasAppointment) apptQueue.push(truck);
        else walkQueue.push(truck);
        const q = gateQueueLen();
        if (q > maxQueue) maxQueue = q;
      }
      tryStartGate(t);
    } else {
      const ev = events.pop()!;
      const et = ev.time;
      if (et > horizonEnd) {
        // Event beyond horizon: stop processing (remaining queue stays).
        break;
      }
      switch (ev.kind) {
        case "gateEnd":
          yardQueue.push(ev.truck);
          tryStartYard(et);
          tryStartGate(et);
          break;
        case "yardEnd":
          berthQueue.push(ev.truck);
          tryStartBerth(et);
          tryStartYard(et);
          break;
        case "berthEnd":
          completedTrucks++;
          completedTeu += ev.truck.teu;
          systemSum += et - ev.truck.arrivalTime;
          tryStartBerth(et);
          break;
      }
      const q = gateQueueLen();
      if (q > maxQueue) maxQueue = q;
    }
  }
  // Final snapshot (skip if the loop already emitted exactly at the horizon).
  if (series.length === 0 || series[series.length - 1].t < horizonEnd - 1e-9) {
    emit(horizonEnd);
  }

  const dayFactor = 24 / p.simHours;
  const openHoursPerDay =
    p.gateCloseHour >= 24 ? 24 : Math.max(1, p.gateCloseHour - p.gateOpenHour);
  const gateCapacityMin = p.numGates * openHoursPerDay * 60 * (p.simHours / 24);

  const kpis = {
    throughputTeuPerDay: completedTeu * dayFactor,
    throughputTrucksPerDay: completedTrucks * dayFactor,
    avgWaitMin: waitedCount > 0 ? waitSum / waitedCount : 0,
    maxQueue,
    gateUtilization: gateCapacityMin > 0 ? Math.min(1, gateBusyMin / gateCapacityMin) : 0,
    yardUtilization:
      p.yardCranes > 0
        ? Math.min(1, yardBusyMin / (p.yardCranes * horizonMin))
        : 0,
    berthUtilization:
      p.numBerths > 0
        ? Math.min(1, berthBusyMin / (p.numBerths * horizonMin))
        : 0,
    co2Tonnes: idleCo2Kg / 1000,
    totalTrucks: trucks.length,
    completedTrucks,
    avgSystemMin: completedTrucks > 0 ? systemSum / completedTrucks : 0,
  };

  return { params: p, kpis, series };
}
