import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import type { MaterialItem, MaterialSection } from "@/lib/project-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

type AddItemPayload = {
  product?: unknown;
};

type ProductInput = {
  source: "catalog";
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

type ProjectRow = {
  material_list: MaterialSection[] | null;
};

const FALLBACK_SECTION_TITLE = "Valgte produkter fra nettbutikken";
const FALLBACK_SECTION_DESCRIPTION = "Produkter lagt til manuelt fra nettbutikken.";

export async function POST(request: Request, { params }: RouteContext) {
  const { slug } = await params;
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

  let payload: AddItemPayload;

  try {
    payload = (await request.json()) as AddItemPayload;
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON-payload." }, { status: 400 });
  }

  const product = parseProductInput(payload.product);

  if (!product) {
    return NextResponse.json({ error: "Ugyldig produktpayload." }, { status: 400 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("material_list")
    .eq("slug", slug)
    .eq("user_id", user.id)
    .maybeSingle();

  if (projectError) {
    return NextResponse.json({ error: "Kunne ikke hente materiallisten." }, { status: 500 });
  }

  if (!project) {
    return NextResponse.json({ error: "Fant ikke materiallisten." }, { status: 404 });
  }

  const existingSections = cloneMaterialSections(project.material_list);

  if (hasDuplicate(existingSections, product)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const nextSections = appendProduct(existingSections, product);
  const { error: updateError } = await supabase
    .from("projects")
    .update({ material_list: nextSections })
    .eq("slug", slug)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Kunne ikke oppdatere materiallisten." }, { status: 500 });
  }

  revalidatePath("/min-side/materiallister");
  revalidatePath(`/min-side/materiallister/${slug}`);
  revalidatePath(`/min-side/materiallister/${slug}/bestilling`);

  return NextResponse.json({ ok: true, duplicate: false, sections: nextSections.length });
}

function parseProductInput(value: unknown): ProductInput | null {
  if (!isRecord(value)) {
    return null;
  }

  const source = value.source;
  const productName = parseString(value.productName, 180);
  const quantity = parseString(value.quantity, 80);
  const comment = parseString(value.comment, 220) ?? "";
  const quantityReason = parseString(value.quantityReason, 280) ?? "";
  const nobbNumber = parseNobb(value.nobbNumber);
  const supplierName = parseString(value.supplierName, 120) ?? undefined;
  const unitPriceNok = parseNonNegativeInteger(value.unitPriceNok);
  const productUrl = parseHttpUrl(value.productUrl) || undefined;
  const imageUrl = parseHttpUrl(value.imageUrl) || undefined;
  const sectionTitle = parseString(value.sectionTitle, 120) ?? undefined;
  const category = parseString(value.category, 120) ?? undefined;

  if (source !== "catalog" || !productName || !quantity) {
    return null;
  }

  return {
    source,
    productName,
    quantity,
    comment,
    quantityReason,
    ...(nobbNumber ? { nobbNumber } : {}),
    ...(supplierName ? { supplierName } : {}),
    ...(unitPriceNok !== null ? { unitPriceNok } : {}),
    ...(productUrl ? { productUrl } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(sectionTitle ? { sectionTitle } : {}),
    ...(category ? { category } : {}),
  };
}

function cloneMaterialSections(value: unknown): MaterialSection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((rawSection) => {
    if (!isRecord(rawSection) || !Array.isArray(rawSection.items)) {
      return [];
    }

    const title = parseString(rawSection.title, 120) ?? FALLBACK_SECTION_TITLE;
    const description = parseString(rawSection.description, 300) ?? "";
    const items = rawSection.items.flatMap((rawItem) => {
      if (!isRecord(rawItem)) {
        return [];
      }

      const item = parseString(rawItem.item, 180);
      const quantity = parseString(rawItem.quantity, 80);
      const note = parseString(rawItem.note, 220) ?? "";

      if (!item || !quantity) {
        return [];
      }

      const quantityReason = parseString(rawItem.quantityReason, 280) ?? undefined;
      const nobb = parseNobb(rawItem.nobb) ?? undefined;
      const sourceUrl = parseHttpUrl(rawItem.sourceUrl) || undefined;
      const imageUrl = parseHttpUrl(rawItem.imageUrl) || undefined;
      const supplierName = parseString(rawItem.supplierName, 120) ?? undefined;
      const unitPriceNok = parseNonNegativeInteger(rawItem.unitPriceNok);

      const materialItem: MaterialItem = {
        item,
        quantity,
        note,
        ...(quantityReason ? { quantityReason } : {}),
        ...(nobb ? { nobb } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(supplierName ? { supplierName } : {}),
        ...(unitPriceNok !== null ? { unitPriceNok } : {}),
      };

      return [materialItem];
    });

    return [{ title, description, items }];
  });
}

function hasDuplicate(sections: MaterialSection[], product: ProductInput) {
  const normalizedNobb = parseNobb(product.nobbNumber);
  const normalizedUrl = normalizeUrl(product.productUrl);
  const normalizedName = normalizeText(product.productName);

  for (const section of sections) {
    for (const item of section.items) {
      if (normalizedNobb && parseNobb(item.nobb) === normalizedNobb) {
        return true;
      }

      if (normalizedUrl && normalizeUrl(item.sourceUrl) === normalizedUrl) {
        return true;
      }

      if (normalizeText(item.item) === normalizedName) {
        return true;
      }
    }
  }

  return false;
}

function appendProduct(sections: MaterialSection[], product: ProductInput) {
  const targetTitle = product.sectionTitle || product.category || FALLBACK_SECTION_TITLE;
  const nextItem: MaterialItem = {
    item: product.productName,
    quantity: product.quantity,
    note: product.comment,
    ...(product.quantityReason ? { quantityReason: product.quantityReason } : {}),
    ...(product.nobbNumber ? { nobb: product.nobbNumber } : {}),
    ...(product.productUrl ? { sourceUrl: product.productUrl } : {}),
    ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
    ...(product.supplierName ? { supplierName: product.supplierName } : {}),
    ...(typeof product.unitPriceNok === "number" ? { unitPriceNok: product.unitPriceNok } : {}),
  };
  const targetIndex = sections.findIndex((section) => normalizeText(section.title) === normalizeText(targetTitle));

  if (targetIndex === -1) {
    return [
      {
        title: targetTitle,
        description: FALLBACK_SECTION_DESCRIPTION,
        items: [nextItem],
      },
      ...sections,
    ];
  }

  return sections.map((section, index) => {
    if (index !== targetIndex) {
      return section;
    }

    return {
      ...section,
      items: [nextItem, ...section.items],
    };
  });
}

function parseString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function parseHttpUrl(value: unknown) {
  if (typeof value !== "string") {
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

function parseNonNegativeInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);

    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}

function parseNobb(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\D/g, "");
  return normalized.length >= 6 && normalized.length <= 10 ? normalized : null;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function normalizeUrl(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}