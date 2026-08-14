"use client";

import { useActionState, useMemo, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import type { ActionState } from "@/app/sjefen/_components/action-form";
import {
  BTN_SECONDARY,
  Badge,
  EmptyState,
  TableWrap,
  Td,
  Th,
  dateNo,
  nok,
  num,
} from "@/app/sjefen/_components/ui";
import type { OrphanProductRow } from "@/lib/admin-product-price-import";

import { reviewAllAction, reviewSelectedAction } from "../actions";

const BTN_KEEP =
  "inline-flex h-9 items-center justify-center border border-[#163f2a] bg-[#163f2a] px-4 text-xs font-semibold text-white transition hover:bg-[#1d5639] disabled:cursor-not-allowed disabled:opacity-60";
const BTN_DELETE =
  "inline-flex h-9 items-center justify-center border border-red-600 bg-red-600 px-4 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60";

export function OrphanReview({
  runId,
  rows,
  total,
  filteredTotal,
  query,
}: {
  runId: string;
  rows: OrphanProductRow[];
  /** Antall rester totalt, uavhengig av søk. */
  total: number;
  /** Antall rester som matcher det aktive søket. */
  filteredTotal: number;
  query: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedState, selectedFormAction, selectedPending] = useActionState(reviewSelectedAction, null);

  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function togglePage() {
    setSelected((current) =>
      allOnPageSelected
        ? current.filter((id) => !pageIds.includes(id))
        : Array.from(new Set([...current, ...pageIds])),
    );
  }

  return (
    <div className="space-y-4">
      <form action={selectedFormAction}>
        <input type="hidden" name="runId" value={runId} />
        {selected.map((id) => (
          <input key={id} type="hidden" name="productIds" value={id} />
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3 border border-stone-200 bg-stone-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-stone-700">
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={togglePage}
                className="h-4 w-4 accent-[#163f2a]"
              />
              Merk alle på siden
            </label>
            <span className="text-xs text-stone-500">{num(selected.length)} valgt</span>
            {selected.length > 0 ? (
              <button
                type="button"
                onClick={() => setSelected([])}
                className="text-xs font-semibold text-stone-500 underline hover:text-stone-800"
              >
                Nullstill
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              name="intent"
              value="keep"
              disabled={selected.length === 0 || selectedPending}
              className={BTN_KEEP}
            >
              {selectedPending ? "Jobber …" : "Behold valgte"}
            </button>
            <button
              type="submit"
              name="intent"
              value="delete"
              disabled={selected.length === 0 || selectedPending}
              onClick={(event) => {
                if (!confirm(`Slette ${selected.length} produkt(er) fra katalogen? Dette kan ikke angres.`)) {
                  event.preventDefault();
                }
              }}
              className={BTN_DELETE}
            >
              {selectedPending ? "Jobber …" : "Slett valgte"}
            </button>
          </div>
        </div>

        {selectedState ? (
          <p
            role="status"
            className={`mt-2 px-3 py-2 text-xs font-medium ${
              selectedState.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
            }`}
          >
            {selectedState.message}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState>Ingen produkter igjen til gjennomgang.</EmptyState>
        ) : (
          <TableWrap>
            <thead className="border-b border-stone-200">
              <tr>
                <Th />
                <Th>Produkt</Th>
                <Th>Merke</Th>
                <Th>Kategori</Th>
                <Th align="right">Pris</Th>
                <Th>Sist endret</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const checked = selected.includes(row.id);

                return (
                  <tr
                    key={row.id}
                    className={`border-b border-stone-100 transition ${checked ? "bg-[#163f2a]/5" : "hover:bg-stone-50"}`}
                  >
                    <Td>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(row.id)}
                        aria-label={`Velg ${row.product_name}`}
                        className="h-4 w-4 accent-[#163f2a]"
                      />
                    </Td>
                    <Td>
                      <div className="max-w-[420px]">
                        <p className="truncate text-xs font-semibold text-stone-900">{row.product_name}</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-stone-500">
                          NOBB {row.nobb_number} · {row.supplier_name}
                        </p>
                      </div>
                    </Td>
                    <Td className="text-xs text-stone-700">{row.brand || "—"}</Td>
                    <Td>
                      <Badge>{row.category ?? "Diverse"}</Badge>
                    </Td>
                    <Td align="right" className="text-xs font-semibold tabular-nums text-stone-900">
                      {nok(row.unit_price_nok)}
                      <span className="block text-[10px] font-normal text-stone-400">/{row.unit ?? "STK"}</span>
                    </Td>
                    <Td className="text-[10px] text-stone-500">{dateNo(row.last_updated)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </form>

      <BulkAllToolbar runId={runId} total={total} filteredTotal={filteredTotal} query={query} />
    </div>
  );
}

/** «Ta alle» — enten hele gjennomgangen eller bare treffene på det aktive søket. */
function BulkAllToolbar({
  runId,
  total,
  filteredTotal,
  query,
}: {
  runId: string;
  total: number;
  filteredTotal: number;
  query: string;
}) {
  const [state, formAction] = useActionState(reviewAllAction, null);
  const scope = query ? "filtered" : "all";
  const count = query ? filteredTotal : total;
  const label = query ? `alle ${num(count)} treff på «${query}»` : `alle ${num(count)}`;

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="q" value={query} />
      <input type="hidden" name="scope" value={scope} />

      <div className="flex flex-wrap items-center justify-between gap-3 border border-stone-200 bg-white px-4 py-3">
        <p className="text-xs text-stone-600">
          Gjør det samme med <span className="font-semibold text-stone-900">{label}</span> uten å merke rad for rad.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <BulkAllButton
            intent="keep"
            className={BTN_SECONDARY}
            confirmMessage={`Beholde ${label}? De blir liggende i katalogen.`}
            disabled={count === 0}
          >
            Behold {query ? "treffene" : "alle"}
          </BulkAllButton>
          <BulkAllButton
            intent="delete"
            className={BTN_DELETE}
            confirmMessage={`Slette ${label} fra katalogen? Dette kan ikke angres.`}
            disabled={count === 0}
          >
            Slett {query ? "treffene" : "alle"}
          </BulkAllButton>
        </div>
      </div>

      {state ? <ActionMessage state={state} /> : null}
    </form>
  );
}

function BulkAllButton({
  intent,
  className,
  confirmMessage,
  disabled,
  children,
}: {
  intent: "keep" | "delete";
  className: string;
  confirmMessage: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      disabled={disabled || pending}
      onClick={(event) => {
        if (!confirm(confirmMessage)) event.preventDefault();
      }}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? "Jobber …" : children}
    </button>
  );
}

function ActionMessage({ state }: { state: NonNullable<ActionState> }) {
  return (
    <p
      role="status"
      className={`px-3 py-2 text-xs font-medium ${
        state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
      }`}
    >
      {state.message}
    </p>
  );
}
