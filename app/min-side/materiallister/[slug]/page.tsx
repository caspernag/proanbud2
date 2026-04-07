import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CheckoutButton } from "@/app/_components/checkout-button";
import { DeleteProjectButton } from "@/app/_components/delete-project-button";
import { MaterialListDocument } from "@/app/_components/material-list-document";
import { deleteProjectAction } from "@/app/prosjekter/actions";
import { getMaterialCatalogEntries } from "@/lib/material-catalog";
import {
  PROJECT_ROW_SELECT,
  buildProjectFromSearchParams,
  projectFromRow,
  type MaterialSection,
  type ProjectView,
} from "@/lib/project-data";
import { calculatePriceCheck } from "@/lib/price-check";
import { getPriceListProducts } from "@/lib/price-lists";
import { hasSupabaseEnv, isStripeBypassed } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

type ProjectPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  let project: ProjectView | null = null;

  if (supabase && user) {
    const { data } = await supabase
      .from("projects")
      .select(PROJECT_ROW_SELECT)
      .eq("slug", slug)
      .eq("user_id", user.id)
      .maybeSingle();

    if (data) {
      project = projectFromRow(data);
    }
  }

  if (!project) {
    project = buildProjectFromSearchParams(slug, resolvedSearchParams);
  }

  if (!project) {
    notFound();
  }

  const paymentCancelled = resolvedSearchParams.betaling === "avbrutt";
  const bypassStripe = isStripeBypassed();
  const unlockedInTestMode = bypassStripe && resolvedSearchParams.unlocked === "1";
  const locked = project.paymentStatus !== "paid" && !unlockedInTestMode;
  const draftKeys = [
    "title",
    "location",
    "projectType",
    "areaSqm",
    "finishLevel",
    "description",
    "materialList",
    "materialListCompressed",
  ] as const;
  const draftParams = new URLSearchParams();

  for (const key of draftKeys) {
    const value = resolvedSearchParams[key];
    if (typeof value === "string" && value.length > 0) {
      draftParams.set(key, value);
    }
  }

  // When project is not persisted yet (user not logged in), preserve draft params through login.
  if (!project.id && draftParams.size === 0) {
    draftParams.set("title", project.title);
    draftParams.set("location", project.location);
    draftParams.set("projectType", project.projectType);
    draftParams.set("areaSqm", String(project.areaSqm));
    draftParams.set("finishLevel", project.finishLevel);
    draftParams.set("description", project.description);
  }

  const authNextPath =
    draftParams.size > 0
      ? `/min-side/materiallister/${project.slug}?${draftParams.toString()}`
      : `/min-side/materiallister/${project.slug}`;
  const pdfHref =
    !project.id && draftParams.size > 0
      ? `/api/projects/${project.slug}/pdf?${draftParams.toString()}`
      : `/api/projects/${project.slug}/pdf`;
  const priceListProducts = await getPriceListProducts();
  const priceCheck = await calculatePriceCheck(project, priceListProducts);
  const materialCatalogEntries = await getMaterialCatalogEntries(priceListProducts);
  const priceDuelCheapestSupplier = project.priceDuelCheapestSupplier ?? priceCheck.cheapest?.supplierName ?? null;
  const priceDuelSavingsNok =
    project.priceDuelSavingsNok ??
    (priceCheck.cheapest ? Math.max(0, priceCheck.cheapest.listTotalNok - priceCheck.cheapest.totalNok) : 0);
  const hasComparedBefore = Boolean(project.priceDuelComparedAt || project.priceDuelCheapestSupplier);
  const comparedAtLabel = project.priceDuelComparedAt
    ? new Date(project.priceDuelComparedAt).toLocaleDateString("nb-NO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;
  const comparedSupplierQuote = priceDuelCheapestSupplier
    ? priceCheck.quotes.find((quote) => quote.supplierName.toLowerCase() === priceDuelCheapestSupplier.toLowerCase()) ?? null
    : null;
  const supplierLogoSrc = getSupplierLogoSrc(priceDuelCheapestSupplier);
  const pdfGeneratedAtLabel = project.pdfGeneratedAt
    ? new Date(project.pdfGeneratedAt).toLocaleString("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const materialPreview = buildLockedMaterialPreview(project.materialSections);
  const materialSectionsToRender = locked ? materialPreview.sections : project.materialSections;

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-3 pb-8 pt-3 sm:px-6 sm:pb-10 sm:pt-4 lg:px-8">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Prosjekt og prisduell</p>
          <h1 className="display-font mt-2 text-3xl leading-none text-stone-900 sm:text-5xl">
            {project.title}
          </h1>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Link
            href="/min-side/materiallister"
            className="inline-flex w-full items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 sm:w-auto"
          >
            Tilbake til materiallister
          </Link>
          {project.id ? (
            <DeleteProjectButton
              action={deleteProjectAction}
              slug={project.slug}
              projectTitle={project.title}
            />
          ) : null}
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <section className="min-w-0 space-y-3">
          <div className="panel rounded-[1.2rem] p-3 sm:rounded-[1.3rem] sm:p-3.5">
            <div className="flex flex-wrap items-center gap-2.5 text-xs text-stone-600">
              <span>{project.location}</span>
              <span>·</span>
              <span>{project.projectType}</span>
              <span>·</span>
              <span>{project.areaSqm} m²</span>
              <span>·</span>
              <span>{project.finishLevel}</span>
            </div>

            <p className="mt-2 text-sm leading-6 text-stone-700">{project.teaser}</p>

            <details className="mt-2 rounded-lg border border-stone-200 bg-white px-3 py-2 sm:rounded-xl">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">
                Vis prosjektdetaljer
              </summary>
              <p className="mt-2 text-sm leading-6 text-stone-600">{project.description}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs text-stone-600">
                  <p className="font-semibold text-stone-800">Styrker</p>
                  <p className="mt-1">{project.previewBullets.slice(0, 2).join(" · ")}</p>
                </div>
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs text-stone-600">
                  <p className="font-semibold text-stone-800">Kontroller</p>
                  <p className="mt-1">{project.riskBullets.slice(0, 2).join(" · ")}</p>
                </div>
              </div>
            </details>
          </div>

          <div className="relative overflow-hidden rounded-[1.2rem] border border-stone-200 bg-white sm:rounded-xl">
            <div>
              <div className="border-b border-stone-200 px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-stone-900">Komplett materialliste</p>
                    <p className="mt-1 text-sm text-stone-600">
                      Dette er grunnlaget leverandørene skal prise på.
                    </p>
                  </div>
                </div>
              </div>

              <div className="relative space-y-2 p-0">
                <MaterialListDocument
                  sections={materialSectionsToRender}
                  catalogEntries={materialCatalogEntries}
                  projectSlug={project.slug}
                  persistToProject={Boolean(project.id) && !locked}
                  readOnly={locked}
                />
                <p className="rounded-0 border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600">
                  Ansvarsfraskrivelse: Du er selv ansvarlig for å kontrollere at materialene og bestillingen er korrekt før innkjøp.
                </p>
                {locked ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[80%] bg-gradient-to-b from-transparent via-white/75 to-white" />
                ) : null}
              </div>
            </div>

            {locked ? (
              <div className="relative border-t border-stone-200 bg-gradient-to-b from-white via-stone-50 to-white p-4 sm:p-5">
                <div className="mb-3 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">
                  Viser {materialPreview.visibleRows} av {materialPreview.totalRows} varelinjer.
                  {materialPreview.hiddenRows > 0 ? ` ${materialPreview.hiddenRows} linjer er låst bak kjøp.` : ""}
                </div>

                <div className="panel-strong w-full rounded-[1.2rem] p-3.5 sm:rounded-[1.6rem] sm:p-5">
                  <p className="eyebrow">Lås opp</p>
                  <h2 className="mt-2 text-xl font-semibold text-stone-900 sm:text-2xl">
                    Lås opp full materialliste og prisduell.
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    {bypassStripe
                      ? "Testmodus er aktiv. Prosjektet kan låses opp direkte i denne perioden."
                      : "Betal én gang og behold materialliste, prisduell og PDF under prosjektet ditt."}
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div>
                      <p className="text-3xl font-semibold text-stone-900">
                        {formatCurrency(project.priceNok)}
                      </p>
                      <p className="text-sm text-stone-600">Per prosjekt / materialliste</p>
                    </div>
                    <CheckoutButton
                      slug={project.slug}
                      projectId={project.id}
                      projectName={project.title}
                      priceNok={project.priceNok}
                      requiresAuth={hasSupabaseEnv() && !user}
                      bypassStripe={bypassStripe}
                      authNextPath={authNextPath}
                    />
                  </div>
                  <p className="mt-3 rounded-xl border border-stone-200 bg-white/75 px-3 py-2 text-xs leading-5 text-stone-600">
                    Du er selv ansvarlig for at materialliste og bestilling er korrekt.
                  </p>
                  {bypassStripe && resolvedSearchParams.test_mode === "1" ? (
                    <p className="mt-3 text-sm text-[var(--success)]">
                      Testmodus: prosjektet er låst opp uten betaling.
                    </p>
                  ) : null}
                  {paymentCancelled ? (
                    <p className="mt-3 text-sm text-[var(--danger)]">
                      Betalingen ble avbrutt. Prosjektet er fortsatt klart til å låses opp.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <div className="w-full min-w-0 space-y-3">
          <div className="panel rounded-[1.2rem] p-3.5 sm:rounded-[1.5rem] sm:p-4">
            <p className="text-sm font-semibold text-stone-900">Prosjektoppsummering</p>
            <div className="mt-3 space-y-2.5 text-sm text-stone-600">
              <div className="flex items-center justify-between">
                <span>Status</span>
                <span className="font-semibold text-stone-900">
                  {locked ? "Låst" : "Låst opp"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Prosjekttype</span>
                <span className="font-semibold text-stone-900">{project.projectType}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>PDF</span>
                <span className="font-semibold text-stone-900">
                  {pdfGeneratedAtLabel ? "Lagret" : "Ikke generert"}
                </span>
              </div>
            </div>

            {locked ? (
              <p className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
                Lås opp prosjektet for å aktivere sammenlign priser og bestilling.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                <Link
                  href={`/min-side/materiallister/${project.slug}/sammenlign`}
                  prefetch={false}
                  className="inline-flex w-full items-center justify-center rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
                >
                  Hent priser fra leverandører
                </Link>
                {project.id ? (
                  <Link
                    href={`/min-side/materiallister/${project.slug}/bestilling`}
                    className="inline-flex w-full items-center justify-center rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                  >
                    Bestill materialer
                  </Link>
                ) : null}
                <a
                  href={pdfHref}
                  className="inline-flex w-full items-center justify-center rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                >
                  Last ned PDF
                </a>
              </div>
            )}
            {pdfGeneratedAtLabel ? (
              <p className="mt-2 text-xs text-stone-500">Sist generert: {pdfGeneratedAtLabel}</p>
            ) : null}
          </div>
          <div className="panel rounded-[1.2rem] p-3.5 sm:rounded-[1.5rem] sm:p-4">
            <p className="text-sm font-semibold text-stone-900">Neste steg</p>
            <p className="mt-1 text-sm text-stone-600">
              Send materiallisten til prisduell og velg leverandør før bestilling.
            </p>
            <div className="mt-3 rounded-md border border-stone-200 bg-[var(--card-strong)] p-3 text-sm text-stone-700">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Prisduell - billigst</p>
              {priceDuelCheapestSupplier ? (
                <div className="mt-2 rounded-md border border-stone-200 bg-white p-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-md bg-white">
                        {supplierLogoSrc ? (
                          <Image
                            src={supplierLogoSrc}
                            alt={`${priceDuelCheapestSupplier} logo`}
                            width={120}
                            height={32}
                            className="h-full w-full object-contain p-0"
                          />
                        ) : (
                          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-stone-500">
                            Logo
                          </span>
                        )}
                      </span>
                      <div className="inline-flex items-left flex-col justify-center overflow-hidden rounded-md bg-white">
                        <p className="text-sm font-semibold text-stone-900">{priceDuelCheapestSupplier}</p>
                        <p className="text-[11px] text-stone-500">{comparedAtLabel ? `Sist sammenlignet ${comparedAtLabel}` : "Tidligere sammenlignet"}</p>
                      </div>
                    </div>
                    {comparedSupplierQuote ? (
                      <p className="text-sm font-semibold text-stone-900">{formatCurrency(comparedSupplierQuote.totalNok)}</p>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-600">
                    {comparedSupplierQuote ? (
                      <>
                        <span className="rounded-md bg-stone-100 px-2 py-0.5">Veil.pris {formatCurrency(comparedSupplierQuote.listTotalNok)}</span>
                        <span className="rounded-md bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">Spart {formatCurrency(priceDuelSavingsNok)}</span>
                      </>
                    ) : (
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">Spart {formatCurrency(priceDuelSavingsNok)}</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-stone-500">Ikke sammenlignet enda.</p>
              )}
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Sammenligningsdekning: {priceCheck.comparedLineCount}/{priceCheck.totalLineCount} linjer ({Math.round(priceCheck.coverageRatio * 100)}%).
            </p>
            <Link
              href={`/min-side/materiallister/${project.slug}/sammenlign`}
              prefetch={false}
              className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90"
            >
              {hasComparedBefore ? "Sammenlign igjen" : "Sammenlign priser"}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function buildLockedMaterialPreview(sections: MaterialSection[]) {
  const totalRows = sections.reduce((sum, section) => sum + section.items.length, 0);
  const maxPreviewRows = 5;
  let remainingRows = maxPreviewRows;

  const previewSections = sections
    .map((section) => {
      if (remainingRows <= 0) {
        return null;
      }

      const visibleItems = section.items.slice(0, remainingRows);
      remainingRows -= visibleItems.length;

      if (visibleItems.length === 0) {
        return null;
      }

      return {
        ...section,
        items: visibleItems,
      };
    })
    .filter((section): section is MaterialSection => section !== null);

  const visibleRows = previewSections.reduce((sum, section) => sum + section.items.length, 0);
  const hiddenRows = Math.max(0, totalRows - visibleRows);

  return {
    sections: previewSections,
    totalRows,
    visibleRows,
    hiddenRows,
  };
}

function getSupplierLogoSrc(supplierName: string | null) {
  if (!supplierName) {
    return null;
  }

  const normalized = supplierName.toLowerCase();
  let logoName: string;

  if (normalized.includes("byggmakker")) {
    logoName = "byggmakker";
  } else if (normalized.includes("monter") || normalized.includes("optimera")) {
    logoName = "monter-optimera";
  } else if (normalized.includes("byggmax")) {
    logoName = "byggmax";
  } else if (normalized.includes("xl")) {
    logoName = "xl-bygg";
  } else {
    logoName = supplierName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[\s/]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  if (!logoName) {
    return null;
  }

  return `/byggevarehus-logo/${logoName}.png`;
}
