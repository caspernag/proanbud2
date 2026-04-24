import { StorefrontCheckoutClient } from "@/app/_components/storefront/storefront-checkout-client";

type StorefrontCheckoutPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function StorefrontCheckoutPage({ searchParams }: StorefrontCheckoutPageProps) {
  const resolvedSearchParams = await searchParams;

  return <StorefrontCheckoutClient paymentCancelled={resolvedSearchParams.betaling === "avbrutt"} />;
}
