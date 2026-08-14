import Link from "next/link";

import { requireAdminUser } from "@/lib/admin-auth";
import {
  carrierLabel,
  detectOrderIssues,
  formatDateNo,
  formatHours,
  hoursInStage,
  LOGISTICS_STAGES,
  matchesSearch,
  orderReference,
  stageForTransportStatus,
  type ByggmakkerState,
  type LogisticsOrder,
  type OrderIssue,
} from "@/lib/shop-order-logistics";
import { fetchByggmakkerStates, LOGISTICS_ORDER_COLUMNS } from "@/lib/shop-order-logistics-admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { BTN_PRIMARY, BTN_SECONDARY, PageHeader, StatCard, nok } from "../../_components/ui";
import { LogisticsBoard, type BoardCard, type BoardColumn } from "./_components/logistics-board";

/** Hvor lenge en levert ordre blir stående i «Levert»-kolonnen. */
const DELIVERED_WINDOW_DAYS = 14;
const QUEUE_LIMIT = 250;

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function LogistikkPage({ searchParams }: PageProps) {
  await requireAdminUser();

  const { q = "" } = await searchParams;
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return <div className="p-8 text-sm text-stone-600">Database ikke konfigurert.</div>;
  }

  const { data: orderRows } = await supabase
    .from("shop_orders")
    .select(LOGISTICS_ORDER_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(QUEUE_LIMIT)
    .returns<LogisticsOrder[]>();

  const orders = orderRows ?? [];
  const orderIds = orders.map((order) => order.id);

  const [byggmakkerStates, { data: itemRows }] = await Promise.all([
    fetchByggmakkerStates(supabase, orderIds),
    orderIds.length > 0
      ? supabase
          .from("shop_order_items")
          .select("order_id")
          .in("order_id", orderIds)
          .returns<{ order_id: string }[]>()
      : Promise.resolve({ data: [] as { order_id: string }[] }),
  ]);

  const lineCounts = new Map<string, number>();
  for (const row of itemRows ?? []) {
    lineCounts.set(row.order_id, (lineCounts.get(row.order_id) ?? 0) + 1);
  }

  const now = new Date();
  const analyzed = orders.map((order) => {
    const byggmakkerState: ByggmakkerState = byggmakkerStates.get(order.id) ?? "none";
    return {
      order,
      issues: detectOrderIssues(order, { byggmakkerState, now }),
      stage: stageForTransportStatus(order.transport_status),
      hours: hoursInStage(order, now),
      lineCount: lineCounts.get(order.id) ?? 0,
    };
  });

  const matching = analyzed.filter((entry) => matchesSearch(entry.order, q));

  /* ── Tallene øverst ──────────────────────────────────────────────────── */

  const activeOrders = analyzed.filter(
    (entry) =>
      (entry.order.status === "paid" || entry.order.status === "fulfilled") &&
      entry.order.transport_status !== "cancelled" &&
      entry.order.transport_status !== "delivered",
  );

  const needsAttention = analyzed.filter((entry) =>
    entry.issues.some((issue) => issue.severity === "high"),
  );

  const inTransit = activeOrders.filter((entry) => entry.stage?.id === "transit");

  const deliveredCutoff = now.getTime() - 7 * 86_400_000;
  const deliveredLast7 = analyzed.filter(
    (entry) =>
      entry.order.transport_status === "delivered" &&
      entry.order.delivered_at != null &&
      new Date(entry.order.delivered_at).getTime() >= deliveredCutoff,
  );

  const valueInProgress = activeOrders.reduce((sum, entry) => sum + entry.order.total_nok, 0);

  /* ── Kolonner ────────────────────────────────────────────────────────── */

  const deliveredWindowStart = now.getTime() - DELIVERED_WINDOW_DAYS * 86_400_000;

  const columns: BoardColumn[] = LOGISTICS_STAGES.map((stage) => {
    const inStage = matching.filter(
      (entry) =>
        entry.stage?.id === stage.id &&
        (entry.order.status === "paid" || entry.order.status === "fulfilled"),
    );

    const visible =
      stage.id === "levert"
        ? inStage.filter((entry) => {
            const at = entry.order.delivered_at ?? entry.order.shipped_at;
            return at != null && new Date(at).getTime() >= deliveredWindowStart;
          })
        : inStage;

    // Eldste først: det som har stått lengst i køen skal håndteres først.
    const sorted = [...visible].sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0));

    return {
      id: stage.id,
      label: stage.label,
      description: stage.description,
      accent: stage.accent,
      hiddenCount: inStage.length - visible.length,
      cards: sorted.map((entry): BoardCard => {
        const { order } = entry;
        const overdue =
          entry.hours != null && Number.isFinite(stage.slaHours) && entry.hours > stage.slaHours;

        return {
          id: order.id,
          reference: orderReference(order),
          href: `/sjefen/logistikk/${order.id}`,
          customerName: order.customer_name,
          place: `${order.shipping_postal_code} ${order.shipping_city}`.trim(),
          totalLabel: nok(order.total_nok),
          lineCount: entry.lineCount,
          ageLabel: entry.hours != null ? formatHours(entry.hours) : null,
          overdue,
          issues: entry.issues.map((issue) => ({ severity: issue.severity, label: issue.label })),
          carrierLabel: carrierLabel(order.carrier_code, order.carrier),
          trackingNumber: order.tracking_number,
          etaLabel: order.estimated_delivery_date ? formatDateNo(order.estimated_delivery_date) : null,
          nextActionLabel: stage.actionLabel,
        };
      }),
    };
  });

  const attentionList = matching
    .filter((entry) => entry.issues.length > 0)
    .sort((a, b) => severityScore(b.issues) - severityScore(a.issues))
    .slice(0, 12);

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Arbeidskø"
        title="Logistikk"
        description="Butikkordre fra betalt til levert på døra."
        actions={
          <form className="flex gap-2" action="/sjefen/logistikk">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Søk ordre, kunde, sporing, sted …"
              className="h-10 w-72 border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-[#163f2a]"
            />
            <button type="submit" className={BTN_PRIMARY}>
              Søk
            </button>
            {q ? (
              <Link href="/sjefen/logistikk" className={BTN_SECONDARY}>
                Nullstill
              </Link>
            ) : null}
          </form>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Krever handling"
          value={String(needsAttention.length)}
          sub="avvik med høy alvorlighet"
          tone={needsAttention.length > 0 ? "danger" : "neutral"}
        />
        <StatCard label="Under arbeid" value={String(activeOrders.length)} sub="betalt, ikke levert" />
        <StatCard label="I transit" value={String(inTransit.length)} sub="sendt til kunde" />
        <StatCard label="Levert (7 d)" value={String(deliveredLast7.length)} sub="fullførte leveranser" tone="good" />
        <StatCard label="Verdi under arbeid" value={nok(valueInProgress)} sub="ordreverdi ikke levert" />
      </section>

      {attentionList.length > 0 ? (
        <section className="border border-stone-200 bg-white">
          <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3.5">
            <h2 className="text-sm font-bold text-stone-900">Avvik som bør ryddes</h2>
            <span className="text-xs text-stone-400">{attentionList.length} ordre</span>
          </header>
          <ul className="divide-y divide-stone-100">
            {attentionList.map((entry) => {
              const top = entry.issues[0];
              return (
                <li key={entry.order.id}>
                  <Link
                    href={`/sjefen/logistikk/${entry.order.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition hover:bg-stone-50"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        top.severity === "high"
                          ? "bg-red-500"
                          : top.severity === "medium"
                            ? "bg-[#d9ff7a]"
                            : "bg-stone-300"
                      }`}
                    />
                    <span className="font-mono text-xs font-bold text-stone-900">
                      {orderReference(entry.order)}
                    </span>
                    <span className="text-xs font-semibold text-stone-700">
                      {entry.order.customer_name}
                    </span>
                    <span className="text-xs font-semibold text-stone-900">{top.label}</span>
                    <span className="text-xs text-stone-400">{top.detail}</span>
                    {entry.issues.length > 1 ? (
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-500">
                        +{entry.issues.length - 1} til
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs font-semibold tabular-nums text-stone-500">
                      {nok(entry.order.total_nok)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {q ? (
        <p className="text-xs text-stone-500">
          Viser treff på «{q}» — {matching.length} av {analyzed.length} ordre.
        </p>
      ) : null}

      <LogisticsBoard columns={columns} />
    </div>
  );
}

function severityScore(issues: OrderIssue[]) {
  return issues.reduce(
    (score, issue) => score + (issue.severity === "high" ? 100 : issue.severity === "medium" ? 10 : 1),
    0,
  );
}


