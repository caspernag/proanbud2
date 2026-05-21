import { NextResponse } from "next/server";

import type { MaterialSection } from "@/lib/project-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ProjectRow = {
  slug: string;
  title: string | null;
  payment_status: "locked" | "paid" | null;
  material_list: MaterialSection[] | null;
  created_at: string;
};

export async function GET() {
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

  const { data, error } = await supabase
    .from("projects")
    .select("slug, title, payment_status, material_list, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    return NextResponse.json({ error: "Kunne ikke hente materiallister." }, { status: 500 });
  }

  const materialLists = ((data ?? []) as ProjectRow[]).map((row) => ({
    slug: row.slug,
    title: row.title?.trim() || "Uten navn",
    paymentStatus: row.payment_status === "paid" ? "paid" : "locked",
    lineCount: countMaterialLines(row.material_list),
    createdAt: row.created_at,
  }));

  return NextResponse.json({ materialLists });
}

function countMaterialLines(sections: MaterialSection[] | null) {
  if (!Array.isArray(sections)) {
    return 0;
  }

  return sections.reduce((total, section) => total + (Array.isArray(section.items) ? section.items.length : 0), 0);
}