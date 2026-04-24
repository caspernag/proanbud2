import { NextResponse } from "next/server";
import { z } from "zod";

import {
  inferLegalBasis,
  type MaterialReturnType,
} from "@/lib/material-return";
import type { SupplierKey } from "@/lib/material-order";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_ATTACHMENTS = 6;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

type OrderRow = {
  id: string;
  project_id: string;
  user_id: string;
  status: string;
  customer_type: "private" | "business";
};

type OrderItemRow = {
  id: string;
  product_name: string;
  quantity_value: number;
  quantity_unit: string;
  supplier_key: SupplierKey;
  supplier_label: string;
  supplier_sku: string | null;
};

const createReturnSchema = z.object({
  orderId: z.string().uuid(),
  returnType: z.enum(["return", "complaint"]),
  reasonCode: z.enum([
    "wrong_item",
    "changed_mind",
    "damaged_in_transit",
    "defective",
    "missing_parts",
    "not_as_described",
    "other",
  ]),
  preferredResolution: z.enum(["refund", "replacement", "repair", "other"]),
  title: z.string().max(120).optional().default(""),
  description: z.string().max(2000).optional().default(""),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        quantityValue: z.number().min(0.001).max(100000),
        reasonNote: z.string().max(400).optional(),
      }),
    )
    .min(1)
    .max(120),
});

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase er ikke konfigurert." }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Innlogging kreves." }, { status: 401 });
  }

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  let query = supabase
    .from("material_order_returns")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (orderId) {
    query = query.eq("order_id", orderId);
  }

  const { data: returnRows, error: returnError } = await query;

  if (returnError) {
    return NextResponse.json({ error: "Kunne ikke hente retursaker." }, { status: 500 });
  }

  const returns = returnRows ?? [];

  if (returns.length === 0) {
    return NextResponse.json({ returns: [], items: [], attachments: [], events: [] });
  }

  const returnIds = returns.map((entry) => entry.id);

  const [{ data: itemRows }, { data: attachmentRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from("material_order_return_items")
      .select("*")
      .eq("user_id", user.id)
      .in("return_id", returnIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("material_order_return_attachments")
      .select("id, return_id, file_name, mime_type, file_size_bytes, created_at")
      .eq("user_id", user.id)
      .in("return_id", returnIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("material_order_return_events")
      .select("*")
      .eq("user_id", user.id)
      .in("return_id", returnIds)
      .order("created_at", { ascending: true }),
  ]);

  return NextResponse.json({
    returns,
    items: itemRows ?? [],
    attachments: attachmentRows ?? [],
    events: eventRows ?? [],
  });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase er ikke konfigurert." }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Innlogging kreves." }, { status: 401 });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Ugyldig skjema-data." }, { status: 400 });
  }

  const rawItems = safeJsonParse(formData.get("items"));
  const parsed = createReturnSchema.safeParse({
    orderId: String(formData.get("orderId") ?? ""),
    returnType: String(formData.get("returnType") ?? ""),
    reasonCode: String(formData.get("reasonCode") ?? ""),
    preferredResolution: String(formData.get("preferredResolution") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    items: Array.isArray(rawItems) ? rawItems : [],
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Ugyldig returdata.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const attachmentFiles = formData
    .getAll("attachments")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (attachmentFiles.length > MAX_ATTACHMENTS) {
    return NextResponse.json({ error: `Maks ${MAX_ATTACHMENTS} vedlegg per sak.` }, { status: 400 });
  }

  for (const file of attachmentFiles) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: `Filen ${file.name} er større enn 10 MB.` }, { status: 400 });
    }

    if (file.type && !ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
      return NextResponse.json({ error: `Filtypen ${file.type} er ikke tillatt.` }, { status: 400 });
    }
  }

  const payload = parsed.data;

  const { data: order } = await supabase
    .from("material_orders")
    .select("id, project_id, user_id, status, customer_type")
    .eq("id", payload.orderId)
    .eq("user_id", user.id)
    .maybeSingle<OrderRow>();

  if (!order) {
    return NextResponse.json({ error: "Bestillingen ble ikke funnet." }, { status: 404 });
  }

  if (!["paid", "submitted"].includes(order.status)) {
    return NextResponse.json(
      { error: "Retur og reklamasjon er tilgjengelig etter betalt eller sendt bestilling." },
      { status: 409 },
    );
  }

  const requestedItemIds = Array.from(new Set(payload.items.map((item) => item.orderItemId)));

  const { data: orderItems, error: orderItemsError } = await supabase
    .from("material_order_items")
    .select("id, product_name, quantity_value, quantity_unit, supplier_key, supplier_label, supplier_sku")
    .eq("order_id", order.id)
    .eq("user_id", user.id)
    .in("id", requestedItemIds)
    .returns<OrderItemRow[]>();

  if (orderItemsError) {
    return NextResponse.json({ error: "Kunne ikke hente ordrelinjer for retursaken." }, { status: 500 });
  }

  const orderItemsById = new Map((orderItems ?? []).map((item) => [item.id, item]));

  if (orderItemsById.size !== requestedItemIds.length) {
    return NextResponse.json({ error: "En eller flere valgte varelinjer er ugyldige." }, { status: 400 });
  }

  const supplierEntries = Array.from(
    new Map((orderItems ?? []).map((item) => [item.supplier_key, item.supplier_label])).entries(),
  );

  const supplierKey = supplierEntries.length === 1 ? supplierEntries[0][0] : null;
  const supplierLabel =
    supplierEntries.length === 1
      ? supplierEntries[0][1]
      : supplierEntries.map((entry) => entry[1]).join(", ");

  const legalBasis = inferLegalBasis(payload.returnType, order.customer_type);

  const initialStatus = resolveInitialStatus(payload.returnType, attachmentFiles.length);

  const { data: insertedReturn, error: insertReturnError } = await supabase
    .from("material_order_returns")
    .insert({
      order_id: order.id,
      project_id: order.project_id,
      user_id: user.id,
      return_type: payload.returnType,
      reason_code: payload.reasonCode,
      status: initialStatus,
      preferred_resolution: payload.preferredResolution,
      legal_basis: legalBasis,
      supplier_key: supplierKey,
      supplier_label: supplierLabel || null,
      title: payload.title.trim(),
      description: payload.description.trim(),
      return_label_url: `/api/material-returns/__RETURN_ID__/label`,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (insertReturnError || !insertedReturn) {
    return NextResponse.json({ error: "Kunne ikke opprette retursak." }, { status: 500 });
  }

  const returnId = insertedReturn.id;

  const resolvedReturnLabelUrl = `/api/material-returns/${returnId}/label`;

  await supabase
    .from("material_order_returns")
    .update({ return_label_url: resolvedReturnLabelUrl })
    .eq("id", returnId)
    .eq("user_id", user.id);

  const itemRows = payload.items.map((item) => {
    const orderItem = orderItemsById.get(item.orderItemId)!;
    const quantityValue = Math.min(item.quantityValue, Math.max(0.001, orderItem.quantity_value));

    return {
      return_id: returnId,
      order_item_id: orderItem.id,
      user_id: user.id,
      product_name: orderItem.product_name,
      quantity_value: Number(quantityValue.toFixed(3)),
      quantity_unit: orderItem.quantity_unit,
      supplier_key: orderItem.supplier_key,
      supplier_label: orderItem.supplier_label,
      supplier_sku: orderItem.supplier_sku,
      reason_note: (item.reasonNote ?? "").trim(),
    };
  });

  const { error: insertItemError } = await supabase.from("material_order_return_items").insert(itemRows);

  if (insertItemError) {
    return NextResponse.json({ error: "Kunne ikke lagre varelinjer for retursaken." }, { status: 500 });
  }

  const uploadedAttachments = await uploadAttachments({
    returnId,
    userId: user.id,
    files: attachmentFiles,
  });

  if (attachmentFiles.length > 0 && uploadedAttachments === null) {
    return NextResponse.json(
      { error: "Kunne ikke laste opp vedlegg. Kontroller at Supabase service role er konfigurert." },
      { status: 503 },
    );
  }

  if (uploadedAttachments && uploadedAttachments.length > 0) {
    const { error: attachmentInsertError } = await supabase
      .from("material_order_return_attachments")
      .insert(uploadedAttachments.map((entry) => ({ ...entry, return_id: returnId, user_id: user.id })));

    if (attachmentInsertError) {
      return NextResponse.json({ error: "Kunne ikke lagre vedlegg for retursaken." }, { status: 500 });
    }
  }

  await supabase.from("material_order_return_events").insert([
    {
      return_id: returnId,
      user_id: user.id,
      event_type: "return_created",
      payload: {
        returnType: payload.returnType,
        reasonCode: payload.reasonCode,
        preferredResolution: payload.preferredResolution,
        attachmentCount: uploadedAttachments?.length ?? 0,
        lineCount: itemRows.length,
      },
    },
    {
      return_id: returnId,
      user_id: user.id,
      event_type: "supplier_notified",
      payload: {
        supplierKey,
        supplierLabel,
        channel: "system_event",
      },
    },
    {
      return_id: returnId,
      user_id: user.id,
      event_type: payload.returnType === "return" ? "return_label_generated" : "claim_received",
      payload: {
        returnLabelUrl: resolvedReturnLabelUrl,
        status: initialStatus,
      },
    },
  ]);

  return NextResponse.json({
    ok: true,
    returnId,
    status: initialStatus,
    returnLabelUrl: resolvedReturnLabelUrl,
  });
}

function resolveInitialStatus(returnType: MaterialReturnType, attachmentCount: number) {
  if (returnType === "return") {
    return "label_ready";
  }

  if (attachmentCount > 0) {
    return "supplier_notified";
  }

  return "submitted";
}

function safeJsonParse(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function uploadAttachments({
  returnId,
  userId,
  files,
}: {
  returnId: string;
  userId: string;
  files: File[];
}) {
  if (files.length === 0) {
    return [] as {
      file_path: string;
      file_name: string;
      mime_type: string;
      file_size_bytes: number;
    }[];
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return null;
  }

  const uploaded: {
    file_path: string;
    file_name: string;
    mime_type: string;
    file_size_bytes: number;
  }[] = [];

  for (const file of files) {
    const sanitizedName = sanitizeFileName(file.name || "vedlegg");
    const timestamp = Date.now();
    const filePath = `${userId}/${returnId}/${timestamp}-${sanitizedName}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const { error } = await admin.storage.from("material-return-docs").upload(filePath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

    if (error) {
      return null;
    }

    uploaded.push({
      file_path: filePath,
      file_name: file.name || sanitizedName,
      mime_type: file.type || "application/octet-stream",
      file_size_bytes: file.size,
    });
  }

  return uploaded;
}

function sanitizeFileName(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-");
  return normalized.slice(0, 120) || "vedlegg";
}
