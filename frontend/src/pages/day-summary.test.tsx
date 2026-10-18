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
    calendars?: Record<string, object | Response>;
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
    const month = path.match(
      /^\/api\/team-seasons\/7\/calendar\/\?month=(\d{4}-\d{2})$/,
    )?.[1];
    if (month) {
      const response = options.calendars?.[month];
      return response instanceof Response
        ? response
        : json(response ?? { month, today: "2026-10-08", days: [] });
    }
    const selectedDay = path.match(
      /^\/api\/team-seasons\/7\/days\/(\d{4}-\d{2}-\d{2})\/$/,
    )?.[1];
    if (selectedDay && options.days?.[selectedDay]) {
      const response = options.days[selectedDay];
      return response instanceof Promise ? response : json(response);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
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

async function openCalendar(user = userEvent.setup()) {
  await user.click(
    await screen.findByRole("button", { name: "Ouvrir le calendrier" }),
  );
  return screen.findByRole("region", { name: "Calendrier des séances" });
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("fr");
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
    name: /Séance précédente : samedi 26 septembre/,
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
  const calendar = await openCalendar(user);
  expect(
    await within(calendar).findByRole("link", {
      name: /jeudi 8 octobre, Aujourd'hui, Jour affiché/,
    }),
  ).toBeTruthy();
  expect(
    fetchMock.mock.calls.some(
      ([path]) => path === "/api/team-seasons/7/days/today/",
    ),
  ).toBe(true);
});

it("clearly identifies today and loads its summary once", async () => {
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
  renderSummary(day(), undefined, {
    calendars: {
      "2026-09": { month: "2026-09", today: "2026-09-30", days: [] },
    },
  });

  await waitFor(() => {
    expect(
      screen
        .getByRole("link", { name: "Aujourd'hui" })
        .getAttribute("aria-current"),
    ).toBe("date");
  });
  const heading = screen.getByRole("heading", {
    name: "Mercredi 30 septembre",
  });
  expect(
    within(heading.parentElement as HTMLElement).getByText("Aujourd'hui"),
  ).toBeTruthy();
});

it("does not mark a past date as today", async () => {
  renderSummary(day());

  const today = await screen.findByRole("link", { name: "Aujourd'hui" });
  expect(today.hasAttribute("aria-current")).toBe(false);
  const heading = screen.getByRole("heading", {
    name: "Mercredi 30 septembre",
  });
  expect(
    within(heading.parentElement as HTMLElement).queryByText("Aujourd'hui"),
  ).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Ouvrir le calendrier" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

it("starts with no calendar or native date input and toggles a single calendar", async () => {
  const user = userEvent.setup();
  const { router } = renderSummary(day());
  const button = await screen.findByRole("button", {
    name: "Ouvrir le calendrier",
  });

  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(
    screen.queryByRole("region", { name: "Calendrier des séances" }),
  ).toBeNull();
  expect(document.querySelector('input[type="date"]')).toBeNull();

  const calendar = await openCalendar(user);
  expect(
    screen.getAllByRole("region", { name: "Calendrier des séances" }),
  ).toHaveLength(1);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(
    document
      .getElementById(button.getAttribute("aria-controls") ?? "")
      ?.contains(calendar),
  ).toBe(true);

  await user.click(
    screen.getByRole("button", { name: "Fermer le calendrier" }),
  );
  expect(
    screen.queryByRole("region", { name: "Calendrier des séances" }),
  ).toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-09-30",
  );
});

it("opens an empty date from the calendar and closes the picker", async () => {
  const user = userEvent.setup();
  const { fetchMock, router } = renderSummary(day(), undefined, {
    days: { "2026-09-28": day({ day: "2026-09-28" }) },
  });
  const calendar = await openCalendar(user);
  await user.click(
    await within(calendar).findByRole("link", {
      name: /lundi 28 septembre, Sans activité/,
    }),
  );

  expect(
    await screen.findByRole("heading", { name: "Lundi 28 septembre" }),
  ).toBeTruthy();
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-09-28",
  );
  expect(screen.getByText("Rien n'a été écrit ce jour-là.")).toBeTruthy();
  expect(
    screen.queryByRole("region", { name: "Calendrier des séances" }),
  ).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Ouvrir le calendrier" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  expect(
    fetchMock.mock.calls.some(
      ([path]) => path === "/api/team-seasons/7/days/2026-09-28/",
    ),
  ).toBe(true);
});

