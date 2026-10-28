/**
 * Phase C tests: versioned contracts, validation-first run service,
 * idempotency, audit trail, RBAC approvals, and HTTP hygiene.
 *
 * Every new validation path has a regression test. Simulation runs in
 * these tests are small (3 replications × 4 h) — the statistical
 * machinery itself is unchanged from the Phase B audit.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SIM_INPUT_CONTRACT_VERSION,
  SIM_OUTPUT_CONTRACT_VERSION,
  SimulationInputSchema,
  inputHash,
  loadSimulationInput,
  stableStringify,
} from "../src/sim/contracts";
import { SimError, toPublicError } from "../src/sim/errors";
import {
  clearRunCache,
  getRunCacheStats,
  inputToSimParams,
  runScenario,
} from "../src/sim/service";
import {
  auditStore,
  type AuditEvent,
} from "../src/sim/audit";
import {
  DevMockAuthProvider,
  approveForDecision,
  assertNotDev,
  clearApprovals,
  getApproval,
} from "../src/sim/auth";
import {
  MAX_BODY_BYTES,
  RateLimiter,
  assertBodySizeOk,
  toErrorResponse,
} from "../src/sim/http";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1.0.0",
    scenarioId: "test-crisis",
    seed: 42,
    replications: 3,
    horizonHours: 4,
    resources: [
      { id: "gates", kind: "gate-lane", count: 3, unit: "lanes" },
      { id: "yard", kind: "yard-crane", count: 8, unit: "cranes" },
      { id: "berths", kind: "berth", count: 3, unit: "berths" },
    ],
    arrivalProcess: {
      type: "poisson",
      ratePerHour: 70,
      peakFactor: 2.2,
      peakWindowStartHour: 6,
      peakWindowEndHour: 10,
      unit: "trucks/hour",
    },
    serviceTimeDistributions: {
      gateServiceMin: {
        family: "lognormal",
        meanMin: 3.6,
        sigma: 0.5,
        unit: "minutes",
      },
      yardHandlingMin: {
        family: "lognormal",
        meanMin: 6,
        sigma: 0.4,
        unit: "minutes",
      },
      berthLoadingMin: {
        family: "exponential",
        meanMin: 2.5,
        unit: "minutes",
      },
    },
    costAssumptions: [
      {
        name: "demurrage",
        amount: 75,
        currency: "USD",
        perUnit: "truck-day",
        kind: "illustrative",
        source: "port tariff sheet",
      },
    ],
    ...overrides,
  };
}

/** Expect a SimError with the given code; returns it for inspection. */
function expectSimError(fn: () => unknown, code: string): SimError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SimError);
    expect((e as SimError).code).toBe(code);
    return e as SimError;
  }
  throw new Error(`Expected SimError(${code}) but nothing was thrown`);
}

beforeEach(() => {
  clearRunCache();
  auditStore.clear();
  clearApprovals();
});

/* ------------------------------------------------------------------ */
/* Contract versions                                                   */
/* ------------------------------------------------------------------ */

describe("contract versions", () => {
  it("pins both contract versions to 1.0.0", () => {
    expect(SIM_INPUT_CONTRACT_VERSION).toBe("1.0.0");
    expect(SIM_OUTPUT_CONTRACT_VERSION).toBe("1.0.0");
  });

  it("accepts a valid input through the schema", () => {
    const parsed = SimulationInputSchema.safeParse(validInput());
    expect(parsed.success).toBe(true);
  });
});

