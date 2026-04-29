import Link from "next/link";

import { NewProjectDialog } from "@/app/_components/new-project-dialog";
import { createProjectAction } from "@/app/prosjekter/actions";
import { PROJECT_ROW_SELECT, projectFromRow, type ProjectRow, type ProjectView } from "@/lib/project-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ArrowUpRight, FileText, Layers, MapPin, Sparkles } from "lucide-react";

type MaterialListsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Row = {
  id: string;
  slug: string;
  title: string;
  location: string;
  type: string;
  lineCount: number;
  paymentStatus: ProjectView["paymentStatus"];
  createdAt: string | undefined;
};

export default async function MateriallisterPage({ searchParams }: MaterialListsPageProps) {
  const resolvedSearchParams = await searchParams;
  const shouldOpenNewMaterialList = resolvedSearchParams.nyMaterialliste === "1";

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  const projectRows = user
    ? await supabase
        ?.from("projects")
        .select(PROJECT_ROW_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(60)
    : null;

  const materialLists: ProjectView[] =
    projectRows?.data && projectRows.data.length > 0
      ? (projectRows.data as ProjectRow[]).map(projectFromRow)
      : [];

  const rows: Row[] = materialLists.map((materialList) => {
    const lineCount = materialList.materialSections.reduce((total, section) => total + section.items.length, 0);

    return {
      id: materialList.id ?? materialList.slug,
      slug: materialList.slug,
      title: materialList.title,
      location: materialList.location,
      type: materialList.projectType,
      lineCount,
      paymentStatus: materialList.paymentStatus,
      createdAt: materialList.createdAt,
    };
  });

  const totalLines = rows.reduce((sum, row) => sum + row.lineCount, 0);
  const activeCount = rows.filter((row) => row.paymentStatus === "paid").length;
  const draftCount = rows.length - activeCount;

  const hasRows = rows.length > 0;

  return (
    <div className="space-y-4">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-2xl border border-emerald-900/15 bg-gradient-to-br from-[#0f3324] via-[#0f271b] to-[#082014] p-5 text-emerald-50 shadow-[0_24px_60px_rgba(8,32,20,0.32)] sm:p-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(rgba(255,255,255,0.6)_0.7px,transparent_0.7px)] [background-size:18px_18px]" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-400/25 blur-3xl" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/30 bg-emerald-50/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-100">
              <Layers className="h-3 w-3" />
              Materiallister
            </div>
            <h1 className="display-font mt-2 text-2xl text-white sm:text-3xl">Mine materiallister</h1>
            <p className="mt-1.5 max-w-xl text-sm text-emerald-50/80">
              AI-genererte lister klar for bestilling. Klikk på en liste for detaljer og bestilling.
            </p>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-emerald-100/80">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> {rows.length} totalt
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {activeCount} aktive
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> {draftCount} kladd
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1">
                <FileText className="h-3 w-3" /> {totalLines} linjer
              </span>
            </div>
          </div>

          <NewProjectDialog action={createProjectAction} initialOpen={shouldOpenNewMaterialList} />
        </div>
      </section>

      {hasRows ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <MaterialListCard key={row.id} row={row} />
          ))}
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-stone-200 bg-white p-10 text-center shadow-[0_10px_28px_rgba(13,34,22,0.05)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <Sparkles className="h-6 w-6" />
          </div>
          <p className="mt-3 text-base font-semibold text-stone-900">Ingen materiallister enda</p>
          <p className="mt-1 text-sm text-stone-500">
            Generer din første materialliste med AI for å komme i gang med bestilling.
          </p>
        </section>
      )}
    </div>
  );
}

function MaterialListCard({ row }: { row: Row }) {
  const href = `/min-side/materiallister/${row.slug}`;
  const orderHref = `/min-side/materiallister/${row.slug}/bestilling`;
  const isPaid = row.paymentStatus === "paid";

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_10px_28px_rgba(13,34,22,0.05)] transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_18px_38px_rgba(13,34,22,0.1)]">
      {/* accent strip */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 h-full w-1.5 ${isPaid ? "bg-gradient-to-b from-emerald-400 to-emerald-700" : "bg-gradient-to-b from-amber-300 to-amber-500"}`}
      />

      <Link href={href} className="block p-4 pl-5 sm:p-5 sm:pl-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                isPaid ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isPaid ? "bg-emerald-600" : "bg-amber-500"}`} />
              {isPaid ? "Aktiv" : "Kladd"}
            </span>
            <h3 className="mt-2 truncate text-base font-semibold text-stone-900 sm:text-lg">{row.title}</h3>
          </div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-stone-400 transition group-hover:text-emerald-700" />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
          {row.location ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {row.location}
            </span>
          ) : null}
          {row.type ? <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">{row.type}</span> : null}
          {row.createdAt ? (
            <span>
              {new Date(row.createdAt).toLocaleDateString("nb-NO", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-stone-100 pt-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">Varelinjer</p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums text-stone-900">{row.lineCount}</p>
          </div>
          <LineCountBars count={row.lineCount} />
        </div>
      </Link>

      <div className="flex items-center gap-2 border-t border-stone-100 bg-stone-50/50 px-4 py-2.5 sm:px-5">
        <Link
          href={href}
          className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
        >
          Åpne
        </Link>
        <Link
          href={orderHref}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-[#0f271b] px-3 text-xs font-semibold text-white! transition hover:bg-[#143527]"
        >
          Bestill
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </article>
  );
}

function LineCountBars({ count }: { count: number }) {
  // visual representation of "fullness" — 5 bars increasing in height
  const segments = 5;
  const filled = Math.min(segments, Math.max(1, Math.ceil(count / 20)));
  return (
    <div className="flex items-end gap-0.5" aria-hidden="true">
      {Array.from({ length: segments }).map((_, i) => {
        const heights = [10, 14, 18, 22, 26];
        const isFilled = i < filled;
        return (
          <span
            key={i}
            className={`w-1.5 rounded-sm ${isFilled ? "bg-gradient-to-t from-[#0e5e3a] to-[#1aa869]" : "bg-stone-200"}`}
            style={{ height: heights[i] }}
          />
        );
      })}
    </div>
  );
}
