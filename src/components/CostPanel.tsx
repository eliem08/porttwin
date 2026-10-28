"use client";

import type { CostBreakdown, CostRates } from "@/sim";

interface CostPanelProps {
  current: CostBreakdown;
  baseline: CostBreakdown;
  rates: CostRates;
  onRatesChange: (next: CostRates) => void;
  disabled?: boolean;
}

function fmt(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function deltaFmt(delta: number): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return `${sign}${fmt(Math.abs(delta))}`;
}

const RATE_FIELDS: Array<{
  key: keyof CostRates;
  label: string;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
}> = [
  {
    key: "demurragePerTruckHour",
    label: "Demurrage rate",
    min: 0,
    max: 500,
    step: 5,
    prefix: "$",
    suffix: "/truck-h",
  },
  {
    key: "demurrageFreeHours",
    label: "Free waiting allowance",
    min: 0,
    max: 12,
    step: 0.5,
    suffix: "h",
  },
  {
    key: "truckWaitingPerHour",
    label: "Truck waiting rate",
    min: 0,
    max: 200,
    step: 5,
    prefix: "$",
    suffix: "/truck-h",
  },
  {
    key: "fuelLitersPerIdleHour",
    label: "Idle fuel burn",
    min: 0,
    max: 10,
    step: 0.1,
    suffix: "L/h",
  },
  {
    key: "fuelPricePerLiter",
    label: "Diesel price",
    min: 0,
    max: 3,
    step: 0.05,
    prefix: "$",
    suffix: "/L",
  },
  {
    key: "craneCostPerHour",
    label: "Crane rate",
    min: 0,
    max: 600,
    step: 10,
    prefix: "$",
    suffix: "/crane-h",
  },
  {
    key: "carbonPricePerTonne",
    label: "Carbon price",
    min: 0,
    max: 300,
    step: 5,
    prefix: "$",
    suffix: "/t CO₂",
  },
];

export default function CostPanel({
  current,
  baseline,
  rates,
  onRatesChange,
  disabled = false,
}: CostPanelProps) {
  const delta = current.total - baseline.total;
  const saving = delta < 0;

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Cost model</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-mist">
            Estimated daily cost of this scenario. Rates are illustrative
            defaults — plug in real tariffs.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="kpi-num text-2xl font-semibold tabular-nums text-white">
            {fmt(current.total)}
          </p>
          <p className="text-[11px] text-mist">per modelled day</p>
          <p
            className={`mt-1 text-[11px] font-semibold tabular-nums ${
              saving ? "text-signal" : "text-coral"
            }`}
            title="Change vs crisis baseline"
          >
            {deltaFmt(delta)} vs crisis
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[300px] text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-mist">
              <th className="py-2 pr-2 font-medium">Line item</th>
              <th className="py-2 pr-2 text-right font-medium">This scenario</th>
              <th className="py-2 text-right font-medium">Crisis</th>
            </tr>
          </thead>
          <tbody>
            {current.items.map((item) => {
              const base =
                baseline.items.find((b) => b.key === item.key)?.amount ?? 0;
              return (
                <tr key={item.key} className="border-b border-white/5">
                  <td className="py-2 pr-2">
                    <span
                      className="block font-medium text-white"
                      title={`Measured: ${item.provenance.measured}. Assumed: ${item.provenance.assumed}.`}
                    >
                      {item.label}
                    </span>
                    <span className="block text-[11px] text-mist">
                      {item.detail}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right font-semibold tabular-nums text-white">
                    {fmt(item.amount)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-mist">
                    {fmt(base)}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td className="py-2 pr-2 font-semibold text-white">Total</td>
              <td className="py-2 pr-2 text-right font-semibold tabular-nums text-white">
                {fmt(current.total)}
              </td>
              <td className="py-2 text-right font-semibold tabular-nums text-mist">
                {fmt(baseline.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-signal hover:text-white">
          Edit rates
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {RATE_FIELDS.map((field) => (
            <label
              key={field.key}
              className="flex items-center justify-between gap-2 text-xs text-mist"
            >
              <span>{field.label}</span>
              <span className="flex items-center gap-1">
                {field.prefix ? (
                  <span className="text-[10px]">{field.prefix}</span>
                ) : null}
                <input
                  type="number"
                  className="num-input w-16"
                  value={rates[field.key]}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  disabled={disabled}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      onRatesChange({
                        ...rates,
                        [field.key]: Math.min(
                          field.max,
                          Math.max(field.min, v)
                        ),
                      });
                    }
                  }}
                />
                {field.suffix ? (
                  <span className="text-[10px]">{field.suffix}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </details>

      <p className="border-t border-white/10 pt-3 text-[11px] leading-snug text-mist">
        Demurrage is a truck-hour proxy (this twin is landside; vessels are
        not simulated). Quantities are <span className="text-white">measured from the simulation</span>;
        every rate is an <span className="text-white">illustrative assumption</span> —
        hover a line item for the split, and edit the rates before quoting
        numbers. See README for what the cost model covers.
      </p>
    </div>
  );
}
