import type { HTMLAttributes, ReactNode } from "react";

type HeadingElement = "h1" | "h2" | "h3" | "p" | "span";

/** The title scale, largest first. Every title is Poppins (`brand-title`) in
 * the palette's darkest blue; only the size changes, and with it how tight
 * the letters sit. */
const HEADING_SIZES = {
  /** A chantier's own name, the largest thing on its screen. */
  display: "text-3xl leading-tight tracking-[-0.035em] sm:text-4xl",
  /** Authentication's compact display scale, with its tighter leading. */
  auth: "text-3xl leading-tight tracking-[-0.035em] sm:text-4xl",
  /** A screen's title. */
  page: "text-2xl leading-tight tracking-[-0.03em] sm:text-3xl",
  /** A screen's main part, under its eyebrow. */
  large: "text-2xl tracking-[-0.025em]",
  /** A section or a panel. */
  section: "text-xl tracking-[-0.02em]",
  /** A card in a list. */
  card: "text-base tracking-[-0.015em] sm:text-lg",
  /** A line inside a card. */
  small: "text-lg",
};
export type HeadingSize = keyof typeof HEADING_SIZES;

const DEFAULT_ELEMENT: Record<HeadingSize, HeadingElement> = {
  display: "h1",
  auth: "h1",
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

const EYEBROW_TRACKING = {
  tight: "tracking-[0.12em]",
  normal: "tracking-[0.14em]",
  wide: "tracking-[0.16em]",
  wider: "tracking-[0.18em]",
};

/** The short line in capitals above a title, or naming a block on its own:
 * "Aujourd'hui", "Administration du club". */
export function Eyebrow({
  as: Element = "p",
  size = "xs",
  tone = "accent",
  tracking = "normal",
  className = "",
  children,
  ...props
}: {
  as?: "p" | "h2" | "h3" | "span";
  size?: "xs" | "sm";
  tone?: keyof typeof EYEBROW_TONES;
  tracking?: keyof typeof EYEBROW_TRACKING;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Element
      className={`font-bold ${EYEBROW_TRACKING[tracking]} uppercase ${
        size === "sm" ? "text-sm" : "text-xs"
      } ${EYEBROW_TONES[tone]} ${className}`}
      {...props}
    >
      {children}
    </Element>
  );
}
