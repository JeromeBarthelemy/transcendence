import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 sm:px-8">
      <h1 className="brand-title text-3xl tracking-[-0.035em] text-[#041894] sm:text-4xl">
        {t("notFound.title")}
      </h1>
      <p className="mt-3 max-w-xl leading-7 text-[#506784]">
        {t("notFound.description")}
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-xl bg-[#041894] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0078dd]"
      >
        {t("notFound.home")}
      </Link>
    </main>
  );
}
