import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const { data: markups } = supabase
    ? await supabase.from("supplier_markups").select("*").order("supplier_name")
    : { data: [] };

  async function updateMarkup(formData: FormData) {
    "use server";
    const supabaseServer = await createSupabaseServerClient();
    if (!supabaseServer) {
      return;
    }

    const id = formData.get("id") as string;
    const percentage = parseFloat(formData.get("percentage") as string);
    const fixed = parseFloat(formData.get("fixed") as string);

    await supabaseServer
      .from("supplier_markups")
      .update({ markup_percentage: percentage, markup_fixed: fixed })
      .eq("id", id);
    
    revalidatePath("/admin");
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Leverandør Påslag (Markup)</h2>
      <p className="text-gray-600">Juster påslag for prisene du får fra leverandørene, før de vises til kunden.</p>
      
      <div className="grid gap-4">
        {markups?.map((markup) => (
          <form action={updateMarkup} key={markup.id} className="bg-white p-4 rounded-lg shadow-sm border flex items-center gap-4">
            <input type="hidden" name="id" value={markup.id} />
            <div className="flex-1 font-medium">{markup.supplier_name}</div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">Påslag (%)</label>
              <input type="number" name="percentage" defaultValue={markup.markup_percentage} step="0.1" className="border rounded px-2 py-1 w-20" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">Fast påslag (kr)</label>
              <input type="number" name="fixed" defaultValue={markup.markup_fixed} step="0.5" className="border rounded px-2 py-1 w-20" />
            </div>
            <button type="submit" className="bg-black text-white px-4 py-1.5 rounded text-sm hover:bg-gray-800">Lagre</button>
          </form>
        ))}
      </div>
    </div>
  );
}
