import { useEffect, useRef } from "react";

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon";

export type OpenMenu = "account" | "admin" | "nav" | "notifications" | null;

/** A button that shows a panel, and every way to put it away again: Escape
 * (focus back on the button), a click anywhere else, or a new page. */
export function useMenu(
  name: Exclude<OpenMenu, null>,
  open: OpenMenu,
  setOpen: (menu: OpenMenu) => void,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isOpen = open === name;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(null);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, setOpen]);

  return {
    rootRef,
    buttonRef,
    isOpen,
    toggle: () => setOpen(isOpen ? null : name),
  };
}
