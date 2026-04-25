import { ReactNode, Suspense } from "react";
import Link from "next/link";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Partner Admin</h1>
        <nav className="flex items-center gap-6">
          <Link href="/admin/orders" className="text-sm font-medium text-gray-600 hover:text-black">Ordrepipeline</Link>
          <Link href="/admin" className="text-sm font-medium text-gray-600 hover:text-black">Oppsett</Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1500px] flex-1 p-6">
        <Suspense fallback={null}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}
