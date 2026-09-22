import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useCurrentUser } from "../app/useCurrentUser";

export function HomePage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-5 py-14 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20 lg:py-20">
      <section aria-labelledby="home-title">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#009edf]/20 bg-[#eaf8ff] px-4 py-2 text-xs font-bold tracking-[0.14em] text-[#0078dd] uppercase">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-[#00c2d0]"
          />
          {t("home.eyebrow")}
        </p>
        <h1
          id="home-title"
          className="brand-title max-w-3xl text-[clamp(3.25rem,7vw,6.5rem)] leading-[0.98] tracking-[-0.055em] text-[#041894]"
        >
          {t("home.title")}
        </h1>
        <p className="mt-7 max-w-xl text-lg leading-8 text-[#506784]">
          {t("home.description")}
        </p>

        {currentUser.isPending ? (
          <p role="status" className="mt-9 text-sm text-[#506784]">
            {t("auth.checkingSession")}
          </p>
        ) : currentUser.data ? (
          <div className="mt-9 rounded-2xl border border-[#009edf]/20 bg-white/80 p-5 shadow-sm">
            <p className="text-xs font-bold tracking-[0.14em] text-[#0078dd] uppercase">
              {t("home.signedInLabel")}
            </p>
            <p className="brand-title mt-2 text-2xl text-[#041894]">
              {t("home.welcome", { name: currentUser.data.display_name })}
            </p>
            <p className="mt-2 text-sm text-[#506784]">
              {t("home.signedInDescription")}
            </p>
          </div>
        ) : (
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              to="/signup"
              className="rounded-full bg-[#004fc5] px-6 py-3 text-sm font-bold text-white shadow-[0_8px_22px_#004fc530] transition hover:bg-[#0078dd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c2d0]"
            >
              {t("home.createAccount")}
            </Link>
            <Link
              to="/login"
              className="rounded-full border border-[#004fc5]/25 px-6 py-3 text-sm font-bold text-[#041894] transition hover:bg-[#eaf5ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c2d0]"
            >
              {t("home.alreadyMember")}
            </Link>
          </div>
        )}
        {currentUser.isError && (
          <p role="alert" className="mt-4 text-sm text-red-800">
            {t("errors.network")}
          </p>
        )}
      </section>

      <aside className="relative overflow-hidden rounded-[2rem] bg-[linear-gradient(145deg,#041894_0%,#004fc5_45%,#009edf_100%)] p-8 text-white shadow-[0_22px_70px_#004fc528] sm:p-10">
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-20 size-64 rounded-full border border-white/20"
        />
        <div
          aria-hidden="true"
          className="absolute -top-8 -right-8 size-64 rounded-full border border-white/10"
        />
        <p className="relative text-xs font-bold tracking-[0.22em] text-[#a8f4e7] uppercase">
          {t("home.panelEyebrow")}
        </p>
        <h2 className="brand-title relative mt-16 max-w-sm text-4xl leading-tight tracking-[-0.035em] sm:text-5xl">
          {t("home.panelTitle")}
        </h2>
        <div className="relative mt-10 border-t border-white/20 pt-6">
          <p className="max-w-sm text-sm leading-7 text-[#d9f7ff]">
            {t("home.panelDescription")}
          </p>
        </div>
      </aside>
    </main>
  );
}
