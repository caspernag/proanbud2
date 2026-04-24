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

  const materialCatalogEntries = await getMaterialCatalogEntries();
  const pdfGeneratedAtLabel = project.pdfGeneratedAt
    ? new Date(project.pdfGeneratedAt).toLocaleString("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  const totalLines = project.materialSections.reduce((sum, s) => sum + s.items.length, 0);
  const totalSections = project.materialSections.length;
  const materialPreview = buildLockedMaterialPreview(project.materialSections);
  const materialSectionsToRender = locked ? materialPreview.sections : project.materialSections;

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-3 pb-10 pt-3 sm:px-6 sm:pt-5 lg:px-8">
      {/* Hero */}
      <header className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusChip locked={locked} />
            <Link
              href="/min-side/materiallister"
              className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 transition hover:text-stone-900"
            >
              <span aria-hidden>←</span> Alle materiallister
            </Link>
          </div>
          <h1 className="display-font mt-2 truncate text-3xl leading-none text-stone-900 sm:text-5xl">
            {project.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
            <MetaChip icon="📍" label={project.location} />
            <MetaChip icon="🏗" label={project.projectType} />
            <MetaChip icon="📐" label={`${project.areaSqm} m²`} />
            <MetaChip icon="✨" label={project.finishLevel} />
          </div>
        </div>
        {project.id ? (
          <div className="shrink-0">
            <DeleteProjectButton
              action={deleteProjectAction}
              slug={project.slug}
              projectTitle={project.title}
            />
          </div>
        ) : null}
      </header>

      {/* Progress */}
      <ProgressRail locked={locked} hasOrder={false} />

      <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
        {/* Material list */}
        <div className="min-w-0 space-y-3">
          <div className="relative overflow-hidden rounded-[0.75rem] border border-stone-200 bg-white">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 sm:px-5">
              <div>
                <p className="eyebrow">Materialliste</p>
                <p className="mt-1 text-base font-semibold text-stone-900 sm:text-lg">
                  {totalLines} varelinjer · {totalSections} seksjoner
                </p>
              </div>
              {!locked ? (
                <a
                  href={pdfHref}
                  className="hidden items-center gap-1.5 rounded-sm border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900 sm:inline-flex"
                >
                  <span aria-hidden>⬇</span> PDF
                </a>
              ) : null}
            </div>

            <div className="relative">
              <MaterialListDocument
                sections={materialSectionsToRender}
                catalogEntries={materialCatalogEntries}
                projectSlug={project.slug}
                persistToProject={Boolean(project.id) && !locked}
                readOnly={locked}
              />
              {locked ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-b from-transparent via-white/80 to-white" />
              ) : null}
            </div>

            {locked ? (
              <div className="border-t border-stone-200 bg-stone-50/60 px-4 py-2 text-xs text-stone-600 sm:px-5">
                Viser {materialPreview.visibleRows} av {materialPreview.totalRows} linjer.
                {materialPreview.hiddenRows > 0
                  ? ` ${materialPreview.hiddenRows} linjer er låst.`
                  : ""}
              </div>
            ) : null}
          </div>

          <p className="px-1 text-[11px] leading-5 text-stone-500">
            Du er selv ansvarlig for å kontrollere at materiallisten er korrekt før bestilling.
          </p>
        </div>

        {/* Action column */}
        <aside className="w-full min-w-0 space-y-3">
          {locked ? (
            <UnlockCard
              priceNok={project.priceNok}
              projectSlug={project.slug}
              projectId={project.id}
              projectTitle={project.title}
              bypassStripe={bypassStripe}
              requiresAuth={hasSupabaseEnv() && !user}
              authNextPath={authNextPath}
              paymentCancelled={paymentCancelled}
              testModeUnlocked={bypassStripe && resolvedSearchParams.test_mode === "1"}
            />
          ) : (
            <OrderCard
              projectSlug={project.slug}
              projectId={project.id}
              pdfHref={pdfHref}
              pdfGeneratedAtLabel={pdfGeneratedAtLabel}
            />
          )}

          <TeaserCard teaser={project.teaser} description={project.description} />
        </aside>
      </section>
    </main>
  );
}

/* ---------- UI building blocks ---------- */

function StatusChip({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-700">
        <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
        Låst
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-800">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
      Klar til bestilling
    </span>
  );
}

function MetaChip({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-1">
      <span aria-hidden>{icon}</span>
      <span className="font-medium text-stone-700">{label}</span>
    </span>
  );
}

function ProgressRail({ locked, hasOrder }: { locked: boolean; hasOrder: boolean }) {
  const stepOne = !locked;
  const stepTwo = !locked && hasOrder;

  return (
    <div className="rounded-[0.6rem] border border-stone-200 bg-white px-3 py-2.5 sm:px-4">
      <ol className="flex items-center gap-2 text-xs font-medium sm:gap-3">
        <Step index={1} label="Lås opp" done={stepOne} active={locked} />
        <StepDivider done={stepOne} />
        <Step index={2} label="Bestill" done={stepTwo} active={!locked && !hasOrder} />
      </ol>
    </div>
  );
}

