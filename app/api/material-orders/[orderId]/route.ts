import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getAvailableMaterialOrderSupplierKeys,
  normalizeOrderItemInput,
  recalculateOrderSummary,
  toVatInclusiveNok,
  toOrderItemRowsInput,
} from "@/lib/material-order";
import { applyMarkupForSupplierKey, getSupplierMarkups } from "@/lib/price-markup";
import { getPriceListProducts } from "@/lib/price-lists";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

const updateOrderSchema = z.object({
  customerType: z.enum(["private", "business"]),
  companyName: z.string().max(160).nullable().optional(),
  organizationNumber: z.string().max(32).nullable().optional(),
  deliveryMode: z.enum(["delivery", "pickup"]),
  pickupStoreName: z.string().max(200).nullable().optional(),
  deliveryTarget: z.enum(["door", "construction_site"]),
  unloadingMethod: z.enum(["standard", "crane_needed", "customer_machine"]),
  desiredDeliveryDate: z.string().nullable().optional(),
  shippingContactName: z.string().max(120).optional(),
  shippingPhone: z.string().max(40).optional(),
  shippingAddressLine1: z.string().max(200).nullable().optional(),
  shippingPostalCode: z.string().max(20).nullable().optional(),
  shippingCity: z.string().max(120).nullable().optional(),
  deliveryInstructions: z.string().max(600).nullable().optional(),
  expressDelivery: z.boolean().optional(),
  carryInService: z.boolean().optional(),
  checkoutFlow: z.enum(["pay_now", "klarna"]),
  contractTermsVersion: z.string().max(40).optional(),
  contractAccepted: z.boolean().optional(),
  contractAcceptedAt: z.string().nullable().optional(),
  customerNote: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        sectionTitle: z.string().min(1).max(120),
        productName: z.string().min(1).max(200),
        quantityValue: z.number().min(0).max(100000),
        quantityUnit: z.string().min(1).max(20),
        unitPriceNok: z.number().min(0).max(10000000),
        listPriceNok: z.number().min(0).max(10000000).nullable().optional(),
        supplierKey: z.enum(["byggmakker", "monter_optimera", "byggmax", "xl_bygg"]),
        supplierLabel: z.string().max(80).optional(),
        supplierSku: z.string().max(80).optional(),
        estimatedDeliveryDays: z.number().int().min(1).max(60).optional(),
        estimatedDeliveryDate: z.string().nullable().optional(),
        note: z.string().max(400).optional(),
        isIncluded: z.boolean().optional(),
      }),
    )
    .max(600),
});

