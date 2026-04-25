import { NextResponse } from "next/server";

import { isStripeBypassed } from "@/lib/env";
import {
  PROJECT_ROW_SELECT,
  buildProjectFromSearchParams,
  projectFromRow,
  type ProjectRow,
} from "@/lib/project-data";
import { createMaterialListPdf } from "@/lib/pdf/material-list-pdf";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";


type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const bypassStripe = isStripeBypassed();

  if (supabase && user) {
    const { data } = await supabase
      .from("projects")
      .select(PROJECT_ROW_SELECT)
      .eq("slug", slug)
      .eq("user_id", user.id)
      .maybeSingle();

    if (data) {
      const project = projectFromRow(data as ProjectRow);

      if (project.paymentStatus !== "paid" && !bypassStripe) {
        return NextResponse.json(
          { error: "Prosjektet må låses opp før PDF kan lastes ned." },
          { status: 403 },
        );
      }

      const fileName = `${slugify(project.title)}-materialliste.pdf`;
      const pdfBytes = await createMaterialListPdf(project);
      const pdfArrayBuffer = Uint8Array.from(pdfBytes).buffer;

      await supabase
        .from("projects")
        .update({
          pdf_file_name: fileName,
          pdf_generated_at: new Date().toISOString(),
          pdf_document_base64: null,
        })
        .eq("id", project.id)
        .eq("user_id", user.id);

      return new NextResponse(new Blob([pdfArrayBuffer], { type: "application/pdf" }), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const requestUrl = new URL(request.url);
  const draftProject = buildProjectFromSearchParams(
    slug,
    Object.fromEntries(requestUrl.searchParams.entries()),
  );

  if (!draftProject) {
    return NextResponse.json({ error: "Materialliste ikke funnet." }, { status: 404 });
  }

  const fileName = `${slugify(draftProject.title)}-materialliste.pdf`;
  const pdfBytes = await createMaterialListPdf(draftProject);
  const pdfArrayBuffer = Uint8Array.from(pdfBytes).buffer;

  return new NextResponse(new Blob([pdfArrayBuffer], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
