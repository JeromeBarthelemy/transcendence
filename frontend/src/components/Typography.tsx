import type { HTMLAttributes, ReactNode } from "react";

type HeadingElement = "h1" | "h2" | "h3" | "p" | "span";

/** The title scale, largest first. Every title is Poppins (`brand-title`) in
 * the palette's darkest blue; only the size changes, and with it how tight
 * the letters sit. */
const HEADING_SIZES = {
  /** A chantier's own name, the largest thing on its screen. */
  display: "text-4xl tracking-[-0.04em] sm:text-5xl",
  /** A screen's title. */
  page: "text-3xl tracking-[-0.035em] sm:text-4xl",
  /** A screen's main part, under its eyebrow. */
  large: "text-3xl",
  /** A section or a panel. */
  section: "text-2xl",
  /** A card in a list. */
  card: "text-xl",
  /** A line inside a card. */
  small: "text-lg",
};
export type HeadingSize = keyof typeof HEADING_SIZES;

const DEFAULT_ELEMENT: Record<HeadingSize, HeadingElement> = {
  display: "h1",
  page: "h1",
  large: "h2",
  section: "h2",
  card: "h3",
  small: "h3",
};

export function Heading({
  size = "section",
  as,
  className = "",
  children,
  ...props
}: {
  size?: HeadingSize;
  /** The level, when the outline needs another than the size suggests. */
  as?: HeadingElement;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLHeadingElement>) {
  const Element = as ?? DEFAULT_ELEMENT[size];
  return (
    <Element
      className={`brand-title text-ink ${HEADING_SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </Element>
  );
}

const EYEBROW_TONES = {
  accent: "text-accent",
  danger: "text-red-800",
  /** The colour of the box it heads: a handover's amber, say. */
  inherit: "",
};

/** The short line in capitals above a title, or naming a block on its own:
 * "Aujourd'hui", "Administration du club". */
export function Eyebrow({
  as: Element = "p",
  size = "xs",
  tone = "accent",
  className = "",
  children,
  ...props
}: {
  as?: "p" | "h2" | "h3" | "span";
  size?: "xs" | "sm";
  tone?: keyof typeof EYEBROW_TONES;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Element
      className={`font-bold tracking-[0.14em] uppercase ${
        size === "sm" ? "text-sm" : "text-xs"
      } ${EYEBROW_TONES[tone]} ${className}`}
      {...props}
    >
      {children}
    </Element>
  );
}
