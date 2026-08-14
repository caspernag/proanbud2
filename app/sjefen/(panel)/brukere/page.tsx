import {
  adminRows,
  collectErrors,
  fetchAllAuthUsers,
  isPaidMaterialStatus,
  isPaidShopStatus,
  requireAdminDb,
} from "@/lib/admin-data";

import {
  Badge,
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

type MaterialOrder = { id: string; user_id: string; status: string; total_nok: number };
type ShopOrder = { id: string; status: string; total_nok: number; customer_email: string; customer_name: string; created_at: string };
type Project = { id: string; user_id: string; payment_status: string };

type CustomerRow = {
  key: string;
  email: string;
  name: string | null;
  registered: string | null;
  lastSignIn: string | null;
  hasAccount: boolean;
  projectCount: number;
  paidProjectCount: number;
  materialCount: number;
  shopCount: number;
  spentNok: number;
};

export default async function BrukerePage() {
  const db = await requireAdminDb();

  const [usersResult, materialResult, shopResult, projectResult] = await Promise.all([
    fetchAllAuthUsers(db),
    adminRows<MaterialOrder>(
      "Materialbestillinger",
      db.from("material_orders").select("id, user_id, status, total_nok"),
    ),
    adminRows<ShopOrder>(
      "Butikkordre",
      db.from("shop_orders").select("id, status, total_nok, customer_email, customer_name, created_at"),
    ),
    adminRows<Project>("Prosjekter", db.from("projects").select("id, user_id, payment_status")),
  ]);

  const errors = collectErrors(usersResult, materialResult, shopResult, projectResult);

  /* ── Bygg kunderader ───────────────────────────────────────────────────
   * Butikken tillater kjøp uten konto, så en kunde er ikke det samme som en
   * auth-bruker. Vi nøkler på e-post og fletter inn kontoinfo der den finnes,
   * slik at gjestekjøp ikke forsvinner ut av oversikten.               */

  const byEmail = new Map<string, CustomerRow>();
  const byUserId = new Map<string, CustomerRow>();

  for (const user of usersResult.rows) {
    const email = (user.email ?? "").toLowerCase();
    const row: CustomerRow = {
      key: user.id,
      email: user.email ?? "—",
      name: null,
      registered: user.created_at,
      lastSignIn: user.last_sign_in_at,
      hasAccount: true,
      projectCount: 0,
      paidProjectCount: 0,
      materialCount: 0,
      shopCount: 0,
      spentNok: 0,
    };
    byUserId.set(user.id, row);
    if (email) byEmail.set(email, row);
  }

  for (const order of materialResult.rows) {
    const row = byUserId.get(order.user_id);
    if (!row) continue;
    row.materialCount += 1;
    if (isPaidMaterialStatus(order.status)) row.spentNok += order.total_nok ?? 0;
  }

  for (const project of projectResult.rows) {
    const row = byUserId.get(project.user_id);
    if (!row) continue;
    row.projectCount += 1;
    if (project.payment_status === "paid") row.paidProjectCount += 1;
  }

  let guestCount = 0;
  for (const order of shopResult.rows) {
    const email = (order.customer_email ?? "").toLowerCase();
    if (!email) continue;

    let row = byEmail.get(email);
    if (!row) {
      guestCount += 1;
      row = {
        key: `gjest:${email}`,
        email: order.customer_email,
        name: order.customer_name,
        registered: null,
        lastSignIn: null,
        hasAccount: false,
        projectCount: 0,
        paidProjectCount: 0,
        materialCount: 0,
        shopCount: 0,
        spentNok: 0,
      };
      byEmail.set(email, row);
    }

    if (!row.name) row.name = order.customer_name;
    row.shopCount += 1;
    if (isPaidShopStatus(order.status)) row.spentNok += order.total_nok ?? 0;
  }

  const customers = [...new Set([...byUserId.values(), ...byEmail.values()])].sort(
    (a, b) => b.spentNok - a.spentNok || (b.registered ?? "").localeCompare(a.registered ?? ""),
  );

  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const newThisMonth = customers.filter((c) => c.registered?.startsWith(thisMonthKey)).length;
  const payingCustomers = customers.filter((c) => c.spentNok > 0).length;
  const totalSpent = customers.reduce((sum, c) => sum + c.spentNok, 0);

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Kunder"
        title="Brukere"
        description="Registrerte brukere og gjestekunder som har handlet i butikken."
      />

      <DataErrorBanner errors={errors} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Kunder totalt" value={num(customers.length)} sub={`${guestCount} uten konto`} />
        <StatCard label="Nye denne måneden" value={num(newThisMonth)} sub="registrerte kontoer" />
        <StatCard label="Har handlet" value={num(payingCustomers)} sub="minst én betalt ordre" tone="good" />
        <StatCard label="Omsatt på kunder" value={nok(totalSpent)} sub="sum betalte ordre" tone="accent" />
      </section>

      <Card bodyClassName="">
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <Th>Kunde</Th>
              <Th>Konto</Th>
              <Th>Registrert</Th>
              <Th>Sist innlogget</Th>
              <Th align="right">Prosjekter</Th>
              <Th align="right">Ordre</Th>
              <Th align="right">Totalt handlet</Th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.key} className="border-b border-stone-100 transition hover:bg-stone-50">
                <Td>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-[#eaf6ef] text-xs font-semibold text-[#12492f]">
                      {(customer.name ?? customer.email)[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span className="min-w-0">
                      {customer.name ? (
                        <span className="block truncate text-xs font-semibold text-stone-800">{customer.name}</span>
                      ) : null}
                      <span className="block max-w-[220px] truncate text-[11px] text-stone-500">
                        {customer.email}
                      </span>
                    </span>
                  </div>
                </Td>
                <Td>
                  {customer.hasAccount ? (
                    <Badge tone="accent">Konto</Badge>
                  ) : (
                    <Badge tone="neutral">Gjest</Badge>
                  )}
                </Td>
                <Td className="text-xs text-stone-500">
                  {customer.registered ? dateNo(customer.registered) : <span className="text-stone-300">—</span>}
                </Td>
                <Td className="text-xs text-stone-500">
                  {customer.lastSignIn ? dateNo(customer.lastSignIn) : <span className="text-stone-300">Aldri</span>}
                </Td>
                <Td align="right" className="text-xs tabular-nums text-stone-600">
                  {customer.projectCount > 0 ? (
                    <>
                      {customer.projectCount}
                      {customer.paidProjectCount > 0 ? (
                        <span className="ml-1 text-emerald-700">({customer.paidProjectCount} betalt)</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-stone-300">—</span>
                  )}
                </Td>
                <Td align="right" className="text-xs tabular-nums text-stone-600">
                  {customer.materialCount + customer.shopCount > 0 ? (
                    customer.materialCount + customer.shopCount
                  ) : (
                    <span className="text-stone-300">—</span>
                  )}
                </Td>
                <Td align="right" className="font-semibold tabular-nums text-stone-900">
                  {customer.spentNok > 0 ? nok(customer.spentNok) : <span className="text-stone-300">—</span>}
                </Td>
              </tr>
            ))}
            {customers.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState>Ingen kunder funnet.</EmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
