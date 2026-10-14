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
import { afterEach, expect, it, vi } from "vitest";

import { dismissPending } from "../api/ruleSources";
import { routes } from "../app/router";
import "../i18n";

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setDocumentCookie(value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = value;
}

function renderHome(path = "/") {
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

async function openSection(name: "Chantiers" | "Activité") {
  await userEvent.click(await screen.findByRole("link", { name }));
}

function teamSeason(id: number, number: number, name: string) {
  return {
    id,
    team: { id, number, name },
    season: { start_year: 2026, game_name: "BioBuzz" },
  };
}

function identity(teamSeasons: object[]) {
  return {
    display_name: "Marie",
    club_role: "student",
    is_club_admin: false,
    avatar: null,
    team_seasons: teamSeasons,
  };
}

function workItem(item: object, teamSeasonId = 7) {
  return {
    team_season: teamSeasonId,
    opened_at: new Date().toISOString(),
    closed_at: null,
    ...item,
  };
}

const testWorkday = new Date();
testWorkday.setHours(12, 0, 0, 0);
const testWorkdayDay = testWorkday.toISOString().slice(0, 10);

function workday(
  _path: string,
  present: object[] = [],
  roster = 12,
  entries: object[] = [],
  advancedWorkItems = 0,
): Response {
  return json({
    day: testWorkdayDay,
    entries: entries.map((entry) => ({ work_item: null, ...entry })),
    present,
    roster,
    advanced_work_items: advancedWorkItems,
  });
}

function activity(path: string): Response {
  const query = new URL(path, "https://fieldnotes.test").searchParams;
  return json({
    period: {
      since: query.get("since"),
      until: query.get("until"),
    },
    snapshot: {
      work_items_by_status: [
        { status: "open", count: 0 },
        { status: "done", count: 0 },
        { status: "dropped", count: 0 },
      ],
      work_items_by_step: [
        { step: "brainstorming", count: 0 },
        { step: "prototyping", count: 0 },
        { step: "building", count: 0 },
        { step: "dry_tests", count: 0 },
        { step: "integration", count: 0 },
        { step: "test_zero", count: 0 },
        { step: "tuning", count: 0 },
        { step: "repair", count: 0 },
      ],
      work_items_without_progress: 0,
    },
    activity_by_day: [],
    summary: {
      progress_entries: 0,
      active_days: 0,
      active_members: 0,
      work_items: 0,
    },
    activity_by_week: [],
    activity_by_category: [
      { on_robot: true, progress_entries: 0 },
      { on_robot: false, progress_entries: 0 },
    ],
    work_items: [],
    members: [],
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
  localStorage.clear();
});

it("splits a team's work items and highlights its handover", async () => {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const twoWeeksAgoDay = twoWeeksAgo.toISOString().slice(0, 10);

  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json(identity([teamSeason(7, 1796, "Les Rouages")]));
    }
    if (path === "/api/team-seasons/7/work-items/") {
      return json([
        workItem({
          id: 10,
          title: "Intake",
          on_robot: true,
          status: "open",
          current_step: "prototyping",
          handover: {
            body: "Tester les galets verts à 12 V.",
            author: "Lina",
            can_remove: false,
            can_correct: false,
            step: "prototyping",
            occurred_at: twoWeeksAgo.toISOString(),
            day: twoWeeksAgoDay,
          },
          last_progress: {
            occurred_at: twoWeeksAgo.toISOString(),
            day: twoWeeksAgoDay,
            participants: [
              { display_name: "Lina", avatar: null },
              { display_name: "Tom", avatar: null },
            ],
          },
        }),
        workItem({
          id: 11,
          title: "Dossier de sponsoring",
          on_robot: false,
          status: "open",
          current_step: null,
          handover: null,
          last_progress: {
            occurred_at: twoWeeksAgo.toISOString(),
            day: twoWeeksAgoDay,
            participants: [{ display_name: "Marie", avatar: null }],
          },
        }),
      ]);
    }
    if (path.startsWith("/api/team-seasons/7/days/")) {
      return workday(path, [{ display_name: "Lina", avatar: null }], 12);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderHome();

  expect(
    await screen.findByRole("heading", {
      name: "Équipe 1796 · Les Rouages",
    }),
  ).toBeTruthy();
  await openSection("Chantiers");
  expect(await screen.findByRole("heading", { name: "Robot" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Hors robot" })).toBeTruthy();
  expect(screen.getAllByText("1 chantier")).toHaveLength(2);
  expect(screen.getByText("Intake")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /Intake/ }).getAttribute("href"),
  ).toBe("/work-items/10");
  expect(screen.getByText("Dossier de sponsoring")).toBeTruthy();
  expect(screen.getAllByText("Ouvert", { selector: "span" })).toHaveLength(2);
  expect(screen.getByText("À reprendre")).toBeTruthy();
  expect(screen.getByText("Tester les galets verts à 12 V.")).toBeTruthy();
  expect(screen.getByText("Lina et Tom · il y a 2 semaines")).toBeTruthy();

  const robotToggle = screen.getByRole("button", { name: "Robot" });
  const robotPanel = document.getElementById("robot-work-items-content");
  expect(robotToggle.getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(robotToggle);
  expect(robotToggle.getAttribute("aria-expanded")).toBe("false");
  expect(robotPanel?.hidden).toBe(true);
});

it("explains the empty state to a member without a team", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json(identity([]));
    }
    if (path === "/api/notifications/") {
      return json({ unread: 0, items: [] });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderHome();

  expect(
    await screen.findByRole("heading", {
      name: "Vous n'avez pas encore d'équipe.",
    }),
  ).toBeTruthy();
  // No team data: only the identity, and the header's bell.
  await waitFor(() =>
    expect(fetchMock.mock.calls.map(([path]) => path).sort()).toEqual([
      "/api/auth/me/",
      "/api/notifications/",
    ]),
  );
});

it("opens a team section from the URL and only loads its own data", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json(identity([teamSeason(7, 1796, "Les Rouages")]));
    }
    if (path.startsWith("/api/team-seasons/7/days/")) {
      return workday(path);
    }
    if (path.startsWith("/api/team-seasons/7/analytics/activity/")) {
      return activity(path);
    }
    if (path === "/api/team-seasons/7/work-items/") {
      return json([]);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const router = renderHome("/?section=activity");

  const activityLink = await screen.findByRole("link", { name: "Activité" });
  expect(activityLink.getAttribute("aria-current")).toBe("page");
  expect(
    await screen.findByRole("heading", { name: "Activité de l'équipe" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Aujourd'hui" })).toBeTruthy();
  expect(router.state.location.search).toBe("?section=activity");
  expect(
    fetchMock.mock.calls.some(([path]) =>
      path.startsWith("/api/team-seasons/7/analytics/activity/"),
    ),
  ).toBe(true);
  expect(
    fetchMock.mock.calls.some(
      ([path]) => path === "/api/team-seasons/7/work-items/",
    ),
  ).toBe(false);

  await openSection("Chantiers");

  expect(router.state.location.search).toBe("?section=work-items");
  expect(await screen.findByRole("heading", { name: "Robot" })).toBeTruthy();
  expect(
    fetchMock.mock.calls.some(
      ([path]) => path === "/api/team-seasons/7/work-items/",
    ),
  ).toBe(true);
});

it("loads another team's work items when the selection changes", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json(
        identity([
          teamSeason(7, 1796, "Les Rouages"),
          teamSeason(8, 6543, "Les Engrenages"),
        ]),
      );
    }
    if (path === "/api/team-seasons/7/work-items/") {
      return json([]);
    }
    if (path === "/api/team-seasons/8/work-items/") {
      return json([
        workItem(
          {
            id: 20,
            title: "Châssis",
            on_robot: true,
            status: "open",
            current_step: "building",
            handover: null,
            last_progress: {
              occurred_at: new Date().toISOString(),
              day: testWorkdayDay,
              participants: [{ display_name: "Marie", avatar: null }],
            },
          },
          8,
        ),
      ]);
    }
    if (path.includes("/days/")) {
      return workday(path);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const router = renderHome();

  await openSection("Chantiers");
  const selector = await screen.findByLabelText("Changer d'équipe");
  await userEvent.selectOptions(selector, "8");

  expect(
    await screen.findByRole("heading", {
      name: "Équipe 6543 · Les Engrenages",
    }),
  ).toBeTruthy();
  expect(await screen.findByText("Châssis")).toBeTruthy();
  expect(router.state.location.search).toBe("?section=work-items&team=8");
});

function twoTeams(path: string): Response {
  if (path === "/api/auth/me/") {
    return json(
      identity([
        teamSeason(7, 1796, "Les Rouages"),
        teamSeason(8, 6543, "Les Engrenages"),
      ]),
    );
  }
  if (path.includes("/days/")) {
    return workday(path);
  }
  return json([]);
}

it("opens the team the URL names", async () => {
  vi.stubGlobal("fetch", vi.fn(twoTeams));
  renderHome("/?team=8");

  expect(
    await screen.findByRole("heading", {
      name: "Équipe 6543 · Les Engrenages",
    }),
  ).toBeTruthy();
});

it("keeps the chosen team when switching section", async () => {
  vi.stubGlobal("fetch", vi.fn(twoTeams));
  const router = renderHome("/?team=8");

  await openSection("Activité");

  expect(router.state.location.search).toBe("?section=activity&team=8");
});

it("opens the first team when the URL names none of the member's", async () => {
  vi.stubGlobal("fetch", vi.fn(twoTeams));
  renderHome("/?team=99");

  expect(
    await screen.findByRole("heading", { name: "Équipe 1796 · Les Rouages" }),
  ).toBeTruthy();
});

it("shows every work item and filters them by status", async () => {
  const statuses = ["open", "done", "dropped"] as const;
  const items = Array.from({ length: 6 }, (_, index) => {
    const occurredAt = new Date();
    occurredAt.setDate(occurredAt.getDate() - index);
    return workItem({
      id: index + 1,
      title: `Chantier ${index + 1}`,
      on_robot: index % 2 === 0,
      status: statuses[index % statuses.length],
      current_step: "building",
      handover: null,
      last_progress:
        index === 0 || index === 5
          ? null
          : {
              occurred_at: occurredAt.toISOString(),
              day: occurredAt.toISOString().slice(0, 10),
              participants: [{ display_name: "Marie", avatar: null }],
            },
    });
  });
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json(identity([teamSeason(7, 1796, "Les Rouages")]));
    }
    if (path === "/api/team-seasons/7/work-items/") {
      return json(items);
    }
    if (path.startsWith("/api/team-seasons/7/days/")) {
      return workday(path);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderHome();

  await openSection("Chantiers");
  expect(await screen.findByText("Chantier 1")).toBeTruthy();
  expect(screen.getByText("Chantier 4")).toBeTruthy();
  expect(screen.queryByText("Chantier 2")).toBeNull();
  expect(screen.queryByText("Chantier 6")).toBeNull();
  expect(screen.getByText("Pas encore commencé.")).toBeTruthy();

  const statusFilter = screen.getByLabelText("Filtrer par statut");
  expect((statusFilter as HTMLSelectElement).value).toBe("open");
  expect(
    within(statusFilter)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value),
  ).toEqual(["all", "open", "done", "dropped"]);
  await userEvent.selectOptions(statusFilter, "all");

  expect(screen.getByText("Chantier 6")).toBeTruthy();
  await userEvent.selectOptions(statusFilter, "done");

  expect(screen.getByText("Chantier 2")).toBeTruthy();
  expect(screen.getByText("Chantier 5")).toBeTruthy();
  expect(screen.queryByText("Chantier 1")).toBeNull();
  expect(screen.queryByText("Chantier 6")).toBeNull();
});

it("summarizes today and saves a team note", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  const occurredAt = new Date().toISOString();
  let dayEntries: object[] = [
    {
      id: 41,
      type: "note",
      body: "Pensez à ranger les batteries.",
      occurred_at: occurredAt,
      author: "Lina",
      can_remove: false,
      can_correct: false,
    },
    {
      id: 43,
      work_item: { id: 10, title: "Intake" },
      type: "note",
      body: "Cette remarque appartient au chantier.",
      occurred_at: occurredAt,
      author: "Lina",
      can_remove: false,
      can_correct: false,
    },
  ];

  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json(identity([teamSeason(7, 1796, "Les Rouages")]));
      }
      if (path === "/api/team-seasons/7/work-items/") {
        return json([
          workItem({
            id: 10,
            title: "Intake",
            on_robot: true,
            status: "open",
            current_step: "prototyping",
            handover: null,
            last_progress: {
              occurred_at: new Date().toISOString(),
              day: testWorkdayDay,
              participants: [{ display_name: "Marie", avatar: null }],
            },
          }),
        ]);
      }
      if (path.startsWith("/api/team-seasons/7/days/")) {
        return workday(
          path,
          [{ display_name: "Marie", avatar: null }],
          10,
          dayEntries,
          1,
        );
      }
      if (path === "/api/team-seasons/7/notes/" && options?.method === "POST") {
        const savedNote = {
          id: 42,
          work_item: null,
          type: "note",
          body: "Foret de 4 cassé.",
          occurred_at: occurredAt,
          author: "Marie",
          can_remove: false,
          can_correct: false,
        };
        dayEntries = [savedNote, ...dayEntries];
        return json(savedNote, 201);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderHome();

  const summary = (await screen.findByRole("heading", { name: "Aujourd'hui" }))
    .parentElement;
  await waitFor(() => {
    expect(summary?.textContent).toContain("1 chantier avancé");
  });
  expect(summary?.textContent).toContain("1 présent sur 10");
  expect(screen.getByText("Pensez à ranger les batteries.")).toBeTruthy();
  expect(
    screen.queryByText("Cette remarque appartient au chantier."),
  ).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "+ remarque" }));
  await userEvent.type(
    screen.getByLabelText("Remarque pour l'équipe"),
    "Foret de 4 cassé.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(await screen.findByText("Remarque enregistrée.")).toBeTruthy();
  expect(await screen.findByText("Foret de 4 cassé.")).toBeTruthy();
  const noteRequest = fetchMock.mock.calls.find(
    ([path]) => path === "/api/team-seasons/7/notes/",
  );
  expect(noteRequest).toBeTruthy();
  expect(JSON.parse(String(noteRequest?.[1]?.body))).toEqual({
    body: "Foret de 4 cassé.",
  });
});

