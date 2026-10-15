import { z } from "zod/mini";

import { get } from "./client";

const teamSchema = z.object({
  id: z.number(),
  number: z.number(),
  name: z.string(),
});

const memberProfileSchema = z.object({
  id: z.number(),
  display_name: z.string(),
  avatar: z.nullable(z.string()),
  // null unless the viewer may see it (#267): a mentor, or someone sharing
  // this member's current-season team.
  online: z.nullable(z.boolean()),
  club_role: z.enum(["student", "mentor"]),
  // null for a mentor, who is not on one team, or a student with no
  // membership in the current season.
  team: z.nullable(teamSchema),
});

const rosterMemberSchema = z.object({
  id: z.number(),
  display_name: z.string(),
  avatar: z.nullable(z.string()),
  // null for a past season's roster: #267's own rule is the viewer's
  // *current* team, and a roster may be reopened for an earlier one.
  online: z.nullable(z.boolean()),
});

export type MemberProfile = z.infer<typeof memberProfileSchema>;
export type RosterMember = z.infer<typeof rosterMemberSchema>;

export async function getMemberProfile(userId: number): Promise<MemberProfile> {
  const { body } = await get(`/api/users/${userId}/profile/`);
  const result = memberProfileSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The member profile response is invalid");
  }
  return result.data;
}

export async function getTeamSeasonRoster(
  teamSeasonId: number,
): Promise<RosterMember[]> {
  const { body } = await get(`/api/team-seasons/${teamSeasonId}/roster/`);
  const result = z.array(rosterMemberSchema).safeParse(body);
  if (!result.success) {
    throw new Error("The roster response is invalid");
  }
  return result.data;
}
