import { z } from "zod/mini";
import { get, post } from "./client";
import { workItemSteps } from "./workItems";

const memberSchema = z.object({
  display_name: z.string(),
  avatar: z.nullable(z.string()),
});
const entrySchema = z.object({
  id: z.number(),
  work_item: z.nullable(
    z.object({
      id: z.number(),
      title: z.string(),
    }),
  ),
  type: z.string(),
  body: z.string(),
  occurred_at: z.string(),
  author: z.string(),
  can_remove: z.boolean(),
  can_correct: z.boolean(),
});

const workdaySchema = z.object({
  day: z.string(),
  previous: z.optional(z.nullable(z.string())),
  next: z.optional(z.nullable(z.string())),
  entries: z.array(entrySchema),
  advanced_work_items: z.number(),
  present: z.array(memberSchema),
  roster: z.number(),
});

const noteSchema = z.object({
  id: z.number(),
  work_item: z.nullable(
    z.object({
      id: z.number(),
      title: z.string(),
    }),
  ),
  type: z.literal("note"),
  body: z.string(),
  occurred_at: z.string(),
  author: z.string(),
});

// The summary reads more of each entry than the team home does.
const summaryEntrySchema = z.extend(entrySchema, {
  step: z.nullable(z.enum(workItemSteps)),
  handover: z.string(),
  participants: z.array(memberSchema),
  attachments: z.array(z.object({ content_type: z.string() })),
});
const daySummarySchema = z.extend(workdaySchema, {
  entries: z.array(summaryEntrySchema),
});

const activityCalendarSchema = z.object({
  month: z.string(),
  today: z.string(),
  days: z.array(
    z.object({
      day: z.string(),
      progress: z.int().check(z.nonnegative()),
      notes: z.int().check(z.nonnegative()),
      decisions: z.int().check(z.nonnegative()),
    }),
  ),
});

export type ActivityCalendarData = z.infer<typeof activityCalendarSchema>;

export async function getActivityCalendar(
  teamSeasonId: number,
  month: string,
): Promise<ActivityCalendarData> {
  const { body } = await get(
    `/api/team-seasons/${teamSeasonId}/calendar/?month=${encodeURIComponent(month)}`,
  );
  const result = activityCalendarSchema.safeParse(body);
  if (!result.success || result.data.month !== month) {
    throw new Error("The activity calendar response is invalid");
  }
  return result.data;
}

export type Workday = z.infer<typeof workdaySchema>;
export type DaySummary = z.infer<typeof daySummarySchema>;
export type SummaryEntry = z.infer<typeof summaryEntrySchema>;

export async function getWorkday(
  teamSeasonId: number,
  day: string,
): Promise<Workday> {
  const { body } = await get(`/api/team-seasons/${teamSeasonId}/days/${day}/`);
  const result = workdaySchema.safeParse(body);
  if (!result.success) {
    throw new Error("The workday response is invalid");
  }
  return result.data;
}

export async function getDaySummary(
  teamSeasonId: number,
  day: string,
): Promise<DaySummary> {
  const { body } = await get(`/api/team-seasons/${teamSeasonId}/days/${day}/`);
  const result = daySummarySchema.safeParse(body);
  if (!result.success) {
    throw new Error("The day summary response is invalid");
  }
  return result.data;
}

/** `clientId` (#154) makes a replayed offline save (#157) land once: sent
 * twice with the same one, the server answers with the first note both
 * times rather than creating a second. */
export async function createTeamNote(
  teamSeasonId: number,
  noteBody: string,
  clientId?: string,
) {
  const { body } = await post(`/api/team-seasons/${teamSeasonId}/notes/`, {
    body: noteBody,
    ...(clientId ? { client_id: clientId } : {}),
  });
  const result = noteSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The note response is invalid");
  }
  return result.data;
}