it("restores calendar trigger focus after loading a selected session and returning to a cached day", async () => {
  const user = userEvent.setup();
  let resolveSummary!: (response: Response) => void;
  const pendingSummary = new Promise<Response>((resolve) => {
    resolveSummary = resolve;
  });
  const { fetchMock } = renderSummary(day(), undefined, {
    days: { "2026-09-28": pendingSummary },
  });
  const firstButton = await screen.findByRole("button", {
    name: "Ouvrir le calendrier",
  });
  const calendar = await openCalendar(user);
  const selectedDay = await within(calendar).findByRole("link", {
    name: /lundi 28 septembre, Sans activité/,
  });
  selectedDay.focus();
  await user.keyboard("{Enter}");

  await screen.findByText("Chargement de la journée…");
  expect(document.contains(firstButton)).toBe(false);
  await act(async () => {
    resolveSummary(json(day({ day: "2026-09-28" })));
  });
  await screen.findByRole("heading", { name: "Lundi 28 septembre" });
  await waitFor(() => {
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Ouvrir le calendrier" }),
    );
  });

  await user.keyboard("{Enter}");
  const reopened = await screen.findByRole("region", {
    name: "Calendrier des séances",
  });
  within(reopened)
    .getByRole("link", { name: /mercredi 30 septembre, Sans activité/ })
    .focus();
  await user.keyboard("{Enter}");

  await screen.findByRole("heading", { name: "Mercredi 30 septembre" });
  await waitFor(() => {
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Ouvrir le calendrier" }),
    );
  });
  expect(
    fetchMock.mock.calls.filter(([path]) => path.includes("/days/")),
  ).toHaveLength(2);
});

it("restores trigger focus when selecting the displayed date from the today URL", async () => {
  const user = userEvent.setup();
  let resolveSummary!: (response: Response) => void;
  const pendingSummary = new Promise<Response>((resolve) => {
    resolveSummary = resolve;
  });
  renderSummary(day({ day: "2026-10-08" }), undefined, {
    initialDay: "today",
    days: { "2026-10-08": pendingSummary },
  });
  const calendar = await openCalendar(user);
  const selectedDay = await within(calendar).findByRole("link", {
    name: /jeudi 8 octobre, Aujourd'hui, Jour affiché/,
  });
  selectedDay.focus();
  await user.keyboard("{Enter}");

  await screen.findByText("Chargement de la journée…");
  await act(async () => {
    resolveSummary(json(day({ day: "2026-10-08" })));
  });
  await screen.findByRole("heading", { name: "Jeudi 8 octobre" });
  await waitFor(() => {
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Ouvrir le calendrier" }),
    );
  });
});

it("opens with the keyboard and restores trigger focus on Escape without navigating", async () => {
  const user = userEvent.setup();
  const { router } = renderSummary(day());
  const button = await screen.findByRole("button", {
    name: "Ouvrir le calendrier",
  });
  button.focus();
  const navigate = vi.spyOn(router, "navigate");
  await user.keyboard("{Enter}");
  const calendar = await screen.findByRole("region", {
    name: "Calendrier des séances",
  });
  await user.tab();
  expect(document.activeElement).toBe(
    within(calendar).getByRole("button", { name: "Mois précédent" }),
  );
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("region", { name: "Calendrier des séances" }),
  ).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(navigate).not.toHaveBeenCalled();
});

