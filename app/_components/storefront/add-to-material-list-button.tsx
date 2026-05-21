"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export const PENDING_MATERIAL_LIST_PRODUCTS_KEY = "prisbygg_pending_material_list_products_v1";

type PendingMaterialListProduct = {
  source: "catalog";
  productName: string;
  quantity: string;
  comment: string;
  quantityReason: string;
  nobbNumber?: string;
  supplierName?: string;
  unitPriceNok?: number;
  productUrl?: string;
  imageUrl?: string;
  sectionTitle?: string;
  category?: string;
};

type AddToMaterialListButtonProps = PendingMaterialListProduct & {
  compact?: boolean;
};

type MaterialListSummary = {
  slug: string;
  title: string;
  paymentStatus: "locked" | "paid";
  lineCount: number;
  createdAt?: string;
};

export function AddToMaterialListButton({ compact = false, ...product }: AddToMaterialListButtonProps) {
  const [added, setAdded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [listsPending, setListsPending] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [submitPending, setSubmitPending] = useState<string | null>(null);
  const [materialLists, setMaterialLists] = useState<MaterialListSummary[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredMaterialLists = (materialLists ?? []).filter((list) => {
    if (!normalizedSearchTerm) {
      return true;
    }

    return list.title.toLowerCase().includes(normalizedSearchTerm);
  });

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (triggerRef.current?.contains(target) || menuPanelRef.current?.contains(target)) {
        return;
      }

      if (menuOpen) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null);
      setSearchTerm("");
      return;
    }

    function syncPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      const width = compact ? 320 : 352;
      const viewportPadding = 12;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - width),
        window.innerWidth - width - viewportPadding,
      );

      setMenuPosition({
        top: Math.min(rect.bottom + 8, window.innerHeight - viewportPadding),
        left,
        width,
      });
    }

    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);

    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [compact, menuOpen]);

  async function handleClick() {
    if (authPending || listsPending || submitPending) {
      return;
    }

    if (menuOpen) {
      setMenuOpen(false);
      return;
    }

    setErrorMessage(null);
    setAuthPending(true);

    try {
      const supabase = createSupabaseBrowserClient();

      if (!supabase) {
        setErrorMessage("Innlogging er ikke tilgjengelig akkurat nå.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        redirectToLogin(buildNextPath(pathname, searchParams));
        return;
      }

      setMenuOpen(true);

      if (materialLists !== null) {
        return;
      }

      setListsPending(true);
      const response = await fetch("/api/material-lists", {
        method: "GET",
        cache: "no-store",
      });

      if (response.status === 401) {
        redirectToLogin(buildNextPath(pathname, searchParams));
        return;
      }

      if (!response.ok) {
        throw new Error("Kunne ikke hente materiallister.");
      }

      const payload = (await response.json()) as { materialLists?: MaterialListSummary[] };
      setMaterialLists(Array.isArray(payload.materialLists) ? payload.materialLists : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kunne ikke hente materiallister.";
      setErrorMessage(message);
    } finally {
      setAuthPending(false);
      setListsPending(false);
    }
  }

  async function handleSelectList(slug: string) {
    if (submitPending) {
      return;
    }

    setSubmitPending(slug);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/material-list-items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product }),
      });

      if (response.status === 401) {
        redirectToLogin(buildNextPath(pathname, searchParams));
        return;
      }

      const payload = (await response.json()) as { error?: string; duplicate?: boolean };

      if (!response.ok) {
        throw new Error(payload.error ?? "Kunne ikke legge produktet i materiallisten.");
      }

      setAdded(true);
      setMenuOpen(false);

      window.setTimeout(() => {
        setAdded(false);
      }, 1800);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kunne ikke legge produktet i materiallisten.";
      setErrorMessage(message);
    } finally {
      setSubmitPending(null);
    }
  }

  function handleCreateMaterialListRedirect() {
    try {
      const existing = readPendingProducts();
      const duplicate = existing.some((entry) => {
        if (product.nobbNumber && entry.nobbNumber === product.nobbNumber) return true;
        if (product.productUrl && entry.productUrl === product.productUrl) return true;
        return entry.productName.toLowerCase() === product.productName.toLowerCase();
      });
      const next = duplicate ? existing : [product, ...existing].slice(0, 20);
      window.sessionStorage.setItem(PENDING_MATERIAL_LIST_PRODUCTS_KEY, JSON.stringify(next));
    } catch {
      // Keep navigation working even if sessionStorage is unavailable.
    }

    window.location.href = "/min-side/materiallister?nyMaterialliste=1";
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          void handleClick();
        }}
        className={
          compact
            ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 shadow-sm transition hover:border-[#15452d] hover:bg-[#15452d] hover:text-white disabled:cursor-wait disabled:opacity-70"
            : "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 shadow-sm transition hover:border-[#15452d] hover:bg-[#15452d] hover:text-white disabled:cursor-wait disabled:opacity-70"
        }
        disabled={authPending || listsPending || submitPending !== null}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        aria-label={added ? "Produkt lagt i materialliste" : "Legg til i materialliste"}
        title={added ? "Produkt lagt i materialliste" : "Legg til i materialliste"}
      >
        {added ? <CheckIcon /> : <PlusIcon />}
      </button>

      {menuOpen && menuPosition
        ? createPortal(
            <div
              ref={menuPanelRef}
              className="z-[80] rounded-lg border border-stone-200 bg-white p-2.5 shadow-[0_18px_38px_rgba(15,39,27,0.16)]"
              style={{
                position: "fixed",
                top: menuPosition.top,
                left: menuPosition.left,
                width: menuPosition.width,
              }}
              role="dialog"
              aria-label="Velg materialliste"
            >
              <div className="mb-2 space-y-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Materialliste</p>
                  <p className="mt-0.5 text-xs font-medium text-stone-900">Velg liste</p>
                </div>

                {!listsPending && materialLists && materialLists.length > 0 ? (
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Søk etter liste"
                    className="h-8 w-full rounded-md border border-stone-200 bg-stone-50 px-2.5 text-xs text-stone-700 outline-none transition placeholder:text-stone-400 focus:border-[#15452d] focus:bg-white"
                  />
                ) : null}
              </div>

              {listsPending ? <p className="px-1 py-2 text-xs text-stone-500">Henter listene dine …</p> : null}

              {errorMessage ? <p className="rounded-md bg-rose-50 px-2.5 py-2 text-xs text-rose-700">{errorMessage}</p> : null}

              {!listsPending && materialLists && materialLists.length > 0 ? (
                <div className="max-h-[228px] space-y-1.5 overflow-y-auto pr-1">
                  {filteredMaterialLists.map((list) => {
                    const isSubmitting = submitPending === list.slug;

                    return (
                      <button
                        key={list.slug}
                        type="button"
                        onClick={() => {
                          void handleSelectList(list.slug);
                        }}
                        disabled={submitPending !== null}
                        className="flex w-full items-center justify-between gap-2.5 rounded-md border border-stone-200 px-2.5 py-2 text-left transition hover:border-[#15452d] hover:bg-stone-50 disabled:cursor-wait disabled:opacity-70"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-stone-900">{list.title}</span>
                          <span className="mt-0.5 block text-[11px] text-stone-500">
                            {list.lineCount} linjer · {list.paymentStatus === "paid" ? "aktiv" : "kladd"}
                          </span>
                        </span>
                        <span className="text-[11px] font-semibold text-[#15452d]">{isSubmitting ? "Lagrer …" : "Velg"}</span>
                      </button>
                    );
                  })}

                  {filteredMaterialLists.length === 0 ? (
                    <p className="rounded-md border border-dashed border-stone-200 px-2.5 py-3 text-xs text-stone-500">
                      Fant ingen lister.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!listsPending && materialLists && materialLists.length === 0 ? (
                <div className="space-y-2.5 rounded-md border border-dashed border-stone-200 bg-stone-50 px-2.5 py-3">
                  <p className="text-xs text-stone-600">Du har ingen materiallister ennå.</p>
                  <button
                    type="button"
                    onClick={handleCreateMaterialListRedirect}
                    className="inline-flex h-8 items-center justify-center rounded-md bg-[#15452d] px-3 text-xs font-semibold text-white transition hover:bg-[#1b5b3c]"
                  >
                    Lag materialliste
                  </button>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function buildNextPath(pathname: string | null, searchParams: ReturnType<typeof useSearchParams>) {
  const basePath = pathname || "/";
  const query = searchParams.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function redirectToLogin(nextPath: string) {
  window.location.href = `/login?next=${encodeURIComponent(nextPath)}`;
}

function readPendingProducts(): PendingMaterialListProduct[] {
  const raw = window.sessionStorage.getItem(PENDING_MATERIAL_LIST_PRODUCTS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is PendingMaterialListProduct => {
      return Boolean(
        entry &&
          typeof entry === "object" &&
          (entry as PendingMaterialListProduct).source === "catalog" &&
          typeof (entry as PendingMaterialListProduct).productName === "string" &&
          typeof (entry as PendingMaterialListProduct).quantity === "string",
      );
    });
  } catch {
    return [];
  }
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M4.5 10.5l3.2 3.2 7.8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}