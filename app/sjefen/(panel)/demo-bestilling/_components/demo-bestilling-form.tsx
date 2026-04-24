"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type User = { id: string; email: string };

type PresetMeta = { key: string; title: string; location: string; itemCount: number };

const PRESET_DESCRIPTIONS: Record<string, string> = {
  baderom:   "Fliser, membran, våtromsplater, gulvvarme og røropplegg",
  kjokken:   "Benkeplate, vask, veggfliser, vifte og maling",
  terrasse:  "Terrassebord, bjelker, stolper, rekkverk og olje",
  innvendig: "Gips, laminatgulv, maling, lister og profiler",
};

type Props = {
  users: User[];
  presets: PresetMeta[];
};

export function DemoBestillingForm({ users, presets }: Props) {
  const router = useRouter();
  const [userId, setUserId]           = useState(users[0]?.id ?? "");
  const [presetKey, setPresetKey]     = useState(presets[0]?.key ?? "baderom");
  const [deliveryMode, setDeliveryMode] = useState<"delivery" | "pickup">("delivery");
  const [pending, setPending]         = useState(false);
  const [result, setResult]           = useState<{ ok: true; orderId: string; total: number } | { ok: false; error: string } | null>(null);

  const selectedPreset = presets.find((p) => p.key === presetKey);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);

    try {
      const res = await fetch("/api/admin/demo-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, presetKey, deliveryMode }),
      });
      const data = await res.json();

      if (!res.ok) {
        setResult({ ok: false, error: data.error ?? "Ukjent feil" });
      } else {
        setResult({ ok: true, orderId: data.orderId, total: data.total });
        router.refresh();
      }
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      {/* User picker */}
      <div>
        <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
          Bruker
        </label>
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          required
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="" disabled>Velg bruker…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.email}</option>
          ))}
        </select>
      </div>

      {/* Preset picker */}
      <div>
        <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
          Prosjekttype / preset
        </label>
        <div className="grid grid-cols-2 gap-3">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPresetKey(p.key)}
              className={`text-left rounded-xl border p-4 transition ${
                presetKey === p.key
                  ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500"
                  : "border-stone-200 hover:border-stone-300"
              }`}
            >
              <p className="font-semibold text-sm text-stone-900">{p.title}</p>
              <p className="text-xs text-stone-400 mt-0.5">{p.location}</p>
              <p className="text-xs text-stone-400 mt-1">{p.itemCount} produkter</p>
              <p className="text-xs text-stone-500 mt-1.5 leading-relaxed">{PRESET_DESCRIPTIONS[p.key]}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Delivery mode */}
      <div>
        <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
          Leveringstype
        </label>
        <div className="flex gap-3">
          {[
            { value: "delivery", label: "Levering til adresse", sub: "+499 kr" },
            { value: "pickup",   label: "Henting i butikk",     sub: "Gratis" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDeliveryMode(opt.value as "delivery" | "pickup")}
              className={`flex-1 rounded-lg border px-4 py-3 text-left transition ${
                deliveryMode === opt.value
                  ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500"
                  : "border-stone-200 hover:border-stone-300"
              }`}
            >
              <p className="text-sm font-medium text-stone-900">{opt.label}</p>
              <p className="text-xs text-stone-400 mt-0.5">{opt.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Info box */}
      <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
        <p className="text-xs font-semibold text-blue-700 mb-1">Hva skjer?</p>
        <ul className="text-xs text-blue-600 space-y-0.5 list-disc list-inside">
          <li>Et realistisk prosjekt opprettes for brukeren</li>
          <li>En fullstendig materialbestilling genereres med status <strong>Sendt</strong></li>
          <li>Betaling simuleres — ingen Stripe-transaksjon kjøres</li>
          <li>Brukeren ser bestillingen i sin «Min side»</li>
        </ul>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={pending || !userId}
        className="w-full rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-900 font-semibold py-3 text-sm transition"
      >
        {pending ? "Oppretter demo-bestilling…" : "Opprett demo-bestilling"}
      </button>

      {/* Result */}
      {result && (
        result.ok ? (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-700">Demo-bestilling opprettet!</p>
            <p className="text-xs text-emerald-600 mt-1">
              Ordre-ID: <span className="font-mono">{result.orderId.slice(0, 8)}…</span>
              &nbsp;·&nbsp;
              Total: {new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(result.total)}
            </p>
            <a
              href="/sjefen/bestillinger"
              className="text-xs text-emerald-700 underline mt-2 inline-block"
            >
              Se alle bestillinger →
            </a>
          </div>
        ) : (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm font-semibold text-red-700">Feil ved opprettelse</p>
            <p className="text-xs text-red-600 mt-1">{result.error}</p>
          </div>
        )
      )}
    </form>
  );
}
