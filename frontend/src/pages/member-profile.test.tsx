import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import "../i18n";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setDocumentCookie(value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = value;
}

function identity() {
  return {
    id: 1,
    display_name: "Tom",
    club_role: "student",
    is_club_admin: false,
    avatar: null,
    team_seasons: [],
  };
}

function profile(extra: Record<string, unknown> = {}) {
  return {
    id: 2,
    display_name: "Élodie",
    avatar: null,
    online: null,
    club_role: "student",
    team: { id: 1, number: 111, name: "Les Rouages" },
    ...extra,
  };
}

type Handler = (
  path: string,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;

function stubApi(handler: Handler) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/auth/me/") return json(identity());
    const response = await handler(path, init);
    if (!response) {
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  setDocumentCookie("csrftoken=test-token; path=/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
});

it("shows a student's name, photo and current team", async () => {
  stubApi((path) =>
    path === "/api/users/2/profile/" ? json(profile()) : undefined,
  );

  renderAt("/members/2");

  expect(await screen.findByRole("heading", { name: "Élodie" })).toBeTruthy();
  expect(await screen.findByText("Équipe : 111 · Les Rouages")).toBeTruthy();
});

it("shows a green dot when a teammate is online", async () => {
  stubApi((path) =>
    path === "/api/users/2/profile/"
      ? json(profile({ online: true }))
      : undefined,
  );

  renderAt("/members/2");

  await screen.findByRole("heading", { name: /Élodie/ });
  expect(screen.getByRole("img", { name: "En ligne" })).toBeTruthy();
});

it.each([false, null])(
  "shows no dot when online status is %s",
  async (online) => {
    stubApi((path) =>
      path === "/api/users/2/profile/" ? json(profile({ online })) : undefined,
    );

    renderAt("/members/2");

    await screen.findByRole("heading", { name: /Élodie/ });
    expect(screen.queryByRole("img", { name: "En ligne" })).toBeNull();
  },
);

it("shows all teams for a mentor instead of a single one", async () => {
  stubApi((path) =>
    path === "/api/users/2/profile/"
      ? json(profile({ club_role: "mentor", team: null }))
      : undefined,
  );

  renderAt("/members/2");

  expect(await screen.findByText("Toutes les équipes")).toBeTruthy();
});

it("says a student has no team yet this season", async () => {
  stubApi((path) =>
    path === "/api/users/2/profile/"
      ? json(profile({ team: null }))
      : undefined,
  );

  renderAt("/members/2");

  expect(
    await screen.findByText("Pas encore d'équipe cette saison"),
  ).toBeTruthy();
});

it("reports a profile that cannot be found", async () => {
  stubApi((path) =>
    path === "/api/users/999/profile/"
      ? json({ detail: { code: "not_found", message: "…" } }, 404)
      : undefined,
  );

  renderAt("/members/999");

  expect(
    await screen.findByText("Cet élément n'existe plus. Rechargez la page."),
  ).toBeTruthy();
});
