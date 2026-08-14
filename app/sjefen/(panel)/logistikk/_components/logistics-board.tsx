"use client";

import Link from "next/link";
import { useState } from "react";

import type { LogisticsStageId } from "@/lib/shop-order-logistics";

import { advanceStageAction, bulkAdvanceAction } from "../actions";
import { ActionForm, SubmitButton } from "@/app/sjefen/_components/action-form";

export type BoardIssue = {
  severity: "high" | "medium" | "low";
  label: string;
};

export type BoardCard = {
  id: string;
  reference: string;
  href: string;
  customerName: string;
  place: string;
  totalLabel: string;
  lineCount: number;
  ageLabel: string | null;
  overdue: boolean;
  issues: BoardIssue[];
  carrierLabel: string | null;
  trackingNumber: string | null;
  etaLabel: string | null;
  nextActionLabel: string | null;
};

export type BoardColumn = {
  id: LogisticsStageId;
  label: string;
  description: string;
  accent: string;
  cards: BoardCard[];
  /** Antall skjulte kort (brukes for «Levert», som kun viser siste 14 dager). */
  hiddenCount: number;
};

const ACCENT: Record<string, { bar: string; chip: string }> = {
  amber: { bar: "bg-[#d9ff7a]", chip: "bg-[#eef8d9] text-[#3f5117]" },
  blue: { bar: "bg-[#7bb8a0]", chip: "bg-[#e6f2ec] text-[#1d5639]" },
  violet: { bar: "bg-[#2f7f58]", chip: "bg-[#e0f0e7] text-[#12492f]" },
  cyan: { bar: "bg-[#1d5639]", chip: "bg-[#dcece3] text-[#12492f]" },
  emerald: { bar: "bg-[#123321]", chip: "bg-[#d7e8de] text-[#0f321f]" },
};

export function LogisticsBoard({ columns }: { columns: BoardColumn[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleColumn(cards: BoardCard[], allSelected: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const card of cards) {
        if (allSelected) next.delete(card.id);
        else next.add(card.id);
      }
      return next;
    });
  }

  const selectedIds = [...selected];

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-5">
        {columns.map((column) => {
          const accent = ACCENT[column.accent] ?? ACCENT.blue;
          const selectableCards = column.cards.filter((card) => card.nextActionLabel);
          const allSelected =
            selectableCards.length > 0 && selectableCards.every((card) => selected.has(card.id));

          return (
            <section key={column.id} className="flex min-w-0 flex-col border border-stone-200 bg-white">
              <header className="border-b border-stone-200 px-4 py-3">
                <div className={`mb-2.5 h-1 w-9 rounded-full ${accent.bar}`} />
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-bold text-stone-900">{column.label}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${accent.chip}`}>
                    {column.cards.length + column.hiddenCount}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-stone-400">{column.description}</p>

                {selectableCards.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => toggleColumn(selectableCards, allSelected)}
                    className="mt-2 text-[11px] font-semibold text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline"
                  >
                    {allSelected ? "Fjern merking" : `Merk alle (${selectableCards.length})`}
                  </button>
                ) : null}
              </header>

              <div className="flex-1 space-y-2 p-2.5">
                {column.cards.length === 0 ? (
                  <p className="px-1.5 py-6 text-center text-xs text-stone-300">Tom</p>
                ) : null}

                {column.cards.map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    checked={selected.has(card.id)}
                    onToggle={() => toggle(card.id)}
                  />
                ))}

                {column.hiddenCount > 0 ? (
                  <p className="px-1.5 py-2 text-center text-[11px] text-stone-400">
                    + {column.hiddenCount} eldre
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {selectedIds.length > 0 ? (
        <div className="sticky bottom-4 z-20 mt-4">
          <ActionForm
            action={bulkAdvanceAction}
            className="flex flex-wrap items-center gap-4 border border-stone-800 bg-[#163f2a] px-5 py-3.5 shadow-lg"
            messageClassName="w-full"
          >
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="orderIds" value={id} />
            ))}

            <p className="text-sm font-semibold text-white">
              {selectedIds.length} ordre valgt
            </p>

            <label className="flex items-center gap-2 text-xs font-medium text-stone-300">
              <input
                type="checkbox"
                name="notifyCustomer"
                defaultChecked
                className="h-4 w-4 rounded border-stone-500 accent-emerald-500"
              />
              Varsle kundene på e-post
            </label>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="px-3 py-2 text-xs font-semibold text-stone-300 hover:text-white"
              >
                Nullstill
              </button>
              <SubmitButton
                pendingLabel="Flytter …"
                className="inline-flex h-9 items-center bg-[#d9ff7a] px-4 text-xs font-bold text-stone-900 hover:bg-[#c8f265]"
              >
                Flytt ett steg videre
              </SubmitButton>
            </div>
          </ActionForm>
        </div>
      ) : null}
    </>
  );
}

