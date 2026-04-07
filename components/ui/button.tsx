import * as React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-9 items-center justify-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:pointer-events-none disabled:opacity-60 ${className}`.trim()}
      {...props}
    />
  );
}
