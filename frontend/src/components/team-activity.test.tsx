import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  activityAnalyticsQueryKey,
  getActivityAnalytics,
} from "../api/activityAnalytics";
import type { TeamSeasonSummary } from "../api/auth";
import { LiveBoard } from "../app/live";
import "../i18n";
import { TeamActivity } from "./TeamActivity";

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function teamSeason(
  id: number,
  number: number,
  name: string,
): TeamSeasonSummary {
  return {
    id,
    team: { id, number, name },
    season: { start_year: 2026, game_name: "BioBuzz" },
  };
}

function analytics(path: string, overrides: object = {}) {
  const query = new URL(path, "https://fieldnotes.test").searchParams;
  return {
    period: {
      since: query.get("since"),
      until: query.get("until"),
    },
    summary: {
      progress_entries: 5,
      active_days: 2,
      active_members: 2,
      work_items: 2,
    },
    activity_by_week: [
      {
        week_start: "2026-09-28",
        progress_entries: 2,
        active_members: 1,
        active_days: 1,
      },
      {
        week_start: "2026-10-05",
        progress_entries: 3,
        active_members: 2,
        active_days: 1,
      },
    ],
    activity_by_category: [
      { on_robot: true, progress_entries: 3 },
      { on_robot: false, progress_entries: 2 },
    ],
    work_items: [
      {
        id: 31,
        title: "Bras",
        on_robot: true,
        status: "open",
        current_step: "building",
        progress_entries: 3,
        active_days: 1,
        active_members: 2,
        last_progress_day: "2026-10-05",
      },
      {
        id: 32,
        title: "Stand",
        on_robot: false,
        status: "done",
        current_step: "prototyping",
        progress_entries: 2,
        active_days: 1,
        active_members: 1,
        last_progress_day: "2026-10-04",
      },
      {
        id: 33,
        title: "Pince",
        on_robot: true,
        status: "open",
        current_step: null,
        progress_entries: 0,
        active_days: 0,
        active_members: 0,
        last_progress_day: null,
      },
    ],
    snapshot: {
      work_items_by_status: [
        { status: "open", count: 2 },
        { status: "done", count: 1 },
        { status: "dropped", count: 0 },
      ],
      work_items_by_step: [
        { step: "brainstorming", count: 0 },
        { step: "prototyping", count: 1 },
        { step: "building", count: 1 },
        { step: "dry_tests", count: 0 },
        { step: "integration", count: 0 },
        { step: "test_zero", count: 0 },
        { step: "tuning", count: 0 },
        { step: "repair", count: 0 },
      ],
      work_items_without_progress: 1,
    },
    activity_by_day: [
      { day: "2026-10-04", progress_entries: 2, active_members: 1 },
      { day: "2026-10-05", progress_entries: 3, active_members: 2 },
    ],
    members: [
      {
        id: 1,
        display_name: "Lina Martin",
        avatar: null,
        is_current_member: true,
        active_days: 2,
        progress_entries: 4,
        work_items: 2,
        last_progress_day: "2026-10-05",
      },
      {
        id: 2,
        display_name: "Noah Bernard",
        avatar: null,
        is_current_member: true,
        active_days: 0,
        progress_entries: 0,
        work_items: 0,
        last_progress_day: null,
      },
    ],
    ...overrides,
  };
}

