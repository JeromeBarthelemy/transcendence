import { z } from "zod/mini";

import { get } from "./client";
import { workItemSteps } from "./workItems";

const periodSchema = z.object({
  since: z.string(),
  until: z.string(),
});

const snapshotSchema = z.object({
  work_items_by_status: z.array(
    z.object({
      status: z.enum(["open", "done", "dropped"]),
      count: z.number(),
    }),
  ),
  work_items_by_step: z.array(
    z.object({
      step: z.enum(workItemSteps),
      count: z.number(),
    }),
  ),
  work_items_without_progress: z.number(),
});

const dailyActivitySchema = z.object({
  day: z.string(),
  progress_entries: z.number(),
  active_members: z.number(),
});

const memberActivitySchema = z.object({
  id: z.number(),
  display_name: z.string(),
  avatar: z.nullable(z.string()),
  is_current_member: z.boolean(),
  active_days: z.number(),
  progress_entries: z.number(),
  work_items: z.number(),
  last_progress_day: z.nullable(z.string()),
});

const activityAnalyticsSchema = z.object({
  period: periodSchema,
  snapshot: snapshotSchema,
  activity_by_day: z.array(dailyActivitySchema),
  members: z.array(memberActivitySchema),
});

export type ActivityPeriod = z.infer<typeof periodSchema>;
export type ActivityAnalytics = z.infer<typeof activityAnalyticsSchema>;
export type DailyActivity = z.infer<typeof dailyActivitySchema>;
export type MemberActivity = z.infer<typeof memberActivitySchema>;

export function activityAnalyticsQueryKey(
  teamSeasonId: number,
  period: ActivityPeriod,
) {
  return [
    "team-seasons",
    teamSeasonId,
    "analytics",
    "activity",
    period.since,
    period.until,
  ] as const;
}

function activityAnalyticsUrl(
  teamSeasonId: number,
  period: ActivityPeriod,
  format?: "csv",
): string {
  const query = new URLSearchParams(period);
  if (format) {
    query.set("format", format);
  }
  return `/api/team-seasons/${teamSeasonId}/analytics/activity/?${query}`;
}

/** A same-origin download: the browser sends the session cookie and the
 * server provides the filename. No copy of the CSV is held in React. */
export function activityAnalyticsCsvUrl(
  teamSeasonId: number,
  period: ActivityPeriod,
): string {
  return activityAnalyticsUrl(teamSeasonId, period, "csv");
}

export async function getActivityAnalytics(
  teamSeasonId: number,
  period: ActivityPeriod,
): Promise<ActivityAnalytics> {
  const { body } = await get(activityAnalyticsUrl(teamSeasonId, period));
  const result = activityAnalyticsSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The activity analytics response is invalid");
  }
  return result.data;
}
