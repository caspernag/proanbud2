import { requireAdminUser } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function fmt(nok: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(nok);
}

export default async function BrukerePage() {
  await requireAdminUser();

  const supabase = await createSupabaseServerClient();
  const adminClient = createSupabaseAdminClient();

  const [usersResult, { data: materialOrders }, { data: projects }] = await Promise.all([
    adminClient
      ? adminClient.auth.admin.listUsers({ page: 1, perPage: 500 })
      : Promise.resolve({ data: { users: [] }, error: null }),
    supabase!
      .from("material_orders")
      .select("id, user_id, status, total_nok, created_at"),
    supabase!
      .from("projects")
      .select("id, user_id, payment_status, created_at"),
  ]);

  const users = usersResult?.data?.users ?? [];

  // Build per-user stats
  type UserStats = {
    id: string;
    email: string;
    createdAt: string;
    lastSignIn: string | null;
    materialOrderCount: number;
    paidMaterialOrderCount: number;
    totalSpentNok: number;
    projectCount: number;
    paidProjectCount: number;
    provider: string;
  };

  const statsMap = new Map<string, UserStats>(
    users.map((u) => [
      u.id,
      {
        id:                    u.id,
        email:                 u.email ?? "—",
        createdAt:             u.created_at,
        lastSignIn:            u.last_sign_in_at ?? null,
        materialOrderCount:    0,
        paidMaterialOrderCount: 0,
        totalSpentNok:         0,
        projectCount:          0,
        paidProjectCount:      0,
        provider:              u.app_metadata?.provider ?? "email",
      },
    ])
  );

  for (const o of materialOrders ?? []) {
    const s = statsMap.get(o.user_id);
    if (!s) continue;
    s.materialOrderCount++;
    if (["paid", "submitted"].includes(o.status)) {
      s.paidMaterialOrderCount++;
      s.totalSpentNok += o.total_nok ?? 0;
    }
  }

  for (const p of projects ?? []) {
    const s = statsMap.get(p.user_id);
    if (!s) continue;
    s.projectCount++;
    if (p.payment_status === "paid") s.paidProjectCount++;
  }

  const allStats = Array.from(statsMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Summary
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const newThisMonth = allStats.filter((u) => u.createdAt.startsWith(thisMonthKey)).length;
  const activeUsers  = allStats.filter((u) => u.paidMaterialOrderCount > 0 || u.paidProjectCount > 0).length;
  const totalRevenue = allStats.reduce((s, u) => s + u.totalSpentNok, 0);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Brukere</h1>
        <p className="text-sm text-stone-400 mt-0.5">Alle registrerte brukere</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Totalt",          value: allStats.length,   color: "text-white" },
          { label: "Nye denne mnd.",  value: newThisMonth,      color: "text-emerald-400" },
          { label: "Aktive (kjøpt)",  value: activeUsers,       color: "text-amber-400" },
          { label: "Total inntekt",   value: fmt(totalRevenue), color: "text-blue-400" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-stone-200 rounded-2xl p-5">
            <p className="text-xs text-stone-400 uppercase tracking-wider mb-2">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* User table */}
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left">
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">E-post</th>
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Registrert</th>
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Sist innlogget</th>
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Prosjekter</th>
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium">Bestillinger</th>
                <th className="px-5 py-3.5 text-xs text-stone-400 font-medium text-right">Totalt brukt</th>
              </tr>
            </thead>
            <tbody>
              {allStats.map((u) => (
                <tr key={u.id} className="border-b border-stone-200/70 hover:bg-stone-50/80 transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center text-xs font-medium text-stone-700 shrink-0">
                        {u.email[0]?.toUpperCase() ?? "?"}
                      </div>
                      <span className="text-xs text-stone-800 truncate max-w-[200px]">{u.email}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-stone-500">{new Date(u.createdAt).toLocaleDateString("nb-NO")}</td>
                  <td className="px-5 py-3 text-xs text-stone-500">
                    {u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString("nb-NO") : <span className="text-stone-400">Aldri</span>}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-stone-700">{u.projectCount}</span>
                      {u.paidProjectCount > 0 && (
                        <span className="text-xs text-emerald-400">({u.paidProjectCount} betalt)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-stone-700">{u.materialOrderCount}</span>
                      {u.paidMaterialOrderCount > 0 && (
                        <span className="text-xs text-emerald-400">({u.paidMaterialOrderCount} betalt)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {u.totalSpentNok > 0 ? (
                      <span className="text-sm font-semibold text-amber-400">{fmt(u.totalSpentNok)}</span>
                    ) : (
                      <span className="text-xs text-stone-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {allStats.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-stone-400 text-sm">Ingen brukere funnet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
