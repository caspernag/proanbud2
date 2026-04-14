import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import type { MaterialSection } from "@/lib/project-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

type UpdateMaterialListPayload = {
  materialSections?: unknown;
};

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

  let payload: UpdateMaterialListPayload;

  try {
    payload = (await request.json()) as UpdateMaterialListPayload;
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON-payload." }, { status: 400 });
  }

  const materialSections = parseMaterialSections(payload.materialSections);

  if (!materialSections) {
    return NextResponse.json({ error: "Ugyldig format for materialliste." }, { status: 400 });
  }

  const { error } = await supabase
    .from("projects")
    .update({ material_list: materialSections })
    .eq("slug", slug)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Kunne ikke lagre materiallisten." }, { status: 500 });
  }

  revalidatePath(`/min-side/materiallister/${slug}`);
  revalidatePath(`/min-side/materiallister/${slug}/sammenlign`);

  return NextResponse.json({ ok: true, sections: materialSections.length });
}

function parseMaterialSections(value: unknown): MaterialSection[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsedSections: MaterialSection[] = [];

  for (const rawSection of value) {
    if (!isRecord(rawSection)) {
      return null;
    }

    const title = parseString(rawSection.title, 120);
    const description = parseString(rawSection.description, 300) ?? "";
    const rawItems = rawSection.items;

    if (!title || !Array.isArray(rawItems)) {
      return null;
    }

    const items: MaterialSection["items"] = [];

    for (const rawItem of rawItems) {
      if (!isRecord(rawItem)) {
        return null;
      }

      const item = parseString(rawItem.item, 180);
      const quantity = parseString(rawItem.quantity, 80);
      const note = parseString(rawItem.note, 220) ?? "";
      const quantityReason = parseString(rawItem.quantityReason, 280);
      const sourceUrl = parseHttpUrl(rawItem.sourceUrl);
      const imageUrl = parseHttpUrl(rawItem.imageUrl);
      const supplierName = parseString(rawItem.supplierName, 120);
      const unitPriceNok = parseNonNegativeInteger(rawItem.unitPriceNok);

      if (!item || !quantity) {
        return null;
      }

      items.push({
        item,
        quantity,
        note,
        ...(quantityReason ? { quantityReason } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(supplierName ? { supplierName } : {}),
        ...(unitPriceNok !== null ? { unitPriceNok } : {}),
      });
    }

    parsedSections.push({
      title,
      description,
      items,
    });
  }

  return parsedSections;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
