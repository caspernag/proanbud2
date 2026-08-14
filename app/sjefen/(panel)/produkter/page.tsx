import Link from "next/link";
import type { ReactNode } from "react";

import { listImportRuns } from "@/lib/admin-product-price-import";
import { adminRows, collectErrors, requireAdminDb } from "@/lib/admin-data";

import { ActionForm, SubmitButton } from "../../_components/action-form";
import {
  Badge,
  BTN_PRIMARY,
  BTN_SECONDARY,
  Card,
  DataErrorBanner,
  EmptyState,
  PageHeader,
  StatCard,
  TableWrap,
  Td,
  Th,
  dateNo,
  nok,
  num,
} from "../../_components/ui";
import { importPriceFileAction } from "./actions";

const PAGE_SIZE = 50;

type SearchParams = Promise<{ q?: string; category?: string; supplier?: string; page?: string }>;

type ProductListRow = {
  id: string;
  slug: string;
  nobb_number: string;
  product_name: string;
  supplier_name: string;
  brand: string | null;
  unit: string | null;
  unit_price_nok: number;
  list_price_nok: number;
  section_title: string | null;
  category: string | null;
  last_updated: string;
  popularity_score: number | null;
};

type CatalogMeta = {
  product_count: number;
  price_min: number;
  price_max: number;
  categories: Array<{ name: string; count?: number } | string>;
  suppliers: Array<{ name: string; count?: number } | string>;
  refreshed_at: string;
};

