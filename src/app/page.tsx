"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Count-up                                                           */
/* ------------------------------------------------------------------ */

type CountUpProps = {
  to: number;
  from?: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
};

function CountUp({
  to,
  from = 0,
  duration = 1500,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);
  const [value, setValue] = useState<number>(from);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      setValue(to);
      return;
    }

    let frame = 0;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || !entry.isIntersecting || started.current) return;
        started.current = true;
        observer.disconnect();

        const start = performance.now();
        const step = (now: number) => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          setValue(from + (to - from) * eased);
          if (progress < 1) {
            frame = requestAnimationFrame(step);
          } else {
            setValue(to);
          }
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.4 }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [from, to, duration]);

  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Content                                                            */
/* ------------------------------------------------------------------ */

const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "#crisis", label: "The crisis" },
  { href: "#fix", label: "The fix" },
  { href: "#roi", label: "ROI" },
  { href: "#model", label: "Model" },
];

const GITHUB_URL = "https://github.com/eliem08/porttwin";

const CAUSES: ReadonlyArray<{ n: string; title: string; body: string }> = [
  {
    n: "01",
    title: "Diverted traffic",
    body: "Tanger Med overflow lands in Casablanca. Boxes that were never planned for this yard arrive anyway, and the landside absorbs the shock.",
  },
  {
    n: "02",
    title: "Record grain imports",
    body: "Successive dry seasons pushed Morocco to record cereal imports. Bulk and containerised grain compete for the same berths, trucks and yard space.",
  },
  {
    n: "03",
    title: "Container squatting",
    body: "Importers leave cleared boxes in-port to dodge demurrage and storage fees. Every squatted container is yard capacity that no longer exists.",
  },
  {
    n: "04",
    title: "Slow customs, three gates",
    body: "Manual document checks and no OCR mean minutes per truck at each of the three gates. The gate — not the quay — sets the ceiling on throughput.",
  },
  {
    n: "05",
    title: "Truck chaos",
    body: "With no appointment system, hauliers arrive in a 6 AM surge and wait up to 12 hours. Queues spill onto the approach roads and block the next wave.",
  },
];

type PresetRow = { label: string; value: string; unit: string };

type Preset = {
  name: string;
  tagline: string;
  accent: string;
  badge: string | null;
  rows: ReadonlyArray<PresetRow>;
  note: string | null;
};

const PRESETS: ReadonlyArray<Preset> = [
  {
    name: "Status quo",
    tagline: "No appointment system, day gates only.",
    accent: "border-coral/45",
    badge: null,
    rows: [
      { label: "Throughput", value: "1,203", unit: "TEU / day" },
      { label: "Average wait", value: "393", unit: "min" },
      { label: "Max queue", value: "857", unit: "trucks" },
    ],
    note: "The simulated crisis, run on the current gate configuration.",
  },
  {
    name: "Rotterdam-style TAS",
    tagline: "Dynamic truck appointments, same three gates.",
    accent: "border-signal/50",
    badge: "RECOMMENDED",
    rows: [
      { label: "Throughput", value: "1,733", unit: "TEU / day" },
      { label: "Average wait", value: "43", unit: "min" },
      { label: "Max queue", value: "396", unit: "trucks" },
    ],
    note: "−54% maximum queue length against the status quo.",
  },
  {
    name: "TAS + night gate",
    tagline: "Appointments plus a 24-hour gate window.",
    accent: "border-crane/50",
    badge: null,
    rows: [
      { label: "Throughput", value: "2,296", unit: "TEU / day" },
      { label: "Average wait", value: "3", unit: "min" },
      { label: "Max queue", value: "19", unit: "trucks" },
    ],
    note: "The queue effectively disappears — 19 trucks at peak.",
  },
];

