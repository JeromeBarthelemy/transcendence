import { useSyncExternalStore } from "react";

/** Chrome, Edge and Android fire this before showing their own install UI,
 * which `preventDefault()` here replaces with a button of our own; Safari
 * and Firefox never fire it, so that button simply never appears there —
 * exactly what the browser allows, nothing assumed. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  // Covers every way the member ends up installed: our own button, the
  // browser's own menu entry, or an install already done in a past visit.
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the browser has offered to install the app, and a way to trigger
 * that same offer from a button of our own. */
export function useInstallPrompt(): {
  canInstall: boolean;
  install: () => void;
} {
  const canInstall = useSyncExternalStore(subscribe, () => deferred !== null);
  return {
    canInstall,
    install: () => {
      // The browser only honours one prompt() per offer: cleared at once, so
      // the button is never shown again for an offer already spent, whatever
      // the member chooses in the browser's own dialog.
      const event = deferred;
      if (!event) {
        return;
      }
      deferred = null;
      notify();
      void event.prompt();
    },
  };
}
