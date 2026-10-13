"use client";

import { useState } from "react";
import type { CostBreakdown, CostRates, MonteCarloResult, SimResult } from "@/sim";
import {
  buildExportJson,
  buildKpiCsv,
  buildSeriesCsv,
  download,
  exportStem,
  type ExportBundle,
} from "@/sim";

interface ExportBarProps {
  current: SimResult;
  baseline: SimResult;
  scenarioLabel: string;
  rates: CostRates;
  costs: CostBreakdown;
  monteCarlo: MonteCarloResult | null;
  disabled?: boolean;
}

export default function ExportBar({
  current,
  baseline,
  scenarioLabel,
  rates,
  costs,
  monteCarlo,
  disabled = false,
}: ExportBarProps) {
  const [message, setMessage] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 3000);
  };

  const exportCsv = () => {
    const stem = exportStem(scenarioLabel);
    download(`${stem}-series.csv`, buildSeriesCsv(current), "text/csv");
    flash("Downloaded time-series CSV");
  };

  const exportKpiCsv = () => {
    const stem = exportStem(scenarioLabel);
    download(`${stem}-kpis.csv`, buildKpiCsv(current, baseline), "text/csv");
    flash("Downloaded KPI comparison CSV");
  };

  const exportJson = () => {
    const stem = exportStem(scenarioLabel);
    const bundle: ExportBundle = {
      exportedAt: new Date().toISOString(),
      app: "porttwin",
      params: current.params,
      disruptions: current.params.disruptions,
      kpis: current.kpis,
      waitSamplesMin: current.waitSamplesMin,
      costs: { rates, breakdown: costs },
      monteCarlo: monteCarlo
        ? {
            replications: monteCarlo.replications,
            baseSeed: monteCarlo.baseSeed,
            summaries: monteCarlo.summaries,
          }
        : null,
      series: current.series,
    };
    download(`${stem}.json`, buildExportJson(bundle), "application/json");
    flash("Downloaded full result JSON");
  };

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Export results</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-mist">
            Take the numbers with you — reproducible bundle with params,
            KPIs, costs, and Monte Carlo bands.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={disabled}
            onClick={exportCsv}
          >
            CSV · time series
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={disabled}
            onClick={exportKpiCsv}
          >
            CSV · KPIs vs crisis
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={disabled}
            onClick={exportJson}
          >
            JSON · full bundle
          </button>
        </div>
      </div>
      {message && (
        <p className="text-xs text-signal" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