it("dismisses on an outside click without changing the displayed session", async () => {
  const user = userEvent.setup();
  const { router } = renderSummary(day());
  await openCalendar(user);
  await user.click(
    screen.getByRole("heading", { name: "Mercredi 30 septembre" }),
  );
  expect(
    screen.queryByRole("region", { name: "Calendrier des séances" }),
  ).toBeNull();
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-09-30",
  );
});

it("dismisses when keyboard focus leaves the calendar", async () => {
  const user = userEvent.setup();
  renderSummary(day({ previous: "2026-09-26" }));
  const calendar = await openCalendar(user);
  const selected = await within(calendar).findByRole("link", {
    name: /mercredi 30 septembre, Jour affiché/,
  });
  selected.focus();
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("link", {
      name: /Séance précédente : samedi 26 septembre/,
    }),
  );
  expect(
    screen.queryByRole("region", { name: "Calendrier des séances" }),
  ).toBeNull();
});

it("also closes when the already displayed day is selected", async () => {
  const user = userEvent.setup();
  const { fetchMock, router } = renderSummary(day());
  const calendar = await openCalendar(user);
  await user.click(
    await within(calendar).findByRole("link", {
      name: /mercredi 30 septembre, Jour affiché/,
    }),
  );
  expect(
    screen.queryByRole("region", { name: "Calendrier des séances" }),
  ).toBeNull();
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-09-30",
  );
  expect(
    fetchMock.mock.calls.filter(([path]) => path.includes("/days/")),
  ).toHaveLength(1);
});

it("still navigates between recorded sessions and reopens on the displayed month", async () => {
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
    await screen.findByRole("link", {
      name: /Séance précédente : samedi 26 septembre/,
    }),
  );
  await screen.findByRole("heading", { name: "Samedi 26 septembre" });
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-09-26",
  );
  let calendar = await openCalendar(user);
  expect(
    await within(calendar).findByRole("link", {
      name: /samedi 26 septembre, Jour affiché/,
    }),
  ).toBeTruthy();

  await user.click(
    screen.getByRole("link", {
      name: /Séance suivante : mercredi 30 septembre/,
    }),
  );
  await screen.findByRole("heading", { name: "Mercredi 30 septembre" });
  await user.click(
    screen.getByRole("link", { name: /Séance suivante : vendredi 2 octobre/ }),
  );
  await screen.findByRole("heading", { name: "Vendredi 2 octobre" });
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-10-02",
  );
  calendar = await openCalendar(user);
  expect(
    await within(calendar).findByRole("link", {
      name: /vendredi 2 octobre, Jour affiché/,
    }),
  ).toBeTruthy();
  expect(
    within(calendar).getByRole("heading", { name: "octobre 2026" }),
  ).toBeTruthy();
});

