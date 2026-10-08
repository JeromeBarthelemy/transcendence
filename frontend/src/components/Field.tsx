import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

// The account forms (log-in, sign-up) keep their own, larger fields from
// styles.css (`form-input`): they are a page of their own, these sit inside
// the working screens.

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
export function fieldClass(tone: FieldTone = "default") {
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
  className = "",
  ...props
}: { tone?: FieldTone } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`${fieldClass(tone)} ${unless(className, "mt-", "mt-2")}`}
      {...props}
    />
  );
}

export function TextArea({
  tone,
  className = "",
  ...props
}: { tone?: FieldTone } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
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
}: { tone?: FieldTone } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`${fieldClass(tone)} ${unless(className, "mt-", "mt-2")}`}
      {...props}
    />
  );
}

/** A field's name, above it — or around it, the field inside the label. */
export function Label({
  className = "",
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the caller's, by htmlFor or as a child.
    <label
      className={`text-sm font-semibold text-ink ${className}`}
      {...props}
    />
  );
}
