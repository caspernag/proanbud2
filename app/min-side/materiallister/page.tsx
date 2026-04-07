import Link from "next/link";

import { NewProjectDialog } from "@/app/_components/new-project-dialog";
import { createProjectAction } from "@/app/prosjekter/actions";
import { PROJECT_ROW_SELECT, projectFromRow, type ProjectRow, type ProjectView } from "@/lib/project-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

type MaterialListsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
        .limit(40)
    : null;

  const materialLists: ProjectView[] =
    projectRows?.data && projectRows.data.length > 0
      ? (projectRows.data as ProjectRow[]).map(projectFromRow)
      : [];

  const rows = await Promise.all(
    materialLists.map(async (materialList) => {
      const lineCount = materialList.materialSections.reduce((total, section) => total + section.items.length, 0);

      return {
        id: materialList.id ?? materialList.slug,
        slug: materialList.slug,
        title: materialList.title,
        location: materialList.location,
        type: materialList.projectType,
        lineCount,
        priceDuelCheapestSupplier: materialList.priceDuelCheapestSupplier ?? "",
        priceDuelSavingsNok: materialList.priceDuelSavingsNok ?? 0,
        paymentStatus: materialList.paymentStatus,
        createdAt: materialList.createdAt,
      };
    }),
  );

  const hasRows = rows.length > 0;

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-md border border-[#1b5136]/20 bg-[#eef1ec] p-4 shadow-[0_20px_48px_rgba(12,33,21,0.08)] sm:p-5">
        <div className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:radial-gradient(rgba(14,92,58,0.26)_0.8px,transparent_0.8px)] [background-size:18px_18px]" />
        <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 -bottom-20 h-60 w-60 rounded-full bg-emerald-900/12 blur-3xl" />

        <div className="relative flex flex-col gap-3 sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-900/70">Materiallister</p>
            <h1 className="display-font mt-1.5 text-2xl text-[#142118] sm:text-3xl">Alle materiallister</h1>
            <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[#43524a] sm:text-sm">
              Datatabell med status, varelinjer og lagret billigste leverandør fra prisduell.
            </p>
          </div>
          <NewProjectDialog action={createProjectAction} initialOpen={shouldOpenNewMaterialList} />
        </div>
      </section>

      {hasRows ? (
        <section className="overflow-hidden rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-0 shadow-[0_12px_30px_rgba(13,34,22,0.06)]">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-[#1d4f35]/15 bg-emerald-50/70 text-[10px] uppercase tracking-[0.1em] text-emerald-900/70 sm:text-xs">
                <tr>
                  <th className="px-3 py-2.5">Materialliste</th>
                  <th className="px-3 py-2.5">Lokasjon</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5 text-right">Linjer</th>
                  <th className="px-3 py-2.5">Prisduell - billigst</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Handling</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const rowHref = `/min-side/materiallister/${row.slug}`;

                  return (
                    <tr key={row.id} className="border-b border-[#1d4f35]/10 last:border-b-0 hover:bg-emerald-50/55">
                      <td className="p-0">
                        <Link href={rowHref} className="block px-3 py-2.5">
                          <div>
                            <p className="font-semibold text-stone-900">{row.title}</p>
                            <p className="text-[11px] text-stone-500">
                              {row.createdAt
                                ? new Date(row.createdAt).toLocaleDateString("nb-NO", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "Ikke datert"}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="p-0 text-stone-700">
                        <Link href={rowHref} className="block px-3 py-2.5">
                          {row.location}
                        </Link>
                      </td>
                      <td className="p-0 text-stone-700">
                        <Link href={rowHref} className="block px-3 py-2.5">
                          {row.type}
                        </Link>
                      </td>
                      <td className="p-0 text-right font-semibold text-stone-900">
                        <Link href={rowHref} className="block px-3 py-2.5">
                          {row.lineCount}
                        </Link>
                      </td>
                      <td className="p-0">
                        <Link href={rowHref} className="block px-3 py-2.5">
                          {row.priceDuelCheapestSupplier ? (
                            <div>
                              <p className="font-semibold text-stone-900">{row.priceDuelCheapestSupplier}</p>
                              <p className="text-[11px] text-stone-500">Spart {formatCurrency(row.priceDuelSavingsNok)}</p>
                            </div>
                          ) : (
                            <span className="text-[11px] text-stone-500">Ikke sammenlignet</span>
                          )}
                        </Link>
                      </td>
                      <td className="p-0">
                        <Link href={rowHref} className="block px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                              row.paymentStatus === "paid"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {row.paymentStatus === "paid" ? "Aktiv" : "Ikke betalt"}
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          <Link
                            href={rowHref}
                            className="inline-flex h-7 items-center justify-center rounded-md border border-stone-300 px-2.5 text-[11px] font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                          >
                            Apne
                          </Link>
                          <Link
                            href={`/min-side/materiallister/${row.slug}/sammenlign`}
                            className="inline-flex h-7 items-center justify-center rounded-md bg-black px-2.5 text-[11px] font-semibold text-white transition hover:bg-black/90"
                          >
                            Sammenlign
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-5 text-center shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-6">
          <p className="text-sm font-semibold text-stone-900">Ingen materiallister enda</p>
          <p className="mt-1 text-xs text-stone-600 sm:text-sm">
            Opprett din første materialliste for å starte prissammenligning og bestilling.
          </p>
        </section>
      )}
    </div>
  );
}
