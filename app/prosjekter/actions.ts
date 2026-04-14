"use server";

import { redirect } from "next/navigation";

import { encodeMaterialSectionsForUrl } from "@/lib/material-list-encoding";
import { generateMaterialSectionsFromAttachments, summarizeAttachments } from "@/lib/material-list-ai";
import {
  MATERIAL_ORDER_SUPPLIERS,
  buildSuggestedOrderItems,
  getAvailableMaterialOrderSupplierKeys,
  isSupplierKey,
  normalizeOrderItemInput,
  recalculateOrderSummary,
  toVatInclusiveNok,
  toOrderItemRowsInput,
  type SupplierKey,
} from "@/lib/material-order";
import { applyMarkupForSupplierKey, getSupplierMarkups, type SupplierMarkup } from "@/lib/price-markup";
import { getPriceListProducts, type PriceListProduct } from "@/lib/price-lists";
import { buildProjectView, type MaterialSection } from "@/lib/project-data";
import { isStripeBypassed } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeProjectTitle, slugify, toNumber } from "@/lib/utils";

type DesiredProductInput = {
  source: "catalog" | "web";
  productName: string;
  quantity: string;
  comment: string;
  quantityReason: string;
  nobbNumber?: string;
  supplierName?: string;
  unitPriceNok?: number;
  productUrl?: string;
  imageUrl?: string;
};

export async function createProjectAction(formData: FormData) {
  const startDate = String(formData.get("startDate") || "").trim();
  const clarificationNotes = String(formData.get("clarificationNotes") || "").trim();
  const uploadedFiles = formData.getAll("attachments").filter(isUploadedFile);
  const attachmentSummaries = summarizeAttachments(uploadedFiles);
  const baseDescription = String(formData.get("description") || "Prosjektbeskrivelse mangler.").trim();
  const desiredProducts = parseDesiredProducts(formData.get("desiredProductsJson"));
  const metadataLines: string[] = [];

  if (startDate) {
    metadataLines.push(`Planlagt oppstart: ${startDate}`);
  }
  if (attachmentSummaries.length > 0) {
    const attachmentLine = attachmentSummaries
      .map((entry) => `${entry.name} (${entry.type}, ${entry.sizeKb} KB)`)
      .join(" | ");
    metadataLines.push(`Vedlegg: ${attachmentLine}`);
  }
  if (clarificationNotes) {
    metadataLines.push(clarificationNotes.slice(0, 2000));
  }
  if (desiredProducts.length > 0) {
    const desiredLines = desiredProducts
      .map((product, index) => {
        const details = [
          product.quantity,
          product.source === "catalog" ? "katalog" : "nett",
          product.nobbNumber ? `NOBB ${product.nobbNumber}` : null,
          product.supplierName ?? null,
          product.unitPriceNok !== undefined ? `${product.unitPriceNok} NOK` : null,
        ].filter((entry): entry is string => Boolean(entry));

        return `- ${index + 1}. ${product.productName} (${details.join(" · ")})`;
      })
      .slice(0, 40);

    metadataLines.push(["Kundens spesifikke produktønsker:", ...desiredLines].join("\n"));
  }

  const description = metadataLines.length > 0
    ? `${baseDescription}\n\n${metadataLines.join("\n")}`
    : baseDescription;

  const input = {
    title: normalizeProjectTitle(String(formData.get("title") || "Nytt prosjekt")),
    location: String(formData.get("location") || "Uspesifisert sted"),
    projectType: String(formData.get("projectType") || "Rehabilitering"),
    areaSqm: toNumber(formData.get("areaSqm"), 30),
    finishLevel: String(formData.get("finishLevel") || "Standard"),
    description,
  };

  const slug = `${slugify(input.title)}-${crypto.randomUUID().slice(0, 8)}`;
  const aiMaterialSections = await generateMaterialSectionsFromAttachments(input, uploadedFiles);
  const desiredProductSection = buildDesiredProductsSection(desiredProducts);
  const mergedMaterialSections = aiMaterialSections
    ? desiredProductSection
      ? [...aiMaterialSections, desiredProductSection]
      : aiMaterialSections
    : desiredProductSection
      ? [desiredProductSection]
      : null;
  const generatedProject = buildProjectView(input, {
    slug,
    ...(mergedMaterialSections ? { materialSections: mergedMaterialSections } : {}),
  });
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { error } = await supabase.from("projects").insert({
        slug,
        user_id: user.id,
        title: generatedProject.title,
        location: generatedProject.location,
        project_type: generatedProject.projectType,
        area_sqm: generatedProject.areaSqm,
        finish_level: generatedProject.finishLevel,
        description: generatedProject.description,
        preview_summary: {
          teaser: generatedProject.teaser,
          previewBullets: generatedProject.previewBullets,
          riskBullets: generatedProject.riskBullets,
        },
        material_list: generatedProject.materialSections,
        price_nok: generatedProject.priceNok,
        payment_status: generatedProject.paymentStatus,
      });

      if (!error) {
        redirect(`/min-side/materiallister/${slug}`);
      }
    }
  }

  const params = new URLSearchParams({
    title: input.title,
    location: input.location,
    projectType: input.projectType,
    areaSqm: String(input.areaSqm),
    finishLevel: input.finishLevel,
    description: input.description,
  });

  if (mergedMaterialSections) {
    const materialListCompressed = encodeMaterialSectionsForUrl(mergedMaterialSections);

    if (materialListCompressed) {
      params.set("materialListCompressed", materialListCompressed);
    }
  }

  redirect(`/min-side/materiallister/${slug}?${params.toString()}`);
}

