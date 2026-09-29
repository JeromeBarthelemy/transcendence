import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";

import type { Identity } from "../api/auth";
import { useCurrentUser } from "../app/useCurrentUser";
import { RequestError } from "./ApiErrors";

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
        <p role="status" className="text-sm text-[#506784]">
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
        <div className="rounded-3xl border border-[#004fc5]/15 bg-white p-8 shadow-sm">
          <h1 className="brand-title text-3xl text-[#041894]">
            {t("admin.forbiddenTitle")}
          </h1>
          <p className="mt-3 max-w-xl leading-7 text-[#506784]">
            {t("admin.forbiddenDescription")}
          </p>
        </div>
      </main>
    );
  }
  return children(currentUser.data);
}
