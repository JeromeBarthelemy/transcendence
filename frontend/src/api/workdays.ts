import { z } from "zod/mini";
import { get, post } from "./client";

const memberSchema = z.object({
  display_name: z.string(),
  avatar: z.nullable(z.string()),
});
const entrySchema = z.object({
  id: z.number(),
  type: z.string(),
  body: z.string(),
  occurred_at: z.string(),
  author: z.string(),
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
  type: z.literal("note"),
  body: z.string(),
  occurred_at: z.string(),
  author: z.string(),
});

export type Workday = z.infer<typeof workdaySchema>;

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

export async function createTeamNote(teamSeasonId: number, noteBody: string) {
  const { body } = await post(`/api/team-seasons/${teamSeasonId}/notes/`, {
    body: noteBody,
  });
  const result = noteSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The note response is invalid");
  }
  return result.data;
}
