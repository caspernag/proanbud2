import Link from "next/link";

import { PROJECT_ROW_SELECT, projectFromRow, type ProjectRow, type ProjectView } from "@/lib/project-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import {
  ArrowUpRight,
  ClipboardList,
  Layers,
  PackageCheck,
  PlusCircle,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";

type OrderSummaryRow = {
  id: string;
  status: "draft" | "pending_payment" | "paid" | "submitted" | "cancelled" | "failed";
  total_nok: number;
  created_at: string;
};

type MonthlyOrderPoint = {
  key: string;
  label: string;
  orderCount: number;
  totalNok: number;
};

type StatusBucket = {
  key: "open" | "completed" | "deviation";
  label: string;
  count: number;
  valueNok: number;
  colorClassName: string;
  colorHex: string;
};

export default async function MinSideOverviewPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  const projectRows = user
    ? await supabase
        ?.from("projects")
        .select(PROJECT_ROW_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(24)
    : null;

  const materialLists: ProjectView[] =
    projectRows?.data && projectRows.data.length > 0
      ? (projectRows.data as ProjectRow[]).map(projectFromRow)
      : [];

  const materialListStats = materialLists.map((materialList) => ({
    materialList,
    lineCount: materialList.materialSections.reduce((total, section) => total + section.items.length, 0),
  }));

  const ordersResponse = user
    ? await supabase
        ?.from("material_orders")
        .select("id, status, total_nok, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200)
    : null;

  const orders = (ordersResponse?.data ?? []) as OrderSummaryRow[];

  const paidMaterialListCount = materialListStats.filter((entry) => entry.materialList.paymentStatus === "paid").length;
  const draftMaterialListCount = materialListStats.length - paidMaterialListCount;
  const totalLineCount = materialListStats.reduce((total, entry) => total + entry.lineCount, 0);

  const openOrders = orders.filter((order) => order.status === "draft" || order.status === "pending_payment");
  const completedOrders = orders.filter((order) => order.status === "paid" || order.status === "submitted");
  const deviationOrders = orders.filter((order) => order.status === "cancelled" || order.status === "failed");

  const totalOrderValueNok = orders.reduce((total, order) => total + order.total_nok, 0);
  const openOrderValueNok = openOrders.reduce((total, order) => total + order.total_nok, 0);
  const completedOrderValueNok = completedOrders.reduce((total, order) => total + order.total_nok, 0);
  const deviationOrderValueNok = deviationOrders.reduce((total, order) => total + order.total_nok, 0);

  const statusBuckets: StatusBucket[] = [
    {
      key: "completed",
      label: "Gjennomført",
      count: completedOrders.length,
      valueNok: completedOrderValueNok,
      colorClassName: "bg-emerald-500",
      colorHex: "#10b981",
    },
    {
      key: "open",
      label: "Åpne",
      count: openOrders.length,
      valueNok: openOrderValueNok,
      colorClassName: "bg-amber-500",
      colorHex: "#f59e0b",
    },
    {
      key: "deviation",
      label: "Avvik",
      count: deviationOrders.length,
      valueNok: deviationOrderValueNok,
      colorClassName: "bg-rose-500",
      colorHex: "#f43f5e",
    },
  ];

  const monthlyOrderPoints = buildMonthlyOrderPoints(orders);

  const recentMaterialLists = materialListStats.slice(0, 4);
  const recentOrders = orders.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-2xl border border-emerald-900/15 bg-gradient-to-br from-[#0f3324] via-[#0f271b] to-[#082014] p-5 text-emerald-50 shadow-[0_24px_60px_rgba(8,32,20,0.32)] sm:p-7">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(rgba(255,255,255,0.6)_0.7px,transparent_0.7px)] [background-size:18px_18px]" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-400/25 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-64 w-64 rounded-full bg-emerald-300/10 blur-3xl" />

        <div className="relative grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/30 bg-emerald-50/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-100">
              <Sparkles className="h-3 w-3" />
              Min side
            </div>
            <h1 className="display-font mt-2.5 text-3xl leading-tight text-white sm:text-4xl">
              {greeting(user?.email ?? null)}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-emerald-50/80">
              Generer materiallister med AI og bestill til partnerpris gjennom Proanbud.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/prosjekter?nyMaterialliste=1"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-[6px] bg-[#27a866] px-4 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(10,74,45,0.4)] transition hover:bg-[#2eb872]"
              >
                <PlusCircle className="h-4 w-4" />
                Ny materialliste med AI
              </Link>
              <Link
                href="/min-side/materiallister"
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[6px] border border-white/25 bg-white/5 px-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Mine lister
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/min-side/bestillinger"
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[6px] border border-white/25 bg-white/5 px-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Bestillinger
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
            <HeroStat icon={<Layers className="h-4 w-4" />} label="Materiallister" value={`${materialListStats.length}`} hint={`${totalLineCount} linjer`} />
            <HeroStat icon={<PackageCheck className="h-4 w-4" />} label="Bestillinger" value={`${orders.length}`} hint={`${completedOrders.length} fullført`} />
            <HeroStat icon={<Wallet className="h-4 w-4" />} label="Total verdi" value={formatCurrency(totalOrderValueNok)} hint="Alle ordre" />
            <HeroStat icon={<TrendingUp className="h-4 w-4" />} label="Åpen verdi" value={formatCurrency(openOrderValueNok)} hint={`${openOrders.length} aktive`} />
          </div>
        </div>
      </section>

      {/* STATUS METRIC TILES */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Sparkles className="h-4 w-4" />}
          label="AI-materiallister"
          value={`${materialListStats.length}`}
          supporting={`${paidMaterialListCount} aktive · ${draftMaterialListCount} kladd`}
          tone="neutral"
        />
        <MetricCard
          icon={<ClipboardList className="h-4 w-4" />}
          label="Klare for bestilling"
          value={`${paidMaterialListCount}`}
          supporting="Materiallister med betalt status"
          tone="accent"
        />
        <MetricCard
          icon={<ShoppingBag className="h-4 w-4" />}
          label="Aktive bestillinger"
          value={`${openOrders.length}`}
          supporting={`${formatCurrency(openOrderValueNok)} i åpen verdi`}
          tone="warm"
        />
        <MetricCard
          icon={<PackageCheck className="h-4 w-4" />}
          label="Fullført verdi"
          value={formatCurrency(completedOrderValueNok)}
          supporting={`${completedOrders.length} av ${orders.length} ordre`}
          tone="success"
        />
      </section>

      {/* CHART + STATUS */}
      <section className="grid gap-3 xl:grid-cols-[1.5fr_1fr]">
        <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_10px_28px_rgba(13,34,22,0.05)] sm:p-5">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">Aktivitet</p>
              <h2 className="mt-1 text-base font-semibold text-stone-900 sm:text-lg">Siste 6 måneder</h2>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-medium text-stone-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-[2px] bg-[#116b42]/85" />
                Verdi
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[2px] w-3 bg-emerald-700" />
                Antall
              </span>
            </div>
          </div>

          <OrderTrendChart points={monthlyOrderPoints} />
        </article>

        <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_10px_28px_rgba(13,34,22,0.05)] sm:p-5">
          <div className="mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">Ordreflyt</p>
            <h2 className="mt-1 text-base font-semibold text-stone-900 sm:text-lg">Statusfordeling</h2>
          </div>

          <StatusDonut buckets={statusBuckets} />

          <div className="mt-3 space-y-1.5">
            {statusBuckets.map((bucket) => {
              const total = statusBuckets.reduce((sum, b) => sum + b.count, 0);
              const sharePercent = total > 0 ? Math.round((bucket.count / total) * 100) : 0;
              return (
                <div key={bucket.key} className="flex items-center justify-between gap-3 rounded-lg border border-stone-100 bg-stone-50/60 px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${bucket.colorClassName}`} />
                    <p className="truncate text-xs font-semibold text-stone-800">{bucket.label}</p>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <p className="text-[11px] tabular-nums text-stone-500">{sharePercent}%</p>
                    <p className="text-xs font-semibold tabular-nums text-stone-900">{bucket.count}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      {/* RECENT LISTS + ORDERS */}
      <section className="grid gap-3 xl:grid-cols-2">
        <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_10px_28px_rgba(13,34,22,0.05)] sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                <Layers className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-base font-semibold text-stone-900">Nyeste materiallister</h2>
            </div>
            <Link href="/min-side/materiallister" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 transition hover:text-emerald-900">
              Alle
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="space-y-1.5">
            {recentMaterialLists.map((entry) => (
              <Link
                key={entry.materialList.slug}
                href={`/min-side/materiallister/${entry.materialList.slug}`}
                className="group flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50/40 px-3 py-2.5 transition hover:border-emerald-200 hover:bg-emerald-50/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-900">{entry.materialList.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-stone-500">
                    {entry.materialList.location || "Uten lokasjon"} · {entry.lineCount} linjer
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      entry.materialList.paymentStatus === "paid"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {entry.materialList.paymentStatus === "paid" ? "Aktiv" : "Kladd"}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-stone-400 transition group-hover:text-emerald-700" />
                </div>
              </Link>
            ))}

            {recentMaterialLists.length === 0 ? (
              <EmptyState
                title="Ingen materiallister enda"
                hint="Generer din første liste med AI for å komme i gang."
                ctaLabel="Ny materialliste"
                ctaHref="/prosjekter?nyMaterialliste=1"
              />
            ) : null}
          </div>
        </article>

        <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_10px_28px_rgba(13,34,22,0.05)] sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                <ShoppingBag className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-base font-semibold text-stone-900">Siste bestillinger</h2>
            </div>
            <Link href="/min-side/bestillinger" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 transition hover:text-emerald-900">
              Alle
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="space-y-1.5">
            {recentOrders.map((order) => (
              <Link
                key={order.id}
                href={`/min-side/bestillinger/${order.id}`}
                className="group flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50/40 px-3 py-2.5 transition hover:border-emerald-200 hover:bg-emerald-50/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-900">#{order.id.slice(0, 8)}</p>
                  <p className="mt-0.5 text-[11px] text-stone-500">{formatDate(order.created_at)}</p>
                </div>
                <div className="flex items-center gap-2.5">
                  <p className="text-sm font-semibold tabular-nums text-stone-900">{formatCurrency(order.total_nok)}</p>
                  {renderOrderStatusPill(order.status)}
                </div>
              </Link>
            ))}

            {recentOrders.length === 0 ? (
              <EmptyState
                title="Ingen bestillinger enda"
                hint="Bestill rett fra en materialliste når du er klar."
                ctaLabel="Se materiallister"
                ctaHref="/min-side/materiallister"
              />
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}

function greeting(email: string | null) {
  const hour = new Date().getHours();
  const base = hour < 5 ? "God natt" : hour < 11 ? "God morgen" : hour < 17 ? "God dag" : "God kveld";
  if (!email) return `${base}!`;
  const handle = email.split("@")[0]?.split(/[._-]/)[0] ?? "";
  return handle ? `${base}, ${handle.charAt(0).toUpperCase()}${handle.slice(1)}.` : `${base}!`;
}

function HeroStat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 text-emerald-100/80">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em]">{label}</p>
      </div>
      <p className="mt-1.5 text-lg font-semibold tabular-nums text-white">{value}</p>
      <p className="mt-0.5 text-[10px] text-emerald-100/70">{hint}</p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  supporting,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  supporting: string;
  tone: "neutral" | "accent" | "warm" | "success";
}) {
  const ring =
    tone === "accent"
      ? "ring-emerald-200/70 bg-emerald-50/70 text-emerald-700"
      : tone === "warm"
        ? "ring-amber-200/70 bg-amber-50/70 text-amber-700"
        : tone === "success"
          ? "ring-teal-200/70 bg-teal-50/70 text-teal-700"
          : "ring-stone-200 bg-stone-100 text-stone-700";

  return (
    <article className="group rounded-2xl border border-stone-200 bg-white p-3.5 shadow-[0_8px_22px_rgba(13,34,22,0.05)] transition hover:border-emerald-200 hover:shadow-[0_14px_30px_rgba(13,34,22,0.08)] sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ring-1 ${ring}`}>{icon}</span>
        <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">{label}</p>
      </div>
      <p className="mt-2.5 text-2xl font-semibold tracking-tight tabular-nums text-stone-900">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-stone-500">{supporting}</p>
    </article>
  );
}

function StatusDonut({ buckets }: { buckets: StatusBucket[] }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  if (total === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-stone-200 bg-stone-50/60 text-xs text-stone-500">
        Ingen ordre enda
      </div>
    );
  }

  const [completed, open, deviation] = buckets;
  const completedEnd = (completed.count / total) * 100;
  const openEnd = completedEnd + (open.count / total) * 100;

  const gradient = `conic-gradient(${completed.colorHex} 0% ${completedEnd}%, ${open.colorHex} ${completedEnd}% ${openEnd}%, ${deviation.colorHex} ${openEnd}% 100%)`;

  return (
    <div className="flex items-center justify-center py-2">
      <div className="relative h-36 w-36 rounded-full p-1.5" style={{ background: gradient }}>
        <div className="flex h-full w-full items-center justify-center rounded-full bg-white shadow-inner">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Totalt</p>
            <p className="text-2xl font-semibold tabular-nums text-stone-900">{total}</p>
            <p className="text-[10px] text-stone-500">ordre</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderTrendChart({ points }: { points: MonthlyOrderPoint[] }) {
  const maxValue = Math.max(...points.map((point) => point.totalNok), 1);
  const maxCount = Math.max(...points.map((point) => point.orderCount), 1);

  const chartPoints = points.map((point, index) => {
    const x = ((index + 0.5) / points.length) * 100;
    const y = 100 - (point.orderCount / maxCount) * 92 - 4;
    return { x, y };
  });

  const path = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const area = `${path} L100,100 L0,100 Z`;

  return (
    <div className="relative">
      <div className="relative h-52 rounded-xl bg-gradient-to-b from-stone-50 to-white p-3 ring-1 ring-stone-100">
        <div className="pointer-events-none absolute inset-3 flex flex-col justify-between">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="h-px w-full bg-stone-200/70" />
          ))}
        </div>

        <div className="absolute inset-3 flex items-end gap-2">
          {points.map((point) => {
            const height = `${Math.max(4, Math.round((point.totalNok / maxValue) * 92))}%`;
            return (
              <div key={point.key} className="group relative flex h-full flex-1 items-end justify-center">
                <div
                  className="w-full max-w-[36px] rounded-t-md bg-gradient-to-t from-[#0e5e3a] to-[#1aa869] shadow-[0_4px_10px_rgba(15,94,58,0.25)] transition group-hover:from-[#0a4d2f] group-hover:to-[#22c073]"
                  style={{ height }}
                />
              </div>
            );
          })}
        </div>

        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)]">
          <defs>
            <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#047857" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#047857" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#lineFill)" />
          <path d={path} fill="none" stroke="#047857" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          {chartPoints.map((point, index) => (
            <circle
              key={points[index]?.key ?? `${index}`}
              cx={point.x}
              cy={point.y}
              r="2.2"
              fill="#ffffff"
              stroke="#047857"
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      <div className="mt-2 grid grid-cols-6 gap-1.5 text-center">
        {points.map((point) => (
          <div key={`${point.key}-label`}>
            <p className="text-[11px] font-semibold tabular-nums text-stone-700">{point.orderCount}</p>
            <p className="text-[10px] uppercase tracking-[0.08em] text-stone-500">{point.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title, hint, ctaLabel, ctaHref }: { title: string; hint: string; ctaLabel: string; ctaHref: string }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50/60 p-5 text-center">
      <p className="text-sm font-semibold text-stone-900">{title}</p>
      <p className="mt-1 text-xs text-stone-500">{hint}</p>
      <Link
        href={ctaHref}
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-[#27a866] px-3 text-xs font-semibold text-white transition hover:bg-[#2eb872]"
      >
        <PlusCircle className="h-3.5 w-3.5" />
        {ctaLabel}
      </Link>
    </div>
  );
}

function renderOrderStatusPill(status: OrderSummaryRow["status"]) {
  const statusMap: Record<OrderSummaryRow["status"], { label: string; className: string }> = {
    draft: { label: "Kladd", className: "bg-stone-100 text-stone-700" },
    pending_payment: { label: "Venter", className: "bg-amber-100 text-amber-800" },
    paid: { label: "Betalt", className: "bg-emerald-100 text-emerald-800" },
    submitted: { label: "Sendt", className: "bg-sky-100 text-sky-800" },
    cancelled: { label: "Avbrutt", className: "bg-rose-100 text-rose-800" },
    failed: { label: "Feilet", className: "bg-red-100 text-red-800" },
  };

  const entry = statusMap[status];

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${entry.className}`}>
      {entry.label}
    </span>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function buildMonthlyOrderPoints(orders: OrderSummaryRow[]): MonthlyOrderPoint[] {
  const now = new Date();
  const points: MonthlyOrderPoint[] = [];

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;

    const monthOrders = orders.filter((order) => order.created_at.startsWith(key));

    points.push({
      key,
      label: date.toLocaleDateString("nb-NO", { month: "short" }).replace(".", ""),
      orderCount: monthOrders.length,
      totalNok: monthOrders.reduce((total, order) => total + order.total_nok, 0),
    });
  }

  return points;
}
