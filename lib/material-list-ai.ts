import { Buffer } from "node:buffer";

import mammoth from "mammoth";
import OpenAI from "openai";
import { z } from "zod";

import { env, hasOpenAiEnv } from "@/lib/env";
import { getPriceListProducts, type PriceListProduct } from "@/lib/price-lists";
import type { MaterialSection, ProjectInput } from "@/lib/project-data";

const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_UPLOAD_BYTES = 18 * 1024 * 1024;
const MAX_TEXT_ATTACHMENTS = 8;
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_TEXT_CHARS_PER_FILE = 12_000;
const MAX_TEXT_CHARS_TOTAL = 48_000;
const MAX_IMAGE_BYTES = 4_000_000;
const OPENAI_WORKFLOW_TIMEOUT_MS = resolveWorkflowTimeoutMs();
const OPENAI_PROMPT_MAX_ATTEMPTS = 2;
const OPENAI_RETRY_DELAY_DEFAULT_MS = 2_000;
const OPENAI_RETRY_DELAY_MAX_MS = 12_000;
const AI_AGENT_LOG_PREFIX = "[ai-agent]";
type AiAgentContext = "material-list" | "clarifications";

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "xml",
  "yaml",
  "yml",
  "html",
  "htm",
]);

const DOCUMENT_EXTENSIONS = new Set(["pdf", "docx"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "avif", "gif", "heic"]);

type AttachmentSummary = {
  name: string;
  type: string;
  sizeKb: number;
};

type PromptInputPart =
  | {
    type: "text";
    text: string;
  };

type PreparedAttachmentContext = {
  files: File[];
  userContentParts: PromptInputPart[];
};

const modelResponseSchema = z.object({
  materialSections: z.array(
    z.object({
      title: z.string().min(1).max(120),
      description: z.string().min(1).max(240),
      items: z.array(
        z.object({
          item: z.string().min(1).max(200),
          quantity: z.string().min(1).max(80),
          quantityReason: z.string().min(1).max(280).optional(),
          note: z.string().min(1).max(280),
          nobb: z.string().min(6).max(24).optional(),
        }),
      ).min(1).max(14),
    }),
  ).min(1).max(8),
});

const clarificationResponseSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string().min(1).max(80),
      title: z.string().min(1).max(160),
      helpText: z.string().min(1).max(280),
      placeholder: z.string().min(1).max(220),
      options: z.array(z.string().min(1).max(80)).max(6).optional(),
    }),
  ),
});

export type MaterialListClarificationQuestion = z.infer<typeof clarificationResponseSchema>["questions"][number];

export function summarizeAttachments(files: File[]) {
  return files
    .filter((file) => file.size > 0)
    .slice(0, MAX_ATTACHMENTS)
    .map<AttachmentSummary>((file) => ({
      name: file.name,
      type: file.type || "ukjent",
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
    }));
}

export async function generateMaterialSectionsFromAttachments(input: ProjectInput, files: File[]) {
  if (!hasOpenAiEnv()) {
    return null;
  }

  const priceListProducts = await getPriceListProducts();
  const attachmentContext = await buildAttachmentContext(files);
  const modelOutput = await requestMaterialListFromOpenAi(input, attachmentContext);

  if (!modelOutput) {
    return null;
  }

  const sanitized = sanitizeMaterialSections(modelOutput.materialSections);

  if (!sanitized) {
    return null;
  }

  return enforcePriceListItemsWithNobb(sanitized, priceListProducts);
}

export async function generateClarificationQuestionsFromAttachments(input: ProjectInput, files: File[]) {
  if (!hasOpenAiEnv()) {
    return [] as MaterialListClarificationQuestion[];
  }

  const attachmentContext = await buildAttachmentContext(files);
  const modelOutput = await requestClarificationsFromOpenAi(input, attachmentContext);

  if (!modelOutput) {
    return [] as MaterialListClarificationQuestion[];
  }

  return sanitizeClarificationQuestions(modelOutput.questions);
}