function teamWithoutWorkItems(path: string): Response {
  if (path === "/api/auth/me/") {
    return json(identity([teamSeason(7, 1796, "Les Rouages")]));
  }
  if (path === "/api/team-seasons/7/work-items/") {
    return json([]);
  }
  if (path.startsWith("/api/team-seasons/7/days/")) {
    return workday(path);
  }
  throw new Error(`Unexpected request: ${path}`);
}

async function openNotebookExport() {
  await openSection("Chantiers");
  const summary = await screen.findByText("Exporter le cahier");
  const panel = summary.closest("details");
  expect(panel?.open).toBe(false);
  await userEvent.click(summary);
  expect(panel?.open).toBe(true);
}

it("folds the notebook export away until asked, then offers the whole season", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => teamWithoutWorkItems(path)),
  );
  renderHome();

  await openNotebookExport();

  const link = screen.getByRole("link", { name: "Télécharger le cahier" });
  expect(link.getAttribute("href")).toBe(
    "/api/team-seasons/7/export/?format=markdown",
  );
  expect(link.hasAttribute("download")).toBe(true);
});

it("narrows the notebook export to the chosen category", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => teamWithoutWorkItems(path)),
  );
  renderHome();

  await openNotebookExport();
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Partie du cahier" }),
    "Vie de l'équipe",
  );

  expect(
    screen
      .getByRole("link", { name: "Télécharger le cahier" })
      .getAttribute("href"),
  ).toBe("/api/team-seasons/7/export/?format=markdown&category=team-life");
});

