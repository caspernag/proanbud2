import { Suspense, type ReactNode } from "react";

import { StorefrontHeader } from "@/app/_components/storefront/storefront-header";
import { StorefrontProvider } from "@/app/_components/storefront/storefront-provider";

export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <StorefrontProvider>
      <div className="min-h-screen bg-[#f6f1e8] text-stone-900">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(232,198,147,0.22),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(21,69,45,0.16),transparent_30%)]" />
        <Suspense><StorefrontHeader /></Suspense>
        <main className="mx-auto w-full max-w-[1500px] px-3 pb-10 pt-5 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </StorefrontProvider>
  );
}
