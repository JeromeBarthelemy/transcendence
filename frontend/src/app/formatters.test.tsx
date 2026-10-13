import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import i18n from "../i18n";
import {
  createFormatters,
  formattingLocale,
  useFormatters,
} from "./formatters";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("fr");
});

it.each([
  [
    "fr",
    "lundi 5 octobre",
    "Lina et Tom",
    "12\u202f345,6",
    "1,5\u202fMo",
    "hier",
  ],
  ["en", "Monday 5 October", "Lina and Tom", "12,345.6", "1.5 MB", "yesterday"],
  ["es", "lunes, 5 de octubre", "Lina y Tom", "12.345,6", "1,5 MB", "ayer"],
])(
  "formats calendar dates, names, numbers and file sizes in %s",
  (language, day, names, number, size, yesterday) => {
    const formats = createFormatters(language);
    expect(formats.formatWorkdayDate("2026-10-05")).toBe(day);
    expect(formats.nameFormatter.format(["Lina", "Tom"])).toBe(names);
    expect(formats.formatNumber(12345.6)).toBe(number);
    expect(formats.formatFileSize(1.5 * 1024 ** 2)).toBe(size);
    expect(formats.formatActivityDate("2026-10-04", "2026-10-05")).toBe(
      yesterday,
    );
  },
);

it.each(["fr", "en", "es"])(
  "keeps the existing relative-date boundaries in %s",
  (language) => {
    const formats = createFormatters(language);
    const locale = formattingLocale(language);
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    expect(formats.formatActivityDate("2026-10-05", "2026-10-05")).toBe(
      relative.format(0, "day"),
    );
    expect(formats.formatActivityDate("2026-10-03", "2026-10-05")).toBe(
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        timeZone: "UTC",
      }).format(new Date("2026-10-03T12:00:00Z")),
    );
    expect(formats.formatActivityDate("2026-09-21", "2026-10-05")).toBe(
      relative.format(-2, "week"),
    );
    expect(formats.formatActivityDate("2026-09-01", "2026-10-05")).toBe(
      formats.formatDay("2026-09-01"),
    );
    expect(formats.formatActivityDate("2026-10-06", "2026-10-05")).toBe(
      formats.formatDay("2026-10-06"),
    );
    // The Paris DST change must not turn one calendar day into zero or two.
    expect(formats.formatActivityDate("2026-10-25", "2026-10-26")).toBe(
      relative.format(-1, "day"),
    );
  },
);

it.each(["fr", "en", "es"])(
  "keeps timestamps in the browser's time zone in %s",
  (language) => {
    const formats = createFormatters(language);
    const instant = new Date("2026-10-05T23:30:00Z");
    expect(formats.dateTimeFormatter.resolvedOptions().timeZone).toBe(
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(formats.formatNoticeTime(instant.toISOString())).toBe(
      new Intl.DateTimeFormat(formattingLocale(language), {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(instant),
    );
  },
);

it("resolves regional language variants and falls back to French", () => {
  expect(formattingLocale("EN-us")).toBe("en-GB");
  expect(formattingLocale("es-MX")).toBe("es-ES");
  expect(formattingLocale("unsupported")).toBe("fr-FR");
});

it("updates existing formatter consumers immediately when language changes", async () => {
  function Probe() {
    const { formatWorkdayDate, formatNumber, nameFormatter } = useFormatters();
    return (
      <output>
        {formatWorkdayDate("2026-10-05")} · {formatNumber(12345.6)} ·{" "}
        {nameFormatter.format(["Lina", "Tom"])}
      </output>
    );
  }
  render(<Probe />);
  expect(screen.getByRole("status").textContent).toContain("Lina et Tom");
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByRole("status").textContent).toBe(
    "Monday 5 October · 12,345.6 · Lina and Tom",
  );
  await act(() => i18n.changeLanguage("es"));
  expect(screen.getByRole("status").textContent).toBe(
    "lunes, 5 de octubre · 12.345,6 · Lina y Tom",
  );
});

it.each(["fr", "en", "es"])(
  "formats interpolated counts while retaining numeric plural selection in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    expect(i18n.t("users.count", { count: 12345 })).toContain(
      new Intl.NumberFormat(language).format(12345),
    );
    expect(i18n.t("users.count", { count: 1 })).not.toBe(
      i18n.t("users.count", { count: 2 }),
    );
    // Club team numbers and season years are identifiers, not quantities.
    expect(
      i18n.t("teamHome.teamTitle", { number: 1796, name: "Les Rouages" }),
    ).toContain("1796");
  },
);
