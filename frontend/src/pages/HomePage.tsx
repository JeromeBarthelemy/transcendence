import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { useCurrentUser } from "../app/useCurrentUser";
import { RequestError } from "../components/ApiErrors";
import { ButtonLink } from "../components/Button";
import { Notice } from "../components/Notice";
import { Eyebrow } from "../components/Typography";
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
    <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16 lg:py-16">
      <section aria-labelledby="home-title">
        {accountDeleted && (
          <Notice as="p" role="status" tone="success" className="mb-8">
            {t("personalData.deleted", { address: accountDeleted })}
          </Notice>
        )}
        <Eyebrow className="mb-5 border-l-2 border-primary pl-3">
          {t("home.eyebrow")}
        </Eyebrow>
        <h1
          id="home-title"
          className="brand-title max-w-3xl text-[clamp(2.5rem,5vw,4.5rem)] leading-[1.1] tracking-[-0.045em] text-ink"
        >
          {t("home.title")}
        </h1>
        <p className="mt-6 max-w-lg text-base leading-8 text-muted sm:text-lg">
          {t("home.description")}
        </p>

        {currentUser.isPending ? (
          <p role="status" className="mt-9 text-sm text-muted">
            {t("auth.checkingSession")}
          </p>
        ) : (
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink to="/signup" variant="primary" size="lg">
              {t("home.createAccount")}
            </ButtonLink>
            <ButtonLink to="/login" size="lg">
              {t("home.alreadyMember")}
            </ButtonLink>
          </div>
        )}
        {currentUser.isError && <RequestError error={currentUser.error} />}
      </section>

      <aside className="border-l-4 border-ink bg-primary px-7 py-8 text-white shadow-hero sm:px-9 sm:py-10">
        <div className="flex items-center justify-between gap-4 border-b border-white/30 pb-5 text-xs font-semibold tracking-wide">
          <span>{t("app.name")}</span>
          <span aria-hidden="true">—</span>
        </div>
        <p className="mt-10 text-xs font-semibold tracking-[0.14em] text-ice uppercase">
          {t("home.panelEyebrow")}
        </p>
        <h2 className="brand-title mt-4 max-w-sm text-3xl leading-tight tracking-[-0.03em] sm:text-4xl">
          {t("home.panelTitle")}
        </h2>
        <div className="mt-12 border-t border-white/30 pt-5">
          <p className="max-w-sm text-sm leading-7 text-ice">
            {t("home.panelDescription")}
          </p>
        </div>
      </aside>
    </main>
  );
}
