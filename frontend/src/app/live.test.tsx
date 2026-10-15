import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activityAnalyticsQueryKey } from "../api/activityAnalytics";

import "../i18n";
import { LiveStatus, liveUrl } from "./live";
import { currentUserQueryKey } from "./useCurrentUser";

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = FakeSocket.CONNECTING;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    act(() => this.onopen?.());
  }

  receive(message: object) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }

  drop() {
    act(() => this.onclose?.());
  }
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1];

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderBoard(path = "/") {
  const queryClient = new QueryClient();
  // As freshly loaded: setting the data clears an earlier invalidation.
  const fresh = () => {
    for (const key of [
      ["team-seasons", 7, "work-items"],
      ["team-seasons", 7, "analytics", "activity", "2026-09-01", "2026-10-05"],
      ["team-seasons", 8, "analytics", "activity", "2026-09-01", "2026-10-05"],
      ...[7, 8].flatMap((team) =>
        ["all", "robot", "off_robot"].map((scope) =>
          activityAnalyticsQueryKey(
            team,
            {
              since: "2026-09-01",
              until: "2026-10-05",
            },
            scope as "all" | "robot" | "off_robot",
          ),
        ),
      ),
      ["work-items", 10],
      ["work-items", 11],
      ["notifications"],
      currentUserQueryKey,
    ]) {
      queryClient.setQueryData(key, { cached: true });
    }
  };
  fresh();
  const router = createMemoryRouter([{ path: "*", element: <LiveStatus /> }], {
    initialEntries: [path],
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const invalidated = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated;
  return { ...view, invalidated, fresh, queryClient, router };
}

const offline =
  "Hors ligne : les changements des autres arriveront à la reconnexion.";

it("invalidates every work filter of the team a message names, and of every team on reconnecting", () => {
  const { invalidated, fresh } = renderBoard();
  latest().open();
  fresh();

  function expectFilteredInvalidation(teams: number[]) {
    for (const scope of ["all", "robot", "off_robot"] as const) {
      for (const team of [7, 8]) {
        expect(
          invalidated([
            ...activityAnalyticsQueryKey(
              team,
              {
                since: "2026-09-01",
                until: "2026-10-05",
              },
              scope,
            ),
          ]),
        ).toBe(teams.includes(team));
      }
    }
  }

  latest().receive({ team_season: 7, work_item: 10 });
  expectFilteredInvalidation([7]);
  fresh();
  latest().receive({ team_season: 8, work_item: null });
  expectFilteredInvalidation([8]);
  fresh();
  latest().drop();
  act(() => vi.advanceTimersByTime(1000));
  latest().open();
  expectFilteredInvalidation([7, 8]);
});

it("listens on the member's own socket, secure under https", () => {
  expect(liveUrl({ protocol: "http:", host: "localhost:5173" })).toBe(
    "ws://localhost:5173/ws/me/",
  );
  expect(liveUrl({ protocol: "https:", host: "192.168.0.119" })).toBe(
    "wss://192.168.0.119/ws/me/",
  );
});

it("reloads the team season and the work item a message names", () => {
  const { invalidated, fresh } = renderBoard();
  latest().open();
  fresh();

  latest().receive({ team_season: 7, work_item: 10 });

  expect(invalidated(["team-seasons", 7, "work-items"])).toBe(true);
  expect(
    invalidated([
      "team-seasons",
      7,
      "analytics",
      "activity",
      "2026-09-01",
      "2026-10-05",
    ]),
  ).toBe(true);
  expect(
    invalidated([
      "team-seasons",
      8,
      "analytics",
      "activity",
      "2026-09-01",
      "2026-10-05",
    ]),
  ).toBe(false);
  expect(invalidated(["work-items", 10])).toBe(true);
  expect(invalidated(["work-items", 11])).toBe(false);
});

it("forgets a deleted work item instead of reading it again, which would answer 404", () => {
  const { invalidated, fresh, queryClient } = renderBoard();
  latest().open();
  fresh();

  latest().receive({ team_season: 7, work_item: 10, deleted: true });

  expect(queryClient.getQueryState(["work-items", 10])).toBeUndefined();
  expect(invalidated(["work-items", 11])).toBe(false);
  expect(invalidated(["team-seasons", 7, "work-items"])).toBe(true);
  expect(invalidated(["notifications"])).toBe(true);
});

it("reloads the member's own account, and no team, on a message that names none", () => {
  const { invalidated, fresh } = renderBoard();
  latest().open();
  fresh();

  latest().receive({ team_season: 7, work_item: null });
  expect(invalidated(currentUserQueryKey)).toBe(false);
  fresh();

  latest().receive({ team_season: null, work_item: null });
  expect(invalidated(currentUserQueryKey)).toBe(true);
  expect(invalidated(["notifications"])).toBe(true);
  expect(invalidated(["team-seasons", 7, "work-items"])).toBe(false);
});

it("reloads the member's own account on reconnecting, in case a message about it was missed", () => {
  const { invalidated, fresh } = renderBoard();
  latest().open();
  fresh();

  latest().drop();
  act(() => vi.advanceTimersByTime(1000));
  latest().open();

  expect(invalidated(currentUserQueryKey)).toBe(true);
});

it("sends a page open on a deleted work item to its team's home", () => {
  const { router } = renderBoard("/work-items/10");
  latest().open();

  latest().receive({ team_season: 7, work_item: 10, deleted: true });

  expect(router.state.location.pathname).toBe("/");
  expect(router.state.location.search).toBe("?team=7");
});

it("keeps its one socket from page to page", async () => {
  const { router } = renderBoard("/");
  latest().open();

  await act(() => router.navigate("/work-items/11"));
  await act(() => router.navigate("/fieldbot"));

  expect(FakeSocket.all).toHaveLength(1);
  expect(latest().closed).toBe(false);
});

it("leaves a page on another work item where it is", () => {
  const { router } = renderBoard("/work-items/11");
  latest().open();

  latest().receive({ team_season: 7, work_item: 10, deleted: true });

  expect(router.state.location.pathname).toBe("/work-items/11");
});

it("reloads on its first connection what changed while it was connecting", () => {
  const { invalidated } = renderBoard();

  latest().drop();
  act(() => vi.advanceTimersByTime(1000));
  expect(invalidated(["work-items", 11])).toBe(false);
  latest().open();

  expect(invalidated(["team-seasons", 7, "work-items"])).toBe(true);
  expect(invalidated(["work-items", 11])).toBe(true);
});

it("reloads a teammate's dot (#267) without touching the board or the bell", () => {
  const { invalidated, fresh, queryClient } = renderBoard();
  latest().open();
  fresh();
  queryClient.setQueryData(["members", "profile", 42], { cached: true });
  queryClient.setQueryData(["team-seasons", 7, "roster"], { cached: true });

  latest().receive({ presence: true, team_season: 7 });

  expect(invalidated(["team-seasons", 7, "roster"])).toBe(true);
  expect(invalidated(["members", "profile", 42])).toBe(true);
  expect(invalidated(["team-seasons", 7, "work-items"])).toBe(false);
  expect(invalidated(["notifications"])).toBe(false);
});

it("reloads the member's notifications on any message, since a change may concern them", () => {
  const { invalidated, fresh } = renderBoard();
  latest().open();
  fresh();

  latest().receive({ team_season: 7, work_item: 10 });

  expect(invalidated(["notifications"])).toBe(true);
});

it("reloads the member's notifications on connecting, since some may have come while disconnected", () => {
  const { invalidated } = renderBoard();

  latest().open();

  expect(invalidated(["notifications"])).toBe(true);
});

it("reconnects after a drop and reloads what it may have missed", () => {
  const { invalidated, fresh } = renderBoard();
  latest().open();
  fresh();

  latest().drop();
  act(() => vi.advanceTimersByTime(1000));
  expect(FakeSocket.all).toHaveLength(2);
  expect(invalidated(["work-items", 11])).toBe(false);
  latest().open();

  expect(invalidated(["team-seasons", 7, "work-items"])).toBe(true);
  expect(
    invalidated([
      "team-seasons",
      7,
      "analytics",
      "activity",
      "2026-09-01",
      "2026-10-05",
    ]),
  ).toBe(true);
  expect(invalidated(["work-items", 11])).toBe(true);
  expect(invalidated(["notifications"])).toBe(true);
});

it("says it is offline after a few seconds without a connection, until it is back", () => {
  renderBoard();
  latest().open();

  latest().drop();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByText(offline)).toBeNull();
  latest().drop();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByRole("status").textContent).toBe(offline);

  latest().open();
  expect(screen.queryByText(offline)).toBeNull();
});