async function buildAttachmentContext(files: File[]): Promise<PreparedAttachmentContext> {
  const selected = files.filter((file) => file.size > 0).slice(0, MAX_ATTACHMENTS);

  const result: PreparedAttachmentContext = {
    files: [],
    userContentParts: [],
  };

  let totalBytes = 0;
  let textAttachments = 0;
  let imageAttachments = 0;
  let textChars = 0;

  for (const file of selected) {
    if (totalBytes + file.size > MAX_TOTAL_UPLOAD_BYTES) {
      continue;
    }

    totalBytes += file.size;
    result.files.push(file);
  }

  for (const file of result.files) {
    if (imageAttachments < MAX_IMAGE_ATTACHMENTS && isImageFile(file) && file.size <= MAX_IMAGE_BYTES) {
      result.userContentParts.push({
        type: "text",
        text: `Bildevedlegg: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB). Beskriv materialbehov ut fra prosjektdata og vedleggsnavn.`,
      });
      imageAttachments += 1;
      continue;
    }

    if (textAttachments >= MAX_TEXT_ATTACHMENTS || textChars >= MAX_TEXT_CHARS_TOTAL) {
      continue;
    }

    if (!isTextLikeFile(file) && !isSupportedDocumentFile(file)) {
      continue;
    }

    const extracted = await extractTextFromAttachment(file);
    const availableBudget = MAX_TEXT_CHARS_TOTAL - textChars;
    const trimmed = extracted.trim().slice(0, Math.min(MAX_TEXT_CHARS_PER_FILE, availableBudget));

    if (trimmed.length === 0) {
      continue;
    }

    result.userContentParts.push({
      type: "text",
      text: `Vedlegg: ${file.name}\n\n${trimmed}`,
    });
    textChars += trimmed.length;
    textAttachments += 1;
  }

  return result;
}

async function requestMaterialListFromOpenAi(
  input: ProjectInput,
  attachmentContext: PreparedAttachmentContext,
) {
  const openai = new OpenAI({ apiKey: env.openAiApiKey });
  const promptId = getConfiguredPromptIdForContext("material-list");

  logAiAgentStatus(
    "material-list",
    `start prompt_configured=${Boolean(promptId)}`,
  );

  const workflowAbortController = new AbortController();
  const workflowTimeout = setTimeout(() => workflowAbortController.abort(), OPENAI_WORKFLOW_TIMEOUT_MS);

  try {
    const workflowContent = await requestFromPromptTemplate(
      openai,
      buildMaterialListPromptInput(input, attachmentContext),
      workflowAbortController.signal,
      "material-list",
      promptId,
    );

    if (!workflowContent) {
      return null;
    }

    const parsedFromWorkflow = parseModelResponse(workflowContent);

    if (!parsedFromWorkflow) {
      logAiAgentStatus("material-list", `prompt_output_invalid_json=true shape=${describePromptResponseShape(workflowContent)}`);
      return null;
    }

    logAiAgentStatus("material-list", "used_new_ai_agent=true source=prompt_template model=prompt_default attempt=1");
    return parsedFromWorkflow;
  } finally {
    clearTimeout(workflowTimeout);
  }

  return null;
}

async function requestClarificationsFromOpenAi(input: ProjectInput, attachmentContext: PreparedAttachmentContext) {
  const openai = new OpenAI({ apiKey: env.openAiApiKey });
  const promptId = getConfiguredPromptIdForContext("clarifications");

  logAiAgentStatus(
    "clarifications",
    `start prompt_configured=${Boolean(promptId)}`,
  );

  const workflowAbortController = new AbortController();
  const workflowTimeout = setTimeout(() => workflowAbortController.abort(), OPENAI_WORKFLOW_TIMEOUT_MS);

  try {
    const workflowContent = await requestFromPromptTemplate(
      openai,
      buildClarificationPromptInput(input, attachmentContext),
      workflowAbortController.signal,
      "clarifications",
      promptId,
    );

    if (!workflowContent) {
      return null;
    }

    const parsedFromWorkflow = parseClarificationResponse(workflowContent);

    if (!parsedFromWorkflow) {
      logAiAgentStatus("clarifications", `prompt_output_invalid_json=true shape=${describePromptResponseShape(workflowContent)}`);
      return null;
    }

    logAiAgentStatus("clarifications", "used_new_ai_agent=true source=prompt_template model=prompt_default attempt=1");
    return parsedFromWorkflow;
  } finally {
    clearTimeout(workflowTimeout);
  }

  return null;
}

