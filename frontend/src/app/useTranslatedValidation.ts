import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/** Schema validation stores sentences in form state. Refresh those sentences
 * on a language change without resetting values or validating untouched forms. */
export function useTranslatedValidation(
  hasErrors: boolean,
  revalidate: () => Promise<boolean>,
) {
  const { i18n } = useTranslation();
  const previousLanguage = useRef(i18n.language);

  useEffect(() => {
    if (previousLanguage.current === i18n.language) return;
    previousLanguage.current = i18n.language;
    if (hasErrors) void revalidate();
  }, [hasErrors, i18n.language, revalidate]);
}
