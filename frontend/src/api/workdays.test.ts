import { afterEach, expect, it, vi } from "vitest";

import { getActivityCalendar } from "./workdays";

const calendar = {
  month: "2026-09",
  today: "2026-10-08",
  days: [{ day: "2026-09-30", progress: 2, notes: 1, decisions: 0 }],
};

function respond(body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

it("loads all calendar activity in one team-scoped month request", async () => {
  const fetchMock = respond(calendar);

  expect(await getActivityCalendar(7, "2026-09")).toEqual(calendar);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/team-seasons/7/calendar/?month=2026-09",
    expect.objectContaining({ credentials: "same-origin" }),
  );
});

it.each([
  { ...calendar, month: "2026-08" },
  { ...calendar, today: null },
  { ...calendar, days: null },
  {
    ...calendar,
    days: [{ day: "2026-09-30", progress: -1, notes: 0, decisions: 0 }],
  },
  {
    ...calendar,
    days: [{ day: "2026-09-30", progress: 1.5, notes: 0, decisions: 0 }],
  },
  {
    ...calendar,
    days: [{ day: "2026-09-30", progress: "2", notes: 0, decisions: 0 }],
  },
])("rejects malformed or mismatched calendar responses (%#)", async (body) => {
  respond(body);

  await expect(getActivityCalendar(7, "2026-09")).rejects.toThrow(
    "The activity calendar response is invalid",
  );
});

it("accepts an empty month", async () => {
  respond({ ...calendar, days: [] });

  expect((await getActivityCalendar(7, "2026-09")).days).toEqual([]);
});
