import { requireAdminUser } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function fmt(nok: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(nok);
}

export default async function OkonomiPage() {
  await requireAdminUser();

  const supabase = await createSupabaseServerClient();

  const [{ data: materialOrders }, { data: projects }, { data: shopOrders }] = await Promise.all([
    supabase!
      .from("material_orders")
      .select("id, status, total_nok, subtotal_nok, vat_nok, delivery_fee_nok, created_at, paid_at"),
    supabase!
      .from("projects")
      .select("id, payment_status, price_nok, created_at"),
    supabase!
      .from("shop_orders")
      .select("id, status, total_nok, subtotal_nok, vat_nok, shipping_nok, created_at, paid_at"),
  ]);

  const paidMaterial = (materialOrders ?? []).filter(o => ["paid", "submitted"].includes(o.status));
  const paidProjects = (projects ?? []).filter(p => p.payment_status === "paid");
  const paidShop     = (shopOrders ?? []).filter(o => ["paid", "fulfilled"].includes(o.status));

  const materialRevenue = paidMaterial.reduce((s, o) => s + (o.total_nok ?? 0), 0);
  const projectRevenue  = paidProjects.reduce((s, p) => s + (p.price_nok ?? 0), 0);
  const shopRevenue     = paidShop.reduce((s, o) => s + (o.total_nok ?? 0), 0);
  const totalRevenue    = materialRevenue + projectRevenue + shopRevenue;

  const totalVat        = paidMaterial.reduce((s, o) => s + (o.vat_nok ?? 0), 0)
                        + paidShop.reduce((s, o) => s + (o.vat_nok ?? 0), 0);
  const totalDelivery   = paidMaterial.reduce((s, o) => s + (o.delivery_fee_nok ?? 0), 0)
                        + paidShop.reduce((s, o) => s + (o.shipping_nok ?? 0), 0);

  // Monthly breakdown across all revenue types (12 months)
  const now = new Date();
  type MonthEntry = { key: string; label: string; material: number; projects: number; shop: number; total: number };
  const months: MonthEntry[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("nb-NO", { month: "short", year: "2-digit" });
    const mRev  = paidMaterial.filter(o => (o.paid_at ?? o.created_at).startsWith(key)).reduce((s, o) => s + (o.total_nok ?? 0), 0);
    const pRev  = paidProjects.filter(p => p.created_at.startsWith(key)).reduce((s, p) => s + (p.price_nok ?? 0), 0);
    const sRev  = paidShop.filter(o => (o.paid_at ?? o.created_at).startsWith(key)).reduce((s, o) => s + (o.total_nok ?? 0), 0);
    months.push({ key, label, material: mRev, projects: pRev, shop: sRev, total: mRev + pRev + sRev });
  }

  const maxMonthTotal = Math.max(...months.map(m => m.total), 1);

  // Current month
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonth = months.find(m => m.key === currentMonthKey);
  const prevMonthKey = months[months.length - 2]?.key;
  const prevMonth    = months.find(m => m.key === prevMonthKey);
  const growth       = prevMonth && prevMonth.total > 0
    ? Math.round(((currentMonth?.total ?? 0) - prevMonth.total) / prevMonth.total * 100)
    : null;

  // Revenue source breakdown (for pie-like bars)
  const sources = [
    { label: "Materialbestillinger", nok: materialRevenue, color: "bg-amber-500" },
    { label: "Prosjektpriser",        nok: projectRevenue,  color: "bg-blue-500" },
    { label: "Butikksalg",            nok: shopRevenue,     color: "bg-emerald-500" },
  ];

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Økonomi</h1>
        <p className="text-sm text-stone-400 mt-0.5">Inntektssammendrag for proanbud</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-stone-200 rounded-2xl p-5">
          <p className="text-xs text-stone-400 uppercase tracking-wider mb-2">Total inntekt</p>
          <p className="text-2xl font-bold text-stone-900">{fmt(totalRevenue)}</p>
          <p className="text-xs text-stone-400 mt-1">alle betalte transaksjoner</p>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-5">
          <p className="text-xs text-stone-400 uppercase tracking-wider mb-2">Denne måneden</p>
          <p className="text-2xl font-bold text-amber-400">{fmt(currentMonth?.total ?? 0)}</p>
          {growth !== null && (
            <p className={`text-xs mt-1 ${growth >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {growth >= 0 ? "+" : ""}{growth}% vs forrige mnd.
            </p>
          )}
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-5">
          <p className="text-xs text-stone-400 uppercase tracking-wider mb-2">MVA (betalt)</p>
          <p className="text-2xl font-bold text-stone-700">{fmt(totalVat)}</p>
          <p className="text-xs text-stone-400 mt-1">av betalte ordre</p>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-5">
          <p className="text-xs text-stone-400 uppercase tracking-wider mb-2">Fraktkostnader</p>
          <p className="text-2xl font-bold text-stone-700">{fmt(totalDelivery)}</p>
          <p className="text-xs text-stone-400 mt-1">betalt av kunder</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly chart */}
        <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-stone-900 mb-1">Månedlig inntekt (12 mnd.)</h2>
          <div className="flex items-center gap-4 mb-5">
            {sources.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-sm ${s.color}`} />
                <span className="text-xs text-stone-400">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-1.5 h-36">
            {months.map((m) => {
              const totalPct = maxMonthTotal > 0 ? (m.total / maxMonthTotal) * 100 : 0;
              const matPct   = m.total > 0 ? (m.material / m.total) * 100 : 0;
              const projPct  = m.total > 0 ? (m.projects / m.total) * 100 : 0;
              const shopPct  = m.total > 0 ? (m.shop / m.total) * 100 : 0;
              const barH     = Math.max((totalPct / 100) * 144, 4);
              return (
                <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-md overflow-hidden relative group"
                    style={{ height: `${barH}px` }}
                    title={`${m.label}: ${fmt(m.total)}`}
                  >
                    <div className="absolute inset-0 flex flex-col-reverse">
                      <div className="bg-amber-500 w-full" style={{ height: `${matPct}%` }} />
                      <div className="bg-blue-500 w-full"  style={{ height: `${projPct}%` }} />
                      <div className="bg-emerald-500 w-full" style={{ height: `${shopPct}%` }} />
                    </div>
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-stone-200 text-stone-900 text-xs rounded px-2 py-1 whitespace-nowrap z-10 pointer-events-none">
                      {fmt(m.total)}
                    </div>
                  </div>
                  <span className="text-[9px] text-stone-400">{m.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Revenue source breakdown */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-stone-900 mb-1">Inntektskilder</h2>
          <p className="text-xs text-stone-400 mb-5">Fordeling av total inntekt</p>
          <div className="space-y-4">
            {sources.map((s) => {
              const pct = totalRevenue > 0 ? Math.round((s.nok / totalRevenue) * 100) : 0;
              return (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-stone-700">{s.label}</span>
                    <span className="text-xs text-stone-500">{pct}%</span>
                  </div>
                  <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div className={`h-full ${s.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-stone-400 mt-1">{fmt(s.nok)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detailed table per month */}
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200">
          <h2 className="text-sm font-semibold text-stone-900">Månedlig detaljert</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left">
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Måned</th>
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Materialbestillinger</th>
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Prosjektpriser</th>
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Butikksalg</th>
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Totalt</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.key} className={`border-b border-stone-200/70 hover:bg-stone-50/80 transition ${m.key === currentMonthKey ? "bg-amber-500/5" : ""}`}>
                  <td className="px-5 py-3 text-sm text-stone-800 font-medium">
                    {m.key === currentMonthKey ? <span className="text-amber-400">{m.label} ←</span> : m.label}
                  </td>
                  <td className="px-5 py-3 text-right text-stone-500 text-xs">{m.material > 0 ? fmt(m.material) : <span className="text-stone-400">—</span>}</td>
                  <td className="px-5 py-3 text-right text-stone-500 text-xs">{m.projects > 0 ? fmt(m.projects) : <span className="text-stone-400">—</span>}</td>
                  <td className="px-5 py-3 text-right text-stone-500 text-xs">{m.shop > 0 ? fmt(m.shop) : <span className="text-stone-400">—</span>}</td>
                  <td className="px-5 py-3 text-right font-semibold text-stone-900">{m.total > 0 ? fmt(m.total) : <span className="text-stone-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
