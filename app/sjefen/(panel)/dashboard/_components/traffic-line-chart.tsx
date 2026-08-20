"use client";

import { useState } from "react";

import type { VercelTrafficDay } from "@/lib/web-traffic";

/**
 * Trafikkurven på dashboardet.
 *
 * Kurven viser besøkende. Sidevisninger ligger i avlesningsboksen i stedet for
 * som en egen kurve: på en dag med 15 besøkende og 286 visninger ville felles
 * y-akse presset besøkendekurven flat mot nullinja, og to akser ville gjort en
 * enkel avlesning til noe man må tolke.
 *
 * SVG med fast koordinatsystem og `width: 100%`, så den skalerer med kortet uten
 * at noe må måles i nettleseren. Musa styrer avlesningen: nærmeste døgn markeres
 * med sikte og punkt, og tallene vises i en boks over kurven. Peker-posisjonen
 * regnes om til viewBox-rommet, slik at treffet stemmer uansett bredde.
 */

const VIEW_W = 520;
const VIEW_H = 150;
const PAD_TOP = 14;
const PAD_BOTTOM = 6;
/** Sidemargin så markørsirkelen på siste døgn ikke klippes av kanten. */
const PAD_X = 6;
const INNER_H = VIEW_H - PAD_TOP - PAD_BOTTOM;
const INNER_W = VIEW_W - PAD_X * 2;

/** Lav spenning: myk kurve som fortsatt følger dataene i stedet for å svinge fritt. */
const TENSION = 0.2;

type Point = { x: number; y: number; day: VercelTrafficDay };

export function TrafficLineChart({ days, peak }: { days: VercelTrafficDay[]; peak: number }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (days.length === 0 || peak <= 0) return null;

  const stepX = days.length > 1 ? INNER_W / (days.length - 1) : 0;
  const baseY = PAD_TOP + INNER_H;

  const points: Point[] = days.map((day, index) => ({
    x: round(PAD_X + index * stepX),
    y: round(baseY - (day.visitors / peak) * INNER_H),
    day,
  }));

  const line = smoothPath(points);
  const area = `${line} L ${points[points.length - 1].x} ${baseY} L ${points[0].x} ${baseY} Z`;
  const last = points[points.length - 1];
  const active = activeIndex === null ? null : (points[activeIndex] ?? null);

  /** Peker-x → nærmeste døgn. Regnes i viewBox-rommet, ikke i piksler. */
  function selectAt(clientX: number, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) return;

    const xInView = ((clientX - rect.left) / rect.width) * VIEW_W;
    const index = stepX === 0 ? 0 : Math.round((xInView - PAD_X) / stepX);
    setActiveIndex(clamp(index, 0, days.length - 1));
  }

  return (
    <div
      className="relative touch-none"
      onMouseMove={(event) => selectAt(event.clientX, event.currentTarget)}
      onMouseLeave={() => setActiveIndex(null)}
      onTouchStart={(event) => selectAt(event.touches[0].clientX, event.currentTarget)}
      onTouchMove={(event) => selectAt(event.touches[0].clientX, event.currentTarget)}
      onTouchEnd={() => setActiveIndex(null)}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`Besøkende per døgn siste ${days.length} dager, høyeste døgn ${peak}`}
        className="w-full"
      >
        <defs>
          <linearGradient id="traffic-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f7f58" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#2f7f58" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Hjelpelinjer på 0/50/100 % av toppen, så nivået kan leses av. */}
        {[0, 0.5, 1].map((fraction) => {
          const y = round(baseY - fraction * INNER_H);
          return (
            <line
              key={fraction}
              x1={0}
              y1={y}
              x2={VIEW_W}
              y2={y}
              stroke="#e7e5e4"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              strokeDasharray={fraction === 0 ? undefined : "3 4"}
            />
          );
        })}

        <path d={area} fill="url(#traffic-area)" />
        <path
          d={line}
          fill="none"
          stroke="#163f2a"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {active ? (
          <line
            x1={active.x}
            y1={PAD_TOP - 8}
            x2={active.x}
            y2={baseY}
            stroke="#163f2a"
            strokeWidth={1}
            strokeOpacity={0.35}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {/* Siste døgn er markert i ro; under avlesning tar sikte-punktet over. */}
        {active ? null : (
          <circle cx={last.x} cy={last.y} r={3.5} fill="#163f2a" stroke="#ffffff" strokeWidth={2} />
        )}
        {active ? (
          <circle cx={active.x} cy={active.y} r={4.5} fill="#ffffff" stroke="#163f2a" strokeWidth={2.5} />
        ) : null}
      </svg>

      {active ? <TrafficTooltip point={active} /> : null}
    </div>
  );
}

/**
 * Avlesningsboksen.
 *
 * Forankres i punktets x som prosent, og velger forskyvning etter hvor i
 * bredden punktet ligger — ellers ville boksen stukket ut av kortet i hver ende.
 */
function TrafficTooltip({ point }: { point: Point }) {
  const percent = (point.x / VIEW_W) * 100;
  const transform = percent < 15 ? "translateX(0)" : percent > 85 ? "translateX(-100%)" : "translateX(-50%)";

  // `bottom-full`: boksen svever over grafen i stedet for oppå den, så den
  // aldri dekker kurven du nettopp siktet deg inn på.
  return (
    <div
      className="pointer-events-none absolute bottom-full z-10 mb-1.5 whitespace-nowrap border border-stone-200 bg-white px-2.5 py-1.5 shadow-[0_8px_24px_rgba(32,25,15,0.12)]"
      style={{ left: `${percent}%`, transform }}
    >
      <p className="text-[11px] font-semibold text-stone-900">{dayLabel(point.day.date)}</p>
      <p className="mt-0.5 text-[11px] tabular-nums text-stone-600">
        {point.day.visitors} besøkende · {point.day.pageviews} visninger
      </p>
    </div>
  );
}

/**
 * Kardinalspline gjennom punktene.
 *
 * Kontrollpunktene klemmes inn i tegneflata. En kubisk bezier holder seg alltid
 * innenfor sitt eget konvekse skrog, så det ene grepet er nok til å hindre at
 * kurven dupper under nullinja mellom to lave døgn — noe som ville sett ut som
 * negativ trafikk under flatefyllet.
 */
function smoothPath(points: Point[]): string {
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  const minY = PAD_TOP;
  const maxY = PAD_TOP + INNER_H;
  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const start = points[index];
    const end = points[index + 1];
    const next = points[index + 2] ?? end;

    const c1x = round(start.x + (end.x - previous.x) * TENSION);
    const c1y = round(clamp(start.y + (end.y - previous.y) * TENSION, minY, maxY));
    const c2x = round(end.x - (next.x - start.x) * TENSION);
    const c2y = round(clamp(end.y - (next.y - start.y) * TENSION, minY, maxY));

    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
  }

  return path;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Holder SVG-en liten — to desimaler er langt under en piksel her. */
function round(value: number) {
  return Math.round(value * 100) / 100;
}

function dayLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("nb-NO", { day: "numeric", month: "short", timeZone: "UTC" });
}
