import { useSyncExternalStore } from "react";

import { ApiRequestError } from "../api/client";
import { createTeamNote } from "../api/workdays";
import {
  createWorkItemNote,
  leaveTodaysProgress,
  type ProgressChanges,
  tickWorkItem,
  updateProgress,
  type WorkItemStep,
} from "../api/workItems";
import { queryClient } from "./queryClient";

/** Whoever the session holds right now — AppLayout is the one place that
 * calls `setCurrentMember`, whenever `useCurrentUser()` gives it a new
 * identity, so this can never disagree with what the interface itself
 * shows signed in. Not read from the query cache directly: that would tie
 * this module to one particular QueryClient, and a test's is never the
 * app's own. */
let signedInAs: number | null = null;

/** Called once, from AppLayout, whenever the signed-in member changes
 * (including to no one, on sign-out). A newly signed-in member replays
 * their own queue at once, rather than waiting for the next `online`
 * event or reload. */
export function setCurrentMember(id: number | null): void {
  if (signedInAs === id) {
    return;
  }
  signedInAs = id;
  if (id !== null) {
    void replay();
  }
}

/** What #157 queues when a save fails for lack of network, and replays in
 * this same order once the member is back online. `title`, where present,
 * is only ever used to describe the item to the member — never sent back
 * to the server. */
export type PendingAction =
  | {
      kind: "tick";
      teamSeasonId: number;
      workItemId: number;
      title: string;
      step?: WorkItemStep;
    }
  | { kind: "leave"; teamSeasonId: number; workItemId: number; title: string }
  | {
      kind: "progress";
      teamSeasonId: number;
      workItemId: number;
      entryId: number;
      title: string;
      changes: ProgressChanges;
    }
  | {
      kind: "work-item-note";
      teamSeasonId: number;
      workItemId: number;
      title: string;
      body: string;
      clientId: string;
    }
  | {
      kind: "team-note";
      teamSeasonId: number;
      body: string;
      clientId: string;
    };

export interface PendingSave {
  id: number;
  createdAt: number;
  action: PendingAction;
  /** Whoever was signed in when this was queued (`_identity`'s own `id`,
   * never the display name — theirs to change, #178). Replayed only once
   * they are signed in again: IndexedDB belongs to the origin, not the
   * account, and the club's computer is shared. */
  authorId: number;
  /** Set once a replay was refused by the server (not by the network): the
   * item stays queued and visible, but is never retried again on its own. */
  failed: { code: string; message: string } | null;
}