it("marks progress, notes and decisions with one aggregated request, not one request per day", async () => {
  const { fetchMock } = renderSummary(day(), undefined, {
    calendars: {
      "2026-09": {
        month: "2026-09",
        today: "2026-09-30",
        days: [
          { day: "2026-09-02", progress: 2, notes: 0, decisions: 0 },
          { day: "2026-09-03", progress: 0, notes: 1, decisions: 0 },
          { day: "2026-09-04", progress: 0, notes: 0, decisions: 1 },
        ],
      },
    },
  });
  const calendar = await openCalendar();
  const dates = await within(calendar).findByRole("list", {
    name: "Jours du mois",
  });

  expect(within(dates).getAllByRole("link")).toHaveLength(30);
  expect(
    within(dates)
      .getByRole("link", {
        name: /mercredi 2 septembre, 2 avancées, 0 remarque, 0 décision/,
      })
      .querySelector("[aria-hidden]"),
  ).toBeTruthy();
  expect(
    within(dates)
      .getByRole("link", {
        name: /jeudi 3 septembre, 0 avancée, 1 remarque, 0 décision/,
      })
      .querySelector("[aria-hidden]"),
  ).toBeTruthy();
  expect(
    within(dates)
      .getByRole("link", { name: /vendredi 4 septembre, .*1 décision/ })
      .querySelector("[aria-hidden]"),
  ).toBeTruthy();
  expect(
    within(dates)
      .getByRole("link", { name: /samedi 5 septembre, Sans activité/ })
      .querySelector("[aria-hidden]"),
  ).toBeNull();
  const selected = within(dates).getByRole("link", {
    name: /mercredi 30 septembre, Aujourd'hui, Jour affiché/,
  });
  expect(selected.className).toContain("bg-accent");
  expect(selected.className).toContain("ring-mint-deep");
  expect(selected.getAttribute("aria-current")).toBe("date");
  expect(
    fetchMock.mock.calls.filter(([path]) => path.includes("/calendar/")),
  ).toHaveLength(1);
  expect(
    fetchMock.mock.calls
      .filter(([path]) => path.includes("/days/"))
      .map(([path]) => path)
      .sort(),
  ).toEqual(["/api/team-seasons/7/days/2026-09-30/"]);
});

it("shows every date of an empty leap month in Monday-first order", async () => {
  renderSummary(day({ day: "2024-02-15" }), undefined, {
    initialDay: "2024-02-15",
  });
  const calendar = await openCalendar();
  const dates = await within(calendar).findByRole("list", {
    name: "Jours du mois",
  });

  expect(
    within(calendar).getByRole("heading", { name: "février 2024" }),
  ).toBeTruthy();
  expect(within(dates).getAllByRole("link")).toHaveLength(29);
  expect(
    within(dates)
      .getByRole("link", { name: /jeudi 29 février, Sans activité/ })
      .getAttribute("href"),
  ).toBe("/team-seasons/7/days/2024-02-29");
  expect(dates.children[0].getAttribute("aria-hidden")).toBe("true");
  expect(dates.children[1].getAttribute("aria-hidden")).toBe("true");
  expect(dates.children[2].getAttribute("aria-hidden")).toBe("true");
  expect(dates.children[3].textContent).toBe("1");
  expect(
    within(calendar).getByText("Aucune activité enregistrée ce mois-ci."),
  ).toBeTruthy();
});

it.each([
  ["2000-01-15", "Mois précédent"],
  ["2099-12-15", "Mois suivant"],
])(
  "keeps month navigation within the supported range (%s)",
  async (selectedDay, blockedDirection) => {
    const user = userEvent.setup();
    const { fetchMock } = renderSummary(day({ day: selectedDay }), undefined, {
      initialDay: selectedDay,
    });
    const calendar = await openCalendar(user);
    await within(calendar).findByRole("list", { name: "Jours du mois" });
    const button = within(calendar).getByRole("button", {
      name: blockedDirection,
    });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(
      fetchMock.mock.calls.filter(([path]) => path.includes("/calendar/")),
    ).toHaveLength(1);
  },
);

it("distinguishes today from the selected date even in an empty month", async () => {
  renderSummary(day({ day: "2026-10-20" }), undefined, {
    initialDay: "2026-10-20",
  });
  const calendar = await openCalendar();
  const dates = await within(calendar).findByRole("list", {
    name: "Jours du mois",
  });
  const today = within(dates).getByRole("link", {
    name: /jeudi 8 octobre, Aujourd'hui, Sans activité/,
  });
  const selected = within(dates).getByRole("link", {
    name: /mardi 20 octobre, Jour affiché, Sans activité/,
  });

  expect(today.getAttribute("aria-current")).toBe("date");
  expect(today.className).toContain("ring-mint-deep");
  expect(selected.hasAttribute("aria-current")).toBe(false);
  expect(selected.className).toContain("bg-accent");
});

