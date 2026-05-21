import { requireAdminUser } from "@/lib/admin-auth";
import { getPriceListProducts } from "@/lib/price-lists";
import { SHOP_ORDER_TRANSPORT_LABELS, type ShopOrderTransportStatus } from "@/lib/shop-order";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function fmt(nok: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(nok);
}

function fmtPct(pct: number) {
  return `${pct.toFixed(1)} %`;
}

const ORDER_STATUS: Record<string, { label: string; color: string }> = {
  draft:           { label: "Utkast",        color: "bg-stone-200 text-stone-700" },
  pending_payment: { label: "Venter bet.",   color: "bg-yellow-500/20 text-yellow-400" },
  paid:            { label: "Betalt",        color: "bg-blue-500/20 text-blue-400" },
  submitted:       { label: "Sendt",         color: "bg-emerald-500/20 text-emerald-400" },
  cancelled:       { label: "Kansellert",    color: "bg-red-500/20 text-red-400" },
  failed:          { label: "Feilet",        color: "bg-red-500/20 text-red-400" },
  fulfilled:       { label: "Fullført",      color: "bg-emerald-500/20 text-emerald-400" },
};

const PARTNER_STATUS: Record<string, { label: string; color: string }> = {
  pending:          { label: "Ny",           color: "bg-yellow-500/20 text-yellow-400" },
  processing:       { label: "Behandles",    color: "bg-blue-500/20 text-blue-400" },
  out_for_delivery: { label: "Kjørt ut",     color: "bg-violet-500/20 text-violet-400" },
  delivered:        { label: "Levert",       color: "bg-emerald-500/20 text-emerald-400" },
  cancelled:        { label: "Kansellert",   color: "bg-red-500/20 text-red-400" },
};

const TRANSPORT_STATUS_COLOR: Record<ShopOrderTransportStatus, string> = {
  pending: "bg-stone-200 text-stone-700",
  confirmed: "bg-blue-500/20 text-blue-400",
  packing: "bg-amber-500/20 text-amber-500",
  shipped: "bg-violet-500/20 text-violet-400",
  out_for_delivery: "bg-cyan-500/20 text-cyan-500",
  delivered: "bg-emerald-500/20 text-emerald-400",
  cancelled: "bg-red-500/20 text-red-400",
};

type PageProps = {
  searchParams: Promise<{ type?: string; status?: string }>;
};

