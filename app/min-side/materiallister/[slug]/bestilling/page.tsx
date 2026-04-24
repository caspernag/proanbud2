import Link from "next/link";
import { redirect } from "next/navigation";

import { MaterialOrderWorkspace } from "@/app/_components/material-order-workspace";
import { createMaterialOrderAction } from "@/app/prosjekter/actions";
import { isStripeBypassed } from "@/lib/env";
import {
  MATERIAL_ORDER_SUPPLIERS,
  getAvailableMaterialOrderSupplierKeys,
  materialOrderFromRows,
  type SupplierKey,
  type MaterialOrderItemRow,
  type MaterialOrderRow,
} from "@/lib/material-order";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type MaterialOrderPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MaterialOrderPage({ params, searchParams }: MaterialOrderPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedOrderId = typeof resolvedSearchParams.order === "string" ? resolvedSearchParams.order : null;
  const requestedSupplier =
    typeof resolvedSearchParams.selectedSupplier === "string"
      ? resolvedSearchParams.selectedSupplier
      : typeof resolvedSearchParams.supplier === "string"
        ? resolvedSearchParams.supplier
        : null;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="mx-auto flex w-full max-w-[1500px] flex-1 items-center px-6 py-16 sm:px-8">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-stone-800">
          Supabase er ikke konfigurert. Bestillingsmodulen krever database.
        </div>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/min-side/materiallister/${slug}/bestilling`)}`);
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, slug, title, payment_status")
    .eq("slug", slug)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    // Fallback for stale slug links: resolve project through the order id when available.
    if (requestedOrderId) {
      const { data: orderLookup } = await supabase
        .from("material_orders")
        .select("project_id")
        .eq("id", requestedOrderId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (orderLookup?.project_id) {
        const { data: projectByOrder } = await supabase
          .from("projects")
          .select("id, slug, title, payment_status")
          .eq("id", orderLookup.project_id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (projectByOrder) {
          const params = new URLSearchParams();
          params.set("order", requestedOrderId);

          if (requestedSupplier) {
            params.set("selectedSupplier", requestedSupplier);
          }

          redirect(`/min-side/materiallister/${projectByOrder.slug}/bestilling?${params.toString()}`);
        }
      }
    }

    redirect("/min-side/materiallister");
  }

  const bypassStripe = isStripeBypassed();

  if (project.payment_status !== "paid" && !bypassStripe) {
    return (
      <main className="mx-auto flex w-full max-w-[1500px] flex-1 px-6 py-10 sm:px-8">
        <div className="w-full rounded-2xl border border-stone-200 bg-white p-6">
          <p className="eyebrow">Bestilling</p>
          <h1 className="mt-2 text-3xl font-semibold text-stone-900">Lås opp prosjektet først</h1>
          <p className="mt-2 text-sm text-stone-600">
            Materialbestilling krever at prosjektet er låst opp slik at hele materiallisten er tilgjengelig.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Link
              href={`/min-side/materiallister/${slug}`}
              className="inline-flex h-10 items-center justify-center rounded-sm bg-stone-900 px-4 text-sm font-semibold text-white transition hover:bg-stone-800"
            >
              Gå til prosjekt
            </Link>
            <Link
              href="/min-side/materiallister"
              className="inline-flex h-10 items-center justify-center rounded-sm border border-stone-300 px-4 text-sm font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
            >
              Til prosjekter
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const baseOrderQuery = supabase
    .from("material_orders")
    .select("*")
    .eq("project_id", project.id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: latestOrder } = await baseOrderQuery.maybeSingle();

  let activeOrder = latestOrder as MaterialOrderRow | null;

  if (requestedOrderId) {
    const { data: requestedOrder } = await supabase
      .from("material_orders")
      .select("*")
      .eq("id", requestedOrderId)
      .eq("project_id", project.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (requestedOrder) {
      activeOrder = requestedOrder as MaterialOrderRow;
    }
  }

  const paymentCancelled = resolvedSearchParams.betaling === "avbrutt";
  const paidInReturn = resolvedSearchParams.paid === "1";
  const testMode = bypassStripe && resolvedSearchParams.test_mode === "1";
  const submittedInReturn = resolvedSearchParams.submitted === "1";
  const submittedFlow = typeof resolvedSearchParams.flow === "string" ? resolvedSearchParams.flow : "";
  const availableSupplierKeys = await getAvailableMaterialOrderSupplierKeys();
  const supplierLabels = availableSupplierKeys.map((key) => MATERIAL_ORDER_SUPPLIERS[key].label);
  const supplierSummary = supplierLabels[0] ?? "ingen aktiv partner";

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col overflow-x-hidden px-3 pb-8 pt-3 sm:px-6 sm:pb-10 sm:pt-4 lg:px-8">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Bestilling og betaling</p>
          <h1 className="display-font mt-2 text-3xl leading-none text-stone-900 sm:text-5xl">{project.title}</h1>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Link
            href={`/min-side/materiallister/${slug}`}
            className="inline-flex w-full items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 sm:w-auto"
          >
            Tilbake til prosjekt
          </Link>
          <Link
            href="/min-side/materiallister"
            className="inline-flex w-full items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 sm:w-auto"
          >
            Alle prosjekter
          </Link>
        </div>
      </div>

      {!activeOrder ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-xl font-semibold text-stone-900">Opprett bestillingsutkast</h2>
          <p className="mt-2 max-w-2xl text-sm text-stone-600">
            Vi oppretter en detaljert bestilling fra materiallisten, kobler linjene mot partnerprislisten hos
            {` ${supplierSummary}`}, og beregner leveringsvindu før betaling.
          </p>

          {resolvedSearchParams.error === "ingen-linjer" ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Fant ingen gyldige materiallinjer i prosjektet. Oppdater materiallisten og prøv igjen.
            </p>
          ) : null}

          <form action={createMaterialOrderAction} className="mt-4">
            <input type="hidden" name="slug" value={slug} />
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-sm bg-stone-900 px-4 text-sm font-semibold text-white transition hover:bg-stone-800"
            >
              Opprett bestilling
            </button>
          </form>
        </section>
      ) : (
        <MaterialOrderDetails
          order={activeOrder}
          userId={user.id}
          projectSlug={slug}
          projectTitle={project.title}
          availableSupplierKeys={availableSupplierKeys}
          paymentCancelled={paymentCancelled}
          paidInReturn={paidInReturn}
          testMode={testMode}
          submittedInReturn={submittedInReturn}
          submittedFlow={submittedFlow}
        />
      )}
    </main>
  );
}

