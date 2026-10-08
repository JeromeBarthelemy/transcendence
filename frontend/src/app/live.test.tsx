import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import "../i18n";
import { LiveBoard, liveUrl } from "./live";

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

function renderBoard() {
  const queryClient = new QueryClient();
  // As freshly loaded: setting the data clears an earlier invalidation.
  const fresh = () => {
    for (const key of [
      ["team-seasons", 7, "work-items"],
      ["team-seasons", 7, "analytics", "activity", "2026-09-01", "2026-10-05"],
      ["team-seasons", 8, "analytics", "activity", "2026-09-01", "2026-10-05"],
      ["work-items", 10],
      ["work-items", 11],
      ["notifications"],
    ]) {
      queryClient.setQueryData(key, { cached: true });
    }
  };
  fresh();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LiveBoard teamSeasonId={7} />
    </QueryClientProvider>,
  );
  const invalidated = (key: unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated;
  return { ...view, invalidated, fresh };
}

const offline =
  "Hors ligne : les changements des autres arriveront à la reconnexion.";

it("listens on its team season's socket, secure under https", () => {
  expect(liveUrl(7, { protocol: "http:", host: "localhost:5173" })).toBe(
    "ws://localhost:5173/ws/team-seasons/7/",
  );
  expect(liveUrl(7, { protocol: "https:", host: "192.168.0.119" })).toBe(
    "wss://192.168.0.119/ws/team-seasons/7/",
  );
});

it("reloads the team season and the work item a message names", () => {
  const { invalidated, fresh } = renderBoard();
  latest().open();
  fresh();

  latest().receive({ work_item: 10 });

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

it("reloads on its first connection what changed while it was connecting", () => {
  const { invalidated } = renderBoard();

  latest().drop();
  act(() => vi.advanceTimersByTime(1000));
  expect(invalidated(["work-items", 11])).toBe(false);
  latest().open();

  expect(invalidated(["team-seasons", 7, "work-items"])).toBe(true);
  expect(invalidated(["work-items", 11])).toBe(true);
});

it("reloads the member's notifications on any message, since a change may concern them", () => {
  const { invalidated, fresh } = renderBoard();
  latest().open();
  fresh();

  latest().receive({ work_item: 10 });

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
});