export default async function BestillingerPage({ searchParams }: PageProps) {
  await requireAdminUser();
  const { type = "material", status = "all" } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const adminClient = createSupabaseAdminClient();

  const [{ data: materialOrders }, { data: shopOrders }, { data: partners }, usersResult] = await Promise.all([
    supabase!
      .from("material_orders")
      .select("id, status, partner_status, total_nok, delivery_mode, customer_note, created_at, user_id, partner_id, paid_at, submitted_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase!
      .from("shop_orders")
      .select("id, status, transport_status, total_nok, customer_name, customer_email, customer_phone, shipping_city, created_at, paid_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase!.from("partners").select("id, name"),
    adminClient ? adminClient.auth.admin.listUsers({ page: 1, perPage: 500 }) : Promise.resolve({ data: { users: [] } }),
  ]);

  const userEmailMap = Object.fromEntries(
    (usersResult?.data?.users ?? []).map((u) => [u.id, u.email ?? "—"])
  );
  const partnerMap = Object.fromEntries((partners ?? []).map((p) => [p.id, p.name]));

  // ── Profit calculation ─────────────────────────────────────────────────
  const paidMatIds = (materialOrders ?? [])
    .filter((o) => ["paid", "submitted", "fulfilled"].includes(o.status))
    .map((o) => o.id);
  const paidShopIds = (shopOrders ?? [])
    .filter((o) => ["paid", "fulfilled"].includes(o.status))
    .map((o) => o.id);

  const [priceListProducts, shopItemsResult, matItemsResult] = await Promise.all([
    getPriceListProducts(),
    paidShopIds.length > 0
      ? supabase!.from("shop_order_items").select("order_id, nobb_number, quantity, line_total_nok").in("order_id", paidShopIds)
      : Promise.resolve({ data: [] as { order_id: string; nobb_number: string; quantity: number; line_total_nok: number }[] }),
    paidMatIds.length > 0
      ? supabase!.from("material_order_items").select("order_id, supplier_sku, quantity_value, line_total_nok").eq("is_included", true).in("order_id", paidMatIds)
      : Promise.resolve({ data: [] as { order_id: string; supplier_sku: string | null; quantity_value: number; line_total_nok: number }[] }),
  ]);

  const nobbCostMap = new Map<string, number>();
  for (const p of priceListProducts) {
    if (p.nobbNumber) nobbCostMap.set(p.nobbNumber, p.priceNok);
  }

  // Per-order profit: revenue = line_total_nok (ex-VAT), cost = priceList × qty
  const shopProfitMap = new Map<string, { revenue: number; cost: number }>();
  for (const item of shopItemsResult.data ?? []) {
    const costUnit = nobbCostMap.get(item.nobb_number);
    if (!shopProfitMap.has(item.order_id)) shopProfitMap.set(item.order_id, { revenue: 0, cost: 0 });
    const e = shopProfitMap.get(item.order_id)!;
    e.revenue += item.line_total_nok;
    if (costUnit != null) e.cost += Math.round(costUnit * item.quantity);
  }

  const matProfitMap = new Map<string, { revenue: number; cost: number }>();
  for (const item of matItemsResult.data ?? []) {
    const costUnit = item.supplier_sku ? nobbCostMap.get(item.supplier_sku) : undefined;
    if (!matProfitMap.has(item.order_id)) matProfitMap.set(item.order_id, { revenue: 0, cost: 0 });
    const e = matProfitMap.get(item.order_id)!;
    e.revenue += item.line_total_nok;
    if (costUnit != null) e.cost += Math.round(costUnit * Number(item.quantity_value));
  }

  const isMaterial = type !== "shop";

  const activeProfitMap = isMaterial ? matProfitMap : shopProfitMap;
  const totalRevenue = [...activeProfitMap.values()].reduce((s, e) => s + e.revenue, 0);
  const totalCost = [...activeProfitMap.values()].reduce((s, e) => s + e.cost, 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const filteredMaterial = (materialOrders ?? []).filter(
    (o) => status === "all" || o.status === status
  );
  const filteredShop = (shopOrders ?? []).filter(
    (o) => status === "all" || o.status === status
  );

  const statuses = isMaterial
    ? ["all", "draft", "pending_payment", "paid", "submitted", "cancelled", "failed"]
    : ["all", "draft", "pending_payment", "paid", "fulfilled", "cancelled", "failed"];

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Bestillinger</h1>
        <p className="text-sm text-stone-400 mt-0.5">Alle ordre på plattformen</p>
      </div>

      {/* Profit KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Omsetning (eks. MVA)", value: fmt(totalRevenue), sub: "betalte ordre" },
          { label: "Innkjøp", value: fmt(totalCost), sub: "fra prisliste" },
          { label: "Inntjening", value: fmt(totalProfit), sub: "bruttobidrag", highlight: true },
          { label: "Margin", value: fmtPct(avgMargin), sub: "gjennomsnitt" },
        ].map((kpi) => (
          <div key={kpi.label} className={`rounded-2xl border px-5 py-4 space-y-0.5 ${kpi.highlight ? "bg-emerald-50 border-emerald-200" : "bg-white border-stone-200"}`}>
            <p className="text-xs text-stone-400">{kpi.label}</p>
            <p className={`text-xl font-bold tabular-nums ${kpi.highlight ? "text-emerald-700" : "text-stone-900"}`}>{kpi.value}</p>
            <p className="text-[11px] text-stone-400">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Type toggle */}
      <div className="flex gap-2">
        {[
          { key: "material", label: `Materialbestillinger (${materialOrders?.length ?? 0})` },
          { key: "shop",     label: `Butikkordre (${shopOrders?.length ?? 0})` },
        ].map((t) => (
          <a
            key={t.key}
            href={`/sjefen/bestillinger?type=${t.key}&status=all`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              (type === t.key || (!type && t.key === "material"))
                ? "bg-amber-500 text-stone-900"
                : "bg-stone-100 text-stone-500 hover:text-stone-900"
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => {
          const cfg = s === "all" ? { label: "Alle", color: "" } : (ORDER_STATUS[s] ?? { label: s, color: "" });
          const isActive = status === s;
          return (
            <a
              key={s}
              href={`/sjefen/bestillinger?type=${type}&status=${s}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                isActive
                  ? "bg-stone-200 border-zinc-600 text-stone-900"
                  : "bg-transparent border-stone-200 text-stone-400 hover:text-stone-700"
              }`}
            >
              {cfg.label}
            </a>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          {isMaterial ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left">
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">ID</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Bruker</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Dato</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Status</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Partner-status</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Partner</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Levering</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Beløp</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Inntjening</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {filteredMaterial.map((o) => {
                  const sCfg = ORDER_STATUS[o.status] ?? { label: o.status, color: "bg-stone-200 text-stone-700" };
                  const pCfg = PARTNER_STATUS[o.partner_status] ?? { label: o.partner_status, color: "bg-stone-200 text-stone-700" };
                  const profit = matProfitMap.get(o.id);
                  const profitAmt = profit ? profit.revenue - profit.cost : null;
                  const margin = profit && profit.revenue > 0 ? ((profit.revenue - profit.cost) / profit.revenue) * 100 : null;
                  return (
                    <tr key={o.id} className="border-b border-stone-200/70 hover:bg-stone-50/80 transition">
                      <td className="px-5 py-3 font-mono text-xs text-stone-500">{o.id.slice(0, 8)}…</td>
                      <td className="px-5 py-3 text-xs text-stone-700 max-w-[140px] truncate">{userEmailMap[o.user_id] ?? "—"}</td>
                      <td className="px-5 py-3 text-xs text-stone-500">{new Date(o.created_at).toLocaleDateString("nb-NO")}</td>
                      <td className="px-5 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sCfg.color}`}>{sCfg.label}</span></td>
                      <td className="px-5 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pCfg.color}`}>{pCfg.label}</span></td>
                      <td className="px-5 py-3 text-xs text-stone-500">{o.partner_id ? partnerMap[o.partner_id] ?? "—" : <span className="text-stone-400">Ingen</span>}</td>
                      <td className="px-5 py-3 text-xs text-stone-500">{o.delivery_mode === "pickup" ? "Henting" : "Levering"}</td>
                      <td className="px-5 py-3 text-right text-stone-800 font-semibold">{fmt(o.total_nok)}</td>
                      <td className="px-5 py-3 text-right text-xs font-semibold tabular-nums">
                        {profitAmt != null ? <span className={profitAmt >= 0 ? "text-emerald-600" : "text-red-500"}>{fmt(profitAmt)}</span> : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right text-xs tabular-nums text-stone-500">
                        {margin != null ? fmtPct(margin) : <span className="text-stone-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {filteredMaterial.length === 0 && (
                  <tr><td colSpan={10} className="px-5 py-10 text-center text-stone-400 text-sm">Ingen bestillinger.</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left">
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">ID</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Kunde</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">E-post</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">By</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Dato</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Status</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Transport</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Beløp</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Inntjening</th>
                  <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {filteredShop.map((o) => {
                  const sCfg = ORDER_STATUS[o.status] ?? { label: o.status, color: "bg-stone-200 text-stone-700" };
                  const transportStatus = (o.transport_status ?? "pending") as ShopOrderTransportStatus;
                  const transportLabel = SHOP_ORDER_TRANSPORT_LABELS[transportStatus] ?? transportStatus;
                  const transportColor = TRANSPORT_STATUS_COLOR[transportStatus] ?? "bg-stone-200 text-stone-700";
                  const profit = shopProfitMap.get(o.id);
                  const profitAmt = profit ? profit.revenue - profit.cost : null;
                  const margin = profit && profit.revenue > 0 ? ((profit.revenue - profit.cost) / profit.revenue) * 100 : null;
                  return (
                    <tr key={o.id} className="border-b border-stone-200/70 hover:bg-stone-50/80 transition">
                      <td className="px-5 py-3 font-mono text-xs text-stone-500">
                        <a href={`/sjefen/bestillinger/${o.id}`} className="font-semibold text-stone-700 hover:text-stone-950 hover:underline">
                          {o.id.slice(0, 8)}…
                        </a>
                      </td>
                      <td className="px-5 py-3 text-xs text-stone-700">{o.customer_name}</td>
                      <td className="px-5 py-3 text-xs text-stone-500">{o.customer_email}</td>
                      <td className="px-5 py-3 text-xs text-stone-500">{o.shipping_city}</td>
                      <td className="px-5 py-3 text-xs text-stone-500">{new Date(o.created_at).toLocaleDateString("nb-NO")}</td>
                      <td className="px-5 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sCfg.color}`}>{sCfg.label}</span></td>
                      <td className="px-5 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${transportColor}`}>{transportLabel}</span></td>
                      <td className="px-5 py-3 text-right text-stone-800 font-semibold">{fmt(o.total_nok)}</td>
                      <td className="px-5 py-3 text-right text-xs font-semibold tabular-nums">
                        {profitAmt != null ? <span className={profitAmt >= 0 ? "text-emerald-600" : "text-red-500"}>{fmt(profitAmt)}</span> : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right text-xs tabular-nums text-stone-500">
                        {margin != null ? fmtPct(margin) : <span className="text-stone-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {filteredShop.length === 0 && (
                  <tr><td colSpan={10} className="px-5 py-10 text-center text-stone-400 text-sm">Ingen butikkordre.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
