/**
 * Analytical M/M/c queueing cross-check for the gate (Erlang-C).
 *
 * Textbook basis: Gross, Harris, Shortle & Thompson, "Fundamentals of
 * Queueing Theory" (5th ed., Wiley, 2018), Ch. 2 — the M/M/c model assumes
 * Poisson arrivals, exponential service, c parallel servers, infinite
 * queue, steady state (ρ < 1).
 *
 * The simulation violates every one of those assumptions on purpose:
 * arrivals are non-homogeneous Poisson (morning peak), gate service is
 * lognormal, the horizon is finite (terminating), and downstream blocking
 * exists. So the analytical value is a SANITY CHECK, not a target:
 * agreement within a factor of ~2 in a stable regime says the engine's
 * queueing physics is plausible; divergence is expected and explained,
 * not hidden. When ρ ≥ 1 the M/M/c model has NO steady state and the
 * module reports that instead of a number — a common textbook trap.
 */

/** Factorial via a simple loop (c ≤ 12 in this app, no overflow risk). */
function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

export interface ErlangCResult {
  /** Offered load a = λ/μ (erlangs). */
  offeredLoad: number;
  /** Server utilization ρ = a / c. */
  rho: number;
  /** Erlang-C probability that an arrival must wait. Null when ρ ≥ 1. */
  probWait: number | null;
  /** Mean waiting time in queue (same time unit as the inputs). Null when ρ ≥ 1. */
  meanWait: number | null;
  /** Mean number waiting. Null when ρ ≥ 1. */
  meanQueue: number | null;
  /** Mean number in system (waiting + in service). Null when ρ ≥ 1. */
  meanInSystem: number | null;
  /** True when the model is stable (ρ < 1). */
  stable: boolean;
}

/**
 * Erlang-C for an M/M/c queue.
 * @param arrivalRate λ (customers per time unit)
 * @param serviceRate μ (services per time unit per server)
 * @param servers c (number of parallel servers)
 */
export function erlangC(
  arrivalRate: number,
  serviceRate: number,
  servers: number
): ErlangCResult {
  if (!(arrivalRate >= 0) || !(serviceRate > 0) || !Number.isInteger(servers) || servers < 1) {
    throw new Error("erlangC: need arrivalRate >= 0, serviceRate > 0, servers >= 1 integer");
  }
  const a = arrivalRate / serviceRate;
  const rho = a / servers;
  if (rho >= 1) {
    return { offeredLoad: a, rho, probWait: null, meanWait: null, meanQueue: null, meanInSystem: null, stable: false };
  }
  // C(c, a) = [a^c / (c! (1 − ρ))] / [Σ_{k=0}^{c−1} a^k / k! + a^c / (c! (1 − ρ))]
  let sum = 0;
  for (let k = 0; k < servers; k++) sum += a ** k / factorial(k);
  const lastTerm = a ** servers / (factorial(servers) * (1 - rho));
  const probWait = lastTerm / (sum + lastTerm);
  const meanWait = (probWait / (servers * serviceRate - arrivalRate));
  const meanQueue = arrivalRate * meanWait;
  return {
    offeredLoad: a,
    rho,
    probWait,
    meanWait,
    meanQueue,
    meanInSystem: meanQueue + a,
    stable: true,
  };
}

/**
 * Arrival rate λ (trucks/min) averaged over the gate's open hours,
 * obtained by integrating the model's own arrival-rate shape
 * (morning peak / night factors) over the open window. This is the
 * closest steady-state analogue of the simulation's time-varying rate;
 * using the flat daily average instead would understate the peak-hour
 * load the gate actually faces.
 */
export function gateArrivalRatePerMin(params: {
  trucksPerDay: number;
  morningPeakFactor: number;
  peakWindow: [number, number];
  nightFactor: number;
  gateOpenHour: number;
  gateCloseHour: number;
  simHours: number;
}): number {
  const horizonMin = params.simHours * 60;
  const shapeAt = (tMin: number): number => {
    const hour = (tMin / 60) % 24;
    if (hour >= params.peakWindow[0] && hour < params.peakWindow[1]) {
      return params.morningPeakFactor;
    }
    if (hour < 5) return params.nightFactor;
    return 1;
  };
  let dayIntegral = 0;
  let openIntegral = 0;
  for (let t = 0; t < horizonMin; t += 1) {
    const shape = shapeAt(t);
    dayIntegral += shape;
    const hour = (t / 60) % 24;
    const open =
      params.gateCloseHour >= 24 ||
      (hour >= params.gateOpenHour && hour < params.gateCloseHour);
    if (open) openIntegral += shape;
  }
  if (dayIntegral <= 0 || openIntegral <= 0) return 0;
  // Expected arrivals per minute of open time.
  const expectedTotal = (params.trucksPerDay * params.simHours) / 24;
  const openMinutes =
    params.gateCloseHour >= 24
      ? horizonMin
      : Math.max(1, params.gateCloseHour - params.gateOpenHour) * 60 * (params.simHours / 24);
  return (expectedTotal * (openIntegral / dayIntegral)) / openMinutes;
}

/**
 * Erlang-C cross-check for the gate of a given scenario: λ from the
 * arrival-rate shape, μ = 1 / E[gate service], c = numGates.
 */
export function erlangGateCheck(params: {
  trucksPerDay: number;
  morningPeakFactor: number;
  peakWindow: [number, number];
  nightFactor: number;
  gateOpenHour: number;
  gateCloseHour: number;
  simHours: number;
  gateServiceMeanMin: number;
  numGates: number;
}): ErlangCResult & { arrivalRatePerMin: number; serviceRatePerMin: number } {
  const lambda = gateArrivalRatePerMin(params);
  const mu = 1 / params.gateServiceMeanMin;
  const res = erlangC(lambda, mu, params.numGates);
  return { ...res, arrivalRatePerMin: lambda, serviceRatePerMin: mu };
}
