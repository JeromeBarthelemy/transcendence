import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";

import type { Identity } from "../api/auth";
import { useCurrentUser } from "../app/useCurrentUser";
import { RequestError } from "./ApiErrors";
import { Panel } from "./Panel";

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
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 sm:px-8">
        <p role="status" className="text-sm text-muted">
          {t("auth.checkingSession")}
        </p>
      </main>
    );
  }
  if (currentUser.isError) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 sm:px-8">
        <RequestError error={currentUser.error} />
      </main>
    );
  }
  if (!currentUser.data) {
    return <Navigate to="/login" replace />;
  }
  if (!currentUser.data.is_club_admin) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 sm:px-8">
        <Panel padding="xl">
          <h1 className="brand-title text-3xl text-ink">
            {t("admin.forbiddenTitle")}
          </h1>
          <p className="mt-3 max-w-xl leading-7 text-muted">
            {t("admin.forbiddenDescription")}
          </p>
        </Panel>
      </main>
    );
  }
  return children(currentUser.data);
}
