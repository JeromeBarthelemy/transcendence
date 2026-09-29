import { z } from "zod/mini";
import { del, get, patch } from "./client";

const clubUserSchema = z.object({
  id: z.number(),
  display_name: z.string(),
  email: z.string(),
  club_role: z.enum(["student", "mentor"]),
  is_club_admin: z.boolean(),
  is_active: z.boolean(),
  is_anonymized: z.boolean(),
  avatar: z.nullable(z.string()),
});

export type ClubUser = z.infer<typeof clubUserSchema>;

/** What an admin may change on another account; everything else stays in
 * the Django admin. */
export type UserChanges = Partial<
  Pick<ClubUser, "club_role" | "is_club_admin" | "is_active">
>;

function parseUser(body: unknown): ClubUser {
  const result = clubUserSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The user response is invalid");
  }
  return result.data;
}

export async function listUsers(): Promise<ClubUser[]> {
  const { body } = await get("/api/users/");
  const result = z.array(clubUserSchema).safeParse(body);
  if (!result.success) {
    throw new Error("The user list response is invalid");
  }
  return result.data;
}

export async function getUser(userId: number): Promise<ClubUser> {
  const { body } = await get(`/api/users/${userId}/`);
  return parseUser(body);
}

export async function updateUser(
  userId: number,
  changes: UserChanges,
): Promise<ClubUser> {
  const { body } = await patch(`/api/users/${userId}/`, changes);
  return parseUser(body);
}

/** Anonymizes the account: it is never a row deletion (README, "Members
 * and roles"). */
export async function deleteUser(userId: number): Promise<void> {
  await del(`/api/users/${userId}/`);
}
