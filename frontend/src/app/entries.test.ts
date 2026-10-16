import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import { fetchFreshEntry } from "./entries";
import { currentUserQueryKey, resetSession } from "./useCurrentUser";

const queryKey = ["work-items", 7] as const;
const previous = { thread: [{ id: 41, body: "Previous account's note" }] };
const fresh = { thread: [{ id: 41, body: "Updated note" }] };
const nextAccount = {
  id: 2,
  display_name: "Lina",
  club_role: "student" as const,
  is_club_admin: false,
  avatar: null,
  team_seasons: [],
};
const clients: QueryClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

function pendingRefresh() {
  const client = new QueryClient();
  clients.push(client);
  client.setQueryData(queryKey, previous);
  let resolve!: (data: typeof fresh) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<typeof fresh>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const response = { promise, resolve, reject };
  const queryFn = vi.fn(() => response.promise);
  const result = fetchFreshEntry(
    client,
    { queryKey, queryFn },
    (data) => data.thread,
    41,
  );
  return { client, response, result, queryFn };
}

it("refreshes a fresh cache entry and returns the requested version", async () => {
  const { client, response, result, queryFn } = pendingRefresh();
  response.resolve(fresh);

  expect(await result).toEqual(fresh.thread[0]);
  expect(queryFn).toHaveBeenCalledOnce();
  expect(client.getQueryData(queryKey)).toEqual(fresh);
});

it("keeps cached data and its successful state when a refresh fails", async () => {
  const { client, response, result } = pendingRefresh();
  const error = new TypeError("The server is unreachable");
  const rejected = expect(result).rejects.toBe(error);
  response.reject(error);

  await rejected;
  expect(client.getQueryData(queryKey)).toBe(previous);
  expect(client.getQueryState(queryKey)?.status).toBe("success");
});

it("does not restore private data after signing out during a refresh", async () => {
  const { client, response, result } = pendingRefresh();
  resetSession(client, null);
  expect(client.getQueryState(queryKey)).toBeUndefined();
  response.resolve(fresh);

  expect(await result).toBeNull();
  expect(client.getQueryState(queryKey)).toBeUndefined();
  expect(client.getQueryData(currentUserQueryKey)).toBeNull();
});

it("does not overwrite a new account's data under the same query key", async () => {
  const { client, response, result } = pendingRefresh();
  resetSession(client, nextAccount);
  const nextData = { thread: [{ id: 41, body: "Next account's note" }] };
  client.setQueryData(queryKey, nextData);
  response.resolve(fresh);

  expect(await result).toBeNull();
  expect(client.getQueryData(queryKey)).toBe(nextData);
  expect(client.getQueryData(currentUserQueryKey)).toEqual(nextAccount);
});

it("does not restore an entry removed during a refresh", async () => {
  const { client, response, result } = pendingRefresh();
  client.removeQueries({ queryKey, exact: true });
  response.resolve(fresh);

  expect(await result).toBeNull();
  expect(client.getQueryState(queryKey)).toBeUndefined();
});

it("does not start a refresh after its cached page was removed", async () => {
  const client = new QueryClient();
  clients.push(client);
  const queryFn = vi.fn(async () => fresh);

  expect(
    await fetchFreshEntry(
      client,
      { queryKey, queryFn },
      (data) => data.thread,
      41,
    ),
  ).toBeNull();
  expect(queryFn).not.toHaveBeenCalled();
  expect(client.getQueryState(queryKey)).toBeUndefined();
});

it("returns null when the refreshed entry has been removed", async () => {
  const { client, response, result } = pendingRefresh();
  response.resolve({ thread: [] });

  expect(await result).toBeNull();
  expect(client.getQueryData(queryKey)).toEqual({ thread: [] });
});
