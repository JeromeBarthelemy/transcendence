import { useId } from "react";
import { useTranslation } from "react-i18next";

import { focusRing } from "../app/menu";
import { languageStorageKey, supportedLanguages } from "../i18n";

const languageNames = { fr: "Français", en: "English", es: "Español" };

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const id = useId();

  return (
    <div className="shrink-0">
      <label htmlFor={id} className="sr-only">
        {t("language.label")}
      </label>
      <select
        id={id}
        value={i18n.resolvedLanguage ?? i18n.language}
        onChange={(event) => {
          const language = event.currentTarget.value;
          try {
            localStorage.setItem(languageStorageKey, language);
          } catch {
            // Keep the selection for this visit when persistence is unavailable.
          }
          void i18n.changeLanguage(language);
        }}
        className={`w-24 cursor-pointer rounded-full border border-primary/15 bg-white px-2 py-2 text-sm text-ink md:w-auto ${focusRing}`}
      >
        {supportedLanguages.map((language) => (
          <option key={language} value={language} lang={language}>
            {languageNames[language]}
          </option>
        ))}
      </select>
    </div>
  );
}