function parseModelResponse(content: string) {
  const parsed = parsePromptJson(content);

  if (!parsed) {
    return null;
  }

  const candidate = normalizeMaterialListResponseShape(parsed);
  const validated = modelResponseSchema.safeParse(candidate);

  if (validated.success) {
    return validated.data;
  }

  const fallbackSections = coerceMaterialSections(candidate);

  if (fallbackSections.length === 0) {
    return null;
  }

  return {
    materialSections: fallbackSections,
  };
}

function parseClarificationResponse(content: string) {
  const parsed = parsePromptJson(content);

  if (!parsed) {
    return null;
  }

  const candidate = normalizeClarificationResponseShape(parsed);
  const validated = clarificationResponseSchema.safeParse(candidate);

  if (validated.success) {
    return validated.data;
  }

  const fallbackQuestions = coerceClarificationQuestions(candidate);

  return {
    questions: fallbackQuestions,
  };
}

function parsePromptJson(content: string) {
  const normalized = content.trim();

  if (!normalized) {
    return null;
  }

  const direct = parseJsonWithNestedStringFallback(normalized);

  if (direct !== null) {
    return direct;
  }

  const jsonText = extractJsonObjectText(normalized);

  if (!jsonText) {
    return null;
  }

  const extracted = parseJsonWithNestedStringFallback(jsonText);

  if (extracted === null) {
    return null;
  }

  return extracted;
}

