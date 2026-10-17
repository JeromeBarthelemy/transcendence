import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { WorkItem } from "../api/workItems";

export type ChipTone =
  | "blue"
  | "ink"
  | "success"
  | "neutral"
  | "warning"
  | "mint";

const TONES: Record<ChipTone, string> = {
  blue: "bg-tint text-primary",
  ink: "bg-ink text-white",
  success: "bg-success-tint text-success",
  neutral: "bg-fog text-muted",
  warning: "bg-warning-tint text-warning-ink",
  mint: "bg-mint-tint text-mint-deep",
};

/** A short label on a coloured ground: a status, a role, a source. The
 * colour only doubles the words, which always stay. */
export function Chip({
  tone = "blue",
  size = "sm",
  className = "",
  children,
}: {
  tone?: ChipTone;
  size?: "xs" | "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  const sizes = {
    xs: "px-2 py-0.5 text-xs",
    sm: "px-3 py-1 text-xs",
    md: "px-3 py-1 text-sm",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md font-semibold whitespace-nowrap ${sizes[size]} ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** A work item's status, the same on the team home's cards and on the
 * chantier screen: open is the usual blue, done the green that already says
 * "confirmed", dropped a neutral grey — dropping a lead is a normal outcome,
 * not an error, so not red; and not amber either, which belongs to the
 * pending handover. */
export const STATUS_TONES: Record<WorkItem["status"], ChipTone> = {
  open: "blue",
  done: "success",
  dropped: "neutral",
};

export function StatusChip({
  status,
  size,
  children,
}: {
  status: WorkItem["status"];
  size?: "sm" | "md";
  /** In place of the status's own name, while it is being changed. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Chip tone={STATUS_TONES[status]} size={size}>
      {children ?? t(`teamHome.statuses.${status}`)}
    </Chip>
  );
}
