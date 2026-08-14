import Link from "next/link";
import { notFound } from "next/navigation";

import { osloDayRange } from "@/lib/accounting/daybook";
import { adminRows, collectErrors, requireAdminDb } from "@/lib/admin-data";

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
} from "../../../../_components/ui";

/**
 * Bilagsspesifikasjonen for én bokføringsdag.
 *
 * Dagsoppgjøret er ett tall i regnskapet. Bokføringsloven krever at hvert enkelt
 * salg bak det tallet kan spesifiseres — denne siden ER den spesifikasjonen, og
 * må kunne vises fram ved bokettersyn.
 */

type DaybookRow = {
  booking_date: string;
  gross_ore: number;
  goods_net_ore: number;
  shipping_net_ore: number;
  outgoing_vat_ore: number;
  order_count: number;
  status: string;
  fiken_journal_entry_id: string | null;
  posted_at: string | null;
};

type OrderRow = {
  id: string;
  order_number: number | null;
  slug: string | null;
  customer_name: string;
  subtotal_nok: number | null;
  shipping_nok: number | null;
  vat_nok: number | null;
  total_nok: number | null;
  paid_at: string | null;
  stripe_fee_ore: number | null;
};

function kr(ore: number) {
  return nok(ore / 100);
}

export default async function DaybookDetailPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    notFound();
  }

  const db = await requireAdminDb();
  const { fromIso, toIso } = osloDayRange(date);

  const [daybookResult, orderResult] = await Promise.all([
    adminRows<DaybookRow>(
      "Dagsoppgjør",
      db
        .from("accounting_daybook")
        .select(
          "booking_date, gross_ore, goods_net_ore, shipping_net_ore, outgoing_vat_ore, order_count, status, fiken_journal_entry_id, posted_at",
        )
        .eq("booking_date", date),
    ),
    adminRows<OrderRow>(
      "Ordre",
      db
        .from("shop_orders")
        .select(
          "id, order_number, slug, customer_name, subtotal_nok, shipping_nok, vat_nok, total_nok, paid_at, stripe_fee_ore",
        )
        .in("status", ["paid", "fulfilled"])
        .gte("paid_at", fromIso)
        .lt("paid_at", toIso)
        .order("paid_at"),
    ),
  ]);

  const errors = collectErrors(daybookResult, orderResult);
  const daybook = daybookResult.rows[0] ?? null;
  const orders = orderResult.rows;

  // Summen av ordrene skal være nøyaktig det bilaget sier. Spriker de, er
  // bilaget bygget på et annet ordreutvalg enn det som vises her — typisk fordi
  // en ordre er endret eller kansellert etter at dagen ble bokført.
  const ordersGrossOre = orders.reduce((sum, order) => sum + Math.round((order.total_nok ?? 0) * 100), 0);
  const drift = daybook ? ordersGrossOre - daybook.gross_ore : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Dagsoppgjør ${dateNo(date)}`}
        description="Salgene som utgjør bilaget for denne dagen."
        actions={
          <Link
            href="/sjefen/okonomi/regnskap"
            className="inline-flex h-10 items-center border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 transition hover:border-stone-900"
          >
            Tilbake
          </Link>
        }
      />

      {errors.length > 0 ? <DataErrorBanner errors={errors} /> : null}

      {daybook ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Brutto omsetning" value={kr(daybook.gross_ore)} sub={`${num(daybook.order_count)} ordre`} />
          <StatCard label="Varesalg eks. mva" value={kr(daybook.goods_net_ore)} sub="Konto 3000" />
          <StatCard label="Frakt eks. mva" value={kr(daybook.shipping_net_ore)} sub="Konto 3070" />
          <StatCard
            label="Utgående mva"
            value={kr(daybook.outgoing_vat_ore)}
            sub={daybook.fiken_journal_entry_id ? `Bilag ${daybook.fiken_journal_entry_id}` : "Ikke bokført"}
            tone={daybook.fiken_journal_entry_id ? "good" : "neutral"}
          />
        </div>
      ) : (
        <div className="border border-stone-200 bg-stone-50 px-5 py-4 text-sm text-stone-700">
          Ingen bilag er laget for denne dagen ennå. Ordrene under er de som vil inngå i det.
        </div>
      )}

      {drift !== 0 ? (
        <div className="border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          <p className="font-semibold">Ordrene stemmer ikke med bilaget.</p>
          <p className="mt-1 text-xs leading-relaxed">
            Ordrene under summerer til {kr(ordersGrossOre)}, mens bilaget lyder på {kr(daybook?.gross_ore ?? 0)} —
            et avvik på {kr(Math.abs(drift))}. Sannsynligvis er en ordre endret eller kansellert etter at dagen
            ble bokført. Bilaget skal ikke redigeres; korriger med et eget bilag.
          </p>
        </div>
      ) : null}

      <Card title="Salg denne dagen" description="Bilagsspesifikasjon" bodyClassName="">
        {orders.length === 0 ? (
          <EmptyState>Ingen betalte ordre denne dagen.</EmptyState>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Ordre</Th>
                <Th>Kunde</Th>
                <Th align="right">Varer</Th>
                <Th align="right">Frakt</Th>
                <Th align="right">Mva</Th>
                <Th align="right">Totalt</Th>
                <Th align="right">Stripe-gebyr</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t border-stone-200">
                  <Td>
                    <Link
                      href={`/sjefen/logistikk/${order.id}`}
                      className="font-mono text-xs font-semibold text-stone-900 underline-offset-2 hover:underline"
                    >
                      {order.order_number != null ? `#${order.order_number}` : (order.slug ?? order.id.slice(0, 8))}
                    </Link>
                  </Td>
                  <Td>{order.customer_name}</Td>
                  <Td align="right">{nok(order.subtotal_nok ?? 0)}</Td>
                  <Td align="right">{nok(order.shipping_nok ?? 0)}</Td>
                  <Td align="right" className="text-stone-600">
                    {nok(order.vat_nok ?? 0)}
                  </Td>
                  <Td align="right" className="font-semibold">
                    {nok(order.total_nok ?? 0)}
                  </Td>
                  <Td align="right">
                    {order.stripe_fee_ore != null ? (
                      <span className="text-red-700">−{kr(order.stripe_fee_ore)}</span>
                    ) : (
                      <Badge tone="neutral">Ukjent</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
