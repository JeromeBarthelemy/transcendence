import { z } from "zod/mini";

import { csrfToken, get, patch, post, toApiError } from "./client";

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
  status: z.enum(["suggested", "open", "done", "dropped"]),
  opened_at: z.nullable(z.string()),
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
});

const entrySchema = z.object({
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
});

const workItemDetailSchema = z.object({
  id: z.number(),
  team_season: z.number(),
  title: z.string(),
  on_robot: z.boolean(),
  status: z.enum(["suggested", "open", "done", "dropped"]),
  opened_at: z.nullable(z.string()),
  current_step: z.nullable(workItemStepSchema),
  handover: handoverSchema,
  last_progress: lastProgressSchema,
  current_progress: z.nullable(entrySchema),
  current_user_participates: z.boolean(),
  thread: z.array(entrySchema),
});

export type WorkItemStep = z.infer<typeof workItemStepSchema>;
export type WorkItem = z.infer<typeof workItemSchema>;
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

export async function updateProgress(
  entryId: number,
  input: { body: string; handover: string },
): Promise<WorkItemEntry> {
  const { body } = await patch(`/api/entries/${entryId}/`, input);
  return parseEntry(body);
}

export async function uploadAttachment(
  entryId: number,
  file: File,
  peopleRecognisable: boolean,
  onProgress: (percentage: number) => void,
): Promise<z.infer<typeof attachmentSchema>> {
  const token = await csrfToken();
  const form = new FormData();
  form.set("file", file);
  form.set("people_recognisable", String(peopleRecognisable));

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/entries/${entryId}/attachments/`);
    request.withCredentials = true;
    request.setRequestHeader("Accept", "application/json");
    request.setRequestHeader("X-CSRFToken", token);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => reject(new TypeError("The upload failed"));
    request.onload = () => {
      let body: unknown = null;
      try {
        body = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        body = null;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(toApiError(request.status, body));
        return;
      }
      const result = attachmentSchema.safeParse(body);
      if (!result.success) {
        reject(new Error("The attachment response is invalid"));
        return;
      }
      onProgress(100);
      resolve(result.data);
    };
    request.send(form);
  });
}
