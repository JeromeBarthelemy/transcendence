import type { ComponentProps } from "react";

/** Authentication keeps its established larger fields; working screens
 * use the compact default. Neither page needs a second set of form CSS. */
export type FieldVariant = "default" | "auth";

const TONES = {
  default: "border-primary/20 bg-white",
  /** The handover: what the next ones must read. */
  warning: "border-warning/35 bg-warning-wash",
  /** What confirms an irreversible act: a password before deleting. */
  danger: "border-red-800/25 bg-white",
};
export type FieldTone = keyof typeof TONES;

/** 16 px, whatever the text around it: fields inherit the font, and iOS
 * zooms the page into any field smaller than that once it takes the focus. */
export function fieldClass(
  tone: FieldTone = "default",
  variant: FieldVariant = "default",
) {
  if (variant === "auth") {
    const surface = tone === "default" ? "border-line bg-white" : TONES[tone];
    return `block w-full rounded-[0.8rem] border px-[0.9rem] py-3 text-base font-normal text-ink outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-azure/18 aria-invalid:border-danger aria-invalid:focus-visible:border-danger ${surface}`;
  }
  return `block w-full rounded-xl border px-3 py-2 text-base font-normal text-body focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lagoon aria-invalid:border-danger ${TONES[tone]}`;
}

/** A default the caller's own class may replace: two utilities on the same
 * property do not reliably override each other by their order. */
function unless(className: string, prefix: string, fallback: string) {
  return className.split(" ").some((each) => each.startsWith(prefix))
    ? className
    : `${fallback} ${className}`;
}

export function TextInput({
  tone,
  variant,
  className = "",
  ...props
}: { tone?: FieldTone; variant?: FieldVariant } & ComponentProps<"input">) {
  return (
    <input
      className={`${fieldClass(tone, variant)} ${unless(className, "mt-", "mt-2")}`}
      {...props}
    />
  );
}

export function TextArea({
  tone,
  className = "",
  ...props
}: { tone?: FieldTone } & ComponentProps<"textarea">) {
  const spaced = unless(className, "mt-", "mt-2");
  return (
    <textarea
      className={`${fieldClass(tone)} ${unless(spaced, "min-h-", "min-h-24")}`}
      {...props}
    />
  );
}

export function Select({
  tone,
  className = "",
  ...props
}: { tone?: FieldTone } & ComponentProps<"select">) {
  return (
    <select
      className={`${fieldClass(tone)} ${unless(className, "mt-", "mt-2")}`}
      {...props}
    />
  );
}

/** A field's name, above it — or around it, the field inside the label. */
export function Label({
  variant = "default",
  className = "",
  ...props
}: { variant?: FieldVariant } & ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the caller's, by htmlFor or as a child.
    <label
      className={`text-sm text-ink ${variant === "auth" ? "block font-bold leading-normal" : "font-semibold"} ${className}`}
      {...props}
    />
  );
}

/** The hint is tied to its field through aria-describedby, not its text. */
export function FieldHint({
  variant = "default",
  className = "",
  ...props
}: { variant?: FieldVariant } & ComponentProps<"p">) {
  return (
    <p
      className={`text-muted ${variant === "auth" ? "text-[0.8rem] leading-normal" : "text-xs"} ${unless(className, "mt-", variant === "auth" ? "mt-[0.45rem]" : "mt-1")}`}
      {...props}
    />
  );
}
