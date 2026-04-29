"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import type { MaterialCatalogEntry } from "@/lib/material-catalog";
import type { MaterialItem, MaterialSection } from "@/lib/project-data";
import { formatCurrency } from "@/lib/utils";

type MaterialListDocumentProps = {
  sections: MaterialSection[];
  catalogEntries: MaterialCatalogEntry[];
  projectSlug?: string;
  persistToProject?: boolean;
  readOnly?: boolean;
  allowQuantityEdit?: boolean;
  sessionStorageKey?: string;
};

type MaterialRow = {
  id: string;
  productName: string;
  quantity: string;
  comment: string;
  quantityReason: string;
  nobbNumber?: string;
  productUrl?: string;
  imageUrl?: string;
  supplierName?: string;
  unitPriceNok?: number;
  category?: string;
  source: "generated" | "catalog" | "custom" | "web";
  customEditable: boolean;
};

type DocumentSection = {
  title: string;
  description: string;
  items: MaterialRow[];
};

type DragSource = {
  sectionIndex: number;
  itemIndex: number;
};

type QuantityDialogState = {
  sectionTitle: string;
  row: MaterialRow;
};

type ProductDialogState = {
  sectionTitle: string;
  row: MaterialRow;
};

type CommentDialogState = {
  sectionIndex: number;
  itemIndex: number;
  sectionTitle: string;
  row: MaterialRow;
  comment: string;
};

type ImagePreviewDialogState = {
  productName: string;
  imageUrl: string;
  nobbNumber?: string;
};

