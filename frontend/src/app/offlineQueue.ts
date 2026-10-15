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
export async function enqueue(action: PendingAction): Promise<void> {
  const db = await getDb();
  const createdAt = Date.now();
  const id = await dbAdd(db, { createdAt, action, failed: null });
  pending = [...pending, { id, createdAt, action, failed: null }];
  notify();
}

/** Wraps a save already attempted once: a refusal from the server (wrong
 * input, a conflict) is a real error and reaches the caller as it always
 * did, but a save that never reached the server at all is queued instead,
 * and the caller reads it as accepted. */
export async function trySave<T>(
  attempt: () => Promise<T>,
  action: PendingAction,
): Promise<T | { queued: true }> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw error;
    }
    await enqueue(action);
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

/** In order, oldest first: a later save may depend on an earlier one having
 * landed (two progress edits on the same entry, say). Stops at the first
 * save still refused for lack of network — still offline, or a blip — so
 * the rest stay queued for the next attempt rather than replaying out of
 * order. A save the server itself refuses is marked failed and skipped,
 * without blocking the ones after it. */
export async function replay(): Promise<void> {
  if (replaying) {
    return;
  }
  replaying = true;
  try {
    const db = await getDb();
    for (const item of pending) {
      if (item.failed) {
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
  void loadPersisted().then(() => void replay());
  window.addEventListener("online", () => void replay());
}
