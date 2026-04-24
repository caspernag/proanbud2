import Link from "next/link";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type MatOrder = {
  id: string;
  project_id: string;
  status: "draft" | "pending_payment" | "paid" | "submitted" | "cancelled" | "failed";
  total_nok: number;
  created_at: string;
  paid_at: string | null;
  earliest_delivery_date: string | null;
  latest_delivery_date: string | null;
  delivery_mode: "delivery" | "pickup";
};

type ShopOrder = {
  id: string;
  status: "draft" | "pending_payment" | "paid" | "fulfilled" | "cancelled" | "failed";
  total_nok: number;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  shipping_city: string;
  customer_name: string;
};

type ProjectRow = { id: string; title: string };

type UnifiedOrder = {
  id: string;
  type: "material" | "shop";
  title: string;
  statusRaw: string;
  totalNok: number;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  deliveryWindowLabel: string | null;
  shippingSteps: (0 | 1)[];
  href: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(v: string) {
  return new Date(v).toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

function matShippingSteps(status: MatOrder["status"]): (0 | 1)[] {
  const paid = status === "paid" || status === "submitted";
  const sent = status === "submitted";
  return [1, paid ? 1 : 0, sent ? 1 : 0, 0];
}

function shopShippingSteps(status: ShopOrder["status"]): (0 | 1)[] {
  const paid = status === "paid" || status === "fulfilled";
  const delivered = status === "fulfilled";
  return [1, paid ? 1 : 0, paid ? 1 : 0, delivered ? 1 : 0];
}

const STEP_LABELS = ["Mottatt", "Betalt", "Sendt", "Levert"];

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  draft:           { label: "Kladd",           cls: "bg-stone-100 text-stone-600" },
  pending_payment: { label: "Venter betaling",  cls: "bg-amber-100 text-amber-700" },
  paid:            { label: "Betalt",           cls: "bg-emerald-100 text-emerald-800" },
  submitted:       { label: "Sendt",            cls: "bg-sky-100 text-sky-800" },
  fulfilled:       { label: "Levert",           cls: "bg-emerald-100 text-emerald-800" },
  cancelled:       { label: "Avbrutt",          cls: "bg-rose-100 text-rose-700" },
  failed:          { label: "Feilet",           cls: "bg-red-100 text-red-700" },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BestillingerPage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-stone-800">
        Database ikke konfigurert.
      </p>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <p className="text-sm text-stone-600">Logg inn for å se bestillinger.</p>
        <Link
          href="/login?next=/min-side/bestillinger"
          className="mt-3 inline-flex h-9 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Logg inn
        </Link>
      </div>
    );
  }

  const [{ data: matRows }, { data: shopRows }] = await Promise.all([
    supabase
      .from("material_orders")
      .select(
        "id, project_id, status, total_nok, created_at, paid_at, earliest_delivery_date, latest_delivery_date, delivery_mode",
      )
      .eq("user_id", user.id)
      .not("status", "in", '("draft","pending_payment")')
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("shop_orders")
      .select("id, status, total_nok, created_at, paid_at, fulfilled_at, shipping_city, customer_name")
      .not("status", "in", '("draft","pending_payment")')
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const matOrders = (matRows ?? []) as MatOrder[];
  const shopOrders = (shopRows ?? []) as ShopOrder[];

  const projectIds = Array.from(new Set(matOrders.map((o) => o.project_id)));
  const { data: projectRows } =
    projectIds.length > 0
      ? await supabase.from("projects").select("id, title").in("id", projectIds)
      : { data: [] as ProjectRow[] };
  const projectMap = new Map((projectRows ?? []).map((p) => [p.id, p.title]));

  const orders: UnifiedOrder[] = [
    ...matOrders.map(
      (o): UnifiedOrder => ({
        id: o.id,
        type: "material",
        title: projectMap.get(o.project_id) ?? "Materialliste",
        statusRaw: o.status,
        totalNok: o.total_nok,
        createdAt: o.created_at,
        paidAt: o.paid_at,
        deliveredAt: null,
        deliveryWindowLabel:
          o.earliest_delivery_date && o.latest_delivery_date
            ? `${fmtDate(o.earliest_delivery_date)} – ${fmtDate(o.latest_delivery_date)}`
            : o.delivery_mode === "pickup"
              ? "Henting i butikk"
              : null,
        shippingSteps: matShippingSteps(o.status),
        href: `/min-side/bestillinger/${o.id}`,
      }),
    ),
    ...shopOrders.map(
      (o): UnifiedOrder => ({
        id: o.id,
        type: "shop",
        title: "Nettbutikk",
        statusRaw: o.status,
        totalNok: o.total_nok,
        createdAt: o.created_at,
        paidAt: o.paid_at,
        deliveredAt: o.fulfilled_at,
        deliveryWindowLabel: o.fulfilled_at ? `Levert ${fmtDate(o.fulfilled_at)}` : o.shipping_city ? `Leveres til ${o.shipping_city}` : null,
        shippingSteps: shopShippingSteps(o.status),
        href: `/min-side/bestillinger/${o.id}`,
      }),
    ),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Bestillinger</h1>
          <p className="mt-0.5 text-xs text-stone-500">{orders.length} ordre totalt</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-stone-900">Ingen bestillinger enda</p>
          <p className="mt-1 text-xs text-stone-500">Fullfør en betaling for å se bestillingene dine her.</p>
          <Link
            href="/"
            className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            Gå til nettbutikk
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {orders.map((order) => {
            const pill = STATUS_PILL[order.statusRaw] ?? { label: order.statusRaw, cls: "bg-stone-100 text-stone-600" };
            return (
              <li key={order.id}>
                <Link
                  href={order.href}
                  className="group flex items-center gap-4 rounded-2xl border border-stone-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-stone-300 hover:shadow-md sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${pill.cls}`}>
                        {pill.label}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          order.type === "shop" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {order.type === "shop" ? "Nettbutikk" : "Materialliste"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-stone-900">
                      {order.title}
                      <span className="ml-1.5 text-xs font-normal text-stone-400">#{order.id.slice(0, 8)}</span>
                    </p>
                    {order.deliveryWindowLabel && (
                      <p className="mt-0.5 text-[11px] text-stone-500">
                        <span className="mr-1 inline-block">🚚</span>
                        {order.deliveryWindowLabel}
                      </p>
                    )}
                  </div>

                  <div className="hidden sm:block">
                    <ShippingProgress steps={order.shippingSteps} />
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-stone-900">{formatCurrency(order.totalNok)}</p>
                    <p className="text-[11px] text-stone-400">{fmtDate(order.createdAt)}</p>
                  </div>

                  <svg
                    className="hidden h-4 w-4 shrink-0 text-stone-400 transition group-hover:text-stone-700 sm:block"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17 17 7M7 7h10v10" />
                  </svg>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ShippingProgress({ steps }: { steps: (0 | 1)[] }) {
  return (
    <div
      className="flex items-center gap-1"
      title={STEP_LABELS.map((l, i) => `${l}: ${steps[i] ? "✓" : "○"}`).join(" · ")}
    >
      {steps.map((done, i) => (
        <div key={i} className="flex items-center gap-1">
          <div
            className={`h-2 w-2 rounded-full ${done ? "bg-emerald-500" : "bg-stone-200"}`}
            title={STEP_LABELS[i]}
          />
          {i < steps.length - 1 && (
            <div className={`h-px w-5 ${steps[i] && steps[i + 1] ? "bg-emerald-400" : "bg-stone-200"}`} />
          )}
        </div>
      ))}
      <span className="ml-1.5 hidden text-[10px] text-stone-400 lg:inline">
        {STEP_LABELS[steps.lastIndexOf(1 as 0 | 1)] ?? STEP_LABELS[0]}
      </span>
    </div>
  );
}
