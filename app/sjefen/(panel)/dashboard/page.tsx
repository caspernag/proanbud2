import Link from "next/link";

import {
  adminRows,
  collectErrors,
  fetchAllAuthUsers,
  isPaidMaterialStatus,
  isPaidShopStatus,
  requireAdminDb,
} from "@/lib/admin-data";
import {
  detectOrderIssues,
  stageForTransportStatus,
  type LogisticsOrder,
} from "@/lib/shop-order-logistics";
import { fetchByggmakkerStates, LOGISTICS_ORDER_COLUMNS } from "@/lib/shop-order-logistics-admin";

import { OrderStatusBadge, TransportBadge } from "../../_components/status-badges";
import {
  BTN_SECONDARY,
  Card,
  DataErrorBanner,
  EmptyState,
  PageHeader,
  StatCard,
  TableWrap,
  Td,
  Th,
  dateNo,
  nok,
  num,
} from "../../_components/ui";

type MaterialOrder = { id: string; status: string; total_nok: number; created_at: string };
type Project = { id: string; payment_status: string; price_nok: number | null };

export default async function DashboardPage() {
  const db = await requireAdminDb();

  const [shopResult, materialResult, projectResult, usersResult] = await Promise.all([
    adminRows<LogisticsOrder>(
      "Butikkordre",
      db.from("shop_orders").select(LOGISTICS_ORDER_COLUMNS).order("created_at", { ascending: false }).limit(500),
    ),
    adminRows<MaterialOrder>(
      "Materialbestillinger",
      db.from("material_orders").select("id, status, total_nok, created_at").order("created_at", { ascending: false }),
    ),
    adminRows<Project>("Prosjekter", db.from("projects").select("id, payment_status, price_nok")),
    fetchAllAuthUsers(db),
  ]);

  const errors = collectErrors(shopResult, materialResult, projectResult, usersResult);

  const byggmakkerStates = await fetchByggmakkerStates(
    db,
    shopResult.rows.filter((o) => isPaidShopStatus(o.status)).map((o) => o.id),
  );

  const paidShop = shopResult.rows.filter((o) => isPaidShopStatus(o.status));
  const paidMaterial = materialResult.rows.filter((o) => isPaidMaterialStatus(o.status));
  const paidProjects = projectResult.rows.filter((p) => p.payment_status === "paid");

  const totalRevenue =
    paidShop.reduce((s, o) => s + o.total_nok, 0) +
    paidMaterial.reduce((s, o) => s + o.total_nok, 0) +
    paidProjects.reduce((s, p) => s + (p.price_nok ?? 0), 0);

  const paidOrderCount = paidShop.length + paidMaterial.length;
  const totalOrders = shopResult.rows.length + materialResult.rows.length;

  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const newUsersThisMonth = usersResult.rows.filter((u) => u.created_at?.startsWith(thisMonthKey)).length;

  /* ── Hva krever handling akkurat nå ────────────────────────────────────── */

  const openOrders = paidShop.filter(
    (order) => order.transport_status !== "delivered" && order.transport_status !== "cancelled",
  );

  const needsAttention = shopResult.rows
    .map((order) => ({
      order,
      issues: detectOrderIssues(order, {
        byggmakkerState: byggmakkerStates.get(order.id) ?? "none",
        now,
      }),
    }))
    .filter((entry) => entry.issues.some((issue) => issue.severity === "high"));

  const recentShopOrders = shopResult.rows.slice(0, 8);

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Oversikt"
        title="Dashboard"
        description="Status på plattformen akkurat nå."
        actions={
          <Link href="/sjefen/logistikk" className={BTN_SECONDARY}>
            Åpne logistikk
          </Link>
        }
      />

      <DataErrorBanner errors={errors} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total omsetning"
          value={nok(totalRevenue)}
          sub={`${paidOrderCount} betalte ordre`}
          tone="accent"
        />
        <StatCard
          label="Krever handling"
          value={num(needsAttention.length)}
          sub="butikkordre med avvik"
          tone={needsAttention.length > 0 ? "danger" : "good"}
        />
        <StatCard label="Under arbeid" value={num(openOrders.length)} sub="betalt, ikke levert" />
        <StatCard
          label="Registrerte brukere"
          value={num(usersResult.rows.length)}
          sub={`+${newUsersThisMonth} denne måneden`}
        />
      </section>

      {needsAttention.length > 0 ? (
        <Card
          title="Krever handling"
          description="Butikkordre med kritiske avvik"
          actions={
            <Link href="/sjefen/logistikk" className="text-xs font-semibold text-[#163f2a] hover:underline">
              Se alle i logistikk →
            </Link>
          }
          bodyClassName=""
        >
          <ul className="divide-y divide-stone-100">
            {needsAttention.slice(0, 5).map((entry) => (
              <li key={entry.order.id}>
                <Link
                  href={`/sjefen/logistikk/${entry.order.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition hover:bg-stone-50"
                >
                  <span className="h-2 w-2 shrink-0 bg-red-500" />
                  <span className="font-mono text-xs font-semibold text-stone-900">
                    {entry.order.slug ?? entry.order.id.slice(0, 8)}
                  </span>
                  <span className="text-xs font-semibold text-stone-700">{entry.order.customer_name}</span>
                  <span className="text-xs text-stone-500">{entry.issues[0].label}</span>
                  <span className="ml-auto text-xs font-semibold tabular-nums text-stone-600">
                    {nok(entry.order.total_nok)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title="Siste butikkordre"
        actions={
          <Link href="/sjefen/bestillinger" className="text-xs font-semibold text-[#163f2a] hover:underline">
            Se alle →
          </Link>
        }
        bodyClassName=""
      >
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <Th>Ordre</Th>
              <Th>Kunde</Th>
              <Th>Sted</Th>
              <Th>Dato</Th>
              <Th>Status</Th>
              <Th>Transport</Th>
              <Th align="right">Beløp</Th>
            </tr>
          </thead>
          <tbody>
            {recentShopOrders.map((order) => (
              <tr key={order.id} className="border-b border-stone-100 transition hover:bg-stone-50">
                <Td>
                  <Link
                    href={`/sjefen/logistikk/${order.id}`}
                    className="font-mono text-xs font-semibold text-[#163f2a] hover:underline"
                  >
                    {order.slug ?? `${order.id.slice(0, 8)}…`}
                  </Link>
                </Td>
                <Td className="text-xs text-stone-700">{order.customer_name}</Td>
                <Td className="text-xs text-stone-500">{order.shipping_city}</Td>
                <Td className="text-xs text-stone-500">{dateNo(order.created_at)}</Td>
                <Td>
                  <OrderStatusBadge status={order.status} />
                </Td>
                <Td>
                  <TransportBadge status={order.transport_status} />
                </Td>
                <Td align="right" className="font-semibold tabular-nums text-stone-900">
                  {nok(order.total_nok)}
                </Td>
              </tr>
            ))}
            {recentShopOrders.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState>Ingen butikkordre ennå.</EmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </TableWrap>
      </Card>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Butikkordre" value={num(shopResult.rows.length)} sub={`${paidShop.length} betalte`} />
        <StatCard
          label="Materialbestillinger"
          value={num(materialResult.rows.length)}
          sub={`${paidMaterial.length} betalte`}
        />
        <StatCard label="Ordre totalt" value={num(totalOrders)} sub="alle typer" />
      </section>

      {/* Stagene i logistikkflyten, som snarvei inn i arbeidskøen. */}
      <Card title="Butikkordre i flyten" description="Fordeling på transportsteg">
        <div className="grid gap-2 sm:grid-cols-5">
          {["ubekreftet", "klargjoring", "pakking", "transit", "levert"].map((stageId) => {
            const count = paidShop.filter((o) => stageForTransportStatus(o.transport_status)?.id === stageId).length;
            const labels: Record<string, string> = {
              ubekreftet: "Må bekreftes",
              klargjoring: "Klar for plukk",
              pakking: "Plukkes",
              transit: "I transit",
              levert: "Levert",
            };
            return (
              <Link
                key={stageId}
                href="/sjefen/logistikk"
                className="border border-stone-200 px-4 py-3 transition hover:border-[#163f2a]"
              >
                <p className="text-2xl font-semibold tabular-nums text-stone-900">{count}</p>
                <p className="mt-0.5 text-xs text-stone-500">{labels[stageId]}</p>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
