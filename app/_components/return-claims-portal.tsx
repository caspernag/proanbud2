"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  MATERIAL_RETURN_REASONS,
  MATERIAL_RETURN_STATUS_LABELS,
  SUPPLIER_RETURN_TERMS,
  type MaterialReturnReasonCode,
  type MaterialReturnResolution,
  type MaterialReturnType,
  type MaterialReturnStatus,
} from "@/lib/material-return";
import { formatCurrency } from "@/lib/utils";

type SupplierKey = "byggmakker" | "monter_optimera" | "byggmax" | "xl_bygg";

type PortalOrderItem = {
  id: string;
  productName: string;
  quantityValue: number;
  quantityUnit: string;
  supplierKey: SupplierKey;
  supplierLabel: string;
  supplierSku: string | null;
  isIncluded: boolean;
};

type PortalOrder = {
  id: string;
  projectTitle: string;
  projectSlug: string;
  status: string;
  totalNok: number;
  createdAt: string;
  customerType: "private" | "business";
  items: PortalOrderItem[];
};

type PortalReturnCase = {
  id: string;
  orderId: string;
  status: MaterialReturnStatus;
  returnType: MaterialReturnType;
  reasonCode: MaterialReturnReasonCode;
  preferredResolution: MaterialReturnResolution;
  supplierLabel: string | null;
  title: string;
  description: string;
  returnLabelUrl: string | null;
  createdAt: string;
};

type PortalReturnEvent = {
  id: string;
  returnId: string;
  eventType: string;
  createdAt: string;
};

type PortalAttachment = {
  id: string;
  returnId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt: string;
};