it("browses months across a year boundary without changing the displayed summary", async () => {
  const user = userEvent.setup();
  const { fetchMock, router } = renderSummary(
    day({ day: "2026-12-15" }),
    undefined,
    { initialDay: "2026-12-15" },
  );
  const calendar = await openCalendar();
  await within(calendar).findByRole("list", { name: "Jours du mois" });

  await user.click(
    within(calendar).getByRole("button", { name: "Mois suivant" }),
  );
  await within(calendar).findByRole("heading", { name: "janvier 2027" });
  await within(calendar).findByRole("list", { name: "Jours du mois" });
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-12-15",
  );
  expect(
    screen.getByRole("heading", { name: "Mardi 15 décembre" }),
  ).toBeTruthy();

  await user.click(
    within(calendar).getByRole("button", { name: "Mois précédent" }),
  );
  await within(calendar).findByRole("heading", { name: "décembre 2026" });
  await user.click(
    within(calendar).getByRole("button", { name: "Mois précédent" }),
  );
  await within(calendar).findByRole("heading", { name: "novembre 2026" });
  await within(calendar).findByRole("list", { name: "Jours du mois" });
  expect(
    fetchMock.mock.calls
      .filter(([path]) => path.includes("/calendar/"))
      .map(([path]) => path),
  ).toEqual([
    "/api/team-seasons/7/calendar/?month=2026-12",
    "/api/team-seasons/7/calendar/?month=2027-01",
    "/api/team-seasons/7/calendar/?month=2026-11",
  ]);
});

