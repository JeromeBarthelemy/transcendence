import type { TeamSeasonSummary } from "../api/auth";

export const nameFormatter = new Intl.ListFormat("fr-FR", {
  style: "long",
  type: "conjunction",
});

const workdayDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function formatWorkdayDate(day: string) {
  return workdayDateFormatter.format(dayDate(day));
}

/** Calendar dates have no time zone; noon UTC keeps date arithmetic and
 * rendering independent of the browser's clock and daylight saving. */
export function dayDate(day: string) {
  return new Date(`${day}T12:00:00Z`);
}

const dayFormatters = {
  long: new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeZone: "UTC",
  }),
  medium: new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeZone: "UTC",
  }),
  short: new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }),
};

export function formatDay(
  day: string,
  style: keyof typeof dayFormatters = "long",
) {
  return dayFormatters[style].format(dayDate(day));
}

const weekdayFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  timeZone: "UTC",
});
const relativeFormatter = new Intl.RelativeTimeFormat("fr-FR", {
  numeric: "auto",
});

export function formatActivityDate(day: string, currentWorkday?: string) {
  if (!currentWorkday) {
    return formatDay(day);
  }
  const elapsedDays = Math.round(
    (dayDate(currentWorkday).getTime() - dayDate(day).getTime()) /
      (24 * 60 * 60 * 1000),
  );

  if (elapsedDays < 0) return formatDay(day);
  if (elapsedDays < 2) return relativeFormatter.format(-elapsedDays, "day");
  if (elapsedDays < 7) return weekdayFormatter.format(dayDate(day));
  if (elapsedDays < 28) {
    return relativeFormatter.format(-Math.floor(elapsedDays / 7), "week");
  }
  return formatDay(day);
}

export function teamLabel(teamSeason: TeamSeasonSummary) {
  return `${teamSeason.team.number} · ${teamSeason.team.name}`;
}

const noticeTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatNoticeTime(instant: string) {
  return noticeTimeFormatter.format(new Date(instant));
}
