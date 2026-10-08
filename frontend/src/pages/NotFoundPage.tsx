import { useTranslation } from "react-i18next";
import { ButtonLink } from "../components/Button";
import { Page } from "../components/Page";
import { Heading } from "../components/Typography";

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <Page width="3xl" message>
      <Heading size="page">{t("notFound.title")}</Heading>
      <p className="mt-3 max-w-xl leading-7 text-muted">
        {t("notFound.description")}
      </p>
      <ButtonLink to="/" variant="dark" className="mt-6">
        {t("notFound.home")}
      </ButtonLink>
    </Page>
  );
}
