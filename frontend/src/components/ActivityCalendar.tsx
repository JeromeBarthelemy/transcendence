import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { getActivityCalendar } from "../api/workdays";
import { useFormatters } from "../app/formatters";
import { RequestError } from "./ApiErrors";
import { Button } from "./Button";
import { Panel } from "./Panel";
import { Heading } from "./Typography";

function adjacentMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The selected day lives in the URL; browsing months does not change it.
 * The parent keys this component by day to reset the month after navigation. */
export function ActivityCalendar({
  teamSeasonId,
  day,
  className = "",
  onSelect,
}: {
  teamSeasonId: number;
  day: string;
  className?: string;
  onSelect?: (day: string) => void;
}) {
  const { t } = useTranslation();
  const { monthFormatter, formatWorkdayDate, formatNumber } = useFormatters();
  const [month, setMonth] = useState(day.slice(0, 7));
  const calendar = useQuery({
    queryKey: ["team-seasons", teamSeasonId, "calendar", month],
    queryFn: () => getActivityCalendar(teamSeasonId, month),
    // The summary already reads this month to identify today's workday.
    // Reuse its failure when opening the picker; retry stays an explicit action.
    retryOnMount: false,
  });
  const first = new Date(`${month}-01T12:00:00Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const offset = (first.getUTCDay() + 6) % 7;
  const dates = Array.from(
    { length: last.getUTCDate() },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
  const activity = new Map(calendar.data?.days.map((item) => [item.day, item]));
  const weekdays = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ] as const;

  return (
    <Panel
      as="section"
      aria-labelledby="activity-calendar-title"
      className={className}
    >
      <Heading as="h2" size="small" id="activity-calendar-title">
        {t("calendar.title")}
      </Heading>
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button
          size="sm"
          disabled={month <= "2000-01"}
          aria-label={t("calendar.previousMonth")}
          onClick={() => setMonth(adjacentMonth(month, -1))}
        >
          <span aria-hidden="true">◂</span>
        </Button>
        <h3 aria-live="polite" className="text-sm font-semibold text-ink">
          {monthFormatter.format(first)}
        </h3>
        <Button
          size="sm"
          disabled={month >= "2099-12"}
          aria-label={t("calendar.nextMonth")}
          onClick={() => setMonth(adjacentMonth(month, 1))}
        >
          <span aria-hidden="true">▸</span>
        </Button>
      </div>

      {calendar.isPending ? (
        <p role="status" className="mt-4 text-sm text-muted">
          {t("calendar.loading")}
        </p>
      ) : calendar.isError ? (
        <div className="mt-4">
          <RequestError error={calendar.error} />
          <Button
            size="sm"
            className="mt-2"
            onClick={() => void calendar.refetch()}
          >
            {t("calendar.retry")}
          </Button>
        </div>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="mt-4 grid grid-cols-7 text-center text-xs text-muted"
          >
            {weekdays.map((weekday) => (
              <span key={weekday}>{t(`calendar.weekdays.${weekday}`)}</span>
            ))}
          </div>
          <ol
            aria-label={t("calendar.days")}
            className="mt-2 grid grid-cols-7 gap-1"
          >
            {weekdays.slice(0, offset).map((weekday) => (
              <li key={weekday} aria-hidden="true" />
            ))}
            {dates.map((date, index) => {
              const totals = activity.get(date);
              const hasActivity = Boolean(totals);
              const isSelected = date === day;
              const isToday = date === calendar.data.today;
              const activityLabel = totals
                ? [
                    t("calendar.progress", { count: totals.progress }),
                    t("calendar.notes", { count: totals.notes }),
                    t("calendar.decisions", { count: totals.decisions }),
                  ].join(", ")
                : t("calendar.noActivity");
              const label = [
                formatWorkdayDate(date),
                isToday && t("daySummary.today"),
                isSelected && t("calendar.selected"),
                activityLabel,
              ]
                .filter(Boolean)
                .join(", ");
              return (
                <li key={date}>
                  <Link
                    to={`/team-seasons/${teamSeasonId}/days/${date}`}
                    onClick={() => onSelect?.(date)}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={label}
                    title={label}
                    className={`relative flex h-11 w-full items-center justify-center rounded-xl border text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon ${isSelected ? "border-accent bg-accent text-white hover:bg-primary" : "border-primary/20 bg-white text-ink hover:bg-tint"} ${isToday ? "ring-2 ring-mint-deep ring-inset" : ""}`}
                  >
                    {formatNumber(index + 1)}
                    {hasActivity && (
                      <span
                        aria-hidden="true"
                        className={`absolute bottom-1 size-1.5 rounded-full ${isSelected ? "bg-white" : "bg-accent"}`}
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
            <li className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-accent"
              />
              {t("calendar.withActivity")}
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="size-3 rounded bg-accent" />
              {t("calendar.selected")}
            </li>
            <li className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-3 rounded ring-2 ring-mint-deep ring-inset"
              />
              {t("daySummary.today")}
            </li>
          </ul>
          {calendar.data.days.length === 0 && (
            <p className="mt-3 text-sm text-muted">{t("calendar.empty")}</p>
          )}
        </>
      )}
    </Panel>
  );
}
