import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import "../i18n";

function json(body: unknown, status = 200): Response {
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
    can_remove: false,
    can_correct: false,
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
    can_remove: false,
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

function renderSummary(
  workday: object,
  me: Response = json(identity),
  options: {
    initialDay?: string;
    today?: object;
    days?: Record<string, object>;
  } = {},
) {
  const initialDay = options.initialDay ?? "2026-09-30";
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return me;
    }
    if (path === `/api/team-seasons/7/days/${initialDay}/`) {
      return json(workday);
    }
    if (path === "/api/team-seasons/7/days/today/") {
      return json(options.today ?? day({ day: "2026-10-08" }));
    }
    const selectedDay = path.match(
      /^\/api\/team-seasons\/7\/days\/(\d{4}-\d{2}-\d{2})\/$/,
    )?.[1];
    if (selectedDay && options.days?.[selectedDay]) {
      return json(options.days[selectedDay]);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, {
    initialEntries: [`/team-seasons/7/days/${initialDay}`],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { fetchMock, router };
}

function listItemWith(text: string | RegExp): HTMLElement {
  const item = screen.getByText(text).closest("li");
  if (!item) {
    throw new Error(`No list item holds "${text}"`);
  }
  return item;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
  const decision = listItemWith("passer l'intake aux galets");
  expect(within(decision).getByText("Décision")).toBeTruthy();
  const note = listItemWith("foret de 4 cassé");
  expect(within(note).getByText("Remarque")).toBeTruthy();
});

it("names the work item a note was left on", async () => {
  renderSummary(
    day({
      entries: [
        entry({
          type: "note",
          work_item: { id: 10, title: "Intake" },
          body: "le câble du capteur frotte",
        }),
      ],
    }),
  );

  await screen.findByText(/le câble du capteur frotte/);
  const note = listItemWith(/le câble du capteur frotte/);
  expect(within(note).getByText("Intake")).toBeTruthy();
});

it("sends a visitor who is not signed in to the login page", async () => {
  const { fetchMock } = renderSummary(day(), json(null));

  expect(await screen.findByLabelText("Mot de passe")).toBeTruthy();
  expect(
    fetchMock.mock.calls.some(([path]) => String(path).includes("/days/")),
  ).toBe(false);
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
  const days = within(screen.getByRole("main")).getByRole("navigation");
  expect(within(days).getAllByRole("link")).toEqual([previous]);
});

it("says so when nothing was written that day", async () => {
  renderSummary(day());

  expect(
    await screen.findByText("Rien n'a été écrit ce jour-là."),
  ).toBeTruthy();
});

it("returns to the server's current workday even when the latest session has no next link", async () => {
  const user = userEvent.setup();
  const { fetchMock, router } = renderSummary(day({ next: null }), undefined, {
    today: day({ day: "2026-10-08" }),
  });

  const today = await screen.findByRole("link", { name: "Aujourd'hui" });
  expect(today.getAttribute("href")).toBe("/team-seasons/7/days/today");
  await user.click(today);

  expect(
    await screen.findByRole("heading", { name: "Jeudi 8 octobre" }),
  ).toBeTruthy();
  expect(router.state.location.pathname).toBe("/team-seasons/7/days/today");
  expect(
    screen
      .getByRole("link", { name: "Aujourd'hui" })
      .getAttribute("aria-current"),
  ).toBe("date");
  expect(
    (screen.getByLabelText("Choisir une date") as HTMLInputElement).value,
  ).toBe("2026-10-08");
  expect(
    fetchMock.mock.calls.some(
      ([path]) => path === "/api/team-seasons/7/days/today/",
    ),
  ).toBe(true);
});

it("clearly identifies today and deduplicates its summary request", async () => {
  const { fetchMock } = renderSummary(day({ day: "2026-10-08" }), undefined, {
    initialDay: "today",
  });

  const heading = await screen.findByRole("heading", {
    name: "Jeudi 8 octobre",
  });
  expect(
    within(heading.parentElement as HTMLElement).getByText("Aujourd'hui"),
  ).toBeTruthy();
  expect(
    fetchMock.mock.calls.filter(
      ([path]) => path === "/api/team-seasons/7/days/today/",
    ),
  ).toHaveLength(1);
});

it("also identifies an explicit date matching the server's workday, not the browser clock", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // At 01:30 in Paris the server still considers this the previous workday.
  vi.setSystemTime(new Date("2026-09-30T23:30:00Z"));
  renderSummary(day(), undefined, { today: day() });

  await waitFor(() => {
    expect(
      screen
        .getByRole("link", { name: "Aujourd'hui" })
        .getAttribute("aria-current"),
    ).toBe("date");
  });
  expect(screen.getAllByText("Aujourd'hui")).toHaveLength(2);
});

it("does not mark a past date as today", async () => {
  renderSummary(day());

  const today = await screen.findByRole("link", { name: "Aujourd'hui" });
  expect(today.hasAttribute("aria-current")).toBe(false);
  expect(screen.getAllByText("Aujourd'hui")).toHaveLength(1);
  expect(
    (screen.getByLabelText("Choisir une date") as HTMLInputElement).value,
  ).toBe("2026-09-30");
});

it("opens an arbitrary selected date and preserves its empty state", async () => {
  const { fetchMock, router } = renderSummary(day(), undefined, {
    days: { "2026-09-28": day({ day: "2026-09-28" }) },
  });

  fireEvent.change(await screen.findByLabelText("Choisir une date"), {
    target: { value: "2026-09-28" },
  });

  expect(
    await screen.findByRole("heading", { name: "Lundi 28 septembre" }),
  ).toBeTruthy();
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-09-28",
  );
  expect(screen.getByText("Rien n'a été écrit ce jour-là.")).toBeTruthy();
  expect(
    (screen.getByLabelText("Choisir une date") as HTMLInputElement).value,
  ).toBe("2026-09-28");
  expect(
    fetchMock.mock.calls.some(
      ([path]) => path === "/api/team-seasons/7/days/2026-09-28/",
    ),
  ).toBe(true);
});

it("does not navigate when the date picker is cleared", async () => {
  const { fetchMock, router } = renderSummary(day());
  const picker = await screen.findByLabelText("Choisir une date");
  const requests = fetchMock.mock.calls.length;

  fireEvent.change(picker, { target: { value: "" } });

  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-09-30",
  );
  expect(fetchMock.mock.calls).toHaveLength(requests);
});

it("still navigates between recorded sessions and updates the date picker", async () => {
  const user = userEvent.setup();
  const { router } = renderSummary(
    day({ previous: "2026-09-26", next: "2026-10-02" }),
    undefined,
    {
      days: {
        "2026-09-26": day({ day: "2026-09-26", next: "2026-09-30" }),
        "2026-10-02": day({ day: "2026-10-02", previous: "2026-09-30" }),
      },
    },
  );

  await user.click(
    await screen.findByRole("link", { name: /samedi 26 septembre/ }),
  );
  await screen.findByRole("heading", { name: "Samedi 26 septembre" });
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-09-26",
  );
  expect(
    (screen.getByLabelText("Choisir une date") as HTMLInputElement).value,
  ).toBe("2026-09-26");

  await user.click(screen.getByRole("link", { name: /mercredi 30 septembre/ }));
  await screen.findByRole("heading", { name: "Mercredi 30 septembre" });
  await user.click(screen.getByRole("link", { name: /vendredi 2 octobre/ }));
  await screen.findByRole("heading", { name: "Vendredi 2 octobre" });
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-10-02",
  );
  expect(
    (screen.getByLabelText("Choisir une date") as HTMLInputElement).value,
  ).toBe("2026-10-02");
});
