"use client";

import clsx from "clsx";
import { nb } from "date-fns/locale";
import { DayPicker } from "react-day-picker";
import type { ComponentProps } from "react";

type CalendarProps = ComponentProps<typeof DayPicker>;

export function Calendar({ className, classNames, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays
      locale={nb}
      className={clsx("p-2", className)}
      classNames={{
        months: "flex flex-col gap-2",
        month: "space-y-2",
        caption: "relative flex items-center justify-center",
        caption_label: "text-sm font-semibold text-stone-900",
        nav: "flex items-center gap-1",
        button_previous:
          "absolute left-1 inline-flex h-7 w-7 items-center justify-center rounded-sm border border-stone-200 bg-white text-stone-700 hover:border-stone-400",
        button_next:
          "absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-sm border border-stone-200 bg-white text-stone-700 hover:border-stone-400",
        month_grid: "w-full border-collapse",
        weekdays: "grid grid-cols-7",
        weekday: "text-center text-[11px] font-medium text-stone-500",
        week: "mt-1 grid grid-cols-7",
        day: "text-center",
        day_button:
          "mx-auto inline-flex h-8 w-8 items-center justify-center rounded-sm text-sm text-stone-900 hover:bg-stone-100",
        selected: "bg-stone-900 text-white hover:bg-stone-900",
        today: "font-semibold text-stone-900 ring-1 ring-stone-300",
        outside: "text-stone-400",
        disabled: "cursor-not-allowed text-stone-300",
        ...classNames,
      }}
      {...props}
    />
  );
}
