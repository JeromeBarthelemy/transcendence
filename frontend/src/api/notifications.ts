import { z } from "zod/mini";

import { get, post } from "./client";

export const notificationsQueryKey = ["notifications"] as const;

const noticeSchema = z.object({
  id: z.number(),
  verb: z.enum([
    "work_item_opened",
    "work_item_done",
    "work_item_dropped",
    "work_item_deleted",
    "entry_added",
    "entry_updated",
    "entry_removed",
  ]),
  actor: z.object({ display_name: z.string(), avatar: z.nullable(z.string()) }),
  team_season: z.number(),
  // Kept by the notice itself, so a deleted work item or trace keeps its
  // title or type, its id then null.
  work_item: z.nullable(
    z.object({ id: z.nullable(z.number()), title: z.string() }),
  ),
  entry: z.nullable(
    z.object({
      id: z.nullable(z.number()),
      type: z.enum(["progress", "note", "decision"]),
    }),
  ),
  created_at: z.string(),
  read: z.boolean(),
});

const notificationsSchema = z.object({
  unread: z.number(),
  items: z.array(noticeSchema),
});

export type Notice = z.infer<typeof noticeSchema>;
export type Notifications = z.infer<typeof notificationsSchema>;

/** The member's own, newest first: the unread count and the latest few. */
export async function getNotifications(): Promise<Notifications> {
  const { body } = await get("/api/notifications/");
  const result = notificationsSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The notifications response is invalid");
  }
  return result.data;
}

export async function markNotificationsRead(ids: number[]): Promise<void> {
  await post("/api/notifications/read/", { ids });
}
