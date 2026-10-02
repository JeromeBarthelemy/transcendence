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

function workItem(id: number, title: string, onRobot: boolean, status: string) {
  return {
    id,
    team_season: 7,
    title,
    on_robot: onRobot,
    status,
    opened_at: new Date().toISOString(),
    current_step: null,
    handover: null,
    last_progress: null,
  };
}

/** The team's list, and every request the home and the work item screen make;
 * the POST answers what `opened` returns. */
function serve(
  items: object[],
  opened: () => Response = () =>
    json(workItem(42, "Nouveau", true, "open"), 201),
) {
  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json({
          display_name: "Marie",
          club_role: "student",
          is_club_admin: false,
          avatar: null,
          team_seasons: [
            {
              id: 7,
              team: { id: 7, number: 1796, name: "Les Rouages" },
              season: { start_year: 2026, game_name: "BioBuzz" },
            },
          ],
        });
      }
      if (path === "/api/team-seasons/7/work-items/") {
        return options?.method === "POST" ? opened() : json(items);
      }
      if (path.startsWith("/api/team-seasons/7/days/")) {
        return json({
          day: "2026-10-01",
          entries: [],
          present: [],
          roster: 12,
          advanced_work_items: 0,
        });
      }
      if (path.startsWith("/api/work-items/")) {
        return json({ detail: { code: "not_found", message: "" } }, 404);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function openPanel() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Ouvrir un chantier" }),
  );
  return screen.getByRole("region", { name: "Ouvrir un chantier" });
}

function posted(fetchMock: ReturnType<typeof serve>) {
  const call = fetchMock.mock.calls.find(
    ([path, options]) =>
      path === "/api/team-seasons/7/work-items/" && options?.method === "POST",
  );
  return call && JSON.parse(String(call[1]?.body));
}

function listFetches(fetchMock: ReturnType<typeof serve>) {
  return fetchMock.mock.calls.filter(
    ([path, options]) =>
      path === "/api/team-seasons/7/work-items/" && !options?.method,
  ).length;
}

beforeEach(() => {
  setDocumentCookie("csrftoken=test; path=/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
});

async function fill(panel: HTMLElement, name: string, place: string) {
  await userEvent.type(within(panel).getByLabelText("Nom"), name);
  await userEvent.click(within(panel).getByRole("radio", { name: place }));
  await userEvent.click(within(panel).getByRole("button", { name: "Ouvrir" }));
}

it("opens a robot work item and leads to its screen", async () => {
  const fetchMock = serve([], () =>
    json(workItem(42, "Shooter", true, "open"), 201),
  );
  const router = renderHome();

  await fill(await openPanel(), "Shooter", "Sur le robot");

  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/work-items/42"),
  );
  expect(posted(fetchMock)).toEqual({ title: "Shooter", on_robot: true });
  expect(listFetches(fetchMock)).toBeGreaterThanOrEqual(2);
});

it("opens an off-robot work item", async () => {
  const fetchMock = serve([], () =>
    json(workItem(43, "Tournoi à domicile", false, "open"), 201),
  );
  const router = renderHome();

  await fill(await openPanel(), "Tournoi à domicile", "Hors robot");

  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/work-items/43"),
  );
  expect(posted(fetchMock)).toEqual({
    title: "Tournoi à domicile",
    on_robot: false,
  });
});

it("waits for both a name and where the work item belongs", async () => {
  serve([]);
  renderHome();
  const panel = await openPanel();
  const submit = () =>
    within(panel).getByRole<HTMLButtonElement>("button", { name: "Ouvrir" });

  expect(submit().disabled).toBe(true);
  await userEvent.type(within(panel).getByLabelText("Nom"), "Shooter");
  expect(submit().disabled).toBe(true);
  await userEvent.click(
    within(panel).getByRole("radio", { name: "Sur le robot" }),
  );
  expect(submit().disabled).toBe(false);
});

it("shows the API's message for a name the team already uses", async () => {
  serve([], () =>
    json(
      { title: [{ code: "work_item_title_taken", message: "Déjà pris." }] },
      400,
    ),
  );
  const router = renderHome();
  const panel = await openPanel();

  await fill(panel, "Dossier de sponsoring", "Hors robot");

  expect((await within(panel).findByRole("alert")).textContent).toBe(
    "Ce chantier existe déjà dans l'équipe.",
  );
  expect(router.state.location.pathname).toBe("/");
});
