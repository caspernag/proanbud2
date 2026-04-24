"use server";

import { redirect } from "next/navigation";

import { encodeMaterialSectionsForUrl } from "@/lib/material-list-encoding";
import { generateMaterialSectionsFromAttachments, summarizeAttachments } from "@/lib/material-list-ai";
import {
  buildSuggestedOrderItems,
  recalculateOrderSummary,
  toOrderItemRowsInput,
} from "@/lib/material-order";
import { getPriceListProducts, type PriceListProduct } from "@/lib/price-lists";
import { getByggmakkerAvailability } from "@/lib/byggmakker-availability";
import { buildDefaultMaterialSections, buildProjectView, type MaterialSection } from "@/lib/project-data";
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
  sectionTitle?: string;
  category?: string;
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
  const baseMaterialSections = aiMaterialSections ?? buildDefaultMaterialSections(input);
  const mergedMaterialSections = mergeDesiredProductsIntoMaterialSections(baseMaterialSections, desiredProducts);
  const priceListProducts = await getPriceListProducts();
  const constrainedMaterialSections = await constrainMaterialSectionsToCatalog(mergedMaterialSections, priceListProducts);
  const generatedProject = buildProjectView(input, {
    slug,
    ...(constrainedMaterialSections ? { materialSections: constrainedMaterialSections } : {}),
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

  if (constrainedMaterialSections) {
    const materialListCompressed = encodeMaterialSectionsForUrl(constrainedMaterialSections);

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
      delivery_target: "door",
      unloading_method: "standard",
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
      const sectionTitle = toTrimmedString(entry.sectionTitle, 140);
      const category = toTrimmedString(entry.category, 140);

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
        ...(sectionTitle ? { sectionTitle } : {}),
        ...(category ? { category } : {}),
      });
    }

    return normalized.slice(0, 40);
  } catch {
    return [] as DesiredProductInput[];
  }
}

function mergeDesiredProductsIntoMaterialSections(
  baseSections: MaterialSection[] | null,
  products: DesiredProductInput[],
) {
  if (products.length === 0) {
    return baseSections;
  }

  const sections: MaterialSection[] = baseSections
    ? baseSections.map((section) => ({ ...section, items: [...section.items] }))
    : [];

  if (sections.length === 0) {
    sections.push({
      title: "Materialer",
      description: "Samlet materialbehov for prosjektet.",
      items: [],
    });
  }

  for (const product of products) {
    const targetIndex = resolveTargetSectionIndex(product, sections);
    const targetSection = sections[targetIndex] ?? sections[0];
    const hasDuplicate = targetSection.items.some((item) => {
      const sameNobb =
        product.nobbNumber &&
        typeof item.nobb === "string" &&
        item.nobb.replace(/\D/g, "") === product.nobbNumber;
      const sameName = item.item.trim().toLowerCase() === product.productName.trim().toLowerCase();

      return Boolean(sameNobb || sameName);
    });

    if (hasDuplicate) {
      continue;
    }
    const preferredItem = buildPreferredMaterialItem(product);
    const replaceIndex = findReplacementIndex(targetSection.items, product);

    if (replaceIndex >= 0) {
      const existing = targetSection.items[replaceIndex];
      targetSection.items[replaceIndex] = {
        ...existing,
        ...preferredItem,
        // Keep AI-estimated quantity only when desired product has empty/placeholder quantity.
        quantity:
          product.quantity.trim().length > 0 &&
          product.quantity.trim().toLowerCase() !== "1 stk"
            ? preferredItem.quantity
            : existing.quantity,
        note: [existing.note, preferredItem.note]
          .filter((entry) => entry.trim().length > 0)
          .join(" | ")
          .slice(0, 1200),
      };
      continue;
    }

    // If no natural replacement candidate exists, prepend so preferred product still influences list.
    targetSection.items.unshift(preferredItem);
  }

  return sections.filter((section) => section.items.length > 0);
}

function resolveTargetSectionIndex(product: DesiredProductInput, sections: MaterialSection[]) {
  const candidates = [product.sectionTitle, product.category]
    .map((value) => value?.trim().toLowerCase() ?? "")
    .filter((value) => value.length > 0);

  if (candidates.length === 0) {
    return 0;
  }

  const index = sections.findIndex((section) => {
    const title = section.title.trim().toLowerCase();
    const description = section.description.trim().toLowerCase();

    return candidates.some((candidate) => title.includes(candidate) || candidate.includes(title) || description.includes(candidate));
  });

  return index >= 0 ? index : 0;
}

function buildPreferredMaterialItem(product: DesiredProductInput) {
  return {
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
  };
}

