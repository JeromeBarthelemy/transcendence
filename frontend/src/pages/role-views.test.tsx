import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import "../i18n";

// docs/modules.md §4's demo script: the same home screen, three views. The
// server decides which team seasons each account gets (club/api/
// permissions.py, `team_seasons_open_to`); the screen draws what it is sent.

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function teamSeason(id: number, number: number, name: string) {
  return {
    id,
    team: { id, number, name },
    season: { start_year: 2026, game_name: "BioBuzz" },
  };
}

const ALL_TEAMS = [
  teamSeason(1, 1796, "Les Rouages"),
  teamSeason(2, 6543, "Les Engrenages"),
  teamSeason(3, 24601, "Les Pistons"),
  teamSeason(4, 31415, "Les Bielles"),
];

function renderHomeAs(identity: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me/") return json(identity);
      if (path.endsWith("/work-items/")) return json([]);
      if (path.includes("/days/")) {
        return json({
          day: "2026-09-29",
          entries: [],
          present: [],
          roster: 3,
          advanced_work_items: 0,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
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

function administration() {
  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  return within(nav).queryByRole("button", { name: "Administration" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows a student their own team, with no selector", async () => {
  renderHomeAs({
    display_name: "Lina",
    club_role: "student",
    is_club_admin: false,
    avatar: null,
    team_seasons: [ALL_TEAMS[0]],
  });

  expect(
    await screen.findByRole("heading", { name: "Équipe 1796 · Les Rouages" }),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Changer d'équipe")).toBeNull();
  expect(administration()).toBeNull();
});

it("offers a mentor a team selector", async () => {
  renderHomeAs({
    display_name: "Claire",
    club_role: "mentor",
    is_club_admin: false,
    avatar: null,
    team_seasons: ALL_TEAMS,
  });

  const selector = await screen.findByLabelText("Changer d'équipe");
  expect(within(selector).getAllByRole("option")).toHaveLength(4);
  expect(administration()).toBeNull();
});

it("offers a club admin every team, and the administration screens", async () => {
  renderHomeAs({
    display_name: "Paul",
    club_role: "mentor",
    is_club_admin: true,
    avatar: null,
    team_seasons: ALL_TEAMS,
  });

  const selector = await screen.findByLabelText("Changer d'équipe");
  expect(within(selector).getAllByRole("option")).toHaveLength(4);
  expect(administration()).toBeTruthy();
});