it("links the team home to today's summary and the previous one", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path.startsWith("/api/team-seasons/7/days/")
        ? json({
            day: testWorkdayDay,
            previous: "2026-09-26",
            next: null,
            entries: [],
            present: [],
            roster: 12,
            advanced_work_items: 0,
          })
        : teamWithoutWorkItems(path),
    ),
  );
  renderHome();

  expect(
    (
      await screen.findByRole("link", { name: "Résumé de la journée" })
    ).getAttribute("href"),
  ).toBe(`/team-seasons/7/days/${testWorkdayDay}`);
  expect(
    screen
      .getByRole("link", { name: "Séance précédente" })
      .getAttribute("href"),
  ).toBe("/team-seasons/7/days/2026-09-26");
});

it("shows a note written today on a summary of today opened before", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  let dayEntries: object[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (path.startsWith("/api/team-seasons/7/days/")) {
        return json({
          day: testWorkdayDay,
          previous: null,
          next: null,
          entries: dayEntries,
          present: [],
          roster: 12,
          advanced_work_items: 0,
        });
      }
      if (path === "/api/team-seasons/7/notes/" && options?.method === "POST") {
        const note = {
          id: 42,
          work_item: null,
          type: "note",
          body: "Foret de 4 cassé.",
          step: null,
          handover: "",
          occurred_at: new Date().toISOString(),
          author: "Marie",
          can_remove: false,
          can_correct: false,
          participants: [],
          attachments: [],
        };
        dayEntries = [note];
        return json(note, 201);
      }
      return teamWithoutWorkItems(path);
    }),
  );
  // As in the app: a query stays fresh for a while, so a stale summary
  // would be served from the cache rather than asked for again.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  const router = createMemoryRouter(routes, {
    initialEntries: [`/team-seasons/7/days/${testWorkdayDay}`],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("Rien n'a été écrit ce jour-là."),
  ).toBeTruthy();

  await router.navigate("/");
  await userEvent.click(
    await screen.findByRole("button", { name: "+ remarque" }),
  );
  await userEvent.type(
    screen.getByLabelText("Remarque pour l'équipe"),
    "Foret de 4 cassé.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  expect(await screen.findByText("Remarque enregistrée.")).toBeTruthy();

  await userEvent.click(
    screen.getByRole("link", { name: "Résumé de la journée" }),
  );
  expect(await screen.findByText("Foret de 4 cassé.")).toBeTruthy();
  expect(screen.getByText("Remarque")).toBeTruthy();
});

