/**
 * Phase C — auth/RBAC adapter for decision approvals.
 *
 * Marking a scenario output `approved-for-decision` requires the
 * `approver` role (admins inherit it). Everything else — running
 * simulations, reading outputs, loading scenarios — is unauthenticated
 * in this phase, per the minimum-necessary doctrine.
 *
 * `AuthProvider` is the interface a REAL provider must implement: it
 * answers "who is calling and what roles do they hold" from the app's
 * session layer (NextAuth, Clerk, OIDC, …). The adapter never sees
 * passwords or tokens — role claims only.
 *
 * `DevMockAuthProvider` is a clearly-labeled fake for tests and local
 * development. It must never be wired into production; `assertNotDev`
 * throws if anyone tries.
 */

import { SimError } from "./errors";
import { auditStore } from "./audit";
import type { SimulationOutput } from "./contracts";

export type Role = "viewer" | "analyst" | "approver" | "admin";

/** Authenticated identity as seen by the adapter. */
export interface Identity {
  id: string;
  roles: Role[];
}

/**
 * Contract for a real auth provider. Implementations resolve the
 * caller's identity from the request's session (never from
 * caller-supplied role claims).
 */
export interface AuthProvider {
  /** The calling user, or null when unauthenticated. */
  getCurrentUser(): Identity | null;
  /** Convenience: does the current user hold `role`? */
  hasRole(role: Role): boolean;
}

/**
 * DEV-ONLY mock provider. Construct with the roles the fake user holds.
 * Labelled loudly so it cannot be mistaken for real auth.
 */
export class DevMockAuthProvider implements AuthProvider {
  readonly devOnly = true as const;
  private readonly identity: Identity;

  constructor(userId: string, roles: Role[]) {
    this.identity = { id: userId, roles: [...roles] };
  }

  getCurrentUser(): Identity {
    return { ...this.identity, roles: [...this.identity.roles] };
  }

  hasRole(role: Role): boolean {
    return this.identity.roles.includes(role);
  }
}

/** Refuse to run approval checks against the dev mock in production. */
export function assertNotDev(provider: AuthProvider): void {
  if (provider instanceof DevMockAuthProvider) {
    throw new SimError(
      "FORBIDDEN",
      "DevMockAuthProvider is DEV-ONLY and must never authorize production approvals."
    );
  }
}

/** Record of an approved-for-decision output. */
export interface ApprovalRecord {
  scenarioId: string;
  inputHash: string;
  approvedBy: string;
  approvedAtUtc: string;
  role: Role;
}

/** In-memory approval registry (DEMO-ONLY, like the audit store). */
const approvals = new Map<string, ApprovalRecord>();

/**
 * Mark a scenario output as approved-for-decision. Requires the
 * `approver` role (or `admin`, which inherits all roles). Denials throw
 * a structured FORBIDDEN error — never a silent no-op, never an
 * exception with internals. Successful approvals are audit-logged.
 *
 * NOTE: `assertNotDev` is deliberately NOT called here — tests exercise
 * this function with the dev mock. Production wiring must call
 * `assertNotDev(auth)` before delegating to this function.
 */
export function approveForDecision(
  output: SimulationOutput,
  auth: AuthProvider
): ApprovalRecord {
  const user = auth.getCurrentUser();
  const canApprove =
    user !== null && (auth.hasRole("approver") || auth.hasRole("admin"));

  if (!canApprove || user === null) {
    throw new SimError(
      "FORBIDDEN",
      `Approval denied: marking an output approved-for-decision requires the "approver" role.`,
      { userId: user?.id ?? null, heldRoles: user?.roles ?? [] }
    );
  }
  // Prefer the explicit approver grant for the record; admin inherits it.
  const role: Role = auth.hasRole("approver") ? "approver" : "admin";

  const record: ApprovalRecord = {
    scenarioId: output.scenarioId,
    inputHash: output.inputHash,
    approvedBy: user.id,
    approvedAtUtc: new Date().toISOString(),
    role,
  };
  approvals.set(output.inputHash, record);

  auditStore.record({
    eventType: "scenario.output.approved",
    scenarioId: output.scenarioId,
    inputHash: output.inputHash,
    seed: null, // approvals are not runs; seed is not applicable
    actor: user.id,
    atUtc: record.approvedAtUtc,
    kpiSummary: {
      throughputTrucksPerHour: output.kpis.throughputTrucksPerHour,
      meanWaitMin: output.kpis.meanWaitMin,
      p95WaitMin: output.kpis.p95WaitMin,
      utilizationGatePct: output.kpis.utilizationPct.gate,
    },
    approvedBy: user.id,
  });

  return { ...record };
}

/** Look up the approval for an output hash, if any. */
export function getApproval(inputHash: string): ApprovalRecord | null {
  const found = approvals.get(inputHash);
  return found ? { ...found } : null;
}

/** Test/dev escape hatch for the approval registry. */
export function clearApprovals(): void {
  approvals.clear();
}
