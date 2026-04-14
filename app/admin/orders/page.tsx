import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { StatusSelect } from "./status-select";

export default async function AdminOrdersPage() {
  const supabase = await createSupabaseServerClient();
  
  if (!supabase) return <div>DB-tilkobling mangler</div>;

  const { data: partners } = await supabase.from("partners").select("*");
  const { data: orders } = await supabase
    .from("material_orders")
    .select(`
      id, 
      created_at, 
      status, 
      partner_status, 
      total_nok, 
      delivery_mode, 
      customer_note,
      partner_id
    `)
    .order("created_at", { ascending: false });

  async function updateStatus(formData: FormData) {
    "use server";
    const supabaseServer = await createSupabaseServerClient();
    if (!supabaseServer) return;
    
    const id = formData.get("orderId") as string;
    const newStatus = formData.get("status") as string;
    
    await supabaseServer
      .from("material_orders")
      .update({ partner_status: newStatus })
      .eq("id", id);
      
    revalidatePath("/admin/orders");
  }
  
  async function assignPartner(formData: FormData) {
    "use server";
    const supabaseServer = await createSupabaseServerClient();
    if (!supabaseServer) return;
    
    const id = formData.get("orderId") as string;
    const partnerId = formData.get("partnerId") as string;
    
    await supabaseServer
      .from("material_orders")
      .update({ partner_id: partnerId })
      .eq("id", id);
      
    revalidatePath("/admin/orders");
  }

  const columns = [
    { id: "pending", title: "Nye ordrer" },
    { id: "processing", title: "Under behandling" },
    { id: "out_for_delivery", title: "Kjørt ut" },
    { id: "delivered", title: "Levert dør" },
  ];

  const statusOptions = [
    ...columns.map(c => ({ value: c.id, label: c.title })),
    { value: "cancelled", label: "Kansellert" }
  ];

  const partnerOptions = [
    { value: "", label: "-- Velg partner --" },
    ...(partners || []).map(p => ({ value: p.id, label: p.name }))
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Ordrepipeline for Partnere (Trebygg Strand AS)</h2>
      <p className="text-gray-600">Her kan leverandøren flytte ordren gjennom plukk, pakk og leveranse til kunde.</p>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
        {columns.map(col => {
          const colOrders = orders?.filter(o => (o.partner_status || 'pending') === col.id) || [];
          
          return (
            <div key={col.id} className="bg-gray-100 p-4 rounded-xl space-y-4">
              <h3 className="font-semibold text-gray-900 border-b pb-2">{col.title} ({colOrders.length})</h3>
              
              {colOrders.map(order => (
                <div key={order.id} className="bg-white p-3 rounded shadow-sm border space-y-3">
                  <div className="text-xs text-gray-500">{new Date(order.created_at).toLocaleDateString("no-NO")}</div>
                  <div className="font-medium text-sm">Ordre: {order.id.slice(0, 8)}...</div>
                  <div className="text-sm">Notat: {order.customer_note || "Ingen"}</div>
                  <div className="text-sm font-semibold">{order.total_nok} NOK</div>
                  
                  {/* Tildel partner hvis ikke valgt (mock/admin funksjon) */}
                  <form action={assignPartner} className="pt-2 border-t flex flex-col gap-2">
                    <input type="hidden" name="orderId" value={order.id} />
                    <StatusSelect 
                      name="partnerId" 
                      defaultValue={order.partner_id || ""} 
                      options={partnerOptions} 
                    />
                  </form>

                  {/* Flytt status */}
                  <form action={updateStatus} className="flex flex-col gap-2">
                    <input type="hidden" name="orderId" value={order.id} />
                    <StatusSelect 
                      name="status" 
                      defaultValue={order.partner_status || 'pending'} 
                      options={statusOptions} 
                    />
                  </form>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