it("removes a team note its author left by mistake", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  let entries: object[] = [
    {
      id: 41,
      type: "note",
      body: "Réunion annulée.",
      occurred_at: new Date().toISOString(),
      author: "Marie",
      can_remove: true,
      can_correct: false,
    },
  ];
  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json(identity([teamSeason(7, 1796, "Les Rouages")]));
      }
      if (path === "/api/team-seasons/7/work-items/") {
        return json([]);
      }
      if (path === "/api/team-seasons/7/days/today/") {
        return workday(path, [], 12, entries);
      }
      if (path === "/api/entries/41/" && options?.method === "DELETE") {
        entries = [];
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderHome();

  expect(await screen.findByText("Réunion annulée.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Retirer" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Retirer définitivement" }),
  );

  await waitFor(() =>
    expect(screen.queryByText("Réunion annulée.")).toBeNull(),
  );
});

it("opens a teammate's profile from the roster", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json(identity([teamSeason(7, 1796, "Les Rouages")]));
    }
    if (path === "/api/team-seasons/7/work-items/") return json([]);
    if (path === "/api/team-seasons/7/days/today/") return workday(path);
    if (path === "/api/team-seasons/7/roster/") {
      return json([{ id: 9, display_name: "Lina", avatar: null }]);
    }
    if (path === "/api/users/9/profile/") {
      return json({
        id: 9,
        display_name: "Lina",
        avatar: null,
        club_role: "student",
        team: { id: 7, number: 1796, name: "Les Rouages" },
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderHome();

  await userEvent.click(await screen.findByRole("link", { name: "Lina" }));

  expect(await screen.findByRole("heading", { name: "Lina" })).toBeTruthy();
  expect(await screen.findByText("Équipe : 1796 · Les Rouages")).toBeTruthy();
});

it("tells a club admin a rulebook source has an update waiting, linking to its review", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json({
        ...identity([teamSeason(7, 1796, "Les Rouages")]),
        is_club_admin: true,
      });
    }
    if (path.startsWith("/api/team-seasons/7/days/")) {
      return workday(path);
    }
    if (path === "/api/team-seasons/7/work-items/") {
      return json([]);
    }
    if (path === "/api/rules/sources/") {
      return json([
        {
          source: "game_manual",
          title: "Manuel BioBuzz TU03",
          url: "https://ftc-resources.firstinspires.org/manual.htm",
          fetched_at: "2026-10-01T10:00:00Z",
          checked_at: "2026-10-09T08:00:00Z",
          pending: {
            detected_at: "2026-10-10T09:00:00Z",
            summary: {
              added: 1,
              removed: 0,
              changed: 0,
              references: [],
              references_total: 0,
            },
          },
          check: null,
        },
        {
          source: "official_qa",
          title: null,
          url: "",
          fetched_at: null,
          checked_at: null,
          pending: null,
          check: null,
        },
      ]);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const router = renderHome();

  const badge = await screen.findByRole("link", {
    name: "Une mise à jour du règlement est disponible",
  });
  await user.click(badge);

  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/rules/sources"),
  );
});

