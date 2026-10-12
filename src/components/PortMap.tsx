"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Snapshot } from "@/sim";

/* ------------------------------------------------------------------ */
/* Public helper                                                       */
/* ------------------------------------------------------------------ */

export function formatClock(min: number): string {
  const safe = Number.isFinite(min) ? Math.round(min) : 0;
  const wrapped = ((safe % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface PortMapProps {
  series: Snapshot[];
}

interface Metrics {
  t: number;
  gateQueue: number;
  gatesBusy: number;
  gatesTotal: number;
  yardQueue: number;
  yardBusy: number;
  berthQueue: number;
  berthsBusy: number;
  completedTeu: number;
}

const SPEEDS = [1, 4, 16] as const;
type Speed = (typeof SPEEDS)[number];

/* ------------------------------------------------------------------ */
/* Geometry constants                                                  */
/* ------------------------------------------------------------------ */

const VIEW_W = 920;
const VIEW_H = 560;

const QUEUE_CAP = 36;
const QUEUE_COLS = 12;
const QUEUE_X0 = 30;
const QUEUE_Y0 = 58;
const QUEUE_DX = 26;
const QUEUE_DY = 34;

const STACK_CAP = 60;
const STACKS_PER_CRANE = 20;
const YARD_TRUCK_CAP = 12;
const BERTH_QUEUE_CAP = 12;

const CRANE_X: readonly number[] = [60, 260, 460];
const CRANE_W = 150;
const BERTH_X: readonly number[] = [60, 260, 460];
const BERTH_W = 150;

const GATE_LANES: readonly number[] = [54, 94, 134];

const WAVES: readonly { y: number; amp: number; period: number }[] = [
  { y: 494, amp: 5, period: 64 },
  { y: 516, amp: 6, period: 78 },
  { y: 538, amp: 4, period: 56 },
];

const EMPTY_METRICS: Metrics = {
  t: 0,
  gateQueue: 0,
  gatesBusy: 0,
  gatesTotal: 3,
  yardQueue: 0,
  yardBusy: 0,
  berthQueue: 0,
  berthsBusy: 0,
  completedTeu: 0,
};

/* ------------------------------------------------------------------ */
/* Deterministic helpers                                               */
/* ------------------------------------------------------------------ */

/** Deterministic pseudo-random value in [0, 1) — no Math.random in render. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function queueSlot(i: number): { x: number; y: number } {
  const row = Math.floor(i / QUEUE_COLS);
  const col = i % QUEUE_COLS;
  const snaked = row % 2 === 0 ? col : QUEUE_COLS - 1 - col;
  const jitterX = (hash(i * 3 + 1) - 0.5) * 3;
  const jitterY = (hash(i * 3 + 2) - 0.5) * 3;
  return {
    x: QUEUE_X0 + snaked * QUEUE_DX + jitterX,
    y: QUEUE_Y0 + row * QUEUE_DY + jitterY,
  };
}

function wavePath(y: number, amp: number, period: number, width: number): string {
  let d = `M 0 ${y}`;
  for (let x = 0; x < width; x += period) {
    d += ` q ${period / 2} ${-amp} ${period} 0`;
  }
  return d;
}

function readNumber(source: Snapshot, keys: readonly string[], fallback = 0): number {
  const record = source as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function metricsOf(snapshot: Snapshot): Metrics {
  return {
    t: readNumber(snapshot, ["t", "minute", "minutes", "time", "clock"], 0),
    gateQueue: readNumber(snapshot, ["gateQueue", "gate_queue", "queueGate", "trucksQueued"]),
    gatesBusy: readNumber(snapshot, ["gatesBusy", "gateBusy", "busyGates", "gatesInService"]),
    gatesTotal: readNumber(snapshot, ["gatesTotal", "totalGates", "gateCount"], 3),
    yardQueue: readNumber(snapshot, ["yardQueue", "yard_queue", "queueYard"]),
    yardBusy: readNumber(snapshot, ["yardBusy", "yard_busy", "busyYard"]),
    berthQueue: readNumber(snapshot, ["berthQueue", "berth_queue", "queueBerth", "vesselsWaiting"]),
    berthsBusy: readNumber(snapshot, ["berthsBusy", "berthBusy", "busyBerths", "berthsInService"]),
    completedTeu: readNumber(snapshot, ["completedTeu", "teuCompleted", "completedTEU", "teu"]),
  };
}

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  return Math.min(Math.max(rounded, min), max);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function PortMap({ series }: PortMapProps) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const gridId = `pt-grid-${uid}`;
  const clipId = `pt-clip-${uid}`;
  const arrowId = `pt-arrow-${uid}`;

  const count = series.length;

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>(1);
  const [cursor, setCursor] = useState(0);
  const [flash, setFlash] = useState(false);
  const prevCursor = useRef(0);

  useEffect(() => {
    if (!playing || count <= 1) return;
    const id = window.setInterval(() => {
      setCursor((c) => (c + 1) % count);
    }, 500 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, count]);

  useEffect(() => {
    setCursor((c) => (count === 0 ? 0 : Math.min(c, count - 1)));
  }, [count]);

  useEffect(() => {
    const wrapped = cursor === 0 && prevCursor.current !== 0;
    prevCursor.current = cursor;
    if (!wrapped) return;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 420);
    return () => window.clearTimeout(id);
  }, [cursor]);

  const index = count === 0 ? 0 : Math.min(cursor, count - 1);
  const snapshot = count > 0 ? series[index] : undefined;
  const m = useMemo<Metrics>(() => (snapshot ? metricsOf(snapshot) : EMPTY_METRICS), [snapshot]);

  if (count === 0) {
    return (
      <div className="flex min-h-[280px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-line/60 bg-abyss/60 p-8 text-center">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.24em] text-mist/70">
          Port schematic
        </p>
        <p className="max-w-sm text-sm text-mist/50">
          No simulation samples are available yet. Start the twin to stream gate, yard and berth telemetry.
        </p>
      </div>
    );
  }

  const gatesBusy = clampInt(m.gatesBusy, 0, GATE_LANES.length);
  const queueDots = clampInt(m.gateQueue, 0, QUEUE_CAP);
  const queueOverflow = Math.max(clampInt(m.gateQueue, 0, Number.MAX_SAFE_INTEGER) - QUEUE_CAP, 0);
  const congested = m.gateQueue > 400;
  const stackCount = clampInt(m.yardQueue + m.yardBusy, 0, STACK_CAP);
  const yardTrucks = clampInt(m.yardBusy, 0, YARD_TRUCK_CAP);
  const berthQueueDots = clampInt(m.berthQueue, 0, BERTH_QUEUE_CAP);
  const berthsBusy = clampInt(m.berthsBusy, 0, BERTH_X.length);
  const gateLoad = Math.min(Math.max(m.gateQueue / 600, 0), 1);

  const hudRows: readonly { label: string; value: string }[] = [
    { label: "GATE QUEUE", value: String(clampInt(m.gateQueue, 0, Number.MAX_SAFE_INTEGER)) },
    { label: "GATES BUSY", value: `${gatesBusy}/${GATE_LANES.length}` },
    { label: "YARD QUEUE", value: String(clampInt(m.yardQueue, 0, Number.MAX_SAFE_INTEGER)) },
    { label: "BERTH QUEUE", value: String(clampInt(m.berthQueue, 0, Number.MAX_SAFE_INTEGER)) },
    {
      label: "COMPLETED TEU",
      value: clampInt(m.completedTeu, 0, Number.MAX_SAFE_INTEGER).toLocaleString("en-US"),
    },
  ];

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`Port schematic at ${formatClock(m.t)}. Gate queue ${clampInt(
          m.gateQueue,
          0,
          Number.MAX_SAFE_INTEGER,
        )} trucks, ${gatesBusy} of ${GATE_LANES.length} gates busy, yard queue ${clampInt(
          m.yardQueue,
          0,
          Number.MAX_SAFE_INTEGER,
        )}, berth queue ${clampInt(m.berthQueue, 0, Number.MAX_SAFE_INTEGER)}, ${clampInt(
          m.completedTeu,
          0,
          Number.MAX_SAFE_INTEGER,
        )} TEU completed.`}
        className="h-auto w-full select-none"
      >
        <defs>
          <pattern id={gridId} width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" className="stroke-line" strokeWidth="0.6" opacity="0.4" />
          </pattern>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={VIEW_W} height={VIEW_H} rx="18" />
          </clipPath>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 Z" className="fill-crane" />
          </marker>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {/* ---------------- background ---------------- */}
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} className="fill-abyss" />
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill={`url(#${gridId})`} />

          {/* ---------------- sea ---------------- */}
          <rect x="0" y="470" width={VIEW_W} height="90" className="fill-harbor" opacity="0.35" />
          {WAVES.map((wave, i) => (
            <path
              key={`wave-${i}`}
              d={wavePath(wave.y, wave.amp, wave.period, VIEW_W)}
              fill="none"
              className="stroke-line"
              strokeWidth="1.4"
              opacity="0.45"
            />
          ))}

          {/* ---------------- zone dividers ---------------- */}
          <line
            x1="0"
            y1="186"
            x2={VIEW_W}
            y2="186"
            className="stroke-line"
            strokeWidth="1"
            strokeDasharray="4 8"
            opacity="0.5"
          />
          <line
            x1="0"
            y1="396"
            x2={VIEW_W}
            y2="396"
            className="stroke-line"
            strokeWidth="1"
            strokeDasharray="4 8"
            opacity="0.5"
          />

          {/* ================= TOP · GATE COMPLEX ================= */}
          <text
            x="24"
            y="40"
            className="fill-mist text-[11px] font-semibold"
            letterSpacing="0.18em"
            opacity="0.75"
          >
            GATE COMPLEX
          </text>

          {/* truck queue */}
          {Array.from({ length: queueDots }, (_, i) => {
            const slot = queueSlot(i);
            return (
              <g
                key={`queue-${i}`}
                transform={`translate(${slot.x} ${slot.y})`}
                style={{ transition: "transform 420ms cubic-bezier(0.4,0,0.2,1)" }}
              >
                <rect width="14" height="8" rx="2" className="fill-signal" />
              </g>
            );
          })}

          {queueOverflow > 0 && (
            <text x="30" y="164" className="fill-signal text-[10px] font-semibold" opacity="0.9">
              +{queueOverflow} more waiting
            </text>
          )}

          {congested && (
            <>
              <rect
                x="16"
                y="46"
                width="336"
                height="116"
                rx="14"
                fill="none"
                className="stroke-coral animate-pulse"
                strokeWidth="2"
              />
              <text
                x="24"
                y="178"
                className="fill-coral text-[10px] font-semibold"
                letterSpacing="0.14em"
              >
                CONGESTION ALERT
              </text>
            </>
          )}

          {/* gate lanes */}
          {GATE_LANES.map((laneY, i) => {
            const busy = i < gatesBusy;
            return (
              <g key={`gate-${i}`}>
                <rect
                  x="380"
                  y={laneY}
                  width="260"
                  height="32"
                  rx="8"
                  className={busy ? "fill-crane/10" : "fill-harbor/15"}
                />
                <rect
                  x="380"
                  y={laneY}
                  width="260"
                  height="32"
                  rx="8"
                  fill="none"
                  className={busy ? "stroke-crane" : "stroke-line"}
                  strokeWidth={busy ? 1.6 : 1}
                />
                <rect x="392" y={laneY + 6} width="26" height="20" rx="4" className="fill-harbor" />
                <rect
                  x="396"
                  y={laneY + 10}
                  width="18"
                  height="6"
                  rx="2"
                  className={busy ? "fill-crane" : "fill-line"}
                  opacity="0.8"
                />
                <text
                  x="374"
                  y={laneY + 21}
                  textAnchor="end"
                  className="fill-mist text-[9px] font-semibold"
                  opacity="0.55"
                >
                  G{i + 1}
                </text>
                <g style={{ transition: "opacity 320ms ease" }} opacity={busy ? 1 : 0}>
                  <rect x="616" y={laneY + 4} width="5" height="24" rx="2" className="fill-crane" />
                </g>
                <g style={{ transition: "opacity 320ms ease" }} opacity={busy ? 0 : 1}>
                  <rect x="616" y={laneY + 4} width="24" height="5" rx="2" className="fill-line" />
                </g>
              </g>
            );
          })}

          {/* flow arrows */}
          <path
            d="M 338 110 L 372 110"
            fill="none"
            className="stroke-crane animate-dash"
            strokeWidth="2"
            strokeDasharray="6 6"
            markerEnd={`url(#${arrowId})`}
          />
          <path
            d="M 510 178 L 510 198"
            fill="none"
            className="stroke-crane animate-dash"
            strokeWidth="2"
            strokeDasharray="6 6"
            markerEnd={`url(#${arrowId})`}
          />
          <path
            d="M 510 388 L 510 408"
            fill="none"
            className="stroke-crane animate-dash"
            strokeWidth="2"
            strokeDasharray="6 6"
            markerEnd={`url(#${arrowId})`}
          />

          {/* ================= MIDDLE · YARD ================= */}
          <text
            x="24"
            y="220"
            className="fill-mist text-[11px] font-semibold"
            letterSpacing="0.18em"
            opacity="0.75"
          >
            YARD
          </text>

          {CRANE_X.map((x, ci) => {
            const blockCount = Math.min(Math.max(stackCount - ci * STACKS_PER_CRANE, 0), STACKS_PER_CRANE);
            return (
              <g key={`crane-${ci}`}>
                <rect x={x} y="236" width={CRANE_W} height="8" rx="3" className="fill-crane" opacity="0.85" />
                <rect x={x + 6} y="244" width="6" height="86" rx="2" className="fill-crane" opacity="0.6" />
                <rect
                  x={x + CRANE_W - 12}
                  y="244"
                  width="6"
                  height="86"
                  rx="2"
                  className="fill-crane"
                  opacity="0.6"
                />
                <rect x={x + 58} y="244" width="18" height="10" rx="2" className="fill-crane" opacity="0.9" />

                {Array.from({ length: blockCount }, (_, j) => {
                  const col = j % 5;
                  const row = Math.floor(j / 5);
                  const tone = hash((ci * STACKS_PER_CRANE + j) * 7 + 3);
                  const toneClass =
                    tone < 0.42 ? "fill-crane" : tone < 0.74 ? "fill-signal" : "fill-harbor";
                  return (
                    <rect
                      key={`stack-${ci}-${j}`}
                      x={x + 14 + col * 24}
                      y={258 + row * 12}
                      width="20"
                      height="9"
                      rx="2"
                      className={toneClass}
                      opacity="0.9"
                    />
                  );
                })}
              </g>
            );
          })}

          {/* yard trucks */}
          {Array.from({ length: yardTrucks }, (_, i) => {
            const x = 74 + (i % 6) * 92 + (hash(i * 5 + 11) - 0.5) * 12;
            const y = 314 + Math.floor(i / 6) * 12;
            return (
              <g
                key={`yard-truck-${i}`}
                transform={`translate(${x} ${y})`}
                style={{ transition: "transform 520ms cubic-bezier(0.4,0,0.2,1)" }}
              >
                <circle r="3.5" className="fill-crane" />
              </g>
            );
          })}

          {/* ================= BOTTOM · BERTHS ================= */}
          <text
            x="24"
            y="430"
            className="fill-mist text-[11px] font-semibold"
            letterSpacing="0.18em"
            opacity="0.75"
          >
            BERTHS · SEA
          </text>

          {BERTH_X.map((x, bi) => {
            const busy = bi < berthsBusy;
            return (
              <g key={`berth-${bi}`}>
                <rect x={x} y="444" width={BERTH_W} height="26" rx="4" className="fill-harbor" opacity="0.55" />
                <line
                  x1={x}
                  y1="444"
                  x2={x + BERTH_W}
                  y2="444"
                  className="stroke-line"
                  strokeWidth="1.5"
                  opacity="0.7"
                />
                <text x={x + 8} y="466" className="fill-mist text-[9px] font-semibold" opacity="0.6">
                  B{bi + 1}
                </text>

                {busy ? (
                  <g style={{ transition: "opacity 400ms ease" }} opacity="1">
                    <path
                      d={`M ${x + 6} 486 L ${x + BERTH_W - 6} 486 L ${x + BERTH_W - 24} 518 L ${x + 24} 518 Z`}
                      className="fill-harbor"
                      opacity="0.95"
                    />
                    <path
                      d={`M ${x + 6} 486 L ${x + BERTH_W - 6} 486 L ${x + BERTH_W - 24} 518 L ${x + 24} 518 Z`}
                      fill="none"
                      className="stroke-line"
                      strokeWidth="1"
                    />
                    {Array.from({ length: 6 }, (_, k) => (
                      <rect
                        key={`ship-box-${bi}-${k}`}
                        x={x + 14 + k * 20}
                        y="476"
                        width="17"
                        height="10"
                        rx="2"
                        className={k % 2 === 0 ? "fill-crane" : "fill-signal"}
                        opacity="0.9"
                      />
                    ))}
                  </g>
                ) : (
                  <rect
                    x={x + 6}
                    y="476"
                    width={BERTH_W - 12}
                    height="42"
                    rx="6"
                    fill="none"
                    className="stroke-line"
                    strokeWidth="1.2"
                    strokeDasharray="6 6"
                    opacity="0.5"
                  />
                )}
              </g>
            );
          })}

          {/* berth queue */}
          {Array.from({ length: berthQueueDots }, (_, i) => {
            const x = 72 + i * 46;
            const y = 452 + (hash(i * 9 + 5) - 0.5) * 6;
            return (
              <g
                key={`berth-queue-${i}`}
                transform={`translate(${x} ${y})`}
                style={{ transition: "transform 480ms ease" }}
              >
                <circle r="3" className="fill-signal" />
              </g>
            );
          })}

          {/* ================= HUD ================= */}
          <rect x="700" y="20" width="200" height="520" rx="14" className="fill-harbor" opacity="0.18" />
          <rect
            x="700"
            y="20"
            width="200"
            height="520"
            rx="14"
            fill="none"
            className="stroke-line"
            strokeWidth="1"
          />

          <text
            x="720"
            y="52"
            className="fill-mist text-[10px] font-semibold"
            letterSpacing="0.2em"
            opacity="0.6"
          >
            PORT TWIN · LIVE
          </text>

          <rect
            x="720"
            y="64"
            width="160"
            height="24"
            rx="12"
            className={congested ? "fill-coral" : "fill-crane"}
            opacity="0.18"
          />
          <rect
            x="720"
            y="64"
            width="160"
            height="24"
            rx="12"
            fill="none"
            className={congested ? "stroke-coral" : "stroke-crane"}
            strokeWidth="1"
          />
          <text
            x="800"
            y="80"
            textAnchor="middle"
            className={congested ? "fill-coral" : "fill-crane"}
            fontSize="10"
            fontWeight="700"
            letterSpacing="0.14em"
          >
            {congested ? "CONGESTED" : "NOMINAL"}
          </text>

          <text
            x="720"
            y="112"
            className="fill-mist text-[9px] font-semibold"
            letterSpacing="0.18em"
            opacity="0.5"
          >
            SIM CLOCK
          </text>
          <text x="720" y="142" className="fill-mist font-display text-[28px] font-semibold">
            {formatClock(m.t)}
          </text>

          <line x1="720" y1="158" x2="880" y2="158" className="stroke-line" strokeWidth="1" opacity="0.6" />

          {hudRows.map((row, i) => {
            const y = 186 + i * 52;
            return (
              <g key={row.label}>
                <text
                  x="720"
                  y={y}
                  className="fill-mist text-[9px] font-semibold"
                  letterSpacing="0.16em"
                  opacity="0.5"
                >
                  {row.label}
                </text>
                <text
                  x="880"
                  y={y + 22}
                  textAnchor="end"
                  className="kpi-num num fill-mist font-display text-[19px] font-semibold"
                >
                  {row.value}
                </text>
              </g>
            );
          })}

          <line x1="720" y1="446" x2="880" y2="446" className="stroke-line" strokeWidth="1" opacity="0.6" />
          <text
            x="720"
            y="468"
            className="fill-mist text-[9px] font-semibold"
            letterSpacing="0.16em"
            opacity="0.5"
          >
            GATE LOAD
          </text>
          <rect x="720" y="480" width="160" height="8" rx="4" className="fill-harbor" opacity="0.4" />
          <rect
            x="720"
            y="480"
            width={Math.max(160 * gateLoad, 2)}
            height="8"
            rx="4"
            className={congested ? "fill-coral" : "fill-crane"}
            style={{ transition: "width 400ms ease" }}
          />
          <text x="880" y="506" textAnchor="end" className="fill-mist text-[9px]" opacity="0.5">
            {Math.round(gateLoad * 100)}% of 600
          </text>

          {/* ================= LEGEND ================= */}
          <g transform="translate(24 536)">
            <circle cx="5" cy="5" r="4" className="fill-signal" />
            <text x="16" y="9" className="fill-mist text-[10px]" opacity="0.7">
              Queued truck
            </text>
            <circle cx="118" cy="5" r="4" className="fill-crane" />
            <text x="129" y="9" className="fill-mist text-[10px]" opacity="0.7">
              In service
            </text>
            <circle cx="222" cy="5" r="5" fill="none" className="stroke-coral" strokeWidth="1.6" />
            <text x="234" y="9" className="fill-mist text-[10px]" opacity="0.7">
              Congestion alert
            </text>
          </g>

          {/* subtle restart wash when the loop wraps */}
          <rect
            x="0"
            y="0"
            width={VIEW_W}
            height={VIEW_H}
            className="fill-crane"
            style={{ transition: "opacity 420ms ease" }}
            opacity={flash ? 0.06 : 0}
            pointerEvents="none"
          />
        </g>
      </svg>

      {/* ---------------- controls ---------------- */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause simulation playback" : "Start simulation playback"}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-line/70 bg-harbor/20 px-4 font-display text-xs font-semibold uppercase tracking-[0.14em] text-mist transition hover:border-crane/70 hover:text-crane"
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
          {playing ? "Pause" : "Play"}
        </button>

        <div
          role="group"
          aria-label="Playback speed"
          className="inline-flex h-9 items-center rounded-full border border-line/70 bg-harbor/20 p-1"
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              aria-pressed={speed === s}
              aria-label={`Playback speed ${s} times`}
              className={`h-7 rounded-full px-3 font-display text-xs font-semibold transition ${
                speed === s ? "bg-crane/20 text-crane" : "text-mist/60 hover:text-mist"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(count - 1, 0)}
          step={1}
          value={index}
          onChange={(event) => setCursor(Number(event.target.value))}
          aria-label="Simulation time scrubber"
          className="h-1.5 min-w-[180px] flex-1 cursor-pointer appearance-none rounded-full bg-harbor/40 accent-crane"
        />

        <span className="font-display text-sm font-semibold tabular-nums text-mist">
          {formatClock(m.t)}
        </span>
      </div>
    </div>
  );
}
