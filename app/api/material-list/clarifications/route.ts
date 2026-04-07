import { NextResponse } from "next/server";

import { generateClarificationQuestionsFromAttachments } from "@/lib/material-list-ai";
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
      budgetNok: toNumber(formData.get("budgetNok"), 350000),
      description: String(formData.get("description") || "").trim(),
    };

    const questions = await generateClarificationQuestionsFromAttachments(input, uploadedFiles);

    return NextResponse.json({ questions });
  } catch {
    return NextResponse.json({ questions: [] });
  }
}
