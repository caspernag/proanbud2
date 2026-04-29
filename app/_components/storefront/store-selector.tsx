"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  findNearestStore,
  STOREFRONT_SELECTED_STORE_COOKIE,
  STOREFRONT_SELECTED_STORE_STORAGE_KEY,
  type StorefrontStoreOption,
} from "@/lib/storefront-store-selection";

type StoreSelectorProps = {
  stores: StorefrontStoreOption[];
  selectedStoreId?: string;
  compact?: boolean;
  variant?: "card" | "nav";
};

export function StoreSelector({ stores, selectedStoreId = "", compact = false, variant = "card" }: StoreSelectorProps) {
  const [value, setValue] = useState(selectedStoreId);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedStore = useMemo(
    () => stores.find((store) => store.id === value) ?? null,
    [stores, value],
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (stores.length === 0) {
    return null;
  }

  if (variant === "nav") {
    return (
      <div ref={containerRef} className="relative flex shrink-0 items-center gap-1.5 rounded-md border border-stone-200 bg-stone-50 px-2 py-1">
        <span className="hidden text-[11px] font-bold uppercase tracking-[0.12em] text-stone-500 xl:inline">
          Velg butikk
        </span>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-8 max-w-[220px] items-center gap-2 rounded-sm border border-stone-300 bg-white px-2 text-left text-[12px] font-semibold text-stone-800 outline-none transition hover:border-[#15452d]"
          aria-expanded={open}
          aria-label="Velg butikk"
        >
          <span className="min-w-0 flex-1 truncate">{selectedStore ? selectedStore.name : "Nettlager"}</span>
          <ChevronIcon open={open} />
        </button>
        <button
          type="button"
          onClick={useMyPosition}
          className="h-8 rounded-sm border border-stone-300 bg-white px-2 text-[12px] font-semibold text-stone-700 transition hover:border-[#15452d] hover:text-[#15452d]"
        >
          Min posisjon
        </button>
        {open ? (
          <StoreOptionsMenu
            stores={stores}
            selectedStoreId={value}
            onSelect={(storeId) => selectStore(storeId)}
            className="right-0 top-[calc(100%+0.4rem)] w-[360px]"
          />
        ) : null}
      </div>
    );
  }

  function selectStore(nextStoreId: string, options?: { reload?: boolean; notice?: string }) {
    setValue(nextStoreId);
    setOpen(false);
    setMessage(options?.notice ?? "");

    try {
      if (nextStoreId) {
        window.localStorage.setItem(STOREFRONT_SELECTED_STORE_STORAGE_KEY, nextStoreId);
        document.cookie = `${STOREFRONT_SELECTED_STORE_COOKIE}=${encodeURIComponent(nextStoreId)}; Path=/; Max-Age=31536000; SameSite=Lax`;
      } else {
        window.localStorage.removeItem(STOREFRONT_SELECTED_STORE_STORAGE_KEY);
        document.cookie = `${STOREFRONT_SELECTED_STORE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
      }
    } catch {
      // Ignore persistence errors; UI still updates in-memory.
    }

    if (options?.reload !== false) {
      window.setTimeout(() => window.location.reload(), options?.notice ? 450 : 0);
    }
  }

  function useMyPosition() {
    setMessage("");

    if (!navigator.geolocation) {
      setMessage("Posisjon er ikke tilgjengelig i denne nettleseren.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nearest = findNearestStore(stores, {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });

        if (!nearest) {
          setMessage("Fant ingen butikker med posisjonsdata.");
          return;
        }

        selectStore(nearest.store.id, {
          notice: `Valgte ${nearest.store.name} (${Math.round(nearest.distance)} km unna).`,
        });
      },
      () => setMessage("Kunne ikke hente posisjon. Velg butikk manuelt."),
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 },
    );
  }

  return (
    <div ref={containerRef} className={compact ? "relative rounded-xl border border-stone-200 bg-white p-3" : "relative rounded-xl border border-stone-200 bg-white p-3 shadow-[0_8px_20px_rgba(32,25,15,0.06)]"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">Velg butikk</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-stone-900">
            {selectedStore ? selectedStore.name : "Nettlager"}
          </p>
        </div>
        <button
          type="button"
          onClick={useMyPosition}
          className="shrink-0 rounded-full border border-stone-300 px-2.5 py-1 text-[11px] font-semibold text-stone-700 transition hover:border-[#15452d] hover:text-[#15452d]"
        >
          Min posisjon
        </button>
      </div>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mt-2 flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-stone-300 bg-white px-2.5 py-2 text-left text-sm font-medium text-stone-900 outline-none transition hover:border-[#15452d]"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block truncate">{selectedStore ? selectedStore.name : "Nettlager / alle butikker"}</span>
          {selectedStore?.address ? (
            <span className="mt-0.5 block truncate text-xs font-normal text-stone-500">{selectedStore.address}</span>
          ) : null}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open ? (
        <StoreOptionsMenu
          stores={stores}
          selectedStoreId={value}
          onSelect={(storeId) => selectStore(storeId)}
          className="left-0 top-[calc(100%+0.35rem)] w-full"
        />
      ) : null}

      {message ? <p className="mt-2 text-[11px] font-medium text-stone-500">{message}</p> : null}
    </div>
  );
}

function StoreOptionsMenu({
  stores,
  selectedStoreId,
  onSelect,
  className,
}: {
  stores: StorefrontStoreOption[];
  selectedStoreId: string;
  onSelect: (storeId: string) => void;
  className: string;
}) {
  return (
    <div className={`absolute z-50 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl ${className}`}>
      <div className="border-b border-stone-100 p-1.5">
        <button
          type="button"
          onClick={() => onSelect("")}
          className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition ${
            selectedStoreId === "" ? "bg-[#15452d] text-white" : "text-stone-800 hover:bg-stone-50"
          }`}
        >
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-current opacity-70" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Nettlager / alle butikker</span>
            <span className={`mt-0.5 block text-xs ${selectedStoreId === "" ? "text-white/75" : "text-stone-500"}`}>
              Bruk samlet nettlager og butikkoversikt
            </span>
          </span>
        </button>
      </div>
      <ul className="max-h-[420px] overflow-y-auto p-1.5">
        {stores.map((store) => {
          const selected = selectedStoreId === store.id;

          return (
            <li key={store.id} className={`rounded-md ${selected ? "bg-emerald-50" : "hover:bg-stone-50"}`}>
              <div className="flex items-start gap-2 px-2.5 py-2">
                <button
                  type="button"
                  onClick={() => onSelect(store.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className={`block truncate text-sm font-semibold ${selected ? "text-[#15452d]" : "text-stone-900"}`}>
                    {store.name}
                  </span>
                  {store.address ? (
                    <span className="mt-0.5 block truncate text-xs text-stone-500">{store.address}</span>
                  ) : null}
                </button>
                {store.addressUrl && store.address ? (
                  <a
                    href={store.addressUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="shrink-0 rounded-full border border-stone-200 px-2 py-1 text-[11px] font-semibold text-stone-600 transition hover:border-[#15452d] hover:text-[#15452d]"
                  >
                    Vis i kart
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`h-3.5 w-3.5 shrink-0 transition ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}