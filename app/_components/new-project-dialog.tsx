"use client";

import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
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

  return parsed.slice(0, 5);
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
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clarificationAbortRef = useRef<AbortController | null>(null);
  const submitFrameRef = useRef<number | null>(null);
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
    };
  }, [stopInFlightClarification]);

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
      return;
    }

    event.preventDefault();

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
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-3 sm:items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              requestCloseDialog();
            }
          }}
        >
          <div className="w-full max-w-3xl overflow-hidden rounded-[1.2rem] border border-stone-200 bg-white shadow-2xl sm:rounded-[1.8rem]">
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
                  <span className="font-medium">Kort beskrivelse</span>
                  <textarea
                    name="description"
                    rows={4}
                    placeholder="Privat materialliste med behov for presis mengdegrunnlag og leverandørprissjekk."
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900"
                  />
                </label>

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

              {clarificationFetchPending ? (
                <div className="absolute inset-0 z-20 rounded-[1.2rem] bg-white/95 p-4 backdrop-blur-sm sm:p-5">
                  <div className="mx-auto flex h-full max-w-xl flex-col justify-center rounded-[1rem] border border-stone-200 bg-white p-4 shadow-xl sm:p-5">
                    <p className="eyebrow">AI analyserer grunnlaget</p>
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
                  </div>
                </div>
              ) : null}

              {clarificationSession && currentQuestion ? (
                <div className="absolute inset-0 z-20 rounded-[1.2rem] bg-white/95 p-4 backdrop-blur-sm sm:p-5">
                  <div className="mx-auto flex h-full max-w-xl flex-col rounded-[1rem] border border-stone-200 bg-white p-4 shadow-xl sm:p-5">
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

                    <div className="mt-auto flex flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
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
                  </div>
                </div>
              ) : null}

              <CreateProjectAiLoader fileCount={selectedFiles.length} />
            </form>
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

function CreateProjectAiLoader({ fileCount }: { fileCount: number }) {
  const { pending } = useFormStatus();

  if (!pending) {
    return null;
  }

  return <CreateProjectAiLoaderActive fileCount={fileCount} />;
}

function CreateProjectAiLoaderActive({ fileCount }: { fileCount: number }) {
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
    <div className="absolute inset-0 z-20 rounded-[1.2rem] bg-white/94 p-4 backdrop-blur-sm sm:p-5">
      <div className="pointer-events-none absolute -top-10 left-1/2 h-36 w-[80%] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,_rgba(129,225,167,0.35)_0%,rgba(129,225,167,0)_70%)]" />

      <div className="mx-auto flex h-full max-w-xl flex-col justify-center rounded-[1rem] border border-stone-200 bg-white p-4 shadow-xl sm:p-5">
        <p className="eyebrow">AI-prosessering</p>
        <h3 className="mt-2 text-lg font-semibold text-stone-900 sm:text-xl">
          Genererer materialliste fra materiallistegrunnlag
        </h3>
        <p className="mt-1 text-sm text-stone-600">
          {fileCount > 0
            ? `Jobber med ${fileCount} vedlegg og materiallistedata. Dette kan ta noen sekunder.`
            : "Jobber med materiallistedata. Dette kan ta noen sekunder."}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stone-600 sm:grid-cols-3">
          <div className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
            Tid: {elapsedSeconds}s
          </div>
          <div className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
            Fase: {stepIndex + 1}/{AI_STATUS_STEPS.length}
          </div>
          <div className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 sm:col-span-1 col-span-2">
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
      </div>
    </div>
  );
}
