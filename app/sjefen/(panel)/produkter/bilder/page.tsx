import Link from "next/link";

import {
  getProductImageCoverage,
  listProductsForImageAdmin,
  type ProductImageListRow,
} from "@/lib/admin-product-images";
import { requireAdminDb } from "@/lib/admin-data";
import { buildPublicStorefrontImageUrl } from "@/lib/storefront-catalog-db";

import { ActionForm, SubmitButton } from "../../../_components/action-form";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  TableWrap,
  Td,
  Th,
  num,
} from "../../../_components/ui";
import { bulkProductImageAction, uploadProductImageAction } from "./actions";

const PAGE_SIZE = 60;

type SearchParams = Promise<{ filter?: string; q?: string; page?: string }>;

type Filter = "all" | "missing" | "has";

function parseFilter(value: string | undefined): Filter {
  return value === "missing" || value === "has" ? value : "all";
}

export default async function ProduktbilderPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filter = parseFilter(params.filter);
  const q = (params.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const db = await requireAdminDb();

  const [coverage, list] = await Promise.all([
    getProductImageCoverage(db),
    listProductsForImageAdmin(db, {
      filter,
      q,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const coveragePct =
    coverage.total > 0 ? Math.round((coverage.withImage / coverage.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Produkter"
        title="Bilder"
        description="Last opp, erstatt og slett produktbilder — enkeltvis eller i bulk. Alle bilder skaleres ned og konverteres til WebP ved opplasting."
        actions={
          <Link href="/sjefen/produkter" className={BTN_SECONDARY}>
            Til produktlisten
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Produkter" value={num(coverage.total)} />
        <StatCard
          label="Har bilde"
          value={num(coverage.withImage)}
          sub={`${coveragePct} % dekning`}
          tone="good"
        />
        <StatCard
          label="Mangler bilde"
          value={num(coverage.withoutImage)}
          tone={coverage.withoutImage > 0 ? "danger" : "neutral"}
        />
      </div>

      <Card
        title="Bulk-handlinger"
        description="Lim inn NOBB-numre, eller kryss av rader i tabellen under og bruk knappene der."
      >
        <ActionForm action={bulkProductImageAction} className="space-y-3">
          <textarea
            name="nobb_list"
            rows={3}
            placeholder="NOBB-numre, adskilt med mellomrom, komma eller linjeskift — f.eks. 25410978 23304215"
            className="w-full border border-stone-300 px-3 py-2 font-mono text-xs text-stone-900 focus:border-[#15452d] focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <SubmitButton className={BTN_PRIMARY} pendingLabel="Merker…" name="intent" value="refetch">
              Hent bilder på nytt
            </SubmitButton>
          </div>
          <p className="text-xs text-stone-500">
            Fjerner det som er cachet, inkludert «fant ingenting»-markøren, slik at kildene
            (NOBB-eksport, Optimera, Byggmakker) forsøkes på nytt neste gang produktet vises.
          </p>
        </ActionForm>
      </Card>

      <Card title="Last opp bilde" description="Erstatter primærbildet for ett produkt.">
        <ActionForm
          action={uploadProductImageAction}
          encType="multipart/form-data"
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              NOBB-nummer
            </span>
            <input
              name="nobb_number"
              required
              inputMode="numeric"
              placeholder="25410978"
              className="w-44 border border-stone-300 px-3 py-2 font-mono text-sm text-stone-900 focus:border-[#15452d] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              Bildefil
            </span>
            <input
              type="file"
              name="file"
              required
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="w-72 border border-stone-300 px-3 py-1.5 text-sm text-stone-700 file:mr-3 file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold"
            />
          </label>
          <SubmitButton className={BTN_PRIMARY} pendingLabel="Laster opp…">
            Last opp
          </SubmitButton>
        </ActionForm>
      </Card>

      <Card
        title={`Produkter (${num(list.total)})`}
        description="Kryss av flere rader for å behandle dem samlet."
        actions={<FilterTabs filter={filter} q={q} />}
      >
        <form method="get" className="mb-4 flex flex-wrap gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Søk på produktnavn eller NOBB"
            className="w-72 border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-[#15452d] focus:outline-none"
          />
          <button type="submit" className={BTN_SECONDARY}>
            Søk
          </button>
        </form>

        {list.rows.length === 0 ? (
          <EmptyState>Ingen produkter matcher filteret.</EmptyState>
        ) : (
          <ProductImageTable rows={list.rows} />
        )}

        {totalPages > 1 ? (
          <nav className="mt-4 flex items-center justify-between text-sm">
            <PageLink
              disabled={page <= 1}
              href={buildHref({ filter, q, page: page - 1 })}
              label="← Forrige"
            />
            <span className="text-stone-500">
              Side {page} av {totalPages}
            </span>
            <PageLink
              disabled={page >= totalPages}
              href={buildHref({ filter, q, page: page + 1 })}
              label="Neste →"
            />
          </nav>
        ) : null}
      </Card>
    </div>
  );
}

function ProductImageTable({ rows }: { rows: ProductImageListRow[] }) {
  return (
    <ActionForm action={bulkProductImageAction} className="space-y-3">
      <TableWrap>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th />
              <Th>Bilde</Th>
              <Th>Produkt</Th>
              <Th>NOBB</Th>
              <Th>Kategori</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-stone-100">
                <Td>
                  <input
                    type="checkbox"
                    name="nobb"
                    value={row.nobb_number}
                    className="h-4 w-4 accent-[#15452d]"
                    aria-label={`Velg ${row.product_name}`}
                  />
                </Td>
                <Td>
                  {row.image_path ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={buildPublicStorefrontImageUrl(row.image_path)}
                      alt=""
                      loading="lazy"
                      className="h-12 w-12 border border-stone-200 bg-white object-contain"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center border border-dashed border-stone-300 text-[10px] text-stone-400">
                      ingen
                    </div>
                  )}
                </Td>
                <Td>
                  <Link
                    href={`/sjefen/produkter/${row.id}`}
                    className="font-medium text-stone-900 hover:text-[#15452d] hover:underline"
                  >
                    {row.product_name}
                  </Link>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-stone-600">{row.nobb_number}</span>
                </Td>
                <Td>
                  <span className="text-xs text-stone-500">{row.category ?? "—"}</span>
                </Td>
                <Td>
                  {row.image_path ? (
                    <Badge tone="good">OK</Badge>
                  ) : (
                    <Badge tone="warn">Mangler</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <div className="flex flex-wrap gap-2">
        <SubmitButton className={BTN_PRIMARY} pendingLabel="Merker…" name="intent" value="refetch">
          Hent valgte på nytt
        </SubmitButton>
        <SubmitButton className={BTN_SECONDARY} pendingLabel="Sletter…" name="intent" value="delete">
          Slett bilder for valgte
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

function FilterTabs({ filter, q }: { filter: Filter; q: string }) {
  const tabs: Array<{ value: Filter; label: string }> = [
    { value: "all", label: "Alle" },
    { value: "missing", label: "Mangler bilde" },
    { value: "has", label: "Har bilde" },
  ];

  return (
    <div className="flex gap-1">
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={buildHref({ filter: tab.value, q, page: 1 })}
          className={`px-3 py-1.5 text-xs font-semibold ${
            filter === tab.value
              ? "bg-[#15452d] text-white"
              : "border border-stone-300 text-stone-600 hover:border-[#15452d]"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

function PageLink({ disabled, href, label }: { disabled: boolean; href: string; label: string }) {
  if (disabled) {
    return <span className="text-stone-300">{label}</span>;
  }
  return (
    <Link href={href} className="font-semibold text-[#15452d] hover:underline">
      {label}
    </Link>
  );
}

function buildHref({ filter, q, page }: { filter: Filter; q: string; page: number }) {
  const search = new URLSearchParams();
  if (filter !== "all") search.set("filter", filter);
  if (q) search.set("q", q);
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `/sjefen/produkter/bilder?${query}` : "/sjefen/produkter/bilder";
}
