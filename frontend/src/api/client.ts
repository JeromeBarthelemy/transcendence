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

export interface ApiResponse {
  status: number;
  body: unknown;
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

export function toApiError(status: number, body: unknown): ApiRequestError {
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

  return new ApiRequestError(status, issues);
}

export function csrfCookie(): string | null {
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("csrftoken="));
  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : null;
}

async function responseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }
  return response.json().catch(() => null);
}

async function request(
  path: string,
  options: RequestInit,
  acceptedStatuses: readonly number[] = [],
): Promise<ApiResponse> {
  const response = await fetch(path, options);
  const body = await responseBody(response);
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw toApiError(response.status, body);
  }
  return { status: response.status, body };
}

export async function get(
  path: string,
  acceptedStatuses: readonly number[] = [],
): Promise<ApiResponse> {
  return request(
    path,
    {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
    acceptedStatuses,
  );
}

export async function csrfToken(): Promise<string> {
  // /me/ sets the cookie even for an anonymous caller (whose response is 403).
  if (!csrfCookie()) {
    await get("/api/auth/me/", [403]);
  }
  const token = csrfCookie();
  if (!token) {
    throw new Error("The CSRF cookie is missing");
  }
  return token;
}

async function send(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: object,
): Promise<ApiResponse> {
  // Django rotates the CSRF token on login, so read the cookie for each write.
  const token = await csrfToken();
  return request(path, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRFToken": token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function post(
  path: string,
  body: object = {},
): Promise<ApiResponse> {
  return send("POST", path, body);
}

export async function patch(path: string, body: object): Promise<ApiResponse> {
  return send("PATCH", path, body);
}

export async function del(path: string): Promise<ApiResponse> {
  return send("DELETE", path);
}
