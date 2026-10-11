import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function identity(isClubAdmin: boolean) {
  return {
    display_name: "Paul",
    club_role: "mentor",
    is_club_admin: isClubAdmin,
    avatar: null,
    team_seasons: [],
  };
}

function manualRow(overrides: Record<string, unknown> = {}) {
  return {
    source: "game_manual",
    title: "Manuel BioBuzz TU03",
    url: "https://ftc-resources.firstinspires.org/ftc/game/cm-html/manual.htm",
    fetched_at: "2026-10-01T10:00:00Z",
    checked_at: "2026-10-09T08:00:00Z",
    pending: null,
    check: null,
    ...overrides,
  };
}

function qaRow(overrides: Record<string, unknown> = {}) {
  return {
    source: "official_qa",
    title: null,
    url: "",
    fetched_at: null,
    checked_at: null,
    pending: null,
    check: null,
    ...overrides,
  };
}

type Handler = (
  path: string,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;

function stubApi(handler: Handler) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const response = await handler(path, init);
    if (!response) {
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSources() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, {
    initialEntries: ["/rules/sources"],
  });
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

it("keeps the screen from a member who is not a club admin", async () => {
  const fetchMock = stubApi((path) =>
    path === "/api/auth/me/" ? json(identity(false)) : undefined,
  );

  renderSources();

  expect(
    await screen.findByRole("heading", { name: "Accès réservé" }),
  ).toBeTruthy();
  expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain(
    "/api/rules/sources/",
  );
});

it("shows each source and when it was last checked", async () => {
  stubApi((path) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") return json([manualRow(), qaRow()]);
    return undefined;
  });

  renderSources();

  expect(
    await screen.findByRole("heading", { name: "Manuel de jeu" }),
  ).toBeTruthy();
  expect(screen.getByText("Manuel BioBuzz TU03")).toBeTruthy();
  expect(screen.getByText(/Vérifié le/)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Q&A officiel" })).toBeTruthy();
  expect(
    screen.getByText("Rien n'a encore été ingéré pour cette source."),
  ).toBeTruthy();
  expect(screen.getByText("Jamais vérifié")).toBeTruthy();
});

it("reviews a pending update and accepts it", async () => {
  const user = userEvent.setup();
  const pending = {
    detected_at: "2026-10-10T09:00:00Z",
    summary: {
      added: 2,
      removed: 1,
      changed: 3,
      references: ["G420", "10.6.4"],
      references_total: 5,
    },
  };
  let accepted = false;
  stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/")
      return json([manualRow({ pending: accepted ? null : pending }), qaRow()]);
    if (
      path === "/api/rules/sources/game_manual/accept/" &&
      init?.method === "POST"
    ) {
      accepted = true;
      return json([manualRow({ pending: null }), qaRow()]);
    }
    return undefined;
  });

  renderSources();

  await screen.findByText(/Une nouvelle version a été trouvée/);
  expect(screen.getByText(/2 passage\(s\) ajouté\(s\)/)).toBeTruthy();
  expect(screen.getByText(/G420, 10\.6\.4/)).toBeTruthy();
  expect(screen.getByText(/et 3 de plus/)).toBeTruthy();

  await user.click(
    screen.getByRole("button", { name: "Accepter la mise à jour" }),
  );

  expect(screen.queryByText(/Une nouvelle version a été trouvée/)).toBeNull();
});

it("dismisses a pending update until the next check", async () => {
  const user = userEvent.setup();
  const pending = {
    detected_at: "2026-10-10T09:00:00Z",
    summary: {
      added: 1,
      removed: 0,
      changed: 0,
      references: [],
      references_total: 0,
    },
  };
  stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/")
      return json([manualRow({ pending }), qaRow()]);
    if (path === "/api/rules/sources/check/" && init?.method === "POST")
      return json([manualRow({ pending }), qaRow()]);
    return undefined;
  });

  renderSources();

  await screen.findByText(/Une nouvelle version a été trouvée/);
  await user.click(
    screen.getByRole("button", { name: "Ignorer pour l'instant" }),
  );
  expect(screen.queryByText(/Une nouvelle version a été trouvée/)).toBeNull();

  // Nothing but a real, fresh check brings it back.
  await user.click(screen.getByRole("button", { name: "Vérifier maintenant" }));
  expect(
    await screen.findByText(/Une nouvelle version a été trouvée/),
  ).toBeTruthy();
});

it("reports a failed check without touching what is searched", async () => {
  const user = userEvent.setup();
  stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") return json([manualRow(), qaRow()]);
    if (path === "/api/rules/sources/check/" && init?.method === "POST")
      return json([
        manualRow({ check: { status: "error", detail: "hors ligne" } }),
        qaRow(),
      ]);
    return undefined;
  });

  renderSources();
  await screen.findByRole("heading", { name: "Manuel de jeu" });
  await user.click(screen.getByRole("button", { name: "Vérifier maintenant" }));

  expect(
    await screen.findByText("Échec de la vérification : hors ligne"),
  ).toBeTruthy();
});

it("opens from its own route", async () => {
  stubApi((path) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") return json([manualRow(), qaRow()]);
    return undefined;
  });

  const router = renderSources();

  await screen.findByRole("heading", { name: "Manuel de jeu" });
  expect(router.state.location.pathname).toBe("/rules/sources");
});
