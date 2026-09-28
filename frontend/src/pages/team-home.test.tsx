import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

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
    entries,
    present,
    roster,
    advanced_work_items: advancedWorkItems,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
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
        {
          id: 10,
          title: "Intake",
          on_robot: true,
          status: "open",
          current_step: "prototyping",
          handover: {
            body: "Tester les galets verts à 12 V.",
            author: "Lina",
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
        },
        {
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
        },
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
  expect(await screen.findByRole("heading", { name: "Robot" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Hors robot" })).toBeTruthy();
  expect(screen.getAllByText("1 chantier")).toHaveLength(2);
  expect(screen.getByText("Intake")).toBeTruthy();
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
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderHome();

  expect(
    await screen.findByRole("heading", {
      name: "Vous n'avez pas encore d'équipe.",
    }),
  ).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
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
      ]);
    }
    if (path.includes("/days/")) {
      return workday(path);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderHome();

  const selector = await screen.findByLabelText("Changer d'équipe");
  await userEvent.selectOptions(selector, "8");

  expect(
    await screen.findByRole("heading", {
      name: "Équipe 6543 · Les Engrenages",
    }),
  ).toBeTruthy();
  expect(await screen.findByText("Châssis")).toBeTruthy();
});

it("shows every work item and filters them by status", async () => {
  const statuses = ["suggested", "open", "done", "dropped"] as const;
  const items = Array.from({ length: 8 }, (_, index) => {
    const occurredAt = new Date();
    occurredAt.setDate(occurredAt.getDate() - index);
    return {
      id: index + 1,
      title: `Chantier ${index + 1}`,
      on_robot: index % 2 === 0,
      status: statuses[index % statuses.length],
      current_step: "building",
      handover: null,
      last_progress:
        index === 0 || index === 7
          ? null
          : {
              occurred_at: occurredAt.toISOString(),
              day: occurredAt.toISOString().slice(0, 10),
              participants: [{ display_name: "Marie", avatar: null }],
            },
    };
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

  expect(await screen.findByText("Chantier 1")).toBeTruthy();
  expect(screen.getByText("Chantier 2")).toBeTruthy();
  expect(screen.queryByText("Chantier 3")).toBeNull();
  expect(screen.queryByText("Chantier 8")).toBeNull();
  expect(screen.getByText("Pas encore commencé.")).toBeTruthy();

  const statusFilter = screen.getByLabelText("Filtrer par statut");
  expect((statusFilter as HTMLSelectElement).value).toBe("active");
  await userEvent.selectOptions(statusFilter, "all");

  expect(screen.getByText("Chantier 8")).toBeTruthy();
  await userEvent.selectOptions(statusFilter, "done");

  expect(screen.getByText("Chantier 3")).toBeTruthy();
  expect(screen.getByText("Chantier 7")).toBeTruthy();
  expect(screen.queryByText("Chantier 1")).toBeNull();
  expect(screen.queryByText("Chantier 8")).toBeNull();
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
    },
  ];

  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json(identity([teamSeason(7, 1796, "Les Rouages")]));
      }
      if (path === "/api/team-seasons/7/work-items/") {
        return json([
          {
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
          },
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
          type: "note",
          body: "Foret de 4 cassé.",
          occurred_at: occurredAt,
          author: "Marie",
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
