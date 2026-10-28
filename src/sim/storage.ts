/**
 * Saved scenarios: named, full-parameter scenario presets persisted in
 * localStorage so a buyer can build a scenario once and reload it later.
 *
 * Storage is injectable (a `StorageLike` backend) so tests can pass an
 * in-memory map and the app can fall back gracefully when localStorage is
 * unavailable (private mode, SSR). Corrupt or wrong-shaped stored data is
 * ignored — `loadSavedScenarios` never throws.
 */

import type { Disruptions } from "./disruptions";
import type { SimParams } from "./types";
import {
  SCENARIO_SCHEMA_VERSION,
  validateScenarioEntry,
} from "./validate";

/** Minimal storage surface (subset of the DOM Storage interface). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A named scenario: full params snapshot + when it was saved. */
export interface SavedScenario {
  name: string;
  savedAt: string; // ISO timestamp
  /** Schema version of the stored params (see validate.ts). */
  version: number;
  params: SimParams;
  disruptions: Disruptions;
}

export const STORAGE_KEY = "porttwin.savedScenarios.v1";
export const MAX_SAVED_SCENARIOS = 20;

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Default backend: browser localStorage when available, else in-memory. */
export function defaultStorage(): StorageLike {
  try {
    if (
      typeof globalThis !== "undefined" &&
      "localStorage" in globalThis &&
      globalThis.localStorage
    ) {
      const probe = "__porttwin_probe__";
      globalThis.localStorage.setItem(probe, "1");
      globalThis.localStorage.removeItem(probe);
      return globalThis.localStorage as StorageLike;
    }
  } catch {
    // Private mode / blocked storage → fall through to memory.
  }
  return new MemoryStorage();
}

/** Load all saved scenarios (newest first). Never throws.
 *
 * Every entry is fully validated (types, ranges, schema version) before
 * it is returned: a corrupt, hand-edited, or stale localStorage payload
 * can never reach the engine. Invalid entries are silently dropped.
 */
export function loadSavedScenarios(
  storage: StorageLike = defaultStorage()
): SavedScenario[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: SavedScenario[] = [];
    for (const entry of parsed) {
      const valid = validateScenarioEntry(entry);
      if (valid) out.push(valid);
    }
    return out;
  } catch {
    return [];
  }
}

function persist(storage: StorageLike, list: SavedScenario[]): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED_SCENARIOS)));
}

/**
 * Save (or overwrite) a scenario by name. Names are trimmed; empty names
 * are rejected. Returns the updated list, newest first.
 */
export function saveScenario(
  name: string,
  params: SimParams,
  disruptions: Disruptions,
  storage: StorageLike = defaultStorage()
): SavedScenario[] {
  const cleanName = name.trim();
  if (cleanName.length === 0) {
    throw new Error("Scenario name must not be empty");
  }
  if (cleanName.length > 60) {
    throw new Error("Scenario name must be at most 60 characters");
  }
  const list = loadSavedScenarios(storage).filter((s) => s.name !== cleanName);
  const entry: SavedScenario = {
    name: cleanName,
    savedAt: new Date().toISOString(),
    version: SCENARIO_SCHEMA_VERSION,
    params: JSON.parse(JSON.stringify(params)) as SimParams,
    disruptions: JSON.parse(JSON.stringify(disruptions)) as Disruptions,
  };
  const next = [entry, ...list];
  persist(storage, next);
  return next;
}

/** Delete a scenario by name. Returns the updated list. */
export function deleteScenario(
  name: string,
  storage: StorageLike = defaultStorage()
): SavedScenario[] {
  const next = loadSavedScenarios(storage).filter((s) => s.name !== name);
  persist(storage, next);
  return next;
}
