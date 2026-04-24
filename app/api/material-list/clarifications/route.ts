import { NextResponse } from "next/server";

import { buildAttachmentContext } from "@/lib/material-list-ai";
import type { ProjectInput } from "@/lib/project-data";
import { normalizeProjectTitle, toNumber } from "@/lib/utils";

const MAX_ATTACHMENTS = 10;

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File && value.size > 0;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploadedFiles = formData.getAll("attachments").filter(isUploadedFile).slice(0, MAX_ATTACHMENTS);

    const input: ProjectInput = {
      title: normalizeProjectTitle(String(formData.get("title") || "Ny materialliste")),
      location: String(formData.get("location") || "Uspesifisert sted"),
      projectType: String(formData.get("projectType") || "Rehabilitering"),
      areaSqm: toNumber(formData.get("areaSqm"), 30),
      finishLevel: String(formData.get("finishLevel") || "Standard"),
      description: String(formData.get("description") || "").trim(),
    };

    const attachmentContext = await buildAttachmentContext(uploadedFiles);

    const documentContext = `
Prosjekttittel: ${input.title}
Sted: ${input.location}
Type: ${input.projectType}
Areal: ${input.areaSqm} kvm
Standard: ${input.finishLevel}
Beskrivelse: ${input.description || "Ingen beskrivelse lagt ved."}

Vedleggsdata:
${attachmentContext.userContentParts.map(p => p.type === 'text' ? p.text : '').join("\n\n")}
`.trim();

    return NextResponse.json({ documentContext });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ documentContext: "" });
  }
}
