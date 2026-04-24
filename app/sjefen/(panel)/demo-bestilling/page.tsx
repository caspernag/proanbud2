import { requireAdminUser } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { DemoBestillingForm } from "./_components/demo-bestilling-form";

const PRESETS_META = [
  { key: "baderom",   title: "Baderomsrenovering", location: "Oslo",       itemCount: 8 },
  { key: "kjokken",   title: "Kjøkkenrenovering",  location: "Bergen",     itemCount: 7 },
  { key: "terrasse",  title: "Terrassebygging",    location: "Stavanger",  itemCount: 7 },
  { key: "innvendig", title: "Innvendig oppussing", location: "Trondheim",  itemCount: 8 },
];

export default async function DemoBestillingPage() {
  await requireAdminUser();

  const adminClient = createSupabaseAdminClient();
  const usersResult = adminClient
    ? await adminClient.auth.admin.listUsers({ page: 1, perPage: 500 })
    : null;

  const users = (usersResult?.data?.users ?? [])
    .filter((u) => Boolean(u.email))
    .map((u) => ({ id: u.id, email: u.email! }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Demo-bestilling</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Opprett en realistisk demo-bestilling for en bruker — uten ekte betaling.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <DemoBestillingForm users={users} presets={PRESETS_META} />

        {/* Right column: info */}
        <div className="space-y-4">
          <div className="bg-white border border-stone-200 rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-stone-900 mb-3">Slik fungerer det</h2>
            <ol className="space-y-3 text-sm text-stone-600 list-decimal list-inside">
              <li>Velg hvilken bruker som skal få demo-bestillingen</li>
              <li>Velg prosjekttype — hvert preset har realistiske produkter og priser</li>
              <li>Velg leveringstype</li>
              <li>Klikk «Opprett» — bestillingen vises umiddelbart i brukerens «Min side» og i admin-oversikten</li>
            </ol>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-amber-800 mb-2">Hva er realistisk?</h2>
            <ul className="text-xs text-amber-700 space-y-1.5">
              <li>• Norske leverandører (Byggmakker, Optimera, Byggmax, XL-BYGG)</li>
              <li>• Reelle produktnavn, SKU-er og prisintervaller</li>
              <li>• 25% MVA beregnet automatisk</li>
              <li>• Leveringsdato satt 7 dager frem i tid</li>
              <li>• Status satt til «Sendt» (betalt og videresendt)</li>
            </ul>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-stone-900 mb-3">Presets</h2>
            <div className="space-y-2">
              {PRESETS_META.map((p) => (
                <div key={p.key} className="flex items-center justify-between text-sm">
                  <span className="text-stone-700">{p.title}</span>
                  <span className="text-xs text-stone-400">{p.itemCount} produkter · {p.location}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