it("closes its socket when the screen goes, and does not reconnect", () => {
  const { unmount } = renderBoard();
  const socket = latest();
  socket.open();

  unmount();
  act(() => vi.advanceTimersByTime(30_000));

  expect(socket.closed).toBe(true);
  expect(FakeSocket.all).toHaveLength(1);
});

it("says at once that the browser is offline, and stops once it is back", () => {
  renderBoard();
  latest().open();

  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByRole("status").textContent).toBe(offline);

  act(() => window.dispatchEvent(new Event("online")));
  expect(screen.queryByText(offline)).toBeNull();
});

it("starts a fresh socket once the browser is back online, the old one may be dead", () => {
  const { invalidated, fresh } = renderBoard();
  const stale = latest();
  stale.open();
  fresh();
  act(() => window.dispatchEvent(new Event("offline")));

  act(() => window.dispatchEvent(new Event("online")));

  expect(stale.closed).toBe(true);
  expect(FakeSocket.all).toHaveLength(2);
  latest().open();
  expect(invalidated(["work-items", 11])).toBe(true);
  expect(invalidated(["notifications"])).toBe(true);
});

it("reconnects without waiting once the browser is back online", () => {
  renderBoard();
  latest().open();
  act(() => window.dispatchEvent(new Event("offline")));
  latest().drop();

  act(() => window.dispatchEvent(new Event("online")));

  expect(FakeSocket.all).toHaveLength(2);
});

