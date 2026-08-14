"use client";

import { useState } from "react";

import { updateLogisticsAction } from "../actions";
import { ActionForm, SubmitButton } from "@/app/sjefen/_components/action-form";

export type CarrierOption = { code: string; label: string; hasTracking: boolean };
export type StatusOption = { value: string; label: string };

export function LogisticsForm({
  orderId,
  carriers,
  transportOptions,
  statusOptions,
  defaults,
}: {
  orderId: string;
  carriers: CarrierOption[];
  transportOptions: StatusOption[];
  statusOptions: StatusOption[];
  defaults: {
    transportStatus: string;
    orderStatus: string;
    carrierCode: string;
    trackingNumber: string;
    trackingUrl: string;
    estimatedDeliveryDate: string;
    statusNote: string;
  };
}) {
  const [carrierCode, setCarrierCode] = useState(defaults.carrierCode);
  const [trackingNumber, setTrackingNumber] = useState(defaults.trackingNumber);

  const selectedCarrier = carriers.find((carrier) => carrier.code === carrierCode);
  const autoTracking = Boolean(selectedCarrier?.hasTracking && trackingNumber.trim());

  return (
    <ActionForm action={updateLogisticsAction} className="border border-stone-200 bg-white p-5">
      <input type="hidden" name="orderId" value={orderId} />

      <h2 className="text-sm font-bold text-stone-900">Oppdater transport</h2>
      <p className="mt-0.5 text-xs text-stone-400">
        Endringer logges på ordren og kan varsles kunden på e-post.
      </p>

      <div className="mt-4 space-y-3">
        <Field label="Transportstatus">
          <select
            name="transportStatus"
            defaultValue={defaults.transportStatus}
            className="mt-1 h-10 w-full border border-stone-300 bg-white px-3 text-sm font-normal text-stone-900 outline-none focus:border-[#163f2a]"
          >
            {transportOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Ordrestatus" hint="Settes automatisk til Fullført ved levering.">
          <select
            name="orderStatus"
            defaultValue={defaults.orderStatus}
            className="mt-1 h-10 w-full border border-stone-300 bg-white px-3 text-sm font-normal text-stone-900 outline-none focus:border-[#163f2a]"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Transportør">
          <select
            name="carrierCode"
            value={carrierCode}
            onChange={(event) => setCarrierCode(event.target.value)}
            className="mt-1 h-10 w-full border border-stone-300 bg-white px-3 text-sm font-normal text-stone-900 outline-none focus:border-[#163f2a]"
          >
            <option value="">Ikke satt</option>
            {carriers.map((carrier) => (
              <option key={carrier.code} value={carrier.code}>
                {carrier.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Sporingsnummer">
          <input
            name="trackingNumber"
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            className="mt-1 h-10 w-full border border-stone-300 px-3 font-mono text-sm font-normal text-stone-900 outline-none focus:border-[#163f2a]"
          />
        </Field>

        <Field
          label="Sporingslenke"
          hint={
            autoTracking
              ? `Genereres automatisk fra ${selectedCarrier?.label}. Fyll inn her kun for å overstyre.`
              : "Valgfri direktelenke kunden kan klikke på."
          }
        >
          <input
            name="trackingUrl"
            type="url"
            placeholder={autoTracking ? "Automatisk" : "https://…"}
            defaultValue={defaults.trackingUrl}
            className="mt-1 h-10 w-full border border-stone-300 px-3 text-sm font-normal text-stone-900 outline-none focus:border-[#163f2a]"
          />
        </Field>

        <Field label="Estimert levering">
          <input
            name="estimatedDeliveryDate"
            type="date"
            defaultValue={defaults.estimatedDeliveryDate}
            className="mt-1 h-10 w-full border border-stone-300 px-3 text-sm font-normal text-stone-900 outline-none focus:border-[#163f2a]"
          />
        </Field>

        <Field label="Melding til kunden" hint="Vises på ordresiden og i e-postvarselet.">
          <textarea
            name="statusNote"
            rows={3}
            defaultValue={defaults.statusNote}
            className="mt-1 w-full border border-stone-300 px-3 py-2 text-sm font-normal text-stone-900 outline-none focus:border-[#163f2a]"
          />
        </Field>

        <label className="flex items-start gap-2.5 border border-stone-200 bg-stone-50 px-3 py-2.5">
          <input
            type="checkbox"
            name="notifyCustomer"
            defaultChecked
            className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-emerald-600"
          />
          <span className="text-xs">
            <span className="font-semibold text-stone-800">Varsle kunden på e-post</span>
            <span className="mt-0.5 block text-stone-500">
              Skru av for interne rettelser kunden ikke skal få melding om.
            </span>
          </span>
        </label>

        <SubmitButton
          pendingLabel="Lagrer …"
          className="inline-flex h-10 w-full items-center justify-center bg-[#163f2a] px-4 text-sm font-bold text-white hover:bg-[#1d5639]"
        >
          Lagre og varsle
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold text-stone-600">
      {label}
      {children}
      {hint ? <span className="mt-1 block font-normal text-[11px] text-stone-400">{hint}</span> : null}
    </label>
  );
}