export default async function ProdukterPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const category = (params.category ?? "").trim();
  const supplier = (params.supplier ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = await requireAdminDb();

  let productQuery = db
    .from("storefront_products")
    .select(
      "id, slug, nobb_number, product_name, supplier_name, brand, unit, unit_price_nok, list_price_nok, section_title, category, last_updated, popularity_score",
      { count: "exact" },
    );

  if (q) {
    const needle = q.replace(/[,%]/g, " ").replace(/\s+/g, " ").trim();
    if (needle) {
      productQuery = productQuery.or(
        `product_name.ilike.%${needle}%,nobb_number.ilike.%${needle}%,supplier_name.ilike.%${needle}%,search_text.ilike.%${needle}%`,
      );
    }
  }

  if (category) productQuery = productQuery.eq("category", category);
  if (supplier) productQuery = productQuery.eq("supplier_name", supplier);

  const [productResponse, metaResult, importRunsResult] = await Promise.all([
    productQuery
      .order("popularity_score", { ascending: false })
      .order("product_name", { ascending: true })
      .range(from, to),
    adminRows<CatalogMeta>(
      "Katalogmetadata",
      db
        .from("storefront_catalog_meta")
        .select("product_count, price_min, price_max, categories, suppliers, refreshed_at")
        .eq("id", 1),
    ),
    listImportRuns(db, 5),
  ]);

  if (productResponse.error) {
    console.error("[sjefen] Produkter feilet:", productResponse.error.message);
  }

  const productError = productResponse.error ? `Produkter: ${productResponse.error.message}` : null;
  const products = (productResponse.data ?? []) as ProductListRow[];
  const total = productResponse.count ?? products.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const meta = metaResult.rows[0] ?? null;
  const errors = collectErrors({ error: productError }, metaResult, importRunsResult);
  const openReview = importRunsResult.rows.find((run) => run.status === "review") ?? null;

  const categories = meta?.categories.map(facetName).filter(Boolean).sort((a, b) => a.localeCompare(b, "nb")) ?? [];
  const suppliers = meta?.suppliers.map(facetName).filter(Boolean).sort((a, b) => a.localeCompare(b, "nb")) ?? [];

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Katalog"
        title="Produkter"
        description="Søk, filtrer og rediger butikkatalogen."
        actions={
          <Link href="/" className={BTN_SECONDARY}>
            Åpne butikk
          </Link>
        }
      />

      <DataErrorBanner errors={errors} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Produkter" value={num(meta?.product_count ?? total)} sub="i katalogen" tone="accent" />
        <StatCard label="Treff" value={num(total)} sub={`${num(products.length)} vist på siden`} />
        <StatCard label="Pris fra" value={nok(meta?.price_min ?? 0)} sub="laveste katalogpris" />
        <StatCard label="Pris til" value={nok(meta?.price_max ?? 0)} sub="høyeste katalogpris" />
      </section>

      {openReview ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-900">
            <span className="font-semibold">Importen fra {openReview.file_name} venter på gjennomgang.</span>{" "}
            {num(Math.max(0, openReview.missing_count - openReview.kept_count - openReview.deleted_count))} produkt(er)
            lå ikke i filen og er ikke behandlet ennå.
          </p>
          <Link
            href={`/sjefen/produkter/import/${encodeURIComponent(openReview.id)}`}
            className={BTN_PRIMARY}
          >
            Åpne gjennomgang
          </Link>
        </div>
      ) : null}

      <Card
        title="Importer Byggmakker-priser"
        description="Excel (.xlsx), CSV eller JSON. Produkter matches på NOBB: nye legges til, treff oppdateres med pris inkl. mva og påslag. Produkter som ikke ligger i filen sendes til gjennomgang — ingenting slettes automatisk."
      >
        <ActionForm
          action={importPriceFileAction}
          encType="multipart/form-data"
          className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_auto]"
        >
          <input
            type="file"
            name="priceFile"
            accept=".xlsx,.xlsm,.csv,.txt,.tsv,.json,.ndjson,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/json"
            required
            className="block h-10 w-full border border-stone-300 bg-white text-xs text-stone-700 file:mr-3 file:h-full file:border-0 file:bg-stone-100 file:px-3 file:text-xs file:font-semibold file:text-stone-800 hover:file:bg-stone-200"
          />
          <input
            name="supplierName"
            defaultValue="Byggmakker"
            aria-label="Leverandør"
            placeholder="Leverandør"
            className="h-10 border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-[#163f2a]"
          />
          <SubmitButton pendingLabel="Importerer ..." className={BTN_PRIMARY}>
            Importer priser
          </SubmitButton>
        </ActionForm>
      </Card>

      <Card bodyClassName="p-5">
        <form action="/sjefen/produkter" className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_220px_220px_auto]">
          <input
            name="q"
            defaultValue={q}
            placeholder="Søk navn, NOBB, leverandør"
            className="h-10 border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-[#163f2a]"
          />
          <select
            name="category"
            defaultValue={category}
            className="h-10 border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-[#163f2a]"
          >
            <option value="">Alle kategorier</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            name="supplier"
            defaultValue={supplier}
            className="h-10 border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-[#163f2a]"
          >
            <option value="">Alle leverandører</option>
            {suppliers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button className="h-10 bg-[#163f2a] px-4 text-sm font-semibold text-white transition hover:bg-[#1d5639]">
            Søk
          </button>
        </form>
      </Card>

      <Card
        title="Alle produkter"
        description={meta?.refreshed_at ? `Sist katalogsynk: ${dateNo(meta.refreshed_at)}` : undefined}
        actions={<span className="text-xs font-semibold text-stone-500">Side {page} av {totalPages}</span>}
        bodyClassName=""
      >
        {products.length === 0 ? (
          <EmptyState>Ingen produkter matcher søket.</EmptyState>
        ) : (
          <TableWrap>
            <thead className="border-b border-stone-200">
              <tr>
                <Th>Produkt</Th>
                <Th>Leverandør</Th>
                <Th>Kategori</Th>
                <Th align="right">Pris</Th>
                <Th align="right">Listepris</Th>
                <Th>Sist endret</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-stone-100 transition hover:bg-stone-50">
                  <Td>
                    <div className="max-w-[420px]">
                      <p className="truncate text-xs font-semibold text-stone-900">{product.product_name}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-stone-500">
                        NOBB {product.nobb_number} · {product.slug}
                      </p>
                    </div>
                  </Td>
                  <Td>
                    <span className="text-xs text-stone-800">{product.supplier_name}</span>
                    {product.brand ? <span className="mt-0.5 block text-[10px] text-stone-500">{product.brand}</span> : null}
                  </Td>
                  <Td>
                    <Badge>{product.category ?? "Diverse"}</Badge>
                  </Td>
                  <Td align="right" className="text-xs font-semibold tabular-nums text-stone-900">
                    {nok(product.unit_price_nok)}
                    <span className="block text-[10px] font-normal text-stone-400">/{product.unit ?? "STK"}</span>
                  </Td>
                  <Td align="right" className="text-xs tabular-nums text-stone-600">{nok(product.list_price_nok)}</Td>
                  <Td className="text-[10px] text-stone-500">{dateNo(product.last_updated)}</Td>
                  <Td align="right">
                    <Link
                      href={`/sjefen/produkter/${encodeURIComponent(product.id)}`}
                      className="text-xs font-semibold text-[#163f2a] hover:underline"
                    >
                      Rediger
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <PaginationLink disabled={page <= 1} href={pageHref({ q, category, supplier, page: page - 1 })}>
          Forrige
        </PaginationLink>
        <span className="text-xs font-semibold text-stone-500">
          {num(from + 1)}-{num(Math.min(from + products.length, total))} av {num(total)}
        </span>
        <PaginationLink disabled={page >= totalPages} href={pageHref({ q, category, supplier, page: page + 1 })}>
          Neste
        </PaginationLink>
      </div>
    </div>
  );
}

function facetName(value: { name: string; count?: number } | string) {
  return typeof value === "string" ? value : value.name;
}

function pageHref(input: { q: string; category: string; supplier: string; page: number }) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.category) params.set("category", input.category);
  if (input.supplier) params.set("supplier", input.supplier);
  if (input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  return `/sjefen/produkter${query ? `?${query}` : ""}`;
}

function PaginationLink({ disabled, href, children }: { disabled: boolean; href: string; children: ReactNode }) {
  if (disabled) {
    return <span className="inline-flex h-10 items-center border border-stone-200 bg-stone-100 px-4 text-sm font-semibold text-stone-400">{children}</span>;
  }

  return (
    <Link href={href} className={BTN_SECONDARY}>
      {children}
    </Link>
  );
}
