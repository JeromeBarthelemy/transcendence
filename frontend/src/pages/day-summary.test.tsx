import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
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

const identity = {
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

function member(name: string) {
  return { display_name: name, avatar: null };
}

function entry(fields: object) {
  return {
    id: 1,
    work_item: null,
    type: "progress",
    body: "",
    step: null,
    handover: "",
    occurred_at: "2026-09-30T15:00:00Z",
    author: "Lina",
    participants: [],
    attachments: [],
    ...fields,
  };
}

function attachment(contentType: string) {
  return {
    id: 1,
    name: "fichier",
    content_type: contentType,
    url: "/api/attachments/1/",
    people_recognisable: false,
    uploaded_by: "Lina",
  };
}

function day(fields: object = {}) {
  return {
    day: "2026-09-30",
    previous: null,
    next: null,
    entries: [],
    advanced_work_items: 0,
    present: [],
    roster: 12,
    ...fields,
  };
}

function renderSummary(workday: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me/") {
        return json(identity);
      }
      if (path === "/api/team-seasons/7/days/2026-09-30/") {
        return json(workday);
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, {
    initialEntries: ["/team-seasons/7/days/2026-09-30"],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("heads the page with the weekday of the day it shows", async () => {
  renderSummary(day());

  expect(
    await screen.findByRole("heading", { name: "Mercredi 30 septembre" }),
  ).toBeTruthy();
  expect(await screen.findByText("Équipe 1796 · Les Rouages")).toBeTruthy();
});

it("shows each progress with its work item, step, people and attachments", async () => {
  renderSummary(
    day({
      entries: [
        entry({
          work_item: { id: 10, title: "Intake" },
          step: "test_zero",
          body: "galets montés, ça accroche nettement mieux",
          participants: [member("Lina"), member("Tom")],
          attachments: [
            attachment("image/jpeg"),
            attachment("image/heic"),
            attachment("image/png"),
            attachment("video/mp4"),
          ],
        }),
      ],
    }),
  );

  const progress = await screen.findByRole("article");
  expect(within(progress).getByText("Intake")).toBeTruthy();
  expect(within(progress).getByText("Test zéro")).toBeTruthy();
  expect(within(progress).getByText("Lina et Tom")).toBeTruthy();
  expect(
    within(progress).getByText("galets montés, ça accroche nettement mieux"),
  ).toBeTruthy();
  expect(within(progress).getByText("3 photos · 1 vidéo")).toBeTruthy();
});

it("shows what a progress leaves for the next person", async () => {
  renderSummary(
    day({
      entries: [
        entry({
          work_item: { id: 10, title: "Intake" },
          handover: "Tester les galets verts à 12 V.",
        }),
      ],
    }),
  );

  const progress = await screen.findByRole("article");
  expect(within(progress).getByText("À reprendre")).toBeTruthy();
  expect(
    within(progress).getByText("Tester les galets verts à 12 V."),
  ).toBeTruthy();
});

it("lists decisions and notes apart from the progress", async () => {
  renderSummary(
    day({
      entries: [
        entry({ id: 1, work_item: { id: 10, title: "Intake" } }),
        entry({ id: 2, type: "decision", body: "passer l'intake aux galets" }),
        entry({ id: 3, type: "note", body: "foret de 4 cassé" }),
      ],
    }),
  );

  expect(await screen.findAllByRole("article")).toHaveLength(1);
  const decision = screen
    .getByText("passer l'intake aux galets")
    .closest("li") as HTMLElement;
  expect(within(decision).getByText("Décision")).toBeTruthy();
  const note = screen
    .getByText("foret de 4 cassé")
    .closest("li") as HTMLElement;
  expect(within(note).getByText("Remarque")).toBeTruthy();
});

it("counts who was present out of the team roster", async () => {
  renderSummary(day({ present: [member("Lina"), member("Tom")], roster: 12 }));

  const presence = await screen.findByRole("region", {
    name: "Présents · 2 sur 12",
  });
  expect(within(presence).getByText("Lina")).toBeTruthy();
  expect(within(presence).getByText("Tom")).toBeTruthy();
});

it("leafs to the previous and next workdays, and hides a missing one", async () => {
  renderSummary(day({ previous: "2026-09-26", next: null }));

  const previous = await screen.findByRole("link", {
    name: /samedi 26 septembre/,
  });
  expect(previous.getAttribute("href")).toBe("/team-seasons/7/days/2026-09-26");
  expect(screen.queryByRole("link", { name: /octobre/ })).toBeNull();
});

it("says so when nothing was written that day", async () => {
  renderSummary(day());

  expect(
    await screen.findByText("Rien n'a été écrit ce jour-là."),
  ).toBeTruthy();
});
