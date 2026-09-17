import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { getHealth } from "../api/health";

export function HomePage() {
  const { t } = useTranslation();
  const health = useQuery({
    queryKey: ["api", "health"],
    queryFn: getHealth,
  });

  const apiStatus = health.isSuccess
    ? t("api.connected")
    : health.isError
      ? t("api.unavailable")
      : t("api.checking");

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <section className="w-full max-w-3xl" aria-labelledby="page-title">
        <p className="mb-3 text-xs font-bold tracking-[0.18em] text-amber-800 uppercase">
          {t("app.eyebrow")}
        </p>
        <h1
          id="page-title"
          className="font-serif text-6xl leading-none tracking-[-0.055em] text-green-900 sm:text-8xl"
        >
          {t("app.name")}
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-stone-600">
          {t("app.description")}
        </p>
        <p className="mt-10 w-fit rounded-full border border-stone-300 bg-white/60 px-4 py-2 text-sm text-stone-700">
          {t("app.ready")}
        </p>
        <p className="mt-3 text-sm text-stone-600" role="status" aria-live="polite">
          {apiStatus}
        </p>
      </section>
    </main>
  );
}