function renderActivity(fetchMock: ReturnType<typeof vi.fn>, live = false) {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: 800, height: 288 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const firstTeam = teamSeason(7, 1796, "Les Rouages");
  const view = render(
    <QueryClientProvider client={queryClient}>
      {live && <LiveBoard teamSeasonId={firstTeam.id} />}
      <TeamActivity teamSeason={firstTeam} currentWorkday="2026-10-05" />
    </QueryClientProvider>,
    { wrapper: MemoryRouter },
  );
  return { ...view, queryClient, firstTeam };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("requests 30 days and shows API values with accessible chart tables", async () => {
  const fetchMock = vi.fn(async (path: string) => json(analytics(path)));
  renderActivity(fetchMock);

  expect(
    await screen.findByRole("heading", { name: "Activité de l'équipe" }),
  ).toBeTruthy();
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/team-seasons/7/analytics/activity/?since=2026-09-06&until=2026-10-05",
      expect.anything(),
    );
  });

  expect(
    within(
      screen.getByRole("region", { name: "Chantiers aujourd'hui" }),
    ).getByText("Ouvert").parentElement?.textContent,
  ).toContain("2");
  const exportLink = screen.getByRole("link", { name: "Exporter en CSV" });
  expect(exportLink.getAttribute("href")).toBe(
    "/api/team-seasons/7/analytics/activity/?since=2026-09-06&until=2026-10-05&format=csv&report=full",
  );
  expect(exportLink.hasAttribute("download")).toBe(true);
  expect(screen.getByText("Sans avancée").parentElement?.textContent).toContain(
    "1",
  );

  const timeData = await screen.findByRole(
    "table",
    { name: "Données de l'activité dans le temps" },
    { timeout: 10_000 },
  );
  expect(within(timeData).getAllByRole("row")[2]?.textContent).toContain("3");
  expect(within(timeData).getAllByRole("row")[2]?.textContent).toContain("2");

  const stepData = await screen.findByRole(
    "table",
    { name: "Répartition actuelle des chantiers par étape" },
    { timeout: 10_000 },
  );
  expect(
    within(stepData).getByRole("row", { name: "Prototypage 1" }),
  ).toBeTruthy();

  const participation = screen.getByRole("table", {
    name: "Participation des membres",
  });
  expect(
    within(participation).getByRole("row", {
      name: /Noah Bernard 0 0 0 Aucune/,
    }),
  ).toBeTruthy();
}, 15_000);

it("reloads the selected team and custom period while keeping the work filter", async () => {
  const fetchMock = vi.fn(async (path: string) => json(analytics(path)));
  const { rerender, queryClient } = renderActivity(fetchMock);
  await screen.findByRole("heading", { name: "Chantiers aujourd'hui" });
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Chantiers observés" }),
    "robot",
  );

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Période observée" }),
    "custom",
  );
  fireEvent.change(screen.getByLabelText("Du"), {
    target: { value: "2026-09-12" },
  });
  fireEvent.change(screen.getByLabelText("Au"), {
    target: { value: "2026-09-30" },
  });

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(
        ([path]) =>
          path ===
          "/api/team-seasons/7/analytics/activity/?since=2026-09-12&until=2026-09-30&on_robot=true",
      ),
    ).toBe(true);
    expect(
      screen
        .getByRole("link", { name: "Exporter en CSV" })
        .getAttribute("href"),
    ).toBe(
      "/api/team-seasons/7/analytics/activity/?since=2026-09-12&until=2026-09-30&format=csv&on_robot=true&report=full",
    );
  });

  rerender(
    <QueryClientProvider client={queryClient}>
      <TeamActivity
        teamSeason={teamSeason(8, 6543, "Les Engrenages")}
        currentWorkday="2026-10-05"
      />
    </QueryClientProvider>,
  );

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(
        ([path]) =>
          path ===
          "/api/team-seasons/8/analytics/activity/?since=2026-09-12&until=2026-09-30&on_robot=true",
      ),
    ).toBe(true);
    expect(
      screen
        .getByRole("link", { name: "Exporter en CSV" })
        .getAttribute("href"),
    ).toBe(
      "/api/team-seasons/8/analytics/activity/?since=2026-09-12&until=2026-09-30&format=csv&on_robot=true&report=full",
    );
  });
});

