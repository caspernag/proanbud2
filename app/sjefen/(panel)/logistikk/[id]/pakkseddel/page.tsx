import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdminUser } from "@/lib/admin-auth";
import { SHOP_ORDER_TRANSPORT_LABELS } from "@/lib/shop-order";
import {
  carrierLabel,
  formatDateNo,
  orderReference,
  type LogisticsOrder,
} from "@/lib/shop-order-logistics";
import { LOGISTICS_ORDER_COLUMNS } from "@/lib/shop-order-logistics-admin";
import { withResolvedShopOrderUnits } from "@/lib/shop-order-units";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { PrintButton } from "../../_components/print-button";

type ShopItem = {
  id: string;
  product_id: string;
  product_name: string;
  supplier_name: string;
  nobb_number: string;
  quantity: number;
  unit: string;
  unit_price_nok: number;
  line_total_nok: number;
};

/**
 * Plukkliste/pakkseddel til lager og sjåfør. Bevisst uten priser — arket
 * følger varene, og kunden skal ikke se innkjøps- eller marginlinjer.
 */
export default async function PakkseddelPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminUser();

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return <div className="p-8 text-sm text-stone-600">Database ikke konfigurert.</div>;
  }

  const { data: order } = await supabase
    .from("shop_orders")
    .select(LOGISTICS_ORDER_COLUMNS)
    .eq("id", id)
    .maybeSingle<LogisticsOrder>();

  if (!order) {
    notFound();
  }

  const { data: items } = await supabase
    .from("shop_order_items")
    .select("id, product_id, product_name, supplier_name, nobb_number, quantity, unit, unit_price_nok, line_total_nok")
    .eq("order_id", order.id)
    .order("supplier_name")
    .returns<ShopItem[]>();

  const resolvedItems = await withResolvedShopOrderUnits(items ?? []);
  const reference = orderReference(order);

  return (
    <div className="p-8 print:p-0">
      <div className="mb-5 flex items-center gap-2 print:hidden">
        <Link
          href={`/sjefen/logistikk/${order.id}`}
          className="inline-flex h-9 items-center border border-stone-300 bg-white px-4 text-xs font-semibold text-stone-700 hover:border-stone-900"
        >
          ← Tilbake til ordren
        </Link>
        <PrintButton
          label="Skriv ut pakkseddel"
          className="inline-flex h-9 items-center bg-[#163f2a] px-4 text-xs font-bold text-white hover:bg-[#1d5639]"
        />
      </div>

      <article className="mx-auto max-w-[820px] border border-stone-300 bg-white p-10 text-stone-900 print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-6 border-b-2 border-stone-900 pb-5">
          <div>
            <p className="text-xl font-bold tracking-tight">
              prisbygg<span className="text-[#2f7f58]">.</span>
            </p>
            <h1 className="mt-3 text-2xl font-bold">Pakkseddel</h1>
          </div>
          <div className="text-right text-sm leading-6">
            <p className="text-xs uppercase tracking-wider text-stone-500">Ordre</p>
            <p className="font-mono text-base font-bold">{reference}</p>
            <p className="mt-1 text-stone-600">
              Betalt {order.paid_at ? formatDateNo(order.paid_at) : "—"}
            </p>
            <p className="text-stone-600">Utskrift {formatDateNo(new Date().toISOString())}</p>
          </div>
        </header>

        <section className="grid gap-8 border-b border-stone-200 py-5 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500">Leveres til</h2>
            <address className="mt-2 text-sm not-italic leading-6">
              <span className="font-bold">{order.customer_name}</span>
              <br />
              {order.shipping_address_line1}
              <br />
              {order.shipping_postal_code} {order.shipping_city}
              {order.customer_phone ? (
                <>
                  <br />
                  Tlf. {order.customer_phone}
                </>
              ) : null}
              <br />
              {order.customer_email}
            </address>
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500">Transport</h2>
            <dl className="mt-2 space-y-1 text-sm leading-6">
              <Row label="Status" value={SHOP_ORDER_TRANSPORT_LABELS[order.transport_status]} />
              <Row label="Transportør" value={carrierLabel(order.carrier_code, order.carrier) ?? "Ikke satt"} />
              <Row label="Sporing" value={order.tracking_number ?? "Ikke satt"} />
              <Row
                label="Estimert levering"
                value={order.estimated_delivery_date ? formatDateNo(order.estimated_delivery_date) : "Ikke satt"}
              />
            </dl>
          </div>
        </section>

        {order.customer_note?.trim() ? (
          <section className="border-b border-stone-200 py-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500">Beskjed fra kunden</h2>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6">{order.customer_note}</p>
          </section>
        ) : null}

        <section className="py-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500">
            Varer ({resolvedItems.length} linjer)
          </h2>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-stone-300 text-left">
                <th className="w-10 py-2 text-xs font-bold uppercase text-stone-500">✓</th>
                <th className="py-2 text-xs font-bold uppercase text-stone-500">NOBB</th>
                <th className="py-2 text-xs font-bold uppercase text-stone-500">Produkt</th>
                <th className="py-2 text-right text-xs font-bold uppercase text-stone-500">Antall</th>
              </tr>
            </thead>
            <tbody>
              {resolvedItems.map((item) => (
                <tr key={item.id} className="border-b border-stone-200 align-top">
                  <td className="py-2.5">
                    <span className="block h-4 w-4 rounded-sm border border-stone-500" aria-hidden />
                  </td>
                  <td className="py-2.5 font-mono text-xs text-stone-600">{item.nobb_number}</td>
                  <td className="py-2.5">
                    <span className="font-semibold">{item.product_name}</span>
                    <span className="block text-xs text-stone-500">{item.supplier_name}</span>
                  </td>
                  <td className="py-2.5 text-right font-bold tabular-nums">
                    {item.quantity} {item.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {order.internal_note?.trim() ? (
          <section className="border-t border-stone-200 py-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500">Internt notat</h2>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6">{order.internal_note}</p>
          </section>
        ) : null}

        <footer className="grid gap-10 border-t-2 border-stone-900 pt-6 sm:grid-cols-2">
          <div>
            <div className="h-10 border-b border-stone-400" />
            <p className="mt-1.5 text-xs text-stone-500">Plukket av / dato</p>
          </div>
          <div>
            <div className="h-10 border-b border-stone-400" />
            <p className="mt-1.5 text-xs text-stone-500">Mottatt av / dato</p>
          </div>
        </footer>
      </article>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}