export async function GET(_request: Request, { params }: RouteContext) {
  const { orderId } = await params;
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

  const { data: order } = await supabase
    .from("material_orders")
    .select("*")
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Bestilling ikke funnet." }, { status: 404 });
  }

  const { data: items, error: itemsError } = await supabase
    .from("material_order_items")
    .select("*")
    .eq("order_id", order.id)
    .eq("user_id", user.id)
    .order("position", { ascending: true });

  if (itemsError) {
    return NextResponse.json({ error: "Kunne ikke hente bestillingslinjer." }, { status: 500 });
  }

  return NextResponse.json({ order, items: items ?? [] });
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { orderId } = await params;
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

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON-payload." }, { status: 400 });
  }

  const parsed = updateOrderSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Ugyldig bestillingsdata.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const availableSupplierKeys = await getAvailableMaterialOrderSupplierKeys();

  if (availableSupplierKeys.length === 0) {
    return NextResponse.json({ error: "Ingen leverandører er tilgjengelige i prislister." }, { status: 409 });
  }

  if (parsed.data.items.some((item) => !availableSupplierKeys.includes(item.supplierKey))) {
    return NextResponse.json(
      { error: "Bestillingen inneholder leverandører som ikke finnes i aktive prislister." },
      { status: 400 },
    );
  }

  const priceProducts = await getPriceListProducts();
  const supplierMarkups = await getSupplierMarkups();
  const listPriceBySupplierAndNobb = new Map<string, number>();
  const unitPriceBySupplierAndNobb = new Map<string, number>();

  for (const product of priceProducts) {
    const supplierKey = inferSupplierKeyFromName(product.supplierName);

    if (!supplierKey || !product.nobbNumber) {
      continue;
    }

    listPriceBySupplierAndNobb.set(`${supplierKey}:${product.nobbNumber}`, product.listPriceNok);
    unitPriceBySupplierAndNobb.set(`${supplierKey}:${product.nobbNumber}`, product.priceNok);
  }

  const { data: order } = await supabase
    .from("material_orders")
    .select("*")
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Bestilling ikke funnet." }, { status: 404 });
  }

  if (["paid", "submitted", "cancelled"].includes(String(order.status))) {
    return NextResponse.json({ error: "Bestillingen kan ikke lenger redigeres." }, { status: 409 });
  }

  const normalizedItems = parsed.data.items.map((item, index) => {
    const resolvedListPriceNok = resolveListPriceNok(item, listPriceBySupplierAndNobb);
    const resolvedUnitPriceNok = resolveUnitPriceNok(
      item,
      unitPriceBySupplierAndNobb,
      listPriceBySupplierAndNobb,
      supplierMarkups,
    );

    return normalizeOrderItemInput(
      {
        ...item,
        unitPriceNok: resolvedUnitPriceNok,
        listPriceNok: resolvedListPriceNok,
        position: index,
      },
      {
        fallbackDeliveryMode: parsed.data.deliveryMode,
      },
    );
  });

  if (normalizedItems.length === 0) {
    return NextResponse.json({ error: "Bestillingen må inneholde minst én linje." }, { status: 400 });
  }

  if (!normalizedItems.some((item) => item.isIncluded)) {
    return NextResponse.json({ error: "Minst én linje må være aktiv for bestilling." }, { status: 400 });
  }

  if (!parsed.data.shippingContactName?.trim() || !parsed.data.shippingPhone?.trim()) {
    return NextResponse.json({ error: "Kontaktperson og telefon er obligatorisk." }, { status: 400 });
  }

  if (parsed.data.customerType === "business" && !parsed.data.companyName?.trim()) {
    return NextResponse.json({ error: "Firmanavn er obligatorisk for bedriftsordre." }, { status: 400 });
  }

  if (parsed.data.customerType === "business" && !isNorwegianOrganizationNumber(parsed.data.organizationNumber)) {
    return NextResponse.json({ error: "Gyldig organisasjonsnummer (9 siffer) er obligatorisk for bedriftsordre." }, { status: 400 });
  }

  if (parsed.data.deliveryMode === "delivery" && (!parsed.data.shippingAddressLine1?.trim() || !parsed.data.shippingPostalCode?.trim() || !parsed.data.shippingCity?.trim())) {
    return NextResponse.json({ error: "Komplett leveringsadresse er obligatorisk for levering." }, { status: 400 });
  }

  if (parsed.data.deliveryMode === "pickup" && !parsed.data.pickupStoreName?.trim()) {
    return NextResponse.json({ error: "Velg en butikk for henting." }, { status: 400 });
  }

  if (parsed.data.deliveryTarget === "construction_site" && (parsed.data.deliveryInstructions ?? "").trim().length < 8) {
    return NextResponse.json(
      { error: "Legg inn leveringsinstruksjon for byggeplass (adkomst, plassering eller mottak)." },
      { status: 400 },
    );
  }

  if (parsed.data.unloadingMethod === "crane_needed" && (parsed.data.deliveryInstructions ?? "").trim().length < 8) {
    return NextResponse.json(
      { error: "Legg inn detaljer for kranlevering i fraktinstruksjoner før lagring." },
      { status: 400 },
    );
  }

  const contractAccepted = parsed.data.contractAccepted === true;
  const contractAcceptedAt =
    contractAccepted && parsed.data.contractAcceptedAt && !Number.isNaN(new Date(parsed.data.contractAcceptedAt).getTime())
      ? new Date(parsed.data.contractAcceptedAt).toISOString()
      : contractAccepted
        ? new Date().toISOString()
        : null;

  const summary = recalculateOrderSummary(normalizedItems, parsed.data.deliveryMode, {
    expressDelivery: parsed.data.expressDelivery === true,
    carryInService: parsed.data.carryInService === true,
  });
  const desiredDeliveryDate = normalizeIsoDateOrNull(parsed.data.desiredDeliveryDate);

  const { error: updateOrderError } = await supabase
    .from("material_orders")
    .update({
      status: "draft",
      customer_type: parsed.data.customerType,
      company_name: parsed.data.customerType === "business" ? (parsed.data.companyName ?? "").trim() || null : null,
      organization_number:
        parsed.data.customerType === "business" ? (parsed.data.organizationNumber ?? "").trim() || null : null,
      delivery_mode: parsed.data.deliveryMode,
      delivery_target: parsed.data.deliveryTarget,
      unloading_method: parsed.data.unloadingMethod,
      desired_delivery_date: desiredDeliveryDate,
      shipping_contact_name: parsed.data.shippingContactName?.trim() || null,
      shipping_phone: parsed.data.shippingPhone?.trim() || null,
      shipping_address_line1: parsed.data.shippingAddressLine1?.trim() || null,
      shipping_postal_code: parsed.data.shippingPostalCode?.trim() || null,
      shipping_city: parsed.data.shippingCity?.trim() || null,
      delivery_instructions: parsed.data.deliveryMode === "pickup"
        ? (parsed.data.pickupStoreName ?? "").trim()
        : (parsed.data.deliveryInstructions ?? "").trim(),
      express_delivery: parsed.data.expressDelivery === true,
      carry_in_service: parsed.data.carryInService === true,
      checkout_flow: parsed.data.checkoutFlow,
      financing_plan_months: null,
      contract_terms_version: parsed.data.contractTermsVersion?.trim() || "2026-04",
      contract_accepted_at: contractAcceptedAt,
      customer_note: (parsed.data.customerNote ?? "").trim(),
      subtotal_nok: summary.subtotalNok,
      delivery_fee_nok: summary.deliveryFeeNok,
      vat_nok: summary.vatNok,
      total_nok: summary.totalNok,
      earliest_delivery_date: summary.earliestDeliveryDate,
      latest_delivery_date: summary.latestDeliveryDate,
    })
    .eq("id", orderId)
    .eq("user_id", user.id);

  if (updateOrderError) {
    return NextResponse.json({ error: "Kunne ikke oppdatere bestillingshode." }, { status: 500 });
  }

  const { error: deleteItemsError } = await supabase
    .from("material_order_items")
    .delete()
    .eq("order_id", orderId)
    .eq("user_id", user.id);

  if (deleteItemsError) {
    return NextResponse.json({ error: "Kunne ikke oppdatere bestillingslinjer." }, { status: 500 });
  }

  const rows = toOrderItemRowsInput(orderId, user.id, normalizedItems);
  const { error: insertItemsError } = await supabase.from("material_order_items").insert(rows);

  if (insertItemsError) {
    return NextResponse.json({ error: "Kunne ikke lagre bestillingslinjer." }, { status: 500 });
  }

  await supabase.from("material_order_events").insert({
    order_id: orderId,
    user_id: user.id,
    event_type: "order_updated",
    payload: {
      lineCount: rows.length,
      includedLineCount: normalizedItems.filter((item) => item.isIncluded).length,
      deliveryMode: parsed.data.deliveryMode,
      deliveryTarget: parsed.data.deliveryTarget,
      unloadingMethod: parsed.data.unloadingMethod,
      totalNok: summary.totalNok,
    },
  });

  return NextResponse.json({
    ok: true,
    summary,
    items: normalizedItems,
    order: {
      contractAcceptedAt,
    },
  });
}

