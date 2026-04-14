import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

type BestillingDetaljPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

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

type ProjectRow = {
  id: string;
  title: string;
  slug: string;
};

type OrderItemSummaryRow = {
  supplier_label: string;
  is_included: boolean;
};

export default async function BestillingDetaljPage({ params }: BestillingDetaljPageProps) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <section className="rounded-md border border-amber-300/50 bg-amber-50 p-4 text-sm text-stone-800 shadow-[0_10px_24px_rgba(51,36,12,0.08)]">
        Supabase er ikke konfigurert. Bestillingsdetaljer krever database.
      </section>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/min-side/bestillinger/${slug}`)}`);
  }

  const { data: orderData } = await supabase
    .from("material_orders")
    .select(
      "id, project_id, status, total_nok, subtotal_nok, delivery_fee_nok, vat_nok, delivery_mode, created_at, updated_at, paid_at, submitted_at, earliest_delivery_date, latest_delivery_date",
    )
    .eq("id", slug)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!orderData) {
    notFound();
  }

  const order = orderData as OrderRow;

  const [{ data: projectData }, { data: itemRows }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, slug")
      .eq("id", order.project_id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("material_order_items")
      .select("supplier_label, is_included")
      .eq("order_id", order.id)
      .eq("user_id", user.id),
  ]);

  const project = (projectData as ProjectRow | null) ?? null;
  const rows = (itemRows ?? []) as OrderItemSummaryRow[];
  const includedRows = rows.filter((row) => row.is_included).length;
  const supplierCount = new Set(rows.map((row) => row.supplier_label)).size;
  const canOpenReturnPortal = order.status === "paid" || order.status === "submitted";
  const returnHref = `/min-side/retur?order=${order.id}`;
  const orderWorkspaceHref = project?.slug ? `/min-side/materiallister/${project.slug}/bestilling?order=${order.id}` : null;
  const windowLabel =
    order.earliest_delivery_date && order.latest_delivery_date
      ? `${new Date(order.earliest_delivery_date).toLocaleDateString("nb-NO")} - ${new Date(order.latest_delivery_date).toLocaleDateString("nb-NO")}`
      : "Ikke satt";

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-md border border-[#1b5136]/20 bg-[#eef1ec] p-4 shadow-[0_20px_48px_rgba(12,33,21,0.08)] sm:p-5">
        <div className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:radial-gradient(rgba(14,92,58,0.26)_0.8px,transparent_0.8px)] [background-size:18px_18px]" />
        <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 -bottom-20 h-60 w-60 rounded-full bg-emerald-900/12 blur-3xl" />

        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-900/70">Bestilling</p>
            <h1 className="display-font mt-1.5 text-2xl text-[#142118] sm:text-3xl">#{order.id.slice(0, 8)}</h1>
            <p className="mt-1 text-xs text-[#43524a] sm:text-sm">{project?.title ?? "Slettet materialliste"}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href="/min-side/bestillinger"
              className="inline-flex h-9 items-center justify-center rounded-[3px] border border-[#1d4f35]/25 bg-white px-3 text-xs font-semibold text-[#0f5e3a] transition hover:border-[#0f5e3a] hover:text-[#0a4229]"
            >
              Til bestillinger
            </Link>
            {orderWorkspaceHref ? (
              <Link
                href={orderWorkspaceHref}
                className="inline-flex h-9 items-center justify-center rounded-[3px] border border-[#1d4f35]/25 bg-white px-3 text-xs font-semibold text-[#0f5e3a] transition hover:border-[#0f5e3a] hover:text-[#0a4229]"
              >
                Apne bestillingsworkspace
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Status" value={statusLabel(order.status)} />
        <MetricCard label="Ordreverdi" value={formatCurrency(order.total_nok)} tone="accent" />
        <MetricCard label="Varelinjer" value={`${includedRows}`} tone="neutral" />
        <MetricCard label="Leverandorer" value={`${supplierCount}`} tone="neutral" />
        <MetricCard label="Leveringsvindu" value={windowLabel} tone="warm" />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <article className="rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-4 shadow-[0_12px_30px_rgba(13,34,22,0.06)]">
          <h2 className="text-base font-semibold text-stone-900">Ordresammendrag</h2>
          <div className="mt-3 space-y-2 text-sm text-stone-700">
            <div className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2">
              <span>Subtotal</span>
              <span className="font-semibold text-stone-900">{formatCurrency(order.subtotal_nok)}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2">
              <span>Frakt</span>
              <span className="font-semibold text-stone-900">{formatCurrency(order.delivery_fee_nok)}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2">
              <span>MVA</span>
              <span className="font-semibold text-stone-900">{formatCurrency(order.vat_nok)}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2">
              <span>Totalt</span>
              <span className="font-semibold text-stone-900">{formatCurrency(order.total_nok)}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-stone-500">Oppdatert {formatOrderDate(order.updated_at)}</p>
        </article>

        <article className="rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-4 shadow-[0_12px_30px_rgba(13,34,22,0.06)]">
          <h2 className="text-base font-semibold text-stone-900">Retur og reklamasjon</h2>
          <p className="mt-1 text-xs text-stone-600">Tilgjengelig etter at bestillingen er betalt eller sendt.</p>

          <div className="mt-3 rounded-md border border-stone-200 bg-white p-3">
            <p className="text-sm text-stone-700">
              {canOpenReturnPortal
                ? "Denne bestillingen kan na brukes for retur/reklamasjon."
                : "Retur/reklamasjon blir aktivt nar ordrestatus er Betalt eller Sendt."}
            </p>

            <div className="mt-3">
              {canOpenReturnPortal ? (
                <Link
                  href={returnHref}
                  className="inline-flex h-9 items-center justify-center rounded-[3px] border border-[#1d4f35]/25 bg-white px-3 text-xs font-semibold text-[#0f5e3a] transition hover:border-[#0f5e3a] hover:text-[#0a4229]"
                >
                  Start retur/reklamasjon
                </Link>
              ) : (
                <span className="text-xs font-semibold text-stone-500">Ikke tilgjengelig enda</span>
              )}
            </div>
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
  tone?: "neutral" | "accent" | "warm";
}) {
  const toneClassName =
    tone === "accent"
      ? "border-emerald-300/45 bg-emerald-50/80"
      : tone === "warm"
        ? "border-orange-300/45 bg-orange-50/75"
        : "border-[#1d4f35]/15 bg-[#f6f8f4]";

  return (
    <article className={`rounded-md border px-3 py-2.5 shadow-[0_10px_24px_rgba(13,34,22,0.06)] ${toneClassName}`}>
      <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">{label}</p>
      <p className="mt-1.5 text-base font-semibold text-[#111a14]">{value}</p>
    </article>
  );
}

function formatOrderDate(value: string) {
  return new Date(value).toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusLabel(status: OrderRow["status"]) {
  if (status === "draft") {
    return "Kladd";
  }

  if (status === "pending_payment") {
    return "Pending";
  }

  if (status === "paid") {
    return "Betalt";
  }

  if (status === "submitted") {
    return "Sendt";
  }

  if (status === "cancelled") {
    return "Avbrutt";
  }

  return "Feilet";
}