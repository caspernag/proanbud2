"use client";

import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { CirclePlus } from 'lucide-react';

type NewProjectDialogProps = {
  action: (formData: FormData) => void | Promise<void>;
  initialOpen?: boolean;
};

const ACCEPTED_FILE_TYPES = [
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".avif",
  ".webp",
  ".heic",
  ".csv",
  ".json",
  ".xml",
  ".dwg",
  ".dxf",
  "image/*",
  "application/pdf",
  "text/plain",
].join(",");

const AI_STATUS_STEPS = [
  "Analyserer materiallistegrunnlag",
  "Tolker vedlegg og tegninger",
  "Identifiserer byggdeler og materialbehov",
  "Beregner mengder med svinnmargin",
  "Strukturerer materialliste for prisduell",
];

const AI_ACTIVITY_TICKERS = [
  "Kjører semantisk tolkning av rom- og konstruksjonsdata",
  "Mapper fagområder mot materialkategorier",
  "Validerer mengdelogikk mot materiallisteomfang",
  "Kvalitetssikrer enheter, antall og svinn",
  "Optimaliserer listen for leverandorsammenligning",
];

type ClarificationQuestion = {
  id: string;
  title: string;
  helpText: string;
  placeholder: string;
  options?: string[];
};

type ClarificationSession = {
  questions: ClarificationQuestion[];
  answers: Record<string, string>;
  index: number;
};

type CatalogSearchEntry = {
  id: string;
  productName: string;
  quantity: string;
  comment: string;
  quantityReason: string;
  nobbNumber: string;
  supplierName: string;
  unitPriceNok: number;
  sectionTitle: string;
  category: string;
};

type DesiredProductDraft = {
  id: string;
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
};

type FromWebProductResponse = {
  productName: string;
  quantity: string;
  comment: string;
  quantityReason: string;
  supplierName?: string;
  nobbNumber?: string;
  imageUrl?: string;
  productUrl: string;
  unitPriceNok?: number;
};

function parseClarificationQuestions(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return [] as ClarificationQuestion[];
  }

  const rawQuestions = (payload as { questions?: unknown }).questions;

  if (!Array.isArray(rawQuestions)) {
    return [] as ClarificationQuestion[];
  }

  const parsed: ClarificationQuestion[] = [];

  for (const raw of rawQuestions) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const entry = raw as {
      id?: unknown;
      title?: unknown;
      helpText?: unknown;
      placeholder?: unknown;
      options?: unknown;
    };

    if (
      typeof entry.id !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.helpText !== "string" ||
      typeof entry.placeholder !== "string"
    ) {
      continue;
    }

    const options = Array.isArray(entry.options)
      ? entry.options.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
      : undefined;

    parsed.push({
      id: entry.id,
      title: entry.title,
      helpText: entry.helpText,
      placeholder: entry.placeholder,
      ...(options && options.length > 0 ? { options } : {}),
    });
  }

  return parsed;
}

function buildClarificationNotes(session: ClarificationSession) {
  const answeredLines = session.questions
    .map((question) => {
      const answer = (session.answers[question.id] || "").trim();

      if (!answer) {
        return null;
      }

      return `- ${question.title}: ${answer}`;
    })
    .filter((line): line is string => line !== null);

  if (answeredLines.length === 0) {
    return "";
  }

  return ["Avklaringer fra bruker:", ...answeredLines].join("\n");
}