const ROI: ReadonlyArray<{ tag: string; stat: string; unit: string; body: string }> = [
  {
    tag: "Demurrage math",
    stat: "≈6,500",
    unit: "idle truck-hours removed / day",
    body: "Every idle truck-hour burns driver time, diesel and storage fees. Cutting average wait from 393 minutes to 3 removes roughly 6,500 idle truck-hours from the port apron every single day.",
  },
  {
    tag: "Throughput is revenue",
    stat: "+1,100",
    unit: "TEU / day of recovered capacity",
    body: "The gap between the status quo and the TAS + night gate preset is about 1,100 TEU per day. At typical handling fees, that is capacity you already own but cannot currently move.",
  },
  {
    tag: "Carbon",
    stat: "14.2 → 0.2",
    unit: "t CO₂ / day from idling",
    body: "Idling trucks are the invisible line in the port’s emissions footprint. The modelled fix removes 98% of it without touching a single vessel call.",
  },
];

const STEPS: ReadonlyArray<{ n: string; title: string; body: string }> = [
  {
    n: "①",
    title: "Non-homogeneous Poisson arrivals",
    body: "Truck arrivals follow a time-varying Poisson process, so the 6 AM surge and the afternoon lull are modelled explicitly instead of averaged away.",
  },
  {
    n: "②",
    title: "Three gate lanes",
    body: "Each lane serves trucks with a lognormal service time. Customs speed is a tunable parameter, so you can price a process change before you staff it.",
  },
  {
    n: "③",
    title: "Yard cranes",
    body: "Crane throughput caps how fast containers leave the yard and feeds back into gate queue length — the loop that makes squatting so expensive.",
  },
  {
    n: "④",
    title: "Berth loading",
    body: "Vessel calls set the demand the landside has to absorb. Change the call profile and watch the queue respond in the next run.",
  },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function Page() {
  return (
    <div className="min-h-screen bg-abyss font-body text-ink antialiased">
      {/* ---------------------------------------------------------- */}
      {/*  Nav                                                       */}
      {/* ---------------------------------------------------------- */}
      <header className="sticky top-0 z-50 border-b border-line bg-abyss/85 backdrop-blur-xl">
        <nav
          aria-label="Primary"
          className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8"
        >
          <Link href="/" className="flex items-center gap-2">
            <span aria-hidden className="text-lg leading-none text-signal">
              ◈
            </span>
            <span className="font-display text-lg font-semibold tracking-tight text-ink">
              PortTwin
            </span>
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-mist transition-colors hover:text-ink"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="hidden text-sm text-mist transition-colors hover:text-ink sm:inline-flex"
            >
              GitHub
            </a>
            <Link href="/demo" className="btn-primary text-sm">
              Launch the twin
              <span aria-hidden className="ml-1.5">
                →
              </span>
            </Link>
          </div>
        </nav>

        <div className="flex items-center gap-5 overflow-x-auto border-t border-line px-5 py-2.5 md:hidden">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="whitespace-nowrap text-xs uppercase tracking-[0.14em] text-mist transition-colors hover:text-signal"
            >
              {link.label}
            </a>
          ))}
        </div>
      </header>

      <main>
        {/* -------------------------------------------------------- */}
        {/*  Hero                                                     */}
        {/* -------------------------------------------------------- */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="grid-bg pointer-events-none absolute inset-0 opacity-50"
          />
          <div
            aria-hidden
            className="glow-amber pointer-events-none absolute -left-40 -top-40 h-[30rem] w-[30rem] rounded-full"
          />
          <div
            aria-hidden
            className="glow-teal pointer-events-none absolute -right-32 top-8 h-[26rem] w-[26rem] rounded-full"
          />

          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-28 text-crane/15 sm:h-40"
          >
            <svg
              viewBox="0 0 1440 200"
              preserveAspectRatio="xMidYMax meet"
              className="h-full w-full"
            >
              <defs>
                <g id="pt-crane">
                  <rect x="0" y="70" width="7" height="130" />
                  <rect x="58" y="70" width="7" height="130" />
                  <rect x="-30" y="60" width="126" height="7" />
                  <rect x="26" y="67" width="5" height="46" />
                  <path d="M-30 67 L26 113 L31 108 L-25 62 Z" />
                </g>
              </defs>
              <g fill="currentColor">
                <use href="#pt-crane" x="120" />
                <use href="#pt-crane" x="420" />
                <use href="#pt-crane" x="720" />
                <use href="#pt-crane" x="1020" />
                <use href="#pt-crane" x="1320" />
              </g>
              <rect x="0" y="196" width="1440" height="4" fill="currentColor" />
            </svg>
          </div>

          <div className="relative mx-auto max-w-7xl px-5 pt-16 sm:px-8 sm:pt-24">
            <span className="chip">DIGITAL TWIN · PORT OF CASABLANCA</span>

            <h1 className="font-display mt-6 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              Test the fix before you pour the concrete.
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-relaxed text-mist sm:text-lg">
              PortTwin simulates the landside crisis at the Port of Casablanca — truck
              arrivals, gate lanes, yard cranes and berth loading — so you can see what a
              truck appointment system actually buys you before committing a single dirham.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/demo" className="btn-primary">
                Launch the digital twin
                <span aria-hidden className="ml-2">
                  →
                </span>
              </Link>
              <a href="#model" className="btn-ghost">
                How the model works
              </a>
            </div>
          </div>

          <div className="relative mx-auto max-w-7xl px-5 pb-14 pt-14 sm:px-8 sm:pb-20 sm:pt-20">
            <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-harbor p-6">
                <dt className="text-[0.7rem] uppercase tracking-[0.18em] text-mist/70">
                  Throughput collapse
                </dt>
                <dd className="mt-3">
                  <span className="kpi-num text-3xl text-ink">
                    <CountUp to={2800} />
                    <span aria-hidden className="mx-1.5 text-coral">
                      →
                    </span>
                    <CountUp to={800} />
                  </span>
                  <span className="mt-1.5 block text-sm text-mist">
                    containers / day
                  </span>
                </dd>
              </div>

              <div className="bg-harbor p-6">
                <dt className="text-[0.7rem] uppercase tracking-[0.18em] text-mist/70">
                  Peak congestion
                </dt>
                <dd className="mt-3">
                  <span className="kpi-num text-3xl text-ink">
                    <CountUp to={12} suffix=" h" />
                  </span>
                  <span className="mt-1.5 block text-sm text-mist">
                    maximum truck wait
                  </span>
                </dd>
              </div>

              <div className="bg-harbor p-6">
                <dt className="text-[0.7rem] uppercase tracking-[0.18em] text-mist/70">
                  Gate capacity
                </dt>
                <dd className="mt-3">
                  <span className="kpi-num text-3xl text-ink">
                    <CountUp to={3} />
                  </span>
                  <span className="mt-1.5 block text-sm text-mist">
                    gates, zero appointment system
                  </span>
                </dd>
              </div>

              <div className="bg-harbor p-6">
                <dt className="text-[0.7rem] uppercase tracking-[0.18em] text-mist/70">
                  Modelled improvement
                </dt>
                <dd className="mt-3">
                  <span className="kpi-num text-3xl text-crane">
                    <CountUp to={54} prefix="−" suffix="%" />
                  </span>
                  <span className="mt-1.5 block text-sm text-mist">
                    max queue with TAS
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          <div className="relative mx-auto max-w-7xl px-5 pb-10 sm:px-8">
            <a
              href="#crisis"
              className="inline-flex items-center gap-3 text-[0.7rem] uppercase tracking-[0.22em] text-mist/60 transition-colors hover:text-signal"
            >
              <span
                aria-hidden
                className="h-8 w-px animate-pulse bg-gradient-to-b from-transparent via-signal/70 to-transparent"
              />
              Scroll
            </a>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/*  The crisis                                               */}
        {/* -------------------------------------------------------- */}
        <section id="crisis" className="relative scroll-mt-24 border-t border-line">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="max-w-3xl">
              <span className="chip">01 · The crisis</span>
              <h2 className="font-display mt-5 text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
                Five pressures, one gate complex.
              </h2>
              <p className="mt-5 text-base leading-relaxed text-mist sm:text-lg">
                The Port of Casablanca moves 65% of Morocco’s foreign trade through three
                gates. When volumes spike, it is the landside — not the water side — that
                breaks first.
              </p>
            </div>

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAUSES.map((cause) => (
                <article
                  key={cause.n}
                  className="panel group relative overflow-hidden p-6 transition-colors hover:border-signal/40"
                >
                  <span className="num text-xs tracking-[0.22em] text-signal/70">
                    {cause.n}
                  </span>
                  <h3 className="font-display mt-4 text-lg font-semibold text-ink">
                    {cause.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-mist">
                    {cause.body}
                  </p>
                </article>
              ))}

              <article className="relative overflow-hidden rounded-2xl border border-coral/45 bg-coral/5 p-6">
                <span className="text-[0.7rem] uppercase tracking-[0.22em] text-coral">
                  Collapse
                </span>
                <p className="kpi-num mt-4 text-3xl text-ink">
                  2,800 <span aria-hidden className="text-coral">→</span> 800
                </p>
                <p className="mt-2.5 text-sm leading-relaxed text-mist">
                  containers per day at the worst of the backlog — a 71% drop in throughput
                  against the port’s normal operating rate.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/*  The fix                                                  */}
        {/* -------------------------------------------------------- */}
        <section id="fix" className="relative scroll-mt-24 border-t border-line">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="max-w-3xl">
              <span className="chip">02 · The fix, simulated</span>
              <h2 className="font-display mt-5 text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
                Three presets. One afternoon of evidence.
              </h2>
              <p className="mt-5 text-base leading-relaxed text-mist sm:text-lg">
                Run the same crisis day against three operating policies. Nothing else
                changes — same arrivals, same vessels, same three gates.
              </p>
            </div>

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {PRESETS.map((preset) => (
                <article
                  key={preset.name}
                  className={`panel relative flex flex-col p-6 ${preset.accent}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-xl font-semibold text-ink">
                      {preset.name}
                    </h3>
                    {preset.badge ? (
                      <span className="chip border-signal/40 bg-signal/10 text-signal">
                        {preset.badge}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-2 text-sm leading-relaxed text-mist">
                    {preset.tagline}
                  </p>

                  <dl className="mt-6 space-y-3 border-t border-line pt-5">
                    {preset.rows.map((row) => (
                      <div
                        key={row.label}
                        className="flex items-baseline justify-between gap-4"
                      >
                        <dt className="text-sm text-mist">{row.label}</dt>
                        <dd className="text-right">
                          <span className="num font-display text-lg font-semibold text-ink">
                            {row.value}
                          </span>
                          <span className="ml-1.5 text-xs text-mist/70">{row.unit}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {preset.note ? (
                    <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-mist/70">
                      {preset.note}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>

            <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-mist">
                Figures from the live simulation — run them yourself.
              </p>
              <Link href="/demo" className="btn-primary">
                Open the twin
                <span aria-hidden className="ml-2">
                  →
                </span>
              </Link>
            </div>

            <p className="mt-8 max-w-3xl text-xs leading-relaxed text-mist/60">
              Reference: an ENSEM Casablanca study on real port data measured a −62%
              reduction in maximum queue length with a dynamic truck appointment system.
              PortTwin’s stylized model reproduces the same direction of effect.
            </p>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/*  ROI                                                      */}
        {/* -------------------------------------------------------- */}
        <section id="roi" className="relative scroll-mt-24 border-t border-line">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="panel relative overflow-hidden p-6 sm:p-10">
              <div
                aria-hidden
                className="glow-amber pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
              />

              <div className="relative">
                <span className="chip">03 · ROI</span>
                <h2 className="font-display mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
                  The money is in the minutes.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-relaxed text-mist sm:text-lg">
                  A truck appointment system is not a capital project. It is a scheduling
                  decision — and the returns show up on three separate lines.
                </p>

                <div className="mt-12 grid gap-10 lg:grid-cols-3">
                  {ROI.map((item) => (
                    <div key={item.tag} className="border-t border-line pt-6">
                      <span className="text-[0.7rem] uppercase tracking-[0.22em] text-signal/80">
                        {item.tag}
                      </span>
                      <p className="kpi-num mt-4 text-3xl text-ink sm:text-4xl">
                        {item.stat}
                      </p>
                      <p className="mt-2 text-sm text-crane">{item.unit}</p>
                      <p className="mt-4 text-sm leading-relaxed text-mist">
                        {item.body}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="mt-12 border-t border-line pt-6 text-xs leading-relaxed text-mist/60">
                  Illustrative, from the stylized model — plug your tariffs for exact
                  figures.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/*  Model                                                    */}
        {/* -------------------------------------------------------- */}
        <section id="model" className="relative scroll-mt-24 border-t border-line">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="max-w-3xl">
              <span className="chip">04 · How the model works</span>
              <h2 className="font-display mt-5 text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
                Four stages, one queue.
              </h2>
              <p className="mt-5 text-base leading-relaxed text-mist sm:text-lg">
                The twin is a discrete-event simulation of the landside chain. Each stage
                feeds the next, so a change at the gate propagates all the way to the berth.
              </p>
            </div>

            <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step) => (
                <li key={step.n} className="panel relative p-6">
                  <span aria-hidden className="font-display text-2xl text-signal/80">
                    {step.n}
                  </span>
                  <h3 className="font-display mt-3 text-base font-semibold leading-snug text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-mist">{step.body}</p>
                </li>
              ))}
            </ol>

            <div className="mt-12">
              <span className="chip">05 · Power tools</span>
              <h3 className="font-display mt-4 text-2xl font-semibold tracking-tight text-ink">
                Built for the board meeting, not just the demo.
              </h3>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="panel p-5">
                  <p className="font-display text-base font-semibold text-ink">Monte Carlo</p>
                  <p className="mt-2 text-sm leading-relaxed text-mist">
                    30 replications per scenario, with 95% confidence bands on every KPI —
                    uncertainty, not one lucky draw.
                  </p>
                </div>
                <div className="panel p-5">
                  <p className="font-display text-base font-semibold text-ink">Disruptions</p>
                  <p className="mt-2 text-sm leading-relaxed text-mist">
                    Crane breakdown, vessel bunching, gate closure, weather slowdown —
                    toggleable, combinable, costed.
                  </p>
                </div>
                <div className="panel p-5">
                  <p className="font-display text-base font-semibold text-ink">Cost model</p>
                  <p className="mt-2 text-sm leading-relaxed text-mist">
                    Demurrage, waiting, fuel, crane-hours, carbon — dollar deltas vs the
                    crisis baseline, with editable rates.
                  </p>
                </div>
                <div className="panel p-5">
                  <p className="font-display text-base font-semibold text-ink">Save &amp; export</p>
                  <p className="mt-2 text-sm leading-relaxed text-mist">
                    Name and store scenarios in the browser; download CSV or a full
                    reproducible JSON bundle.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-3">
                <span className="chip">Seeded &amp; deterministic — every run reproducible</span>
                <span className="chip">Decoupled TypeScript engine, 44 automated tests</span>
              </div>
              <Link href="/demo" className="btn-primary self-start lg:self-auto">
                Run a scenario
                <span aria-hidden className="ml-2">
                  →
                </span>
              </Link>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/*  Final CTA                                                */}
        {/* -------------------------------------------------------- */}
        <section className="relative overflow-hidden border-t border-line">
          <div
            aria-hidden
            className="grid-bg pointer-events-none absolute inset-0 opacity-50"
          />
          <div
            aria-hidden
            className="glow-teal pointer-events-none absolute left-1/2 top-0 h-80 w-80 -translate-x-1/2 rounded-full"
          />

          <div className="relative mx-auto max-w-4xl px-5 py-24 text-center sm:px-8 sm:py-32">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
              Bring your port’s data. We’ll bring the twin.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-mist sm:text-lg">
              Arrival profiles, gate service times, crane rates, vessel calls. Feed them in
              and the model answers the only question that matters: what changes, and by how
              much?
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/demo" className="btn-primary">
                Launch the digital twin
                <span aria-hidden className="ml-2">
                  →
                </span>
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="btn-ghost"
              >
                Read the source
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ---------------------------------------------------------- */}
      {/*  Footer                                                     */}
      {/* ---------------------------------------------------------- */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="font-display text-sm text-ink">
              <span aria-hidden className="mr-2 text-signal">
                ◈
              </span>
              PortTwin — an interactive digital twin concept for the Port of Casablanca.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-mist/60">
              Stylized model for demonstration; not calibrated to live port data.
            </p>
          </div>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 text-sm text-mist transition-colors hover:text-signal"
          >
            GitHub
            <span aria-hidden>↗</span>
          </a>
        </div>
      </footer>
    </div>
  );
}
