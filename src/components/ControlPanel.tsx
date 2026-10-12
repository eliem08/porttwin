"use client";

import { useMemo } from "react";
import type { SimParams } from "@/sim";
import { PARAM_META } from "@/sim";

interface ControlPanelProps {
  params: SimParams;
  onChange: (patch: Partial<SimParams>) => void;
  onReset: () => void;
  disabled?: boolean;
}

type ParamMeta = (typeof PARAM_META)[number];
type ParamKey = keyof SimParams;

/** Sliders that only make sense while the appointment system is enabled. */
const APPOINTMENT_DEPENDENT_KEYS: ReadonlySet<string> = new Set([
  "appointmentShare",
  "noShowRate",
]);

const APPOINTMENT_HINT = "Enable the appointment system first";

function formatValue(value: number, unit: string): string {
  switch (unit) {
    case "%":
      return `${Math.round(value * 100)}%`;
    case ":00":
      return value === 24 ? "24h (night gate)" : `${value}:00`;
    case "/day":
      return `${value.toLocaleString()}/day`;
    case " min":
      return `${value.toFixed(1)} min`;
    case "×":
      return `${value.toFixed(1)}×`;
    default:
      return `${Math.round(value)}`;
  }
}

function patchFor(key: string, value: number | boolean): Partial<SimParams> {
  return { [key]: value } as Partial<SimParams>;
}

function isToggleMeta(meta: ParamMeta): boolean {
  return meta.step === 1 && meta.min === 0 && meta.max === 1;
}

export default function ControlPanel({
  params,
  onChange,
  onReset,
  disabled = false,
}: ControlPanelProps) {
  const groups = useMemo<Array<[string, ParamMeta[]]>>(() => {
    const buckets = new Map<string, ParamMeta[]>();
    for (const meta of PARAM_META) {
      const bucket = buckets.get(meta.group);
      if (bucket) bucket.push(meta);
      else buckets.set(meta.group, [meta]);
    }
    return Array.from(buckets.entries());
  }, []);

  const appointmentSystemOn = Boolean(params.appointmentSystem);

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Scenario controls</h2>
        <button
          type="button"
          onClick={onReset}
          disabled={disabled}
          className="btn-ghost px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map(([group, metas]) => (
          <section key={group} className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-mist">
              {group}
            </h3>

            <div className="flex flex-col gap-3">
              {metas.map((meta) => {
                const key = meta.key as ParamKey;
                const raw = params[key];
                const numeric = typeof raw === "number" ? raw : 0;
                const toggle = isToggleMeta(meta);
                const gated =
                  APPOINTMENT_DEPENDENT_KEYS.has(meta.key) && !appointmentSystemOn;
                const isDisabled = disabled || gated;
                const inputId = `param-${meta.key}`;
                const labelId = `${inputId}-label`;
                const formatted = formatValue(numeric, meta.unit ?? "");
                const checked = Boolean(raw);
                const title = gated ? APPOINTMENT_HINT : undefined;

                return (
                  <div
                    key={meta.key}
                    title={title}
                    className={gated ? "opacity-50" : undefined}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {toggle ? (
                          <span
                            id={labelId}
                            className="block text-xs font-medium text-white"
                          >
                            {meta.label}
                          </span>
                        ) : (
                          <label
                            id={labelId}
                            htmlFor={inputId}
                            className="block text-xs font-medium text-white"
                          >
                            {meta.label}
                          </label>
                        )}
                        <p className="mt-0.5 text-[11px] leading-snug text-mist">
                          {meta.hint}
                        </p>
                      </div>

                      {toggle ? (
                        <button
                          id={inputId}
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          aria-labelledby={labelId}
                          disabled={isDisabled}
                          title={title}
                          onClick={() => onChange(patchFor(meta.key, !checked))}
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
                      ) : (
                        <span className="mt-0.5 shrink-0 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                          {formatted}
                        </span>
                      )}
                    </div>

                    {!toggle && (
                      <input
                        id={inputId}
                        type="range"
                        min={meta.min}
                        max={meta.max}
                        step={meta.step}
                        value={numeric}
                        disabled={isDisabled}
                        title={title}
                        aria-labelledby={labelId}
                        aria-valuetext={formatted}
                        onChange={(event) =>
                          onChange(patchFor(meta.key, Number(event.target.value)))
                        }
                        className="mt-2 w-full disabled:cursor-not-allowed"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <p className="border-t border-white/10 pt-3 text-[11px] leading-snug text-mist">
        Changes re-run the simulation instantly (seeded &amp; deterministic).
      </p>
    </div>
  );
}
