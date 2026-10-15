import { z } from "zod/mini";

import { del, get, patch, post, upload } from "./client";

export const workItemSteps = [
  "brainstorming",
  "prototyping",
  "building",
  "dry_tests",
  "integration",
  "test_zero",
  "tuning",
  "repair",
] as const;

const workItemStepSchema = z.enum(workItemSteps);
const memberSchema = z.object({
  display_name: z.string(),
  avatar: z.nullable(z.string()),
});
const handoverSchema = z.nullable(
  z.object({
    body: z.string(),
    author: z.string(),
    step: z.nullable(workItemStepSchema),
    occurred_at: z.string(),
    day: z.string(),
  }),
);
const lastProgressSchema = z.nullable(
  z.object({
    occurred_at: z.string(),
    day: z.string(),
    participants: z.array(memberSchema),
  }),
);

const workItemSchema = z.object({
  id: z.number(),
  team_season: z.number(),
  title: z.string(),
  on_robot: z.boolean(),
  status: z.enum(["open", "done", "dropped"]),
  opened_at: z.string(),
  closed_at: z.nullable(z.string()),
  current_step: z.nullable(workItemStepSchema),
  handover: handoverSchema,
  last_progress: lastProgressSchema,
});

const attachmentSchema = z.object({
  id: z.number(),
  name: z.string(),
  content_type: z.string(),
  url: z.string(),
  people_recognisable: z.boolean(),
  uploaded_by: z.string(),
  can_remove: z.boolean(),
});

export const entrySchema = z.object({
  id: z.number(),
  work_item: z.nullable(
    z.object({
      id: z.number(),
      title: z.string(),
    }),
  ),
  type: z.enum(["progress", "note", "decision"]),
  body: z.string(),
  step: z.nullable(workItemStepSchema),
  handover: z.string(),
  occurred_at: z.string(),
  author: z.string(),
  participants: z.array(memberSchema),
  attachments: z.array(attachmentSchema),
  can_remove: z.boolean(),
  can_correct: z.boolean(),
});

const workItemDetailSchema = z.extend(workItemSchema, {
  current_progress: z.nullable(entrySchema),
  current_user_participates: z.boolean(),
  thread: z.array(entrySchema),
});

export type WorkItemStep = z.infer<typeof workItemStepSchema>;
export type WorkItem = z.infer<typeof workItemSchema>;
export type WorkItemStatus = WorkItem["status"];
export type WorkItemEntry = z.infer<typeof entrySchema>;
export type WorkItemDetail = z.infer<typeof workItemDetailSchema>;

function parseEntry(body: unknown): WorkItemEntry {
  const result = entrySchema.safeParse(body);
  if (!result.success) {
    throw new Error("The work item entry response is invalid");
  }
  return result.data;
}

export async function getWorkItems(teamSeasonId: number): Promise<WorkItem[]> {
  const { body } = await get(`/api/team-seasons/${teamSeasonId}/work-items/`);
  const result = z.array(workItemSchema).safeParse(body);
  if (!result.success) {
    throw new Error("The work item response is invalid");
  }
  return result.data;
}

export async function openWorkItem(
  teamSeasonId: number,
  input: { title: string; on_robot: boolean },
): Promise<WorkItem> {
  const { body } = await post(
    `/api/team-seasons/${teamSeasonId}/work-items/`,
    input,
  );
  const result = workItemSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The work item response is invalid");
  }
  return result.data;
}

export async function getWorkItem(id: number): Promise<WorkItemDetail> {
  const { body } = await get(`/api/work-items/${id}/`);
  const result = workItemDetailSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The work item detail response is invalid");
  }
  return result.data;
}

export async function tickWorkItem(
  id: number,
  step?: WorkItemStep,
): Promise<WorkItemEntry> {
  const { body } = await post(
    `/api/work-items/${id}/tick/`,
    step ? { step } : {},
  );
  return parseEntry(body);
}

/** Closing, or reopening on purpose (#139). A reason becomes a note in the
 * work item's history; dropping requires one. */
export async function changeWorkItemStatus(
  id: number,
  status: WorkItemStatus,
  reason: string,
): Promise<WorkItem> {
  const { body } = await patch(`/api/work-items/${id}/`, {
    status,
    ...(reason ? { reason } : {}),
  });
  const result = workItemSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The work item response is invalid");
  }
  return result.data;
}

/** Leaves today's progress, for oneself only. The last one leaving a
 * progress that holds no file deletes it, text included. */
export async function leaveTodaysProgress(workItemId: number): Promise<void> {
  await del(`/api/work-items/${workItemId}/tick/`);
}

/** Only a work item with no trace: the server refuses any other. */
/** A note or a decision by its author, any trace by a mentor. */
export async function removeEntry(entryId: number): Promise<void> {
  await del(`/api/entries/${entryId}/`);
}

/** A mentor's correction: refused with `entry_changed` if the text is no
 * longer `body_was`. */
export async function correctEntry(
  entryId: number,
  input: { body: string; body_was: string },
): Promise<void> {
  await patch(`/api/entries/${entryId}/`, input);
}

export async function removeAttachment(attachmentId: number): Promise<void> {
  await del(`/api/attachments/${attachmentId}/`);
}

export async function deleteWorkItem(id: number): Promise<void> {
  await del(`/api/work-items/${id}/`);
}

/** The text is only added to. A handover change sends what it started
 * from: the server refuses it with `progress_changed` if the handover holds
 * something else by now. */
export interface ProgressChanges {
  addition?: string;
  handover?: string;
  handover_was?: string;
}

export async function updateProgress(
  entryId: number,
  input: ProgressChanges,
): Promise<WorkItemEntry> {
  const { body } = await patch(`/api/entries/${entryId}/`, input);
  return parseEntry(body);
}

/** `clientId` (#154) makes a replayed offline save (#157) land once: sent
 * twice with the same one, the server answers with the first note both
 * times rather than creating a second. */
export async function createWorkItemNote(
  teamSeasonId: number,
  workItemId: number,
  noteBody: string,
  clientId?: string,
): Promise<WorkItemEntry> {
  const { body } = await post(`/api/team-seasons/${teamSeasonId}/notes/`, {
    body: noteBody,
    work_item: workItemId,
    ...(clientId ? { client_id: clientId } : {}),
  });
  return parseEntry(body);
}

export async function uploadAttachment(
  entryId: number,
  file: File,
  peopleRecognisable: boolean,
  onProgress: (sent: number) => void,
): Promise<z.infer<typeof attachmentSchema>> {
  const form = new FormData();
  form.set("file", file);
  form.set("people_recognisable", String(peopleRecognisable));

  const { body } = await upload(
    "POST",
    `/api/entries/${entryId}/attachments/`,
    form,
    onProgress,
  );
  const result = attachmentSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The attachment response is invalid");
  }
  onProgress(1);
  return result.data;
}
