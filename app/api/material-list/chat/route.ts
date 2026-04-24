import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

import { env, hasOpenAiEnv } from "@/lib/env";
import {
  buildAttachmentContext,
  buildProjectDocumentContext,
  generateClarificationQuestionsFromAttachments,
  type MaterialListClarificationQuestion,
} from "@/lib/material-list-ai";
import type { ProjectInput } from "@/lib/project-data";
import { normalizeProjectTitle, toNumber } from "@/lib/utils";

const MAX_ATTACHMENTS = 10;
const MAX_ROUNDS = 5;
const WORKFLOW_TIMEOUT_MS = 20_000;

const questionSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  helpText: z.string().min(1).max(280),
  placeholder: z.string().min(1).max(220),
  options: z.array(z.string().min(1).max(80)).max(6).optional(),
});

const chatTurnSchema = z.object({
  done: z.boolean(),
  question: questionSchema.nullable(),
});

type ChatTurnResponse = z.infer<typeof chatTurnSchema>;

type ClarificationAnswer = {
  questionId: string;
  title: string;
  answer: string;
};

type ChatSessionPayload = {
  mode: "next";
  project: ProjectInput;
  documentContext: string;
  askedQuestionIds: string[];
  answers: ClarificationAnswer[];
  fallbackQuestions?: MaterialListClarificationQuestion[];
};

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File && value.size > 0;
}

function sanitizeQuestion(question: MaterialListClarificationQuestion): MaterialListClarificationQuestion {
  const safeId = question.id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "question";
  const title = question.title.trim().slice(0, 160) || "Avklaring";
  const helpText = question.helpText.trim().slice(0, 280) || "Presiser punktet kort.";
  const placeholder = question.placeholder.trim().slice(0, 220) || "Skriv svar...";
  const options = question.options
    ?.map((entry) => entry.trim().slice(0, 80))
    .filter((entry) => entry.length > 0)
    .slice(0, 6);

  return {
    id: safeId,
    title,
    helpText,
    placeholder,
    ...(options && options.length > 0 ? { options } : {}),
  };
}

function toInputFromFormData(formData: FormData): ProjectInput {
  return {
    title: normalizeProjectTitle(String(formData.get("title") || "Ny materialliste")),
    location: String(formData.get("location") || "Uspesifisert sted"),
    projectType: String(formData.get("projectType") || "Rehabilitering"),
    areaSqm: toNumber(formData.get("areaSqm"), 30),
    finishLevel: String(formData.get("finishLevel") || "Standard"),
    description: String(formData.get("description") || "").trim(),
  };
}

function toMessagesDocument(answers: ClarificationAnswer[]) {
  if (answers.length === 0) {
    return "Ingen brukeravklaringer enda.";
  }

  return answers
    .map((entry, index) => `${index + 1}. ${entry.title}\nSvar: ${entry.answer}`)
    .join("\n\n");
}

function buildLocalFallbackQuestions(project: ProjectInput, documentContext: string) {
  const questions: MaterialListClarificationQuestion[] = [];
  const description = project.description.trim();
  const contextLower = documentContext.toLowerCase();
  const mentionsBathroom = /bad|våtrom|v?trom/.test(contextLower);
  const mentionsKitchen = /kjøkken|kjokken/.test(contextLower);

  questions.push({
    id: "arbeidsomfang_prioritet",
    title: "Hva er viktigst i første byggetrinn?",
    helpText: "Hjelper oss prioritere riktige materialer og mengder tidlig.",
    placeholder: "F.eks. bad først, deretter kjøkken og stue.",
  });

  if (project.areaSqm >= 50) {
    questions.push({
      id: "leveranse_etapper",
      title: "Skal prosjektet deles i etapper eller leveres samlet?",
      helpText: "Påvirker både mengdeoppsett og hvordan listene struktureres.",
      placeholder: "F.eks. etappevis per rom.",
      options: ["Samlet leveranse", "Etappevis per rom", "Usikker ennå"],
    });
  }

  if (mentionsBathroom) {
    questions.push({
      id: "bad_membran_losning",
      title: "Hvilken løsning ønskes for våtrom?",
      helpText: "Dette styrer viktige materialvalg i bad/våtrom.",
      placeholder: "F.eks. smøremembran med plater og flis.",
      options: ["Smøremembran", "Membranplater", "Usikker"],
    });
  }

  if (mentionsKitchen) {
    questions.push({
      id: "kjokken_niva",
      title: "Hvilket nivå ønskes for kjøkkenløsningen?",
      helpText: "Påvirker kvalitet og omfang for tilhørende materialer.",
      placeholder: "F.eks. standard kjøkken med slitesterke overflater.",
      options: ["Basis", "Standard", "Premium"],
    });
  }

  if (description.length < 80) {
    questions.push({
      id: "kort_beskrivelse_utdyping",
      title: "Kan du utdype prosjektbeskrivelsen med 2-3 konkrete punkter?",
      helpText: "Gir mer presis materialliste når grunnbeskrivelsen er kort.",
      placeholder: "F.eks. rom, ønskede materialer, og krav til kvalitet.",
    });
  }

  questions.push({
    id: "materialvalg_preferanser",
    title: "Har du spesifikke materialpreferanser vi må ta hensyn til?",
    helpText: "Sikrer at listen matcher ønsket kvalitet og utførelse.",
    placeholder: "F.eks. gips vs fibergips, parkett-type, isolasjonsnivå.",
  });

  const unique = new Map<string, MaterialListClarificationQuestion>();
  for (const question of questions) {
    if (!unique.has(question.id)) {
      unique.set(question.id, sanitizeQuestion(question));
    }
  }

  return Array.from(unique.values()).slice(0, MAX_ROUNDS);
}

