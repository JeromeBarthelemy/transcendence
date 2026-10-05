import { del, get, post, upload } from "./client";

export interface TeamSeasonSummary {
  id: number;
  team: {
    id: number;
    number: number;
    name: string;
  };
  season: {
    start_year: number;
    game_name: string;
  };
}

export interface Identity {
  display_name: string;
  club_role: "student" | "mentor";
  is_club_admin: boolean;
  avatar: string | null;
  team_seasons: TeamSeasonSummary[];
}

export interface SignUpInput {
  first_name: string;
  last_name: string;
  birth_date: string;
  display_name: string;
  email: string;
  password: string;
}

export interface SignUpResult {
  email: string;
  display_name: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTeamSeason(value: unknown): value is TeamSeasonSummary {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    isRecord(value.team) &&
    typeof value.team.id === "number" &&
    typeof value.team.number === "number" &&
    typeof value.team.name === "string" &&
    isRecord(value.season) &&
    typeof value.season.start_year === "number" &&
    typeof value.season.game_name === "string"
  );
}

function isIdentity(value: unknown): value is Identity {
  return (
    isRecord(value) &&
    typeof value.display_name === "string" &&
    (value.club_role === "student" || value.club_role === "mentor") &&
    typeof value.is_club_admin === "boolean" &&
    (value.avatar === null || typeof value.avatar === "string") &&
    Array.isArray(value.team_seasons) &&
    value.team_seasons.every(isTeamSeason)
  );
}

function isSignUpResult(value: unknown): value is SignUpResult {
  return (
    isRecord(value) &&
    typeof value.email === "string" &&
    typeof value.display_name === "string"
  );
}

/** `null` when nobody is signed in: an answer, not an error (README,
 * "Sessions"). */
export async function getCurrentUser(): Promise<Identity | null> {
  const { body } = await get("/api/auth/me/");
  if (body === null) {
    return null;
  }
  if (!isIdentity(body)) {
    throw new Error("The identity response is invalid");
  }
  return body;
}

export async function signUp(input: SignUpInput): Promise<SignUpResult> {
  const { body } = await post("/api/auth/signup/", input);
  if (!isSignUpResult(body)) {
    throw new Error("The sign-up response is invalid");
  }
  return body;
}

export async function logIn(input: LoginInput): Promise<Identity> {
  const { body } = await post("/api/auth/login/", input);
  if (!isIdentity(body)) {
    throw new Error("The login response is invalid");
  }
  return body;
}

export async function logOut(): Promise<void> {
  await post("/api/auth/logout/");
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
  if (!isIdentity(body)) {
    throw new Error("The avatar response is invalid");
  }
  return body;
}

export async function deleteAvatar(): Promise<void> {
  await del("/api/auth/me/avatar/");
}

/** The right of access: a copy of the account, sent by e-mail to its contact
 * address — never shown on screen, since the confirmation is the point. */
export async function requestDataExport(): Promise<void> {
  await post("/api/auth/me/export/");
}

/** The right to erasure. The account's own password confirms it; the server
 * then anonymizes the account, e-mails the confirmation and ends the
 * session. */
export async function deleteAccount(password: string): Promise<void> {
  await del("/api/auth/me/", { password });
}
