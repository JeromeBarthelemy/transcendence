import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  getNotifications,
  markNotificationsRead,
  type Notice,
  notificationsQueryKey,
} from "../api/notifications";
import { RequestError } from "../components/ApiErrors";
import { formatNoticeTime } from "./formatters";
import { focusRing, type OpenMenu, useMenu } from "./menu";

/** The bell in the header: what changed on the board for this member, read
 * again whenever the page comes back to the front and on every live message
 * (live.tsx). */
export function NotificationsMenu({
  open,
  setOpen,
}: {
  open: OpenMenu;
  setOpen: (menu: OpenMenu) => void;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const queryClient = useQueryClient();
  const menu = useMenu("notifications", open, setOpen);
  const notifications = useQuery({
    queryKey: notificationsQueryKey,
    queryFn: getNotifications,
    // Stale at once, so that coming back to the page reads them again.
    staleTime: 0,
  });
  // Shown as new while the panel stays open, though marked read on opening.
  const [fresh, setFresh] = useState<number[]>([]);
  const markRead = useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationsQueryKey }),
  });

  const unread = notifications.data?.unread ?? 0;
  const items = notifications.data?.items ?? [];

  function toggle() {
    if (!menu.isOpen) {
      const unreadIds = items.filter((item) => !item.read).map((i) => i.id);
      setFresh(unreadIds);
      if (unread > 0) {
        markRead.mutate();
      }
    }
    menu.toggle();
  }

  return (
    // On a phone, not positioned itself: the panel spans the header, since
    // the bell sits too far left for a panel hanging from it to fit.
    <div ref={menu.rootRef} className="shrink-0 md:relative">
      <button
        ref={menu.buttonRef}
        type="button"
        aria-expanded={menu.isOpen}
        aria-controls={panelId}
        aria-label={
          unread === 0
            ? t("notifications.labelNone")
            : t("notifications.label", { count: unread })
        }
        className={`relative grid size-10 place-items-center rounded-full text-muted transition hover:bg-tint hover:text-ink ${focusRing}`}
        onClick={toggle}
      >
        <Bell />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-accent px-1 text-center text-xs leading-5 font-bold text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {menu.isOpen && (
        <section
          id={panelId}
          aria-label={t("notifications.title")}
          className="absolute inset-x-3 top-full z-30 mt-2 rounded-2xl border border-primary/10 bg-white p-2 shadow-panel md:inset-x-auto md:right-0 md:w-80"
        >
          {notifications.isError && !notifications.data ? (
            // Not "nothing new": the member would take it for an answer.
            <div className="px-3 pb-2.5">
              <RequestError error={notifications.error} />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted">
              {t("notifications.empty")}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <NoticeLine
                    notice={item}
                    isNew={fresh.includes(item.id)}
                    onNavigate={() => setOpen(null)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function NoticeLine({
  notice,
  isNew,
  onNavigate,
}: {
  notice: Notice;
  isNew: boolean;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const content = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          {t(`notifications.verbs.${notice.verb}`, {
            actor: notice.actor.display_name,
            entry: notice.entry
              ? t(`notifications.entries.${notice.entry.type}`)
              : "",
          })}
        </span>
        {isNew && (
          <span className="shrink-0 rounded-full bg-tint px-2 text-xs font-bold text-accent">
            {t("notifications.new")}
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-xs text-muted">
        {notice.work_item?.title ?? t("notifications.team")} ·{" "}
        {formatNoticeTime(notice.created_at)}
      </span>
    </>
  );
  const lineClass = "block rounded-xl px-3 py-2.5";
  // Only a work item that still exists has a page to open.
  const workItemId = notice.work_item?.id;
  return workItemId ? (
    <Link
      to={`/work-items/${workItemId}`}
      className={`${lineClass} no-underline hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-lagoon`}
      onClick={onNavigate}
    >
      {content}
    </Link>
  ) : (
    <div className={lineClass}>{content}</div>
  );
}

function Bell() {
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
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
