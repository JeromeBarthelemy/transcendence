import type { ReactNode } from "react";

const WIDTHS = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "6xl": "max-w-6xl",
};

/** A screen's main column, between the header and the footer: centred, the
 * same side margins everywhere, and as wide as what it shows needs — a form
 * narrow, the team's board wide. */
export function Page({
  width = "4xl",
  message = false,
  className = "",
  children,
}: {
  width?: keyof typeof WIDTHS;
  /** A screen that only says one thing — loading, refused, not found — sits
   * a little lower, with even space above and below. */
  message?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main
      className={`mx-auto w-full flex-1 px-5 sm:px-8 ${WIDTHS[width]} ${
        message ? "py-14" : "py-10 sm:py-14"
      } ${className}`}
    >
      {children}
    </main>
  );
}