function parseJsonWithNestedStringFallback(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (typeof parsed === "string") {
      const nested = parsed.trim();

      if (nested.startsWith("{") || nested.startsWith("[")) {
        try {
          return JSON.parse(nested) as unknown;
        } catch {
          return null;
        }
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

function normalizeMaterialListResponseShape(parsed: unknown) {
  if (Array.isArray(parsed)) {
    return {
      materialSections: parsed,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  const source = parsed as Record<string, unknown>;

  if (Array.isArray(source.materialSections)) {
    return source;
  }

  if (Array.isArray(source.sections)) {
    return {
      materialSections: source.sections,
    };
  }

  const wrapped = pickWrappedObject(source);

  if (wrapped && Array.isArray((wrapped as Record<string, unknown>).materialSections)) {
    return wrapped;
  }

  if (wrapped && Array.isArray((wrapped as Record<string, unknown>).sections)) {
    return {
      materialSections: (wrapped as Record<string, unknown>).sections,
    };
  }

  return source;
}

function normalizeClarificationResponseShape(parsed: unknown) {
  if (Array.isArray(parsed)) {
    return {
      questions: parsed,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  const source = parsed as Record<string, unknown>;

  if (Array.isArray(source.questions)) {
    return source;
  }

  if (Array.isArray(source.clarifications)) {
    return {
      questions: source.clarifications,
    };
  }

  const wrapped = pickWrappedObject(source);

  if (wrapped && Array.isArray((wrapped as Record<string, unknown>).questions)) {
    return wrapped;
  }

  if (wrapped && Array.isArray((wrapped as Record<string, unknown>).clarifications)) {
    return {
      questions: (wrapped as Record<string, unknown>).clarifications,
    };
  }

  return source;
}

function coerceClarificationQuestions(candidate: unknown): MaterialListClarificationQuestion[] {
  if (!candidate || typeof candidate !== "object") {
    return [];
  }

  const source = candidate as Record<string, unknown>;
  const rawQuestions = Array.isArray(source.questions) ? source.questions : [];
  const normalized: MaterialListClarificationQuestion[] = [];

  for (const [index, rawQuestion] of rawQuestions.entries()) {
    if (!rawQuestion || typeof rawQuestion !== "object") {
      continue;
    }

    const question = rawQuestion as Record<string, unknown>;
    const id = toNormalizedQuestionId(question.id, index);
    const title = toNonEmptyText(question.title, 160, "Avklaring");
    const helpText = toNonEmptyText(
      question.helpText ?? question.help_text ?? question.help ?? question.description,
      280,
      "Presiser dette punktet.",
    );
    const placeholder = toNonEmptyText(
      question.placeholder ?? question.inputPlaceholder ?? question.input_placeholder,
      220,
      "Skriv svar...",
    );
    const options = toQuestionOptions(question.options);

    normalized.push({
      id,
      title,
      helpText,
      placeholder,
      ...(options.length > 0 ? { options } : {}),
    });
  }

  return normalized;
}

function toNormalizedQuestionId(value: unknown, index: number) {
  const base = typeof value === "string" ? value : `question_${index + 1}`;
  const normalized = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return (normalized.length > 0 ? normalized : `question_${index + 1}`).slice(0, 80);
}

function toNonEmptyText(value: unknown, maxLength: number, fallback: string) {
  const raw = typeof value === "string" ? value.trim() : "";

  if (raw.length === 0) {
    return fallback;
  }

  return raw.slice(0, maxLength);
}

function toQuestionOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim().slice(0, 80) : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 6);
}

function pickWrappedObject(source: Record<string, unknown>) {
  const wrapperKeys = ["output", "result", "data", "payload"];

  for (const key of wrapperKeys) {
    const candidate = source[key];

    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildMaterialListPromptInput(
  input: ProjectInput,
  attachmentContext: PreparedAttachmentContext,
) {
  return JSON.stringify(
    {
      request_type: "material_list",
      required_response_format: "json_object",
      required_output_schema: {
        materialSections: [
          {
            title: "string",
            description: "string",
            items: [
              {
                item: "string",
                quantity: "string",
                quantityReason: "string",
                note: "string",
                nobb: "string",
              },
            ],
          },
        ],
      },
      project: input,
      attachments: summarizeAttachments(attachmentContext.files),
      attachment_content: flattenUserContentForResponses(attachmentContext.userContentParts),
    },
    null,
    2,
  );
}

function buildClarificationPromptInput(input: ProjectInput, attachmentContext: PreparedAttachmentContext) {
  return JSON.stringify(
    {
      request_type: "clarifications",
      required_response_format: "json_object",
      required_output_schema: {
        questions: [
          {
            id: "string",
            title: "string",
            helpText: "string",
            placeholder: "string",
            options: ["string"],
          },
        ],
      },
      project: input,
      attachments: summarizeAttachments(attachmentContext.files),
      attachment_content: flattenUserContentForResponses(attachmentContext.userContentParts),
    },
    null,
    2,
  );
}

function sanitizeClarificationQuestions(questions: MaterialListClarificationQuestion[]) {
  const uniqueById = new Map<string, MaterialListClarificationQuestion>();

  for (const question of questions) {
    const normalizedId = question.id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    const safeId = normalizedId.length > 0 ? normalizedId.slice(0, 80) : `question_${uniqueById.size + 1}`;

    if (uniqueById.has(safeId)) {
      continue;
    }

    const title = question.title.trim().slice(0, 160);
    const helpText = question.helpText.trim().slice(0, 280);
    const placeholder = question.placeholder.trim().slice(0, 220);

    if (!title || !helpText || !placeholder) {
      continue;
    }

    const options = question.options
      ?.map((option) => option.trim().slice(0, 80))
      .filter((option) => option.length > 0)
      .slice(0, 6);

    uniqueById.set(safeId, {
      id: safeId,
      title,
      helpText,
      placeholder,
      ...(options && options.length > 0 ? { options } : {}),
    });
  }

  return Array.from(uniqueById.values());
}

function sanitizeMaterialSections(sections: Array<z.infer<typeof modelResponseSchema>["materialSections"][number]>) {
  const normalized = sections
    .map((section) => ({
      title: section.title.trim().slice(0, 120),
      description: section.description.trim().slice(0, 240),
      items: section.items
        .map((item) => ({
          item: item.item.trim().slice(0, 200),
          quantity: ensureQuantityHasUnit(item.quantity),
          quantityReason: normalizeQuantityReason(item.quantityReason, item.note, item.quantity),
          note: item.note.trim().slice(0, 280),
          nobb: normalizeNobb(item.nobb),
        }))
        .filter((item) => item.item.length > 0),
    }))
    .filter((section) => section.items.length > 0);

  return normalized.length > 0 ? (normalized as MaterialSection[]) : null;
}

function enforcePriceListItemsWithNobb(sections: MaterialSection[], products: PriceListProduct[]) {
  if (products.length === 0) {
    return sections;
  }

  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const match = findBestPriceListMatch(item, section.title, products) ?? pickFallbackProduct(section.title, products);

      if (!match) {
        return item;
      }

      return {
        ...item,
        item: match.productName,
        quantityReason: normalizeQuantityReason(item.quantityReason, item.note, item.quantity, match.quantityReason),
        nobb: item.nobb ?? match.nobbNumber,
      };
    }),
  }));
}

function normalizeQuantityReason(
  quantityReason: string | undefined,
  note: string,
  quantity: string,
  fallbackReason?: string,
) {
  const normalizedReason = (quantityReason ?? "").trim().slice(0, 280);

  if (normalizedReason.length > 0) {
    return normalizedReason;
  }

  const normalizedFallback = (fallbackReason ?? "").trim().slice(0, 280);

  if (normalizedFallback.length > 0) {
    return normalizedFallback;
  }

  const normalizedNote = note.trim().slice(0, 220);

  if (normalizedNote.length > 0) {
    return `Mengde ${quantity} er estimert fra prosjektgrunnlag og forutsetning: ${normalizedNote}`.slice(0, 280);
  }

  return `Mengde ${quantity} er estimert ut fra prosjektets areal, standard og forventet svinn.`.slice(0, 280);
}

function ensureQuantityHasUnit(quantity: string) {
  const trimmed = quantity.trim();

  if (trimmed.length === 0) {
    return "1 stk";
  }

  if (/\d/.test(trimmed) && /[a-zA-Z]/.test(trimmed)) {
    return trimmed.slice(0, 80);
  }

  if (/^\d+(?:[.,]\d+)?$/.test(trimmed)) {
    return `${trimmed} stk`;
  }

  return trimmed.slice(0, 80);
}

function isImageFile(file: File) {
  if (file.type.startsWith("image/")) {
    return true;
  }

  const extension = getFileExtension(file.name);
  return IMAGE_EXTENSIONS.has(extension);
}

function isTextLikeFile(file: File) {
  if (file.type.startsWith("text/")) {
    return true;
  }

  const extension = getFileExtension(file.name);
  return TEXT_EXTENSIONS.has(extension);
}

function isSupportedDocumentFile(file: File) {
  const extension = getFileExtension(file.name);
  return DOCUMENT_EXTENSIONS.has(extension) || file.type === "application/pdf";
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

async function extractTextFromAttachment(file: File) {
  const extension = getFileExtension(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());

  if (extension === "pdf" || file.type === "application/pdf") {
    return extractPdfTextSafely(bytes);
  }

  if (extension === "docx") {
    const parsed = await mammoth.extractRawText({ buffer: bytes });
    return parsed.value || "";
  }

  return decodeTextBuffer(bytes);
}

function decodeTextBuffer(bytes: Buffer) {
  const utf8 = bytes.toString("utf8");

  if (utf8.includes("\uFFFD")) {
    return bytes.toString("latin1");
  }

  return utf8;
}

function stripCodeFence(content: string) {
  const fenced = content.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i);
  return fenced ? fenced[1] : content;
}

function extractJsonObjectText(content: string) {
  const normalized = stripCodeFence(content.trim());

  if (!normalized) {
    return "";
  }

  const directParse = tryParseJsonObject(normalized);

  if (directParse) {
    return normalized;
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return "";
  }

  const sliced = normalized.slice(firstBrace, lastBrace + 1).trim();
  return tryParseJsonObject(sliced) ? sliced : "";
}

function tryParseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function findBestPriceListMatch(item: { item: string; note: string; nobb?: string }, sectionTitle: string, products: PriceListProduct[]) {
  const nobbFromItem = extractNobb(item.item);
  const nobbFromNote = extractNobb(item.note);
  const directNobb = normalizeNobb(item.nobb) || nobbFromItem || nobbFromNote;

  if (directNobb) {
    const direct = products.find((product) => product.nobbNumber === directNobb);

    if (direct) {
      return direct;
    }
  }

  const queryTokens = tokenizeForMatch(item.item);
  if (queryTokens.length === 0) {
    return null;
  }

  const sectionTokens = tokenizeForMatch(sectionTitle);
  let best: PriceListProduct | null = null;
  let bestScore = 0;

  for (const product of products) {
    const nameTokens = tokenizeForMatch(product.productName);
    const categoryTokens = tokenizeForMatch(`${product.sectionTitle} ${product.category}`);

    if (nameTokens.length === 0) {
      continue;
    }

    const overlap = queryTokens.filter((token) => nameTokens.includes(token)).length;
    const sectionOverlap = sectionTokens.filter((token) => categoryTokens.includes(token)).length;
    const score = overlap / Math.max(queryTokens.length, nameTokens.length) + sectionOverlap * 0.06;

    if (score > bestScore) {
      bestScore = score;
      best = product;
    }

    if (product.productName.toLowerCase() === item.item.toLowerCase()) {
      return product;
    }
  }

  return bestScore >= 0.16 ? best : null;
}

function pickFallbackProduct(sectionTitle: string, products: PriceListProduct[]) {
  const sectionNeedle = sectionTitle.trim().toLowerCase();

  if (sectionNeedle.length > 0) {
    const bySection = products.find((product) =>
      product.sectionTitle.toLowerCase().includes(sectionNeedle) || sectionNeedle.includes(product.sectionTitle.toLowerCase()),
    );

    if (bySection) {
      return bySection;
    }
  }

  return products[0] ?? null;
}

function extractNobb(value: string) {
  const match = value.match(/\b(\d{6,10})\b/);
  return match ? match[1] : "";
}

function normalizeNobb(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\D/g, "");

  if (normalized.length < 6 || normalized.length > 10) {
    return undefined;
  }

  return normalized;
}

function tokenizeForMatch(value: string) {
  return value
    .toLocaleLowerCase("nb-NO")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9æøå]+/)
    .filter((token) => token.length > 1);
}

