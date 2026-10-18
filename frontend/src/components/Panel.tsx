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

/** The white card every screen is built from. `lg` and `xl` are a screen's
 * main blocks, rounder; `md` and `sm` the cards inside a list; `none` a list
 * whose rows draw their own padding, divided by a hairline. */
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
  /** The existing translucent, roomier sign-in/sign-up frame. */
  variant?: "default" | "auth";
  padding?: keyof typeof PADDINGS;
  /** The border of an irreversible action's own section. */
  danger?: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  const round =
    variant === "auth"
      ? "rounded-[1.75rem]"
      : padding === "lg" || padding === "xl"
        ? "rounded-3xl"
        : "rounded-2xl";
  const divided = padding === "none" ? "divide-y divide-primary/10" : "";
  return (
    <Element
      className={`border ${variant === "auth" ? "bg-white/90 shadow-panel" : "bg-white shadow-sm"} ${round} ${PADDINGS[padding]} ${divided} ${
        danger
          ? "border-red-800/20"
          : variant === "auth"
            ? "border-primary/10"
            : "border-primary/12"
      } ${className}`}
      {...props}
    >
      {children}
    </Element>
  );
}
