import type { HTMLAttributes, ReactNode } from "react";

type PanelElement = "div" | "section" | "article" | "form" | "ul" | "ol";

const PADDINGS = {
  none: "overflow-hidden",
  sm: "p-4",
  md: "p-5",
  lg: "p-5 sm:p-7",
  xl: "p-8",
  auth: "p-6 sm:p-9",
};

/** A quiet paper surface. Padding changes with the content, not the radius
 * or elevation; menus alone need a shadow above the page. */
export function Panel({
  as: Element = "div",
  variant = "default",
  padding = variant === "auth" ? "auth" : "md",
  danger = false,
  className = "",
  children,
  ...props
}: {
  as?: PanelElement;
  /** Roomier sign-in/sign-up forms, using the same paper surface. */
  variant?: "default" | "auth";
  padding?: keyof typeof PADDINGS;
  /** The border of an irreversible action's own section. */
  danger?: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  const divided = padding === "none" ? "divide-y divide-line" : "";
  return (
    <Element
      className={`min-w-0 rounded-lg border bg-white ${PADDINGS[padding]} ${divided} ${
        danger ? "border-red-800/20" : "border-line"
      } ${className}`}
      {...props}
    >
      {children}
    </Element>
  );
}