it("opens an empty day in another month, closes, and reopens on that month", async () => {
  const user = userEvent.setup();
  const { router } = renderSummary(day(), undefined, {
    days: { "2026-10-05": day({ day: "2026-10-05" }) },
  });
  const calendar = await openCalendar();
  await within(calendar).findByRole("list", { name: "Jours du mois" });
  await user.click(
    within(calendar).getByRole("button", { name: "Mois suivant" }),
  );
  const selected = await within(calendar).findByRole("link", {
    name: /lundi 5 octobre, Sans activité/,
  });
  await user.click(selected);

  expect(
    await screen.findByRole("heading", { name: "Lundi 5 octobre" }),
  ).toBeTruthy();
  expect(router.state.location.pathname).toBe(
    "/team-seasons/7/days/2026-10-05",
  );
  expect(
    screen.queryByRole("region", { name: "Calendrier des séances" }),
  ).toBeNull();
  const newCalendar = await openCalendar(user);
  expect(
    await within(newCalendar).findByRole("link", {
      name: /lundi 5 octobre, Jour affiché/,
    }),
  ).toBeTruthy();
  expect(
    within(newCalendar).getByRole("heading", { name: "octobre 2026" }),
  ).toBeTruthy();
  expect(screen.getByText("Rien n'a été écrit ce jour-là.")).toBeTruthy();

  await act(() => router.navigate(-1));
  expect(
    await screen.findByRole("heading", { name: "Mercredi 30 septembre" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("region", { name: "Calendrier des séances" }),
  ).toBeNull();
  const previousCalendar = await openCalendar(user);
  expect(
    within(previousCalendar).getByRole("heading", { name: "septembre 2026" }),
  ).toBeTruthy();
  expect(
    await within(previousCalendar).findByRole("link", {
      name: /mercredi 30 septembre, Jour affiché/,
    }),
  ).toBeTruthy();
});

it("keeps the summary usable after a calendar failure and offers a retry", async () => {
  const user = userEvent.setup();
  const calendars: Record<string, object | Response> = {
    "2026-09": json({}, 503),
  };
  const { fetchMock } = renderSummary(day(), undefined, { calendars });
  const calendar = await openCalendar();
  expect(await within(calendar).findByRole("alert")).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Mercredi 30 septembre" }),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: "Aujourd'hui" })).toBeTruthy();

  calendars["2026-09"] = { month: "2026-09", today: "2026-10-08", days: [] };
  await user.click(within(calendar).getByRole("button", { name: "Réessayer" }));
  expect(
    await within(calendar).findByRole("list", { name: "Jours du mois" }),
  ).toBeTruthy();
  expect(
    fetchMock.mock.calls.filter(([path]) => path.includes("/calendar/")),
  ).toHaveLength(2);
});

it("does not silently display a response for the wrong month", async () => {
  renderSummary(day(), undefined, {
    calendars: {
      "2026-09": { month: "2026-08", today: "2026-10-08", days: [] },
    },
  });
  const calendar = await openCalendar();

  expect(await within(calendar).findByRole("alert")).toBeTruthy();
  expect(
    within(calendar).queryByRole("list", { name: "Jours du mois" }),
  ).toBeNull();
});

it("switches summary dates, names and calendar labels without changing the selected date or month", async () => {
  const { fetchMock, router } = renderSummary(
    day({
      entries: [
        entry({
          work_item: { id: 10, title: "Intake" },
          participants: [member("Lina"), member("Tom")],
        }),
      ],
    }),
  );
  await screen.findByRole("heading", { name: "Mercredi 30 septembre" });
  await openCalendar();
  await userEvent.click(
    await screen.findByRole("button", { name: "Mois suivant" }),
  );
  await screen.findByRole("heading", { name: "octobre 2026" });
  const initialRequests = fetchMock.mock.calls.length;

  for (const [code, title, month, people, dayLabel] of [
    [
      "en",
      "Wednesday 30 September",
      "October 2026",
      "Lina and Tom",
      /Monday 5 October/,
    ],
    [
      "es",
      "Miércoles, 30 de septiembre",
      "octubre de 2026",
      "Lina y Tom",
      /lunes, 5 de octubre/,
    ],
    [
      "fr",
      "Mercredi 30 septembre",
      "octobre 2026",
      "Lina et Tom",
      /lundi 5 octobre/,
    ],
  ] as const) {
    // A locale update while the panel is open must reformat its browsed month.
    // Using the header selector itself dismisses the panel as an outside click.
    await act(() => i18n.changeLanguage(code));
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByRole("heading", { name: month })).toBeTruthy();
    expect(screen.getByText(people)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: dayLabel }).getAttribute("href"),
    ).toBe("/team-seasons/7/days/2026-10-05");
    expect(router.state.location.pathname).toBe(
      "/team-seasons/7/days/2026-09-30",
    );
    expect(document.querySelector('input[type="date"]')).toBeNull();
  }
  expect(fetchMock.mock.calls).toHaveLength(initialRequests);
});

it.each([
  [
    "en",
    "Open the calendar",
    "Close the calendar",
    "Session calendar",
    /Wednesday 30 September, Displayed day/,
  ],
  [
    "es",
    "Abrir el calendario",
    "Cerrar el calendario",
    "Calendario de sesiones",
    /miércoles, 30 de septiembre, Día mostrado/,
  ],
  [
    "fr",
    "Ouvrir le calendrier",
    "Fermer le calendrier",
    "Calendrier des séances",
    /mercredi 30 septembre, Jour affiché/,
  ],
] as const)(
  "reopens the picker in the chosen language without changing the session (%s)",
  async (code, openLabel, closeLabel, title, selectedLabel) => {
    const user = userEvent.setup();
    const { router } = renderSummary(day());
    await openCalendar(user);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Langue" }),
      code,
    );

    expect(screen.queryByRole("region", { name: title })).toBeNull();
    const trigger = screen.getByRole("button", { name: openLabel });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    const calendar = screen.getByRole("region", { name: title });
    expect(
      await within(calendar).findByRole("link", { name: selectedLabel }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: closeLabel })).toBe(trigger);
    expect(router.state.location.pathname).toBe(
      "/team-seasons/7/days/2026-09-30",
    );
    await user.click(trigger);
    expect(screen.queryByRole("region", { name: title })).toBeNull();
  },
);
