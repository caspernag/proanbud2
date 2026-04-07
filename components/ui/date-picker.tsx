"use client";

import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Calendar } from "@/components/ui/calendar";

type DatePickerProps = {
  value?: Date;
  onChange: (value?: Date) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function DatePicker({
  value,
  onChange,
  placeholder = "Velg dato",
  disabled = false,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={clsx(
            "mt-1 inline-flex h-8 w-full items-center justify-between rounded-sm border border-stone-300 bg-white px-2 text-left text-xs text-stone-900 outline-none hover:border-stone-900 focus:border-stone-900 disabled:cursor-not-allowed",
            className,
          )}
        >
          <span className={value ? "text-stone-900" : "text-stone-500"}>
            {value ? format(value, "dd.MM.yyyy", { locale: nb }) : placeholder}
          </span>
          <CalendarIcon className="h-4 w-4 text-stone-500" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 w-auto rounded-md border border-stone-200 bg-white p-2 shadow-xl"
        >
          <Calendar
            mode="single"
            selected={value}
            onSelect={(nextValue) => {
              onChange(nextValue);
              setOpen(false);
            }}
          />

          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
              className="inline-flex h-7 items-center rounded-sm border border-stone-300 px-2 text-xs font-medium text-stone-700 hover:border-stone-900 hover:text-stone-900"
            >
              Fjern dato
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