function coerceMaterialSections(candidate: unknown): z.infer<typeof modelResponseSchema>["materialSections"] {
  if (!candidate || typeof candidate !== "object") {
    return [];
  }

  const source = candidate as Record<string, unknown>;
  const rawSections = Array.isArray(source.materialSections)
    ? source.materialSections
    : Array.isArray(source.sections)
      ? source.sections
      : [];
  const normalized: z.infer<typeof modelResponseSchema>["materialSections"] = [];

  for (const [sectionIndex, rawSection] of rawSections.entries()) {
    if (!rawSection || typeof rawSection !== "object") {
      continue;
    }

    const section = rawSection as Record<string, unknown>;
    const sectionTitle = toNonEmptyText(
      section.title ?? section.name ?? section.heading,
      120,
      `Seksjon ${sectionIndex + 1}`,
    );
    const sectionDescription = toNonEmptyText(
      section.description ?? section.summary ?? section.note,
      240,
      "Materialbehov fra prosjektgrunnlag.",
    );
    const rawItems = Array.isArray(section.items)
      ? section.items
      : Array.isArray(section.lines)
        ? section.lines
        : Array.isArray(section.products)
          ? section.products
          : [];
    const normalizedItems: z.infer<typeof modelResponseSchema>["materialSections"][number]["items"] = [];

    for (const [itemIndex, rawItem] of rawItems.entries()) {
      if (!rawItem || typeof rawItem !== "object") {
        continue;
      }

      const item = rawItem as Record<string, unknown>;
      const itemLabel = toNonEmptyText(
        item.item ?? item.name ?? item.title ?? item.product,
        200,
        `Produkt ${itemIndex + 1}`,
      );
      const quantityValue = toNonEmptyText(
        item.quantity ?? item.qty ?? item.amount,
        80,
        "1 stk",
      );
      const noteValue = toNonEmptyText(
        item.note ?? item.description ?? item.comment,
        280,
        "Basert pa prosjektbeskrivelse og vedlegg.",
      );
      const quantityReason = toOptionalText(item.quantityReason ?? item.quantity_reason ?? item.reason, 280);
      const nobb = toOptionalText(item.nobb ?? item.nobbNumber ?? item.nobb_number, 24);

      normalizedItems.push({
        item: itemLabel,
        quantity: quantityValue,
        note: noteValue,
        ...(quantityReason ? { quantityReason } : {}),
        ...(nobb ? { nobb } : {}),
      });
    }

    if (normalizedItems.length === 0) {
      continue;
    }

    normalized.push({
      title: sectionTitle,
      description: sectionDescription,
      items: normalizedItems,
    });
  }

  return normalized;
}

