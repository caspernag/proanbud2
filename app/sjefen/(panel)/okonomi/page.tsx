import {
  adminRows,
  collectErrors,
  isPaidMaterialStatus,
  isPaidShopStatus,
  requireAdminDb,
} from "@/lib/admin-data";

import {
  Card,
  DataErrorBanner,
  EmptyState,
  PageHeader,
  StatCard,
  TableWrap,
  Td,
  Th,
  nok,
} from "../../_components/ui";

type MaterialOrder = {
  id: string;
  status: string;
  total_nok: number;
  vat_nok: number | null;
  delivery_fee_nok: number | null;
  created_at: string;
  paid_at: string | null;
};

type ShopOrder = {
  id: string;
  status: string;
  total_nok: number;
  vat_nok: number | null;
  shipping_nok: number | null;
  created_at: string;
  paid_at: string | null;
};

type Project = {
  id: string;
  payment_status: string;
  price_nok: number | null;
  created_at: string;
};

const SOURCES = [
  { key: "shop", label: "Butikksalg", bar: "bg-[#163f2a]", dot: "bg-[#163f2a]" },
  { key: "material", label: "Materialbestillinger", bar: "bg-[#2f7f58]", dot: "bg-[#2f7f58]" },
  { key: "projects", label: "Prosjektpriser", bar: "bg-[#a7d8bd]", dot: "bg-[#a7d8bd]" },
] as const;