describe("scenario loader: version gate", () => {
  it("rejects a missing contractVersion, naming expected vs found", () => {
    const { contractVersion: _drop, ...rest } = validInput();
    const err = expectSimError(() => loadSimulationInput(rest), "VERSION_MISMATCH");
    expect(err.message).toContain('version "1.0.0"');
    expect(err.details).toMatchObject({
      expected: "1.0.0",
      found: null,
    });
  });

  it("rejects a NEWER contractVersion without coercing", () => {
    const err = expectSimError(
      () => loadSimulationInput(validInput({ contractVersion: "2.0.0" })),
      "VERSION_MISMATCH"
    );
    expect(err.message).toContain('"2.0.0"');
    expect(err.message).toContain('"1.0.0"');
    expect(err.message).toContain("newer than");
    expect(err.details).toMatchObject({ expected: "1.0.0", found: "2.0.0" });
  });

  it("rejects an OLDER contractVersion without coercing", () => {
    const err = expectSimError(
      () => loadSimulationInput(validInput({ contractVersion: "0.9.0" })),
      "VERSION_MISMATCH"
    );
    expect(err.message).toContain("older than");
    expect(err.details).toMatchObject({ expected: "1.0.0", found: "0.9.0" });
  });

  it("rejects an unparsable contractVersion", () => {
    const err = expectSimError(
      () => loadSimulationInput(validInput({ contractVersion: "banana" })),
      "VERSION_MISMATCH"
    );
    expect(err.details).toMatchObject({ expected: "1.0.0", found: "banana" });
  });

  it("rejects a non-object payload without crashing", () => {
    expectSimError(() => loadSimulationInput(null), "VALIDATION_ERROR");
    expectSimError(() => loadSimulationInput("nope"), "VALIDATION_ERROR");
    expectSimError(() => loadSimulationInput([1, 2]), "VALIDATION_ERROR");
  });
});

/* ------------------------------------------------------------------ */
/* Contract validation paths                                           */
/* ------------------------------------------------------------------ */

describe("SimulationInput validation", () => {
  it("rejects missing required fields with field-level issues", () => {
    const { scenarioId: _drop, ...rest } = validInput();
    const err = expectSimError(() => loadSimulationInput(rest), "VALIDATION_ERROR");
    const issues = (err.details as { issues: { path: string }[] }).issues;
    expect(issues.some((i) => i.path === "scenarioId")).toBe(true);
  });

  it("rejects unknown fields instead of silently dropping them", () => {
    const err = expectSimError(
      () => loadSimulationInput(validInput({ bogusField: 123 })),
      "VALIDATION_ERROR"
    );
    // zod reports unrecognized keys at the root with the key names in the
    // message — the point is the payload is rejected, never coerced.
    expect(JSON.stringify(err.details)).toContain("bogusField");
  });

  it("rejects NaN seed", () => {
    expectSimError(
      () => loadSimulationInput(validInput({ seed: NaN })),
      "VALIDATION_ERROR"
    );
  });

  it("rejects Infinity in horizonHours", () => {
    expectSimError(
      () => loadSimulationInput(validInput({ horizonHours: Infinity })),
      "VALIDATION_ERROR"
    );
  });

  it("rejects NaN inside nested numeric input", () => {
    const input = validInput();
    (input.arrivalProcess as Record<string, unknown>).ratePerHour = NaN;
    expectSimError(() => loadSimulationInput(input), "VALIDATION_ERROR");
  });

  it("rejects negative arrival rate", () => {
    const input = validInput();
    (input.arrivalProcess as Record<string, unknown>).ratePerHour = -5;
    expectSimError(() => loadSimulationInput(input), "VALIDATION_ERROR");
  });

  it("rejects replications outside [2, 10000] and non-integers", () => {
    for (const bad of [0, 1, 10001, 2.5, -3]) {
      expectSimError(
        () => loadSimulationInput(validInput({ replications: bad })),
        "VALIDATION_ERROR"
      );
    }
  });

  it("rejects negative distribution parameters", () => {
    const input = validInput();
    (
      input.serviceTimeDistributions as Record<string, Record<string, unknown>>
    ).gateServiceMin.meanMin = -1;
    expectSimError(() => loadSimulationInput(input), "VALIDATION_ERROR");
  });

  it("rejects lognormal without sigma", () => {
    const input = validInput();
    const gate = (
      input.serviceTimeDistributions as Record<string, Record<string, unknown>>
    ).gateServiceMin;
    delete gate.sigma;
    const err = expectSimError(() => loadSimulationInput(input), "VALIDATION_ERROR");
    const issues = (err.details as { issues: { path: string }[] }).issues;
    expect(issues.some((i) => i.path.includes("sigma"))).toBe(true);
  });

  it("rejects uniform with maxMin <= minMin", () => {
    const input = validInput();
    (
      input.serviceTimeDistributions as Record<string, Record<string, unknown>>
    ).berthLoadingMin = {
      family: "uniform",
      meanMin: 2.5,
      minMin: 4,
      maxMin: 2,
      unit: "minutes",
    };
    expectSimError(() => loadSimulationInput(input), "VALIDATION_ERROR");
  });

  it("rejects an inverted peak window", () => {
    const input = validInput();
    const ap = input.arrivalProcess as Record<string, unknown>;
    ap.peakWindowStartHour = 10;
    ap.peakWindowEndHour = 6;
    expectSimError(() => loadSimulationInput(input), "VALIDATION_ERROR");
  });
});

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

