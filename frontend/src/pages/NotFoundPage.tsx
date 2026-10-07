import { useTranslation } from "react-i18next";
import { ButtonLink } from "../components/Button";

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 sm:px-8">
      <h1 className="brand-title text-3xl tracking-[-0.035em] text-ink sm:text-4xl">
        {t("notFound.title")}
      </h1>
      <p className="mt-3 max-w-xl leading-7 text-muted">
        {t("notFound.description")}
      </p>
      <ButtonLink to="/" variant="dark" className="mt-6">
        {t("notFound.home")}
      </ButtonLink>
    </main>
  );
}
