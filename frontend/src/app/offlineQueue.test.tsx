import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ApiRequestError } from "../api/client";
import {
  discard,
  type PendingAction,
  type PendingSave,
  replay,
  setCurrentMember,
  trySave,
  usePendingSaves,
} from "./offlineQueue";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setDocumentCookie(value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = value;
}

function stubFetch(handler: (path: string) => Response | undefined) {
  const fetchMock = vi.fn(async (path: string) => {
    const response = handler(path);
    if (!response) {
      throw new TypeError("Failed to fetch");
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function tickEntry(id: number) {
  return json({
    id,
    work_item: null,
    type: "progress",
    body: "",
    step: null,
    handover: "",
    occurred_at: "2026-10-15T10:00:00Z",
    author: "Lina",
    participants: [],
    attachments: [],
    can_remove: false,
    can_correct: false,
  });
}

function tick(workItemId: number): PendingAction {
  return {
    kind: "tick",
    teamSeasonId: 7,
    workItemId,
    title: "Réglage du bras",
  };
}

/** The hook's current value, read through a render: offlineQueue.ts keeps
 * its state at module scope, which usePendingSaves (useSyncExternalStore)
 * is the one sanctioned way to read from outside a component. */
function Capture({ onSaves }: { onSaves: (saves: PendingSave[]) => void }) {
  onSaves(usePendingSaves());
  return null;
}

function currentSaves(): PendingSave[] {
  let saves: PendingSave[] = [];
  render(<Capture onSaves={(found) => (saves = found)} />);
  cleanup();
  return saves;
}

/** Leaves the queue as empty as a test found it, whatever it did to it —
 * offlineQueue.ts has no reset of its own, since production code never
 * needs one. */
async function discardEverything(): Promise<void> {
  await Promise.all(currentSaves().map((save) => discard(save.id)));
}

beforeEach(() => {
  setDocumentCookie("csrftoken=test-token; path=/");
  setCurrentMember(1);
});

afterEach(async () => {
  cleanup();
  await discardEverything();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
  setCurrentMember(null);
});

it("queues a save that fails for lack of network, and shows it as pending", async () => {
  stubFetch(() => undefined);

  const result = await trySave(
    () => fetch("/api/work-items/11/tick/"),
    tick(11),
  );

  expect(result).toEqual({ queued: true });
  const saves = currentSaves();
  expect(saves).toHaveLength(1);
  expect(saves[0].failed).toBeNull();
  expect(saves[0].authorId).toBe(1);
});

it("rethrows a save the server itself refused, without queuing it", async () => {
  const refusal = new ApiRequestError(400, {
    step: [{ code: "invalid", message: "…" }],
  });

  await expect(
    trySave(() => {
      throw refusal;
    }, tick(11)),
  ).rejects.toBe(refusal);
  expect(currentSaves()).toHaveLength(0);
});

it("rethrows anything that is not plainly a lost connection, without queuing it", async () => {
  // The clearest case: the save went through, but parsing its response
  // failed — queuing this would replay a save that already landed.
  const malformed = new Error("The work item entry response is invalid");

  await expect(
    trySave(() => {
      throw malformed;
    }, tick(11)),
  ).rejects.toBe(malformed);
  expect(currentSaves()).toHaveLength(0);
});

it("replays a queued save once back online, and removes it", async () => {
  stubFetch(() => undefined);
  await trySave(() => fetch("/api/work-items/11/tick/"), tick(11));
  expect(currentSaves()).toHaveLength(1);

  stubFetch((path) =>
    path === "/api/work-items/11/tick/" ? tickEntry(1) : undefined,
  );
  await replay();

  expect(currentSaves()).toHaveLength(0);
});

it("marks a save failed when the server refuses the replay, without blocking the rest", async () => {
  stubFetch(() => undefined);
  await trySave(() => fetch("/api/work-items/11/tick/"), tick(11));
  await trySave(() => fetch("/api/work-items/12/tick/"), tick(12));

  const refused = stubFetch((path) =>
    path === "/api/work-items/11/tick/"
      ? json({ step: [{ code: "invalid", message: "Étape inconnue." }] }, 400)
      : path === "/api/work-items/12/tick/"
        ? tickEntry(2)
        : undefined,
  );
  await replay();

  // The refused one stays queued; the other, behind it, still landed.
  const saves = currentSaves();
  expect(saves).toHaveLength(1);
  expect(saves[0].failed).toEqual({
    code: "invalid",
    message: "Étape inconnue.",
  });

  refused.mockClear();
  await replay();
  // Not retried on its own: the server's refusal is not a reason to try
  // the exact same thing again.
  expect(refused).not.toHaveBeenCalled();
});

it("stops replaying in order at the first save still offline", async () => {
  stubFetch(() => undefined);
  await trySave(() => fetch("/api/work-items/11/tick/"), tick(11));
  await trySave(() => fetch("/api/work-items/12/tick/"), tick(12));

  stubFetch(() => undefined);
  await replay();

  expect(currentSaves()).toHaveLength(2);
});

it("drops a save the member discards, and nothing else", async () => {
  stubFetch(() => undefined);
  await trySave(() => fetch("/api/work-items/11/tick/"), tick(11));
  await trySave(() => fetch("/api/work-items/12/tick/"), tick(12));
  const [first, second] = currentSaves();

  await discard(first.id);

  const saves = currentSaves();
  expect(saves).toHaveLength(1);
  expect(saves[0].id).toBe(second.id);
});

it("never replays a save queued under a member who has since signed out", async () => {
  // The club's shared computer: Lina (1) queues one offline, then signs
  // out and Tom (2) signs in — the network coming back must not save
  // Lina's work under Tom's name.
  stubFetch(() => undefined);
  await trySave(() => fetch("/api/work-items/11/tick/"), tick(11));
  expect(currentSaves()).toHaveLength(1);

  const endpoint = stubFetch((path) =>
    path === "/api/work-items/11/tick/" ? tickEntry(1) : undefined,
  );
  setCurrentMember(2);
  // setCurrentMember already replays on its own: called directly too,
  // rather than waited for, to prove it did nothing regardless of which
  // of the two actually ran.
  await replay();

  expect(endpoint).not.toHaveBeenCalled();
  const saves = currentSaves();
  expect(saves).toHaveLength(1);
  expect(saves[0].authorId).toBe(1);

  // Lina signs back in: her own save, and only hers, replays — on its own,
  // this time, since nothing here calls replay() directly for her.
  setCurrentMember(1);
  await vi.waitFor(() => {
    expect(currentSaves()).toHaveLength(0);
  });
  expect(endpoint).toHaveBeenCalledWith(
    "/api/work-items/11/tick/",
    expect.anything(),
  );
});