it("hides the rulebook badge once its own change has been dismissed", async () => {
  dismissPending("game_manual", "2026-10-10T09:00:00Z");
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json({
        ...identity([teamSeason(7, 1796, "Les Rouages")]),
        is_club_admin: true,
      });
    }
    if (path.startsWith("/api/team-seasons/7/days/")) {
      return workday(path);
    }
    if (path === "/api/team-seasons/7/work-items/") {
      return json([]);
    }
    if (path === "/api/rules/sources/") {
      return json([
        {
          source: "game_manual",
          title: "Manuel BioBuzz TU03",
          url: "https://ftc-resources.firstinspires.org/manual.htm",
          fetched_at: "2026-10-01T10:00:00Z",
          checked_at: "2026-10-09T08:00:00Z",
          // The exact change already dismissed from the review screen.
          pending: {
            detected_at: "2026-10-10T09:00:00Z",
            summary: {
              added: 1,
              removed: 0,
              changed: 0,
              references: [],
              references_total: 0,
            },
          },
          check: null,
        },
        {
          source: "official_qa",
          title: null,
          url: "",
          fetched_at: null,
          checked_at: null,
          pending: null,
          check: null,
        },
      ]);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderHome();

  await screen.findByRole("heading", { name: "Équipe 1796 · Les Rouages" });
  expect(
    screen.queryByRole("link", {
      name: "Une mise à jour du règlement est disponible",
    }),
  ).toBeNull();
});

it("shows no rulebook badge to an admin when nothing is pending", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json({
        ...identity([teamSeason(7, 1796, "Les Rouages")]),
        is_club_admin: true,
      });
    }
    if (path.startsWith("/api/team-seasons/7/days/")) {
      return workday(path);
    }
    if (path === "/api/team-seasons/7/work-items/") {
      return json([]);
    }
    if (path === "/api/rules/sources/") {
      return json([
        {
          source: "game_manual",
          title: "Manuel BioBuzz TU03",
          url: "https://ftc-resources.firstinspires.org/manual.htm",
          fetched_at: "2026-10-01T10:00:00Z",
          checked_at: "2026-10-09T08:00:00Z",
          pending: null,
          check: null,
        },
        {
          source: "official_qa",
          title: null,
          url: "",
          fetched_at: null,
          checked_at: null,
          pending: null,
          check: null,
        },
      ]);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderHome();

  await screen.findByRole("heading", { name: "Équipe 1796 · Les Rouages" });
  expect(
    screen.queryByRole("link", {
      name: "Une mise à jour du règlement est disponible",
    }),
  ).toBeNull();
});