function findReplacementIndex(items: MaterialSection["items"], product: DesiredProductInput) {
  const productTokens = tokenizeForReplacement(product.productName);

  if (productTokens.length === 0) {
    return -1;
  }

  let bestIndex = -1;
  let bestScore = 0;

  for (const [index, item] of items.entries()) {
    const itemTokens = tokenizeForReplacement(item.item);

    if (itemTokens.length === 0) {
      continue;
    }

    const overlap = productTokens.filter((token) => itemTokens.includes(token)).length;
    const score = overlap / Math.max(productTokens.length, itemTokens.length);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }

    if (item.item.trim().toLowerCase() === product.productName.trim().toLowerCase()) {
      return index;
    }
  }

  return bestScore >= 0.22 ? bestIndex : -1;
}

function tokenizeForReplacement(value: string) {
  return value
    .toLocaleLowerCase("nb-NO")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9æøå]+/)
    .filter((token) => token.length > 1);
}

function toTrimmedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, maxLength) : "";
}

async function constrainMaterialSectionsToCatalog(
  sections: MaterialSection[] | null,
  products: PriceListProduct[],
) {
  if (!sections || sections.length === 0) {
    return null;
  }

  if (products.length === 0) {
    return sections;
  }

  const normalized: MaterialSection[] = [];
  const byggmakkerAvailabilityCache = new Map<string, boolean>();

  for (const section of sections) {
    const items: MaterialSection["items"] = [];

    for (const item of section.items) {
      const bestMatch = await findBestCatalogMatch(
        item,
        section,
        products,
        byggmakkerAvailabilityCache,
      );

      if (!bestMatch) {
        continue;
      }

      items.push({
        ...item,
        item: bestMatch.productName,
        nobb: bestMatch.nobbNumber,
        quantityReason: item.quantityReason || bestMatch.quantityReason,
        note: `${item.note}${item.note ? " | " : ""}Valgt fra aktiv leverandørkatalog (${bestMatch.supplierName}).`.slice(0, 1200),
      });
    }

    if (items.length === 0) {
      continue;
    }

    normalized.push({
      ...section,
      items,
    });
  }

  return normalized.length > 0 ? normalized : null;
}

async function findBestCatalogMatch(
  item: MaterialSection["items"][number],
  section: MaterialSection,
  products: PriceListProduct[],
  byggmakkerAvailabilityCache: Map<string, boolean>,
) {
  const directNobb = typeof item.nobb === "string" ? item.nobb.replace(/\D/g, "") : "";

  if (directNobb.length >= 6) {
    const direct = products.find((product) => product.nobbNumber === directNobb);
    if (direct) {
      const isAvailable = await isCatalogProductAvailableForMaterialList(
        direct,
        byggmakkerAvailabilityCache,
      );
      return isAvailable ? direct : null;
    }
  }

  const itemTokens = tokenizeForReplacement(item.item);
  const sectionTokens = tokenizeForReplacement(`${section.title} ${section.description}`);

  if (itemTokens.length === 0) {
    return null;
  }

  const scored: Array<{ product: PriceListProduct; score: number }> = [];

  for (const product of products) {
    const productTokens = tokenizeForReplacement(product.productName);
    const catalogTokens = tokenizeForReplacement(`${product.sectionTitle} ${product.category}`);

    if (productTokens.length === 0) {
      continue;
    }

    const nameOverlap = itemTokens.filter((token) => productTokens.includes(token)).length;
    const sectionOverlap = sectionTokens.filter((token) => catalogTokens.includes(token)).length;
    const score =
      nameOverlap / Math.max(itemTokens.length, productTokens.length) +
      sectionOverlap * 0.08;

    if (product.productName.trim().toLowerCase() === item.item.trim().toLowerCase()) {
      const isAvailable = await isCatalogProductAvailableForMaterialList(
        product,
        byggmakkerAvailabilityCache,
      );
      return isAvailable ? product : null;
    }

    scored.push({ product, score });
  }

  scored.sort((left, right) => right.score - left.score);

  for (const candidate of scored) {
    if (candidate.score < 0.18) {
      break;
    }

    const isAvailable = await isCatalogProductAvailableForMaterialList(
      candidate.product,
      byggmakkerAvailabilityCache,
    );

    if (isAvailable) {
      return candidate.product;
    }
  }

  return null;
}

async function isCatalogProductAvailableForMaterialList(
  product: PriceListProduct,
  byggmakkerAvailabilityCache: Map<string, boolean>,
) {
  // Start with Byggmakker as requested. Other suppliers pass through for now.
  if (!product.supplierName.toLowerCase().includes("byggmakker")) {
    return true;
  }

  const cacheKey = (product.ean ?? "").trim();

  if (!cacheKey) {
    return false;
  }

  const cached = byggmakkerAvailabilityCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const availability = await getByggmakkerAvailability(cacheKey);
  const isAvailable = Boolean(availability?.netAvailable);
  byggmakkerAvailabilityCache.set(cacheKey, isAvailable);
  return isAvailable;
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