function Step({
  index,
  label,
  done,
  active,
}: {
  index: number;
  label: string;
  done: boolean;
  active: boolean;
}) {
  const base =
    "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold";
  const dot = done
    ? `${base} bg-emerald-600 text-white`
    : active
      ? `${base} bg-stone-900 text-white`
      : `${base} bg-stone-100 text-stone-500`;
  const text = done
    ? "text-emerald-800"
    : active
      ? "text-stone-900"
      : "text-stone-500";
  return (
    <li className="inline-flex items-center gap-2">
      <span className={dot}>{done ? "✓" : index}</span>
      <span className={text}>{label}</span>
    </li>
  );
}

function StepDivider({ done }: { done: boolean }) {
  return (
    <li className="h-px flex-1 bg-stone-200" aria-hidden>
      <span
        className={`block h-px transition-all ${done ? "w-full bg-emerald-500" : "w-0"}`}
      />
    </li>
  );
}

function UnlockCard({
  priceNok,
  projectSlug,
  projectId,
  projectTitle,
  bypassStripe,
  requiresAuth,
  authNextPath,
  paymentCancelled,
  testModeUnlocked,
}: {
  priceNok: number;
  projectSlug: string;
  projectId: string | undefined;
  projectTitle: string;
  bypassStripe: boolean;
  requiresAuth: boolean;
  authNextPath: string;
  paymentCancelled: boolean;
  testModeUnlocked: boolean;
}) {
  return (
    <div className="panel-strong p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-900 text-xs text-white" aria-hidden>
          🔒
        </span>
        <p className="eyebrow">Lås opp</p>
      </div>
      <h2 className="mt-3 text-lg font-semibold leading-tight text-stone-900 sm:text-xl">
        Lås opp full materialliste og bestill til partnerpris gjennom Proanbud.
      </h2>

      <div className="mt-4 flex items-baseline gap-2">
        <p className="text-3xl font-semibold text-stone-900">{formatCurrency(priceNok)}</p>
        <p className="text-xs text-stone-500">engangspris</p>
      </div>

      <div className="mt-4">
        <CheckoutButton
          slug={projectSlug}
          projectId={projectId}
          projectName={projectTitle}
          priceNok={priceNok}
          requiresAuth={requiresAuth}
          bypassStripe={bypassStripe}
          authNextPath={authNextPath}
        />
      </div>

      <ul className="mt-4 space-y-1.5 text-xs text-stone-600">
        <FeatureRow>Full oversikt over alle materiallinjer</FeatureRow>
        <FeatureRow>Rediger og eksporter PDF ubegrenset</FeatureRow>
        <FeatureRow>Bestill direkte gjennom Proanbuds innkjøpspartner</FeatureRow>
      </ul>

      {paymentCancelled ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Betalingen ble avbrutt. Du kan prøve på nytt når du vil.
        </p>
      ) : null}
      {testModeUnlocked ? (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          Testmodus aktiv – prosjektet er låst opp uten betaling.
        </p>
      ) : null}
    </div>
  );
}

function OrderCard({
  projectSlug,
  projectId,
  pdfHref,
  pdfGeneratedAtLabel,
}: {
  projectSlug: string;
  projectId: string | undefined;
  pdfHref: string;
  pdfGeneratedAtLabel: string | null;
}) {
  return (
    <div className="panel-strong p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs text-white" aria-hidden>
          ✓
        </span>
        <p className="eyebrow">Klar til bestilling</p>
      </div>
      <h2 className="mt-3 text-lg font-semibold leading-tight text-stone-900 sm:text-xl">
        Bestill materialene direkte gjennom Proanbud.
      </h2>
      <p className="mt-2 text-xs leading-5 text-stone-600">
        Vi bruker partnerprislisten, sjekker tilgjengelighet og sender bestillingen videre i samme kanal.
      </p>

      <div className="mt-4 space-y-2">
        {projectId ? (
          <Link
            href={`/min-side/materiallister/${projectSlug}/bestilling`}
            className="inline-flex h-11 w-full items-center justify-center rounded-sm bg-stone-900 px-4 text-sm font-semibold text-white transition hover:bg-stone-800"
          >
            Gå til bestilling →
          </Link>
        ) : (
          <p className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">
            Logg inn for å lagre prosjektet før bestilling.
          </p>
        )}
        <a
          href={pdfHref}
          className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-sm border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 transition hover:border-stone-900"
        >
          <span aria-hidden>⬇</span> Last ned PDF
        </a>
      </div>

      {pdfGeneratedAtLabel ? (
        <p className="mt-3 text-[11px] text-stone-500">
          Sist generert: {pdfGeneratedAtLabel}
        </p>
      ) : null}
    </div>
  );
}

function TeaserCard({ teaser, description }: { teaser: string; description: string }) {
  return (
    <div className="panel p-4 sm:p-5">
      <p className="eyebrow">Om prosjektet</p>
      <p className="mt-2 text-sm leading-6 text-stone-700">{teaser}</p>
      <details className="mt-2 text-sm text-stone-600">
        <summary className="cursor-pointer text-xs font-semibold text-stone-500 hover:text-stone-900">
          Vis full beskrivelse
        </summary>
        <p className="mt-2 leading-6">{description}</p>
      </details>
    </div>
  );
}

function FeatureRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700" aria-hidden>
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}

/* ---------- Helpers ---------- */

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
