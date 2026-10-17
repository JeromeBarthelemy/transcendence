import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ActivityCalendar } from "./ActivityCalendar";
import { Button } from "./Button";

/** The existing activity calendar, disclosed from the session header. On small
 * screens its panel spans the header actions rather than overflowing its button. */
export function SessionCalendarPicker({
  teamSeasonId,
  day,
}: {
  teamSeasonId: number;
  day: string;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    function dismissOutside(event: PointerEvent | FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="sm:relative">
      <Button
        ref={buttonRef}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
      >
        {t(isOpen ? "daySummary.closeCalendar" : "daySummary.chooseDate")}
      </Button>
      {isOpen && (
        <div
          id={panelId}
          className="absolute inset-x-0 top-full z-20 mt-2 sm:inset-x-auto sm:right-0 sm:w-96"
        >
          <ActivityCalendar
            teamSeasonId={teamSeasonId}
            day={day}
            className="max-h-[min(36rem,70dvh)] overflow-y-auto shadow-panel"
            onSelect={() => {
              setIsOpen(false);
              buttonRef.current?.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}
