import { revalidatePath } from "next/cache";

import { requireAdminUser } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function InnstillingerPage() {
  await requireAdminUser();

  const supabase = await createSupabaseServerClient();
  const { data: markups } = supabase
    ? await supabase.from("supplier_markups").select("*").order("supplier_name")
    : { data: [] };

  async function updateMarkup(formData: FormData) {
    "use server";
    const supabaseServer = await createSupabaseServerClient();
    if (!supabaseServer) return;
    const id         = formData.get("id") as string;
    const percentage = parseFloat(formData.get("percentage") as string);
    const fixed      = parseFloat(formData.get("fixed") as string);
    await supabaseServer
      .from("supplier_markups")
      .update({ markup_percentage: percentage, markup_fixed: fixed })
      .eq("id", id);
    revalidatePath("/sjefen/innstillinger");
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Innstillinger</h1>
        <p className="text-sm text-stone-400 mt-0.5">Globale innstillinger for plattformen</p>
      </div>

      {/* Markup settings */}
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200">
          <h2 className="text-sm font-semibold text-stone-900">Leverandør-påslag</h2>
          <p className="text-xs text-stone-400 mt-0.5">Juster påslag på priser fra leverandørene</p>
        </div>
        <div className="divide-y divide-zinc-800">
          {markups?.map((markup) => (
            <form action={updateMarkup} key={markup.id} className="px-6 py-4 flex items-center gap-4 hover:bg-stone-50/80 transition">
              <input type="hidden" name="id" value={markup.id} />
              <div className="flex-1 text-sm text-stone-800 font-medium">{markup.supplier_name}</div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-stone-400">Påslag (%)</label>
                <input
                  type="number"
                  name="percentage"
                  defaultValue={markup.markup_percentage}
                  step="0.1"
                  className="w-20 rounded-lg bg-stone-100 border border-stone-300 px-3 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-stone-400">Fast (kr)</label>
                <input
                  type="number"
                  name="fixed"
                  defaultValue={markup.markup_fixed}
                  step="0.5"
                  className="w-20 rounded-lg bg-stone-100 border border-stone-300 px-3 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-900 font-semibold text-xs transition"
              >
                Lagre
              </button>
            </form>
          ))}
          {(!markups || markups.length === 0) && (
            <div className="px-6 py-8 text-center text-stone-400 text-sm">
              Ingen leverandører konfigurert.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
