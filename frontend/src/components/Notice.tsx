import { type ReactNode, useId } from "react";
import { RequestError } from "./ApiErrors";
import { Button } from "./Button";
import { IconLabel } from "./Icon";

export type NoticeTone = "info" | "neutral" | "success" | "warning" | "danger";

const TONES: Record<NoticeTone, string> = {
  info: "bg-mist text-body",
  neutral: "bg-fog text-body",
  success:
    "border border-success/30 bg-success-tint font-semibold text-success",
  warning: "bg-warning-tint text-warning-ink",
  danger: "border border-red-800/20 bg-red-50 text-red-900",
};

const PADDINGS = { sm: "px-3 py-2", md: "px-4 py-3", lg: "p-5" };

/** Something the screen tells the member, in a box of its own: `info` and
 * `neutral` explain, `success` confirms, `warning` must not be missed, and
 * `danger` comes before what cannot be undone. `callout` draws the warning's
 * rule down its left edge — a handover, a decision to remember. */
export function Notice({
  as: Element = "div",
  tone = "info",
  callout = false,
  padding = callout ? "sm" : "md",
  role,
  className = "",
  children,
}: {
  as?: "div" | "section" | "p";
  tone?: NoticeTone;
  callout?: boolean;
  padding?: keyof typeof PADDINGS;
  role?: "status" | "alert";
  className?: string;
  children: ReactNode;
}) {
  const shape = callout ? "border-l-4 border-warning" : "rounded-xl";
  return (
    <Element
      role={role}
      className={`text-sm ${shape} ${PADDINGS[padding]} ${TONES[tone]} ${className}`}
    >
      {children}
    </Element>
  );
}

/** "Enregistré", "Remarque ajoutée": a line in green that says the change
 * went through, read out without moving the focus. */
export function SuccessMessage({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      role="status"
      className={`text-sm font-semibold text-success ${className}`}
    >
      {children}
    </p>
  );
}

/** The step between asking to remove something and removing it: what will
 * go, then "Annuler" and the removal itself. Every removal in the app goes
 * through one. */
export function ConfirmPanel({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  pending = false,
  error,
  className = "",
  children,
}: {
  message: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  error?: unknown;
  className?: string;
  /** Anything to fill in before confirming. */
  children?: ReactNode;
}) {
  const messageId = useId();
  return (
    <div
      role="alertdialog"
      aria-labelledby={messageId}
      className={`rounded-2xl border border-red-800/20 bg-red-50 p-4 ${className}`}
    >
      <p id={messageId} className="text-sm text-red-900">
        {message}
      </p>
      {children}
      <div className="mt-3 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant="danger-solid" disabled={pending} onClick={onConfirm}>
          <IconLabel icon="xmark">{confirmLabel}</IconLabel>
        </Button>
      </div>
      {error ? <RequestError error={error} /> : null}
    </div>
  );
}