export async function deleteProjectAction(formData: FormData) {
  const slug = String(formData.get("slug") || "").trim();

  if (!slug) {
    redirect("/min-side/materiallister");
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect("/min-side/materiallister");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/min-side/materiallister/${slug}`);
  }

  await supabase.from("projects").delete().eq("slug", slug).eq("user_id", user.id);

  redirect("/min-side/materiallister");
}

export async function createMaterialOrderAction(formData: FormData) {
  const slug = String(formData.get("slug") || "").trim();

  if (!slug) {
    redirect("/min-side/materiallister");
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect(`/min-side/materiallister/${slug}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/min-side/materiallister/${slug}/bestilling`)}`);
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, slug, material_list, payment_status")
    .eq("slug", slug)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    redirect("/min-side/materiallister");
  }

  if (project.payment_status !== "paid") {
    redirect(`/min-side/materiallister/${slug}?bestilling=laast`);
  }

  const { data: existingDraftOrder } = await supabase
    .from("material_orders")
    .select("id")
    .eq("project_id", project.id)
    .eq("user_id", user.id)
    .in("status", ["draft", "pending_payment"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingDraftOrder) {
    redirect(`/min-side/materiallister/${slug}/bestilling?order=${existingDraftOrder.id}`);
  }

  const materialSections = Array.isArray(project.material_list) ? project.material_list : [];
  const suggestedItems = await buildSuggestedOrderItems(materialSections);

  if (suggestedItems.length === 0) {
    redirect(`/min-side/materiallister/${slug}/bestilling?error=ingen-linjer`);
  }

  const summary = recalculateOrderSummary(suggestedItems, "delivery");

  const { data: createdOrder, error: createOrderError } = await supabase
    .from("material_orders")
    .insert({
      project_id: project.id,
      user_id: user.id,
      status: "draft",
      currency: "NOK",
      delivery_mode: "delivery",
      earliest_delivery_date: summary.earliestDeliveryDate,
      latest_delivery_date: summary.latestDeliveryDate,
      customer_note: "",
      subtotal_nok: summary.subtotalNok,
      delivery_fee_nok: summary.deliveryFeeNok,
      vat_nok: summary.vatNok,
      total_nok: summary.totalNok,
    })
    .select("id")
    .single();

  if (createOrderError || !createdOrder) {
    redirect(`/min-side/materiallister/${slug}/bestilling?error=oppretting-feilet`);
  }

  const rows = toOrderItemRowsInput(createdOrder.id, user.id, suggestedItems);

  const { error: insertItemsError } = await supabase.from("material_order_items").insert(rows);

  if (insertItemsError) {
    await supabase.from("material_orders").delete().eq("id", createdOrder.id).eq("user_id", user.id);
    redirect(`/min-side/materiallister/${slug}/bestilling?error=linjer-feilet`);
  }

  await supabase.from("material_order_events").insert({
    order_id: createdOrder.id,
    user_id: user.id,
    event_type: "order_created",
    payload: {
      projectSlug: slug,
      itemCount: rows.length,
      totalNok: summary.totalNok,
      source: "material_list",
    },
  });

  redirect(`/min-side/materiallister/${slug}/bestilling?order=${createdOrder.id}`);
}

