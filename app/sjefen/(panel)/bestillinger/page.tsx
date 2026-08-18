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
  calculateOrderEconomics,
  netOfVat,
  sumEconomics,
  type OrderEconomics,
} from "@/lib/order-economics";
import { getProductCostsByNobb } from "@/lib/product-costs";

import { OrderStatusBadge, PartnerStatusBadge, TransportBadge } from "../../_components/status-badges";
import { PartnerControls } from "./_components/partner-controls";
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
} from "../../_components/ui";

type ShopOrderRow = {
  id: string;
  slug: string | null;
  status: string;
  transport_status: string;
  subtotal_nok: number;
  shipping_nok: number;
  total_nok: number;
  goods_cost_nok: number | null;
  freight_cost_nok: number | null;
  other_cost_nok: number | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_city: string;
  created_at: string;
  paid_at: string | null;
};

type MaterialOrderRow = {
  id: string;
  status: string;
  partner_status: string;
  total_nok: number;
  delivery_mode: string;
  created_at: string;
  user_id: string;
  partner_id: string | null;
  paid_at: string | null;
};

const SHOP_STATUSES = ["all", "paid", "fulfilled", "pending_payment", "draft", "cancelled", "failed"];
const MATERIAL_STATUSES = ["all", "paid", "submitted", "pending_payment", "draft", "cancelled", "failed"];

type PageProps = {
  searchParams: Promise<{ type?: string; status?: string; q?: string }>;
};

