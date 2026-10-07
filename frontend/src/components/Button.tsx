import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

/** What the button does to the club's data, not just its colour:
 * - primary: the screen's main action;
 * - secondary: anything else, and every "Annuler";
 * - dark: starting work (today's progress, a note);
 * - danger: opens a removal, which still asks first;
 * - danger-solid: the removal itself, inside its confirmation;
 * - success: closing a work item as done. */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "dark"
  | "danger"
  | "danger-solid"
  | "success";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-primary",
  secondary: "border border-primary/20 bg-white text-ink hover:bg-tint",
  dark: "bg-ink text-white hover:bg-accent",
  danger: "border border-red-800/25 bg-white text-red-800 hover:bg-red-50",
  "danger-solid": "bg-red-800 text-white hover:bg-red-900",
  success: "border border-success/30 bg-white text-success hover:bg-success/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5",
  md: "px-4 py-2",
};

export function buttonClass({
  variant = "secondary",
  size = "md",
  pill = false,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Round ends: actions that sit in a header, beside a status chip. */
  pill?: boolean;
} = {}) {
  return [
    "inline-flex items-center justify-center gap-2 text-sm font-semibold no-underline transition",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon",
    "disabled:cursor-not-allowed disabled:opacity-50",
    pill ? "rounded-full" : "rounded-xl",
    SIZES[size],
    VARIANTS[variant],
  ].join(" ");
}

type StyleProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pill?: boolean;
};

export function Button({
  variant,
  size,
  pill,
  className = "",
  type = "button",
  ...props
}: StyleProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`${buttonClass({ variant, size, pill })} ${className}`}
      {...props}
    />
  );
}

/** A link that looks like a button: it goes somewhere rather than doing
 * something. */
export function ButtonLink({
  variant,
  size,
  pill,
  className = "",
  ...props
}: StyleProps & LinkProps & { children: ReactNode }) {
  return (
    <Link
      className={`${buttonClass({ variant, size, pill })} ${className}`}
      {...props}
    />
  );
}

/** An action that reads as a word in the text: correcting or removing one
 * entry among many, where a boxed button would outweigh the entry itself. */
export function TextButton({
  danger = false,
  className = "",
  type = "button",
  ...props
}: { danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon ${
        danger ? "text-red-800" : "text-accent"
      } ${className}`}
      {...props}
    />
  );
}
