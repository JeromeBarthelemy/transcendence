import { z } from "zod/mini";
import { get } from "./client";

const workItemStepSchema = z.enum([
  "brainstorming",
  "prototyping",
  "building",
  "dry_tests",
  "integration",
  "test_zero",
  "tuning",
  "repair",
]);

const workItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  on_robot: z.boolean(),
  status: z.enum(["suggested", "open", "done", "dropped"]),
  current_step: z.nullable(workItemStepSchema),
  handover: z.nullable(
    z.object({
      body: z.string(),
      author: z.string(),
      step: z.nullable(workItemStepSchema),
      occurred_at: z.string(),
      day: z.string(),
    }),
  ),
  last_progress: z.nullable(
    z.object({
      occurred_at: z.string(),
      day: z.string(),
      participants: z.array(
        z.object({
          display_name: z.string(),
          avatar: z.nullable(z.string()),
        }),
      ),
    }),
  ),
});

export type WorkItem = z.infer<typeof workItemSchema>;

export async function getWorkItems(teamSeasonId: number): Promise<WorkItem[]> {
  const { body } = await get(`/api/team-seasons/${teamSeasonId}/work-items/`);
  const result = z.array(workItemSchema).safeParse(body);
  if (!result.success) {
    throw new Error("The work item response is invalid");
  }
  return result.data;
}
