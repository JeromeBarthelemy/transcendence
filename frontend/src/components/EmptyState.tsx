import type { ReactNode } from "react";

/** Where a list would be, said in words: nothing yet, nothing matching. The
 * dashed edge marks the place the items will take. */
export function EmptyState({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={`rounded-2xl border border-dashed border-primary/20 p-5 text-sm text-muted ${className}`}
    >
      {children}
    </p>
  );
}
