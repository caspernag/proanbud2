import type { ReactNode } from "react";

/**
 * Delte byggeklosser for /sjefen, med samme designspråk som prisbygg.no:
 * bakgrunn #f5f4f1, hvite kort med skarpe hjørner og myk skygge, mørkegrønn
 * #123321 som primærfarge og lime #d9ff7a som aksent. Ingen rundede «app»-hjørner
 * og ingen oransje — butikken bruker ingen av delene.
 */

export const ADMIN_SURFACE = "border border-stone-200 bg-white shadow-[0_8px_24px_rgba(32,25,15,0.06)]";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#2f7f58]">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm leading-6 text-stone-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`${ADMIN_SURFACE} ${className ?? ""}`}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-stone-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={bodyClassName ?? "p-5"}>{children}</div>
    </section>
  );
}

export type StatTone = "neutral" | "good" | "danger" | "accent";

export function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: StatTone;
}) {
  const surface =
    tone === "danger"
      ? "border-red-200 bg-red-50"
      : tone === "good"
        ? "border-emerald-200 bg-emerald-50"
        : tone === "accent"
          ? "border-transparent bg-[#123321]"
          : "border-stone-200 bg-white";

  const labelColor = tone === "accent" ? "text-emerald-100/80" : "text-stone-500";
  const valueColor =
    tone === "danger"
      ? "text-red-800"
      : tone === "good"
        ? "text-emerald-800"
        : tone === "accent"
          ? "text-white"
          : "text-stone-900";
  const subColor = tone === "accent" ? "text-emerald-100/70" : "text-stone-500";

  return (
    <div className={`border px-5 py-4 shadow-[0_8px_24px_rgba(32,25,15,0.06)] ${surface}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${labelColor}`}>{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
      {sub ? <p className={`mt-1 text-xs ${subColor}`}>{sub}</p> : null}
    </div>
  );
}

export type BadgeTone = "neutral" | "info" | "warn" | "good" | "danger" | "accent";

/**
 * Solid lys bakgrunn med mørk tekst. Panelet brukte tidligere `bg-x-500/20
 * text-x-400`, som er lys tekst på lys flate — nær uleselig på hvitt.
 */
const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
  info: "bg-blue-50 text-blue-800 ring-blue-200",
  warn: "bg-amber-50 text-amber-900 ring-amber-200",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  danger: "bg-red-50 text-red-800 ring-red-200",
  accent: "bg-[#eaf6ef] text-[#12492f] ring-[#bfe0cd]",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/** Gjør mislykkede spørringer synlige i stedet for å vise villedende nuller. */
export function DataErrorBanner({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;

  return (
    <section className="border border-red-200 bg-red-50 px-5 py-4">
      <h2 className="text-sm font-semibold text-red-900">
        {errors.length === 1 ? "En spørring feilet" : `${errors.length} spørringer feilet`}
      </h2>
      <p className="mt-1 text-xs text-red-800">
        Tallene under er derfor ufullstendige. Feilene er også logget på serveren.
      </p>
      <ul className="mt-2 space-y-1">
        {errors.map((error) => (
          <li key={error} className="font-mono text-[11px] text-red-900">
            {error}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-5 py-12 text-center text-sm text-stone-400">{children}</p>;
}

/* ── Tabell ─────────────────────────────────────────────────────────────── */

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, align = "left" }: { children?: ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`whitespace-nowrap px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td className={`px-5 py-3 ${align === "right" ? "text-right" : ""} ${className ?? ""}`}>{children}</td>
  );
}

/* ── Knapper ────────────────────────────────────────────────────────────── */

export const BTN_PRIMARY =
  "inline-flex h-10 items-center justify-center bg-[#163f2a] px-4 text-sm font-semibold text-white transition hover:bg-[#1d5639]";

export const BTN_SECONDARY =
  "inline-flex h-10 items-center justify-center border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 transition hover:border-stone-900";

export const BTN_ACCENT =
  "inline-flex h-10 items-center justify-center bg-[#d9ff7a] px-4 text-sm font-bold text-[#0f321f] transition hover:bg-[#c8f265]";

/* ── Formattering ───────────────────────────────────────────────────────── */

export function nok(value: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

export function num(value: number) {
  return new Intl.NumberFormat("nb-NO").format(value);
}

export function dateNo(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}
