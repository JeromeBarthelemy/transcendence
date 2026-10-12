import { useId } from "react";
import { useTranslation } from "react-i18next";

import { focusRing } from "../app/menu";
import { supportedLanguages } from "../i18n";

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
        value={i18n.language}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
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
