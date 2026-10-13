import { afterEach, beforeEach, expect, it, vi } from "vitest";

import i18n, { getInitialLanguage, languageStorageKey } from "./i18n";

beforeEach(async () => {
  await i18n.changeLanguage("fr");
  localStorage.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("fr");
  localStorage.clear();
});

it("prefers the saved selection over the browser language", () => {
  localStorage.setItem(languageStorageKey, "es");
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  expect(getInitialLanguage()).toBe("es");
});

it.each([
  [["en-US"], "en"],
  [["es-MX"], "es"],
  [["fr-CA"], "fr"],
  [["de-DE", "es-ES", "en-GB"], "es"],
  [["EN-gb"], "en"],
  [["de-DE", "ja-JP"], "fr"],
])(
  "detects the first supported browser preference: %j",
  (preferences, expected) => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(preferences);
    expect(getInitialLanguage()).toBe(expected);
  },
);

it("uses navigator.language when the preference list is empty", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue([]);
  vi.spyOn(navigator, "language", "get").mockReturnValue("es-AR");
  expect(getInitialLanguage()).toBe("es");
});

it("ignores unsupported saved values", () => {
  localStorage.setItem(languageStorageKey, "not-a-language");
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
  expect(getInitialLanguage()).toBe("en");
});

it("still detects a browser language when reading storage is denied", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage denied", "SecurityError");
  });
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["es-ES"]);
  expect(getInitialLanguage()).toBe("es");
});

it("does not save a detected browser preference during initialization", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  const save = vi.spyOn(Storage.prototype, "setItem");
  vi.resetModules();
  const { default: initialized, getInitialLanguage: detect } = await import(
    "./i18n"
  );

  expect(initialized.language).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  expect(save).not.toHaveBeenCalled();
  expect(localStorage.getItem(languageStorageKey)).toBeNull();

  vi.spyOn(navigator, "languages", "get").mockReturnValue(["es-ES"]);
  expect(detect()).toBe("es");
});

it("restores the saved language when the application initializes again", async () => {
  localStorage.setItem(languageStorageKey, "es");
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  vi.resetModules();
  const { default: restarted } = await import("./i18n");
  expect(restarted.language).toBe("es");
  expect(document.documentElement.lang).toBe("es");
  expect(restarted.t("language.label")).toBe("Idioma");
});

it("updates the document and translations without persisting programmatic changes", async () => {
  const save = vi.spyOn(Storage.prototype, "setItem");
  await i18n.changeLanguage("en");
  expect(document.documentElement.lang).toBe("en");
  expect(i18n.t("language.label")).toBe("Language");
  expect(i18n.t("home.title")).toBe("Every step forward deserves a record.");
  expect(save).not.toHaveBeenCalled();
  expect(localStorage.getItem(languageStorageKey)).toBeNull();
});

it.each([
  ["fr", 0, "0 avancée"],
  ["fr", 2, "2 avancées"],
  ["en", 0, "0 progress entries"],
  ["en", 1, "1 progress entry"],
  ["es", 1, "1 avance"],
  ["es", 1000000, "1000000 avances"],
])(
  "uses the plural rules for %s with count %i",
  async (language, count, expected) => {
    await i18n.changeLanguage(language);
    expect(i18n.t("workItem.progressCount", { count })).toBe(expected);
  },
);
