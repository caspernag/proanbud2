import Link from "next/link";

import { PROJECT_ROW_SELECT, projectFromRow, type ProjectRow, type ProjectView } from "@/lib/project-data";
import { calculatePriceCheck } from "@/lib/price-check";
import { getPriceListProducts } from "@/lib/price-lists";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import { Plus, PlusCircle } from "lucide-react";

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

type SupplierInsight = {
  supplierName: string;
  wins: number;
  potentialSavingsNok: number;
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

  const priceProducts = await getPriceListProducts();
  const materialListStats = await Promise.all(
    materialLists.map(async (materialList) => ({
      materialList,
      priceCheck: await calculatePriceCheck(materialList, priceProducts),
      lineCount: materialList.materialSections.reduce((total, section) => total + section.items.length, 0),
    })),
  );

  const ordersResponse = user
    ? await supabase
        ?.from("material_orders")
        .select("id, status, total_nok, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200)
    : null;

  const orders = (ordersResponse?.data ?? []) as OrderSummaryRow[];

  const materialListsWithSavedPriceDuel = materialListStats.filter(
    (entry) => Boolean(entry.materialList.priceDuelCheapestSupplier),
  );
  const totalPotentialSavings = materialListsWithSavedPriceDuel.reduce(
    (total, entry) => total + Math.max(0, entry.materialList.priceDuelSavingsNok ?? 0),
    0,
  );
  const paidMaterialListCount = materialListStats.filter((entry) => entry.materialList.paymentStatus === "paid").length;
  const comparedMaterialLists = materialListStats.filter((entry) => entry.priceCheck.quotes.length >= 2);

  const openOrders = orders.filter(
    (order) => order.status === "draft" || order.status === "pending_payment",
  );
  const completedOrders = orders.filter((order) => order.status === "paid" || order.status === "submitted");
  const deviationOrders = orders.filter((order) => order.status === "cancelled" || order.status === "failed");

  const totalOrderValueNok = orders.reduce((total, order) => total + order.total_nok, 0);
  const openOrderValueNok = openOrders.reduce((total, order) => total + order.total_nok, 0);
  const completedOrderValueNok = completedOrders.reduce((total, order) => total + order.total_nok, 0);
  const deviationOrderValueNok = deviationOrders.reduce((total, order) => total + order.total_nok, 0);

  const statusBuckets: StatusBucket[] = [
    {
      key: "completed",
      label: "Gjennomforte",
      count: completedOrders.length,
      valueNok: completedOrderValueNok,
      colorClassName: "bg-emerald-600",
      colorHex: "#059669",
    },
    {
      key: "open",
      label: "Apne",
      count: openOrders.length,
      valueNok: openOrderValueNok,
      colorClassName: "bg-amber-500",
      colorHex: "#d97706",
    },
    {
      key: "deviation",
      label: "Avvik",
      count: deviationOrders.length,
      valueNok: deviationOrderValueNok,
      colorClassName: "bg-rose-600",
      colorHex: "#e11d48",
    },
  ];

  const monthlyOrderPoints = buildMonthlyOrderPoints(orders);

  const avgCoveragePercent =
    comparedMaterialLists.length > 0
      ? Math.round(
          (comparedMaterialLists.reduce((total, entry) => total + entry.priceCheck.coverageRatio, 0) /
            comparedMaterialLists.length) *
            100,
        )
      : 0;
  const hasSavingsData = materialListsWithSavedPriceDuel.length > 0;
  const savingsValue = hasSavingsData ? formatCurrency(totalPotentialSavings) : "Ikke tilgjengelig";
  const savingsSupporting = hasSavingsData
    ? "Sum av Prisduell - billigst i materiallister"
    : "Ingen lagrede prisdueller enna";

  const supplierInsights = buildSupplierInsights(materialListStats);
  const supplierWinsMax = Math.max(...supplierInsights.map((entry) => entry.wins), 1);

  const spreadProjects = materialListStats
    .filter((entry) => entry.priceCheck.quotes.length >= 2 && entry.priceCheck.cheapest && entry.priceCheck.mostExpensive)
    .map((entry) => ({
      slug: entry.materialList.slug,
      title: entry.materialList.title,
      spreadNok: entry.priceCheck.potentialSavingsNok,
      coveragePercent: Math.round(entry.priceCheck.coverageRatio * 100),
      cheapestSupplier: entry.priceCheck.cheapest?.supplierName ?? "Ukjent",
      expensiveSupplier: entry.priceCheck.mostExpensive?.supplierName ?? "Ukjent",
    }))
    .sort((left, right) => right.spreadNok - left.spreadNok)
    .slice(0, 4);

  const recentMaterialLists = materialListStats.slice(0, 4);
  const recentOrders = orders.slice(0, 4);

  return (
    <div className="space-y-5">
      <section className="relative rounded-md overflow-hidden rounded-[4px] border border-[#1b5136]/20 bg-[#eef1ec] p-4 shadow-[0_20px_48px_rgba(12,33,21,0.08)] sm:p-5">
        <div className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:radial-gradient(rgba(14,92,58,0.26)_0.8px,transparent_0.8px)] [background-size:18px_18px]" />
        <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 -bottom-20 h-60 w-60 rounded-full bg-emerald-900/12 blur-3xl" />

        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-900/70">Min side</p>
            <h1 className="display-font mt-1.5 text-2xl text-[#142118] sm:text-3xl">Oversikt</h1>
            <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[#43524a] sm:text-sm">
              Her ser du status pa materiallister, sammenligninger og bestillinger.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 sm:flex-row">
            <Link
              href="/prosjekter?nyMaterialliste=1"
              className="inline-flex gap-2 h-9 items-center justify-center rounded-[3px] text-white! px-3 bg-[#27a866] hover:bg-[#2eb872] text-xs font-semibold shadow-[0_10px_24px_rgba(10,74,45,0.24)] transition"
            >
              <PlusCircle className="h-4 w-4" />
              Ny materialliste
            </Link>
            <Link
              href="/min-side/materiallister"
              className="inline-flex h-9 items-center justify-center rounded-[3px] border border-[#1c5136]/30 bg-[#f9faf8] px-3 text-xs font-semibold text-[#0f5e3a] transition hover:border-[#0f5e3a]"
            >
              Se materiallister
            </Link>
            <Link
              href="/min-side/bestillinger"
              className="inline-flex h-9 items-center justify-center rounded-[3px] border border-[#1c5136]/30 bg-[#f9faf8] px-3 text-xs font-semibold text-[#0f5e3a] transition hover:border-[#0f5e3a]"
            >
              Se bestillinger
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="AI-materiallister"
          value={`${materialListStats.length}`}
          supporting={`${paidMaterialListCount} klare for handel`}
          tone="neutral"
        />
        <MetricCard
          label="Leverandorsammenligninger"
          value={`${comparedMaterialLists.length}`}
          supporting={`Gj.snitt dekning ${avgCoveragePercent}%`}
          tone="accent"
        />
        <MetricCard
          label="Mulig spart med avtaler"
          value={savingsValue}
          supporting={savingsSupporting}
          tone="accent"
        />
        <MetricCard
          label="Gjennomfort ordreverdi"
          value={formatCurrency(completedOrderValueNok)}
          supporting={`${completedOrders.length} av ${orders.length} ordre`}
          tone="warm"
        />
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.25fr_0.75fr]">
        <article className="border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Ordreutvikling</p>
              <h2 className="mt-1 text-base font-semibold text-stone-900">Siste 6 maneder</h2>
            </div>
            <p className="text-[11px] text-stone-500">Kolonner: NOK · Linje: antall ordre</p>
          </div>

          <OrderTrendChart points={monthlyOrderPoints} />

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <MiniFact label="Total ordreverdi" value={formatCurrency(totalOrderValueNok)} />
            <MiniFact label="Aktive ordre" value={`${openOrders.length}`} />
            <MiniFact label="Avvik" value={`${deviationOrders.length}`} />
          </div>
        </article>

        <article className="rounded-[4px] border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Ordreflyt</p>
              <h2 className="mt-1 text-base font-semibold text-stone-900">Statusfordeling</h2>
            </div>
            <p className="text-[11px] text-stone-500">Etter antall ordre</p>
          </div>

          <StatusDonut buckets={statusBuckets} />

          <div className="mt-3 space-y-2">
            {statusBuckets.map((bucket) => (
              <div key={bucket.key} className="rounded-lg border border-stone-200 bg-white px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${bucket.colorClassName}`} />
                    <p className="text-xs font-semibold text-stone-700">{bucket.label}</p>
                  </div>
                  <p className="text-xs font-semibold text-stone-900">{bucket.count} ordre</p>
                </div>
                <p className="mt-1 text-[11px] text-stone-500">{formatCurrency(bucket.valueNok)}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="rounded-[4px] border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-stone-900">Billigst leverandor per liste</h2>
            <p className="text-[11px] text-stone-500">Vinnerfrekvens + sparing</p>
          </div>

          <div className="space-y-2">
            {supplierInsights.map((entry) => {
              const width = `${Math.max(8, Math.round((entry.wins / supplierWinsMax) * 100))}%`;

              return (
                <div key={entry.supplierName} className="rounded-[4px] border border-[#1d4f35]/15 bg-white p-2.5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-stone-900">{entry.supplierName}</p>
                    <p className="text-xs font-semibold text-stone-700">{entry.wins} lister</p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-[3px] bg-emerald-100/70">
                    <div className="h-full rounded-[3px] bg-[#138a54]" style={{ width }} />
                  </div>
                  <p className="mt-1 text-[11px] text-stone-500">Potensiell sparing: {formatCurrency(entry.potentialSavingsNok)}</p>
                </div>
              );
            })}

            {supplierInsights.length === 0 ? (
              <div className="rounded-[4px] border border-[#1d4f35]/15 bg-white p-3 text-sm text-stone-500">
                Ingen sammenligninger med to eller flere leverandorer ennå.
              </div>
            ) : null}
          </div>
        </article>

        <article className="rounded-[4px] border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-stone-900">Storste prisavstand</h2>
            <Link href="/min-side/materiallister" className="text-xs font-semibold text-[#0f5e3a] transition hover:text-[#0a4229]">
              Gå til lister
            </Link>
          </div>

          <div className="space-y-2">
            {spreadProjects.map((project) => (
              <div key={project.slug} className="rounded-[4px] border border-[#1d4f35]/15 bg-white p-2.5">
                <p className="truncate text-xs font-semibold text-stone-900 sm:text-sm">{project.title}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-stone-500">
                  <span>{project.cheapestSupplier} vs {project.expensiveSupplier}</span>
                  <span>Dekning {project.coveragePercent}%</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-stone-900">{formatCurrency(project.spreadNok)}</p>
              </div>
            ))}

            {spreadProjects.length === 0 ? (
              <div className="rounded-[4px] border border-[#1d4f35]/15 bg-white p-3 text-sm text-stone-500">
                Ingen prosjekter med tydelig prisavstand ennå.
              </div>
            ) : null}
          </div>
        </article>
      </section>

      <section className="grid gap-3 rounded-md xl:grid-cols-2">
        <article className="rounded-[4px] border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-stone-900">Siste bestillinger</h2>
            <Link href="/min-side/bestillinger" className="text-xs font-semibold text-[#0f5e3a] transition hover:text-[#0a4229]">
              Alle bestillinger
            </Link>
          </div>

          <div className="space-y-2">
            {recentOrders.map((order) => (
              <div key={order.id} className="rounded-[4px] border border-[#1d4f35]/15 bg-white p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-stone-900">Bestilling #{order.id.slice(0, 8)}</p>
                  {renderOrderStatusPill(order.status)}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-stone-500">
                  <span>{formatDate(order.created_at)}</span>
                  <span className="font-semibold text-stone-700">{formatCurrency(order.total_nok)}</span>
                </div>
              </div>
            ))}

            {recentOrders.length === 0 ? (
              <div className="rounded-[4px] border border-[#1d4f35]/15 bg-white p-3 text-sm text-stone-500">
                Ingen bestillinger registrert ennå.
              </div>
            ) : null}
          </div>
        </article>

        <article className="rounded-[4px] border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-stone-900">Nye materiallister</h2>
            <Link href="/min-side/materiallister" className="text-xs font-semibold text-[#0f5e3a] transition hover:text-[#0a4229]">
              Alle lister
            </Link>
          </div>

          <div className="space-y-2">
            {recentMaterialLists.map((entry) => (
              <div key={entry.materialList.slug} className="rounded-[4px] border border-[#1d4f35]/15 bg-white p-2.5">
                <p className="truncate text-xs font-semibold text-stone-900 sm:text-sm">{entry.materialList.title}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-stone-500">
                  <span>{entry.lineCount} linjer</span>
                  <span>{entry.priceCheck.quotes.length} leverandorer sammenlignet</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-stone-900">
                  Potensiell sparing: {formatCurrency(entry.priceCheck.potentialSavingsNok)}
                </p>
              </div>
            ))}

            {recentMaterialLists.length === 0 ? (
              <div className="rounded-[4px] border border-[#1d4f35]/15 bg-white p-3 text-sm text-stone-500">
                Ingen materiallister registrert ennå.
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  supporting,
  tone,
}: {
  label: string;
  value: string;
  supporting: string;
  tone: "neutral" | "accent" | "warm";
}) {
  const toneClassName =
    tone === "accent"
      ? "border-emerald-300/45 bg-emerald-50/80"
      : tone === "warm"
        ? "border-amber-300/45 bg-amber-50/75"
        : "border-[#1d4f35]/15 bg-[#f6f8f4]";

  const markerClassName =
    tone === "accent"
      ? "bg-[#1fa060]"
      : tone === "warm"
        ? "bg-[#b57a2f]"
        : "bg-[#0f5e3a]";

  return (
    <article className={`rounded-[4px] border px-3 py-2.5 shadow-[0_10px_24px_rgba(13,34,22,0.06)] ${toneClassName}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`h-2.5 w-2.5 rounded-[2px] ${markerClassName}`} />
        <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">{label}</p>
      </div>
      <p className="mt-1.5 text-xl font-semibold text-[#111a14]">{value}</p>
      <p className="mt-1 text-[11px] text-stone-600">{supporting}</p>
    </article>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[4px] border border-[#1d4f35]/15 bg-white px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function StatusDonut({ buckets }: { buckets: StatusBucket[] }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  if (total === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-[4px] border border-dashed border-[#1d4f35]/30 bg-white text-sm text-stone-500">
        Ingen ordre enda
      </div>
    );
  }

  const [completed, open, deviation] = buckets;
  const completedEnd = Math.round((completed.count / total) * 100);
  const openEnd = completedEnd + Math.round((open.count / total) * 100);

  const gradient = `conic-gradient(${completed.colorHex} 0% ${completedEnd}%, ${open.colorHex} ${completedEnd}% ${openEnd}%, ${deviation.colorHex} ${openEnd}% 100%)`;

  return (
    <div className="flex items-center justify-center rounded-[4px] border border-[#1d4f35]/15 bg-white py-5">
      <div className="relative h-32 w-32 rounded-[999px]" style={{ background: gradient }}>
        <div className="absolute inset-4 flex items-center justify-center rounded-[999px] bg-white">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-[0.12em] text-stone-500">Totalt</p>
            <p className="text-xl font-semibold text-stone-900">{total}</p>
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
    const y = 100 - Math.round((point.orderCount / maxCount) * 100);
    return { x, y };
  });

  const path = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

  return (
    <div className="rounded-[4px] border border-[#1d4f35]/15 bg-white p-2.5">
      <div className="relative h-44">
        <div className="absolute inset-0 flex items-end gap-1.5">
          {points.map((point) => {
            const height = `${Math.max(6, Math.round((point.totalNok / maxValue) * 100))}%`;

            return (
              <div key={point.key} className="flex h-full flex-1 items-end justify-center">
                <div className="w-7 rounded-t-[3px] bg-[#116b42]/85" style={{ height }} />
              </div>
            );
          })}
        </div>

        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <path d={path} fill="none" stroke="#047857" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          {chartPoints.map((point, index) => (
            <circle
              key={points[index]?.key ?? `${index}`}
              cx={point.x}
              cy={point.y}
              r="1.8"
              fill="#047857"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      <div className="mt-2 grid grid-cols-6 gap-1.5 text-center">
        {points.map((point) => (
          <div key={`${point.key}-label`}>
            <p className="text-[10px] font-semibold text-stone-700">{point.orderCount}</p>
            <p className="text-[10px] uppercase tracking-[0.08em] text-stone-500">{point.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderOrderStatusPill(status: OrderSummaryRow["status"]) {
  const statusMap: Record<OrderSummaryRow["status"], { label: string; className: string }> = {
    draft: { label: "Kladd", className: "bg-stone-100 text-stone-700" },
    pending_payment: { label: "Pending", className: "bg-amber-100 text-amber-800" },
    paid: { label: "Betalt", className: "bg-emerald-100 text-emerald-800" },
    submitted: { label: "Sendt", className: "bg-sky-100 text-sky-800" },
    cancelled: { label: "Avbrutt", className: "bg-rose-100 text-rose-800" },
    failed: { label: "Feilet", className: "bg-red-100 text-red-800" },
  };

  const entry = statusMap[status];

  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${entry.className}`}>
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

function buildSupplierInsights(
  materialListStats: Array<{
    materialList: ProjectView;
    priceCheck: Awaited<ReturnType<typeof calculatePriceCheck>>;
    lineCount: number;
  }>,
): SupplierInsight[] {
  const bySupplier = new Map<string, SupplierInsight>();

  for (const entry of materialListStats) {
    if (!entry.priceCheck.cheapest || entry.priceCheck.quotes.length < 2) {
      continue;
    }

    const supplierName = entry.priceCheck.cheapest.supplierName;
    const current = bySupplier.get(supplierName) ?? {
      supplierName,
      wins: 0,
      potentialSavingsNok: 0,
    };

    current.wins += 1;
    current.potentialSavingsNok += entry.priceCheck.potentialSavingsNok;

    bySupplier.set(supplierName, current);
  }

  return Array.from(bySupplier.values()).sort((left, right) => {
    if (right.wins === left.wins) {
      return right.potentialSavingsNok - left.potentialSavingsNok;
    }

    return right.wins - left.wins;
  });
}
