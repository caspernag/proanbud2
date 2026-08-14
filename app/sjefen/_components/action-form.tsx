"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Resultatet enhver server action i /sjefen returnerer. Definert her framfor i
 * en "use server"-fil, slik at både klientkomponenter og actions kan importere
 * den uten at en type blir liggende som eksport i en server-modul.
 */
export type ActionState = { ok: boolean; message: string } | null;

type ServerAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Skjema-innpakning som viser resultatet av en server action inline og låser
 * feltene mens den kjører. Brukes overalt i adminpanelet slik at en handling
 * aldri feiler i stillhet.
 */
export function ActionForm({
  action,
  children,
  className,
  messageClassName,
}: {
  action: ServerAction;
  children: ReactNode;
  className?: string;
  messageClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {/* display:contents holder layouten uendret, men lar fieldset låse feltene. */}
      <fieldset disabled={pending} style={{ display: "contents" }}>
        {children}
      </fieldset>

      {state ? (
        <p
          role="status"
          className={`mt-2 px-3 py-2 text-xs font-medium ${
            state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
          } ${messageClassName ?? ""}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  className,
  title,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  title?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      title={title}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
      disabled={pending}
    >
      {pending ? (pendingLabel ?? "Jobber …") : children}
    </button>
  );
}