it("keeps the snapshot and zero-participation members when the period is empty", async () => {
  const fetchMock = vi.fn(async (path: string) =>
    json(
      analytics(path, {
        activity_by_day: [],
        activity_by_week: [],
        summary: {
          progress_entries: 0,
          active_days: 0,
          active_members: 0,
          work_items: 0,
        },
        activity_by_category: [
          { on_robot: true, progress_entries: 0 },
          { on_robot: false, progress_entries: 0 },
        ],
        work_items: [
          {
            id: 33,
            title: "Pince",
            on_robot: true,
            status: "open",
            current_step: null,
            progress_entries: 0,
            active_days: 0,
            active_members: 0,
            last_progress_day: null,
          },
        ],
      }),
    ),
  );
  renderActivity(fetchMock);

  expect(
    await screen.findByText(
      "Aucune avancée n'a été enregistrée pendant cette période.",
    ),
  ).toBeTruthy();
  expect(screen.getByText("Noah Bernard")).toBeTruthy();
  expect(
    screen.getByText("Aucune semaine avec une avancée sur cette période."),
  ).toBeTruthy();
  expect(
    screen.getByText("Aucune avancée à répartir entre Robot et Hors robot."),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: "Pince" })).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Chantiers aujourd'hui" }),
  ).toBeTruthy();
});

it("shows API failures", async () => {
  renderActivity(vi.fn(async () => json({}, 500)));

  expect(
    await screen.findByText("Une erreur inattendue est survenue."),
  ).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Exporter en CSV" })).toBeNull();
});

it("does not offer an export for an invalid period", async () => {
  renderActivity(vi.fn(async (path: string) => json(analytics(path))));
  await screen.findByRole("link", { name: "Exporter en CSV" });
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Période observée" }),
    "custom",
  );
  fireEvent.change(screen.getByLabelText("Du"), {
    target: { value: "2026-10-06" },
  });

  expect(screen.getByRole("alert").textContent).toBe(
    "La date de début doit précéder la date de fin.",
  );
  expect(screen.queryByRole("link", { name: "Exporter en CSV" })).toBeNull();
});