export async function startOrderFromSupplierAction(formData: FormData) {
  const slug = String(formData.get("slug") || "").trim();
  const supplierKeyRaw = String(formData.get("supplierKey") || "").trim();

  if (!slug) {
    redirect("/min-side/materiallister");
  }

  if (!isSupplierKey(supplierKeyRaw)) {
    redirect(`/min-side/materiallister/${slug}/sammenlign?error=ugyldig-leverandor`);
  }

  const availableSupplierKeys = await getAvailableMaterialOrderSupplierKeys();

  if (availableSupplierKeys.length === 0) {
    redirect(`/min-side/materiallister/${slug}/sammenlign?error=ingen-leverandorer`);
  }

  if (!availableSupplierKeys.includes(supplierKeyRaw)) {
    redirect(`/min-side/materiallister/${slug}/sammenlign?error=leverandor-ikke-tilgjengelig`);
  }

  const supplierKey = supplierKeyRaw;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect(`/min-side/materiallister/${slug}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/min-side/materiallister/${slug}/sammenlign`)}`);
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, slug, material_list, payment_status")
    .eq("slug", slug)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    redirect("/min-side/materiallister");
  }

  if (project.payment_status !== "paid" && !isStripeBypassed()) {
    redirect(`/min-side/materiallister/${slug}?bestilling=laast`);
  }

  const { data: existingDraftOrder } = await supabase
    .from("material_orders")
    .select("id, delivery_mode")
    .eq("project_id", project.id)
    .eq("user_id", user.id)
    .in("status", ["draft", "pending_payment"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const materialSections = Array.isArray(project.material_list) ? project.material_list : [];
  const priceListProducts = await getPriceListProducts();
  const supplierMarkups = await getSupplierMarkups();
  let orderId = existingDraftOrder?.id ?? "";
  const deliveryMode: "delivery" | "pickup" = existingDraftOrder?.delivery_mode === "pickup" ? "pickup" : "delivery";

  if (!orderId) {
    const baseSuggestedItems = await buildSuggestedOrderItems(materialSections);

    if (baseSuggestedItems.length === 0) {
      redirect(`/min-side/materiallister/${slug}/sammenlign?error=ingen-linjer`);
    }

    const supplierAdjustedItems = await applySupplierToItems(
      baseSuggestedItems,
      supplierKey,
      priceListProducts,
      supplierMarkups,
      "delivery",
    );
    const summary = recalculateOrderSummary(supplierAdjustedItems, "delivery");

    const { data: createdOrder, error: createOrderError } = await supabase
      .from("material_orders")
      .insert({
        project_id: project.id,
        user_id: user.id,
        status: "draft",
        currency: "NOK",
        delivery_mode: "delivery",
        earliest_delivery_date: summary.earliestDeliveryDate,
        latest_delivery_date: summary.latestDeliveryDate,
        customer_note: "",
        subtotal_nok: summary.subtotalNok,
        delivery_fee_nok: summary.deliveryFeeNok,
        vat_nok: summary.vatNok,
        total_nok: summary.totalNok,
      })
      .select("id")
      .single();

    if (createOrderError || !createdOrder) {
      redirect(`/min-side/materiallister/${slug}/sammenlign?error=oppretting-feilet`);
    }

    orderId = createdOrder.id;
    const rows = toOrderItemRowsInput(orderId, user.id, supplierAdjustedItems);
    const { error: insertItemsError } = await supabase.from("material_order_items").insert(rows);

    if (insertItemsError) {
      await supabase.from("material_orders").delete().eq("id", orderId).eq("user_id", user.id);
      redirect(`/min-side/materiallister/${slug}/sammenlign?error=linjer-feilet`);
    }
  }

  const { data: currentItems, error: currentItemsError } = await supabase
    .from("material_order_items")
    .select("*")
    .eq("order_id", orderId)
    .eq("user_id", user.id)
    .order("position", { ascending: true });

  if (currentItemsError || !currentItems || currentItems.length === 0) {
    redirect(`/min-side/materiallister/${slug}/sammenlign?error=linjer-feilet`);
  }

  const adjustedItems = await applySupplierToItems(
    currentItems.map((item) =>
      normalizeOrderItemInput(
        {
          id: item.id,
          sectionTitle: item.section_title,
          productName: item.product_name,
          quantityValue: Number(item.quantity_value),
          quantityUnit: item.quantity_unit,
          unitPriceNok: item.unit_price_nok,
          supplierKey: item.supplier_key,
          supplierLabel: item.supplier_label,
          supplierSku: item.supplier_sku,
          estimatedDeliveryDays: item.estimated_delivery_days,
          estimatedDeliveryDate: item.estimated_delivery_date,
          note: item.note,
          isIncluded: item.is_included,
          position: item.position,
        },
        { fallbackDeliveryMode: deliveryMode },
      ),
    ),
    supplierKey,
    priceListProducts,
    supplierMarkups,
    deliveryMode,
  );

  const summary = recalculateOrderSummary(adjustedItems, deliveryMode);
  const rows = toOrderItemRowsInput(orderId, user.id, adjustedItems);

  await supabase.from("material_order_items").delete().eq("order_id", orderId).eq("user_id", user.id);

  const { error: insertAdjustedItemsError } = await supabase.from("material_order_items").insert(rows);

  if (insertAdjustedItemsError) {
    redirect(`/min-side/materiallister/${slug}/sammenlign?error=linjer-feilet`);
  }

  await supabase
    .from("material_orders")
    .update({
      status: "draft",
      subtotal_nok: summary.subtotalNok,
      delivery_fee_nok: summary.deliveryFeeNok,
      vat_nok: summary.vatNok,
      total_nok: summary.totalNok,
      earliest_delivery_date: summary.earliestDeliveryDate,
      latest_delivery_date: summary.latestDeliveryDate,
    })
    .eq("id", orderId)
    .eq("user_id", user.id);

  await supabase.from("material_order_events").insert({
    order_id: orderId,
    user_id: user.id,
    event_type: "supplier_selected_from_comparison",
    payload: {
      supplierKey,
      supplierLabel: MATERIAL_ORDER_SUPPLIERS[supplierKey].label,
      lineCount: rows.length,
      totalNok: summary.totalNok,
    },
  });

  redirect(`/min-side/materiallister/${slug}/bestilling?order=${orderId}&supplier=${supplierKey}`);
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return value instanceof File && value.size > 0;
}

function parseDesiredProducts(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [] as DesiredProductInput[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [] as DesiredProductInput[];
    }

    const normalized: DesiredProductInput[] = [];

    for (const rawEntry of parsed) {
      if (!rawEntry || typeof rawEntry !== "object") {
        continue;
      }

      const entry = rawEntry as Record<string, unknown>;
      const source = entry.source === "web" ? "web" : "catalog";
      const productName = toTrimmedString(entry.productName, 220);

      if (!productName) {
        continue;
      }

      const quantity = toTrimmedString(entry.quantity, 80) || "1 stk";
      const comment = toTrimmedString(entry.comment, 1200) || "Kundevalgt produkt.";
      const quantityReason =
        toTrimmedString(entry.quantityReason, 320) ||
        (source === "web" ? "Importert fra nettsideanalyse." : "Valgt fra katalogsøk.");
      const nobbNumber = normalizeNobb(toTrimmedString(entry.nobbNumber, 24));
      const supplierName = toTrimmedString(entry.supplierName, 120);
      const productUrl = toHttpUrl(entry.productUrl);
      const imageUrl = toHttpUrl(entry.imageUrl);
      const unitPriceNok = toNonNegativeInteger(entry.unitPriceNok);

      normalized.push({
        source,
        productName,
        quantity,
        comment,
        quantityReason,
        ...(nobbNumber ? { nobbNumber } : {}),
        ...(supplierName ? { supplierName } : {}),
        ...(unitPriceNok !== undefined ? { unitPriceNok } : {}),
        ...(productUrl ? { productUrl } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      });
    }

    return normalized.slice(0, 40);
  } catch {
    return [] as DesiredProductInput[];
  }
}

function buildDesiredProductsSection(products: DesiredProductInput[]) {
  if (products.length === 0) {
    return null;
  }

  const section: MaterialSection = {
    title: "Kundevalgte produkter",
    description: "Produkter spesifikt valgt av kunden fra katalog eller nett.",
    items: products.map((product) => ({
      item: product.productName,
      quantity: product.quantity,
      note: [
        product.comment,
        product.supplierName ? `Leverandør: ${product.supplierName}` : null,
        product.unitPriceNok !== undefined ? `Veil. pris: ${product.unitPriceNok} NOK` : null,
        product.productUrl ? `Kilde: ${product.productUrl}` : null,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" | ")
        .slice(0, 1200),
      quantityReason: product.quantityReason,
      ...(product.nobbNumber ? { nobb: product.nobbNumber } : {}),
      ...(product.productUrl ? { sourceUrl: product.productUrl } : {}),
      ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
      ...(product.supplierName ? { supplierName: product.supplierName } : {}),
      ...(product.unitPriceNok !== undefined ? { unitPriceNok: product.unitPriceNok } : {}),
    })),
  };

  return section;
}

function toTrimmedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, maxLength) : "";
}

function normalizeNobb(value: string) {
  const normalized = value.replace(/\D/g, "");
  return normalized.length >= 6 && normalized.length <= 10 ? normalized : "";
}

function toHttpUrl(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }

  try {
    const parsed = new URL(value.trim());

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function toNonNegativeInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);

    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return undefined;
}

async function applySupplierToItems<T extends { supplierKey: SupplierKey; unitPriceNok: number }>(
  items: Array<T & {
    id: string;
    sectionTitle: string;
    productName: string;
    quantityValue: number;
    quantityUnit: string;
    listPriceNok?: number | null;
    supplierLabel: string;
    supplierSku: string | null;
    estimatedDeliveryDays: number;
    estimatedDeliveryDate: string | null;
    note: string;
    isIncluded: boolean;
    position: number;
  }>,
  targetSupplierKey: SupplierKey,
  priceProducts: PriceListProduct[],
  supplierMarkups: SupplierMarkup[],
  fallbackDeliveryMode: "delivery" | "pickup",
) {
  const targetSupplier = MATERIAL_ORDER_SUPPLIERS[targetSupplierKey];
  const targetProducts = priceProducts.filter(
    (product) => inferSupplierKeyFromPriceListName(product.supplierName) === targetSupplierKey,
  );

  return items.map((item, index) => {
    const matchedProduct = findBestSupplierProductMatch(item, targetProducts);
    const baseUnitPriceNok = matchedProduct ? Math.max(0, Math.round(matchedProduct.priceNok)) : 0;
    const baseListPriceNok = Math.max(
      0,
      Math.round(matchedProduct?.listPriceNok ?? matchedProduct?.priceNok ?? baseUnitPriceNok),
    );
    const markedUnitPriceNok =
      baseUnitPriceNok > 0
        ? Math.max(
            0,
            Math.round(
              applyMarkupForSupplierKey(baseUnitPriceNok, targetSupplierKey, supplierMarkups, {
                maxPrice: baseListPriceNok,
              }),
            ),
          )
        : 0;
    const adjustedUnitPriceNok = toVatInclusiveNok(markedUnitPriceNok);
    const adjustedListPriceNok = toVatInclusiveNok(baseListPriceNok);

    return normalizeOrderItemInput(
      {
        id: item.id,
        sectionTitle: item.sectionTitle,
        productName: item.productName,
        quantityValue: item.quantityValue,
        quantityUnit: item.quantityUnit,
        unitPriceNok: adjustedUnitPriceNok,
        listPriceNok: adjustedListPriceNok,
        supplierKey: targetSupplierKey,
        supplierLabel: targetSupplier.label,
        supplierSku: matchedProduct?.nobbNumber ?? null,
        note: item.note,
        isIncluded: item.isIncluded,
        position: index,
      },
      { fallbackDeliveryMode },
    );
  });
}

function inferSupplierKeyFromPriceListName(value: string): SupplierKey | null {
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

function findBestSupplierProductMatch(
  item: { supplierSku: string | null; productName: string },
  products: PriceListProduct[],
) {
  const trimmedSku = item.supplierSku?.trim();

  if (trimmedSku) {
    const directSkuMatch = products.find((product) => product.nobbNumber === trimmedSku);

    if (directSkuMatch) {
      return directSkuMatch;
    }
  }

  const nameNobb = extractNobb(item.productName);

  if (nameNobb) {
    const directNameNobbMatch = products.find((product) => product.nobbNumber === nameNobb);

    if (directNameNobbMatch) {
      return directNameNobbMatch;
    }
  }

  const queryTokens = tokenize(item.productName);

  if (queryTokens.length === 0) {
    return null;
  }

  let bestMatch: PriceListProduct | null = null;
  let bestScore = 0;

  for (const product of products) {
    if (product.productName.toLowerCase() === item.productName.toLowerCase()) {
      return product;
    }

    const productTokens = tokenize(product.productName);

    if (productTokens.length === 0) {
      continue;
    }

    const overlap = queryTokens.filter((token) => productTokens.includes(token)).length;
    const score = overlap / Math.max(queryTokens.length, productTokens.length);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = product;
    }
  }

  return bestScore >= 0.18 ? bestMatch : null;
}

function extractNobb(value: string) {
  const match = value.match(/\b(\d{6,10})\b/);
  return match ? match[1] : "";
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}
