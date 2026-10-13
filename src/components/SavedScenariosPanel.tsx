"use client";

import { useEffect, useState } from "react";
import type { Disruptions, SimParams } from "@/sim";
import {
  deleteScenario,
  loadSavedScenarios,
  saveScenario,
  type SavedScenario,
} from "@/sim";

interface SavedScenariosPanelProps {
  params: SimParams;
  disruptions: Disruptions;
  onLoad: (params: SimParams, disruptions: Disruptions) => void;
  disabled?: boolean;
}

export default function SavedScenariosPanel({
  params,
  disruptions,
  onLoad,
  disabled = false,
}: SavedScenariosPanelProps) {
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSaved(loadSavedScenarios());
  }, []);

  const flash = (text: string) => {
    setMessage(text);
    setError(null);
    window.setTimeout(() => setMessage(null), 3500);
  };

  const handleSave = () => {
    try {
      const next = saveScenario(name, params, disruptions);
      setSaved(next);
      setName("");
      flash(`Saved “${name.trim()}” (${next.length} stored)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save scenario");
    }
  };

  const handleLoad = (entry: SavedScenario) => {
    onLoad(
      JSON.parse(JSON.stringify(entry.params)) as SimParams,
      JSON.parse(JSON.stringify(entry.disruptions)) as Disruptions
    );
    flash(`Loaded “${entry.name}”`);
  };

  const handleDelete = (entry: SavedScenario) => {
    setSaved(deleteScenario(entry.name));
    flash(`Deleted “${entry.name}”`);
  };

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Saved scenarios</h2>
        <p className="mt-0.5 text-[11px] leading-snug text-mist">
          Name the current setup — every slider, toggle, and disruption —
          and reload it later. Stored in this browser only.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          className="num-input min-w-0 flex-1"
          placeholder="e.g. TAS + crane breakdown"
          value={name}
          maxLength={60}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          aria-label="Scenario name"
        />
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={disabled || name.trim().length === 0}
          onClick={handleSave}
        >
          Save current
        </button>
      </div>

      {message && (
        <p className="rounded-lg border border-signal/40 bg-signal/10 px-3 py-2 text-xs text-signal">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-xs text-coral">
          {error}
        </p>
      )}

      {saved.length === 0 ? (
        <p className="text-xs text-mist">
          No saved scenarios yet. Build one in the sandbox, then save it here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {saved.map((entry) => (
            <li
              key={entry.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">
                  {entry.name}
                </p>
                <p className="text-[11px] text-mist">
                  Saved{" "}
                  {new Date(entry.savedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  · {entry.params.trucksPerDay.toLocaleString()} trucks/day ·{" "}
                  {entry.params.numGates} gates
                  {(() => {
                    const d = entry.disruptions;
                    const active = d
                      ? [
                          d.craneBreakdown.enabled,
                          d.vesselBunching.enabled,
                          d.gateClosure.enabled,
                          d.weatherSlowdown.enabled,
                        ].filter(Boolean).length
                      : 0;
                    return active > 0
                      ? ` · ${active} disruption${active > 1 ? "s" : ""}`
                      : "";
                  })()}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="btn-ghost px-2.5 py-1 text-xs"
                  disabled={disabled}
                  onClick={() => handleLoad(entry)}
                >
                  Load
                </button>
                <button
                  type="button"
                  className="btn-ghost px-2.5 py-1 text-xs text-coral hover:text-coral"
                  disabled={disabled}
                  onClick={() => handleDelete(entry)}
                  aria-label={`Delete ${entry.name}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
