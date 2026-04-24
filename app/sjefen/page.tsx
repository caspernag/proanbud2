import { redirect } from "next/navigation";

import { isAdminUser } from "@/lib/admin-auth";
import { hasSupabaseEnv } from "@/lib/env";
import { AdminLoginForm } from "./_components/admin-login-form";

export default async function SjefenPage() {
  if (await isAdminUser()) {
    redirect("/sjefen/dashboard");
  }

  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / wordmark */}
        <div className="mb-10 text-center">
          <span className="text-2xl font-bold tracking-tight text-stone-900">
            proanbud<span className="text-amber-500">.</span>
          </span>
          <p className="mt-1 text-xs text-stone-400 uppercase tracking-widest">Admin</p>
        </div>

        <div className="rounded-2xl bg-white border border-stone-200 p-8 shadow-xl">
          <h1 className="text-lg font-semibold text-stone-900 mb-1">Logg inn</h1>
          <p className="text-sm text-stone-400 mb-6">Kun for autoriserte administratorer.</p>

          {hasSupabaseEnv() ? (
            <AdminLoginForm />
          ) : (
            <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              Supabase-konfigurasjon mangler.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
