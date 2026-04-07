import { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">ProAnbud Admin</h1>
      </header>
      <main className="mx-auto w-full max-w-[1500px] flex-1 p-6">
        {children}
      </main>
    </div>
  );
}
