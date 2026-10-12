import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const LOCALES = { fr: "fr-FR", en: "en-GB", es: "es-ES" } as const;

/** Presentation only: API dates, identifiers and workday calculations stay
 * independent of the chosen language. English uses British regional formats. */
export function formattingLocale(language: string) {
  const base = language.toLowerCase().split("-")[0];
  return LOCALES[base as keyof typeof LOCALES] ?? LOCALES.fr;
}

export function createFormatters(language: string) {
  const locale = formattingLocale(language);
  const numberFormatter = new Intl.NumberFormat(locale);
  const sizeFormatter = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  });
  const nameFormatter = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  });
  const nameCollator = new Intl.Collator(locale, { sensitivity: "base" });

  // A workday is a calendar date, not an instant. UTC prevents the browser's
  // time zone from moving it to the preceding or following day.
  const fullDayFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const mediumDayFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const shortDayFormatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const workdayDateFormatter = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const monthFormatter = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const weekdayFormatter = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  });
  const relativeFormatter = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
  });

  // Actual timestamps keep the existing browser-local time zone.
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "long" });
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
  });
  const noteTimeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const noticeTimeFormatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const dayDate = (day: string) => new Date(`${day}T12:00:00Z`);
  const formatNumber = (value: number) => numberFormatter.format(value);
  const formatDay = (day: string) => fullDayFormatter.format(dayDate(day));

  function formatActivityDate(day: string, currentWorkday?: string) {
    if (!currentWorkday) return formatDay(day);
    const elapsedDays = Math.round(
      (dayDate(currentWorkday).getTime() - dayDate(day).getTime()) / 86_400_000,
    );
    if (elapsedDays < 0) return formatDay(day);
    if (elapsedDays < 2) return relativeFormatter.format(-elapsedDays, "day");
    if (elapsedDays < 7) return weekdayFormatter.format(dayDate(day));
    if (elapsedDays < 28) {
      return relativeFormatter.format(-Math.floor(elapsedDays / 7), "week");
    }
    return formatDay(day);
  }

  return {
    locale,
    nameFormatter,
    nameCollator,
    dateFormatter,
    dateTimeFormatter,
    noteTimeFormatter,
    monthFormatter,
    formatNumber,
    formatDay,
    formatActivityDate,
    formatMediumDay: (day: string) => mediumDayFormatter.format(dayDate(day)),
    formatShortDay: (day: string) => shortDayFormatter.format(dayDate(day)),
    formatWorkdayDate: (day: string) =>
      workdayDateFormatter.format(dayDate(day)),
    formatNoticeTime: (instant: string) =>
      noticeTimeFormatter.format(new Date(instant)),
    // Preserve the upload UI's existing binary divisor and rounding.
    formatFileSize: (bytes: number) => sizeFormatter.format(bytes / 1024 ** 2),
    formatChartValue: (value: unknown) =>
      typeof value === "number" ? formatNumber(value) : String(value ?? ""),
  };
}

/** Subscribes every consumer to language changes; no formatter stays frozen
 * in the language used when a module was first imported. */
export function useFormatters() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  return useMemo(() => createFormatters(language), [language]);
}
