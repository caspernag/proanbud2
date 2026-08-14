import { type ReactNode, Suspense } from "react";
import Link from "next/link";
import { PackageSearch } from "lucide-react";

import { AdminSignOutButton } from "../_components/admin-sign-out-button";

const NAV = [
  {
    href: "/sjefen/dashboard",
    label: "Dashboard",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    href: "/sjefen/logistikk",
    label: "Logistikk",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 3h13v13H1z" /><path d="M14 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="17.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    href: "/sjefen/bestillinger",
    label: "Bestillinger",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
  },
  {
    href: "/sjefen/produkter",
    label: "Produkter",
    icon: <PackageSearch className="h-[18px] w-[18px]" strokeWidth={1.8} />,
  },
  {
    href: "/sjefen/brukere",
    label: "Brukere",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: "/sjefen/okonomi",
    label: "Økonomi",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    href: "/sjefen/okonomi/regnskap",
    label: "Regnskap",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="10" y2="10" /><line x1="14" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="10" y2="14" /><line x1="14" y1="14" x2="16" y2="18" />
      </svg>
    ),
  },
  {
    href: "/sjefen/innstillinger",
    label: "Innstillinger",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
      </svg>
    ),
  },
];

export default function SjefenPanelLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#f5f4f1] text-stone-900">
      {/* print:hidden — pakkseddelen skal skrives ut uten adminmenyen. */}
      <aside className="flex w-60 shrink-0 flex-col bg-[#123321] text-emerald-50 print:hidden">
        <div className="border-b border-white/10 px-5 py-6">
          <span className="text-lg font-semibold tracking-tight text-white">
            prisbygg<span className="text-[#d9ff7a]">.</span>
          </span>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/60">
            Adminpanel
          </p>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-emerald-50/75 transition hover:bg-white/10 hover:text-white"
            >
              <span className="text-emerald-100/50 transition group-hover:text-[#d9ff7a]">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-white/10 px-3 py-4">
          <Link
            href="/"
            className="mb-1 flex items-center gap-3 px-3 py-2 text-xs font-medium text-emerald-100/60 transition hover:text-white"
          >
            ← Til nettbutikken
          </Link>
          <AdminSignOutButton />
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
    </div>
  );
}