describe("canonical input hashing", () => {
  it("is stable under key reordering", () => {
    const a = loadSimulationInput(validInput());
    // Same logical input, different key order at the top level.
    const b = loadSimulationInput({
      seed: 42,
      scenarioId: "test-crisis",
      contractVersion: "1.0.0",
      replications: 3,
      horizonHours: 4,
      costAssumptions: (validInput() as Record<string, unknown>).costAssumptions,
      serviceTimeDistributions: (validInput() as Record<string, unknown>).serviceTimeDistributions,
      arrivalProcess: (validInput() as Record<string, unknown>).arrivalProcess,
      resources: (validInput() as Record<string, unknown>).resources,
    });
    expect(inputHash(a)).toBe(inputHash(b));
    expect(inputHash(a)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when the input changes", () => {
    const a = loadSimulationInput(validInput());
    const b = loadSimulationInput(validInput({ seed: 43 }));
    expect(inputHash(a)).not.toBe(inputHash(b));
  });

  it("stableStringify refuses non-finite numbers", () => {
    expectSimError(() => stableStringify({ x: NaN }), "VALIDATION_ERROR");
  });
});

/* ------------------------------------------------------------------ */
/* runScenario: validate-first, output contract                        */
/* ------------------------------------------------------------------ */

describe("runScenario", () => {
  it("validates BEFORE running: invalid input performs zero runs", () => {
    expectSimError(() => runScenario(validInput({ seed: NaN })), "VALIDATION_ERROR");
    expect(getRunCacheStats().runsExecuted).toBe(0);
    expect(auditStore.events()).toHaveLength(0);
  });

  it("returns a contract-valid output with labeled CIs and assumptions", () => {
    const out = runScenario(validInput());
    expect(out.contractVersion).toBe("1.0.0");
    expect(out.scenarioId).toBe("test-crisis");
    expect(out.inputHash).toMatch(/^[0-9a-f]{16}$/);
    expect(Number.isNaN(Date.parse(out.completedAtUtc))).toBe(false);

    // KPIs present and finite, units explicit in names.
    for (const v of [
      out.kpis.throughputTrucksPerHour,
      out.kpis.throughputTeuPerHour,
      out.kpis.meanWaitMin,
      out.kpis.p95WaitMin,
      out.kpis.utilizationPct.gate,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(out.kpis.p95WaitMin).toBeGreaterThanOrEqual(out.kpis.meanWaitMin);

    // CIs labeled with method + level, from replication-level samples.
    expect(out.confidenceIntervals.length).toBeGreaterThan(0);
    for (const ci of out.confidenceIntervals) {
      expect(ci.method).toBe("student-t");
      expect(ci.confidenceLevel).toBe(0.95);
      expect(ci.replications).toBe(3);
      expect(ci.low).toBeLessThanOrEqual(ci.mean);
      expect(ci.mean).toBeLessThanOrEqual(ci.high);
    }

    // Assumptions each labeled measured|illustrative; warnings present.
    for (const a of out.assumptions) {
      expect(["measured", "illustrative"]).toContain(a.kind);
    }
    expect(Array.isArray(out.warnings)).toBe(true);
  });

  it("is deterministic: same seed always yields the same KPIs", () => {
    const first = runScenario(validInput(), { idempotencyKey: "k1" });
    const second = runScenario(validInput(), { idempotencyKey: "k2" });
    expect(first.kpis).toEqual(second.kpis);
    expect(first.inputHash).toBe(second.inputHash);
  });
});

/* ------------------------------------------------------------------ */
/* Idempotency                                                         */
/* ------------------------------------------------------------------ */

describe("idempotency", () => {
  it("same input + same key runs once and returns deep-equal outputs", () => {
    const first = runScenario(validInput(), { idempotencyKey: "abc" });
    const second = runScenario(validInput(), { idempotencyKey: "abc" });
    const stats = getRunCacheStats();
    expect(stats.runsExecuted).toBe(1);
    expect(stats.cacheHits).toBe(1);
    expect(second).toEqual(first);
  });

  it("same input + different key runs again", () => {
    runScenario(validInput(), { idempotencyKey: "one" });
    runScenario(validInput(), { idempotencyKey: "two" });
    expect(getRunCacheStats().runsExecuted).toBe(2);
  });

  it("different input hashes do not collide in the cache", () => {
    runScenario(validInput({ scenarioId: "aaa" }), { idempotencyKey: "k" });
    runScenario(validInput({ scenarioId: "bbb" }), { idempotencyKey: "k" });
    expect(getRunCacheStats().runsExecuted).toBe(2);
    expect(getRunCacheStats().cachedRecords).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Audit trail                                                         */
/* ------------------------------------------------------------------ */

describe("audit trail", () => {
  it("records a completed-run event with the traceability fields", () => {
    const out = runScenario(validInput({ scenarioId: "audit-me" }), {
      actor: "test-actor",
    });
    const events: AuditEvent[] = auditStore.events();
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.eventType).toBe("scenario.run.completed");
    expect(e.scenarioId).toBe("audit-me");
    expect(e.inputHash).toBe(out.inputHash);
    expect(e.seed).toBe(42);
    expect(e.actor).toBe("test-actor");
    expect(e.devOnly).toBe(true);
    expect(Number.isFinite(e.kpiSummary.throughputTrucksPerHour)).toBe(true);
    expect(Number.isFinite(e.kpiSummary.meanWaitMin)).toBe(true);
  });

  it("records cache hits as events too", () => {
    runScenario(validInput(), { idempotencyKey: "hit-me" });
    runScenario(validInput(), { idempotencyKey: "hit-me" });
    const types = auditStore.events().map((e) => e.eventType);
    expect(types).toEqual(["scenario.run.completed", "scenario.run.cache-hit"]);
  });

  it("is append-only: callers cannot mutate history", () => {
    runScenario(validInput());
    const copy = auditStore.events();
    copy.length = 0;
    expect(auditStore.events()).toHaveLength(1);
  });

  it("supports the which-run-produced-this lookup by input hash", () => {
    const out = runScenario(validInput({ scenarioId: "trace" }));
    const found = auditStore.eventsForInput(out.inputHash);
    expect(found).toHaveLength(1);
    expect(found[0].scenarioId).toBe("trace");
  });
});

/* ------------------------------------------------------------------ */
/* Auth / RBAC approvals                                               */
/* ------------------------------------------------------------------ */

describe("approvals (RBAC)", () => {
  it("denies approval for analyst role with a structured FORBIDDEN", () => {
    const out = runScenario(validInput());
    const analyst = new DevMockAuthProvider("u-analyst", ["analyst"]);
    const err = expectSimError(() => approveForDecision(out, analyst), "FORBIDDEN");
    expect(err.message).toContain("approver");
    expect(getApproval(out.inputHash)).toBeNull();
  });

  it("denies approval for viewer role as well", () => {
    const out = runScenario(validInput());
    const viewer = new DevMockAuthProvider("u-viewer", ["viewer"]);
    expectSimError(() => approveForDecision(out, viewer), "FORBIDDEN");
  });

  it("grants approval for the approver role and audit-logs it", () => {
    const out = runScenario(validInput());
    const approver = new DevMockAuthProvider("u-approver", ["approver"]);
    const record = approveForDecision(out, approver);
    expect(record.role).toBe("approver");
    expect(record.approvedBy).toBe("u-approver");
    expect(record.inputHash).toBe(out.inputHash);
    expect(getApproval(out.inputHash)).toEqual(record);

    const approvals = auditStore
      .eventsForInput(out.inputHash)
      .filter((e) => e.eventType === "scenario.output.approved");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].approvedBy).toBe("u-approver");
  });

  it("lets admin inherit the approver permission", () => {
    const out = runScenario(validInput());
    const admin = new DevMockAuthProvider("u-admin", ["admin"]);
    const record = approveForDecision(out, admin);
    expect(record.role).toBe("admin");
  });

  it("assertNotDev refuses the dev mock for production wiring", () => {
    const mock = new DevMockAuthProvider("u", ["approver"]);
    expectSimError(() => assertNotDev(mock), "FORBIDDEN");
  });
});

/* ------------------------------------------------------------------ */
/* Mapping warnings                                                    */
/* ------------------------------------------------------------------ */

describe("inputToSimParams mapping", () => {
  it("maps poisson input onto engine params", () => {
    const input = loadSimulationInput(validInput());
    const { params, warnings } = inputToSimParams(input);
    expect(params.seed).toBe(42);
    expect(params.simHours).toBe(4);
    expect(params.trucksPerDay).toBeCloseTo(70 * 24);
    expect(params.numGates).toBe(3);
    expect(params.gateServiceMeanMin).toBe(3.6);
    expect(params.gateServiceSigma).toBe(0.5);
    expect(warnings).toBeInstanceOf(Array);
  });

  it("warns on bunched arrivals and unknown resource kinds", () => {
    const raw = validInput();
    (raw.arrivalProcess as Record<string, unknown>).type = "bunched";
    (raw.resources as Record<string, unknown>[]).push({
      id: "desks",
      kind: "customs-desk",
      count: 2,
      unit: "desks",
    });
    const { warnings } = inputToSimParams(loadSimulationInput(raw));
    expect(warnings.some((w) => w.includes("bunched"))).toBe(true);
    expect(warnings.some((w) => w.includes("customs-desk"))).toBe(true);
  });

  it("warns when approximating a non-lognormal gate family", () => {
    const raw = validInput();
    (
      raw.serviceTimeDistributions as Record<string, Record<string, unknown>>
    ).gateServiceMin = {
      family: "exponential",
      meanMin: 3.6,
      unit: "minutes",
    };
    const { warnings } = inputToSimParams(loadSimulationInput(raw));
    expect(warnings.some((w) => w.includes("exponential"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* HTTP hygiene                                                        */
/* ------------------------------------------------------------------ */

describe("API hygiene", () => {
  it("rate-limits with a token bucket", () => {
    const limiter = new RateLimiter(2, 1);
    expect(limiter.take("k")).toBe(true);
    expect(limiter.take("k")).toBe(true);
    expect(limiter.take("k")).toBe(false);
    // Other keys are unaffected.
    expect(limiter.take("other")).toBe(true);
    // Buckets refill over time.
    const fast = new RateLimiter(1, 1000);
    expect(fast.take("k")).toBe(true);
    expect(fast.take("k")).toBe(false);
    expect(fast.take("k", Date.now() + 5000)).toBe(true);
  });

  it("rejects oversized bodies", () => {
    expectSimError(
      () => assertBodySizeOk(MAX_BODY_BYTES + 1),
      "PAYLOAD_TOO_LARGE"
    );
    expect(() => assertBodySizeOk(MAX_BODY_BYTES)).not.toThrow();
    expect(() => assertBodySizeOk(0)).not.toThrow();
  });

  it("never leaks internals in public errors", () => {
    const pub = toPublicError(
      new SimError("VALIDATION_ERROR", "bad field", { issues: [] })
    );
    expect(pub).toEqual({
      code: "VALIDATION_ERROR",
      message: "bad field",
      details: { issues: [] },
    });
    expect(JSON.stringify(pub)).not.toContain("stack");

    const bug = toPublicError(new Error("secret connection string xyz"));
    expect(bug.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(bug)).not.toContain("xyz");
    expect(JSON.stringify(bug)).not.toContain("stack");
  });

  it("maps error codes to HTTP statuses", () => {
    const { status, body } = toErrorResponse(
      new SimError("FORBIDDEN", "nope")
    );
    expect(status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
    const internal = toErrorResponse(new Error("boom"));
    expect(internal.status).toBe(500);
  });
});
