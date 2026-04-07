import * as React from "react";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className = "", ...props }: DivProps) {
  return (
    <div
      className={`rounded-xl border border-stone-200 bg-white text-stone-950 shadow-sm ${className}`.trim()}
      {...props}
    />
  );
}

export function CardHeader({ className = "", ...props }: DivProps) {
  return <div className={`flex flex-col space-y-1.5 p-4 ${className}`.trim()} {...props} />;
}

export function CardTitle({ className = "", ...props }: DivProps) {
  return <h2 className={`text-lg font-semibold leading-none tracking-tight ${className}`.trim()} {...props} />;
}

export function CardDescription({ className = "", ...props }: DivProps) {
  return <p className={`text-xs text-stone-600 ${className}`.trim()} {...props} />;
}

export function CardContent({ className = "", ...props }: DivProps) {
  return <div className={`p-4 pt-0 ${className}`.trim()} {...props} />;
}

export function CardFooter({ className = "", ...props }: DivProps) {
  return <div className={`flex items-center p-4 pt-0 ${className}`.trim()} {...props} />;
}