export default async function BestillingerPage({ searchParams }: PageProps) {
  const db = await requireAdminDb();
  const { type = "shop", status = "all", q = "" } = await searchParams;
  const isMaterial = type === "material";

  const [shopResult, materialResult, partnerResult, usersResult] = await Promise.all([
    adminRows<ShopOrderRow>(
      "Butikkordre",
      db
        .from("shop_orders")
        .select("id, slug, status, transport_status, subtotal_nok, shipping_nok, total_nok, goods_cost_nok, freight_cost_nok, other_cost_nok, customer_name, customer_email, customer_phone, shipping_city, created_at, paid_at")
        .order("created_at", { ascending: false })
        .limit(500),
    ),
    adminRows<MaterialOrderRow>(
      "Materialbestillinger",
      db
        .from("material_orders")
        .select("id, status, partner_status, total_nok, delivery_mode, created_at, user_id, partner_id, paid_at")
        .order("created_at", { ascending: false })
        .limit(500),
    ),
    adminRows<{ id: string; name: string }>("Partnere", db.from("partners").select("id, name")),
    fetchAllAuthUsers(db),
  ]);

  const errors = collectErrors(shopResult, materialResult, partnerResult, usersResult);

  const userEmail = new Map(usersResult.rows.map((user) => [user.id, user.email ?? "—"]));

  const paidShopIds = shopResult.rows.filter((o) => isPaidShopStatus(o.status)).map((o) => o.id);
  const paidMaterialIds = materialResult.rows.filter((o) => isPaidMaterialStatus(o.status)).map((o) => o.id);

  const [shopItems, materialItems] = await Promise.all([
    paidShopIds.length > 0
      ? adminRows<{ order_id: string; nobb_number: string; quantity: number; line_total_nok: number }>(
          "Butikkordrelinjer",
          db.from("shop_order_items").select("order_id, nobb_number, quantity, line_total_nok").in("order_id", paidShopIds),
        )
      : Promise.resolve({ rows: [], error: null }),
    paidMaterialIds.length > 0
      ? adminRows<{ order_id: string; supplier_sku: string | null; quantity_value: number; line_total_nok: number }>(
          "Materialordrelinjer",
          db
            .from("material_order_items")
            .select("order_id, supplier_sku, quantity_value, line_total_nok")
            .eq("is_included", true)
            .in("order_id", paidMaterialIds),
        )
      : Promise.resolve({ rows: [], error: null }),
  ]);

  errors.push(...collectErrors(shopItems, materialItems));

  /* ── Innkjøpspris for marginberegning ──────────────────────────────────
   * Katalogen eier innkjøpsprisen (se lib/product-costs). Slår oppslaget feil
   * skal ordrelisten fortsatt vises — bare uten marginkolonnene.        */
  let costByNobb = new Map<string, number>();
  let marginAvailable = true;
  try {
    costByNobb = await getProductCostsByNobb(db, [
      ...shopItems.rows.map((item) => item.nobb_number),
      ...materialItems.rows.map((item) => item.supplier_sku ?? ""),
    ]);
  } catch (cause) {
    marginAvailable = false;
    console.error("[sjefen] innkjøpspriser utilgjengelig, hopper over margin:", cause);
  }

  /* ── Dekningsbidrag ────────────────────────────────────────────────────
   * Linjesummene på ordren er INKL. mva, mens innkjøpsprisen i katalogen er
   * EKS. mva. Panelet sammenlignet tidligere de to direkte, noe som overvurderte
   * inntjeningen med hele mva-beløpet. calculateOrderEconomics regner begge
   * sider eks. mva og trekker fra frakt og betalingsgebyr.              */

  const shopLinesByOrder = new Map<string, typeof shopItems.rows>();
  for (const item of shopItems.rows) {
    const list = shopLinesByOrder.get(item.order_id) ?? [];
    list.push(item);
    shopLinesByOrder.set(item.order_id, list);
  }

  const shopEconomics = new Map<string, OrderEconomics>();
  for (const order of shopResult.rows) {
    if (!isPaidShopStatus(order.status)) continue;
    const lines = shopLinesByOrder.get(order.id) ?? [];
    shopEconomics.set(
      order.id,
      calculateOrderEconomics(
        {
          subtotalNok: order.subtotal_nok,
          shippingNok: order.shipping_nok,
          totalNok: order.total_nok,
          goodsCostOverrideExVatNok: order.goods_cost_nok,
          freightCostExVatNok: order.freight_cost_nok,
          otherCostExVatNok: order.other_cost_nok,
        },
        lines.map((item, index) => ({
          id: `${order.id}-${index}`,
          nobbNumber: item.nobb_number,
          productName: item.nobb_number,
          quantity: item.quantity,
          unit: "",
          lineTotalNok: item.line_total_nok,
          unitCostExVatNok: costByNobb.get(item.nobb_number) ?? null,
        })),
      ),
    );
  }

  // Materialordre har samme mva-konvensjon (toVatInclusiveNok i lib/material-order),
  // men ingen registrert fraktkostnad — derfor kun vare mot netto salgsinntekt.
  const materialMargin = new Map<string, { netRevenue: number; cost: number }>();
  for (const item of materialItems.rows) {
    const entry = materialMargin.get(item.order_id) ?? { netRevenue: 0, cost: 0 };
    entry.netRevenue += netOfVat(item.line_total_nok);
    const unitCost = item.supplier_sku ? costByNobb.get(item.supplier_sku) : undefined;
    if (unitCost != null) entry.cost += unitCost * Number(item.quantity_value);
    materialMargin.set(item.order_id, entry);
  }

  /* ── Filtrering ────────────────────────────────────────────────────────── */

  const query = q.trim().toLowerCase();

  const shopOrders = shopResult.rows.filter(
    (o) =>
      (status === "all" || o.status === status) &&
      (!query ||
        [o.slug, o.id, o.customer_name, o.customer_email, o.customer_phone, o.shipping_city]
          .filter((v): v is string => Boolean(v))
          .some((v) => v.toLowerCase().includes(query))),
  );

  const materialOrders = materialResult.rows.filter(
    (o) =>
      (status === "all" || o.status === status) &&
      (!query ||
        [o.id, userEmail.get(o.user_id) ?? ""].some((v) => v.toLowerCase().includes(query))),
  );

  /* ── Nøkkeltall for den aktive fanen ───────────────────────────────────── */

  const shopTotals = sumEconomics([...shopEconomics.values()]);

  const revenue = isMaterial
    ? [...materialMargin.values()].reduce((sum, e) => sum + e.netRevenue, 0)
    : shopTotals.netRevenueNok;
  const cost = isMaterial
    ? [...materialMargin.values()].reduce((sum, e) => sum + e.cost, 0)
    : shopTotals.totalCostNok;
  const profit = revenue - cost;
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
  const paidCount = isMaterial ? paidMaterialIds.length : paidShopIds.length;
  const incompleteCount = isMaterial
    ? 0
    : [...shopEconomics.values()].filter((e) => !e.complete).length;

  const statuses = isMaterial ? MATERIAL_STATUSES : SHOP_STATUSES;

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Ordre"
        title="Bestillinger"
        description="Alle ordre på plattformen, uavhengig av hvilken kunde de tilhører."
        actions={
          <Link href="/sjefen/logistikk" className={BTN_SECONDARY}>
            Åpne logistikk
          </Link>
        }
      />

      <DataErrorBanner errors={errors} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Netto salgsinntekt"
          value={nok(revenue)}
          sub={`${paidCount} betalte ordre · eks. mva`}
          tone="accent"
        />
        <StatCard
          label={isMaterial ? "Varekost" : "Kostnader"}
          value={marginAvailable ? nok(cost) : "—"}
          sub={isMaterial ? "fra katalogens innkjøpspris, eks. mva" : "vare + frakt + gebyr"}
        />
        <StatCard
          label="Dekningsbidrag"
          value={marginAvailable ? nok(profit) : "—"}
          sub="netto inntekt − kostnader"
          tone={marginAvailable && profit > 0 ? "good" : marginAvailable && profit < 0 ? "danger" : "neutral"}
        />
        <StatCard
          label="Dekningsgrad"
          value={marginAvailable ? `${marginPct.toFixed(1)} %` : "—"}
          sub={
            !marginAvailable
              ? "innkjøpspriser utilgjengelig"
              : incompleteCount > 0
                ? `${incompleteCount} ordre mangler kostnadsdata`
                : "av netto salgsinntekt"
          }
          tone={marginAvailable && incompleteCount > 0 ? "danger" : "neutral"}
        />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: "shop", label: "Butikkordre", count: shopResult.rows.length },
          { key: "material", label: "Materialbestillinger", count: materialResult.rows.length },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={`/sjefen/bestillinger?type=${tab.key}&status=all`}
            className={`inline-flex h-10 items-center px-4 text-sm font-semibold transition ${
              type === tab.key
                ? "bg-[#163f2a] text-white!"
                : "border border-stone-300 bg-white text-stone-600 hover:border-stone-900 hover:text-stone-900"
            }`}
          >
            {tab.label} ({tab.count})
          </Link>
        ))}

        <form action="/sjefen/bestillinger" className="ml-auto flex gap-2">
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="status" value={status} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Søk kunde, e-post, ordre…"
            className="h-10 w-64 border border-stone-300 bg-white px-3 text-sm outline-none focus:border-[#163f2a]"
          />
          <button type="submit" className={BTN_SECONDARY}>
            Søk
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/sjefen/bestillinger?type=${type}&status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`inline-flex h-8 items-center px-3 text-xs font-semibold transition ${
              status === s
                ? "bg-stone-900 text-white"
                : "border border-stone-200 bg-white text-stone-500 hover:border-stone-400 hover:text-stone-900"
            }`}
          >
            {s === "all" ? "Alle" : <OrderStatusLabel status={s} />}
          </Link>
        ))}
      </div>

      <Card bodyClassName="">
        {isMaterial ? (
          <TableWrap>
            <thead className="border-b border-stone-200">
              <tr>
                <Th>Ordre</Th>
                <Th>Bruker</Th>
                <Th>Dato</Th>
                <Th>Status</Th>
                <Th>Partner-status</Th>
                <Th>Tildel partner</Th>
                <Th>Levering</Th>
                <Th align="right">Beløp</Th>
                <Th align="right">Dekningsbidrag</Th>
              </tr>
            </thead>
            <tbody>
              {materialOrders.map((order) => {
                const margin = materialMargin.get(order.id);
                const amount = margin ? margin.netRevenue - margin.cost : null;
                return (
                  <tr key={order.id} className="border-b border-stone-100 transition hover:bg-stone-50">
                    <Td className="font-mono text-xs text-stone-500">{order.id.slice(0, 8)}…</Td>
                    <Td className="max-w-[180px] truncate text-xs text-stone-700">
                      {userEmail.get(order.user_id) ?? "—"}
                    </Td>
                    <Td className="text-xs text-stone-500">{dateNo(order.created_at)}</Td>
                    <Td>
                      <OrderStatusBadge status={order.status} />
                    </Td>
                    <Td>
                      <PartnerStatusBadge status={order.partner_status} />
                    </Td>
                    <Td>
                      <PartnerControls
                        orderId={order.id}
                        partnerStatus={order.partner_status}
                        partnerId={order.partner_id}
                        partners={partnerResult.rows}
                      />
                    </Td>
                    <Td className="text-xs text-stone-500">
                      {order.delivery_mode === "pickup" ? "Henting" : "Levering"}
                    </Td>
                    <Td align="right" className="font-semibold tabular-nums text-stone-900">
                      {nok(order.total_nok)}
                    </Td>
                    <Td align="right" className="text-xs font-semibold tabular-nums">
                      {amount != null ? (
                        <span className={amount >= 0 ? "text-emerald-700" : "text-red-700"}>{nok(amount)}</span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
              {materialOrders.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState>Ingen materialbestillinger å vise.</EmptyState>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </TableWrap>
        ) : (
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
                <Th align="right">Dekningsbidrag</Th>
              </tr>
            </thead>
            <tbody>
              {shopOrders.map((order) => {
                const economics = shopEconomics.get(order.id);
                const amount = economics ? economics.contributionNok : null;
                return (
                  <tr key={order.id} className="border-b border-stone-100 transition hover:bg-stone-50">
                    <Td>
                      <Link
                        href={`/sjefen/logistikk/${order.id}`}
                        className="font-mono text-xs font-semibold text-[#163f2a] hover:underline"
                      >
                        {order.slug ?? `${order.id.slice(0, 8)}…`}
                      </Link>
                    </Td>
                    <Td>
                      <span className="block text-xs font-semibold text-stone-800">{order.customer_name}</span>
                      <span className="block text-[11px] text-stone-500">{order.customer_email}</span>
                    </Td>
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
                    <Td align="right" className="text-xs font-semibold tabular-nums">
                      {amount != null ? (
                        <span className={amount >= 0 ? "text-emerald-700" : "text-red-700"}>{nok(amount)}</span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
              {shopOrders.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState>
                      {query ? `Ingen butikkordre matcher «${q}».` : "Ingen butikkordre å vise."}
                    </EmptyState>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

function OrderStatusLabel({ status }: { status: string }) {
  const labels: Record<string, string> = {
    paid: "Betalt",
    fulfilled: "Fullført",
    submitted: "Sendt leverandør",
    pending_payment: "Venter betaling",
    draft: "Utkast",
    cancelled: "Kansellert",
    failed: "Feilet",
  };
  return <>{labels[status] ?? status}</>;
}
