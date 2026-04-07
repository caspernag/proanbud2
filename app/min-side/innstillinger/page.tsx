import { SignOutButton } from "@/app/_components/sign-out-button";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function InnstillingerPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-md border border-[#1b5136]/20 bg-[#eef1ec] p-4 shadow-[0_20px_48px_rgba(12,33,21,0.08)] sm:p-5">
        <div className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:radial-gradient(rgba(14,92,58,0.26)_0.8px,transparent_0.8px)] [background-size:18px_18px]" />
        <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 -bottom-20 h-60 w-60 rounded-full bg-emerald-900/12 blur-3xl" />

        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-900/70">Innstillinger</p>
          <h1 className="display-font mt-1.5 text-2xl text-[#142118] sm:text-3xl">Brukerinnstillinger</h1>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[#43524a] sm:text-sm">
            Enkle konto- og varselvalg for appen.
          </p>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <article className="rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
          <h2 className="text-base font-semibold text-stone-900">Konto</h2>
          <dl className="mt-2.5 space-y-2 text-xs sm:text-sm">
            <div className="flex items-center justify-between gap-3 rounded-md border border-[#1d4f35]/15 bg-white px-2.5 py-2">
              <dt className="text-stone-500">E-post</dt>
              <dd className="font-medium text-stone-900">{user?.email ?? "Ikke innlogget"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-[#1d4f35]/15 bg-white px-2.5 py-2">
              <dt className="text-stone-500">Bruker-ID</dt>
              <dd className="max-w-[50%] truncate font-medium text-stone-900">{user?.id ?? "Ingen"}</dd>
            </div>
          </dl>
          <div className="mt-3">
            {user ? (
              <SignOutButton />
            ) : (
              <p className="text-xs text-stone-600 sm:text-sm">Logg inn for a administrere kontoen.</p>
            )}
          </div>
        </article>

        <article className="rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
          <h2 className="text-base font-semibold text-stone-900">Preferanser</h2>
          <div className="mt-2.5 space-y-2">
            <PreferenceToggle label="E-post ved ordrestatus" description="Varsler nar bestilling endrer status." enabled />
            <PreferenceToggle label="Ukentlig okonomioppsummering" description="Sammendrag av sparing og ordrevolum." enabled={false} />
          </div>
        </article>
      </section>
    </div>
  );
}

function PreferenceToggle({
  label,
  description,
  enabled,
}: {
  label: string;
  description: string;
  enabled: boolean;
}) {
  return (
    <div className="rounded-md border border-[#1d4f35]/15 bg-white px-2.5 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-stone-900 sm:text-sm">{label}</p>
          <p className="mt-0.5 text-[11px] text-stone-500">{description}</p>
        </div>
        <span
          className={`inline-flex rounded-[3px] px-2 py-0.5 text-[10px] font-semibold ${
            enabled ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"
          }`}
        >
          {enabled ? "Pa" : "Av"}
        </span>
      </div>
    </div>
  );
}
