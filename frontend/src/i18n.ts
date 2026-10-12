import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";

export const supportedLanguages = ["fr", "en", "es"] as const;
export type Language = (typeof supportedLanguages)[number];
export const languageStorageKey = "fieldnotes.language";

function isLanguage(value: string | null): value is Language {
  return supportedLanguages.some((language) => language === value);
}

export function getInitialLanguage(): Language {
  try {
    const saved = localStorage.getItem(languageStorageKey);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage can be disabled; choosing a language must still work.
  }

  const preferred = navigator.languages.length
    ? navigator.languages
    : [navigator.language];
  for (const locale of preferred) {
    const language = locale.toLowerCase().split("-")[0];
    if (isLanguage(language)) return language;
  }
  return "fr";
}

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
  try {
    localStorage.setItem(languageStorageKey, language);
  } catch {
    // Keep the selection for this visit when persistence is unavailable.
  }
});

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
    es: { translation: es },
  },
  supportedLngs: [...supportedLanguages],
  load: "languageOnly",
  lng: getInitialLanguage(),
  fallbackLng: "fr",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
