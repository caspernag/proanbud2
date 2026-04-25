import { redirect } from "next/navigation";
import { Suspense } from "react";

type MaterialOrderPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function RedirectContent({ params, searchParams }: MaterialOrderPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (typeof value === "string") {
      nextParams.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        nextParams.append(key, entry);
      }
    }
  }

  const target = nextParams.size > 0
    ? `/min-side/materiallister/${slug}/bestilling?${nextParams.toString()}`
    : `/min-side/materiallister/${slug}/bestilling`;

  redirect(target);
  return null;
}

export default function MaterialOrderPage(props: MaterialOrderPageProps) {
  return (
    <Suspense fallback={null}>
      <RedirectContent {...props} />
    </Suspense>
  );
}
