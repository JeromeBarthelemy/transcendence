import type { TFunction } from "i18next";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { focusRing, type OpenMenu, useMenu } from "./menu";
import {
  discard,
  type PendingAction,
  type PendingSave,
  usePendingSaves,
} from "./offlineQueue";

function describeAction(action: PendingAction, t: TFunction): string {
  switch (action.kind) {
    case "tick":
      return t("offlineQueue.kinds.tick", { title: action.title });
    case "leave":
      return t("offlineQueue.kinds.leave", { title: action.title });
    case "progress":
      return t("offlineQueue.kinds.progress", { title: action.title });
    case "work-item-note":
      return t("offlineQueue.kinds.workItemNote", { title: action.title });
    case "team-note":
      return t("offlineQueue.kinds.teamNote");
  }
}

function PendingLine({ save }: { save: PendingSave }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl px-3 py-2.5">
      <p className="text-sm font-semibold text-ink">
        {describeAction(save.action, t)}
      </p>
      {save.failed ? (
        <>
          <p className="mt-0.5 text-xs text-danger">{save.failed.message}</p>
          <button
            type="button"
            className={`mt-1 text-xs font-semibold text-muted underline hover:text-ink ${focusRing}`}
            onClick={() => void discard(save.id)}
          >
            {t("offlineQueue.discard")}
          </button>
        </>
      ) : (
        <p className="mt-0.5 text-xs text-muted">{t("offlineQueue.waiting")}</p>
      )}
    </div>
  );
}

function SyncIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7M21 5v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7M3 19v-5h5" />
    </svg>
  );
}

/** What #157 queued because a save could not reach the server, for this
 * member alone: IndexedDB belongs to the origin, not the account, so a
 * save queued under whoever used this computer before stays out of sight
 * (and unreplayed, offlineQueue.ts) until they are signed in again. Shown
 * only while at least one of this member's own is still waiting. */
export function OfflineQueueMenu({
  memberId,
  open,
  setOpen,
}: {
  memberId: number;
  open: OpenMenu;
  setOpen: (menu: OpenMenu) => void;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const menu = useMenu("offline", open, setOpen);
  const saves = usePendingSaves().filter((save) => save.authorId === memberId);

  if (saves.length === 0) {
    return null;
  }

  return (
    // Not positioned itself on a phone, same reasoning as the bell: it sits
    // too far left for a panel hanging from it to fit.
    <div ref={menu.rootRef} className="shrink-0 md:relative">
      <button
        ref={menu.buttonRef}
        type="button"
        aria-expanded={menu.isOpen}
        aria-controls={panelId}
        aria-label={t("offlineQueue.label", { count: saves.length })}
        className={`relative grid size-10 place-items-center rounded-full text-muted transition hover:bg-tint hover:text-ink ${focusRing}`}
        onClick={menu.toggle}
      >
        <SyncIcon />
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-accent px-1 text-center text-xs leading-5 font-bold text-white"
        >
          {saves.length > 9 ? "9+" : saves.length}
        </span>
      </button>
      {menu.isOpen && (
        <section
          id={panelId}
          aria-label={t("offlineQueue.title")}
          className="absolute inset-x-3 top-full z-30 mt-2 rounded-2xl border border-primary/10 bg-white p-2 shadow-panel md:inset-x-auto md:right-0 md:w-80"
        >
          <p className="px-3 pt-1.5 pb-2 text-xs text-muted">
            {t("offlineQueue.hint")}
          </p>
          <ul className="max-h-96 overflow-y-auto">
            {saves.map((save) => (
              <li key={save.id}>
                <PendingLine save={save} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