it("filters both charts, the snapshot, participation and the export, and returns to all work", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    const data = analytics(path);
    const filter = new URL(path, "https://fieldnotes.test").searchParams.get(
      "on_robot",
    );
    if (filter !== null) {
      const count = filter === "true" ? 1 : 2;
      data.snapshot.work_items_by_status[0].count = count;
      data.snapshot.work_items_by_step[1].count = count;
      data.activity_by_day[0].progress_entries = count;
      data.members[0].progress_entries = count;
      data.summary.progress_entries = count;
      data.activity_by_week[0].progress_entries = count;
      data.activity_by_category = [
        { on_robot: true, progress_entries: filter === "true" ? count : 0 },
        { on_robot: false, progress_entries: filter === "false" ? count : 0 },
      ];
      data.work_items = data.work_items.filter(
        (item) => item.on_robot === (filter === "true"),
      );
    }
    return json(data);
  });
  const { queryClient } = renderActivity(fetchMock);
  await screen.findByRole("link", { name: "Exporter en CSV" });
  const filter = screen.getByRole("combobox", { name: "Chantiers observés" });

  for (const [scope, value, count] of [
    ["robot", "true", 1],
    ["off_robot", "false", 2],
  ] as const) {
    await userEvent.selectOptions(filter, scope);
    await waitFor(() => {
      expect(
        screen
          .getByRole("link", { name: "Exporter en CSV" })
          .getAttribute("href"),
      ).toBe(
        `/api/team-seasons/7/analytics/activity/?since=2026-09-06&until=2026-10-05&format=csv&on_robot=${value}&report=full`,
      );
      expect(
        within(
          screen.getByRole("region", { name: "Chantiers aujourd'hui" }),
        ).getByText("Ouvert").parentElement?.textContent,
      ).toContain(String(count));
      expect(
        within(
          screen.getByRole("table", { name: "Participation des membres" }),
        ).getByRole("row", { name: new RegExp(`Lina Martin 2 ${count} 2`) }),
      ).toBeTruthy();
    });
    const timeData = await screen.findByRole("table", {
      name: "Données de l'activité dans le temps",
    });
    expect(within(timeData).getAllByRole("row")[1]?.textContent).toContain(
      String(count),
    );
    const periodSummary = screen.getByRole("region", {
      name: "Résumé de la période",
    });
    expect(
      within(periodSummary).getByText("Avancées sur la période").parentElement
        ?.textContent,
    ).toContain(String(count));
    const categories = await screen.findByRole("table", {
      name: "Répartition des avancées Robot et Hors robot",
    });
    expect(
      within(categories).getByRole("row", {
        name: `${scope === "robot" ? "Robot" : "Hors robot"} ${count}`,
      }),
    ).toBeTruthy();
    const workItems = screen.getByRole("table", {
      name: "Activité par chantier",
    });
    expect(
      within(workItems).queryByRole("link", {
        name: scope === "robot" ? "Stand" : "Bras",
      }),
    ).toBeNull();
    const stepData = await screen.findByRole("table", {
      name: "Répartition actuelle des chantiers par étape",
    });
    expect(
      within(stepData).getByRole("row", { name: `Prototypage ${count}` }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/team-seasons/7/analytics/activity/?since=2026-09-06&until=2026-10-05&on_robot=${value}`,
      expect.anything(),
    );
    expect(
      queryClient.getQueryData(
        activityAnalyticsQueryKey(
          7,
          {
            since: "2026-09-06",
            until: "2026-10-05",
          },
          scope,
        ),
      ),
    ).toBeTruthy();
  }

  await userEvent.selectOptions(filter, "all");
  await waitFor(() => {
    expect(
      screen
        .getByRole("link", { name: "Exporter en CSV" })
        .getAttribute("href"),
    ).toBe(
      "/api/team-seasons/7/analytics/activity/?since=2026-09-06&until=2026-10-05&format=csv&report=full",
    );
    expect(
      within(
        screen.getByRole("table", { name: "Participation des membres" }),
      ).getByRole("row", { name: /Lina Martin 2 4 2/ }),
    ).toBeTruthy();
  });
}, 15_000);

it("hides the export while a new filter loads instead of downloading stale values", async () => {
  let finish: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn((path: string) =>
    path.includes("on_robot=false")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(json(analytics(path))),
  );
  renderActivity(fetchMock);
  await screen.findByRole("link", { name: "Exporter en CSV" });

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Chantiers observés" }),
    "off_robot",
  );

  expect(screen.queryByRole("link", { name: "Exporter en CSV" })).toBeNull();
  await act(async () =>
    finish?.(
      json(
        analytics("?since=2026-09-06&until=2026-10-05", {
          activity_by_day: [],
        }),
      ),
    ),
  );
  expect(
    (await screen.findByRole("link", { name: "Exporter en CSV" })).getAttribute(
      "href",
    ),
  ).toContain("on_robot=false");
  expect(
    await screen.findByText(
      "Aucune avancée n'a été enregistrée pendant cette période.",
    ),
  ).toBeTruthy();
});

it("reloads displayed activity for the selected period on a live board message", async () => {
  const sockets: Socket[] = [];
  class Socket {
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = Socket.OPEN;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(readonly url: string) {
      sockets.push(this);
    }
    close() {}
  }
  vi.stubGlobal("WebSocket", Socket);
  let updated = false;
  const fetchMock = vi.fn(async (path: string) => {
    const data = analytics(path);
    if (updated) {
      data.members[0].progress_entries = 5;
      data.activity_by_day[0].progress_entries = 6;
      data.summary.progress_entries = 9;
      data.activity_by_week[0].progress_entries = 6;
      data.activity_by_category[0].progress_entries = 7;
      data.work_items[0].progress_entries = 7;
    }
    return json(data);
  });
  renderActivity(fetchMock, true);
  const participation = await screen.findByRole("table", {
    name: "Participation des membres",
  });
  expect(
    within(participation).getByRole("row", { name: /Lina Martin 2 4 2/ }),
  ).toBeTruthy();
  expect(sockets[0].url).toBe("ws://localhost:5173/ws/team-seasons/7/");

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Période observée" }),
    "custom",
  );
  fireEvent.change(screen.getByLabelText("Du"), {
    target: { value: "2026-10-01" },
  });
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Chantiers observés" }),
    "robot",
  );
  await screen.findByRole("link", { name: "Exporter en CSV" });
  const before = fetchMock.mock.calls.length;
  updated = true;
  act(() =>
    sockets[0].onmessage?.({ data: JSON.stringify({ work_item: 10 }) }),
  );

  await waitFor(() => {
    expect(
      within(
        screen.getByRole("table", { name: "Participation des membres" }),
      ).getByRole("row", { name: /Lina Martin 2 5 2/ }),
    ).toBeTruthy();
  });
  expect(fetchMock.mock.calls.slice(before).map(([path]) => path)).toContain(
    "/api/team-seasons/7/analytics/activity/?since=2026-10-01&until=2026-10-05&on_robot=true",
  );
  expect(
    screen.getByRole("link", { name: "Exporter en CSV" }).getAttribute("href"),
  ).toContain("on_robot=true");
  const chartData = await screen.findByRole("table", {
    name: "Données de l'activité dans le temps",
  });
  expect(within(chartData).getAllByRole("row")[1]?.textContent).toContain("6");
  const periodSummary = screen.getByRole("region", {
    name: "Résumé de la période",
  });
  expect(
    within(periodSummary).getByText("Avancées sur la période").parentElement
      ?.textContent,
  ).toContain("9");
  const weekly = await screen.findByRole("table", {
    name: "Données de l'activité hebdomadaire",
  });
  expect(
    within(weekly).getByRole("row", { name: /28 sept. 6 1 1/ }),
  ).toBeTruthy();
  const workItems = screen.getByRole("table", {
    name: "Activité par chantier",
  });
  expect(
    within(workItems).getByRole("row", {
      name: /Bras Robot Ouvert Construction 7 1 2/,
    }),
  ).toBeTruthy();
});

it("shows period totals, accessible weekly/category data and links including untouched work", async () => {
  renderActivity(vi.fn(async (path: string) => json(analytics(path))));
  const summary = await screen.findByRole("region", {
    name: "Résumé de la période",
  });
  for (const [label, count] of [
    ["Avancées sur la période", 5],
    ["Jours avec une avancée", 2],
    ["Élèves participants distincts", 2],
    ["Chantiers avec une avancée", 2],
  ] as const) {
    expect(
      within(summary).getByText(label).parentElement?.textContent,
    ).toContain(String(count));
  }
  const weekly = await screen.findByRole("table", {
    name: "Données de l'activité hebdomadaire",
  });
  expect(
    within(weekly).getByRole("row", { name: /5 oct. 3 2 1/ }),
  ).toBeTruthy();
  const categories = await screen.findByRole("table", {
    name: "Répartition des avancées Robot et Hors robot",
  });
  expect(within(categories).getByRole("row", { name: "Robot 3" })).toBeTruthy();
  expect(
    within(categories).getByRole("row", { name: "Hors robot 2" }),
  ).toBeTruthy();
  const items = screen.getByRole("table", { name: "Activité par chantier" });
  expect(
    within(items).getByRole("link", { name: "Bras" }).getAttribute("href"),
  ).toBe("/work-items/31");
  expect(
    within(items).getByRole("row", { name: /Pince Robot Ouvert 0 0 0 Aucune/ }),
  ).toBeTruthy();
});

it("rejects malformed enriched analytics before rendering misleading charts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      json(
        analytics(path, {
          activity_by_week: [
            { week_start: "2026-10-05", progress_entries: "oops" },
          ],
        }),
      ),
    ),
  );
  await expect(
    getActivityAnalytics(7, { since: "2026-10-01", until: "2026-10-05" }),
  ).rejects.toThrow("The activity analytics response is invalid");
});
