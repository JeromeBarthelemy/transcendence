import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { useCurrentUser } from "../app/useCurrentUser";
import { RequestError } from "../components/ApiErrors";
import { TeamHomePage } from "./TeamHomePage";

export function HomePage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const location = useLocation();
  // Set by the profile page once an account is gone, to the address its
  // confirmation went to: the session went with it, so this is where the
  // member lands.
  const accountDeleted = (location.state as { accountDeleted?: string } | null)
    ?.accountDeleted;

  if (currentUser.data) {
    return <TeamHomePage identity={currentUser.data} />;
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-5 py-14 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20 lg:py-20">
      <section aria-labelledby="home-title">
        {accountDeleted && (
          <p
            role="status"
            className="mb-8 rounded-2xl border border-success/30 bg-success-tint px-4 py-3 text-sm font-semibold text-success"
          >
            {t("personalData.deleted", { address: accountDeleted })}
          </p>
        )}
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-azure/20 bg-tint px-4 py-2 text-xs font-bold tracking-[0.14em] text-accent uppercase">
          <span aria-hidden="true" className="size-2 rounded-full bg-lagoon" />
          {t("home.eyebrow")}
        </p>
        <h1
          id="home-title"
          className="brand-title max-w-3xl text-[clamp(3.25rem,7vw,6.5rem)] leading-[0.98] tracking-[-0.055em] text-ink"
        >
          {t("home.title")}
        </h1>
        <p className="mt-7 max-w-xl text-lg leading-8 text-muted">
          {t("home.description")}
        </p>

        {currentUser.isPending ? (
          <p role="status" className="mt-9 text-sm text-muted">
            {t("auth.checkingSession")}
          </p>
        ) : (
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              to="/signup"
              className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-white shadow-button transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon"
            >
              {t("home.createAccount")}
            </Link>
            <Link
              to="/login"
              className="rounded-full border border-primary/25 px-6 py-3 text-sm font-bold text-ink transition hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon"
            >
              {t("home.alreadyMember")}
            </Link>
          </div>
        )}
        {currentUser.isError && <RequestError error={currentUser.error} />}
      </section>

      <aside className="relative overflow-hidden rounded-[2rem] bg-linear-145 from-ink via-primary via-45% to-azure p-8 text-white shadow-hero sm:p-10">
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-20 size-64 rounded-full border border-white/20"
        />
        <div
          aria-hidden="true"
          className="absolute -top-8 -right-8 size-64 rounded-full border border-white/10"
        />
        <p className="relative text-xs font-bold tracking-[0.22em] text-seafoam uppercase">
          {t("home.panelEyebrow")}
        </p>
        <h2 className="brand-title relative mt-16 max-w-sm text-4xl leading-tight tracking-[-0.035em] sm:text-5xl">
          {t("home.panelTitle")}
        </h2>
        <div className="relative mt-10 border-t border-white/20 pt-6">
          <p className="max-w-sm text-sm leading-7 text-ice">
            {t("home.panelDescription")}
          </p>
        </div>
      </aside>
    </main>
  );
}