async function MaterialOrderDetails({
  order,
  userId,
  projectSlug,
  projectTitle,
  availableSupplierKeys,
  paymentCancelled,
  paidInReturn,
  testMode,
  submittedInReturn,
  submittedFlow,
}: {
  order: MaterialOrderRow;
  userId: string;
  projectSlug: string;
  projectTitle: string;
  availableSupplierKeys: SupplierKey[];
  paymentCancelled: boolean;
  paidInReturn: boolean;
  testMode: boolean;
  submittedInReturn: boolean;
  submittedFlow: string;
}) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data: itemsData } = await supabase
    .from("material_order_items")
    .select("*")
    .eq("order_id", order.id)
    .eq("user_id", userId)
    .order("position", { ascending: true });

  const materialOrder = materialOrderFromRows(order, (itemsData ?? []) as MaterialOrderItemRow[]);
  const initialItems = materialOrder.items;
  const initialSummary = {
    subtotalNok: materialOrder.subtotalNok,
    deliveryFeeNok: materialOrder.deliveryFeeNok,
    vatNok: materialOrder.vatNok,
    totalNok: materialOrder.totalNok,
    earliestDeliveryDate: materialOrder.earliestDeliveryDate,
    latestDeliveryDate: materialOrder.latestDeliveryDate,
  };

  return (
    <MaterialOrderWorkspace
      projectSlug={projectSlug}
      projectTitle={projectTitle}
      orderId={materialOrder.id}
      orderStatus={materialOrder.status}
      initialCustomerType={materialOrder.customerType}
      initialCompanyName={materialOrder.companyName}
      initialOrganizationNumber={materialOrder.organizationNumber}
      initialDeliveryMode={materialOrder.deliveryMode}
      initialDeliveryTarget={materialOrder.deliveryTarget}
      initialUnloadingMethod={materialOrder.unloadingMethod}
      initialDesiredDeliveryDate={materialOrder.desiredDeliveryDate}
      initialShippingContactName={materialOrder.shippingContactName}
      initialShippingPhone={materialOrder.shippingPhone}
      initialShippingAddressLine1={materialOrder.shippingAddressLine1}
      initialShippingPostalCode={materialOrder.shippingPostalCode}
      initialShippingCity={materialOrder.shippingCity}
      initialDeliveryInstructions={materialOrder.deliveryInstructions}
      initialExpressDelivery={materialOrder.expressDelivery}
      initialCarryInService={materialOrder.carryInService}
      initialCheckoutFlow={materialOrder.checkoutFlow}
      initialFinancingPlanMonths={materialOrder.financingPlanMonths}
      initialContractTermsVersion={materialOrder.contractTermsVersion}
      initialContractAcceptedAt={materialOrder.contractAcceptedAt}
      initialCustomerNote={materialOrder.customerNote}
      initialItems={initialItems}
      initialSummary={{
        subtotalNok: initialSummary.subtotalNok,
        deliveryFeeNok: initialSummary.deliveryFeeNok,
        vatNok: initialSummary.vatNok,
        totalNok: initialSummary.totalNok,
        earliestDeliveryDate: initialSummary.earliestDeliveryDate,
        latestDeliveryDate: initialSummary.latestDeliveryDate,
      }}
      availableSupplierKeys={availableSupplierKeys}
      paymentCancelled={paymentCancelled}
      paidInReturn={paidInReturn}
      testMode={testMode}
      submittedInReturn={submittedInReturn}
      submittedFlow={submittedFlow}
    />
  );
}
