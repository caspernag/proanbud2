import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SupplierComparisonWorkspace } from "@/app/_components/supplier-comparison-workspace";
import { startOrderFromSupplierAction } from "@/app/prosjekter/actions";
import { calculatePriceCheck } from "@/lib/price-check";
import { PROJECT_ROW_SELECT, projectFromRow } from "@/lib/project-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ComparisonPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ComparisonPage({ params, searchParams }: ComparisonPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="mx-auto flex w-full max-w-[1500px] flex-1 items-center px-6 py-16 sm:px-8">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-stone-800">
          Supabase er ikke konfigurert. Sammenligning krever database.
        </div>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/min-side/materiallister/${slug}/sammenlign`)}`);
  }

  const { data: row } = await supabase
    .from("projects")
    .select(PROJECT_ROW_SELECT)
    .eq("slug", slug)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) {
    notFound();
  }

  const project = projectFromRow(row);

  if (project.paymentStatus !== "paid") {
    return (
      <main className="mx-auto flex w-full max-w-[1500px] flex-1 px-6 py-10 sm:px-8">
        <div className="w-full rounded-2xl border border-stone-200 bg-white p-6">
          <p className="eyebrow">Sammenlign priser</p>
          <h1 className="mt-2 text-3xl font-semibold text-stone-900">Lås opp prosjektet først</h1>
          <p className="mt-2 text-sm text-stone-600">
            Prisduell og leverandørvalg krever at prosjektet er låst opp.
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

  const priceCheck = await calculatePriceCheck(project);
  const cheapestQuote = priceCheck.quotes[0] ?? null;
  const cheapestSavingsNok = cheapestQuote
    ? Math.max(0, cheapestQuote.listTotalNok - cheapestQuote.totalNok)
    : 0;

  if (project.id && cheapestQuote) {
    const currentSupplier = typeof row.preview_summary?.priceDuelCheapestSupplier === "string"
      ? row.preview_summary.priceDuelCheapestSupplier
      : "";
    const currentSavings = typeof row.preview_summary?.priceDuelSavingsNok === "number"
      ? row.preview_summary.priceDuelSavingsNok
      : null;

    if (currentSupplier !== cheapestQuote.supplierName || currentSavings !== cheapestSavingsNok) {
      const nextPreviewSummary = {
        ...(row.preview_summary ?? {}),
        priceDuelCheapestSupplier: cheapestQuote.supplierName,
        priceDuelSavingsNok: cheapestSavingsNok,
        priceDuelComparedAt: new Date().toISOString(),
      };

      await supabase
        .from("projects")
        .update({
          preview_summary: nextPreviewSummary,
        })
        .eq("id", project.id)
        .eq("user_id", user.id);
    }
  }

  const comparisonError = typeof resolvedSearchParams.error === "string" ? resolvedSearchParams.error : "";

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-3 pb-8 pt-3 sm:px-6 sm:pb-10 sm:pt-4 lg:px-8">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Prisduell</p>
          <h1 className="display-font mt-2 text-3xl leading-none text-stone-900 sm:text-5xl">{project.title}</h1>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Link
            href={`/min-side/materiallister/${slug}`}
            className="inline-flex w-full items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 sm:w-auto"
          >
            Tilbake til materialliste
          </Link>
          <Link
            href={`/min-side/materiallister/${slug}/bestilling`}
            className="inline-flex w-full items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 sm:w-auto"
          >
            Gå til bestilling
          </Link>
        </div>
      </div>

      {comparisonError ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {comparisonError === "ingen-leverandorer"
            ? "Ingen leverandører funnet i prislister. Legg til CSV-filer for å aktivere sammenligning."
            : comparisonError === "leverandor-ikke-tilgjengelig"
              ? "Valgt leverandør finnes ikke i aktive prislister."
              : "Kunne ikke opprette bestilling fra valgt leverandør. Prøv igjen."}
        </p>
      ) : null}

      {priceCheck.quotes.length === 0 ? (
        <section className="panel rounded-[1.2rem] p-4 sm:rounded-[1.4rem] sm:p-5">
          <p className="text-base font-semibold text-stone-900">Ingen leverandører tilgjengelig</p>
          <p className="mt-2 text-sm text-stone-600">
            Prisduell bruker kun firmaer som finnes i prislister. Legg til leverandør-CSV i app/prislister for å aktivere sammenligning.
          </p>
        </section>
      ) : null}

      {priceCheck.quotes.length > 0 ? (
        <SupplierComparisonWorkspace
          projectSlug={slug}
          projectTitle={project.title}
          quotes={priceCheck.quotes}
          potentialSavingsNok={cheapestSavingsNok}
          action={startOrderFromSupplierAction}
        />
      ) : null}
    </main>
  );
}
