import { z } from "zod/mini";
import { del, get, patch, post } from "./client";

const teamMemberSchema = z.object({
  membership: z.number(),
  user: z.number(),
  display_name: z.string(),
  avatar: z.nullable(z.string()),
});

const managedTeamSchema = z.object({
  id: z.number(),
  number: z.number(),
  name: z.string(),
  team_season: z.number(),
  members: z.array(teamMemberSchema),
});

const teamListSchema = z.object({
  season: z.nullable(
    z.object({
      start_year: z.number(),
      game_name: z.string(),
    }),
  ),
  teams: z.array(managedTeamSchema),
});

const userSearchResultSchema = z.object({
  id: z.number(),
  display_name: z.string(),
  avatar: z.nullable(z.string()),
  club_role: z.enum(["student", "mentor"]),
});

export type TeamMember = z.infer<typeof teamMemberSchema>;
export type ManagedTeam = z.infer<typeof managedTeamSchema>;
export type TeamList = z.infer<typeof teamListSchema>;
export type UserSearchResult = z.infer<typeof userSearchResultSchema>;

export interface CreateTeamInput {
  number: number;
  name: string;
  season: number;
}

export async function getTeams(): Promise<TeamList> {
  const { body } = await get("/api/teams/");
  const result = teamListSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The team list response is invalid");
  }
  return result.data;
}

export async function createTeam(input: CreateTeamInput): Promise<void> {
  await post("/api/teams/", input);
}

export async function renameTeam(teamId: number, name: string): Promise<void> {
  await patch(`/api/teams/${teamId}/`, { name });
}

export async function deleteTeam(teamId: number): Promise<void> {
  await del(`/api/teams/${teamId}/`);
}

/** Active accounts matching `search`, less those already on `teamSeasonId`. */
export async function searchUsers(
  search: string,
  teamSeasonId: number,
): Promise<UserSearchResult[]> {
  const query = new URLSearchParams({
    search,
    team_season: String(teamSeasonId),
  });
  const { body } = await get(`/api/users/?${query}`);
  const result = z.array(userSearchResultSchema).safeParse(body);
  if (!result.success) {
    throw new Error("The user search response is invalid");
  }
  return result.data;
}

export async function addMember(
  userId: number,
  teamSeasonId: number,
): Promise<void> {
  await post("/api/memberships/", { user: userId, team_season: teamSeasonId });
}

export async function removeMember(membershipId: number): Promise<void> {
  await del(`/api/memberships/${membershipId}/`);
}