function Card({
  card,
  checked,
  onToggle,
}: {
  card: BoardCard;
  checked: boolean;
  onToggle: () => void;
}) {
  const topIssue = card.issues[0];

  return (
    <article
      className={`border bg-white p-2.5 transition ${
        checked
          ? "border-stone-900 ring-1 ring-stone-900"
          : topIssue?.severity === "high"
            ? "border-red-200"
            : "border-stone-200 hover:border-stone-300"
      }`}
    >
      <div className="flex items-start gap-2">
        {card.nextActionLabel ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={`Merk ordre ${card.reference}`}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-stone-300 accent-stone-900"
          />
        ) : (
          <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <Link
            href={card.href}
            className="block truncate font-mono text-[11px] font-bold text-stone-900 hover:underline"
          >
            {card.reference}
          </Link>
          <p className="mt-0.5 truncate text-xs font-semibold text-stone-700">{card.customerName}</p>
          <p className="truncate text-[11px] text-stone-400">{card.place}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold tabular-nums text-stone-900">{card.totalLabel}</span>
        <span className="text-[11px] text-stone-400">· {card.lineCount} linjer</span>
        {card.ageLabel ? (
          <span
            className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
              card.overdue ? "bg-red-100 text-red-700" : "bg-stone-100 text-stone-500"
            }`}
            title="Tid i dette steget"
          >
            {card.ageLabel}
          </span>
        ) : null}
      </div>

      {card.carrierLabel || card.trackingNumber || card.etaLabel ? (
        <div className="mt-1.5 space-y-0.5 border-t border-stone-100 pt-1.5">
          {card.carrierLabel ? (
            <p className="truncate text-[10px] text-stone-500">{card.carrierLabel}</p>
          ) : null}
          {card.trackingNumber ? (
            <p className="truncate font-mono text-[10px] text-stone-500">{card.trackingNumber}</p>
          ) : null}
          {card.etaLabel ? (
            <p className="truncate text-[10px] text-stone-500">Levering {card.etaLabel}</p>
          ) : null}
        </div>
      ) : null}

      {topIssue ? (
        <p
          className={`mt-1.5 truncate rounded px-1.5 py-1 text-[10px] font-semibold ${
            topIssue.severity === "high"
              ? "bg-red-50 text-red-700"
              : topIssue.severity === "medium"
                ? "bg-amber-50 text-amber-700"
                : "bg-stone-100 text-stone-500"
          }`}
          title={card.issues.map((issue) => issue.label).join(" · ")}
        >
          {topIssue.label}
          {card.issues.length > 1 ? ` +${card.issues.length - 1}` : ""}
        </p>
      ) : null}

      {card.nextActionLabel ? (
        <ActionForm action={advanceStageAction} className="mt-2">
          <input type="hidden" name="orderId" value={card.id} />
          <input type="hidden" name="notifyCustomer" value="on" />
          <SubmitButton
            pendingLabel="…"
            className="inline-flex h-7 w-full items-center justify-center bg-[#163f2a] px-2 text-[11px] font-bold text-white hover:bg-[#1d5639]"
            title="Flytter ordren ett steg videre og varsler kunden"
          >
            {card.nextActionLabel}
          </SubmitButton>
        </ActionForm>
      ) : null}
    </article>
  );
}