it("waits for a socket still connecting to open before closing it", () => {
  const { unmount } = renderBoard();
  const socket = latest();

  unmount();
  expect(socket.closed).toBe(false);
  socket.open();

  expect(socket.closed).toBe(true);
  act(() => vi.advanceTimersByTime(30_000));
  expect(FakeSocket.all).toHaveLength(1);
});

it("closes its socket when the page is left, and opens it again if the page comes back", () => {
  const { invalidated, fresh } = renderBoard();
  const socket = latest();
  socket.open();
  fresh();

  act(() => window.dispatchEvent(new Event("pagehide")));
  expect(socket.closed).toBe(true);
  act(() => vi.advanceTimersByTime(30_000));
  expect(FakeSocket.all).toHaveLength(1);

  const back = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(back, "persisted", { value: true });
  act(() => window.dispatchEvent(back));
  expect(FakeSocket.all).toHaveLength(2);
  latest().open();
  expect(invalidated(["work-items", 11])).toBe(true);
  expect(invalidated(["notifications"])).toBe(true);
});

it("starts a fresh socket every hour, without saying it is offline", () => {
  const { invalidated, fresh } = renderBoard();
  const first = latest();
  first.open();

  act(() => vi.advanceTimersByTime(60 * 60 * 1000));
  // An hour on, the test's unobserved queries are gone: loaded afresh.
  fresh();

  expect(first.closed).toBe(true);
  expect(FakeSocket.all).toHaveLength(2);
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByText(offline)).toBeNull();
  latest().open();
  expect(invalidated(["work-items", 11])).toBe(true);
  expect(invalidated(["notifications"])).toBe(true);
});
