import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ActionForm, SubmitButton } from "@/app/sjefen/_components/action-form";
import {
  BTN_SECONDARY,
  Card,
  DataErrorBanner,
  PageHeader,
  StatCard,
  dateNo,
  num,
} from "@/app/sjefen/_components/ui";
import { getImportRun, listOrphanProducts } from "@/lib/admin-product-price-import";
import { requireAdminDb } from "@/lib/admin-data";

import { closeReviewAction } from "./actions";
import { OrphanReview } from "./_components/orphan-review";

const PAGE_SIZE = 100;

const COLUMN_LABELS: Record<string, string> = {
  nobb: "NOBB",
  ean: "EAN",
  productName: "Produktnavn",
  price: "Pris",
  listPrice: "Listepris",
  priceUnit: "Prisenhet",
  salesUnit: "Salgsenhet",
  salesUnitQuantity: "Antall pr. salgsenhet",
  brand: "Merke",
  supplier: "Leverandør",
  category: "Kategori",
  section: "Seksjon",
  description: "Beskrivelse",
  imageUrl: "Bilde",
  datasheetUrl: "Datablad",
};

const FORMAT_LABELS: Record<string, string> = {
  xlsx: "Excel-ark",
  "csv-headers": "CSV med overskrifter",
  "csv-uten-overskrifter": "CSV uten overskrifter",
  "csv-posisjoner": "CSV (Byggmakker-råeksport)",
  json: "JSON",
};

export default async function ImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { runId } = await params;
  const search = await searchParams;
  const q = (search.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(search.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const db = await requireAdminDb();
  const run = await getImportRun(db, runId);

  if (!run) {
    notFound();
  }

  const errors: string[] = [];
  let rows: Awaited<ReturnType<typeof listOrphanProducts>>["rows"] = [];
  let filteredTotal = 0;
  let total = 0;

  try {
    const [filtered, unfiltered] = await Promise.all([
      listOrphanProducts(db, {
        runId,
        supplierName: run.supplier_name,
        q,
        from,
        to: from + PAGE_SIZE - 1,
      }),
      q
        ? listOrphanProducts(db, { runId, supplierName: run.supplier_name, from: 0, to: 0 })
        : null,
    ]);

    rows = filtered.rows;
    filteredTotal = filtered.total;
    total = unfiltered ? unfiltered.total : filtered.total;
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : "Kunne ikke hente gjennomgangen.");
  }

  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const mappedColumns = Object.entries(run.mapped_columns ?? {});

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Katalog"
        title="Gjennomgang etter prisimport"
        description={`${run.file_name} · importert ${dateNo(run.created_at)} · ${
          FORMAT_LABELS[run.format] ?? run.format
        }${run.sheet_name ? ` · ark «${run.sheet_name}»` : ""}`}
        actions={
          <Link href="/sjefen/produkter" className={BTN_SECONDARY}>
            Tilbake til produkter
          </Link>
        }
      />

      <DataErrorBanner errors={errors} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Rader i filen" value={num(run.parsed_rows)} sub="lest fra prisfilen" />
        <StatCard label="Nye" value={num(run.inserted_count)} sub="lagt til i katalogen" tone="good" />
        <StatCard label="Oppdatert" value={num(run.updated_count)} sub="matchet på NOBB" tone="accent" />
        <StatCard
          label="Til gjennomgang"
          value={num(total)}
          sub={`av ${num(run.missing_count)} ved import`}
          tone={total > 0 ? "danger" : "good"}
        />
      </section>

      {run.warnings.length > 0 ? (
        <Card title="Merknader fra importen">
          <ul className="list-disc space-y-1 pl-5 text-xs text-stone-700">
            {run.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {mappedColumns.length > 0 ? (
        <Card
          title="Kolonner som ble gjenkjent"
          description="Slik ble kolonnene i filen koblet til produktfeltene."
        >
          <div className="flex flex-wrap gap-2">
            {mappedColumns.map(([field, header]) => (
              <span
                key={field}
                className="border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] text-stone-700"
              >
                <span className="font-semibold text-stone-900">{COLUMN_LABELS[field] ?? field}</span>
                {" ← "}
                {header || "(uten navn)"}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <Card
        title="Produkter som ikke lå i filen"
        description={`${num(total)} produkt(er) fra ${run.supplier_name} ble ikke funnet i importfilen. Velg hva som skal beholdes og hva som skal slettes.`}
        actions={<span className="text-xs font-semibold text-stone-500">Side {page} av {totalPages}</span>}
        bodyClassName="space-y-4 p-5"
      >
        <form action={`/sjefen/produkter/import/${encodeURIComponent(runId)}`} className="flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Søk navn, NOBB eller merke"
            className="h-10 flex-1 border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-[#163f2a]"
          />
          <button className="h-10 bg-[#163f2a] px-4 text-sm font-semibold text-white transition hover:bg-[#1d5639]">
            Søk
          </button>
          {q ? (
            <Link href={`/sjefen/produkter/import/${encodeURIComponent(runId)}`} className={BTN_SECONDARY}>
              Nullstill
            </Link>
          ) : null}
        </form>

        <OrphanReview
          runId={runId}
          rows={rows}
          total={total}
          filteredTotal={filteredTotal}
          query={q}
        />

        <div className="flex items-center justify-between">
          <PaginationLink disabled={page <= 1} href={pageHref(runId, q, page - 1)}>
            Forrige
          </PaginationLink>
          <span className="text-xs font-semibold text-stone-500">
            {num(rows.length === 0 ? 0 : from + 1)}-{num(from + rows.length)} av {num(filteredTotal)}
          </span>
          <PaginationLink disabled={page >= totalPages} href={pageHref(runId, q, page + 1)}>
            Neste
          </PaginationLink>
        </div>
      </Card>

      <Card
        title="Ferdig?"
        description="Lukk gjennomgangen når du er ferdig. Produkter du ikke har tatt stilling til blir liggende i katalogen."
      >
        <ActionForm action={closeReviewAction}>
          <input type="hidden" name="runId" value={runId} />
          <SubmitButton pendingLabel="Lukker …" className={BTN_SECONDARY}>
            Lukk gjennomgangen
          </SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}

function pageHref(runId: string, q: string, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/sjefen/produkter/import/${encodeURIComponent(runId)}${query ? `?${query}` : ""}`;
}

function PaginationLink({
  disabled,
  href,
  children,
}: {
  disabled: boolean;
  href: string;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <span className="inline-flex h-10 items-center border border-stone-200 bg-stone-100 px-4 text-sm font-semibold text-stone-400">
        {children}
      </span>
    );
  }

  return (
    <Link href={href} className={BTN_SECONDARY}>
      {children}
    </Link>
  );
}