export function ReturnClaimsPortal({
  orders,
  cases,
  events,
  attachments,
  prefilledOrderId,
}: {
  orders: PortalOrder[];
  cases: PortalReturnCase[];
  events: PortalReturnEvent[];
  attachments: PortalAttachment[];
  prefilledOrderId: string | null;
}) {
  const router = useRouter();
  const [selectedOrderId, setSelectedOrderId] = useState(prefilledOrderId ?? orders[0]?.id ?? "");
  const [returnType, setReturnType] = useState<MaterialReturnType>("return");
  const [reasonCode, setReasonCode] = useState<MaterialReturnReasonCode>("wrong_item");
  const [preferredResolution, setPreferredResolution] = useState<MaterialReturnResolution>("refund");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lineSelection, setLineSelection] = useState<Record<string, { selected: boolean; quantity: string }>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [submitPending, setSubmitPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  );

  const selectedReason = useMemo(
    () => MATERIAL_RETURN_REASONS.find((reason) => reason.code === reasonCode) ?? MATERIAL_RETURN_REASONS[0],
    [reasonCode],
  );

  const selectedOrderItems = useMemo(
    () => (selectedOrder?.items ?? []).filter((item) => item.isIncluded),
    [selectedOrder],
  );

  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);

  const selectedSupplierTerms = useMemo(() => {
    const keys = Array.from(new Set(selectedOrderItems.map((item) => item.supplierKey)));
    return keys.map((key) => SUPPLIER_RETURN_TERMS[key]);
  }, [selectedOrderItems]);

  const attachmentCountByReturnId = useMemo(() => {
    const map = new Map<string, number>();

    for (const attachment of attachments) {
      map.set(attachment.returnId, (map.get(attachment.returnId) ?? 0) + 1);
    }

    return map;
  }, [attachments]);

  const eventCountByReturnId = useMemo(() => {
    const map = new Map<string, number>();

    for (const event of events) {
      map.set(event.returnId, (map.get(event.returnId) ?? 0) + 1);
    }

    return map;
  }, [events]);

  function toggleLine(item: PortalOrderItem) {
    setLineSelection((current) => {
      const existing = current[item.id];
      const nextSelected = !(existing?.selected ?? false);

      return {
        ...current,
        [item.id]: {
          selected: nextSelected,
          quantity: existing?.quantity ?? String(Math.max(1, Math.round(item.quantityValue))),
        },
      };
    });
  }

  function setLineQuantity(itemId: string, value: string) {
    setLineSelection((current) => {
      const existing = current[itemId] ?? { selected: true, quantity: "1" };

      return {
        ...current,
        [itemId]: {
          selected: existing.selected,
          quantity: value,
        },
      };
    });
  }

  function setOrderAndReset(orderId: string) {
    setSelectedOrderId(orderId);
    setLineSelection({});
    setError("");
    setMessage("");
  }

  async function submitCase() {
    if (!selectedOrder) {
      setError("Velg en ordre først.");
      return;
    }

    const selectedLines = selectedOrderItems
      .map((item) => ({
        item,
        state: lineSelection[item.id] ?? { selected: false, quantity: String(Math.max(1, Math.round(item.quantityValue))) },
      }))
      .filter((entry) => entry.state.selected)
      .map((entry) => ({
        orderItemId: entry.item.id,
        quantityValue: clampPositiveNumber(entry.state.quantity, Math.max(0.001, entry.item.quantityValue)),
        reasonNote: "",
      }));

    if (selectedLines.length === 0) {
      setError("Velg minst én varelinje i retursaken.");
      return;
    }

    setSubmitPending(true);
    setError("");
    setMessage("");

    const formData = new FormData();
    formData.set("orderId", selectedOrder.id);
    formData.set("returnType", returnType);
    formData.set("reasonCode", reasonCode);
    formData.set("preferredResolution", preferredResolution);
    formData.set("title", title);
    formData.set("description", description);
    formData.set("items", JSON.stringify(selectedLines));

    for (const file of files) {
      formData.append("attachments", file, file.name);
    }

    try {
      const response = await fetch("/api/material-returns", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as {
        error?: string;
        returnId?: string;
        returnLabelUrl?: string;
      };

      if (!response.ok || !payload.returnId) {
        setError(payload.error ?? "Kunne ikke opprette retursaken.");
        setSubmitPending(false);
        return;
      }

      setMessage(
        payload.returnLabelUrl
          ? `Sak opprettet. Returlapp er klar for sak ${payload.returnId.slice(0, 8)}.`
          : `Sak opprettet med referanse ${payload.returnId.slice(0, 8)}.`,
      );
      setFiles([]);
      setDescription("");
      setTitle("");
      setLineSelection({});
      router.refresh();
    } catch {
      setError("Nettverksfeil ved opprettelse av retursak.");
    } finally {
      setSubmitPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-md border border-[#1b5136]/20 bg-[#eef1ec] p-4 shadow-[0_20px_48px_rgba(12,33,21,0.08)] sm:p-5">
        <div className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:radial-gradient(rgba(14,92,58,0.26)_0.8px,transparent_0.8px)] [background-size:18px_18px]" />
        <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 -bottom-20 h-60 w-60 rounded-full bg-emerald-900/12 blur-3xl" />

        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-900/70">Retur og reklamasjon</p>
          <h1 className="display-font mt-1.5 text-2xl text-[#142118] sm:text-3xl">Digital portal for privatkunde</h1>
          <p className="mt-1.5 max-w-3xl text-xs leading-5 text-[#43524a] sm:text-sm">
            Opprett sak direkte fra ordrehistorikk, last opp dokumentasjon, få returlapp og følg status i én flyt.
          </p>
        </div>

        <div className="relative mt-3 grid gap-2 sm:grid-cols-3">
          <StepCard step="1" title="Velg ordre" detail="Start fra betalt bestilling." />
          <StepCard step="2" title="Velg årsak" detail="Retur eller reklamasjon med lovgrunnlag." />
          <StepCard step="3" title="Følg status" detail="Varsling, returlapp og løsning spores fortløpende." />
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
          <h2 className="text-base font-semibold text-stone-900">Opprett ny retursak</h2>
          <p className="mt-1 text-xs text-stone-600">Skjemaet veileder deg gjennom nødvendige felt for korrekt behandling.</p>

          {orders.length === 0 ? (
            <div className="mt-3 rounded-md border border-stone-200 bg-white px-3 py-3 text-sm text-stone-600">
              Ingen betalte eller sendte bestillinger er tilgjengelige for retur.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <label className="block text-xs text-stone-700">
                Ordre
                <select
                  value={selectedOrderId}
                  onChange={(event) => setOrderAndReset(event.target.value)}
                  className="mt-1 h-9 w-full rounded-sm border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus:border-stone-900"
                >
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      #{order.id.slice(0, 8)} · {order.projectTitle} · {formatCurrency(order.totalNok)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-stone-700">
                  Sakstype
                  <select
                    value={returnType}
                    onChange={(event) => setReturnType(event.target.value as MaterialReturnType)}
                    className="mt-1 h-9 w-full rounded-sm border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus:border-stone-900"
                  >
                    <option value="return">Retur</option>
                    <option value="complaint">Reklamasjon</option>
                  </select>
                </label>

                <label className="text-xs text-stone-700">
                  Ønsket løsning
                  <select
                    value={preferredResolution}
                    onChange={(event) => setPreferredResolution(event.target.value as MaterialReturnResolution)}
                    className="mt-1 h-9 w-full rounded-sm border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus:border-stone-900"
                  >
                    <option value="refund">Refusjon</option>
                    <option value="replacement">Erstatningsleveranse</option>
                    <option value="repair">Reparasjon</option>
                    <option value="other">Annet</option>
                  </select>
                </label>
              </div>

              <label className="block text-xs text-stone-700">
                Returårsak
                <select
                  value={reasonCode}
                  onChange={(event) => {
                    const nextReason = event.target.value as MaterialReturnReasonCode;
                    const reason = MATERIAL_RETURN_REASONS.find((entry) => entry.code === nextReason);
                    setReasonCode(nextReason);

                    if (reason && returnType !== reason.recommendedType) {
                      setReturnType(reason.recommendedType);
                    }
                  }}
                  className="mt-1 h-9 w-full rounded-sm border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus:border-stone-900"
                >
                  {MATERIAL_RETURN_REASONS.map((reason) => (
                    <option key={reason.code} value={reason.code}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] text-stone-500">{selectedReason.detail}</p>

              <label className="block text-xs text-stone-700">
                Kort tittel
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Eksempel: Skadet panel i levering"
                  className="mt-1 h-9 w-full rounded-sm border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus:border-stone-900"
                />
              </label>

              <label className="block text-xs text-stone-700">
                Beskrivelse
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder="Beskriv hva som er feil og hva du ønsker som løsning."
                  className="mt-1 w-full rounded-sm border border-stone-300 bg-white px-2 py-2 text-sm text-stone-900 outline-none focus:border-stone-900"
                />
              </label>

              <div className="rounded-md border border-stone-200 bg-white p-2.5">
                <p className="text-xs font-semibold text-stone-900">Velg varelinjer</p>
                <div className="mt-2 space-y-2">
                  {selectedOrderItems.map((item) => {
                    const state = lineSelection[item.id] ?? {
                      selected: false,
                      quantity: String(Math.max(1, Math.round(item.quantityValue))),
                    };
                    const term = SUPPLIER_RETURN_TERMS[item.supplierKey];

                    return (
                      <label
                        key={item.id}
                        className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border border-stone-200 px-2 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={state.selected}
                          onChange={() => toggleLine(item)}
                          className="h-4 w-4"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-stone-900">{item.productName}</p>
                          <p className="text-[11px] text-stone-500">
                            {item.supplierLabel} · Angrerett {term.angerrettDays} dager · Reklamasjon {term.complaintYears} år
                          </p>
                        </div>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          max={Math.max(0.001, item.quantityValue)}
                          value={state.quantity}
                          onChange={(event) => setLineQuantity(item.id, event.target.value)}
                          className="h-8 w-20 rounded-sm border border-stone-300 bg-white px-2 text-right text-sm text-stone-900 outline-none focus:border-stone-900"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <label className="block text-xs text-stone-700">
                Dokumentasjon (bilder/PDF)
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
                  onChange={(event) => {
                    const selected = Array.from(event.target.files ?? []);
                    setFiles(selected.slice(0, 6));
                  }}
                  className="mt-1 block w-full rounded-sm border border-stone-300 bg-white px-2 py-2 text-xs text-stone-700"
                />
              </label>
              {files.length > 0 ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  {files.length} vedlegg klart for opplasting.
                </div>
              ) : null}

              {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
              {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}

              <button
                type="button"
                onClick={() => {
                  void submitCase();
                }}
                disabled={submitPending || !selectedOrder}
                className="inline-flex h-10 items-center justify-center rounded-sm bg-stone-900 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-500"
              >
                {submitPending ? "Oppretter sak..." : "Opprett retur/reklamasjon"}
              </button>
            </div>
          )}
        </article>

        <div className="space-y-3">
          <article className="rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
            <h2 className="text-base font-semibold text-stone-900">Returvilkår før kjøp</h2>
            <p className="mt-1 text-xs text-stone-500">Leverandørspesifikke vilkår for valgt ordre og varelinjer.</p>

            <div className="mt-3 space-y-2">
              {selectedSupplierTerms.map((terms) => (
                <div key={terms.supplierKey} className="rounded-md border border-stone-200 bg-white px-3 py-2.5">
                  <p className="text-sm font-semibold text-stone-900">{terms.supplierLabel}</p>
                  <p className="mt-1 text-xs text-stone-600">Angrerett: {terms.angerrettDays} dager · Reklamasjon: {terms.complaintYears} år</p>
                  <p className="text-xs text-stone-600">
                    Frakt retur: {terms.returnShipping === "gratis" ? "Gratis" : "Kundebetalt"}
                    {terms.handlingFeeNok > 0 ? ` · Behandlingsgebyr ${formatCurrency(terms.handlingFeeNok)}` : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-stone-500">{terms.notes[0]}</p>
                </div>
              ))}
              {selectedSupplierTerms.length === 0 ? (
                <div className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-500">
                  Velg ordre for å se vilkår.
                </div>
              ) : null}
            </div>
          </article>

          <article className="rounded-md border border-[#1d4f35]/15 bg-[#f7f8f6] p-3.5 shadow-[0_12px_30px_rgba(13,34,22,0.06)] sm:p-4">
            <h2 className="text-base font-semibold text-stone-900">Sporing av saker</h2>
            <p className="mt-1 text-xs text-stone-500">Historikk, hendelser og returlapper per sak.</p>

            <div className="mt-3 space-y-2">
              {cases.map((returnCase) => {
                const statusLabel = MATERIAL_RETURN_STATUS_LABELS[returnCase.status] ?? returnCase.status;
                const caseOrder = orderById.get(returnCase.orderId);

                return (
                  <div key={returnCase.id} className="rounded-md border border-stone-200 bg-white px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-stone-900">Sak #{returnCase.id.slice(0, 8)}</p>
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusClassName(returnCase.status)}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-stone-600">
                      {returnCase.returnType === "return" ? "Retur" : "Reklamasjon"} · {formatDate(returnCase.createdAt)}
                    </p>
                    <p className="text-xs text-stone-500">{returnCase.supplierLabel ?? "Flere leverandører"}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                      <span>{attachmentCountByReturnId.get(returnCase.id) ?? 0} vedlegg</span>
                      <span>{eventCountByReturnId.get(returnCase.id) ?? 0} hendelser</span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {returnCase.returnLabelUrl ? (
                        <a
                          href={returnCase.returnLabelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-7 items-center rounded-sm border border-stone-300 px-2.5 text-[11px] font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                        >
                          Last ned returlapp
                        </a>
                      ) : null}
                      {caseOrder?.projectSlug ? (
                        <Link
                          href={`/min-side/materiallister/${caseOrder.projectSlug}/bestilling?order=${returnCase.orderId}`}
                          className="inline-flex h-7 items-center rounded-sm border border-stone-300 px-2.5 text-[11px] font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                        >
                          Åpne ordre
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {cases.length === 0 ? (
                <div className="rounded-md border border-stone-200 bg-white px-3 py-3 text-sm text-stone-500">
                  Ingen retursaker ennå.
                </div>
              ) : null}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function StepCard({ step, title, detail }: { step: string; title: string; detail: string }) {
  return (
    <div className="rounded-md border border-[#1d4f35]/15 bg-white/75 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">Steg {step}</p>
      <p className="mt-0.5 text-sm font-semibold text-stone-900">{title}</p>
      <p className="text-[11px] text-stone-600">{detail}</p>
    </div>
  );
}

function statusClassName(status: MaterialReturnStatus) {
  if (status === "resolved") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "rejected") {
    return "bg-rose-100 text-rose-800";
  }

  if (status === "label_ready" || status === "supplier_notified") {
    return "bg-sky-100 text-sky-800";
  }

  return "bg-amber-100 text-amber-800";
}

function clampPositiveNumber(value: string, fallback: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
