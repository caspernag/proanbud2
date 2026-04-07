"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

type DeleteProjectButtonProps = {
  action: (formData: FormData) => Promise<void>;
  slug: string;
  projectTitle: string;
};

export function DeleteProjectButton({ action, slug, projectTitle }: DeleteProjectButtonProps) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (confirmed) {
          return;
        }

        const accepted = window.confirm(
          `Slette prosjektet \"${projectTitle}\"? Dette kan ikke angres.`,
        );

        if (!accepted) {
          event.preventDefault();
          return;
        }

        setConfirmed(true);
      }}
      className="w-full sm:w-auto"
    >
      <input type="hidden" name="slug" value={slug} />
      <DeleteProjectSubmitButton />
    </form>
  );
}

function DeleteProjectSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-full border border-[var(--danger)]/40 bg-[var(--warm-soft)] px-4 py-2 text-sm font-semibold text-[var(--danger)] transition hover:border-[var(--danger)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
    >
      {pending ? "Sletter..." : "Slett prosjekt"}
    </button>
  );
}