type ImportedWebProduct = {
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

type WebImportDialogState = {
  url: string;
  status: "analyzing" | "success" | "not_found" | "error";
  message?: string;
  product?: ImportedWebProduct;
};

type NobbDetails = {
  nobbNumber: string;
  productName: string;
  description: string;
  brand: string;
  supplierName: string;
  category: string;
  unit: string;
  unitPriceNok: number;
  ean?: string;
  datasheetUrl?: string;
  imageUrl?: string;
  technicalDetails: string[];
  lastUpdated?: string;
  source: "nobb_api" | "prislister";
};

const CUSTOM_SECTION_TITLE = "Egendefinerte produkter";
const CATALOG_FILTER_ALL = "__all__";

export function MaterialListDocument({
  sections,
  catalogEntries,
  projectSlug,
  persistToProject = false,
  readOnly = false,
  allowQuantityEdit = false,
  sessionStorageKey,
}: MaterialListDocumentProps) {
  const [draftSections, setDraftSections] = useState<DocumentSection[]>(() =>
    mapSectionsToDocument(sections, catalogEntries),
  );
  const [openSections, setOpenSections] = useState<boolean[]>(() => sections.map(() => true));
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMode, setAddMode] = useState<"catalog" | "web">("catalog");
  const [selectedCatalogEntryId, setSelectedCatalogEntryId] = useState<string | null>(null);
  const [catalogSearchTerm, setCatalogSearchTerm] = useState("");
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState(CATALOG_FILTER_ALL);
  const [webProductDraft, setWebProductDraft] = useState({
    url: "",
    error: "",
  });
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dragOverSectionIndex, setDragOverSectionIndex] = useState<number | null>(null);
  const [quantityDialog, setQuantityDialog] = useState<QuantityDialogState | null>(null);
  const [productDialog, setProductDialog] = useState<ProductDialogState | null>(null);
  const [commentDialog, setCommentDialog] = useState<CommentDialogState | null>(null);
  const [imagePreviewDialog, setImagePreviewDialog] = useState<ImagePreviewDialogState | null>(null);
  const [webImportDialog, setWebImportDialog] = useState<WebImportDialogState | null>(null);
  const [nobbDetails, setNobbDetails] = useState<NobbDetails | null>(null);
  const [nobbLoading, setNobbLoading] = useState(false);
  const [nobbError, setNobbError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [alternativesRowId, setAlternativesRowId] = useState<string | null>(null);
  const hasHydratedForSaveRef = useRef(false);
  const hasHydratedFromSessionRef = useRef(false);
  const latestDraftSectionsRef = useRef<DocumentSection[]>(draftSections);
  const hasPendingPersistRef = useRef(false);

  const catalogCategoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogEntries
            .map((entry) => entry.category.trim())
            .filter((category) => category.length > 0),
        ),
      ).sort((left, right) => left.localeCompare(right, "nb-NO")),
    [catalogEntries],
  );

  const filteredCatalogEntries = useMemo(() => {
    const normalizedSearch = catalogSearchTerm.trim().toLowerCase();

    return catalogEntries.filter((entry) => {
      if (catalogCategoryFilter !== CATALOG_FILTER_ALL && entry.category !== catalogCategoryFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        entry.productName,
        entry.nobbNumber,
        entry.supplierName,
        entry.sectionTitle,
        entry.category,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [catalogCategoryFilter, catalogEntries, catalogSearchTerm]);

  const selectedCatalogEntry = useMemo(
    () => filteredCatalogEntries.find((entry) => entry.id === selectedCatalogEntryId) ?? null,
    [filteredCatalogEntries, selectedCatalogEntryId],
  );

  useEffect(() => {
    const mappedSections = mapSectionsToDocument(sections, catalogEntries);

    setDraftSections(mappedSections);
    setOpenSections(sections.map(() => true));
    setAddMenuOpen(false);
    setSaveState("idle");
    hasHydratedForSaveRef.current = false;
    hasHydratedFromSessionRef.current = false;
    latestDraftSectionsRef.current = mappedSections;
    hasPendingPersistRef.current = false;
  }, [catalogEntries, sections]);

  useEffect(() => {
    latestDraftSectionsRef.current = draftSections;
  }, [draftSections]);

  useEffect(() => {
    if (!sessionStorageKey || persistToProject || readOnly || hasHydratedFromSessionRef.current) {
      return;
    }

    hasHydratedFromSessionRef.current = true;
    const stored = readSessionDraftSections(sessionStorageKey);

    if (!stored || stored.length === 0) {
      return;
    }

    setDraftSections(mapSectionsToDocument(stored, catalogEntries));
    setOpenSections(stored.map(() => true));
  }, [catalogEntries, persistToProject, readOnly, sessionStorageKey]);

  useEffect(() => {
    if (readOnly) {
      setAddMenuOpen(false);
    }
  }, [readOnly]);

  useEffect(() => {
    if (filteredCatalogEntries.length === 0) {
      setSelectedCatalogEntryId(null);
      return;
    }

    setSelectedCatalogEntryId((current) => {
      if (current && filteredCatalogEntries.some((entry) => entry.id === current)) {
        return current;
      }

      return filteredCatalogEntries[0]?.id ?? null;
    });
  }, [filteredCatalogEntries]);

  useEffect(() => {
    if (!productDialog) {
      setNobbDetails(null);
      setNobbError(null);
      setNobbLoading(false);
      return;
    }

    const row = productDialog.row;

    if (!row.nobbNumber) {
      setNobbDetails(null);
      setNobbError("Ingen NOBB-data tilgjengelig for dette produktet.");
      setNobbLoading(false);
      return;
    }

    let active = true;

    async function loadNobbDetails() {
      setNobbLoading(true);
      setNobbError(null);

      try {
        const response = await fetch(`/api/nobb/${encodeURIComponent(row.nobbNumber ?? "")}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Fant ikke NOBB-informasjon.");
        }

        const payload = (await response.json()) as NobbDetails;

        if (!active) {
          return;
        }

        setNobbDetails(payload);
      } catch (error) {
        if (!active) {
          return;
        }

        const message = error instanceof Error ? error.message : "Kunne ikke hente NOBB-informasjon.";
        setNobbError(message);
      } finally {
        if (active) {
          setNobbLoading(false);
        }
      }
    }

    void loadNobbDetails();

    return () => {
      active = false;
    };
  }, [productDialog]);

  useEffect(() => {
    if (!persistToProject || !projectSlug) {
      return;
    }

    if (!hasHydratedForSaveRef.current) {
      hasHydratedForSaveRef.current = true;
      return;
    }

    hasPendingPersistRef.current = true;
    const payloadSections = toMaterialSections(draftSections);

    const timeout = window.setTimeout(async () => {
      setSaveState("saving");

      try {
        const saved = await persistProjectMaterialList(projectSlug, payloadSections);

        if (!saved) {
          throw new Error("Kunne ikke lagre materiallisten.");
        }

        setSaveState("saved");
        hasPendingPersistRef.current = false;
      } catch {
        setSaveState("error");
        hasPendingPersistRef.current = true;
      }
    }, 700);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [draftSections, persistToProject, projectSlug]);

  useEffect(() => {
    if (!persistToProject || !projectSlug) {
      return;
    }

    return () => {
      if (!hasPendingPersistRef.current) {
        return;
      }

      const payloadSections = toMaterialSections(latestDraftSectionsRef.current);
      void persistProjectMaterialList(projectSlug, payloadSections, { keepalive: true });
    };
  }, [persistToProject, projectSlug]);

  useEffect(() => {
    if (!sessionStorageKey || persistToProject || readOnly) {
      return;
    }

    writeSessionDraftSections(sessionStorageKey, toMaterialSections(draftSections));
  }, [draftSections, persistToProject, readOnly, sessionStorageKey]);

  function toggleSection(sectionIndex: number) {
    setOpenSections((current) =>
      current.map((isOpen, currentIndex) => (currentIndex === sectionIndex ? !isOpen : isOpen)),
    );
  }

  function removeRow(sectionIndex: number, itemIndex: number) {
    if (readOnly) {
      return;
    }

    startTransition(() => {
      setDraftSections((current) =>
        current.map((section, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) {
            return section;
          }

          return {
            ...section,
            items: section.items.filter((_, currentItemIndex) => currentItemIndex !== itemIndex),
          };
        }),
      );
    });
  }

  function updateComment(sectionIndex: number, itemIndex: number, comment: string) {
    if (readOnly) {
      return;
    }

    setDraftSections((current) =>
      current.map((section, currentSectionIndex) => {
        if (currentSectionIndex !== sectionIndex) {
          return section;
        }

        return {
          ...section,
          items: section.items.map((row, currentItemIndex) =>
            currentItemIndex === itemIndex ? { ...row, comment } : row,
          ),
        };
      }),
    );
  }

  function updateCustomField(
    sectionIndex: number,
    itemIndex: number,
    key: "productName" | "quantity" | "comment",
    value: string,
  ) {
    if (readOnly) {
      return;
    }

    setDraftSections((current) =>
      current.map((section, currentSectionIndex) => {
        if (currentSectionIndex !== sectionIndex) {
          return section;
        }

        return {
          ...section,
          items: section.items.map((row, currentItemIndex) => {
            if (currentItemIndex !== itemIndex) {
              return row;
            }

            if (!row.customEditable) {
              return row;
            }

            return { ...row, [key]: value };
          }),
        };
      }),
    );
  }

  function updateQuantity(sectionIndex: number, itemIndex: number, quantity: string) {
    if (readOnly) {
      return;
    }

    setDraftSections((current) =>
      current.map((section, currentSectionIndex) => {
        if (currentSectionIndex !== sectionIndex) {
          return section;
        }

        return {
          ...section,
          items: section.items.map((row, currentItemIndex) =>
            currentItemIndex === itemIndex ? { ...row, quantity } : row,
          ),
        };
      }),
    );
  }

  function swapToAlternative(
    sectionIndex: number,
    itemIndex: number,
    alternative: MaterialCatalogEntry,
  ) {
    if (readOnly) {
      return;
    }

    setDraftSections((current) =>
      current.map((section, currentSectionIndex) => {
        if (currentSectionIndex !== sectionIndex) {
          return section;
        }

        return {
          ...section,
          items: section.items.map((row, currentItemIndex) => {
            if (currentItemIndex !== itemIndex) {
              return row;
            }

            return {
              ...row,
              productName: alternative.productName,
              nobbNumber: alternative.nobbNumber,
              supplierName: alternative.supplierName,
              unitPriceNok: alternative.unitPriceNok,
              category: alternative.category,
              imageUrl: undefined,
              productUrl: undefined,
              source: "catalog",
              customEditable: false,
            };
          }),
        };
      }),
    );

    setAlternativesRowId(null);
  }

  function addCatalogProduct() {
    if (readOnly) {
      return;
    }

    const selectedEntry = catalogEntries.find((entry) => entry.id === selectedCatalogEntryId);

    if (!selectedEntry) {
      return;
    }

    startTransition(() => {
      setDraftSections((current) => {
        const next = cloneSections(current);
        let targetSectionIndex = next.findIndex(
          (section) => section.title.toLowerCase() === selectedEntry.sectionTitle.toLowerCase(),
        );
        let createdSection = false;

        if (targetSectionIndex < 0) {
          next.push({
            title: selectedEntry.sectionTitle,
            description: "Automatisk kategori fra prisliste.",
            items: [],
          });
          targetSectionIndex = next.length - 1;
          createdSection = true;
        }

        next[targetSectionIndex].items.push({
          id: createRowId("catalog"),
          productName: selectedEntry.productName,
          quantity: selectedEntry.quantity,
          comment: selectedEntry.comment,
          quantityReason: selectedEntry.quantityReason,
          nobbNumber: selectedEntry.nobbNumber,
          supplierName: selectedEntry.supplierName,
          unitPriceNok: selectedEntry.unitPriceNok,
          category: selectedEntry.category,
          source: "catalog",
          customEditable: false,
        });

        if (createdSection) {
          setOpenSections((currentOpenSections) => [...currentOpenSections, true]);
        }

        return next;
      });
    });

    setAddMenuOpen(false);
  }

  async function analyzeWebProduct() {
    if (readOnly) {
      return;
    }

    const url = webProductDraft.url.trim();

    if (!url) {
      setWebProductDraft((current) => ({
        ...current,
        error: "Legg inn en gyldig produktlenke.",
      }));
      return;
    }

    setAddMenuOpen(false);
    setWebImportDialog({
      url,
      status: "analyzing",
    });

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
        reason?: "not_found" | "error";
        message?: string;
        product?: ImportedWebProduct;
      };

      if (!response.ok || !payload.ok || !payload.product) {
        setWebImportDialog({
          url,
          status: payload.reason === "not_found" ? "not_found" : "error",
          message: payload.message || "Fant ikke gyldig produkt på denne nettsiden.",
        });
        return;
      }

      applyImportedWebProduct(payload.product);
      setWebProductDraft({ url: "", error: "" });
      setWebImportDialog({
        url,
        status: "success",
        product: payload.product,
      });
    } catch {
      setWebImportDialog({
        url,
        status: "error",
        message: "Kunne ikke analysere lenken akkurat nå. Prøv igjen.",
      });
    }
  }

  function applyImportedWebProduct(product: ImportedWebProduct) {
    startTransition(() => {
      setDraftSections((current) => {
        const next = cloneSections(current);
        let targetSectionIndex = next.findIndex(
          (section) => section.title.toLowerCase() === CUSTOM_SECTION_TITLE.toLowerCase(),
        );
        let createdSection = false;

        if (targetSectionIndex < 0) {
          next.push({
            title: CUSTOM_SECTION_TITLE,
            description: "Produkter lagt inn fra nettkilder.",
            items: [],
          });
          targetSectionIndex = next.length - 1;
          createdSection = true;
        }

        next[targetSectionIndex].items.push({
          id: createRowId("web"),
          productName: product.productName,
          quantity: product.quantity || "1 stk",
          comment: product.comment,
          quantityReason: product.quantityReason || "Importert fra nettsideanalyse.",
          ...(product.nobbNumber ? { nobbNumber: product.nobbNumber } : {}),
          ...(product.supplierName ? { supplierName: product.supplierName } : {}),
          ...(product.unitPriceNok !== undefined ? { unitPriceNok: product.unitPriceNok } : {}),
          ...(product.productUrl ? { productUrl: product.productUrl } : {}),
          ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
          source: "web",
          customEditable: true,
        });

        if (createdSection) {
          setOpenSections((currentOpenSections) => [...currentOpenSections, true]);
        }

        return next;
      });
    });
  }

  function onDropToSection(targetSectionIndex: number) {
    if (readOnly) {
      return;
    }

    if (!dragSource) {
      return;
    }

    startTransition(() => {
      setDraftSections((current) => {
        const next = cloneSections(current);
        const sourceSection = next[dragSource.sectionIndex];
        const targetSection = next[targetSectionIndex];

        if (!sourceSection || !targetSection) {
          return current;
        }

        const [movedItem] = sourceSection.items.splice(dragSource.itemIndex, 1);

        if (!movedItem) {
          return current;
        }

        targetSection.items.push(movedItem);
        return next;
      });
    });

    setDragSource(null);
    setDragOverSectionIndex(null);
  }

  function saveCommentDialog() {
    if (!commentDialog) {
      return;
    }

    if (commentDialog.row.customEditable) {
      updateCustomField(commentDialog.sectionIndex, commentDialog.itemIndex, "comment", commentDialog.comment);
    } else {
      updateComment(commentDialog.sectionIndex, commentDialog.itemIndex, commentDialog.comment);
    }

    setCommentDialog(null);
  }

  return (
    <div className="overflow-hidden bg-white">
      <div className="relative flex items-center gap-2 border-b border-stone-200 bg-white px-4 py-2.5">
        {!readOnly ? (
          <button
            type="button"
            onClick={() => setAddMenuOpen((current) => !current)}
            className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-stone-900 bg-stone-900 px-3 text-[13px] font-semibold text-white transition hover:bg-stone-800"
          >
            <PlusIcon />
            Legg til produkt
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-stone-500">
          {saveState === "saving" ? <span>Lagrer …</span> : null}
          {saveState === "saved" ? <span className="text-emerald-700">Lagret</span> : null}
          {saveState === "error" ? <span className="text-rose-700">Lagring feilet</span> : null}
        </div>

        {!readOnly && addMenuOpen ? (
          <div
            className="fixed inset-0 z-[2147483000] flex items-start justify-center overflow-y-auto bg-stone-900/50 p-4 backdrop-blur-[2px] sm:items-center"
            onClick={() => setAddMenuOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Legg til produkt"
          >
            <div
              className="relative my-4 w-full max-w-3xl overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3.5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                    Legg til produkt
                  </p>
                  <h3 className="mt-0.5 text-[15px] font-semibold text-stone-900">
                    Søk i katalogen eller importer fra en lenke
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setAddMenuOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                  aria-label="Lukk"
                >
                  <CloseIcon />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-stone-200 bg-stone-50/60 px-5 pt-3">
                <ModalTab active={addMode === "catalog"} onClick={() => setAddMode("catalog")}>
                  <CatalogIcon /> Fra katalog
                </ModalTab>
                <ModalTab active={addMode === "web"} onClick={() => setAddMode("web")}>
                  <LinkIcon /> Fra nettlenke
                </ModalTab>
              </div>

              {addMode === "catalog" ? (
                <div className="flex flex-col">
                  {/* Search & filter */}
                  <div className="grid gap-2 border-b border-stone-200 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-stone-400" aria-hidden>
                        <SearchIcon />
                      </span>
                      <input
                        autoFocus
                        value={catalogSearchTerm}
                        onChange={(event) => setCatalogSearchTerm(event.target.value)}
                        placeholder="Søk på produkt, NOBB eller leverandør…"
                        className="h-10 w-full rounded-sm border border-stone-200 bg-white pl-9 pr-3 text-[13px] text-stone-900 outline-none focus:border-stone-900"
                      />
                    </div>
                    <select
                      value={catalogCategoryFilter}
                      onChange={(event) => setCatalogCategoryFilter(event.target.value)}
                      className="h-10 w-full rounded-sm border border-stone-200 bg-white px-2.5 text-[13px] text-stone-900 outline-none focus:border-stone-900"
                    >
                      <option value={CATALOG_FILTER_ALL}>Alle kategorier</option>
                      {catalogCategoryOptions.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Product grid */}
                  <div className="max-h-[55vh] min-h-[300px] overflow-y-auto px-3 py-3 sm:px-4">
                    {filteredCatalogEntries.length > 0 ? (
                      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {filteredCatalogEntries.slice(0, 80).map((entry) => {
                          const isSelected = selectedCatalogEntryId === entry.id;
                          const imgUrl = entry.nobbNumber ? buildNobbImageUrl(entry.nobbNumber, "SQUARE") : "";

                          return (
                            <li key={entry.id}>
                              <button
                                type="button"
                                onClick={() => setSelectedCatalogEntryId(entry.id)}
                                className={`group flex w-full items-start gap-3 rounded-md border p-2.5 text-left transition ${
                                  isSelected
                                    ? "border-stone-900 bg-stone-900/[0.03] ring-2 ring-stone-900"
                                    : "border-stone-200 bg-white hover:border-stone-400 hover:bg-stone-50"
                                }`}
                              >
                                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-sm border border-stone-200 bg-stone-50">
                                  {imgUrl ? (
                                    <img
                                      src={imgUrl}
                                      alt={entry.productName}
                                      loading="lazy"
                                      className="h-full w-full object-contain"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[9px] font-semibold uppercase text-stone-400">
                                      IMG
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="line-clamp-2 text-[13px] font-medium leading-tight text-stone-900">
                                    {entry.productName}
                                  </p>
                                  <p className="mt-1 truncate text-[11px] text-stone-500">
                                    NOBB {entry.nobbNumber} · {entry.supplierName}
                                  </p>
                                  <div className="mt-1.5 flex items-center justify-between gap-2">
                                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-600">
                                      {entry.category}
                                    </span>
                                    <span className="text-[12px] font-semibold text-stone-900">
                                      {entry.unitPriceNok > 0 ? formatCurrency(entry.unitPriceNok) : "—"}
                                    </span>
                                  </div>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-stone-200 bg-stone-50/60 px-4 text-center">
                        <p className="text-[13px] font-medium text-stone-700">Ingen treff</p>
                        <p className="text-[12px] text-stone-500">Prøv et annet søk eller velg en annen kategori.</p>
                      </div>
                    )}
                    {filteredCatalogEntries.length > 80 ? (
                      <p className="pt-2 text-center text-[11px] text-stone-500">
                        Viser de 80 mest relevante. Forfin søket for å se flere.
                      </p>
                    ) : null}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between gap-3 border-t border-stone-200 bg-stone-50/60 px-5 py-3">
                    <p className="min-w-0 truncate text-[12px] text-stone-600">
                      {selectedCatalogEntry ? (
                        <>
                          <span className="font-semibold text-stone-900">Valgt:</span>{" "}
                          {selectedCatalogEntry.productName}
                        </>
                      ) : (
                        <span className="text-stone-500">Velg et produkt for å legge det til</span>
                      )}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAddMenuOpen(false)}
                        className="inline-flex h-9 items-center rounded-sm border border-stone-200 bg-white px-3 text-[13px] font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                      >
                        Avbryt
                      </button>
                      <button
                        type="button"
                        onClick={addCatalogProduct}
                        disabled={!selectedCatalogEntryId || filteredCatalogEntries.length === 0}
                        className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-stone-900 bg-stone-900 px-3.5 text-[13px] font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-300"
                      >
                        <PlusIcon /> Legg til
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col">
                  <div className="space-y-3 px-5 py-5">
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                        Produktlenke
                      </label>
                      <div className="relative mt-1.5">
                        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-stone-400" aria-hidden>
                          <LinkIcon />
                        </span>
                        <input
                          autoFocus
                          value={webProductDraft.url}
                          onChange={(event) =>
                            setWebProductDraft((current) => ({
                              ...current,
                              url: event.target.value,
                              error: "",
                            }))
                          }
                          placeholder="https://"
                          className="h-10 w-full rounded-sm border border-stone-200 bg-white pl-9 pr-3 text-[13px] text-stone-900 outline-none focus:border-stone-900"
                        />
                      </div>
                      <p className="mt-2 text-[12px] text-stone-500">
                        Lim inn lenken til et produkt fra en byggevareforhandler. AI analyserer siden og foreslår oppføringen.
                      </p>
                    </div>

                    {webProductDraft.error ? (
                      <p className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                        {webProductDraft.error}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-50/60 px-5 py-3">
                    <button
                      type="button"
                      onClick={() => setAddMenuOpen(false)}
                      className="inline-flex h-9 items-center rounded-sm border border-stone-200 bg-white px-3 text-[13px] font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                    >
                      Avbryt
                    </button>
                    <button
                      type="button"
                      onClick={() => void analyzeWebProduct()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-stone-900 bg-stone-900 px-3.5 text-[13px] font-semibold text-white transition hover:bg-stone-800"
                    >
                      Analyser lenke
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {draftSections.map((section, sectionIndex) => {
        const isOpen = openSections[sectionIndex] ?? true;
        const isDropTarget = dragOverSectionIndex === sectionIndex;

        return (
          <section key={section.title} className={sectionIndex > 0 ? "border-t border-stone-200" : undefined}>
            <button
              type="button"
              onClick={() => toggleSection(sectionIndex)}
              className="flex w-full items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5 text-left transition hover:bg-stone-50"
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-sm bg-stone-100 text-stone-600 transition ${
                  isOpen ? "rotate-180" : ""
                }`}
                aria-hidden
              >
                <ChevronIcon />
              </span>
              <p className="flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-700">
                {section.title}
              </p>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-600">
                {section.items.length}
              </span>
            </button>

            {isOpen ? (
              <div
                className={isDropTarget ? "bg-amber-50/40" : "bg-white"}
                onDragOver={(event) => {
                  if (readOnly) {
                    return;
                  }

                  event.preventDefault();
                  setDragOverSectionIndex(sectionIndex);
                }}
                onDragLeave={() => setDragOverSectionIndex((current) => (current === sectionIndex ? null : current))}
                onDrop={(event) => {
                  if (readOnly) {
                    return;
                  }

                  event.preventDefault();
                  onDropToSection(sectionIndex);
                }}
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-[13px]">
                    <colgroup>
                      <col className="w-[58%]" />
                      <col className="w-[18%]" />
                      <col className="w-[24%]" />
                    </colgroup>
                    <thead>
                      <tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                        <th className="border-b border-stone-200 px-3 py-2 text-left">Produkt</th>
                        <th className="border-b border-stone-200 px-3 py-2 text-left">Mengde</th>
                        <th className="border-b border-stone-200 px-3 py-2 text-right" aria-label="Handlinger" />
                      </tr>
                    </thead>
                    <tbody>
                      {section.items.length > 0 ? (
                        section.items.flatMap((row, itemIndex) => {
                          const isExpanded = alternativesRowId === row.id;

                          const baseRow = (
                            <tr
                              key={row.id}
                              draggable={!readOnly}
                              onDragStart={() => {
                                if (!readOnly) {
                                  setDragSource({ sectionIndex, itemIndex });
                                }
                              }}
                              onDragEnd={() => {
                                setDragSource(null);
                                setDragOverSectionIndex(null);
                              }}
                              className={`${readOnly ? "" : "cursor-move"} ${
                                isExpanded ? "bg-stone-50/60" : "bg-white hover:bg-stone-50/40"
                              } align-top transition-colors`}
                            >
                              <td className="border-b border-stone-100 px-3 py-2.5 align-top">
                                <div className="flex min-w-0 items-start gap-3">
                                  <NobbProductThumbnail
                                    nobbNumber={row.nobbNumber}
                                    imageUrl={row.imageUrl}
                                    productName={row.productName}
                                    onPreview={(preview) =>
                                      setImagePreviewDialog(preview)
                                    }
                                  />
                                  <div className="min-w-0 flex-1">
                                    {row.customEditable && !readOnly ? (
                                      <input
                                        value={row.productName}
                                        onChange={(event) =>
                                          updateCustomField(sectionIndex, itemIndex, "productName", event.target.value)
                                        }
                                        className="h-8 w-full rounded-sm border border-stone-300 bg-white px-2 text-[13px] font-medium text-stone-900 outline-none focus:border-stone-900"
                                      />
                                    ) : (
                                      <>
                                        {row.nobbNumber ? (
                                          <a
                                            href={`https://nobb.no/item/${encodeURIComponent(row.nobbNumber)}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            title={row.productName}
                                            className="block w-full truncate text-left text-[13px] font-medium text-stone-900 hover:text-stone-600"
                                          >
                                            {row.productName}
                                          </a>
                                        ) : row.productUrl ? (
                                          <a
                                            href={row.productUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            title={row.productName}
                                            className="block w-full truncate text-left text-[13px] font-medium text-stone-900 hover:text-stone-600"
                                          >
                                            {row.productName}
                                          </a>
                                        ) : (
                                          <p title={row.productName} className="truncate text-[13px] font-medium text-stone-900">
                                            {row.productName}
                                          </p>
                                        )}
                                      </>
                                    )}
                                    <p className="mt-0.5 truncate text-[11px] text-stone-500">
                                      {row.nobbNumber ? `NOBB ${row.nobbNumber}` : "Ingen NOBB"}
                                      {row.supplierName ? ` · ${row.supplierName}` : ""}
                                      {typeof row.unitPriceNok === "number" && row.unitPriceNok > 0
                                        ? ` · ${formatCurrency(row.unitPriceNok)}`
                                        : ""}
                                    </p>
                                    <CommentLine
                                      comment={row.comment}
                                      readOnly={readOnly}
                                      onClick={() =>
                                        setCommentDialog({
                                          sectionIndex,
                                          itemIndex,
                                          sectionTitle: section.title,
                                          row,
                                          comment: row.comment,
                                        })
                                      }
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-stone-100 px-3 py-2.5 align-top">
                                <div className="flex min-h-8 min-w-[110px] items-center gap-1.5">
                                  {(allowQuantityEdit || row.customEditable) && !readOnly ? (
                                    <input
                                      value={row.quantity}
                                      onChange={(event) => updateQuantity(sectionIndex, itemIndex, event.target.value)}
                                      className="h-8 w-full rounded-sm border border-stone-300 bg-white px-2 text-[13px] text-stone-900 outline-none focus:border-stone-900"
                                    />
                                  ) : (
                                    <span className="truncate text-[13px] font-medium text-stone-900" title={row.quantity}>
                                      {row.quantity}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setQuantityDialog({ sectionTitle: section.title, row })}
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                                    title="Begrunnelse for mengdeberegning"
                                    aria-label="Vis begrunnelse for mengde"
                                  >
                                    <InfoIcon />
                                  </button>
                                </div>
                              </td>
                              <td className="border-b border-stone-100 px-3 py-2.5 align-top">
                                <div className="flex items-center justify-end gap-1">
                                  {!readOnly ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setAlternativesRowId((current) =>
                                          current === row.id ? null : row.id,
                                        )
                                      }
                                      className={`inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-[11px] font-semibold transition ${
                                        isExpanded
                                          ? "border-stone-900 bg-stone-900 text-white"
                                          : "border-stone-300 bg-white text-stone-700 hover:border-stone-900 hover:text-stone-900"
                                      }`}
                                      title="Se alternative produkter i samme kategori"
                                      aria-expanded={isExpanded}
                                    >
                                      <SwapIcon />
                                      <span className="hidden sm:inline">Alternativer</span>
                                    </button>
                                  ) : null}
                                  {!readOnly ? (
                                    <button
                                      type="button"
                                      onClick={() => removeRow(sectionIndex, itemIndex)}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-stone-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                                      title="Fjern produkt"
                                      aria-label="Fjern produkt"
                                    >
                                      <TrashIcon />
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );

                          if (!isExpanded) {
                            return [baseRow];
                          }

                          const expandedRow = (
                            <tr key={`${row.id}-alts`} className="bg-stone-50">
                              <td colSpan={3} className="border-b border-stone-200 px-3 py-3">
                                <AlternativesPanel
                                  current={row}
                                  sectionTitle={section.title}
                                  catalogEntries={catalogEntries}
                                  onClose={() => setAlternativesRowId(null)}
                                  onSelect={(entry) =>
                                    swapToAlternative(sectionIndex, itemIndex, entry)
                                  }
                                  onPreviewImage={(preview) =>
                                    setImagePreviewDialog(preview)
                                  }
                                />
                              </td>
                            </tr>
                          );

                          return [baseRow, expandedRow];
                        })
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-3 py-4 text-center text-sm text-stone-500">
                            Ingen produkter i kategorien. Dra produkter hit eller bruk Legg til.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </section>
        );
      })}

      {commentDialog ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-xl overflow-hidden rounded-md border border-stone-300 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-stone-900">Kommentar</p>
                <p className="text-xs text-stone-500">{commentDialog.sectionTitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setCommentDialog(null)}
                className="h-8 rounded-sm border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
              >
                Lukk
              </button>
            </div>
            <div className="space-y-2 p-4 text-sm text-stone-700">
              <div className="rounded-sm border border-stone-200 bg-stone-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Produkt</p>
                <p className="mt-0.5 text-[13px] text-stone-900">{commentDialog.row.productName}</p>
              </div>
              <div className="rounded-sm border border-stone-200 bg-stone-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Kommentar</p>
                {readOnly ? (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-stone-900">
                    {commentDialog.comment || "-"}
                  </p>
                ) : (
                  <textarea
                    value={commentDialog.comment}
                    onChange={(event) =>
                      setCommentDialog((current) =>
                        current
                          ? {
                              ...current,
                              comment: event.target.value,
                            }
                          : current,
                      )
                    }
                    rows={6}
                    className="mt-0.5 w-full rounded-sm border border-stone-300 bg-white px-2 py-1.5 text-[13px] leading-5 text-stone-900 outline-none focus:border-stone-900"
                  />
                )}
              </div>
              {!readOnly ? (
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCommentDialog(null)}
                    className="h-8 rounded-sm border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                  >
                    Avbryt
                  </button>
                  <button
                    type="button"
                    onClick={saveCommentDialog}
                    className="h-8 rounded-sm border border-stone-900 bg-stone-900 px-2.5 text-xs font-semibold text-white transition hover:bg-stone-800"
                  >
                    Lagre kommentar
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {quantityDialog ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-xl overflow-hidden rounded-md border border-stone-300 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-sm border border-stone-300 bg-white text-stone-700">
                  <InfoIcon />
                </span>
                <div>
                  <p className="text-sm font-semibold text-stone-900">Begrunnelse for mengde</p>
                  <p className="text-xs text-stone-500">{quantityDialog.sectionTitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQuantityDialog(null)}
                className="h-8 rounded-sm border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
              >
                Lukk
              </button>
            </div>
            <div className="space-y-2 p-4 text-sm text-stone-700">
              <div className="rounded-sm border border-stone-200 bg-stone-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Produkt</p>
                <p className="mt-0.5 text-[13px] text-stone-900">{quantityDialog.row.productName}</p>
              </div>
              <div className="rounded-sm border border-stone-200 bg-stone-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Mengde</p>
                <p className="mt-0.5 text-[13px] text-stone-900">{quantityDialog.row.quantity}</p>
              </div>
              <div className="rounded-sm border border-stone-200 bg-stone-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Begrunnelse</p>
                <p className="mt-0.5 text-[13px] leading-5 text-stone-900">{quantityDialog.row.quantityReason}</p>
              </div>
              {quantityDialog.row.nobbNumber ? (
                <div className="rounded-sm border border-stone-200 bg-stone-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">NOBB</p>
                  <a
                    href={`https://nobb.no/item/${encodeURIComponent(quantityDialog.row.nobbNumber)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex text-[13px] text-stone-900 underline underline-offset-2 hover:text-[var(--danger)]"
                  >
                    Åpne produktside ({quantityDialog.row.nobbNumber})
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {productDialog ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/45 p-4">
          <div className="w-full max-w-2xl border border-stone-300 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-stone-900">Produktoversikt</p>
                <p className="text-xs text-stone-500">
                  {productDialog.row.nobbNumber
                    ? `NOBB ${productDialog.row.nobbNumber}`
                    : "Ingen NOBB-kobling på dette produktet"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProductDialog(null)}
                className="h-8 border border-stone-300 bg-white px-2 text-xs font-semibold text-stone-700"
              >
                Lukk
              </button>
            </div>

            {nobbLoading ? <p className="mt-3 text-sm text-stone-600">Henter produktdata…</p> : null}
            {!nobbLoading && nobbError ? <p className="mt-3 text-sm text-[var(--danger)]">{nobbError}</p> : null}

            {!nobbLoading && nobbDetails ? (
              <div className="mt-3 grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
                <p>
                  <span className="font-semibold">Produkt:</span> {nobbDetails.productName}
                </p>
                <p>
                  <span className="font-semibold">Leverandør:</span> {nobbDetails.supplierName}
                </p>
                <p>
                  <span className="font-semibold">Merke:</span> {nobbDetails.brand}
                </p>
                <p>
                  <span className="font-semibold">Kategori:</span> {nobbDetails.category}
                </p>
                <p>
                  <span className="font-semibold">Enhet:</span> {nobbDetails.unit}
                </p>
                <p>
                  <span className="font-semibold">Pris i prisliste:</span>{" "}
                  {formatCurrency(nobbDetails.unitPriceNok)}
                </p>
                <p>
                  <span className="font-semibold">EAN:</span> {nobbDetails.ean ?? "Ikke oppgitt"}
                </p>
                <p>
                  <span className="font-semibold">Sist oppdatert:</span>{" "}
                  {nobbDetails.lastUpdated ?? "Ukjent"}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-semibold">Beskrivelse:</span>{" "}
                  {nobbDetails.description || "Ingen beskrivelse tilgjengelig."}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-semibold">Tekniske detaljer:</span>{" "}
                  {nobbDetails.technicalDetails.length > 0
                    ? nobbDetails.technicalDetails.join(" · ")
                    : "Ingen detaljer tilgjengelig."}
                </p>
                {nobbDetails.datasheetUrl ? (
                  <p className="sm:col-span-2">
                    <span className="font-semibold">Datablad:</span>{" "}
                    <a
                      href={nobbDetails.datasheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      Åpne datablad
                    </a>
                  </p>
                ) : null}
                <p className="sm:col-span-2 text-xs text-stone-500">
                  Datakilde: {nobbDetails.source === "nobb_api" ? "NOBB API" : "Prislister"}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {webImportDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-xl overflow-hidden rounded-md border border-stone-300 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-stone-900">Import fra nett</p>
                <p className="line-clamp-1 text-xs text-stone-500">{webImportDialog.url}</p>
              </div>
              <button
                type="button"
                onClick={() => setWebImportDialog(null)}
                className="h-8 rounded-sm border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
              >
                Lukk
              </button>
            </div>

            <div className="space-y-2 p-4 text-sm text-stone-700">
              {webImportDialog.status === "analyzing" ? (
                <>
                  <p className="text-sm text-stone-700">Analyserer nettsiden med AI og henter produktdata...</p>
                  <p className="text-xs text-stone-500">
                    Legg til-dialogen er lukket. Produkt legges automatisk til hvis analysen er gyldig.
                  </p>
                </>
              ) : null}

              {webImportDialog.status === "success" && webImportDialog.product ? (
                <>
                  <p className="rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Gyldig produkt funnet og lagt til i materiallisten.
                  </p>
                  <div className="rounded-sm border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
                    <p>
                      <span className="font-semibold text-stone-900">Produkt:</span> {webImportDialog.product.productName}
                    </p>
                    <p>
                      <span className="font-semibold text-stone-900">Mengde:</span> {webImportDialog.product.quantity}
                    </p>
                    {webImportDialog.product.nobbNumber ? (
                      <p>
                        <span className="font-semibold text-stone-900">NOBB:</span> {webImportDialog.product.nobbNumber}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {webImportDialog.status === "not_found" ? (
                <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {webImportDialog.message || "Fant ikke gyldig produkt fra nettsiden."}
                </p>
              ) : null}

              {webImportDialog.status === "error" ? (
                <p className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {webImportDialog.message || "Noe gikk galt under analyse av lenken."}
                </p>
              ) : null}

              {webImportDialog.status !== "analyzing" ? (
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setWebImportDialog(null)}
                    className="h-8 rounded-sm border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                  >
                    Lukk
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWebImportDialog(null);
                      setAddMode("web");
                      setAddMenuOpen(true);
                    }}
                    className="h-8 rounded-sm border border-stone-900 bg-stone-900 px-2.5 text-xs font-semibold text-white transition hover:bg-stone-800"
                  >
                    Prøv ny lenke
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {imagePreviewDialog ? (
        <NobbImagePreviewDialog
          key={imagePreviewDialog.imageUrl}
          productName={imagePreviewDialog.productName}
          imageUrl={imagePreviewDialog.imageUrl}
          nobbNumber={imagePreviewDialog.nobbNumber}
          onClose={() => setImagePreviewDialog(null)}
        />
      ) : null}
    </div>
  );
}

function NobbProductThumbnail({
  nobbNumber,
  imageUrl,
  productName,
  onPreview,
}: {
  nobbNumber?: string;
  imageUrl?: string;
  productName: string;
  onPreview?: (preview: ImagePreviewDialogState) => void;
}) {
  const [brokenImageSrc, setBrokenImageSrc] = useState("");

  const resolvedImageUrl = nobbNumber ? buildNobbImageUrl(nobbNumber, "SQUARE") : imageUrl || "";
  const canRenderImage = resolvedImageUrl.length > 0 && brokenImageSrc !== resolvedImageUrl;

  if (!canRenderImage) {
    return (
      <div className="mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-sm border border-stone-300 bg-stone-50">
        <div className="flex h-full w-full items-center justify-center text-[9px] font-semibold uppercase tracking-[0.06em] text-stone-500">
          IMG
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        onPreview?.({
          productName,
          imageUrl: nobbNumber ? buildNobbImageUrl(nobbNumber, "ORIGINAL") : resolvedImageUrl,
          ...(nobbNumber ? { nobbNumber } : {}),
        })
      }
      className="mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-sm border border-stone-300 bg-stone-50 transition hover:border-stone-900"
      title="Vis bilde"
      aria-label="Vis produktbilde"
    >
      <img
        src={resolvedImageUrl}
        alt={productName}
        loading="lazy"
        draggable={false}
        onError={() => setBrokenImageSrc(resolvedImageUrl)}
        className="h-full w-full object-contain object-center"
      />
    </button>
  );
}

function NobbImagePreviewDialog({
  imageUrl,
  productName,
  nobbNumber,
  onClose,
}: {
  imageUrl: string;
  productName: string;
  nobbNumber?: string;
  onClose: () => void;
}) {
  const [imageSrc, setImageSrc] = useState(() => imageUrl);
  const [usedFallback, setUsedFallback] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-md border border-stone-300 bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-stone-900">Produktbilde</p>
            <p className="text-xs text-stone-500">
              {productName}
              {nobbNumber ? ` · NOBB ${nobbNumber}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-sm border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
          >
            Lukk
          </button>
        </div>
        <div className="flex min-h-[360px] items-center justify-center bg-stone-100 p-4 sm:p-6">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={productName}
              onError={() => {
                if (nobbNumber && !usedFallback) {
                  setImageSrc(buildNobbImageUrl(nobbNumber, "SQUARE"));
                  setUsedFallback(true);
                  return;
                }

                setImageSrc("");
              }}
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          ) : (
            <p className="text-sm text-stone-600">Fant ikke bilde for dette produktet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function buildNobbImageUrl(nobbNumber: string, imageSize: "SQUARE" | "ORIGINAL") {
  return `https://export.byggtjeneste.no/api/v1/media/images/items/${encodeURIComponent(nobbNumber)}/${imageSize}`;
}

function findAlternatives(
  row: MaterialRow,
  sectionTitle: string,
  catalogEntries: MaterialCatalogEntry[],
  options?: { searchTerm?: string; limit?: number },
) {
  const searchTerm = (options?.searchTerm ?? "").trim().toLowerCase();
  const limit = options?.limit ?? 30;

  const rowCategory = (row.category ?? "").trim().toLowerCase();
  const sectionKey = sectionTitle.trim().toLowerCase();
  const rowTokens = extractProductTokens(row.productName);
  const primaryToken = rowTokens[0] ?? "";

  const sameCategory = catalogEntries.filter((entry) => {
    if (row.nobbNumber && entry.nobbNumber === row.nobbNumber) {
      return false;
    }

    if (rowCategory) {
      return entry.category.trim().toLowerCase() === rowCategory;
    }

    return entry.sectionTitle.trim().toLowerCase() === sectionKey;
  });

  const scored = sameCategory
    .map((entry) => {
      const entryTokens = extractProductTokens(entry.productName);
      const overlap = rowTokens.filter((token) => entryTokens.includes(token)).length;
      const matchesPrimary = primaryToken.length > 0 && entryTokens.includes(primaryToken);

      return { entry, score: overlap, matchesPrimary, entryTokens };
    })
    // Require sharing the leading product-type token when one exists.
    // Falls back to overlap > 0 when no primary token could be derived.
    .filter((candidate) => {
      if (primaryToken) {
        return candidate.matchesPrimary;
      }
      return candidate.score > 0;
    });

  const filtered = searchTerm
    ? scored.filter(({ entry }) => {
        const haystack = [
          entry.productName,
          entry.nobbNumber,
          entry.supplierName,
          entry.category,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(searchTerm);
      })
    : scored;

  return filtered
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const priceA = Number.isFinite(a.entry.unitPriceNok) ? a.entry.unitPriceNok : Number.POSITIVE_INFINITY;
      const priceB = Number.isFinite(b.entry.unitPriceNok) ? b.entry.unitPriceNok : Number.POSITIVE_INFINITY;
      return priceA - priceB;
    })
    .slice(0, limit)
    .map(({ entry }) => entry);
}

const PRODUCT_STOPWORDS = new Set([
  "med",
  "uten",
  "for",
  "til",
  "som",
  "stk",
  "pak",
  "set",
  "ubh",
  "obh",
  "ny",
  "gr",
  "lm",
  "tk",
]);

function extractProductTokens(productName: string) {
  return productName
    .toLowerCase()
    .split(/[^a-z0-9æøå]+/i)
    .map((token) => token.trim())
    .filter((token) => {
      if (token.length < 3) return false;
      if (/^\d+$/.test(token)) return false;
      // Drop dimension-like tokens such as "1x25m", "120x30", "18mm"
      if (/^\d+[a-z]/i.test(token)) return false;
      if (/^[a-z]\d+/i.test(token)) return false;
      if (PRODUCT_STOPWORDS.has(token)) return false;
      return true;
    });
}

function mapSectionsToDocument(
  sections: MaterialSection[],
  catalogEntries: MaterialCatalogEntry[],
): DocumentSection[] {
  return sections.map((section, sectionIndex) => ({
    title: section.title,
    description: section.description,
    items: section.items.map((item, itemIndex) => {
      const catalogMatch = findCatalogMatch(item.item, item.nobb, catalogEntries);
      const storedQuantityReason = normalizeOptionalText(item.quantityReason ?? "");
      const inferredNobbNumber =
        normalizeNobbNumber(item.nobb) ??
        catalogMatch?.nobbNumber ??
        extractNobbNumber(item.note) ??
        extractNobbNumber(item.item) ??
        undefined;
      const hasWebMetadata = Boolean(item.sourceUrl || item.imageUrl);
      const hasCustomSection = section.title.toLowerCase() === CUSTOM_SECTION_TITLE.toLowerCase();

      return {
        id: `${slugLike(section.title)}-${sectionIndex}-${itemIndex}`,
        productName: item.item,
        quantity: item.quantity,
        comment: item.note,
        quantityReason:
          storedQuantityReason ||
          catalogMatch?.quantityReason ||
          `Automatisk beregning fra prosjektdata for kategori "${section.title}".`,
        nobbNumber: inferredNobbNumber,
        ...(item.sourceUrl ? { productUrl: item.sourceUrl } : {}),
        ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
        supplierName: item.supplierName || catalogMatch?.supplierName,
        unitPriceNok: item.unitPriceNok ?? catalogMatch?.unitPriceNok,
        category: catalogMatch?.category,
        source: hasWebMetadata ? "web" : "generated",
        customEditable: hasWebMetadata || hasCustomSection,
      };
    }),
  }));
}

function cloneSections(sections: DocumentSection[]) {
  return sections.map((section) => ({
    ...section,
    items: [...section.items],
  }));
}

function createRowId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function slugLike(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findCatalogMatch(itemName: string, itemNobb: string | undefined, catalogEntries: MaterialCatalogEntry[]) {
  const normalizedNobb = normalizeNobbNumber(itemNobb);

  if (normalizedNobb) {
    const directByNobb = catalogEntries.find((entry) => entry.nobbNumber === normalizedNobb);

    if (directByNobb) {
      return directByNobb;
    }
  }

  const needle = itemName.trim().toLowerCase();

  if (!needle) {
    return null;
  }

  for (const entry of catalogEntries) {
    const haystack = entry.productName.toLowerCase();

    if (haystack.includes(needle) || needle.includes(haystack)) {
      return entry;
    }
  }

  return null;
}

function toMaterialSections(sections: DocumentSection[]): MaterialSection[] {
  return sections.map((section) => ({
    title: normalizeText(section.title, "Kategori"),
    description: normalizeText(section.description, "Automatisk kategori"),
    items: section.items.map((row): MaterialItem => {
      const normalizedQuantityReason = normalizeOptionalText(row.quantityReason);
      const normalizedNobb = normalizeNobbNumber(row.nobbNumber);

      return {
        item: normalizeText(row.productName, "Produkt"),
        quantity: normalizeText(row.quantity, "1 stk"),
        note: normalizeText(row.comment, ""),
        ...(normalizedQuantityReason ? { quantityReason: normalizedQuantityReason } : {}),
        ...(normalizedNobb ? { nobb: normalizedNobb } : {}),
        ...(normalizeOptionalText(row.productUrl ?? "") ? { sourceUrl: normalizeOptionalText(row.productUrl ?? "") } : {}),
        ...(normalizeOptionalText(row.imageUrl ?? "") ? { imageUrl: normalizeOptionalText(row.imageUrl ?? "") } : {}),
        ...(normalizeOptionalText(row.supplierName ?? "") ? { supplierName: normalizeOptionalText(row.supplierName ?? "") } : {}),
        ...(typeof row.unitPriceNok === "number" && Number.isFinite(row.unitPriceNok)
          ? { unitPriceNok: Math.max(0, Math.round(row.unitPriceNok)) }
          : {}),
      };
    }),
  }));
}

function extractNobbNumber(value: string) {
  const match = value.match(/\b(\d{6,10})\b/);
  return match ? match[1] : null;
}

function normalizeNobbNumber(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\D/g, "");
  return normalized.length >= 6 && normalized.length <= 10 ? normalized : null;
}

function normalizeText(value: string, fallback: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeOptionalText(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "";
}

function readSessionDraftSections(storageKey: string) {
  try {
    const raw = window.sessionStorage.getItem(storageKey);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed as MaterialSection[];
  } catch {
    return null;
  }
}

function writeSessionDraftSections(storageKey: string, sections: MaterialSection[]) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(sections));
  } catch {
    // Best effort persistence only.
  }
}

async function persistProjectMaterialList(
  projectSlug: string,
  materialSections: MaterialSection[],
  options?: { keepalive?: boolean },
) {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/material-list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ materialSections }),
      keepalive: options?.keepalive ?? false,
    });

    return response.ok;
  } catch {
    return false;
  }
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="6" r="1" fill="currentColor" />
      <path d="M10 8.8V13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M5 7h10l-2.5-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 13H5l2.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M4 6h12M8.5 6V4.5h3V6M6.5 6v9.5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3 w-3">
      <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CommentLine({
  comment,
  readOnly,
  onClick,
}: {
  comment: string;
  readOnly: boolean;
  onClick: () => void;
}) {
  if (!comment && readOnly) {
    return null;
  }

  if (!comment) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="mt-1 inline-flex items-center gap-1 text-[11px] text-stone-400 transition hover:text-stone-700"
      >
        <span aria-hidden>＋</span>
        <span>Legg til kommentar</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={comment}
      disabled={readOnly}
      className="mt-1 flex max-w-full items-start gap-1.5 text-left text-[11px] leading-4 text-stone-600 transition hover:text-stone-900 disabled:cursor-default disabled:hover:text-stone-600"
    >
      <span aria-hidden className="mt-0.5 inline-block h-1 w-1 shrink-0 rounded-full bg-amber-500" />
      <span className="line-clamp-2">{comment}</span>
    </button>
  );
}

function AlternativesPanel({
  current,
  sectionTitle,
  catalogEntries,
  onClose,
  onSelect,
  onPreviewImage,
}: {
  current: MaterialRow;
  sectionTitle: string;
  catalogEntries: MaterialCatalogEntry[];
  onClose: () => void;
  onSelect: (entry: MaterialCatalogEntry) => void;
  onPreviewImage: (preview: ImagePreviewDialogState) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");

  const alternatives = useMemo(
    () =>
      findAlternatives(current, sectionTitle, catalogEntries, {
        searchTerm,
        limit: 30,
      }),
    [catalogEntries, current, sectionTitle, searchTerm],
  );

  const headerLabel = current.category || sectionTitle || "Lignende produkter";

  return (
    <div className="rounded-md border border-stone-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
            Lignende produkter
          </p>
          <p className="mt-0.5 truncate text-[12px] text-stone-700">
            <span className="font-medium">{headerLabel}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 items-center rounded-sm border border-stone-200 bg-white px-2 text-[11px] font-semibold text-stone-600 transition hover:border-stone-900 hover:text-stone-900"
        >
          Lukk
        </button>
      </div>
      <div className="border-b border-stone-100 px-3 py-2">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-stone-400" aria-hidden>
            <SearchIcon />
          </span>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Søk blant alternativer (navn, NOBB, leverandør)…"
            className="h-9 w-full rounded-sm border border-stone-200 bg-white pl-8 pr-2 text-[13px] text-stone-900 outline-none focus:border-stone-900"
          />
        </div>
      </div>
      {alternatives.length === 0 ? (
        <p className="px-3 py-4 text-center text-[12px] text-stone-500">
          {searchTerm
            ? `Ingen treff for «${searchTerm}».`
            : `Fant ingen lignende produkter${current.category ? ` i kategorien «${current.category}»` : ""}.`}
        </p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-stone-100 overflow-y-auto">
          {alternatives.map((entry) => {
            const imgUrl = entry.nobbNumber ? buildNobbImageUrl(entry.nobbNumber, "SQUARE") : "";
            const isCurrent = entry.nobbNumber === current.nobbNumber;
            return (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2 transition hover:bg-stone-50"
              >
                <button
                  type="button"
                  onClick={() =>
                    onPreviewImage({
                      productName: entry.productName,
                      imageUrl: entry.nobbNumber ? buildNobbImageUrl(entry.nobbNumber, "ORIGINAL") : imgUrl,
                      ...(entry.nobbNumber ? { nobbNumber: entry.nobbNumber } : {}),
                    })
                  }
                  className="h-12 w-12 shrink-0 overflow-hidden rounded-sm border border-stone-200 bg-stone-50"
                  title="Vis bilde"
                  aria-label={`Vis bilde av ${entry.productName}`}
                >
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt={entry.productName}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] font-semibold uppercase text-stone-400">
                      IMG
                    </div>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-stone-900" title={entry.productName}>
                    {entry.productName}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-stone-500">
                    NOBB {entry.nobbNumber} · {entry.supplierName}
                  </p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="text-[13px] font-semibold text-stone-900">
                    {entry.unitPriceNok > 0 ? formatCurrency(entry.unitPriceNok) : "—"}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.1em] text-stone-400">stk-pris</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  disabled={isCurrent}
                  className="inline-flex h-8 shrink-0 items-center rounded-sm border border-stone-900 bg-stone-900 px-2.5 text-[11px] font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-300"
                >
                  Bytt til denne
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CatalogIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <rect x="3" y="3.5" width="14" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M8 12l4-4M9 6h3a3 3 0 0 1 0 6h-1M11 14H8a3 3 0 0 1 0-6h1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ModalTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center gap-1.5 px-3 pb-2.5 pt-1.5 text-[12px] font-semibold transition ${
        active ? "text-stone-900" : "text-stone-500 hover:text-stone-800"
      }`}
    >
      {children}
      <span
        className={`absolute inset-x-0 bottom-0 h-[2px] transition ${
          active ? "bg-stone-900" : "bg-transparent"
        }`}
        aria-hidden
      />
    </button>
  );
}
