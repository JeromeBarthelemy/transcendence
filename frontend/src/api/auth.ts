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

export interface ApiIssue {
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly issues: Record<string, ApiIssue[]>,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiRequestError";
  }

  forField(field: string): ApiIssue[] {
    return this.issues[field] ?? [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIssue(value: unknown): value is ApiIssue {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
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

async function toApiError(response: Response): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null);
  const issues: Record<string, ApiIssue[]> = {};

  if (isRecord(body)) {
    for (const [field, value] of Object.entries(body)) {
      const entries = Array.isArray(value) ? value : [value];
      const valid = entries.filter(isIssue);
      if (valid.length > 0) {
        issues[field] = valid;
      }
    }
  }

  return new ApiRequestError(response.status, issues);
}

function csrfCookie(): string | null {
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("csrftoken="));
  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : null;
}

async function csrfToken(): Promise<string> {
  // /me/ sets the cookie even for an anonymous caller (whose response is 403).
  // This also covers a direct visit to /login or /signup before the app's
  // initial session query has finished.
  if (!csrfCookie()) {
    await getCurrentUser();
  }
  const token = csrfCookie();
  if (!token) {
    throw new Error("The CSRF cookie is missing");
  }
  return token;
}

async function post(path: string, body: object = {}): Promise<Response> {
  // Django rotates the CSRF token on login, so read the cookie for each POST.
  const token = await csrfToken();
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRFToken": token,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response;
}

export async function getCurrentUser(): Promise<Identity | null> {
  const response = await fetch("/api/auth/me/", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  const body: unknown = await response.json();
  if (!isIdentity(body)) {
    throw new Error("The identity response is invalid");
  }
  return body;
}

export async function signUp(input: SignUpInput): Promise<SignUpResult> {
  const response = await post("/api/auth/signup/", input);
  const body: unknown = await response.json();
  if (!isSignUpResult(body)) {
    throw new Error("The sign-up response is invalid");
  }
  return body;
}

export async function logIn(input: LoginInput): Promise<Identity> {
  const response = await post("/api/auth/login/", input);
  const body: unknown = await response.json();
  if (!isIdentity(body)) {
    throw new Error("The login response is invalid");
  }
  return body;
}

export async function logOut(): Promise<void> {
  await post("/api/auth/logout/");
}
