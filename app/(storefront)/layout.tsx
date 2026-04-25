import { Suspense, type ReactNode } from "react";

import { StorefrontHeader } from "@/app/_components/storefront/storefront-header";
import { StorefrontProvider } from "@/app/_components/storefront/storefront-provider";

export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <StorefrontProvider>
      <div className="min-h-screen bg-[#f5f4f1] text-stone-900">
        <Suspense><StorefrontHeader /></Suspense>
        <main className="mx-auto w-full max-w-[1500px] px-3 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-5 lg:px-8">
          <Suspense fallback={null}>
            {children}
          </Suspense>
        </main>
      </div>
    </StorefrontProvider>
  );
}