export function NewProjectDialog({ action, initialOpen = false }: NewProjectDialogProps) {
  const [open, setOpen] = useState(initialOpen);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [clarificationSession, setClarificationSession] = useState<ClarificationSession | null>(null);
  const [clarificationNotes, setClarificationNotes] = useState("");
  const [allowSubmitOnce, setAllowSubmitOnce] = useState(false);
  const [clarificationFetchPending, setClarificationFetchPending] = useState(false);
  const [calculationPending, setCalculationPending] = useState(false);
  const [displayedStage, setDisplayedStage] = useState<"clarification" | null>(null);
  const [stageVisible, setStageVisible] = useState(false);
  const [stageCardHeight, setStageCardHeight] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clarificationAbortRef = useRef<AbortController | null>(null);
  const submitFrameRef = useRef<number | null>(null);
  const stageTransitionTimeoutRef = useRef<number | null>(null);
  const stageInnerRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(initialOpen);

  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter") {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.tagName === "TEXTAREA") {
      return;
    }

    event.preventDefault();
  }

  const stopInFlightClarification = useCallback(() => {
    clarificationAbortRef.current?.abort();
    clarificationAbortRef.current = null;

    if (submitFrameRef.current !== null) {
      window.cancelAnimationFrame(submitFrameRef.current);
      submitFrameRef.current = null;
    }
  }, []);

  const closeDialogImmediately = useCallback(() => {
    stopInFlightClarification();
    openRef.current = false;
    setOpen(false);
    setClarificationSession(null);
    setClarificationNotes("");
    setAllowSubmitOnce(false);
    setClarificationFetchPending(false);
    setCalculationPending(false);
    setDisplayedStage(null);
    setStageVisible(false);
    setStageCardHeight(null);

    if (stageTransitionTimeoutRef.current !== null) {
      window.clearTimeout(stageTransitionTimeoutRef.current);
      stageTransitionTimeoutRef.current = null;
    }
  }, [stopInFlightClarification]);

  const requestCloseDialog = useCallback(() => {
    const confirmed = window.confirm("Er du sikker på at du vil avslutte? Pågående arbeid blir avbrutt.");

    if (!confirmed) {
      return;
    }

    closeDialogImmediately();
  }, [closeDialogImmediately]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    return () => {
      stopInFlightClarification();

      if (stageTransitionTimeoutRef.current !== null) {
        window.clearTimeout(stageTransitionTimeoutRef.current);
        stageTransitionTimeoutRef.current = null;
      }
    };
  }, [stopInFlightClarification]);

  const desiredStage: "clarification" | null =
    clarificationFetchPending || Boolean(clarificationSession)
      ? "clarification"
      : null;

  useEffect(() => {
    if (stageTransitionTimeoutRef.current !== null) {
      window.clearTimeout(stageTransitionTimeoutRef.current);
      stageTransitionTimeoutRef.current = null;
    }

    if (!desiredStage) {
      setStageVisible(false);

      if (displayedStage !== null) {
        stageTransitionTimeoutRef.current = window.setTimeout(() => {
          setDisplayedStage(null);
          setStageCardHeight(null);
          stageTransitionTimeoutRef.current = null;
        }, 180);
      }

      return;
    }

    if (displayedStage === null) {
      setDisplayedStage(desiredStage);

      stageTransitionTimeoutRef.current = window.setTimeout(() => {
        setStageVisible(true);
        stageTransitionTimeoutRef.current = null;
      }, 20);

      return;
    }

    if (displayedStage === desiredStage) {
      setStageVisible(true);
      return;
    }

    setStageVisible(false);

    stageTransitionTimeoutRef.current = window.setTimeout(() => {
      setDisplayedStage(desiredStage);

      stageTransitionTimeoutRef.current = window.setTimeout(() => {
        setStageVisible(true);
        stageTransitionTimeoutRef.current = null;
      }, 20);
    }, 140);
  }, [desiredStage, displayedStage]);

  useEffect(() => {
    if (!displayedStage || !stageInnerRef.current) {
      return;
    }

    const element = stageInnerRef.current;
    const updateHeight = () => {
      setStageCardHeight(element.getBoundingClientRect().height);
    };

    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [displayedStage, clarificationSession?.index, clarificationFetchPending]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestCloseDialog();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, requestCloseDialog]);

  function syncFiles(files: File[]) {
    const input = fileInputRef.current;

    if (!input) {
      return;
    }

    const transfer = new DataTransfer();

    for (const file of files) {
      transfer.items.add(file);
    }

    input.files = transfer.files;
    setSelectedFiles(files);
  }

  function mergeFiles(incoming: FileList | File[]) {
    const merged = [...selectedFiles];

    for (const file of Array.from(incoming)) {
      const duplicate = merged.some(
        (existing) =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified,
      );

      if (!duplicate) {
        merged.push(file);
      }
    }

    syncFiles(merged);
  }

  function handleRemoveFile(index: number) {
    const nextFiles = selectedFiles.filter((_, currentIndex) => currentIndex !== index);
    syncFiles(nextFiles);
  }

  async function handleStartClarification(event: FormEvent<HTMLFormElement>) {
    if (allowSubmitOnce) {
      setAllowSubmitOnce(false);
      setCalculationPending(true);
      return;
    }

    event.preventDefault();
    setCalculationPending(false);

    const formData = new FormData(event.currentTarget);
    const abortController = new AbortController();
    clarificationAbortRef.current = abortController;

    setClarificationFetchPending(true);

    try {
      const response = await fetch("/api/material-list/clarifications", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!openRef.current) {
        return;
      }

      const payload = await response.json();
      const questions = parseClarificationQuestions(payload);

      if (questions.length === 0) {
        submitAfterClarification("");
        return;
      }

      setCalculationPending(false);
      setClarificationSession({
        questions,
        index: 0,
        answers: Object.fromEntries(questions.map((question) => [question.id, ""])),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      if (!openRef.current) {
        return;
      }

      submitAfterClarification("");
    } finally {
      if (clarificationAbortRef.current === abortController) {
        clarificationAbortRef.current = null;
      }
      setClarificationFetchPending(false);
    }
  }

  function submitAfterClarification(notes: string) {
    if (!openRef.current) {
      return;
    }

    setClarificationNotes(notes);
    setClarificationSession(null);
    setClarificationFetchPending(false);
    setCalculationPending(true);
    setAllowSubmitOnce(true);
    submitFrameRef.current = window.requestAnimationFrame(() => {
      formRef.current?.requestSubmit();
      submitFrameRef.current = null;
    });
  }

  const currentQuestion = clarificationSession
    ? clarificationSession.questions[clarificationSession.index]
    : null;
  const currentAnswer = clarificationSession && currentQuestion
    ? clarificationSession.answers[currentQuestion.id] ?? ""
    : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-[160px]! h-8 items-center justify-center gap-3 rounded-full bg-[#27a866] hover:bg-[#2eb872] px-3 py-1 text-sm font-semibold text-white transition"
      >
        <CirclePlus className="h-4 w-4" />
        Ny materialliste
      </button>

      {open ? (
        <div
          className={`fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-3 transition-opacity duration-150 sm:items-center sm:p-6 ${
            displayedStage || calculationPending ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              requestCloseDialog();
            }
          }}
        >
          <div className="relative w-full max-w-3xl overflow-hidden rounded-[1.2rem] border border-stone-200 bg-white shadow-2xl sm:rounded-[1.8rem]">
            <div className="flex items-start justify-between border-b border-stone-200 bg-[var(--card-strong)] px-4 py-3 sm:px-6 sm:py-4">
              <div>
                <p className="eyebrow">Ny materialliste</p>
                <h2 className="mt-1 text-xl font-semibold text-stone-900 sm:text-2xl">
                  Legg inn materiallistegrunnlag
                </h2>
                <p className="mt-1 text-sm text-stone-600">
                  Dette brukes til å generere materialliste og prisduell.
                </p>
              </div>
              <button
                type="button"
                onClick={requestCloseDialog}
                className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
              >
                Lukk
              </button>
            </div>

            <form
              ref={formRef}
              action={action}
              onSubmit={handleStartClarification}
              onKeyDown={handleFormKeyDown}
              className="relative max-h-[78vh] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5"
            >
              <input type="hidden" name="clarificationNotes" value={clarificationNotes} readOnly />

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm text-stone-700 sm:col-span-2">
                  <span className="font-medium">Materiallistenavn</span>
                  <input
                    type="text"
                    name="title"
                    required
                    defaultValue="Ny materialliste"
                    className="h-10 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-stone-900"
                  />
                </label>

                <label className="block space-y-1.5 text-sm text-stone-700">
                  <span className="font-medium">Sted</span>
                  <input
                    type="text"
                    name="location"
                    defaultValue="Oslo"
                    className="h-10 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-stone-900"
                  />
                </label>

                <label className="block space-y-1.5 text-sm text-stone-700">
                  <span className="font-medium">Areal (m²)</span>
                  <input
                    type="number"
                    name="areaSqm"
                    min={5}
                    defaultValue={30}
                    className="h-10 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-stone-900"
                  />
                </label>

                <label className="block space-y-1.5 text-sm text-stone-700">
                  <span className="font-medium">Materiallistetype</span>
                  <select
                    name="projectType"
                    defaultValue="Rehabilitering (rehab)"
                    className="h-10 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-stone-900"
                  >
                    <option>Rehabilitering (rehab)</option>
                    <option>Nybygg</option>
                    <option>Tilbygg / påbygg</option>
                    <option>Totalrenovering</option>
                    <option>Innvendig oppussing</option>
                    <option>Bad / våtrom</option>
                    <option>Kjøkken</option>
                    <option>Terrasse / uteområde</option>
                    <option>Garasje / bod / anneks</option>
                  </select>
                </label>

                <label className="block space-y-1.5 text-sm text-stone-700">
                  <span className="font-medium">Standard</span>
                  <select
                    name="finishLevel"
                    defaultValue="Standard"
                    className="h-10 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-stone-900"
                  >
                    <option>Basis</option>
                    <option>Standard</option>
                    <option>Premium</option>
                  </select>
                </label>

                <label className="block space-y-1.5 text-sm text-stone-700 sm:col-span-2">
                  <span className="font-medium">God beskrivelse</span>
                  <textarea
                    name="description"
                    rows={4}
                    placeholder="Beskriv prosjektet godt: hva som skal bygges/oppgraderes, mål/areal, materialvalg, ønsket kvalitet og eventuelle spesifikke kundekrav."
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900"
                  />
                </label>

                <DesiredProductsField />

                <div className="space-y-2.5 text-sm text-stone-700 sm:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">Materiallistevedlegg</span>
                    <span className="text-xs text-stone-500">PDF, DOCX, TXT, PNG, JPG, JPEG, AVIF, m.fl.</span>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    name="attachments"
                    accept={ACCEPTED_FILE_TYPES}
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      mergeFiles(event.currentTarget.files ?? []);
                    }}
                  />

                  <div
                    role="button"
                    tabIndex={0}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setIsDragActive(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragActive(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setIsDragActive(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsDragActive(false);
                      mergeFiles(event.dataTransfer.files);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    className={`w-full rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
                      isDragActive
                        ? "border-stone-900 bg-stone-100"
                        : "border-stone-300 bg-stone-50 hover:border-stone-900 hover:bg-white"
                    }`}
                  >
                    <p className="text-sm font-semibold text-stone-900">Dra filer hit for opplasting</p>
                    <p className="mt-1 text-xs text-stone-600">
                      Legg ved bilder, dokumenter og byggetegninger for AI-basert mengdeberegning.
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-3 inline-flex items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                    >
                      Last opp
                    </button>
                  </div>

                  {selectedFiles.length > 0 ? (
                    <ul className="space-y-1.5">
                      {selectedFiles.map((file, index) => (
                        <li
                          key={`${file.name}-${file.lastModified}-${file.size}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-stone-900">{file.name}</p>
                            <p className="text-xs text-stone-500">{Math.max(1, Math.round(file.size / 1024))} KB</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(index)}
                            className="rounded-full border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                          >
                            Fjern
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>

              <DialogFormActions onCancel={requestCloseDialog} />

            </form>
          </div>
        </div>
      ) : null}

      {open && displayedStage ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-900/45 sm:items-center p-0">
          <div className="w-full max-w-xl overflow-hidden rounded-[1.2rem] border border-stone-200 bg-white p-0 shadow-2xl sm:rounded-[1.6rem]">
            <div
              className="w-full overflow-hidden transition-[height] duration-200 ease-in-out"
              style={{ height: stageCardHeight ? `${stageCardHeight}px` : "auto" }}
            >
              <div
                ref={stageInnerRef}
                className={`rounded-[1rem] border border-stone-200 bg-white p-4 shadow-xl transition-all duration-200 ease-in-out ${
                  stageVisible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
                }`}
              >
                {clarificationSession && currentQuestion ? (
                  <>
                    <p className="eyebrow">AI avklarer usikkerheter</p>
                    <h3 className="mt-2 text-lg font-semibold text-stone-900 sm:text-xl">
                      Trenger noen raske svar for mer presis materialliste
                    </h3>
                    <p className="mt-1 text-sm text-stone-600">
                      Svarene brukes direkte i grunnlaget for beregning av materialmengder.
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stone-600">
                      <div className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
                        Spørsmål: {clarificationSession.index + 1}/{clarificationSession.questions.length}
                      </div>
                      <div className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
                        Status: avklaring aktiv
                      </div>
                    </div>

                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100">
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
                        style={{
                          width: `${Math.max(
                            15,
                            ((clarificationSession.index + 1) / clarificationSession.questions.length) * 100,
                          )}%`,
                        }}
                      />
                    </div>

                    <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3">
                      <p className="text-sm font-semibold text-stone-900">{currentQuestion.title}</p>
                      <p className="mt-1 text-xs text-stone-600">{currentQuestion.helpText}</p>

                      {currentQuestion.options ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {currentQuestion.options.map((option) => {
                            const selected = currentAnswer === option;

                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() => {
                                  setClarificationSession((previous) => {
                                    if (!previous) {
                                      return previous;
                                    }

                                    return {
                                      ...previous,
                                      answers: {
                                        ...previous.answers,
                                        [currentQuestion.id]: option,
                                      },
                                    };
                                  });
                                }}
                                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                  selected
                                    ? "border-[#1f8e59] bg-[#2eb872] text-white"
                                    : "border-stone-300 bg-white text-stone-700 hover:border-stone-900 hover:text-stone-900"
                                }`}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      <textarea
                        rows={3}
                        value={currentAnswer}
                        onChange={(event) => {
                          const value = event.currentTarget.value;

                          setClarificationSession((previous) => {
                            if (!previous) {
                              return previous;
                            }

                            return {
                              ...previous,
                              answers: {
                                ...previous.answers,
                                [currentQuestion.id]: value,
                              },
                            };
                          });
                        }}
                        placeholder={currentQuestion.placeholder}
                        className="mt-3 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900"
                      />
                    </div>

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => submitAfterClarification("")}
                          className="inline-flex items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                        >
                          Fortsett uten avklaringer
                        </button>
                        {clarificationSession.index > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setClarificationSession((previous) => {
                                if (!previous) {
                                  return previous;
                                }

                                return {
                                  ...previous,
                                  index: Math.max(0, previous.index - 1),
                                };
                              });
                            }}
                            className="inline-flex items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                          >
                            Forrige
                          </button>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        disabled={!currentAnswer.trim()}
                        onClick={() => {
                          const isLast = clarificationSession.index === clarificationSession.questions.length - 1;

                          if (isLast) {
                            submitAfterClarification(buildClarificationNotes(clarificationSession));
                            return;
                          }

                          setClarificationSession((previous) => {
                            if (!previous) {
                              return previous;
                            }

                            return {
                              ...previous,
                              index: Math.min(previous.questions.length - 1, previous.index + 1),
                            };
                          });
                        }}
                        className="inline-flex items-center justify-center rounded-full bg-[#2eb872] px-5 py-2 text-xs font-semibold text-white transition hover:bg-[#27a866] disabled:cursor-not-allowed disabled:bg-[#1f8e59]"
                      >
                        {clarificationSession.index === clarificationSession.questions.length - 1
                          ? "Fortsett og generer materialliste"
                          : "Neste spørsmål"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="eyebrow">AI avklarer usikkerheter</p>
                    <h3 className="mt-2 text-lg font-semibold text-stone-900 sm:text-xl">
                      Finner uklare punkter som trenger avklaring
                    </h3>
                    <p className="mt-1 text-sm text-stone-600">
                      Genererer dynamiske oppfølgingsspørsmål basert på beskrivelse og vedlegg.
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900" />
                      Jobber...
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {open && calculationPending ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-900/45 p-3 sm:items-center sm:p-6">
          <div className="w-full max-w-xl overflow-hidden rounded-[1.2rem] border border-stone-200 bg-white p-4 shadow-2xl sm:rounded-[1.6rem] sm:p-5">
            <CalculationProcessingCard fileCount={selectedFiles.length} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function DialogFormActions({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();

  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="inline-flex items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Avbryt
      </button>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-[#2eb872] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#27a866] disabled:cursor-not-allowed disabled:bg-[#1f8e59]"
      >
        {pending ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            AI lager materialliste...
          </>
        ) : (
          "Opprett materialliste"
        )}
      </button>
    </div>
  );
}

function CalculationProcessingCard({ fileCount }: { fileCount: number }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activityIndex, setActivityIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setStepIndex((current) => Math.min(current + 1, AI_STATUS_STEPS.length - 1));
    }, 1400);

    const clock = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    const activity = window.setInterval(() => {
      setActivityIndex((current) => (current + 1) % AI_ACTIVITY_TICKERS.length);
    }, 1300);

    return () => {
      window.clearInterval(interval);
      window.clearInterval(clock);
      window.clearInterval(activity);
    };
  }, []);

  return (
    <>
      <p className="eyebrow">AI kalkulerer materiallisten</p>
      <h3 className="mt-2 text-lg font-semibold text-stone-900 sm:text-xl">
        Genererer materialliste
      </h3>
      <p className="mt-1 text-sm text-stone-600">
        {fileCount > 0
          ? `Jobber med ${fileCount} vedlegg og materiallistedata. Dette kan ta noen minutter.`
          : "Jobber med materiallistedata. Dette kan ta noen minutter."}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stone-600 sm:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
          Tid: {elapsedSeconds}s
        </div>
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
          Fase: {stepIndex + 1}/{AI_STATUS_STEPS.length}
        </div>
        <div className="col-span-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 sm:col-span-1">
          Status: aktiv
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all duration-700"
          style={{ width: `${Math.max(18, ((stepIndex + 1) / AI_STATUS_STEPS.length) * 100)}%` }}
        />
      </div>

      <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
        <span className="ml-2">{AI_ACTIVITY_TICKERS[activityIndex]}</span>
      </div>

      <ul className="mt-4 space-y-2.5">
        {AI_STATUS_STEPS.map((step, index) => {
          const done = index < stepIndex;
          const active = index === stepIndex;

          return (
            <li
              key={step}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${
                active
                  ? "border-stone-900 bg-stone-50 text-stone-900"
                  : done
                    ? "border-stone-200 bg-white text-stone-700"
                    : "border-stone-100 bg-white text-stone-500"
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  done ? "bg-[var(--success)]" : active ? "animate-pulse bg-stone-900" : "bg-stone-300"
                }`}
              />
              <span>{step}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function DesiredProductsField() {
  const [activeTab, setActiveTab] = useState<"catalog" | "web">("catalog");
  const [desiredProducts, setDesiredProducts] = useState<DesiredProductDraft[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<CatalogSearchEntry[]>([]);
  const [catalogPending, setCatalogPending] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [webPending, setWebPending] = useState(false);
  const [webMessage, setWebMessage] = useState("");
  const [webMessageTone, setWebMessageTone] = useState<"idle" | "success" | "error">("idle");

  const serializedDesiredProducts = useMemo(() => JSON.stringify(desiredProducts), [desiredProducts]);

  useEffect(() => {
    const needle = catalogQuery.trim();

    if (needle.length < 2) {
      setCatalogResults([]);
      setCatalogPending(false);
      setCatalogError("");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setCatalogPending(true);
      setCatalogError("");

      try {
        const response = await fetch(`/api/material-list/catalog?q=${encodeURIComponent(needle)}&limit=12`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          setCatalogResults([]);
          setCatalogError("Kunne ikke hente katalogtreff akkurat nå.");
          return;
        }

        const payload = (await response.json()) as { items?: CatalogSearchEntry[] };
        setCatalogResults(Array.isArray(payload.items) ? payload.items : []);
      } catch {
        if (!controller.signal.aborted) {
          setCatalogResults([]);
          setCatalogError("Kunne ikke hente katalogtreff akkurat nå.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setCatalogPending(false);
        }
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [catalogQuery]);

  function addDesiredProduct(product: DesiredProductDraft) {
    setDesiredProducts((current) => {
      const duplicate = current.some((entry) => {
        if (product.nobbNumber && entry.nobbNumber && entry.nobbNumber === product.nobbNumber) {
          return true;
        }

        if (product.productUrl && entry.productUrl && entry.productUrl === product.productUrl) {
          return true;
        }

        return (
          entry.productName.toLowerCase() === product.productName.toLowerCase() &&
          entry.source === product.source
        );
      });

      if (duplicate) {
        return current;
      }

      return [product, ...current];
    });
  }

  async function addFromWeb() {
    const url = webUrl.trim();

    if (!url) {
      setWebMessageTone("error");
      setWebMessage("Legg inn en gyldig produktlenke.");
      return;
    }

    setWebPending(true);
    setWebMessage("");
    setWebMessageTone("idle");

    try {
      const response = await fetch("/api/material-list/from-web", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        product?: FromWebProductResponse;
      };

      if (!response.ok || !payload.ok || !payload.product) {
        setWebMessageTone("error");
        setWebMessage(payload.message || "Fant ikke gyldig produkt fra nettsiden.");
        return;
      }

      addDesiredProduct({
        id: `web-${crypto.randomUUID()}`,
        source: "web",
        productName: payload.product.productName,
        quantity: payload.product.quantity || "1 stk",
        comment: payload.product.comment,
        quantityReason: payload.product.quantityReason,
        ...(payload.product.nobbNumber ? { nobbNumber: payload.product.nobbNumber } : {}),
        ...(payload.product.supplierName ? { supplierName: payload.product.supplierName } : {}),
        ...(typeof payload.product.unitPriceNok === "number" ? { unitPriceNok: Math.round(payload.product.unitPriceNok) } : {}),
        ...(payload.product.productUrl ? { productUrl: payload.product.productUrl } : {}),
        ...(payload.product.imageUrl ? { imageUrl: payload.product.imageUrl } : {}),
      });

      setWebMessageTone("success");
      setWebMessage(`La til: ${payload.product.productName}`);
      setWebUrl("");
    } catch {
      setWebMessageTone("error");
      setWebMessage("Kunne ikke analysere lenken akkurat nå.");
    } finally {
      setWebPending(false);
    }
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3.5 sm:col-span-2">
      <input type="hidden" name="desiredProductsJson" value={serializedDesiredProducts} readOnly />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-stone-900">Spesifikke produkter (valgfritt)</p>
          <p className="mt-0.5 text-xs text-stone-600">
            Legg til konkrete produkter kunden ønsker, via katalogsøk eller fra nett.
          </p>
        </div>
        <span className="inline-flex rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700">
          {desiredProducts.length} valgt
        </span>
      </div>

      <div className="inline-flex rounded-full border border-stone-300 bg-white p-0.5">
        <button
          type="button"
          onClick={() => setActiveTab("catalog")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            activeTab === "catalog" ? "bg-stone-900 text-white" : "text-stone-700 hover:text-stone-900"
          }`}
        >
          Fra katalog
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("web")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            activeTab === "web" ? "bg-stone-900 text-white" : "text-stone-700 hover:text-stone-900"
          }`}
        >
          Fra nett
        </button>
      </div>

      {activeTab === "catalog" ? (
        <div className="space-y-2">
          <input
            value={catalogQuery}
            onChange={(event) => setCatalogQuery(event.currentTarget.value)}
            placeholder="Søk på produktnavn, NOBB eller leverandør"
            className="h-10 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-stone-900"
          />
          <p className="text-xs text-stone-500">
            {catalogPending
              ? "Søker i katalog..."
              : catalogQuery.trim().length < 2
                ? "Skriv minst 2 tegn for å søke."
                : `Fant ${catalogResults.length} treff.`}
          </p>
          {catalogError ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
              {catalogError}
            </p>
          ) : null}
          {catalogResults.length > 0 ? (
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-stone-200 bg-white p-2">
              {catalogResults.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-stone-900">{entry.productName}</p>
                    <p className="truncate text-[11px] text-stone-600">
                      NOBB {entry.nobbNumber} · {entry.supplierName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      addDesiredProduct({
                        id: `catalog-${entry.id}`,
                        source: "catalog",
                        productName: entry.productName,
                        quantity: entry.quantity,
                        comment: entry.comment,
                        quantityReason: entry.quantityReason,
                        nobbNumber: entry.nobbNumber,
                        supplierName: entry.supplierName,
                        unitPriceNok: entry.unitPriceNok,
                      })
                    }
                    className="shrink-0 rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                  >
                    Legg til
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={webUrl}
              onChange={(event) => setWebUrl(event.currentTarget.value)}
              placeholder="https://..."
              className="h-10 flex-1 rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-stone-900"
            />
            <button
              type="button"
              onClick={() => void addFromWeb()}
              disabled={webPending}
              className="inline-flex h-10 items-center justify-center rounded-full bg-stone-900 px-4 text-xs font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
            >
              {webPending ? "Analyserer..." : "Legg til fra nett"}
            </button>
          </div>

          {webMessage ? (
            <p
              className={`rounded-lg border px-2.5 py-2 text-xs ${
                webMessageTone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {webMessage}
            </p>
          ) : (
            <p className="text-xs text-stone-500">Lim inn en produktside, så henter AI strukturert produktdata.</p>
          )}
        </div>
      )}

      {desiredProducts.length > 0 ? (
        <div className="space-y-1.5 rounded-xl border border-stone-200 bg-white p-2.5">
          {desiredProducts.map((product) => (
            <div key={product.id} className="flex items-start justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-stone-900">{product.productName}</p>
                <p className="truncate text-[11px] text-stone-600">
                  {product.source === "catalog" ? "Katalog" : "Nett"}
                  {product.nobbNumber ? ` · NOBB ${product.nobbNumber}` : ""}
                  {product.supplierName ? ` · ${product.supplierName}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setDesiredProducts((current) => current.filter((entry) => entry.id !== product.id))
                }
                className="shrink-0 rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
              >
                Fjern
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
