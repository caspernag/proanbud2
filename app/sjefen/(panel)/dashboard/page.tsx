import { requireAdminUser } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function fmt(nok: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(nok);
}

function fmtNum(n: number) {
  return new Intl.NumberFormat("nb-NO").format(n);
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:           { label: "Utkast",        color: "bg-stone-200 text-stone-700" },
  pending_payment: { label: "Venter bet.",   color: "bg-yellow-500/20 text-yellow-400" },
  paid:            { label: "Betalt",        color: "bg-blue-500/20 text-blue-400" },
  submitted:       { label: "Sendt",         color: "bg-emerald-500/20 text-emerald-400" },
  cancelled:       { label: "Kansellert",    color: "bg-red-500/20 text-red-400" },
  failed:          { label: "Feilet",        color: "bg-red-500/20 text-red-400" },
  fulfilled:       { label: "Fullført",      color: "bg-emerald-500/20 text-emerald-400" },
};

export default async function DashboardPage() {
  await requireAdminUser();

  const supabase = await createSupabaseServerClient();
  const adminClient = createSupabaseAdminClient();

  // Parallel data fetching
  const [
    { data: materialOrders },
    { data: projects },
    { data: shopOrders },
    { data: materialReturns },
    usersResult,
  ] = await Promise.all([
    supabase!.from("material_orders").select("id, status, total_nok, created_at, user_id").order("created_at", { ascending: false }),
    supabase!.from("projects").select("id, payment_status, price_nok, created_at, user_id"),
    supabase!.from("shop_orders").select("id, status, total_nok, created_at"),
    supabase!.from("material_order_returns").select("id, status, created_at").limit(50),
    adminClient ? adminClient.auth.admin.listUsers({ page: 1, perPage: 500 }) : Promise.resolve({ data: { users: [] }, error: null }),
  ]);

  const allMaterialOrders = materialOrders ?? [];
  const allProjects       = projects ?? [];
  const allShopOrders     = shopOrders ?? [];
  const allUsers          = usersResult?.data?.users ?? [];

  // Revenue calculations
  const paidMaterialRevenue  = allMaterialOrders.filter(o => ["paid", "submitted"].includes(o.status)).reduce((s, o) => s + (o.total_nok ?? 0), 0);
  const paidProjectRevenue   = allProjects.filter(p => p.payment_status === "paid").reduce((s, p) => s + (p.price_nok ?? 0), 0);
  const paidShopRevenue      = allShopOrders.filter(o => ["paid", "fulfilled"].includes(o.status)).reduce((s, o) => s + (o.total_nok ?? 0), 0);
  const totalRevenue         = paidMaterialRevenue + paidProjectRevenue + paidShopRevenue;

  const totalOrders  = allMaterialOrders.length + allShopOrders.length;
  const paidOrders   = allMaterialOrders.filter(o => ["paid", "submitted"].includes(o.status)).length
                     + allShopOrders.filter(o => ["paid", "fulfilled"].includes(o.status)).length;

  // Status breakdown for material orders
  const statusCounts = allMaterialOrders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  // Monthly revenue (last 6 months) - material orders
  const now = new Date();
  const months: { key: string; label: string; nok: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("nb-NO", { month: "short", year: "2-digit" });
    const nok = allMaterialOrders
      .filter(o => ["paid", "submitted"].includes(o.status) && o.created_at.startsWith(key))
      .reduce((s, o) => s + (o.total_nok ?? 0), 0);
    months.push({ key, label, nok });
  }
  const maxMonthNok = Math.max(...months.map(m => m.nok), 1);

  // Recent orders (last 8)
  const recentOrders = allMaterialOrders.slice(0, 8);

  // Users created this month
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const newUsersThisMonth = allUsers.filter(u => u.created_at?.startsWith(thisMonthKey)).length;

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Dashboard</h1>
        <p className="text-sm text-stone-500 mt-0.5">Oversikt over hele plattformen</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total inntekt"
          value={fmt(totalRevenue)}
          sub="alle betalte ordre"
          accent="amber"
          icon={<IconCoin />}
        />
        <KpiCard
          label="Totale bestillinger"
          value={fmtNum(totalOrders)}
          sub={`${paidOrders} betalte`}
          accent="blue"
          icon={<IconBox />}
        />
        <KpiCard
          label="Registrerte brukere"
          value={fmtNum(allUsers.length)}
          sub={`+${newUsersThisMonth} denne måneden`}
          accent="emerald"
          icon={<IconUsers />}
        />
        <KpiCard
          label="Snitt ordreverdi"
          value={paidOrders > 0 ? fmt(Math.round(totalRevenue / paidOrders)) : "—"}
          sub="betalte material-ordre"
          accent="violet"
          icon={<IconTrend />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly revenue chart */}
        <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-stone-900 mb-1">Inntekt siste 6 måneder</h2>
          <p className="text-xs text-stone-400 mb-5">Betalte materialbestillinger</p>
          <div className="flex items-end gap-2 h-32">
            {months.map((m) => {
              const pct = maxMonthNok > 0 ? Math.max((m.nok / maxMonthNok) * 100, 2) : 2;
              return (
                <div key={m.key} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full relative group">
                    <div
                      className="w-full rounded-t-md bg-amber-500/80 hover:bg-amber-400 transition"
                      style={{ height: `${(pct / 100) * 128}px` }}
                    />
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:block bg-stone-200 text-stone-900 text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                      {fmt(m.nok)}
                    </div>
                  </div>
                  <span className="text-[10px] text-stone-400">{m.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Order status breakdown */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-stone-900 mb-1">Ordre-status</h2>
          <p className="text-xs text-stone-400 mb-5">Materialbestillinger</p>
          <div className="space-y-2.5">
            {Object.entries(statusCounts).map(([status, count]) => {
              const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-stone-200 text-stone-700" };
              const pct = allMaterialOrders.length > 0 ? Math.round((count / allMaterialOrders.length) * 100) : 0;
              return (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-xs text-stone-500">{count} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {Object.keys(statusCounts).length === 0 && (
              <p className="text-xs text-stone-400">Ingen bestillinger ennå.</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent orders */}
      <div className="bg-white border border-stone-200 rounded-2xl">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-900">Siste bestillinger</h2>
          <a href="/sjefen/bestillinger" className="text-xs text-amber-500 hover:text-amber-400 transition">Se alle →</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left">
                <th className="px-6 py-3 text-xs text-stone-400 font-medium">ID</th>
                <th className="px-6 py-3 text-xs text-stone-400 font-medium">Dato</th>
                <th className="px-6 py-3 text-xs text-stone-400 font-medium">Status</th>
                <th className="px-6 py-3 text-xs text-stone-400 font-medium text-right">Beløp</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => {
                const cfg = STATUS_CONFIG[o.status] ?? { label: o.status, color: "bg-stone-200 text-stone-700" };
                return (
                  <tr key={o.id} className="border-b border-stone-200/70 hover:bg-stone-50/80 transition">
                    <td className="px-6 py-3 font-mono text-xs text-stone-500">{o.id.slice(0, 8)}…</td>
                    <td className="px-6 py-3 text-stone-700 text-xs">{new Date(o.created_at).toLocaleDateString("nb-NO")}</td>
                    <td className="px-6 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span></td>
                    <td className="px-6 py-3 text-right text-stone-800 font-medium">{fmt(o.total_nok)}</td>
                  </tr>
                );
              })}
              {recentOrders.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-stone-400 text-sm">Ingen bestillinger ennå.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Sub-components ----

function KpiCard({ label, value, sub, accent, icon }: { label: string; value: string; sub: string; accent: string; icon: React.ReactNode }) {
  const accentMap: Record<string, string> = {
    amber:  "bg-amber-500/10 text-amber-500",
    blue:   "bg-blue-500/10 text-blue-400",
    emerald:"bg-emerald-500/10 text-emerald-400",
    violet: "bg-violet-500/10 text-violet-400",
  };
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs text-stone-400 uppercase tracking-wider">{label}</p>
        <span className={`p-2 rounded-lg ${accentMap[accent]}`}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-stone-900">{value}</p>
      <p className="text-xs text-stone-400 mt-1">{sub}</p>
    </div>
  );
}

function IconCoin() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>;
}
function IconBox() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>;
}
function IconUsers() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
function IconTrend() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>;
}
