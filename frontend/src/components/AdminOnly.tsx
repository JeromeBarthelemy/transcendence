import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";

import type { Identity } from "../api/auth";
import { useCurrentUser } from "../app/useCurrentUser";
import { RequestError } from "./ApiErrors";
import { Page } from "./Page";
import { Panel } from "./Panel";
import { Heading } from "./Typography";

/** A screen for club admins only. The server refuses everyone else anyway;
 * this only spares them a page of refusals. */
export function AdminOnly({
  children,
}: {
  children: (identity: Identity) => ReactNode;
}) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  if (currentUser.isPending) {
    return (
      <Page message>
        <p role="status" className="text-sm text-muted">
          {t("auth.checkingSession")}
        </p>
      </Page>
    );
  }
  if (currentUser.isError) {
    return (
      <Page message>
        <RequestError error={currentUser.error} />
      </Page>
    );
  }
  if (!currentUser.data) {
    return <Navigate to="/login" replace />;
  }
  if (!currentUser.data.is_club_admin) {
    return (
      <Page message>
        <Panel padding="xl">
          <Heading size="large" as="h1">
            {t("admin.forbiddenTitle")}
          </Heading>
          <p className="mt-3 max-w-xl leading-7 text-muted">
            {t("admin.forbiddenDescription")}
          </p>
        </Panel>
      </Page>
    );
  }
  return children(currentUser.data);
}