function normalizeIsoDateOrNull(value?: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return trimmed;
}

function isNorwegianOrganizationNumber(value?: string | null) {
  if (!value) {
    return false;
  }

  return /^\d{9}$/.test(value.trim());
}

function resolveListPriceNok(
  item: { supplierKey: string; supplierSku?: string | null; productName: string; note?: string; listPriceNok?: number | null },
  listPriceBySupplierAndNobb: Map<string, number>,
) {
  const directNobb = normalizeNobb(item.supplierSku) || extractNobb(item.productName) || extractNobb(item.note ?? "");

  if (directNobb) {
    const mapped = listPriceBySupplierAndNobb.get(`${item.supplierKey}:${directNobb}`);

    if (typeof mapped === "number" && Number.isFinite(mapped)) {
        return toVatInclusiveNok(Math.max(0, Math.round(mapped)));
    }
  }

  if (typeof item.listPriceNok === "number" && Number.isFinite(item.listPriceNok)) {
    return Math.max(0, Math.round(item.listPriceNok));
  }

  return null;
}

function resolveUnitPriceNok(
  item: {
    supplierKey: "byggmakker" | "monter_optimera" | "byggmax" | "xl_bygg";
    supplierSku?: string | null;
    productName: string;
    note?: string;
    unitPriceNok: number;
    listPriceNok?: number | null;
  },
  unitPriceBySupplierAndNobb: Map<string, number>,
  listPriceBySupplierAndNobb: Map<string, number>,
  supplierMarkups: Array<{ supplier_name: string; markup_percentage: number; markup_fixed: number }>,
) {
  const directNobb = normalizeNobb(item.supplierSku) || extractNobb(item.productName) || extractNobb(item.note ?? "");

  if (directNobb) {
    const mapKey = `${item.supplierKey}:${directNobb}`;
    const mapped = unitPriceBySupplierAndNobb.get(mapKey);
    const mappedListPrice = listPriceBySupplierAndNobb.get(mapKey);

    if (typeof mapped === "number" && Number.isFinite(mapped)) {
      const markedPrice = Math.max(
        0,
        Math.round(
          applyMarkupForSupplierKey(mapped, item.supplierKey, supplierMarkups, {
            maxPrice: mappedListPrice,
          }),
        ),
      );
        return toVatInclusiveNok(markedPrice);
    }
  }

  const fallbackUnitPrice = Math.max(0, Math.round(item.unitPriceNok));
  const fallbackListPrice =
    typeof item.listPriceNok === "number" && Number.isFinite(item.listPriceNok)
      ? Math.max(0, Math.round(item.listPriceNok))
      : null;

  if (typeof fallbackListPrice === "number" && fallbackListPrice > 0) {
    return Math.min(fallbackUnitPrice, fallbackListPrice);
  }

  return fallbackUnitPrice;
}

function normalizeNobb(value?: string | null) {
  if (!value) {
    return "";
  }

  return value.replace(/\D/g, "");
}

function extractNobb(value: string) {
  const match = value.match(/\b(\d{6,10})\b/);
  return match ? match[1] : "";
}

function inferSupplierKeyFromName(value: string): "byggmakker" | "monter_optimera" | "byggmax" | "xl_bygg" | null {
  const normalized = value.toLowerCase();

  if (normalized.includes("byggmakker")) {
    return "byggmakker";
  }

  if (normalized.includes("monter") || normalized.includes("optimera")) {
    return "monter_optimera";
  }

  if (normalized.includes("byggmax")) {
    return "byggmax";
  }

  if (normalized.includes("xl")) {
    return "xl_bygg";
  }

  return null;
}