function toOptionalText(value: unknown, maxLength: number) {
  if (typeof value === "string") {
    const normalized = value.trim();

    if (normalized.length > 0) {
      return normalized.slice(0, maxLength);
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).slice(0, maxLength);
  }

  return "";
}

async function requestFromPromptTemplate(
  openai: OpenAI,
  promptInput: string,
  signal: AbortSignal,
  context: AiAgentContext,
  promptId: string,
) {
  if (!promptId) {
    logAiAgentStatus(context, "prompt_id_missing=true");
    return null;
  }

  if (!isPromptTemplateId(promptId)) {
    logAiAgentStatus(context, `prompt_id_invalid=true id=${promptId} expected_id_prefix=pmpt_`);
    return null;
  }

  for (let attempt = 1; attempt <= OPENAI_PROMPT_MAX_ATTEMPTS; attempt += 1) {
    try {
      logAiAgentStatus(
        context,
        `prompt_attempt=true model=prompt_default attempt=${attempt} prompt_id=${promptId} prompt_version=latest`,
      );
      logAiAgentStatus(context, `prompt_input_chars=${promptInput.length} attempt=${attempt}`);

      const response = await openai.responses.create(
        {
          // Intentionally omit prompt.version so OpenAI resolves to latest published prompt version.
          prompt: {
            id: promptId,
          },
          input: promptInput,
          text: {
            format: {
              type: "json_object",
            },
          },
        },
        { signal },
      );

      const content = extractTextFromPromptResponse(response);

      if (!content) {
        logAiAgentStatus(context, `prompt_output_empty=true model=prompt_default attempt=${attempt}`);
      }

      return content && content.length > 0 ? content : null;
    } catch (error) {
      if (signal.aborted || isAbortLikeError(error)) {
        logAiAgentStatus(
          context,
          `prompt_request_aborted=true timeout_ms=${OPENAI_WORKFLOW_TIMEOUT_MS}`,
        );
        return null;
      }

      if (error instanceof OpenAI.APIError) {
        const isRateLimited = error.status === 429 || error.code === "rate_limit_exceeded";
        const canRetry = isRateLimited && attempt < OPENAI_PROMPT_MAX_ATTEMPTS;

        logAiAgentStatus(
          context,
          `prompt_api_error=true status=${error.status ?? "unknown"} code=${error.code ?? "unknown"} param=${error.param ?? "unknown"} attempt=${attempt} message=${sanitizeLogMessage(error.message)}`,
        );

        if (canRetry) {
          const delayMs = resolveRateLimitDelayMs(error.message);
          logAiAgentStatus(context, `prompt_retry_scheduled=true reason=rate_limit attempt=${attempt + 1} delay_ms=${delayMs}`);
          await sleepWithSignal(delayMs, signal);
          continue;
        }

        return null;
      }

      if (error instanceof Error) {
        logAiAgentStatus(
          context,
          `prompt_unexpected_error=true name=${error.name} message=${sanitizeLogMessage(error.message)}`,
        );
        return null;
      }

      logAiAgentStatus(context, "prompt_unknown_error=true");
      return null;
    }
  }

  return null;
}

