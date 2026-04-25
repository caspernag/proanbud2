"use client";

import { useState, type ReactNode } from "react";

type MobileFilterDrawerProps = {
  children: ReactNode;
  activeFiltersCount: number;
};

export function MobileFilterDrawer({ children, activeFiltersCount }: MobileFilterDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile filter trigger button – only visible on mobile */}
      <div className="flex items-center gap-2 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 shadow-sm transition hover:border-[#15452d] hover:text-[#15452d]"
        >
          <FilterIcon />
          Filtrer
          {activeFiltersCount > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#15452d] px-1.5 text-[11px] font-semibold text-white">
              {activeFiltersCount}
            </span>
          )}
        </button>
      </div>

      {/* Backdrop */}
      {open && (
        <button
          type="button"
          aria-label="Lukk filterpanel"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden"
        />
      )}

      {/* Mobile bottom sheet */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-in-out lg:hidden ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-100 bg-white px-4 py-3">
          <p className="font-semibold text-stone-900">Filtrer varer</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 text-stone-500 transition hover:bg-stone-50"
            aria-label="Lukk"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </>
  );
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
