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
const MAX_PRICE_LIST_PROMPT_ROWS = 120;
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
  }
  | {
    type: "image_url";
    image_url: { url: string };
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
  ).max(6),
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
  const modelOutput = await requestMaterialListFromOpenAi(input, attachmentContext, priceListProducts);

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
      const imageDataUrl = await fileToDataUrl(file);
      result.userContentParts.push({
        type: "image_url",
        image_url: { url: imageDataUrl },
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
  priceListProducts: PriceListProduct[],
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
      buildMaterialListPromptInput(input, attachmentContext, priceListProducts),
      workflowAbortController.signal,
      "material-list",
      promptId,
    );

    if (!workflowContent) {
      return null;
    }

    const parsedFromWorkflow = parseModelResponse(workflowContent);

    if (!parsedFromWorkflow) {
      logAiAgentStatus("material-list", "prompt_output_invalid_json=true");
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
      logAiAgentStatus("clarifications", "prompt_output_invalid_json=true");
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
  const normalized = content.trim();
  const jsonText = stripCodeFence(normalized);

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const validated = modelResponseSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

function parseClarificationResponse(content: string) {
  const normalized = content.trim();
  const jsonText = stripCodeFence(normalized);

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const validated = clarificationResponseSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

function buildMaterialListPromptInput(
  input: ProjectInput,
  attachmentContext: PreparedAttachmentContext,
  priceListProducts: PriceListProduct[],
) {
  return JSON.stringify(
    {
      request_type: "material_list",
      required_response_format: "json_object",
      project: input,
      attachments: summarizeAttachments(attachmentContext.files),
      attachment_content: flattenUserContentForResponses(attachmentContext.userContentParts),
      price_list_selection: buildPriceListPromptContext(input, priceListProducts),
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

  return Array.from(uniqueById.values()).slice(0, 5);
}

function buildPriceListPromptContext(input: ProjectInput, products: PriceListProduct[]) {
  if (products.length === 0) {
    return "- Ingen prislister funnet.";
  }

  const projectTokens = tokenizeForMatch(
    `${input.projectType} ${input.title} ${input.description} ${input.finishLevel}`,
  );
  const ranked = products
    .map((product) => ({
      product,
      score: scorePriceListProduct(product, projectTokens),
    }))
    .sort((left, right) => right.score - left.score || left.product.productName.localeCompare(right.product.productName));
  const selected = ranked
    .slice(0, MAX_PRICE_LIST_PROMPT_ROWS)
    .map(({ product }) => product);

  return selected
    .map(
      (product) =>
        `- NOBB ${product.nobbNumber} | ${product.productName} | Enhet: ${product.unit} | Seksjon: ${product.sectionTitle}`,
    )
    .join("\n");
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
        note: mergeNoteWithNobb(item.note, match),
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

async function fileToDataUrl(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function stripCodeFence(content: string) {
  const fenced = content.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i);
  return fenced ? fenced[1] : content;
}

function findBestPriceListMatch(item: { item: string; note: string }, sectionTitle: string, products: PriceListProduct[]) {
  const nobbFromItem = extractNobb(item.item);
  const nobbFromNote = extractNobb(item.note);
  const directNobb = nobbFromItem || nobbFromNote;

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

function mergeNoteWithNobb(note: string, product: PriceListProduct) {
  const base = note.trim();
  const source = `${product.supplierName}`;
  const targetSuffix = `NOBB: ${product.nobbNumber} · Kilde: ${source}`;

  if (base.toLowerCase().includes("nobb:")) {
    return base.slice(0, 280);
  }

  const merged = base.length > 0 ? `${base} · ${targetSuffix}` : targetSuffix;
  return merged.slice(0, 280);
}

function extractNobb(value: string) {
  const match = value.match(/\b(\d{6,10})\b/);
  return match ? match[1] : "";
}

function tokenizeForMatch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function scorePriceListProduct(product: PriceListProduct, projectTokens: string[]) {
  if (projectTokens.length === 0) {
    return 0;
  }

  const haystack = tokenizeForMatch(`${product.productName} ${product.sectionTitle} ${product.category}`);
  const overlap = projectTokens.filter((token) => haystack.includes(token)).length;

  return overlap / Math.max(projectTokens.length, haystack.length || 1);
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

  try {
    logAiAgentStatus(
      context,
      `prompt_attempt=true model=prompt_default attempt=1 prompt_id=${promptId} prompt_version=latest`,
    );

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

    const content = response.output_text?.trim();

    if (!content) {
      logAiAgentStatus(context, "prompt_output_empty=true model=prompt_default attempt=1");
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
      logAiAgentStatus(
        context,
        `prompt_api_error=true status=${error.status ?? "unknown"} code=${error.code ?? "unknown"} param=${error.param ?? "unknown"} message=${sanitizeLogMessage(error.message)}`,
      );
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

function flattenUserContentForResponses(userContent: PromptInputPart[]) {
  const lines: string[] = [];

  for (const part of userContent) {
    if (part.type === "text") {
      const text = part.text.trim();

      if (text.length > 0) {
        lines.push(text);
      }

      continue;
    }

    if (part.type === "image_url") {
      const url = part.image_url.url?.trim();

      if (url) {
        lines.push(`Bildevedlegg URL: ${url}`);
      }
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