const DB_NAME = "fieldnotes-offline";
const STORE = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, {
        keyPath: "id",
        autoIncrement: true,
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  dbPromise ??= openDb();
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbAdd(
  db: IDBDatabase,
  value: Omit<PendingSave, "id">,
): Promise<number> {
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  return promisify(store.add(value) as IDBRequest<number>);
}

async function dbPut(db: IDBDatabase, value: PendingSave): Promise<void> {
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  await promisify(store.put(value));
}

async function dbDelete(db: IDBDatabase, id: number): Promise<void> {
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  await promisify(store.delete(id));
}

async function dbGetAll(db: IDBDatabase): Promise<PendingSave[]> {
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  return promisify(store.getAll() as IDBRequest<PendingSave[]>);
}

let pending: PendingSave[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every queued save, oldest first — replay order. */
export function usePendingSaves(): PendingSave[] {
  return useSyncExternalStore(subscribe, () => pending);
}

async function loadPersisted(): Promise<void> {
  const db = await getDb();
  const all = await dbGetAll(db);
  pending = all.sort((a, b) => a.id - b.id);
  notify();
}

/** Stored first, so a reload while still offline (the issue's own "Done
 * when") finds it again; queued rather than thrown, so the form that
 * called this reads a save as accepted, the same way it would a real one. */
async function enqueue(action: PendingAction, authorId: number): Promise<void> {
  const db = await getDb();
  const createdAt = Date.now();
  const value = { createdAt, action, authorId, failed: null };
  const id = await dbAdd(db, value);
  pending = [...pending, { id, ...value }];
  notify();
}

/** Wraps a save already attempted once: a refusal from the server (wrong
 * input, a conflict) is a real error and reaches the caller as it always
 * did, and so is anything else that is not plainly a lost connection —
 * `fetch` itself (and `client.ts`'s `upload()`) only ever throws a
 * `TypeError` for that. Queuing anything broader risks queuing a save that
 * actually landed (a malformed response, say) and replaying it a second
 * time. Only a save that never reached the server at all is queued, and
 * the caller reads it as accepted. Whoever is signed in when the attempt
 * *starts* is who it's queued for: the request is already running under
 * their session by the time it can fail, however long it takes to reject,
 * and a member switch in between must not hand their work to whoever
 * replaces them on the shared computer. */
export async function trySave<T>(
  attempt: () => Promise<T>,
  action: PendingAction,
): Promise<T | { queued: true }> {
  const authorId = signedInAs;
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    if (authorId === null) {
      // Every call site sits behind a sign-in already, so this never
      // happens from a real save — guards a stray call rather than queuing
      // one with no one to replay it for.
      throw new Error("No member is signed in to queue this save for");
    }
    await enqueue(action, authorId);
    return { queued: true };
  }
}

async function perform(action: PendingAction): Promise<void> {
  switch (action.kind) {
    case "tick":
      await tickWorkItem(action.workItemId, action.step);
      break;
    case "leave":
      await leaveTodaysProgress(action.workItemId);
      break;
    case "progress":
      await updateProgress(action.entryId, action.changes);
      break;
    case "work-item-note":
      await createWorkItemNote(
        action.teamSeasonId,
        action.workItemId,
        action.body,
        action.clientId,
      );
      break;
    case "team-note":
      await createTeamNote(action.teamSeasonId, action.body, action.clientId);
      break;
  }
  void queryClient.invalidateQueries({
    queryKey: ["team-seasons", action.teamSeasonId],
  });
  if ("workItemId" in action) {
    void queryClient.invalidateQueries({
      queryKey: ["work-items", action.workItemId],
    });
  }
}

function firstIssue(error: ApiRequestError): { code: string; message: string } {
  const [issue] = Object.values(error.issues).flat();
  return issue ?? { code: "refused", message: error.message };
}

let replaying = false;
// Set when replay() is called while one is already running, and acted on
// once that one finishes: the member it was called for (a sign-in, say)
// gets a full pass of its own rather than being dropped on the floor —
// see the second regression test below for exactly why this matters.
let replayAgain = false;

/** In order, oldest first, for whoever is signed in right now — read fresh
 * for each item, never captured once at the top: an account switch *while*
 * an earlier item in this same pass is still in flight (its request
 * already left under the member who was signed in when it was sent, and
 * nothing here can undo that) must stop every item after it from going out
 * under the new member instead. A later save may depend on an earlier one
 * having landed (two progress edits on the same entry, say). Stops at the
 * first save still refused for lack of network — still offline, or a blip
 * — so the rest stay queued for the next attempt rather than replaying out
 * of order. A save the server itself refuses is marked failed and
 * skipped, without blocking the ones after it. */
export async function replay(): Promise<void> {
  if (replaying) {
    replayAgain = true;
    return;
  }
  if (signedInAs === null) {
    return;
  }
  replaying = true;
  try {
    const db = await getDb();
    for (const item of pending) {
      if (item.failed || item.authorId !== signedInAs) {
        continue;
      }
      try {
        await perform(item.action);
        await dbDelete(db, item.id);
        pending = pending.filter((saved) => saved.id !== item.id);
        notify();
      } catch (error) {
        if (error instanceof ApiRequestError) {
          const failed = firstIssue(error);
          await dbPut(db, { ...item, failed });
          pending = pending.map((saved) =>
            saved.id === item.id ? { ...saved, failed } : saved,
          );
          notify();
          continue;
        }
        break;
      }
    }
  } finally {
    replaying = false;
    if (replayAgain) {
      replayAgain = false;
      void replay();
    }
  }
}

/** Drops a save the member no longer wants retried — only ever offered for
 * one the server has already refused; a merely pending one keeps no such
 * button, since it is still expected to land on its own. */
export async function discard(id: number): Promise<void> {
  const db = await getDb();
  await dbDelete(db, id);
  pending = pending.filter((saved) => saved.id !== id);
  notify();
}

if (typeof window !== "undefined" && typeof indexedDB !== "undefined") {
  // Reads what IndexedDB already has so the header's count is right on
  // load; replaying any of it waits for setCurrentMember — this runs
  // before AppLayout knows who, if anyone, is signed in.
  void loadPersisted();
  window.addEventListener("online", () => void replay());
}
