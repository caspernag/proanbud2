import { adminRows, collectErrors, requireAdminDb } from "@/lib/admin-data";

import { ActionForm, SubmitButton } from "../../_components/action-form";
import { Card, DataErrorBanner, EmptyState, PageHeader } from "../../_components/ui";
import { updateMarkupAction } from "./actions";

type SupplierMarkup = {
  id: string;
  supplier_name: string;
  markup_percentage: number;
  markup_fixed: number;
};

export default async function InnstillingerPage() {
  const db = await requireAdminDb();

  const markupResult = await adminRows<SupplierMarkup>(
    "Leverandørpåslag",
    db
      .from("supplier_markups")
      .select("id, supplier_name, markup_percentage, markup_fixed")
      .order("supplier_name"),
  );

  const errors = collectErrors(markupResult);

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Konfigurasjon"
        title="Innstillinger"
        description="Globale innstillinger for plattformen."
      />

      <DataErrorBanner errors={errors} />

      <Card
        title="Leverandørpåslag"
        description="Påslaget legges på innkjøpsprisen og bestemmer hva kunden betaler i butikken."
        bodyClassName=""
      >
        {markupResult.rows.length === 0 ? (
          <EmptyState>Ingen leverandører konfigurert.</EmptyState>
        ) : (
          <ul className="divide-y divide-stone-100">
            {markupResult.rows.map((markup) => (
              <li key={markup.id}>
                <ActionForm
                  action={updateMarkupAction}
                  className="flex flex-wrap items-end gap-4 px-5 py-4 transition hover:bg-stone-50"
                  messageClassName="w-full"
                >
                  <input type="hidden" name="id" value={markup.id} />

                  <span className="min-w-[180px] flex-1 text-sm font-semibold text-stone-900">
                    {markup.supplier_name}
                  </span>

                  <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                    Påslag %
                    <input
                      type="number"
                      name="percentage"
                      step="0.1"
                      min={-100}
                      max={500}
                      defaultValue={markup.markup_percentage}
                      className="mt-1 block h-10 w-24 border border-stone-300 bg-white px-3 text-sm font-normal tabular-nums text-stone-900 outline-none focus:border-[#163f2a]"
                    />
                  </label>

                  <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                    Fast kr
                    <input
                      type="number"
                      name="fixed"
                      step="0.5"
                      min={-100_000}
                      max={100_000}
                      defaultValue={markup.markup_fixed}
                      className="mt-1 block h-10 w-24 border border-stone-300 bg-white px-3 text-sm font-normal tabular-nums text-stone-900 outline-none focus:border-[#163f2a]"
                    />
                  </label>

                  <SubmitButton
                    pendingLabel="Lagrer …"
                    className="inline-flex h-10 items-center bg-[#163f2a] px-4 text-sm font-semibold text-white transition hover:bg-[#1d5639]"
                  >
                    Lagre
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
