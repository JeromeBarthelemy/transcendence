import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { routes } from "./router";
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

const tom = {
  display_name: "Tom",
  club_role: "student",
  is_club_admin: false,
  avatar: null,
  team_seasons: [],
};

function notice(id: number, overrides: object = {}) {
  return {
    id,
    verb: "entry_added",
    actor: { display_name: "Lina", avatar: null },
    team_season: 1,
    work_item: { id: 10, title: "intake" },
    entry: { id: 100 + id, type: "note" },
    created_at: "2026-10-06T13:26:00Z",
    read: false,
    ...overrides,
  };
}

/** A server holding Tom's notifications, which lists the latest 20 and marks
 * them read as asked: those in `ids`, or all of them. */
function serve(items: ReturnType<typeof notice>[]) {
  const state = items.map((item) => ({ ...item }));
  const unread = () => state.filter((item) => !item.read).length;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/me/") {
      return json(tom);
    }
    if (url === "/api/notifications/") {
      return json({ unread: unread(), items: state.slice(0, 20) });
    }
    if (url === "/api/notifications/read/" && init?.method === "POST") {
      const { ids } = JSON.parse(String(init.body)) as { ids?: number[] };
      for (const item of state) {
        if (ids === undefined || ids.includes(item.id)) item.read = true;
      }
      return json({ unread: unread() });
    }
    if (url === "/api/auth/logout/" && init?.method === "POST") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: ["/privacy"] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  setDocumentCookie("csrftoken=test-token; path=/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
});

it("shows no badge when nothing is unread", async () => {
  serve([notice(1, { read: true })]);
  renderApp();

  const bell = await screen.findByRole("button", {
    name: "Notifications, aucune non lue",
  });

  expect(within(bell).queryByText(/\d/)).toBeNull();
});

it("counts what is unread on the bell, up to nine", async () => {
  serve(Array.from({ length: 12 }, (_, i) => notice(i + 1)));
  renderApp();

  const bell = await screen.findByRole("button", {
    name: "Notifications, 12 non lues",
  });

  expect(within(bell).getByText("9+")).toBeTruthy();
});

it("says what happened, by whom and where, and links to the work item", async () => {
  const user = userEvent.setup();
  serve([
    notice(3, { verb: "work_item_dropped", entry: null }),
    notice(2, { verb: "entry_removed", entry: { id: null, type: "decision" } }),
    notice(1, { work_item: null }),
  ]);
  renderApp();

  await user.click(
    await screen.findByRole("button", { name: "Notifications, 3 non lues" }),
  );
  const panel = screen.getByRole("region", { name: "Notifications" });
  const [dropped, removed, teamNote] = within(panel).getAllByRole("listitem");

  expect(dropped.textContent).toContain("Lina a abandonné un chantier");
  expect(within(dropped).getByRole("link").getAttribute("href")).toBe(
    "/work-items/10",
  );
  expect(removed.textContent).toContain("Lina a retiré une décision");
  // A note to the whole team has no page of its own to open.
  expect(teamNote.textContent).toContain("Lina a ajouté une remarque");
  expect(teamNote.textContent).toContain("Toute l'équipe");
  expect(within(teamNote).queryByRole("link")).toBeNull();
});

it("never links to a work item that was deleted", async () => {
  const user = userEvent.setup();
  serve([
    notice(1, {
      verb: "work_item_deleted",
      entry: null,
      work_item: { id: null, title: "pince" },
    }),
  ]);
  renderApp();

  await user.click(
    await screen.findByRole("button", { name: "Notifications, 1 non lue" }),
  );
  const [deleted] = within(
    screen.getByRole("region", { name: "Notifications" }),
  ).getAllByRole("listitem");

  expect(deleted.textContent).toContain("Lina a supprimé un chantier");
  expect(deleted.textContent).toContain("pince");
  expect(within(deleted).queryByRole("link")).toBeNull();
});

it("marks all as read on opening, and keeps what it shows marked new meanwhile", async () => {
  const user = userEvent.setup();
  const fetchMock = serve([notice(2), notice(1)]);
  renderApp();

  await user.click(
    await screen.findByRole("button", { name: "Notifications, 2 non lues" }),
  );

  await screen.findByRole("button", { name: "Notifications, aucune non lue" });
  const read = fetchMock.mock.calls.find(
    ([url]) => url === "/api/notifications/read/",
  );
  expect(JSON.parse(String(read?.[1]?.body))).toEqual({});
  const panel = screen.getByRole("region", { name: "Notifications" });
  expect(within(panel).getAllByText("Nouveau")).toHaveLength(2);
});

it("clears the badge on opening, even with more unread than it shows", async () => {
  const user = userEvent.setup();
  serve(Array.from({ length: 25 }, (_, i) => notice(25 - i)));
  renderApp();

  await user.click(
    await screen.findByRole("button", { name: "Notifications, 25 non lues" }),
  );

  await screen.findByRole("button", { name: "Notifications, aucune non lue" });
});

it("forgets the member's notifications once they log out", async () => {
  const user = userEvent.setup();
  serve([notice(1)]);
  const queryClient = renderApp();

  await screen.findByRole("button", { name: "Notifications, 1 non lue" });
  await user.click(
    screen.getByRole("button", { name: "Menu du compte (Tom)" }),
  );
  await user.click(screen.getByRole("button", { name: "Se déconnecter" }));

  // On the club's shared laptop, the next member signs in on this same tab.
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /^Notifications/ })).toBeNull(),
  );
  expect(queryClient.getQueryData(["notifications"])).toBeUndefined();
});

it.each([
  ["the server fails", () => json({ detail: "boom" }, 500)],
  [
    "the answer is not understood",
    () => json({ unread: 1, items: [notice(1, { verb: "work_item_moved" })] }),
  ],
])("says the notifications could not be read when %s", async (_, answer) => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/auth/me/") {
      return json(tom);
    }
    if (url === "/api/notifications/") {
      return answer();
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderApp();

  await user.click(
    await screen.findByRole("button", {
      name: "Notifications, aucune non lue",
    }),
  );

  const panel = screen.getByRole("region", { name: "Notifications" });
  expect((await within(panel).findByRole("alert")).textContent).toBe(
    "Une erreur inattendue est survenue.",
  );
  expect(panel.textContent).not.toContain("Rien de nouveau.");
});

it("says so when there is nothing yet", async () => {
  const user = userEvent.setup();
  serve([]);
  renderApp();

  await user.click(
    await screen.findByRole("button", {
      name: "Notifications, aucune non lue",
    }),
  );

  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Notifications" }).textContent,
    ).toContain("Rien de nouveau."),
  );
});
