import * as React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", type = "text", ...props },
  ref,
) {
  return (
    <input
      type={type}
      ref={ref}
      className={`flex h-9 w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 shadow-xs transition-colors outline-none placeholder:text-stone-400 focus-visible:border-stone-900 disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
      {...props}
    />
  );
});
