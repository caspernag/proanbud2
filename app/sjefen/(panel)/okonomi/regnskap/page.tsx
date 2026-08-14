import Link from "next/link";

import { ActionForm, SubmitButton } from "@/app/sjefen/_components/action-form";
import { osloDateOf } from "@/lib/accounting/daybook";
import { adminRows, collectErrors, requireAdminDb } from "@/lib/admin-data";
import { hasFikenEnv } from "@/lib/env";

import {
  BTN_SECONDARY,
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
} from "../../../_components/ui";
import { retryDaybookAction, runDaybookCatchUpAction } from "./actions";

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
  error_message: string | null;
};

type PayoutRow = {
  stripe_payout_id: string;
  payout_date: string;
  gross_ore: number;
  fee_ore: number;
  net_ore: number;
  status: string;
  fiken_journal_entry_id: string | null;
};

type PaidOrderRow = {
  id: string;
  total_nok: number | null;
  paid_at: string | null;
  goods_cost_nok: number | null;
};

type RefundRow = {
  stripe_refund_id: string;
  refund_date: string;
  total_gross_ore: number;
  is_full_refund: boolean;
  needs_review: boolean;
  status: string;
  fiken_journal_entry_id: string | null;
};

function kr(ore: number) {
  return nok(ore / 100);
}

