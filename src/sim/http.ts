/**
 * Phase C — HTTP API hygiene helpers.
 *
 * The repo currently exposes no API routes (the app is a client-side
 * Next.js page), so these helpers document and enforce the standard any
 * future route must meet:
 *  - per-key token-bucket rate limiting (`RateLimiter`),
 *  - request body size limits (`assertBodySizeOk`),
 *  - error responses reduced to `{ code, message }` via `toPublicError`
 *    — stack traces and internals never reach the client.
 *
 * All state is in-memory and labeled DEMO-ONLY, like the idempotency
 * cache: a multi-instance deployment needs a shared store (Redis, …).
 */

import { SimError, toPublicError, type PublicError } from "./errors";

/**
 * Token-bucket rate limiter (in-memory, DEMO-ONLY).
 *
 * `take(key)` returns true when the request is allowed, false when the
 * caller is over budget. Buckets refill continuously at
 * `refillPerSecond` tokens up to `capacity`.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number
  ) {
    if (!(capacity > 0) || !(refillPerSecond > 0)) {
      throw new SimError(
        "INTERNAL_ERROR",
        "RateLimiter requires a positive capacity and refill rate."
      );
    }
  }

  take(key: string, nowMs = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      at: nowMs,
    };
    const elapsedSec = Math.max(0, (nowMs - bucket.at) / 1000);
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsedSec * this.refillPerSecond
    );
    bucket.at = nowMs;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  /** Test/dev escape hatch. */
  clear(): void {
    this.buckets.clear();
  }
}

/** Default body-size budget for scenario payloads: 1 MiB. */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Reject oversized request bodies before parsing. `byteLength` is the
 * decoded body size in bytes. Throws PAYLOAD_TOO_LARGE naming the
 * limit — never echoes the body.
 */
export function assertBodySizeOk(
  byteLength: number,
  maxBytes = MAX_BODY_BYTES
): void {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new SimError("VALIDATION_ERROR", "Unmeasurable request body size.");
  }
  if (byteLength > maxBytes) {
    throw new SimError(
      "PAYLOAD_TOO_LARGE",
      `Request body of ${byteLength} bytes exceeds the ${maxBytes}-byte limit.`,
      { maxBytes }
    );
  }
}

/**
 * Build a safe JSON error response body from any thrown value.
 * Returns `{ status, body }`; the body never contains a stack trace.
 */
export function toErrorResponse(
  err: unknown,
  onInternalError?: (err: unknown) => void
): { status: number; body: PublicError } {
  const body = toPublicError(err, onInternalError);
  const status = err instanceof SimError ? err.statusCode : 500;
  return { status, body };
}
