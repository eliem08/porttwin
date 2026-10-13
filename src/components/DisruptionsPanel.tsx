"use client";

import type { Disruptions } from "@/sim";

interface DisruptionsPanelProps {
  disruptions: Disruptions;
  onChange: (next: Disruptions) => void;
  disabled?: boolean;
}

function NumInput({
  label,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-mist">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          className="num-input w-16"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        {suffix ? <span className="text-[10px]">{suffix}</span> : null}
      </span>
    </label>
  );
}

function Toggle({
  checked,
  disabled,
  onToggle,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed ${
        checked
          ? "border-sky-400/60 bg-sky-500"
          : "border-white/15 bg-white/10"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[19px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

export default function DisruptionsPanel({
  disruptions,
  onChange,
  disabled = false,
}: DisruptionsPanelProps) {
  const patch = <K extends keyof Disruptions>(
    key: K,
    value: Partial<Disruptions[K]>
  ) => {
    onChange({
      ...disruptions,
      [key]: { ...disruptions[key], ...value },
    });
  };

  const cards = [
    {
      key: "craneBreakdown" as const,
      title: "Crane breakdown",
      desc: "One yard crane out of service — yard capacity drops.",
      enabled: disruptions.craneBreakdown.enabled,
      onToggle: () =>
        patch("craneBreakdown", { enabled: !disruptions.craneBreakdown.enabled }),
      controls: (
        <>
          <NumInput
            label="Crane #"
            value={disruptions.craneBreakdown.craneIndex + 1}
            min={1}
            max={12}
            step={1}
            disabled={disabled}
            onChange={(v) => patch("craneBreakdown", { craneIndex: v - 1 })}
          />
          <NumInput
            label="Starts at"
            value={disruptions.craneBreakdown.startHour}
            min={0}
            max={23}
            step={1}
            suffix=":00"
            disabled={disabled}
            onChange={(v) => patch("craneBreakdown", { startHour: v })}
          />
          <NumInput
            label="Down for"
            value={disruptions.craneBreakdown.durationHours}
            min={1}
            max={24}
            step={1}
            suffix="h"
            disabled={disabled}
            onChange={(v) => patch("craneBreakdown", { durationHours: v })}
          />
        </>
      ),
    },
    {
      key: "vesselBunching" as const,
      title: "Vessel bunching",
      desc: "2–3 vessels on one tide: a burst of extra trucks.",
      enabled: disruptions.vesselBunching.enabled,
      onToggle: () =>
        patch("vesselBunching", { enabled: !disruptions.vesselBunching.enabled }),
      controls: (
        <>
          <NumInput
            label="Extra trucks"
            value={disruptions.vesselBunching.extraTrucks}
            min={50}
            max={1500}
            step={50}
            disabled={disabled}
            onChange={(v) => patch("vesselBunching", { extraTrucks: v })}
          />
          <NumInput
            label="Window starts"
            value={disruptions.vesselBunching.windowStartHour}
            min={0}
            max={22}
            step={1}
            suffix=":00"
            disabled={disabled}
            onChange={(v) => patch("vesselBunching", { windowStartHour: v })}
          />
          <NumInput
            label="Window length"
            value={disruptions.vesselBunching.windowHours}
            min={1}
            max={8}
            step={0.5}
            suffix="h"
            disabled={disabled}
            onChange={(v) => patch("vesselBunching", { windowHours: v })}
          />
        </>
      ),
    },
    {
      key: "gateClosure" as const,
      title: "Gate closure",
      desc: "One gate lane closed for a full shift.",
      enabled: disruptions.gateClosure.enabled,
      onToggle: () =>
        patch("gateClosure", { enabled: !disruptions.gateClosure.enabled }),
      controls: (
        <>
          <NumInput
            label="Gate #"
            value={disruptions.gateClosure.gateIndex + 1}
            min={1}
            max={4}
            step={1}
            disabled={disabled}
            onChange={(v) => patch("gateClosure", { gateIndex: v - 1 })}
          />
          <NumInput
            label="Starts at"
            value={disruptions.gateClosure.startHour}
            min={0}
            max={23}
            step={1}
            suffix=":00"
            disabled={disabled}
            onChange={(v) => patch("gateClosure", { startHour: v })}
          />
          <NumInput
            label="Closed for"
            value={disruptions.gateClosure.durationHours}
            min={1}
            max={24}
            step={1}
            suffix="h"
            disabled={disabled}
            onChange={(v) => patch("gateClosure", { durationHours: v })}
          />
        </>
      ),
    },
    {
      key: "weatherSlowdown" as const,
      title: "Weather slowdown",
      desc: "Rain / wind cuts yard productivity for a window.",
      enabled: disruptions.weatherSlowdown.enabled,
      onToggle: () =>
        patch("weatherSlowdown", {
          enabled: !disruptions.weatherSlowdown.enabled,
        }),
      controls: (
        <>
          <NumInput
            label="Productivity drop"
            value={Math.round(
              (1 - disruptions.weatherSlowdown.productivityFactor) * 100
            )}
            min={5}
            max={50}
            step={5}
            suffix="%"
            disabled={disabled}
            onChange={(v) =>
              patch("weatherSlowdown", { productivityFactor: 1 - v / 100 })
            }
          />
          <NumInput
            label="Starts at"
            value={disruptions.weatherSlowdown.startHour}
            min={0}
            max={23}
            step={1}
            suffix=":00"
            disabled={disabled}
            onChange={(v) => patch("weatherSlowdown", { startHour: v })}
          />
          <NumInput
            label="Lasts"
            value={disruptions.weatherSlowdown.durationHours}
            min={1}
            max={24}
            step={1}
            suffix="h"
            disabled={disabled}
            onChange={(v) => patch("weatherSlowdown", { durationHours: v })}
          />
        </>
      ),
    },
  ];

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Disruption scenarios</h2>
        <span className="chip">Combinable</span>
      </div>
      <p className="-mt-2 text-[11px] leading-snug text-mist">
        Stress-test the port: switch on any combination and watch KPIs and
        costs move. Same engine, same seed family.
      </p>
      <div className="flex flex-col gap-3">
        {cards.map((card) => (
          <div
            key={card.key}
            className={`rounded-xl border p-3 transition-colors ${
              card.enabled
                ? "border-coral/40 bg-coral/[0.04]"
                : "border-white/10 bg-white/[0.02]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">{card.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-mist">
                  {card.desc}
                </p>
              </div>
              <Toggle
                checked={card.enabled}
                disabled={disabled}
                onToggle={card.onToggle}
                label={card.title}
              />
            </div>
            {card.enabled && (
              <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
                {card.controls}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
