"use client";
import { useTransition } from "react";

export function StatusSelect({ name, defaultValue, options }: { name: string, defaultValue: string, options: {value: string, label: string}[] }) {
  const [isPending, startTransition] = useTransition();

  return (
    <select 
      name={name} 
      defaultValue={defaultValue} 
      className="text-xs border rounded p-1 bg-blue-50 w-full disabled:opacity-50"
      onChange={(e) => {
        const form = e.target.form;
        if (form) {
          startTransition(() => {
            form.requestSubmit();
          });
        }
      }}
      disabled={isPending}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
