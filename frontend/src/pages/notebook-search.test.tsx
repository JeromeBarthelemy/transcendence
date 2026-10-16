import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import i18n from "../i18n";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const identity = {
  id: 1,
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
};

const INTAKE = {
  id: 3,
  team_season: 7,
  title: "Intake",
  on_robot: true,
  status: "open",
  opened_at: "2026-09-01T15:00:00Z",
  closed_at: null,
  current_step: "building",
  handover: null,
  last_progress: null,
};

function result(id: number, fields: object = {}) {
  return {
    id,
    work_item: { id: 3, title: "Intake" },
    type: "progress",
    body: `Trace ${id}`,
    step: "building",
    handover: "",
    occurred_at: "2026-11-18T17:00:00Z",
    day: "2026-11-18",
    author: "Lina",
    can_remove: false,
    can_correct: false,
    participants: [{ display_name: "Lina", avatar: null }],
    attachments: [],
    ...fields,
  };
}

function page(
  results: object[],
  { count = results.length, page = 1, page_size = 20 } = {},
) {
  return {
    count,
    page,
    page_size,
    results,
    people: [
      { id: 11, display_name: "Lina", avatar: null },
      { id: 12, display_name: "Tom", avatar: null },
    ],
  };
}

/** Every search the page sends, as the query string's parameters. */
function renderSearch(
  answer: (params: URLSearchParams) => object = () => page([result(1)]),
  path = "/team-seasons/7/search",
) {
  const searches: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/auth/me/") return json(identity);
      if (url === "/api/team-seasons/7/work-items/") return json([INTAKE]);
      if (url.startsWith("/api/team-seasons/7/search/")) {
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        searches.push(params);
        return json(answer(params));
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    searches,
    router,
    last: () => Object.fromEntries(searches.at(-1) ?? []),
  };
}

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("fr");
  localStorage.clear();
});

it("lists the whole notebook, newest first, before any filter", async () => {
  const { last } = renderSearch();

  expect(await screen.findByText("Trace 1")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "1 trace" })).toBeTruthy();
  expect(last()).toEqual({ order: "newest", page: "1", page_size: "20" });
});

it("combines the filters it is given and shows them as chips", async () => {
  const user = userEvent.setup();
  const { last, router } = renderSearch();
  await screen.findByText("Trace 1");

  await user.type(screen.getByLabelText("Texte"), "dérive moteur");
  await user.selectOptions(await screen.findByLabelText("Chantier"), "3");
  await user.selectOptions(screen.getByLabelText("Sous-système"), "true");
  await user.selectOptions(screen.getByLabelText("Étape"), "building");
  await user.selectOptions(screen.getByLabelText("Participant"), "12");
  await user.selectOptions(screen.getByLabelText("Type de trace"), "progress");
  await user.type(screen.getByLabelText("Du"), "2026-11-01");
  await user.type(screen.getByLabelText("Au"), "2026-11-30");
  await user.click(screen.getByRole("button", { name: "Rechercher" }));

  await waitFor(() =>
    expect(last()).toEqual({
      q: "dérive moteur",
      work_item: "3",
      on_robot: "true",
      step: "building",
      participant: "12",
      since: "2026-11-01",
      until: "2026-11-30",
      type: "progress",
      order: "newest",
      page: "1",
      page_size: "20",
    }),
  );
  expect(router.state.location.search).toContain("q=d%C3%A9rive+moteur");
  for (const chip of ["« dérive moteur »", "Intake", "Tom", "Avancée"]) {
    expect(
      screen.getByRole("button", { name: `Retirer le filtre ${chip}` }),
    ).toBeTruthy();
  }
});

it("removes one filter and keeps the others, from the first page", async () => {
  const user = userEvent.setup();
  const { last } = renderSearch(
    () => page([result(1)], { count: 60, page: 3 }),
    "/team-seasons/7/search?q=intake&step=building&page=3",
  );
  await screen.findByText("Trace 1");

  await user.click(
    screen.getByRole("button", { name: "Retirer le filtre Construction" }),
  );

  await waitFor(() => expect(last().step).toBeUndefined());
  expect(last()).toMatchObject({ q: "intake", page: "1" });
  // The form follows: the removed step is no longer selected there.
  expect((screen.getByLabelText("Étape") as HTMLSelectElement).value).toBe("");
});

