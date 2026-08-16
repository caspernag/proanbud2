import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/app/sjefen/_components/action-form";
import { adminRows, collectErrors, requireAdminDb } from "@/lib/admin-data";
import { buildPublicStorefrontImageUrl } from "@/lib/storefront-catalog-db";

import { BTN_PRIMARY, BTN_SECONDARY, Card, DataErrorBanner, PageHeader, dateNo, nok } from "../../../_components/ui";
import { updateProductAction } from "../actions";
import { PriceMarginCard } from "./_components/price-margin-card";

type ProductPageProps = {
  params: Promise<{ id: string }>;
};

type ProductRow = {
  id: string;
  slug: string;
  nobb_number: string;
  product_name: string;
  supplier_name: string;
  brand: string | null;
  unit: string | null;
  price_unit: string | null;
  sales_unit: string | null;
  sales_unit_quantity: number | string | null;
  package_area_sqm: number | string | null;
  unit_price_nok: number;
  list_price_nok: number;
  /** Eks. mva, fra prisfilen. numeric fra Postgres kan komme som streng. */
  cost_price_ex_vat_nok: number | string | null;
  list_price_ex_vat_nok: number | string | null;
  section_title: string | null;
  category: string | null;
  description: string | null;
  ean: string | null;
  datasheet_url: string | null;
  image_path: string | null;
  image_url: string | null;
  technical_details: string[] | null;
  quantity_suggestion: string | null;
  quantity_reason: string | null;
  last_updated: string;
  source: string | null;
  popularity_score: number | null;
  updated_at: string;
};

type CatalogMeta = {
  categories: Array<{ name: string; count?: number } | string>;
};

