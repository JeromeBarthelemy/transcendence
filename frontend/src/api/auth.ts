import { z } from "zod/mini";

import { del, get, patch, post, upload } from "./client";

const teamSeasonSchema = z.object({
  id: z.number(),
  team: z.object({
    id: z.number(),
    number: z.number(),
    name: z.string(),
  }),
  season: z.object({
    start_year: z.number(),
    game_name: z.string(),
  }),
});

const identitySchema = z.object({
  display_name: z.string(),
  club_role: z.enum(["student", "mentor"]),
  is_club_admin: z.boolean(),
  avatar: z.nullable(z.string()),
  team_seasons: z.array(teamSeasonSchema),
});

const signUpResultSchema = z.object({
  email: z.string(),
  display_name: z.string(),
});

const sentToSchema = z.object({ sent_to: z.string() });

export type TeamSeasonSummary = z.infer<typeof teamSeasonSchema>;
export type Identity = z.infer<typeof identitySchema>;
export type SignUpResult = z.infer<typeof signUpResultSchema>;

function parseIdentity(body: unknown, response: string): Identity {
  const result = identitySchema.safeParse(body);
  if (!result.success) {
    throw new Error(`The ${response} response is invalid`);
  }
  return result.data;
}

function parseSentTo(body: unknown, response: string): string {
  const result = sentToSchema.safeParse(body);
  if (!result.success) {
    throw new Error(`The ${response} response is invalid`);
  }
  return result.data.sent_to;
}

export interface SignUpInput {
  first_name: string;
  last_name: string;
  birth_date: string;
  display_name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

/** `null` when nobody is signed in: an answer, not an error (README,
 * "Sessions"). */
export async function getCurrentUser(): Promise<Identity | null> {
  const { body } = await get("/api/auth/me/");
  if (body === null) {
    return null;
  }
  return parseIdentity(body, "identity");
}

export async function signUp(input: SignUpInput): Promise<SignUpResult> {
  const { body } = await post("/api/auth/signup/", input);
  const result = signUpResultSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The sign-up response is invalid");
  }
  return result.data;
}

export async function logIn(input: LoginInput): Promise<Identity> {
  const { body } = await post("/api/auth/login/", input);
  return parseIdentity(body, "login");
}

export async function logOut(): Promise<void> {
  await post("/api/auth/logout/");
}

/** One's own display name and login address (#178) — minors included.
 * `current_password` only matters when `email` changes; omit it for a
 * display-name-only edit. */
export interface UpdateProfileInput {
  display_name?: string;
  email?: string;
  current_password?: string;
}

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<Identity> {
  const { body } = await patch("/api/auth/me/", input);
  return parseIdentity(body, "profile update");
}

/** Mirrors the server's own checks (AvatarSerializer), so a file it would
 * refuse is turned down before a byte is sent. The server still checks what
 * the file really holds; the browser only reads its announced type. */
export const AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  // HEIF is how iPhones take their photos.
  "image/heic",
  "image/heif",
];
// The extensions as well: where the system knows no type for .heic, a picker
// filtering on types alone would hide the file.
export const AVATAR_ACCEPT = [...AVATAR_TYPES, ".heic", ".heif"].join(",");
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

export type AvatarRefusal = "avatarType" | "avatarSize";

export function checkAvatar(file: File): AvatarRefusal | null {
  // An empty type is what many browsers announce for a HEIC photo copied off
  // an iPhone: no reason to refuse, so the server decides from the content.
  if (file.type !== "" && !AVATAR_TYPES.includes(file.type)) {
    return "avatarType";
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return "avatarSize";
  }
  return null;
}

export async function uploadAvatar(
  file: File,
  onProgress: (sent: number) => void,
): Promise<Identity> {
  const form = new FormData();
  form.append("avatar", file);
  const { body } = await upload(
    "PUT",
    "/api/auth/me/avatar/",
    form,
    onProgress,
  );
  return parseIdentity(body, "avatar");
}

export async function deleteAvatar(): Promise<void> {
  await del("/api/auth/me/avatar/");
}

/** The right of access: a copy of the account, sent by e-mail to its contact
 * address — never shown on screen, since the confirmation is the point.
 * Returns that address: a guardian's, for a minor. */
export async function requestDataExport(): Promise<string> {
  const { body } = await post("/api/auth/me/export/");
  return parseSentTo(body, "export");
}

/** The right to erasure. The account's own password confirms it; the server
 * then anonymizes the account, e-mails the confirmation and ends the
 * session. Returns the address the confirmation went to. */
export async function deleteAccount(password: string): Promise<string> {
  const { body } = await del("/api/auth/me/", { password });
  return parseSentTo(body, "deletion");
}
