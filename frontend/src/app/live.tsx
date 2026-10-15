import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { notificationsQueryKey } from "../api/notifications";
import { Notice } from "../components/Notice";

// Waits between reconnections, the last one repeated: quick after a blip,
// patient when the network is gone for a while.
const RECONNECT_AFTER = [1000, 2000, 5000, 10_000];
// A socket dropping is only worth a notice once it stays down: a server
// restart is a blip. The browser saying it is offline is shown at once.
const OFFLINE_AFTER = 3000;
// The server forgets a socket's subscription after a day, without closing it:
// a fresh socket every hour bounds it.
const RENEW_AFTER = 60 * 60 * 1000;

export function liveUrl(
  location: { protocol: string; host: string } = window.location,
): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws/me/`;
}

/** Hears when anyone changes a board the member may read, and reloads it
 * through the API: a message only says what changed. Only the queries on
 * screen are fetched again; the others are simply marked stale. Each time it
 * connects, it reloads everything: before the first connection as after a
 * drop, it may have missed messages. Returns whether the member is offline. */
function useLive(): boolean {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Read by the socket's handler, which outlives every page.
  const shownPath = useRef(pathname);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    shownPath.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let offlineNotice: ReturnType<typeof setTimeout> | undefined;
    let renew: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    function clearNotice() {
      clearTimeout(offlineNotice);
      offlineNotice = undefined;
    }

    function connect() {
      clearTimeout(reconnect);
      const opened = new WebSocket(liveUrl());
      socket = opened;
      opened.onopen = () => {
        clearNotice();
        setOffline(false);
        queryClient.invalidateQueries({ queryKey: ["team-seasons"] });
        queryClient.invalidateQueries({ queryKey: ["work-items"] });
        queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
        attempts = 0;
        renew = setTimeout(() => {
          shut();
          connect();
        }, RENEW_AFTER);
      };
      opened.onmessage = (event) => {
        const data = JSON.parse(event.data) as
          | { presence: true; team_season: number }
          | { team_season: number; work_item: number | null; deleted: boolean };
        if ("presence" in data) {
          // A teammate's dot (#267) — the roster re-reads it; so does
          // whichever profile is open, whoever it is showing.
          queryClient.invalidateQueries({
            queryKey: ["team-seasons", data.team_season, "roster"],
          });
          queryClient.invalidateQueries({ queryKey: ["members", "profile"] });
          return;
        }
        const { team_season, work_item, deleted } = data;
        queryClient.invalidateQueries({
          queryKey: ["team-seasons", team_season],
        });
        // The change may concern this member: their bell reads them again.
        queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
        if (work_item === null) {
          return;
        }
        if (deleted) {
          // Read again, it would answer 404: its page is left, and it is
          // forgotten.
          if (shownPath.current === `/work-items/${work_item}`) {
            navigate(`/?team=${team_season}`, { replace: true });
          }
          queryClient.removeQueries({ queryKey: ["work-items", work_item] });
        } else {
          queryClient.invalidateQueries({
            queryKey: ["work-items", work_item],
          });
        }
      };
      opened.onclose = () => {
        socket = null;
        clearTimeout(renew);
        offlineNotice ??= setTimeout(() => setOffline(true), OFFLINE_AFTER);
        const wait =
          RECONNECT_AFTER[Math.min(attempts, RECONNECT_AFTER.length - 1)];
        attempts += 1;
        reconnect = setTimeout(connect, wait);
      };
    }

    /** Stops listening, for good or until the page comes back. A socket
     * still connecting is closed once open: Firefox reports closing it
     * sooner as an error in the console, and StrictMode does it on every
     * mount in development. */
    function shut() {
      clearTimeout(reconnect);
      clearTimeout(renew);
      clearNotice();
      const closing = socket;
      socket = null;
      if (closing === null) {
        return;
      }
      closing.onclose = null;
      closing.onmessage = null;
      if (closing.readyState === WebSocket.CONNECTING) {
        closing.onopen = () => closing.close();
      } else {
        closing.close();
      }
    }

    // The browser knows before the socket does: a phone off the Wi-Fi can
    // keep a socket "open" for a long while.
    function goneOffline() {
      clearNotice();
      setOffline(true);
    }

    // The socket that seemed open meanwhile may be dead, with what was sent
    // to it lost: a new one reloads the board on opening.
    function backOnline() {
      setOffline(false);
      shut();
      connect();
    }

    // Closed before the page goes, or Firefox reports the socket as
    // interrupted; opened again if the page comes back from the cache.
    function pageBack(event: PageTransitionEvent) {
      if (event.persisted) {
        connect();
      }
    }

    window.addEventListener("offline", goneOffline);
    window.addEventListener("online", backOnline);
    window.addEventListener("pagehide", shut);
    window.addEventListener("pageshow", pageBack);
    connect();
    return () => {
      window.removeEventListener("offline", goneOffline);
      window.removeEventListener("online", backOnline);
      window.removeEventListener("pagehide", shut);
      window.removeEventListener("pageshow", pageBack);
      shut();
    };
  }, [queryClient, navigate]);

  return offline;
}

/** Placed once under the header, for a signed-in member: keeps every screen
 * live, and says so when it cannot. */
export function LiveStatus() {
  const { t } = useTranslation();
  const offline = useLive();
  if (!offline) {
    return null;
  }
  return (
    <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
      <Notice as="p" role="status" tone="warning" padding="sm" className="mt-3">
        {t("live.offline")}
      </Notice>
    </div>
  );
}