async function requestNextChatTurn(params: {
  project: ProjectInput;
  documentContext: string;
  askedQuestionIds: string[];
  answers: ClarificationAnswer[];
}) {
  if (!hasOpenAiEnv()) {
    return null;
  }

  const openai = new OpenAI({ apiKey: env.openAiApiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKFLOW_TIMEOUT_MS);

  try {
    const response = await openai.responses.create(
      {
        model: "gpt-5-mini",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "Du er en rask og presis avklaringsagent for materiallister. Still ett og ett spørsmål, kun det mest verdifulle neste spørsmålet. Når grunnlaget er godt nok, sett done=true og question=null.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(
                  {
                    max_rounds: MAX_ROUNDS,
                    asked_question_ids: params.askedQuestionIds,
                    project: params.project,
                    project_document_context: params.documentContext,
                    user_clarifications_so_far: toMessagesDocument(params.answers),
                    response_requirements: {
                      done: "boolean",
                      question: {
                        id: "string",
                        title: "Kort og konkret oppfolgingssporsmal pa norsk",
                        helpText: "Hvorfor dette trengs, kort",
                        placeholder: "Forslag til kort svar",
                        options: ["valgfri liste med opptil 6 korte forslag"],
                      },
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "material_list_chat_turn",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["done", "question"],
              properties: {
                done: { type: "boolean" },
                question: {
                  anyOf: [
                    {
                      type: "null",
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["id", "title", "helpText", "placeholder"],
                      properties: {
                        id: { type: "string", minLength: 1, maxLength: 80 },
                        title: { type: "string", minLength: 1, maxLength: 160 },
                        helpText: { type: "string", minLength: 1, maxLength: 280 },
                        placeholder: { type: "string", minLength: 1, maxLength: 220 },
                        options: {
                          type: "array",
                          maxItems: 6,
                          items: { type: "string", minLength: 1, maxLength: 80 },
                        },
                      },
                    },
                  ],
                },
              },
            },
            strict: true,
          },
        },
      },
      { signal: controller.signal },
    );

    const output = response.output_text?.trim() || "";
    if (!output) {
      return null;
    }

    const parsed = chatTurnSchema.safeParse(JSON.parse(output) as unknown);
    if (!parsed.success) {
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const formData = await request.formData();
      const uploadedFiles = formData.getAll("attachments").filter(isUploadedFile).slice(0, MAX_ATTACHMENTS);
      const project = toInputFromFormData(formData);
      const attachmentContext = await buildAttachmentContext(uploadedFiles);
      const documentContext = buildProjectDocumentContext(project, attachmentContext);
      const generatedFallbackQuestions = (await generateClarificationQuestionsFromAttachments(project, uploadedFiles)).map(sanitizeQuestion);
      const fallbackQuestions =
        generatedFallbackQuestions.length > 0
          ? generatedFallbackQuestions
          : buildLocalFallbackQuestions(project, documentContext);
      const firstTurn = await requestNextChatTurn({
        project,
        documentContext,
        askedQuestionIds: [],
        answers: [],
      });
      const firstQuestionFromChat = firstTurn?.question ? sanitizeQuestion(firstTurn.question) : null;
      const firstQuestion = firstQuestionFromChat ?? fallbackQuestions[0] ?? null;
      const askedQuestionIds = firstQuestion ? [firstQuestion.id] : [];
      return NextResponse.json({
        mode: "init",
        project,
        documentContext,
        fallbackQuestions,
        askedQuestionIds,
        done: firstQuestion ? false : true,
        question: firstQuestion,
      });
    }

    const payload = (await request.json()) as ChatSessionPayload;
    const askedQuestionIds = Array.isArray(payload.askedQuestionIds) ? payload.askedQuestionIds : [];
    const answers = Array.isArray(payload.answers)
      ? payload.answers
          .map((entry) => ({
            questionId: String(entry.questionId || "").trim(),
            title: String(entry.title || "").trim(),
            answer: String(entry.answer || "").trim(),
          }))
          .filter((entry) => entry.questionId && entry.title && entry.answer)
      : [];
    const fallbackQuestions = Array.isArray(payload.fallbackQuestions)
      ? payload.fallbackQuestions.map(sanitizeQuestion)
      : [];
    const nextTurn: ChatTurnResponse | null =
      askedQuestionIds.length >= MAX_ROUNDS
        ? { done: true, question: null }
        : await requestNextChatTurn({
            project: payload.project,
            documentContext: payload.documentContext,
            askedQuestionIds,
            answers,
          });

    const nextQuestionFromChat = nextTurn?.question ? sanitizeQuestion(nextTurn.question) : null;
    const nextFallbackQuestion = fallbackQuestions.find((entry) => !askedQuestionIds.includes(entry.id)) ?? null;
    const nextQuestion = nextQuestionFromChat ?? nextFallbackQuestion;
    const nextAskedIds = nextQuestion && !askedQuestionIds.includes(nextQuestion.id)
      ? [...askedQuestionIds, nextQuestion.id]
      : askedQuestionIds;

    return NextResponse.json({
      mode: "next",
      fallbackQuestions,
      askedQuestionIds: nextAskedIds,
      done: nextQuestion ? false : true,
      question: nextQuestion,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        done: true,
        question: null,
      },
      { status: 200 },
    );
  }
}