function extractTextFromPromptResponse(response: { output_text?: string; output?: unknown }) {
  const direct = response.output_text?.trim();

  if (direct) {
    return direct;
  }

  if (!Array.isArray(response.output)) {
    return "";
  }

  for (const item of response.output as Array<Record<string, unknown>>) {
    const content = item.content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content as Array<Record<string, unknown>>) {
      const textValue = part.text;

      if (typeof textValue === "string" && textValue.trim().length > 0) {
        return textValue.trim();
      }

      if (textValue && typeof textValue === "object") {
        const serialized = JSON.stringify(textValue);

        if (serialized.trim().length > 0) {
          return serialized;
        }
      }
    }
  }

  return "";
}

function resolveRateLimitDelayMs(message: string) {
  const match = message.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  const seconds = match ? Number.parseFloat(match[1]) : Number.NaN;

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return OPENAI_RETRY_DELAY_DEFAULT_MS;
  }

  return Math.min(OPENAI_RETRY_DELAY_MAX_MS, Math.max(500, Math.ceil(seconds * 1000) + 300));
}

function sleepWithSignal(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("Aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveWorkflowTimeoutMs() {
  const raw = process.env.OPENAI_WORKFLOW_TIMEOUT_MS?.trim();

  if (!raw) {
    return 60_000;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1_000) {
    return 60_000;
  }

  return parsed;
}

function isAbortLikeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "AbortError") {
    return true;
  }

  return /aborted/i.test(error.message);
}

