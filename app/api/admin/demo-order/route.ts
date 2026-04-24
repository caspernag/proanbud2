import { NextResponse, type NextRequest } from "next/server";

import { isAdminUser } from "@/lib/admin-auth";
import { sendMaterialOrderEmail } from "@/lib/email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ──────────────────────────────────────────────────────────────────────────────
// Realistic demo presets
// ──────────────────────────────────────────────────────────────────────────────

type DemoItem = {
  section_title: string;
  product_name: string;
  quantity_value: number;
  quantity_unit: string;
  unit_price_nok: number; // øre
  supplier_key: "byggmakker" | "monter_optimera" | "byggmax" | "xl_bygg";
  supplier_label: string;
  supplier_sku: string;
  estimated_delivery_days: number;
};

type DemoPreset = {
  title: string;
  project_type: string;
  location: string;
  items: DemoItem[];
};

const PRESETS: Record<string, DemoPreset> = {
  baderom: {
    title: "Baderomsrenovering",
    project_type: "bathroom",
    location: "Oslo",
    items: [
      { section_title: "Fliser", product_name: "Norstone Cala White 30x60cm", quantity_value: 12, quantity_unit: "m²", unit_price_nok: 39900, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-FL-1234", estimated_delivery_days: 5 },
      { section_title: "Fliser", product_name: "Gulvflis Antracit Matt 60x60cm", quantity_value: 6, quantity_unit: "m²", unit_price_nok: 44900, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-FL-5678", estimated_delivery_days: 5 },
      { section_title: "Fliser", product_name: "Fugemasse Mapei Keracolor FF Grå 5kg", quantity_value: 3, quantity_unit: "pose", unit_price_nok: 18900, supplier_key: "monter_optimera", supplier_label: "Monter / Optimera", supplier_sku: "MO-FU-3344", estimated_delivery_days: 3 },
      { section_title: "Membran & isolasjon", product_name: "Schlüter KERDI membranfolie 5m rull", quantity_value: 2, quantity_unit: "rull", unit_price_nok: 62500, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-ME-7890", estimated_delivery_days: 5 },
      { section_title: "Membran & isolasjon", product_name: "Rockwool Flexi 50mm 6,24m²", quantity_value: 4, quantity_unit: "pk", unit_price_nok: 31900, supplier_key: "byggmax", supplier_label: "Byggmax", supplier_sku: "BMX-IS-1122", estimated_delivery_days: 4 },
      { section_title: "Våtromsplater", product_name: "Jackon Thermomur 50mm 600x2400mm", quantity_value: 10, quantity_unit: "pk", unit_price_nok: 84900, supplier_key: "xl_bygg", supplier_label: "XL-BYGG", supplier_sku: "XL-VP-3344", estimated_delivery_days: 7 },
      { section_title: "Røranlegg", product_name: "Uponor PEX-rør 16mm 100m rull", quantity_value: 1, quantity_unit: "rull", unit_price_nok: 189000, supplier_key: "monter_optimera", supplier_label: "Monter / Optimera", supplier_sku: "MO-RO-9988", estimated_delivery_days: 3 },
      { section_title: "Røranlegg", product_name: "Gulvvarme kabel 150W/m² 8m²", quantity_value: 1, quantity_unit: "stk", unit_price_nok: 349000, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-GV-4455", estimated_delivery_days: 5 },
    ],
  },
  kjokken: {
    title: "Kjøkkenrenovering",
    project_type: "kitchen",
    location: "Bergen",
    items: [
      { section_title: "Benkeplate", product_name: "Benkeplate Laminat Eik 620x3000mm", quantity_value: 2, quantity_unit: "stk", unit_price_nok: 149900, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-BPL-1010", estimated_delivery_days: 6 },
      { section_title: "Benkeplate", product_name: "Vask Franke silensstål 560x430mm", quantity_value: 1, quantity_unit: "stk", unit_price_nok: 219900, supplier_key: "monter_optimera", supplier_label: "Monter / Optimera", supplier_sku: "MO-VS-2020", estimated_delivery_days: 8 },
      { section_title: "Fliser", product_name: "Veggflis Metro hvit blank 7,5x15cm", quantity_value: 5, quantity_unit: "m²", unit_price_nok: 24900, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-FL-3030", estimated_delivery_days: 5 },
      { section_title: "Elektro", product_name: "Stikk m/jord grå Enkel uttak 2-pol", quantity_value: 8, quantity_unit: "stk", unit_price_nok: 5900, supplier_key: "xl_bygg", supplier_label: "XL-BYGG", supplier_sku: "XL-EL-4040", estimated_delivery_days: 3 },
      { section_title: "Maling & overflate", product_name: "Jotun Sens Veggmaling Hvit 10L", quantity_value: 2, quantity_unit: "boks", unit_price_nok: 59900, supplier_key: "byggmax", supplier_label: "Byggmax", supplier_sku: "BMX-MV-5050", estimated_delivery_days: 2 },
      { section_title: "Festemidler", product_name: "Skruer 4x40mm Forsenk TX20 200stk", quantity_value: 3, quantity_unit: "pk", unit_price_nok: 12900, supplier_key: "byggmax", supplier_label: "Byggmax", supplier_sku: "BMX-SK-6060", estimated_delivery_days: 2 },
      { section_title: "Ventilasjon", product_name: "Flexit kjøkkenvifte 600m³/t hvit", quantity_value: 1, quantity_unit: "stk", unit_price_nok: 299900, supplier_key: "monter_optimera", supplier_label: "Monter / Optimera", supplier_sku: "MO-VT-7070", estimated_delivery_days: 10 },
    ],
  },
  terrasse: {
    title: "Terrassebygging",
    project_type: "outdoor",
    location: "Stavanger",
    items: [
      { section_title: "Terrassebord", product_name: "Terrassebord trykkimpregnert 28x120x4800mm", quantity_value: 40, quantity_unit: "stk", unit_price_nok: 18900, supplier_key: "byggmax", supplier_label: "Byggmax", supplier_sku: "BMX-TB-1111", estimated_delivery_days: 4 },
      { section_title: "Terrassebord", product_name: "Bjelke trykkimpregnert 48x148x3600mm", quantity_value: 20, quantity_unit: "stk", unit_price_nok: 21900, supplier_key: "byggmax", supplier_label: "Byggmax", supplier_sku: "BMX-BJ-2222", estimated_delivery_days: 4 },
      { section_title: "Fundament", product_name: "Terrasse stolpe trykkimpr. 98x98x2400mm", quantity_value: 8, quantity_unit: "stk", unit_price_nok: 33900, supplier_key: "xl_bygg", supplier_label: "XL-BYGG", supplier_sku: "XL-TP-3333", estimated_delivery_days: 5 },
      { section_title: "Fundament", product_name: "Betongblanding Rapid 25kg", quantity_value: 10, quantity_unit: "sekk", unit_price_nok: 8900, supplier_key: "byggmax", supplier_label: "Byggmax", supplier_sku: "BMX-BT-4444", estimated_delivery_days: 2 },
      { section_title: "Rekkverk", product_name: "Rekkverk stål svart 1800mm", quantity_value: 6, quantity_unit: "stk", unit_price_nok: 129900, supplier_key: "monter_optimera", supplier_label: "Monter / Optimera", supplier_sku: "MO-RK-5555", estimated_delivery_days: 7 },
      { section_title: "Festemidler", product_name: "Skjult befestning Deckfix 50stk", quantity_value: 5, quantity_unit: "pk", unit_price_nok: 19900, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-DF-6666", estimated_delivery_days: 3 },
      { section_title: "Olje & behandling", product_name: "Osmo TerraceOil klar 2,5L", quantity_value: 3, quantity_unit: "boks", unit_price_nok: 54900, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-OJ-7777", estimated_delivery_days: 3 },
    ],
  },
  innvendig: {
    title: "Innvendig oppussing",
    project_type: "interior",
    location: "Trondheim",
    items: [
      { section_title: "Gips & plater", product_name: "Gipsplater 12,5x1200x2400mm", quantity_value: 30, quantity_unit: "stk", unit_price_nok: 14900, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-GP-1001", estimated_delivery_days: 4 },
      { section_title: "Gips & plater", product_name: "Stålprofil C100 3600mm", quantity_value: 20, quantity_unit: "stk", unit_price_nok: 8900, supplier_key: "monter_optimera", supplier_label: "Monter / Optimera", supplier_sku: "MO-SP-1002", estimated_delivery_days: 3 },
      { section_title: "Gulv", product_name: "Laminatgulv eik grå 8mm AC5 2,22m²/pk", quantity_value: 18, quantity_unit: "pk", unit_price_nok: 38900, supplier_key: "byggmax", supplier_label: "Byggmax", supplier_sku: "BMX-LG-1003", estimated_delivery_days: 5 },
      { section_title: "Gulv", product_name: "Underlagsmatte 3mm 15m²/rull", quantity_value: 3, quantity_unit: "rull", unit_price_nok: 22900, supplier_key: "byggmax", supplier_label: "Byggmax", supplier_sku: "BMX-UM-1004", estimated_delivery_days: 3 },
      { section_title: "Maling", product_name: "Jotun Sens Veggmaling Matt 10L", quantity_value: 3, quantity_unit: "boks", unit_price_nok: 59900, supplier_key: "xl_bygg", supplier_label: "XL-BYGG", supplier_sku: "XL-MV-1005", estimated_delivery_days: 2 },
      { section_title: "Maling", product_name: "Jotun Panel & List Hvit 3L", quantity_value: 2, quantity_unit: "boks", unit_price_nok: 32900, supplier_key: "xl_bygg", supplier_label: "XL-BYGG", supplier_sku: "XL-MR-1006", estimated_delivery_days: 2 },
      { section_title: "Lister & profiler", product_name: "Gulvlist hvit 14x58mm 2400mm", quantity_value: 20, quantity_unit: "stk", unit_price_nok: 8900, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-GL-1007", estimated_delivery_days: 3 },
      { section_title: "Lister & profiler", product_name: "Takfugelist MDF hvit 42mm 2400mm", quantity_value: 16, quantity_unit: "stk", unit_price_nok: 9900, supplier_key: "byggmakker", supplier_label: "Byggmakker", supplier_sku: "BM-TL-1008", estimated_delivery_days: 3 },
    ],
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/admin/demo-order
// Body: { userId: string, presetKey: string, deliveryMode: "delivery" | "pickup" }
// ──────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Admin guard
  const isAdmin = await isAdminUser();
  if (!isAdmin) {
    return NextResponse.json({ error: "Ikke autorisert" }, { status: 403 });
  }

  let body: { userId?: string; presetKey?: string; deliveryMode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON" }, { status: 400 });
  }

  const { userId, presetKey = "baderom", deliveryMode = "delivery" } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId er påkrevd" }, { status: 400 });
  }

  const preset = PRESETS[presetKey];
  if (!preset) {
    return NextResponse.json({ error: "Ukjent preset" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Admin-klient utilgjengelig" }, { status: 500 });
  }

  // Generate unique slug
  const slug = `demo-${presetKey}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 1. Create demo project (bypasses RLS with service-role)
  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({
      user_id: userId,
      slug,
      title: `${preset.title} (Demo)`,
      location: preset.location,
      project_type: preset.project_type,
      payment_status: "paid",
      price_nok: 39000, // 390 kr in øre
    })
    .select("id")
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: projectError?.message ?? "Kunne ikke opprette prosjekt" }, { status: 500 });
  }

  // 2. Calculate totals
  const subtotal = preset.items.reduce((s, item) => s + item.unit_price_nok * item.quantity_value, 0);
  const deliveryFee = deliveryMode === "delivery" ? 49900 : 0; // 499 kr
  const vat = Math.round(subtotal * 0.25);
  const total = subtotal + deliveryFee + vat;

  const now = new Date().toISOString();
  const deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // 3. Create material order
  const { data: order, error: orderError } = await admin
    .from("material_orders")
    .insert({
      project_id: project.id,
      user_id: userId,
      status: "submitted",
      delivery_mode: deliveryMode,
      desired_delivery_date: deliveryDate,
      customer_note: "Demo-bestilling opprettet av administrator.",
      subtotal_nok: subtotal,
      delivery_fee_nok: deliveryFee,
      vat_nok: vat,
      total_nok: total,
      paid_at: now,
      submitted_at: now,
      checkout_session_id: `demo_cs_${Date.now()}`,
      payment_intent_id: `demo_pi_${Date.now()}`,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    // Rollback project
    await admin.from("projects").delete().eq("id", project.id);
    return NextResponse.json({ error: orderError?.message ?? "Kunne ikke opprette bestilling" }, { status: 500 });
  }

  // 4. Create order items
  const items = preset.items.map((item, i) => ({
    order_id: order.id,
    user_id: userId,
    section_title: item.section_title,
    product_name: item.product_name,
    quantity_value: item.quantity_value,
    quantity_unit: item.quantity_unit,
    unit_price_nok: item.unit_price_nok,
    line_total_nok: item.unit_price_nok * item.quantity_value,
    supplier_key: item.supplier_key,
    supplier_label: item.supplier_label,
    supplier_sku: item.supplier_sku,
    estimated_delivery_days: item.estimated_delivery_days,
    estimated_delivery_date: deliveryDate,
    is_included: true,
    position: i,
  }));

  const { error: itemsError } = await admin.from("material_order_items").insert(items);

  if (itemsError) {
    // Rollback order + project
    await admin.from("material_orders").delete().eq("id", order.id);
    await admin.from("projects").delete().eq("id", project.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  // Fetch user info for email
  const userResult = await admin.auth.admin.getUserById(userId);
  const user = userResult.data?.user;
  const customerEmail = user?.email ?? "demo@proanbud.no";
  const customerName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    customerEmail.split("@")[0];

  // Send order email (non-blocking, errors logged but not thrown)
  sendMaterialOrderEmail({
    orderId: order.id,
    customerName,
    customerEmail,
    customerPhone: null,
    deliveryMode: deliveryMode as "delivery" | "pickup",
    deliveryAddress: deliveryMode === "delivery" ? `${preset.location}` : null,
    deliveryPostalCode: null,
    deliveryCity: deliveryMode === "delivery" ? preset.location : null,
    earliestDelivery: null,
    latestDelivery: deliveryDate,
    subtotalNok: subtotal,
    deliveryFeeNok: deliveryFee,
    vatNok: vat,
    totalNok: total,
    paidAt: now,
    items: preset.items.map((item) => ({
      product_name: item.product_name,
      supplier_label: item.supplier_label,
      quantity: item.quantity_value,
      unit: item.quantity_unit,
      unit_price_nok: item.unit_price_nok,
      total_price_nok: item.unit_price_nok * item.quantity_value,
      cost_price_nok: item.unit_price_nok,
      cost_total_nok: item.unit_price_nok * item.quantity_value,
      nobb_number: item.supplier_sku,
    })),
  }).catch((err) => console.error("[demo-order] E-postutsending feilet:", err));

  return NextResponse.json({ orderId: order.id, projectId: project.id, total });
}