export default async function ProductEditPage({ params }: ProductPageProps) {
  const { id } = await params;
  const db = await requireAdminDb();

  const [productResult, metaResult] = await Promise.all([
    adminRows<ProductRow>(
      "Produkt",
      db
        .from("storefront_products")
        .select(
          "id, slug, nobb_number, product_name, supplier_name, brand, unit, price_unit, sales_unit, sales_unit_quantity, package_area_sqm, unit_price_nok, list_price_nok, cost_price_ex_vat_nok, list_price_ex_vat_nok, section_title, category, description, ean, datasheet_url, image_path, image_url, technical_details, quantity_suggestion, quantity_reason, last_updated, source, popularity_score, updated_at",
        )
        .eq("id", decodeURIComponent(id)),
    ),
    adminRows<CatalogMeta>(
      "Kategorier",
      db.from("storefront_catalog_meta").select("categories").eq("id", 1),
    ),
  ]);

  const errors = collectErrors(productResult, metaResult);
  const product = productResult.rows[0];

  if (!product && errors.length === 0) {
    notFound();
  }

  if (!product) {
    return (
      <div className="space-y-6 p-8">
        <PageHeader eyebrow="Katalog" title="Produkt" actions={<Link href="/sjefen/produkter" className={BTN_SECONDARY}>Tilbake</Link>} />
        <DataErrorBanner errors={errors} />
      </div>
    );
  }

  const imageUrl = product.image_path ? buildPublicStorefrontImageUrl(product.image_path) : product.image_url;
  const categories = categoryOptions(metaResult.rows[0]?.categories ?? [], product.category ?? "Diverse");

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Produktredigering"
        title={product.product_name}
        description={`NOBB ${product.nobb_number} · ${product.supplier_name}`}
        actions={
          <>
            <Link href={`/${product.slug}`} className={BTN_SECONDARY}>
              Åpne produktside
            </Link>
            <Link href="/sjefen/produkter" className={BTN_SECONDARY}>
              Alle produkter
            </Link>
          </>
        }
      />

      <DataErrorBanner errors={errors} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <ActionForm action={updateProductAction} className="space-y-4">
          <input type="hidden" name="id" value={product.id} />

          <Card title="Basis">
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="Produktnavn" name="product_name" defaultValue={product.product_name} required wide />
              <Field label="Slug" name="slug" defaultValue={product.slug} required />
              <Field label="NOBB" name="nobb_number" defaultValue={product.nobb_number} required />
              <Field label="EAN" name="ean" defaultValue={product.ean ?? ""} />
              <Field label="Leverandør" name="supplier_name" defaultValue={product.supplier_name} required />
              <Field label="Merke" name="brand" defaultValue={product.brand ?? ""} />
              <Field label="Seksjon" name="section_title" defaultValue={product.section_title ?? "Byggevarer"} required />
              <SelectField label="Kategori" name="category" defaultValue={product.category ?? "Diverse"} options={categories} required />
            </div>
          </Card>

          <PriceMarginCard
            unitPriceNok={product.unit_price_nok}
            listPriceNok={product.list_price_nok}
            costPriceExVatNok={product.cost_price_ex_vat_nok}
            listPriceExVatNok={product.list_price_ex_vat_nok}
          />

          <Card title="Enheter">
            <div className="grid gap-3 lg:grid-cols-4">
              <Field label="Enhet" name="unit" defaultValue={product.unit ?? "STK"} required />
              <Field label="Prisenhet" name="price_unit" defaultValue={product.price_unit ?? ""} />
              <Field label="Salgsenhet" name="sales_unit" defaultValue={product.sales_unit ?? ""} />
              <Field label="Salgsenhet-antall" name="sales_unit_quantity" type="number" min={0} step="0.001" defaultValue={product.sales_unit_quantity ?? ""} />
              <Field label="Pakkeareal m²" name="package_area_sqm" type="number" min={0} step="0.001" defaultValue={product.package_area_sqm ?? ""} />
              <Field label="Popularitet" name="popularity_score" type="number" min={0} step={1} defaultValue={product.popularity_score ?? 0} />
            </div>
          </Card>

          <Card title="Innhold">
            <div className="space-y-3">
              <TextArea label="Beskrivelse" name="description" defaultValue={product.description ?? ""} rows={5} />
              <TextArea
                label="Tekniske detaljer"
                name="technical_details"
                defaultValue={(product.technical_details ?? []).join("\n")}
                rows={7}
              />
              <div className="grid gap-3 lg:grid-cols-2">
                <Field label="Mengdeforslag" name="quantity_suggestion" defaultValue={product.quantity_suggestion ?? "1 stk"} />
                <Field label="Sist oppdatert" name="last_updated" type="date" defaultValue={product.last_updated} />
              </div>
              <TextArea label="Mengdebegrunnelse" name="quantity_reason" defaultValue={product.quantity_reason ?? ""} rows={3} />
            </div>
          </Card>

          <Card title="Medier og kilde">
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="Bilde path" name="image_path" defaultValue={product.image_path ?? ""} />
              <Field label="Bilde URL" name="image_url" defaultValue={product.image_url ?? ""} />
              <Field label="Datablad URL" name="datasheet_url" defaultValue={product.datasheet_url ?? ""} wide />
              <Field label="Kilde" name="source" defaultValue={product.source ?? "manual"} />
            </div>
          </Card>

          <div className="sticky bottom-0 flex items-center justify-between border border-stone-200 bg-white px-5 py-4 shadow-[0_-8px_24px_rgba(32,25,15,0.06)]">
            <span className="text-[10px] text-stone-500">
              Intern ID: <span className="font-mono">{product.id}</span>
            </span>
            <SubmitButton pendingLabel="Lagrer ..." className={BTN_PRIMARY}>
              Lagre produkt
            </SubmitButton>
          </div>
        </ActionForm>

        <aside className="space-y-6">
          <Card title="Forhåndsvisning">
            <div className="space-y-4">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" className="aspect-square w-full border border-stone-200 object-contain" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center border border-stone-200 bg-stone-50 text-xs text-stone-400">
                  Mangler bilde
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-stone-900">{product.product_name}</p>
                <p className="mt-1 text-[10px] text-stone-500">{product.category ?? "Diverse"}</p>
                <p className="mt-3 text-xl font-semibold tabular-nums text-stone-900">{nok(product.unit_price_nok)}</p>
                <p className="text-[10px] text-stone-500">Listepris {nok(product.list_price_nok)}</p>
              </div>
            </div>
          </Card>

          <Card title="Status">
            <dl className="space-y-2 text-xs">
              <Row label="Sist katalogdato" value={dateNo(product.last_updated)} />
              <Row label="Sist lagret" value={dateNo(product.updated_at)} />
              <Row label="Kilde" value={product.source ?? "—"} />
              <Row label="Slug" value={product.slug} mono />
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  min,
  step,
  wide,
}: {
  label: string;
  name: string;
  defaultValue: string | number;
  type?: string;
  required?: boolean;
  min?: number;
  step?: number | string;
  wide?: boolean;
}) {
  return (
    <label className={`block text-[9px] font-semibold uppercase tracking-[0.14em] text-stone-500 ${wide ? "lg:col-span-2" : ""}`}>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        min={min}
        step={step}
        defaultValue={defaultValue}
        className="mt-1 block h-9 w-full border border-stone-300 bg-white px-2.5 text-xs font-normal text-stone-900 outline-none focus:border-[#163f2a]"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
  required,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: string[];
  required?: boolean;
}) {
  return (
    <label className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-stone-500">
      {label}
      <select
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 block h-9 w-full border border-stone-300 bg-white px-2.5 text-xs font-normal text-stone-900 outline-none focus:border-[#163f2a]"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextArea({
  label,
  name,
  defaultValue,
  rows,
}: {
  label: string;
  name: string;
  defaultValue: string;
  rows: number;
}) {
  return (
    <label className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-stone-500">
      {label}
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="mt-1 block w-full resize-y border border-stone-300 bg-white px-2.5 py-2 text-xs font-normal leading-5 text-stone-900 outline-none focus:border-[#163f2a]"
      />
    </label>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 pb-3 last:border-0 last:pb-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">{label}</dt>
      <dd className={`text-right text-xs text-stone-800 ${mono ? "font-mono text-[10px]" : ""}`}>{value}</dd>
    </div>
  );
}

function categoryOptions(values: Array<{ name: string; count?: number } | string>, current: string) {
  const options = values
    .map((value) => (typeof value === "string" ? value : value.name))
    .filter(Boolean);

  return [...new Set([current, ...options])].sort((a, b) => a.localeCompare(b, "nb"));
}
