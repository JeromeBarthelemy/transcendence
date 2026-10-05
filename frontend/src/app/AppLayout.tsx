import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useNavigate } from "react-router-dom";

import { logOut } from "../api/auth";
import { ApiRequestError } from "../api/client";
import logo from "../assets/logo.webp";
import { RequestError } from "../components/ApiErrors";
import { Avatar } from "../components/Avatar";
import { currentUserQueryKey, useCurrentUser } from "./useCurrentUser";

export function AppLayout() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: async () => {
      try {
        await logOut();
      } catch (error) {
        // Another tab may already have ended the session. From the member's
        // point of view, the requested state has still been reached.
        const alreadyLoggedOut =
          error instanceof ApiRequestError &&
          error.status === 403 &&
          error
            .forField("detail")
            .some((issue) => issue.code === "not_authenticated");
        if (!alreadyLoggedOut) {
          throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.setQueryData(currentUserQueryKey, null);
      navigate("/", { replace: true });
    },
  });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[#004fc5]/10 bg-white/85 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link
            to="/"
            className="flex items-center gap-2 text-[#041894] no-underline sm:gap-3"
          >
            <span className="grid size-9 place-items-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#004fc5]/10 sm:size-11">
              <img
                src={logo}
                alt=""
                className="size-9 object-cover sm:size-11"
              />
            </span>
            <span className="brand-title text-xl tracking-[-0.035em] sm:text-2xl">
              {t("app.name")}
            </span>
          </Link>

          {currentUser.data && (
            // Beside the name on a phone, where the links get a row of
            // their own; after them on a wider screen.
            <div className="flex items-center gap-2 sm:order-last sm:gap-4">
              <Link
                to="/profile"
                aria-label={t("nav.profile", {
                  name: currentUser.data.display_name,
                })}
                className="flex items-center gap-2 rounded-full py-1 pr-1 pl-1 text-sm text-[#506784] transition hover:bg-[#eaf5ff] hover:text-[#041894] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c2d0] sm:pr-3"
              >
                <Avatar person={currentUser.data} />
                <span className="hidden sm:inline">
                  {currentUser.data.display_name}
                </span>
              </Link>
              <button
                type="button"
                className="grid size-9 place-items-center rounded-full border border-[#004fc5]/25 text-sm font-semibold text-[#041894] transition hover:bg-[#eaf5ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c2d0] disabled:opacity-60 sm:size-auto sm:px-4 sm:py-2"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <svg
                  aria-hidden="true"
                  className="size-4 sm:hidden"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                <span className="sr-only sm:not-sr-only">
                  {logout.isPending ? t("auth.loggingOut") : t("auth.logout")}
                </span>
              </button>
            </div>
          )}

          <nav
            aria-label={t("nav.main")}
            className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto sm:gap-4"
          >
            {currentUser.isPending ? (
              <span role="status" className="text-sm text-[#5c6f88]">
                {t("auth.checkingSession")}
              </span>
            ) : currentUser.data ? (
              <>
                <Link
                  to="/fieldbot"
                  className="rounded-full px-3 py-2 text-sm font-semibold text-[#041894] transition hover:bg-[#eaf5ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c2d0]"
                >
                  {t("nav.fieldbot")}
                </Link>
                {currentUser.data.is_club_admin && (
                  <>
                    <Link
                      to="/teams"
                      className="rounded-full px-3 py-2 text-sm font-semibold text-[#041894] transition hover:bg-[#eaf5ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c2d0]"
                    >
                      {t("nav.teams")}
                    </Link>
                    <Link
                      to="/users"
                      className="rounded-full px-3 py-2 text-sm font-semibold text-[#041894] transition hover:bg-[#eaf5ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c2d0]"
                    >
                      {t("nav.users")}
                    </Link>
                  </>
                )}
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-full px-3 py-2 text-sm font-semibold text-[#041894] transition hover:bg-[#eaf5ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c2d0]"
                >
                  {t("auth.login")}
                </Link>
                <Link
                  to="/signup"
                  className="rounded-full bg-[#004fc5] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0078dd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c2d0]"
                >
                  {t("auth.signup")}
                </Link>
              </>
            )}
          </nav>
        </div>
        {logout.isError && (
          <div className="mx-auto w-full max-w-6xl px-5 pb-3 sm:px-8">
            <RequestError error={logout.error} />
          </div>
        )}
      </header>

      <Outlet />

      <footer className="mt-auto border-t border-[#004fc5]/10 px-5 py-5 text-center text-xs text-[#5c6f88] sm:px-8">
        <p>{t("app.footer")}</p>
        <p className="mt-2 flex justify-center gap-4">
          <Link to="/privacy" className="hover:text-[#041894] hover:underline">
            {t("app.privacy")}
          </Link>
          <Link to="/terms" className="hover:text-[#041894] hover:underline">
            {t("app.terms")}
          </Link>
        </p>
      </footer>
    </div>
  );
}
