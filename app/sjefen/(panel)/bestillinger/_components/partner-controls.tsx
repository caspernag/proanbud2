"use client";

import { ActionForm, SubmitButton } from "@/app/sjefen/_components/action-form";

import { updateMaterialPartnerAction } from "../actions";

const PARTNER_STATUS_OPTIONS = [
  { value: "pending", label: "Ny" },
  { value: "processing", label: "Behandles" },
  { value: "out_for_delivery", label: "Kjørt ut" },
  { value: "delivered", label: "Levert" },
  { value: "cancelled", label: "Kansellert" },
];

/**
 * Tildeling av partner og flytting av partnerstatus, rett i ordretabellen.
 * Erstatter kanban-brettet som lå på det gamle /admin/orders.
 */
export function PartnerControls({
  orderId,
  partnerStatus,
  partnerId,
  partners,
}: {
  orderId: string;
  partnerStatus: string;
  partnerId: string | null;
  partners: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={updateMaterialPartnerAction} className="flex items-center gap-1.5" messageClassName="w-full">
      <input type="hidden" name="orderId" value={orderId} />

      <select
        name="partnerId"
        defaultValue={partnerId ?? ""}
        aria-label="Partner"
        className="h-8 max-w-[130px] border border-stone-300 bg-white px-2 text-xs text-stone-800 outline-none focus:border-[#163f2a]"
      >
        <option value="">Ingen partner</option>
        {partners.map((partner) => (
          <option key={partner.id} value={partner.id}>
            {partner.name}
          </option>
        ))}
      </select>

      <select
        name="partnerStatus"
        defaultValue={partnerStatus || "pending"}
        aria-label="Partnerstatus"
        className="h-8 border border-stone-300 bg-white px-2 text-xs text-stone-800 outline-none focus:border-[#163f2a]"
      >
        {PARTNER_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <SubmitButton
        pendingLabel="…"
        className="inline-flex h-8 items-center bg-[#163f2a] px-3 text-xs font-semibold text-white transition hover:bg-[#1d5639]"
      >
        Lagre
      </SubmitButton>
    </ActionForm>
  );
}