it("pages through the results and sorts them either way", async () => {
  const user = userEvent.setup();
  const { last } = renderSearch((params) =>
    page([result(Number(params.get("page")) * 100)], {
      count: 45,
      page: Number(params.get("page")),
    }),
  );
  await screen.findByText("Trace 100");
  const pages = screen.getByRole("navigation", { name: "Pages de résultats" });
  expect(within(pages).getByText("Page 1 sur 3")).toBeTruthy();

  await user.click(within(pages).getByRole("link", { name: /Suivante/ }));
  expect(await screen.findByText("Trace 200")).toBeTruthy();
  expect(last().page).toBe("2");

  await user.selectOptions(screen.getByLabelText("Trier par"), "oldest");
  await waitFor(() =>
    expect(last()).toMatchObject({ order: "oldest", page: "1" }),
  );

  await user.selectOptions(screen.getByLabelText("Par page"), "50");
  await waitFor(() => expect(last().page_size).toBe("50"));
});

it("refuses a period that ends before it starts, without searching", async () => {
  const user = userEvent.setup();
  const { searches } = renderSearch();
  await screen.findByText("Trace 1");

  await user.type(screen.getByLabelText("Du"), "2026-11-30");
  await user.type(screen.getByLabelText("Au"), "2026-11-01");

  expect(
    screen.getByText("La date de début doit précéder la date de fin."),
  ).toBeTruthy();
  const submit = screen.getByRole("button", { name: "Rechercher" });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  expect(searches).toHaveLength(1);
});

it("says so when nothing matches", async () => {
  renderSearch(() => page([]), "/team-seasons/7/search?q=introuvable");

  expect(
    await screen.findByText("Aucune trace ne correspond à ces filtres."),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Aucune trace" })).toBeTruthy();
});

it("is opened from the team home", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/auth/me/") return json(identity);
      if (url.endsWith("/work-items/")) return json([]);
      if (url.includes("/days/")) {
        return json({
          day: "2026-11-18",
          entries: [],
          present: [],
          roster: 3,
          advanced_work_items: 0,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  const link = await screen.findByRole("link", {
    name: "Rechercher dans les chantiers",
  });
  expect(link.getAttribute("href")).toBe("/team-seasons/7/search");
  expect(link.querySelector('[data-icon="search"]')).toBeTruthy();
});

it("follows the selected language, filters and results kept", async () => {
  const { searches } = renderSearch(
    () => page([result(1)], { count: 1234, page_size: 20 }),
    "/team-seasons/7/search?q=moteur&since=2026-11-01",
  );
  expect(await screen.findByText("1 234 traces")).toBeTruthy();

  await act(() => i18n.changeLanguage("en"));

  expect(
    screen.getByRole("heading", { name: "Search the work items" }),
  ).toBeTruthy();
  expect(screen.getByText("1,234 entries")).toBeTruthy();
  expect(screen.getByText("Page 1 of 62")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Remove filter: “moteur”" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", {
      name: "Remove filter: From 1 November 2026",
    }),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: "18 November 2026" })).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Text").value).toBe("moteur");
  // Presentation only: nothing is asked of the server again.
  expect(searches).toHaveLength(1);
});

it("finds the photos of the intake in November", async () => {
  const user = userEvent.setup();
  const { last } = renderSearch();
  await screen.findByText("Trace 1");

  await user.selectOptions(await screen.findByLabelText("Chantier"), "3");
  await user.type(screen.getByLabelText("Du"), "2026-11-01");
  await user.type(screen.getByLabelText("Au"), "2026-11-30");
  await user.click(screen.getByLabelText("Avec au moins une photo"));
  await user.click(screen.getByRole("button", { name: "Rechercher" }));

  await waitFor(() =>
    expect(last()).toMatchObject({
      work_item: "3",
      since: "2026-11-01",
      until: "2026-11-30",
      has_photo: "true",
    }),
  );
  await user.click(
    screen.getByRole("button", { name: "Retirer le filtre Avec photo" }),
  );
  await waitFor(() => expect(last().has_photo).toBeUndefined());
  expect(last()).toMatchObject({ work_item: "3" });
});

it("offers to remove the filter added last when nothing matches", async () => {
  const user = userEvent.setup();
  const { last } = renderSearch(
    (params) => page(params.has("step") ? [] : [result(1)]),
    "/team-seasons/7/search?q=intake&step=building",
  );

  await user.click(
    await screen.findByRole("button", {
      name: "Retirer le dernier filtre : Construction",
    }),
  );

  expect(await screen.findByText("Trace 1")).toBeTruthy();
  expect(last()).toMatchObject({ q: "intake" });
  expect(last().step).toBeUndefined();
});

it("offers nothing to remove when no filter is applied", async () => {
  renderSearch(() => page([]));

  expect(
    await screen.findByText("Aucune trace ne correspond à ces filtres."),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /Retirer le dernier filtre/ }),
  ).toBeNull();
});
