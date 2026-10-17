import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "./Panel";
import { Eyebrow, Heading } from "./Typography";

/** The sign-up and log-in pages: the form beside the club's own words. */
export function AuthPageFrame({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:py-20">
      <aside className="lg:sticky lg:top-12">
        <Eyebrow tracking="wider">{t("app.eyebrow")}</Eyebrow>
        <Heading size="auth" as="h2" className="mt-5 max-w-sm">
          {t("auth.sideTitle")}
        </Heading>
        <p className="mt-5 max-w-sm text-base leading-7 text-muted">
          {t("auth.sideDescription")}
        </p>
      </aside>

      <Panel as="section" variant="auth">
        <Eyebrow tracking="wide">{eyebrow}</Eyebrow>
        <Heading size="auth" className="mt-3">
          {title}
        </Heading>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
          {description}
        </p>
        <div className="mt-8">{children}</div>
      </Panel>
    </main>
  );
}