export default async function OkonomiPage() {
  const db = await requireAdminDb();

  const [materialResult, shopResult, projectResult] = await Promise.all([
    adminRows<MaterialOrder>(
      "Materialbestillinger",
      db.from("material_orders").select("id, status, total_nok, vat_nok, delivery_fee_nok, created_at, paid_at"),
    ),
    adminRows<ShopOrder>(
      "Butikkordre",
      db.from("shop_orders").select("id, status, total_nok, vat_nok, shipping_nok, created_at, paid_at"),
    ),
    adminRows<Project>("Prosjekter", db.from("projects").select("id, payment_status, price_nok, created_at")),
  ]);

  const errors = collectErrors(materialResult, shopResult, projectResult);

  const paidMaterial = materialResult.rows.filter((o) => isPaidMaterialStatus(o.status));
  const paidShop = shopResult.rows.filter((o) => isPaidShopStatus(o.status));
  const paidProjects = projectResult.rows.filter((p) => p.payment_status === "paid");

  const materialRevenue = sum(paidMaterial, (o) => o.total_nok);
  const shopRevenue = sum(paidShop, (o) => o.total_nok);
  const projectRevenue = sum(paidProjects, (p) => p.price_nok ?? 0);
  const totalRevenue = materialRevenue + shopRevenue + projectRevenue;

  const totalVat = sum(paidMaterial, (o) => o.vat_nok ?? 0) + sum(paidShop, (o) => o.vat_nok ?? 0);
  const totalShipping =
    sum(paidMaterial, (o) => o.delivery_fee_nok ?? 0) + sum(paidShop, (o) => o.shipping_nok ?? 0);

  /* ── Månedsserie ───────────────────────────────────────────────────────── */

  const now = new Date();
  type Month = { key: string; label: string; material: number; shop: number; projects: number; total: number };
  const months: Month[] = [];

  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const label = date.toLocaleDateString("nb-NO", { month: "short", year: "2-digit" });

    // Omsetning føres på betalingsdato når den finnes, ellers opprettelsesdato.
    const material = sum(
      paidMaterial.filter((o) => (o.paid_at ?? o.created_at).startsWith(key)),
      (o) => o.total_nok,
    );
    const shop = sum(
      paidShop.filter((o) => (o.paid_at ?? o.created_at).startsWith(key)),
      (o) => o.total_nok,
    );
    const projects = sum(
      paidProjects.filter((p) => p.created_at.startsWith(key)),
      (p) => p.price_nok ?? 0,
    );

    months.push({ key, label, material, shop, projects, total: material + shop + projects });
  }

  const maxMonth = Math.max(...months.map((m) => m.total), 1);
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonth = months.find((m) => m.key === currentKey);
  const previousMonth = months[months.length - 2];
  const growth =
    previousMonth && previousMonth.total > 0
      ? Math.round(((currentMonth?.total ?? 0) - previousMonth.total) / previousMonth.total * 100)
      : null;

  const sourceTotals: Record<(typeof SOURCES)[number]["key"], number> = {
    shop: shopRevenue,
    material: materialRevenue,
    projects: projectRevenue,
  };

  const paidOrderCount = paidMaterial.length + paidShop.length;
  const hasRevenue = totalRevenue > 0;

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Regnskap"
        title="Økonomi"
        description="Omsetning på tvers av butikksalg, materialbestillinger og prosjektpriser."
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
          label="Denne måneden"
          value={nok(currentMonth?.total ?? 0)}
          sub={growth !== null ? `${growth >= 0 ? "+" : ""}${growth} % mot forrige måned` : "ingen sammenligning"}
          tone={growth !== null && growth < 0 ? "danger" : "neutral"}
        />
        <StatCard label="MVA innkrevd" value={nok(totalVat)} sub="av betalte ordre" />
        <StatCard label="Frakt betalt av kunder" value={nok(totalShipping)} sub="inkludert i omsetning" />
      </section>

      {!hasRevenue && errors.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-600">
            Ingen betalt omsetning registrert ennå. Tallene fylles inn automatisk når ordre betales.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Omsetning per måned"
          description="Siste 12 måneder, fordelt på inntektskilde"
          className="lg:col-span-2"
        >
          <div className="mb-5 flex flex-wrap items-center gap-4">
            {SOURCES.map((source) => (
              <span key={source.key} className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 ${source.dot}`} />
                <span className="text-xs text-stone-500">{source.label}</span>
              </span>
            ))}
          </div>

          <div className="flex h-40 items-end gap-1.5">
            {months.map((month) => {
              const height = Math.max((month.total / maxMonth) * 100, month.total > 0 ? 3 : 1);
              return (
                <div key={month.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <div className="relative flex w-full flex-col-reverse" style={{ height: `${height}%` }}>
                    {month.total > 0 ? (
                      <>
                        <span
                          className="w-full bg-[#163f2a]"
                          style={{ height: `${(month.shop / month.total) * 100}%` }}
                        />
                        <span
                          className="w-full bg-[#2f7f58]"
                          style={{ height: `${(month.material / month.total) * 100}%` }}
                        />
                        <span
                          className="w-full bg-[#a7d8bd]"
                          style={{ height: `${(month.projects / month.total) * 100}%` }}
                        />
                      </>
                    ) : (
                      <span className="w-full bg-stone-200" />
                    )}
                  </div>
                  <span className="truncate text-[9px] text-stone-400">{month.label}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Inntektskilder" description="Andel av total omsetning">
          <div className="space-y-4">
            {SOURCES.map((source) => {
              const amount = sourceTotals[source.key];
              const pct = totalRevenue > 0 ? Math.round((amount / totalRevenue) * 100) : 0;
              return (
                <div key={source.key}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-stone-700">{source.label}</span>
                    <span className="text-xs tabular-nums text-stone-500">{pct} %</span>
                  </div>
                  <div className="h-2 bg-stone-100">
                    <div className={`h-full ${source.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-stone-500">{nok(amount)}</p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="Månedlig detaljert" bodyClassName="">
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <Th>Måned</Th>
              <Th align="right">Butikksalg</Th>
              <Th align="right">Materialbestillinger</Th>
              <Th align="right">Prosjektpriser</Th>
              <Th align="right">Totalt</Th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().map((month) => (
              <tr
                key={month.key}
                className={`border-b border-stone-100 transition hover:bg-stone-50 ${
                  month.key === currentKey ? "bg-[#f2f8f4]" : ""
                }`}
              >
                <Td className="text-sm font-medium text-stone-800">
                  {month.label}
                  {month.key === currentKey ? (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[#2f7f58]">
                      Nå
                    </span>
                  ) : null}
                </Td>
                <Td align="right" className="text-xs tabular-nums text-stone-600">
                  {month.shop > 0 ? nok(month.shop) : <span className="text-stone-300">—</span>}
                </Td>
                <Td align="right" className="text-xs tabular-nums text-stone-600">
                  {month.material > 0 ? nok(month.material) : <span className="text-stone-300">—</span>}
                </Td>
                <Td align="right" className="text-xs tabular-nums text-stone-600">
                  {month.projects > 0 ? nok(month.projects) : <span className="text-stone-300">—</span>}
                </Td>
                <Td align="right" className="font-semibold tabular-nums text-stone-900">
                  {month.total > 0 ? nok(month.total) : <span className="text-stone-300">—</span>}
                </Td>
              </tr>
            ))}
            {months.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState>Ingen data.</EmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + (pick(row) || 0), 0);
}
