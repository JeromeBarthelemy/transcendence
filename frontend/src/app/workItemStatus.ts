import type { WorkItem } from "../api/workItems";

/** A work item's status pill, the same on the team home's cards and on the
 * chantier screen. The color only doubles the label, which stays: open is
 * the usual blue, done the green that already says "confirmed", dropped a
 * neutral grey — dropping a lead is a normal outcome, not an error, so not
 * red; and not amber either, which belongs to the pending handover. */
export const statusColors: Record<WorkItem["status"], string> = {
  open: "bg-tint text-accent",
  done: "bg-success-tint text-success",
  dropped: "bg-fog text-muted",
};
