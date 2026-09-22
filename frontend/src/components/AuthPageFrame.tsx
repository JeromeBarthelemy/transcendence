import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

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
        <p className="text-xs font-bold tracking-[0.18em] text-[#0078dd] uppercase">
          {t("app.eyebrow")}
        </p>
        <h2 className="brand-title mt-5 max-w-sm text-4xl leading-tight tracking-[-0.045em] text-[#041894] sm:text-5xl">
          {t("auth.sideTitle")}
        </h2>
        <p className="mt-5 max-w-sm text-base leading-7 text-[#506784]">
          {t("auth.sideDescription")}
        </p>
      </aside>

      <section className="rounded-[1.75rem] border border-[#004fc5]/10 bg-white/90 p-6 shadow-[0_18px_55px_#004fc512] sm:p-9">
        <p className="text-xs font-bold tracking-[0.16em] text-[#0078dd] uppercase">
          {eyebrow}
        </p>
        <h1 className="brand-title mt-3 text-4xl leading-tight tracking-[-0.045em] text-[#041894] sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#506784]">
          {description}
        </p>
        <div className="mt-8">{children}</div>
      </section>
    </main>
  );
}
