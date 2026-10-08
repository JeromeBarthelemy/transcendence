import { Link, type To } from "react-router-dom";

import { IconLabel, type IconName } from "./Icon";

export interface SectionTab {
  key: string;
  label: string;
  to: To;
  icon?: IconName;
}

/** A screen's sections, side by side: each is a link, so a section has an
 * address of its own and the back button returns to it. */
export function SectionTabs({
  label,
  tabs,
  current,
  className = "",
}: {
  /** What the group is, for a screen reader: it is a navigation. */
  label: string;
  tabs: SectionTab[];
  current: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={`grid gap-1 rounded-2xl border border-primary/12 bg-white p-1 shadow-sm ${className}`}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => {
        const isCurrent = tab.key === current;
        return (
          <Link
            key={tab.key}
            to={tab.to}
            aria-current={isCurrent ? "page" : undefined}
            className={`flex justify-center rounded-xl px-2 py-2.5 text-sm font-semibold whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon sm:px-4 ${
              isCurrent
                ? "bg-primary text-white shadow-button"
                : "text-ink hover:bg-tint"
            }`}
          >
            {tab.icon ? (
              <IconLabel icon={tab.icon} before>
                {tab.label}
              </IconLabel>
            ) : (
              tab.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}
