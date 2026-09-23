import { get, post } from "./client";

export interface Identity {
  display_name: string;
  club_role: "student" | "mentor";
  is_club_admin: boolean;
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

function isIdentity(value: unknown): value is Identity {
  return (
    isRecord(value) &&
    typeof value.display_name === "string" &&
    (value.club_role === "student" || value.club_role === "mentor") &&
    typeof value.is_club_admin === "boolean"
  );
}

function isSignUpResult(value: unknown): value is SignUpResult {
  return (
    isRecord(value) &&
    typeof value.email === "string" &&
    typeof value.display_name === "string"
  );
}

export async function getCurrentUser(): Promise<Identity | null> {
  const response = await get("/api/auth/me/", [403]);
  if (response.status === 403) {
    return null;
  }
  if (!isIdentity(response.body)) {
    throw new Error("The identity response is invalid");
  }
  return response.body;
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