function getConfiguredPromptIdForContext(context: AiAgentContext) {
  if (context === "clarifications") {
    return env.openAiPromptIdClarifications;
  }

  return env.openAiPromptIdMaterialList;
}

function isPromptTemplateId(id: string) {
  return id.startsWith("pmpt_");
}

function sanitizeLogMessage(message: string) {
  return message.replace(/\s+/g, " ").trim();
}

function logAiAgentStatus(context: AiAgentContext, message: string) {
  console.info(`${AI_AGENT_LOG_PREFIX}[${context}] ${message}`);
}

function describePromptResponseShape(content: string) {
  const parsed = parsePromptJson(content);

  if (parsed === null) {
    return "unparseable";
  }

  if (Array.isArray(parsed)) {
    return `array(len=${parsed.length})`;
  }

  if (typeof parsed === "object") {
    const keys = Object.keys(parsed as Record<string, unknown>).slice(0, 8);
    return `object(keys=${keys.join(",") || "none"})`;
  }

  return typeof parsed;
}

function flattenUserContentForResponses(userContent: PromptInputPart[]) {
  const lines: string[] = [];

  for (const part of userContent) {
    const text = part.text.trim();

    if (text.length > 0) {
      lines.push(text);
    }
  }

  return lines.join("\n\n");
}

async function extractPdfTextSafely(bytes: Buffer) {
  try {
    const pdfParseModule = await import("pdf-parse");
    const PDFParseCtor = (pdfParseModule as { PDFParse?: new (params: { data: Buffer }) => {
      getText: () => Promise<{ text?: string }>;
      destroy?: () => Promise<void>;
    } }).PDFParse;

    if (!PDFParseCtor) {
      return "";
    }

    const parser = new PDFParseCtor({ data: bytes });
    const parsed = await parser.getText();

    if (parser.destroy) {
      await parser.destroy();
    }

    return parsed.text || "";
  } catch {
    // Never crash project creation on PDF parsing issues.
    return "";
  }
}
