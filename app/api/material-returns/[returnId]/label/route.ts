import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    returnId: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { returnId } = await params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return Response.json({ error: "Supabase er ikke konfigurert." }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Innlogging kreves." }, { status: 401 });
  }

  const { data: returnCase } = await supabase
    .from("material_order_returns")
    .select("id, order_id, supplier_label, return_type, reason_code, tracking_number, created_at")
    .eq("id", returnId)
    .eq("user_id", user.id)
    .maybeSingle<{
      id: string;
      order_id: string;
      supplier_label: string | null;
      return_type: string;
      reason_code: string;
      tracking_number: string | null;
      created_at: string;
    }>();

  if (!returnCase) {
    return Response.json({ error: "Retursak ikke funnet." }, { status: 404 });
  }

  const created = new Date(returnCase.created_at).toLocaleString("nb-NO");
  const tracking = returnCase.tracking_number ?? `TRK-${returnCase.id.slice(0, 8).toUpperCase()}`;

  const label = [
    "PROANBUD RETURLAPP",
    "",
    `Retursak: ${returnCase.id}`,
    `Ordre: ${returnCase.order_id}`,
    `Leverandor: ${returnCase.supplier_label ?? "Flere leverandorer"}`,
    `Type: ${returnCase.return_type}`,
    `Arsak: ${returnCase.reason_code}`,
    `Sporing: ${tracking}`,
    `Opprettet: ${created}`,
    "",
    "Leveres hos post-i-butikk eller avtalt transportor.",
    "",
    "Mottaker:",
    `${returnCase.supplier_label ?? "Leverandor"} - Returavdeling`,
    "c/o ProAnbud",
    "Postboks 100",
    "0150 Oslo",
  ].join("\n");

  return new Response(label, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename=returlapp-${returnCase.id.slice(0, 8)}.txt`,
      "cache-control": "no-store",
    },
  });
}