export default async function RegnskapPage() {
  const db = await requireAdminDb();

  const [daybookResult, payoutResult, orderResult, refundResult] = await Promise.all([
    adminRows<DaybookRow>(
      "Dagsoppgjør",
      db
        .from("accounting_daybook")
        .select(
          "booking_date, gross_ore, goods_net_ore, shipping_net_ore, outgoing_vat_ore, order_count, status, fiken_journal_entry_id, posted_at, error_message",
        )
        .order("booking_date", { ascending: false })
        .limit(90),
    ),
    adminRows<PayoutRow>(
      "Utbetalinger",
      db
        .from("accounting_payouts")
        .select("stripe_payout_id, payout_date, gross_ore, fee_ore, net_ore, status, fiken_journal_entry_id")
        .order("payout_date", { ascending: false })
        .limit(30),
    ),
    adminRows<PaidOrderRow>(
      "Betalte ordre",
      db
        .from("shop_orders")
        .select("id, total_nok, paid_at, goods_cost_nok")
        .in("status", ["paid", "fulfilled"]),
    ),
    adminRows<RefundRow>(
      "Refusjoner",
      db
        .from("accounting_refunds")
        .select(
          "stripe_refund_id, refund_date, total_gross_ore, is_full_refund, needs_review, status, fiken_journal_entry_id",
        )
        .order("refund_date", { ascending: false })
        .limit(30),
    ),
  ]);

  const errors = collectErrors(daybookResult, payoutResult, orderResult, refundResult);
  const refunds = refundResult.rows;
  const daybook = daybookResult.rows;
  const payouts = payoutResult.rows;

  /**
   * AVSTEMMINGEN. Summen av alle dagsoppgjør skal være nøyaktig lik summen av
   * alle betalte ordre. Er den ikke det, mangler det et bilag — og det er den
   * ene tallet på denne siden som må være null.
   *
   * Ordre uten paid_at holdes utenfor: de har ingen bokføringsdag å tilhøre, og
   * ville ellers gitt et permanent falskt avvik.
   */
  const bookedOre = daybook.reduce((sum, row) => sum + (row.gross_ore ?? 0), 0);
  const paidOrders = orderResult.rows.filter((order) => Boolean(order.paid_at));
  const paidOre = paidOrders.reduce((sum, order) => sum + Math.round((order.total_nok ?? 0) * 100), 0);
  const differenceOre = paidOre - bookedOre;

  const unposted = daybook.filter((row) => !row.fiken_journal_entry_id);
  const failed = daybook.filter((row) => row.status === "failed");
  const feesOre = payouts.reduce((sum, row) => sum + (row.fee_ore ?? 0), 0);

  // Ordre der leverandørfakturaen ikke er avstemt ennå. Varekosten står da
  // fortsatt på prislistens anslag, og dekningsbidraget er et estimat.
  const unreconciledSupplier = paidOrders.filter((order) => order.goods_cost_nok == null).length;

  const today = osloDateOf(new Date());

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        title="Regnskap"
        description="Dagsoppgjør og Stripe-utbetalinger, slik de bokføres i Fiken."
      />

      {errors.length > 0 ? <DataErrorBanner errors={errors} /> : null}

      {!hasFikenEnv() ? (
        <div className="border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <p className="font-semibold">Tørrmodus — ingenting sendes til Fiken.</p>
          <p className="mt-1 text-xs leading-relaxed">
            Bilagene bygges, valideres og lagres som normalt, men blir stående som{" "}
            <span className="font-semibold">ubokført</span> til{" "}
            <code className="bg-amber-100 px-1">FIKEN_API_TOKEN</code> og{" "}
            <code className="bg-amber-100 px-1">FIKEN_COMPANY_SLUG</code> er satt. Ingenting går tapt i
            mellomtiden — dagene postes når nøkkelen kommer på plass.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Avstemming salg"
          value={kr(Math.abs(differenceOre))}
          sub={
            differenceOre === 0
              ? "Bokført = betalt. Stemmer."
              : `${differenceOre > 0 ? "Ikke bokført ennå" : "Bokført for mye"} — se etter manglende dager`
          }
          tone={differenceOre === 0 ? "good" : "danger"}
        />
        <StatCard
          label="Ubokførte dager"
          value={num(unposted.length)}
          sub={failed.length > 0 ? `${failed.length} med feil` : "Ingen feil"}
          tone={failed.length > 0 ? "danger" : unposted.length > 0 ? "neutral" : "good"}
        />
        <StatCard label="Bokført omsetning" value={kr(bookedOre)} sub={`${num(daybook.length)} dagsoppgjør`} />
        <StatCard
          label="Uten leverandørfaktura"
          value={num(unreconciledSupplier)}
          sub={
            unreconciledSupplier > 0
              ? "Varekost er prislistens anslag, ikke faktura"
              : "All varekost er fakturabekreftet"
          }
          tone={unreconciledSupplier > 0 ? "neutral" : "good"}
        />
      </div>

      <Card
        title="Dagsoppgjør"
        description="Ett bilag per dag. Klikk en dato for å se ordrene bak summen."
        actions={
          <ActionForm action={runDaybookCatchUpAction}>
            <SubmitButton className={BTN_SECONDARY} pendingLabel="Kjører…">
              Kjør manglende dager
            </SubmitButton>
          </ActionForm>
        }
        bodyClassName=""
      >
        {daybook.length === 0 ? (
          <EmptyState>
            Ingen dagsoppgjør ennå. Det første lages natten etter første betalte ordre.
          </EmptyState>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Dato</Th>
                <Th align="right">Ordre</Th>
                <Th align="right">Brutto</Th>
                <Th align="right">Herav mva</Th>
                <Th>Status</Th>
                <Th>Bilag</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {daybook.map((row) => (
                <tr key={row.booking_date} className="border-t border-stone-200">
                  <Td>
                    <Link
                      href={`/sjefen/okonomi/regnskap/${row.booking_date}`}
                      className="font-semibold text-stone-900 underline-offset-2 hover:underline"
                    >
                      {dateNo(row.booking_date)}
                    </Link>
                    {row.booking_date === today ? (
                      <span className="ml-2 text-[11px] text-stone-500">(pågår)</span>
                    ) : null}
                  </Td>
                  <Td align="right">{num(row.order_count)}</Td>
                  <Td align="right" className="font-semibold">
                    {kr(row.gross_ore)}
                  </Td>
                  <Td align="right" className="text-stone-600">
                    {kr(row.outgoing_vat_ore)}
                  </Td>
                  <Td>
                    {row.fiken_journal_entry_id ? (
                      <Badge tone="good">Bokført</Badge>
                    ) : row.status === "failed" ? (
                      <Badge tone="danger">Feilet</Badge>
                    ) : (
                      <Badge tone="warn">Ikke bokført</Badge>
                    )}
                    {row.error_message ? (
                      <p className="mt-1 max-w-md text-[11px] leading-snug text-red-700">{row.error_message}</p>
                    ) : null}
                  </Td>
                  <Td className="font-mono text-xs text-stone-600">{row.fiken_journal_entry_id ?? "—"}</Td>
                  <Td align="right">
                    {row.fiken_journal_entry_id ? null : (
                      <ActionForm action={retryDaybookAction} messageClassName="text-left">
                        <input type="hidden" name="bookingDate" value={row.booking_date} />
                        <SubmitButton
                          className="h-8 border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-800 hover:border-stone-900"
                          pendingLabel="Poster…"
                        >
                          Bokfør
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card
        title="Stripe-utbetalinger"
        description={`Lukker Stripe-mellomkontoen mot bank. Gebyr hittil: ${kr(feesOre)}.`}
        bodyClassName=""
      >
        {payouts.length === 0 ? (
          <EmptyState>Ingen utbetalinger registrert ennå.</EmptyState>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Dato</Th>
                <Th align="right">Brutto</Th>
                <Th align="right">Gebyr</Th>
                <Th align="right">Til bank</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((row) => (
                <tr key={row.stripe_payout_id} className="border-t border-stone-200">
                  <Td>{dateNo(row.payout_date)}</Td>
                  <Td align="right">{kr(row.gross_ore)}</Td>
                  <Td align="right" className="text-red-700">
                    −{kr(row.fee_ore)}
                  </Td>
                  <Td align="right" className="font-semibold">
                    {kr(row.net_ore)}
                  </Td>
                  <Td>
                    {row.fiken_journal_entry_id ? (
                      <Badge tone="good">Bokført</Badge>
                    ) : (
                      <Badge tone="warn">Ikke bokført</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card
        title="Kreditnotaer"
        description="Refusjoner reverserer både omsetning og utgående mva."
        bodyClassName=""
      >
        {refunds.length === 0 ? (
          <EmptyState>Ingen refusjoner registrert.</EmptyState>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Dato</Th>
                <Th align="right">Beløp</Th>
                <Th>Type</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((row) => (
                <tr key={row.stripe_refund_id} className="border-t border-stone-200">
                  <Td>{dateNo(row.refund_date)}</Td>
                  <Td align="right" className="font-semibold text-red-700">
                    −{kr(row.total_gross_ore)}
                  </Td>
                  <Td>
                    {row.is_full_refund ? (
                      <Badge tone="neutral">Full</Badge>
                    ) : (
                      <Badge tone="warn">Delvis</Badge>
                    )}
                    {row.needs_review ? (
                      <p className="mt-1 max-w-sm text-[11px] leading-snug text-amber-800">
                        Fordelingen mellom varer og frakt er antatt — kontroller mot returen.
                      </p>
                    ) : null}
                  </Td>
                  <Td>
                    {row.fiken_journal_entry_id ? (
                      <Badge tone="good">Bokført</Badge>
                    ) : row.status === "failed" ? (
                      <Badge tone="danger">Feilet</Badge>
                    ) : (
                      <Badge tone="warn">Ikke bokført</Badge>
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
