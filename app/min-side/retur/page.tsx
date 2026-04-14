import { ReturnClaimsPortal } from "@/app/_components/return-claims-portal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ReturPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type OrderRow = {
  id: string;
  project_id: string;
  status: string;
  total_nok: number;
  created_at: string;
  customer_type: "private" | "business";
};

type OrderItemRow = {
  id: string;
  order_id: string;
  product_name: string;
  quantity_value: number;
  quantity_unit: string;
  supplier_key: "byggmakker" | "monter_optimera" | "byggmax" | "xl_bygg";
  supplier_label: string;
  supplier_sku: string | null;
  is_included: boolean;
};

type ProjectRow = {
  id: string;
  title: string;
  slug: string;
};

type ReturnRow = {
  id: string;
  order_id: string;
  status:
    | "submitted"
    | "documents_received"
    | "supplier_notified"
    | "label_ready"
    | "in_transit"
    | "received"
    | "reviewing"
    | "resolved"
    | "rejected";
  return_type: "return" | "complaint";
  reason_code:
    | "wrong_item"
    | "changed_mind"
    | "damaged_in_transit"
    | "defective"
    | "missing_parts"
    | "not_as_described"
    | "other";
  preferred_resolution: "refund" | "replacement" | "repair" | "other";
  supplier_label: string | null;
  title: string;
  description: string;
  return_label_url: string | null;
  created_at: string;
};

type ReturnEventRow = {
  id: string;
  return_id: string;
  event_type: string;
  created_at: string;
};

type ReturnAttachmentRow = {
  id: string;
  return_id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  created_at: string;
};

export default async function ReturPage({ searchParams }: ReturPageProps) {
  const supabase = await createSupabaseServerClient();
  const resolvedSearchParams = await searchParams;

  if (!supabase) {
    return (
      <section className="rounded-md border border-amber-300/50 bg-amber-50 p-4 text-sm text-stone-800 shadow-[0_10px_24px_rgba(51,36,12,0.08)]">
        Supabase er ikke konfigurert. Returportalen krever database.
      </section>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const prefilledOrderId = typeof resolvedSearchParams.order === "string" ? resolvedSearchParams.order : null;

  const { data: orderRows } = await supabase
    .from("material_orders")
    .select("id, project_id, status, total_nok, created_at, customer_type")
    .eq("user_id", user.id)
    .in("status", ["paid", "submitted"])
    .order("created_at", { ascending: false })
    .limit(120);

  const orders = (orderRows ?? []) as OrderRow[];
  const orderIds = orders.map((order) => order.id);
  const projectIds = Array.from(new Set(orders.map((order) => order.project_id)));

  const [{ data: itemRows }, { data: projectRows }, { data: returnRows }] = await Promise.all([
    orderIds.length > 0
      ? supabase
          .from("material_order_items")
          .select("id, order_id, product_name, quantity_value, quantity_unit, supplier_key, supplier_label, supplier_sku, is_included")
          .eq("user_id", user.id)
          .in("order_id", orderIds)
      : Promise.resolve({ data: [] as OrderItemRow[] }),
    projectIds.length > 0
      ? supabase
          .from("projects")
          .select("id, title, slug")
          .eq("user_id", user.id)
          .in("id", projectIds)
      : Promise.resolve({ data: [] as ProjectRow[] }),
    supabase
      .from("material_order_returns")
      .select("id, order_id, status, return_type, reason_code, preferred_resolution, supplier_label, title, description, return_label_url, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const returnIds = ((returnRows ?? []) as ReturnRow[]).map((entry) => entry.id);

  const [{ data: eventRows }, { data: attachmentRows }] = await Promise.all([
    returnIds.length > 0
      ? supabase
          .from("material_order_return_events")
          .select("id, return_id, event_type, created_at")
          .eq("user_id", user.id)
          .in("return_id", returnIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as ReturnEventRow[] }),
    returnIds.length > 0
      ? supabase
          .from("material_order_return_attachments")
          .select("id, return_id, file_name, mime_type, file_size_bytes, created_at")
          .eq("user_id", user.id)
          .in("return_id", returnIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as ReturnAttachmentRow[] }),
  ]);

  const itemsByOrderId = new Map<string, OrderItemRow[]>();

  for (const item of (itemRows ?? []) as OrderItemRow[]) {
    const rows = itemsByOrderId.get(item.order_id) ?? [];
    rows.push(item);
    itemsByOrderId.set(item.order_id, rows);
  }

  const projectById = new Map((projectRows ?? []).map((project) => [project.id, project]));

  const portalOrders = orders.map((order) => {
    const project = projectById.get(order.project_id);

    return {
      id: order.id,
      projectTitle: project?.title ?? "Ukjent prosjekt",
      projectSlug: project?.slug ?? "",
      status: order.status,
      totalNok: order.total_nok,
      createdAt: order.created_at,
      customerType: order.customer_type,
      items: (itemsByOrderId.get(order.id) ?? []).map((item) => ({
        id: item.id,
        productName: item.product_name,
        quantityValue: item.quantity_value,
        quantityUnit: item.quantity_unit,
        supplierKey: item.supplier_key,
        supplierLabel: item.supplier_label,
        supplierSku: item.supplier_sku,
        isIncluded: item.is_included,
      })),
    };
  });

  const portalCases = ((returnRows ?? []) as ReturnRow[]).map((entry) => ({
    id: entry.id,
    orderId: entry.order_id,
    status: entry.status,
    returnType: entry.return_type,
    reasonCode: entry.reason_code,
    preferredResolution: entry.preferred_resolution,
    supplierLabel: entry.supplier_label,
    title: entry.title,
    description: entry.description,
    returnLabelUrl: entry.return_label_url,
    createdAt: entry.created_at,
  }));

  const portalEvents = ((eventRows ?? []) as ReturnEventRow[]).map((entry) => ({
    id: entry.id,
    returnId: entry.return_id,
    eventType: entry.event_type,
    createdAt: entry.created_at,
  }));

  const portalAttachments = ((attachmentRows ?? []) as ReturnAttachmentRow[]).map((entry) => ({
    id: entry.id,
    returnId: entry.return_id,
    fileName: entry.file_name,
    mimeType: entry.mime_type,
    fileSizeBytes: entry.file_size_bytes,
    createdAt: entry.created_at,
  }));

  return (
    <ReturnClaimsPortal
      orders={portalOrders}
      cases={portalCases}
      events={portalEvents}
      attachments={portalAttachments}
      prefilledOrderId={prefilledOrderId}
    />
  );
}
