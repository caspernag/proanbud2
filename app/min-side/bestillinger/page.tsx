import Link from "next/link";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

type OrderRow = {
  id: string;
  project_id: string;
  status: "draft" | "pending_payment" | "paid" | "submitted" | "cancelled" | "failed";
  total_nok: number;
  subtotal_nok: number;
  delivery_fee_nok: number;
  vat_nok: number;
  delivery_mode: "delivery" | "pickup";
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  submitted_at: string | null;
  earliest_delivery_date: string | null;
  latest_delivery_date: string | null;
};

type OrderItemRow = {
  order_id: string;
  supplier_label: string;
  is_included: boolean;
};

type ProjectLookupRow = {
  id: string;
  title: string;
  slug: string;
};

type StatusBucket = {
  key: "open" | "completed" | "deviation";
  label: string;
  detail: string;
  count: number;
  valueNok: number;
  colorClassName: string;
};

export default async function BestillingerPage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <section className="rounded-md border border-amber-300/50 bg-amber-50 p-4 text-sm text-stone-800 shadow-[0_10px_24px_rgba(51,36,12,0.08)]">
        Supabase er ikke konfigurert. Bestillingsoversikt krever database.
      </section>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <section className="rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-5 shadow-[0_12px_30px_rgba(13,34,22,0.06)]">
        <h1 className="display-font text-xl font-semibold text-stone-900">Bestillinger</h1>
        <p className="mt-2 text-xs text-stone-600 sm:text-sm">Logg inn for full oversikt over ordrestatus og okonomi.</p>
        <Link
          href="/login?next=/min-side/bestillinger"
          className="mt-4 inline-flex h-8 items-center rounded-[3px] bg-[#2eb872] px-3 text-xs font-semibold text-white transition hover:bg-[#27a866]"
        >
          Logg inn
        </Link>
      </section>
    );
  }

  const { data: orderRows } = await supabase
    .from("material_orders")
    .select(
      "id, project_id, status, total_nok, subtotal_nok, delivery_fee_nok, vat_nok, delivery_mode, created_at, updated_at, paid_at, submitted_at, earliest_delivery_date, latest_delivery_date",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const orders = (orderRows ?? []) as OrderRow[];
  const orderIds = orders.map((order) => order.id);
  const projectIds = Array.from(new Set(orders.map((order) => order.project_id)));

  const [{ data: itemRows }, { data: projectRows }] = await Promise.all([
    orderIds.length > 0
      ? supabase
          .from("material_order_items")
          .select("order_id, supplier_label, is_included")
          .eq("user_id", user.id)
          .in("order_id", orderIds)
      : Promise.resolve({ data: [] as OrderItemRow[] }),
    projectIds.length > 0
      ? supabase
          .from("projects")
          .select("id, title, slug")
          .eq("user_id", user.id)
          .in("id", projectIds)
      : Promise.resolve({ data: [] as ProjectLookupRow[] }),
  ]);

  const projectById = new Map((projectRows ?? []).map((project) => [project.id, project]));
  const itemRowsByOrderId = new Map<string, OrderItemRow[]>();

  for (const row of (itemRows ?? []) as OrderItemRow[]) {
    const rows = itemRowsByOrderId.get(row.order_id) ?? [];
    rows.push(row);
    itemRowsByOrderId.set(row.order_id, rows);
  }

  const openOrders = orders.filter((order) => order.status === "draft" || order.status === "pending_payment");
  const completedOrders = orders.filter((order) => order.status === "paid" || order.status === "submitted");
  const deviationOrders = orders.filter((order) => order.status === "cancelled" || order.status === "failed");

  const totalOrderValueNok = orders.reduce((total, order) => total + order.total_nok, 0);
  const openValueNok = openOrders.reduce((total, order) => total + order.total_nok, 0);
  const completedValueNok = completedOrders.reduce((total, order) => total + order.total_nok, 0);
  const deviationValueNok = deviationOrders.reduce((total, order) => total + order.total_nok, 0);

  const statusBuckets: StatusBucket[] = [
    {
      key: "open",
      label: "Apne",
      detail: "Kladd + venter betaling",
      count: openOrders.length,
      valueNok: openValueNok,
      colorClassName: "bg-amber-500",
    },
    {
      key: "completed",
      label: "Gjennomforte",
      detail: "Betalt + sendt",
      count: completedOrders.length,
      valueNok: completedValueNok,
      colorClassName: "bg-emerald-600",
    },
    {
      key: "deviation",
      label: "Avvik",
      detail: "Avbrutt + feilet",
      count: deviationOrders.length,
      valueNok: deviationValueNok,
      colorClassName: "bg-rose-600",
    },
  ];

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-md border border-[#1b5136]/20 bg-[#eef1ec] p-4 shadow-[0_20px_48px_rgba(12,33,21,0.08)] sm:p-5">
        <div className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:radial-gradient(rgba(14,92,58,0.26)_0.8px,transparent_0.8px)] [background-size:18px_18px]" />
        <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 -bottom-20 h-60 w-60 rounded-full bg-emerald-900/12 blur-3xl" />

        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-900/70">Bestillinger</p>
          <h1 className="display-font mt-1.5 text-2xl text-[#142118] sm:text-3xl">Total ordre-kontroll</h1>
          <p className="mt-1.5 max-w-3xl text-xs leading-5 text-[#43524a] sm:text-sm">
          Verdi-forst oversikt over ordreflyt, risiko og gjennomfort volum per bestilling.
          </p>
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total ordreverdi" value={formatCurrency(totalOrderValueNok)} />
        <MetricCard label="Gjennomfort verdi" value={formatCurrency(completedValueNok)} tone="accent" />
        <MetricCard label="Apen verdi" value={formatCurrency(openValueNok)} tone="warm" />
        <MetricCard label="Avviksverdi" value={formatCurrency(deviationValueNok)} tone="danger" />
        <MetricCard label="Antall bestillinger" value={`${orders.length}`} tone="neutral" />
      </section>

      <section className="grid gap-3 xl:grid-cols-[0.72fr_1.28fr]">
        <article className="rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
          <h2 className="text-base font-semibold text-stone-900">Statusfordeling</h2>
          <p className="mt-1 text-xs text-stone-600">Tre grupper med fokus pa verdiandel, ikke bare antall.</p>
          <div className="mt-2.5 space-y-2">
            {statusBuckets.map((bucket) => (
              <StatusValueBar key={bucket.key} bucket={bucket} totalValueNok={totalOrderValueNok} />
            ))}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-[#1d4f35]/15 bg-white px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Gjennomfort andel</p>
              <p className="mt-1 text-base font-semibold text-stone-900">
                {totalOrderValueNok > 0 ? `${Math.round((completedValueNok / totalOrderValueNok) * 100)}%` : "0%"}
              </p>
            </div>
            <div className="rounded-md border border-[#1d4f35]/15 bg-white px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Apen risiko</p>
              <p className="mt-1 text-base font-semibold text-stone-900">{formatCurrency(openValueNok)}</p>
            </div>
          </div>
        </article>

        <article className="overflow-hidden rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-0 shadow-[0_12px_30px_rgba(13,34,22,0.06)]">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-[#1d4f35]/15 bg-emerald-50/70 text-[10px] uppercase tracking-[0.1em] text-emerald-900/70 sm:text-xs">
                <tr>
                  <th className="px-3 py-2.5">Ordre og prosjekt</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Levering</th>
                  <th className="px-3 py-2.5 text-right">Verdi</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const project = projectById.get(order.project_id);
                  const rows = itemRowsByOrderId.get(order.id) ?? [];
                  const includedRows = rows.filter((row) => row.is_included).length;
                  const supplierCount = new Set(rows.map((row) => row.supplier_label)).size;
                  const orderHref = project?.slug ? `/min-side/materiallister/${project.slug}/bestilling?order=${order.id}` : null;
                  const windowLabel = order.earliest_delivery_date && order.latest_delivery_date
                    ? `${new Date(order.earliest_delivery_date).toLocaleDateString("nb-NO")} - ${new Date(order.latest_delivery_date).toLocaleDateString("nb-NO")}`
                    : "Ikke satt";

                  return (
                    <tr
                      key={order.id}
                      className={`border-b border-[#1d4f35]/10 last:border-b-0 ${orderHref ? "hover:bg-emerald-50/55" : ""}`}
                    >
                      <td className="p-0">
                        {orderHref ? (
                          <Link href={orderHref} className="block px-3 py-2.5">
                            <p className="font-semibold text-stone-900">#{order.id.slice(0, 8)}</p>
                            <p className="mt-0.5 font-medium text-stone-800">{project?.title ?? "Slettet materialliste"}</p>
                            <p className="text-[11px] text-stone-500">
                              {(project?.slug ?? "Ingen slug")} - {includedRows} aktive linjer
                            </p>
                          </Link>
                        ) : (
                          <div className="px-3 py-2.5">
                            <p className="font-semibold text-stone-900">#{order.id.slice(0, 8)}</p>
                            <p className="mt-0.5 font-medium text-stone-800">{project?.title ?? "Slettet materialliste"}</p>
                            <p className="text-[11px] text-stone-500">Ingen tilgjengelig lenke</p>
                          </div>
                        )}
                      </td>
                      <td className="p-0">
                        {orderHref ? (
                          <Link href={orderHref} className="block px-3 py-2.5">
                            {renderStatusPill(order.status)}
                            <p className="mt-1 text-[11px] text-stone-500">Oppdatert {formatOrderDate(order.updated_at)}</p>
                          </Link>
                        ) : (
                          <div className="px-3 py-2.5">
                            {renderStatusPill(order.status)}
                            <p className="mt-1 text-[11px] text-stone-500">Oppdatert {formatOrderDate(order.updated_at)}</p>
                          </div>
                        )}
                      </td>
                      <td className="p-0">
                        {orderHref ? (
                          <Link href={orderHref} className="block px-3 py-2.5">
                            <p className="text-xs text-stone-700 sm:text-sm">{order.delivery_mode === "delivery" ? "Levering" : "Henting"}</p>
                            <p className="text-[11px] text-stone-500">{windowLabel}</p>
                            <p className="text-[11px] text-stone-500">{supplierCount} leverandorer</p>
                          </Link>
                        ) : (
                          <div className="px-3 py-2.5">
                            <p className="text-xs text-stone-700 sm:text-sm">{order.delivery_mode === "delivery" ? "Levering" : "Henting"}</p>
                            <p className="text-[11px] text-stone-500">{windowLabel}</p>
                            <p className="text-[11px] text-stone-500">{supplierCount} leverandorer</p>
                          </div>
                        )}
                      </td>
                      <td className="p-0 text-right">
                        {orderHref ? (
                          <Link href={orderHref} className="block px-3 py-2.5">
                            <p className="font-semibold text-stone-900">{formatCurrency(order.total_nok)}</p>
                            <p className="text-[11px] text-stone-500">Eks. frakt {formatCurrency(order.subtotal_nok)}</p>
                          </Link>
                        ) : (
                          <div className="px-3 py-2.5">
                            <p className="font-semibold text-stone-900">{formatCurrency(order.total_nok)}</p>
                            <p className="text-[11px] text-stone-500">Eks. frakt {formatCurrency(order.subtotal_nok)}</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-sm text-stone-500">
                      Ingen bestillinger ennå.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "accent" | "warm" | "danger";
}) {
  const toneClassName =
    tone === "accent"
      ? "border-emerald-300/45 bg-emerald-50/80"
      : tone === "warm"
        ? "border-orange-300/45 bg-orange-50/75"
        : tone === "danger"
          ? "border-rose-300/45 bg-rose-50/75"
          : "border-[#1d4f35]/15 bg-[#f6f8f4]";

  const markerClassName =
    tone === "accent"
      ? "bg-[#1fa060]"
      : tone === "warm"
        ? "bg-[#b57a2f]"
        : tone === "danger"
          ? "bg-[#d24e66]"
          : "bg-[#0f5e3a]";

  return (
    <article className={`rounded-md border px-3 py-2.5 shadow-[0_10px_24px_rgba(13,34,22,0.06)] ${toneClassName}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`h-2.5 w-2.5 rounded-[2px] ${markerClassName}`} />
        <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">{label}</p>
      </div>
      <p className="mt-1.5 text-xl font-semibold text-[#111a14]">{value}</p>
    </article>
  );
}

function StatusValueBar({
  bucket,
  totalValueNok,
}: {
  bucket: StatusBucket;
  totalValueNok: number;
}) {
  const sharePercent =
    totalValueNok > 0 ? Math.max(0, Math.round((bucket.valueNok / totalValueNok) * 100)) : 0;
  const width = `${bucket.valueNok > 0 ? Math.max(6, sharePercent) : 0}%`;

  return (
    <div className="rounded-md border border-[#1d4f35]/15 bg-white p-2.5">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-stone-800">{bucket.label}</span>
        <span className="font-semibold text-stone-900">{formatCurrency(bucket.valueNok)}</span>
      </div>
      <p className="mb-1 text-[11px] text-stone-500">{bucket.detail}</p>
      <div className="h-2 overflow-hidden rounded-[3px] bg-stone-100">
        <div className={`h-full rounded-[3px] ${bucket.colorClassName}`} style={{ width }} />
      </div>
      <p className="mt-1 text-[11px] text-stone-600">
        {bucket.count} ordre - {sharePercent}% av total verdi
      </p>
    </div>
  );
}

function formatOrderDate(value: string) {
  return new Date(value).toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function renderStatusPill(status: OrderRow["status"]) {
  const statusMap: Record<OrderRow["status"], { label: string; className: string }> = {
    draft: { label: "Kladd", className: "bg-stone-100 text-stone-700" },
    pending_payment: { label: "Pending", className: "bg-amber-100 text-amber-800" },
    paid: { label: "Betalt", className: "bg-emerald-100 text-emerald-800" },
    submitted: { label: "Sendt", className: "bg-sky-100 text-sky-800" },
    cancelled: { label: "Avbrutt", className: "bg-rose-100 text-rose-800" },
    failed: { label: "Feilet", className: "bg-red-100 text-red-800" },
  };

  const entry = statusMap[status];

  return <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${entry.className}`}>{entry.label}</span>;
}
