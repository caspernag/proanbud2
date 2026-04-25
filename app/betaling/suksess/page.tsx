import Link from "next/link";
import { Suspense } from "react";

import { StorefrontCartReset } from "@/app/_components/storefront/storefront-cart-reset";
import { getStripe } from "@/lib/stripe";

type SuccessPageProps = {
  searchParams: Promise<{
    slug?: string;
    session_id?: string;
    order_id?: string;
    shop_order_token?: string;
  }>;
};

async function SuccessPageContent({ searchParams }: SuccessPageProps) {
  const resolvedSearchParams = await searchParams;
  let slug = resolvedSearchParams.slug?.trim() || "";
  const orderIdFromQuery = resolvedSearchParams.order_id?.trim() || "";
  let shopOrderToken = resolvedSearchParams.shop_order_token?.trim() || "";
  const sessionId = resolvedSearchParams.session_id;
  const stripe = getStripe();
  let paymentStatus = "ubekreftet";
  let isMaterialOrder = false;
  let isShopOrder = false;
  let materialOrderId = "";

  if (stripe && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      paymentStatus = session.payment_status;
      isMaterialOrder = session.metadata?.kind === "material_order" || Boolean(session.metadata?.orderId);
      isShopOrder = session.metadata?.kind === "shop_order" || Boolean(session.metadata?.shopOrderId);
      materialOrderId = (session.metadata?.orderId ?? orderIdFromQuery).trim();
      shopOrderToken = (session.metadata?.shopOrderToken ?? shopOrderToken).trim();
      if (!slug) {
        slug = (session.metadata?.projectSlug ?? session.metadata?.slug ?? "").trim();
      }
    } catch {
      paymentStatus = "ukjent";
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-1 items-center px-6 py-16 sm:px-8">
      <div className="panel-strong w-full rounded-[2rem] p-6 sm:p-8">
        <div className="rounded-[1.75rem] border border-stone-200 bg-[var(--card-strong)] p-6">
          {isShopOrder && paymentStatus === "paid" ? <StorefrontCartReset /> : null}
          <p className="eyebrow">{isShopOrder ? "Ordrebekreftelse" : "Betaling"}</p>
          <h1 className="display-font mt-3 text-5xl leading-none text-stone-900 sm:text-6xl">
            {isShopOrder ? "Ordren er bekreftet." : isMaterialOrder ? "Bestillingen er registrert." : "Prosjektet er klart."}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-stone-700">
            {isShopOrder
              ? "Betalingen er registrert, og du kan følge ordren videre i nettbutikken."
              : isMaterialOrder
              ? "Når betalingen er bekreftet, sendes materialbestillingen videre for behandling og innkjøp."
              : "Når betalingen er bekreftet, er materialliste, PDF og bestilling tilgjengelig på prosjektet."}
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-stone-200 bg-white p-5">
              <p className="text-sm text-stone-500">{isShopOrder ? "Ordre" : "Prosjekt"}</p>
              <p className="mt-2 text-lg font-semibold text-stone-900">
                {isShopOrder ? (shopOrderToken || "Ukjent ordre") : (slug || "Ukjent prosjekt")}
              </p>
            </div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5">
              <p className="text-sm text-stone-500">Betalingsstatus</p>
              <p className="mt-2 text-lg font-semibold text-stone-900">{paymentStatus}</p>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {isShopOrder ? (
              <Link
                href={shopOrderToken ? `/ordre/${encodeURIComponent(shopOrderToken)}` : "/"}
                className="inline-flex items-center justify-center rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
              >
                Åpne ordren
              </Link>
            ) : isMaterialOrder ? (
              <Link
                href={
                  slug
                    ? `/min-side/materiallister/${slug}/bestilling${
                        materialOrderId ? `?order=${encodeURIComponent(materialOrderId)}&paid=1` : "?paid=1"
                      }`
                    : "/min-side/materiallister"
                }
                className="inline-flex items-center justify-center rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
              >
                Åpne bestilling
              </Link>
            ) : (
              <Link
                href={slug ? `/min-side/materiallister/${slug}` : "/min-side/materiallister"}
                className="inline-flex items-center justify-center rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
              >
                Åpne prosjektet
              </Link>
            )}
            <Link
              href={isShopOrder ? "/" : "/min-side/materiallister"}
              className="inline-flex items-center justify-center rounded-full border border-stone-300 px-6 py-3 text-sm font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
            >
              {isShopOrder ? "Tilbake til nettbutikken" : "Tilbake til oversikt"}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function PaymentSuccessPage(props: SuccessPageProps) {
  return (
    <Suspense fallback={null}>
      <SuccessPageContent {...props} />
    </Suspense>
  );
}
