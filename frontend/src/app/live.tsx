import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Waits between reconnections, the last one repeated: quick after a blip,
// patient when the network is gone for a while.
const RECONNECT_AFTER = [1000, 2000, 5000, 10_000];
// A socket dropping is only worth a notice once it stays down: a server
// restart is a blip. The browser saying it is offline is shown at once.
const OFFLINE_AFTER = 3000;

export function liveUrl(
  teamSeasonId: number,
  location: { protocol: string; host: string } = window.location,
): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws/team-seasons/${teamSeasonId}/`;
}

/** Hears when anyone changes the team season's board, and reloads what the
 * screen shows through the API: a message only says what changed. After a
 * drop, it reconnects and reloads everything, since it may have missed
 * messages meanwhile. Returns whether the screen is offline. */
function useLiveBoard(teamSeasonId: number): boolean {
  const queryClient = useQueryClient();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let offlineNotice: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let wasOpen = false;

    function clearNotice() {
      clearTimeout(offlineNotice);
      offlineNotice = undefined;
    }

    function connect() {
      clearTimeout(reconnect);
      const opened = new WebSocket(liveUrl(teamSeasonId));
      socket = opened;
      opened.onopen = () => {
        clearNotice();
        setOffline(false);
        if (wasOpen) {
          queryClient.invalidateQueries({
            queryKey: ["team-seasons", teamSeasonId],
          });
          queryClient.invalidateQueries({ queryKey: ["work-items"] });
        }
        wasOpen = true;
        attempts = 0;
      };
      opened.onmessage = (event) => {
        const { work_item } = JSON.parse(event.data) as {
          work_item: number | null;
        };
        queryClient.invalidateQueries({
          queryKey: ["team-seasons", teamSeasonId],
        });
        if (work_item !== null) {
          queryClient.invalidateQueries({
            queryKey: ["work-items", work_item],
          });
        }
      };
      opened.onclose = () => {
        socket = null;
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

    function backOnline() {
      clearNotice();
      setOffline(false);
      if (socket === null) {
        connect();
      }
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
  }, [teamSeasonId, queryClient]);

  return offline;
}

/** Placed on each screen of the board: keeps it live, and says so when it
 * cannot. */
export function LiveBoard({ teamSeasonId }: { teamSeasonId: number }) {
  const { t } = useTranslation();
  const offline = useLiveBoard(teamSeasonId);
  if (!offline) {
    return null;
  }
  return (
    <p
      role="status"
      className="mt-3 rounded-xl border border-warning/35 bg-warning-wash px-3 py-2 text-sm text-warning-ink"
    >
      {t("live.offline")}
    </p>
  );
}
