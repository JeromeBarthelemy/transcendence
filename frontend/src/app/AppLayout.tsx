import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import type { Identity } from "../api/auth";
import { logOut } from "../api/auth";
import { ApiRequestError } from "../api/client";
import logo from "../assets/logo.webp";
import { RequestError } from "../components/ApiErrors";
import { Avatar } from "../components/Avatar";
import { currentUserQueryKey, useCurrentUser } from "./useCurrentUser";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon";
const navLinkClass = `rounded-full px-3 py-2 text-sm font-semibold whitespace-nowrap text-ink transition hover:bg-tint ${focusRing}`;
const panelLinkClass =
  "block rounded-xl px-3 py-2.5 text-sm font-semibold text-ink no-underline hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-lagoon";

type OpenMenu = "account" | "admin" | "nav" | null;

/** A button that shows a panel, and every way to put it away again: Escape
 * (focus back on the button), a click anywhere else, or a new page. */
function useMenu(
  name: Exclude<OpenMenu, null>,
  open: OpenMenu,
  setOpen: (menu: OpenMenu) => void,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isOpen = open === name;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(null);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, setOpen]);

  return {
    rootRef,
    buttonRef,
    isOpen,
    toggle: () => setOpen(isOpen ? null : name),
  };
}

function AdminLinks({
  linkClass,
  onNavigate,
}: {
  linkClass: string;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Link to="/teams" className={linkClass} onClick={onNavigate}>
        {t("nav.teams")}
      </Link>
      <Link to="/users" className={linkClass} onClick={onNavigate}>
        {t("nav.users")}
      </Link>
    </>
  );
}

/** The administration screens, gathered behind one red entry: they act on
 * the whole club, not on a team's work. */
function AdminMenu({
  open,
  setOpen,
}: {
  open: OpenMenu;
  setOpen: (menu: OpenMenu) => void;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const menu = useMenu("admin", open, setOpen);

  return (
    <div ref={menu.rootRef} className="relative">
      <button
        ref={menu.buttonRef}
        type="button"
        aria-expanded={menu.isOpen}
        aria-controls={panelId}
        className={`flex items-center gap-1 rounded-full py-2 pr-2 pl-3 text-sm font-semibold whitespace-nowrap text-red-800 transition hover:bg-red-50 ${focusRing}`}
        onClick={menu.toggle}
      >
        {t("nav.admin")}
        <Chevron open={menu.isOpen} />
      </button>
      {menu.isOpen && (
        <div
          id={panelId}
          className="absolute top-full right-0 z-30 mt-2 w-48 rounded-2xl border border-primary/10 bg-white p-2 shadow-panel"
        >
          <AdminLinks
            linkClass={panelLinkClass}
            onNavigate={() => setOpen(null)}
          />
        </div>
      )}
    </div>
  );
}

function NavLinks({
  identity,
  linkClass,
  onNavigate,
  admin,
}: {
  identity: Identity | null;
  linkClass: string;
  onNavigate?: () => void;
  /** What a club admin gets for the administration screens. */
  admin: ReactNode;
}) {
  const { t } = useTranslation();
  if (!identity) {
    return (
      <>
        <Link to="/login" className={linkClass} onClick={onNavigate}>
          {t("auth.login")}
        </Link>
        <Link to="/signup" className={linkClass} onClick={onNavigate}>
          {t("auth.signup")}
        </Link>
      </>
    );
  }
  return (
    <>
      <Link to="/fieldbot" className={linkClass} onClick={onNavigate}>
        {t("nav.fieldbot")}
      </Link>
      {identity.is_club_admin && admin}
    </>
  );
}

function AccountMenu({
  identity,
  open,
  setOpen,
  logout,
}: {
  identity: Identity;
  open: OpenMenu;
  setOpen: (menu: OpenMenu) => void;
  logout: { isPending: boolean; mutate: () => void };
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const menu = useMenu("account", open, setOpen);

  return (
    <div ref={menu.rootRef} className="relative shrink-0">
      <button
        ref={menu.buttonRef}
        type="button"
        aria-expanded={menu.isOpen}
        aria-controls={panelId}
        aria-label={t("nav.account", { name: identity.display_name })}
        className={`flex items-center gap-2 rounded-full p-1 text-sm text-muted transition hover:bg-tint hover:text-ink lg:pr-3 ${focusRing}`}
        onClick={menu.toggle}
      >
        <Avatar person={identity} />
        <span className="hidden max-w-40 truncate lg:inline">
          {identity.display_name}
        </span>
        <Chevron open={menu.isOpen} />
      </button>
      {menu.isOpen && (
        <div
          id={panelId}
          className="absolute top-full right-0 z-30 mt-2 w-56 rounded-2xl border border-primary/10 bg-white p-2 shadow-panel"
        >
          <p className="truncate px-3 pt-1 pb-2 text-xs text-muted">
            {identity.display_name}
          </p>
          <Link
            to="/profile"
            className={panelLinkClass}
            onClick={() => setOpen(null)}
          >
            {t("nav.viewProfile")}
          </Link>
          <button
            type="button"
            className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-lagoon disabled:opacity-60"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {logout.isPending ? t("auth.loggingOut") : t("auth.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`hidden size-4 transition-transform md:block ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** The phone's menu: the same links as the desktop's row, stacked in a
 * panel under the header. */
function MobileMenu({
  identity,
  open,
  setOpen,
}: {
  identity: Identity | null;
  open: OpenMenu;
  setOpen: (menu: OpenMenu) => void;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const menu = useMenu("nav", open, setOpen);

  return (
    // Not positioned itself, so the panel spans the whole header.
    <div ref={menu.rootRef} className="shrink-0 md:hidden">
      <button
        ref={menu.buttonRef}
        type="button"
        aria-expanded={menu.isOpen}
        aria-controls={panelId}
        aria-label={t("nav.menu")}
        className={`grid size-10 place-items-center rounded-full text-ink transition hover:bg-tint ${focusRing}`}
        onClick={menu.toggle}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          {menu.isOpen ? (
            <path d="M6 6l12 12M18 6 6 18" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>
      {menu.isOpen && (
        <nav
          id={panelId}
          aria-label={t("nav.main")}
          className="absolute inset-x-0 top-full z-30 border-b border-primary/10 bg-white px-5 py-3 shadow-panel"
        >
          <NavLinks
            identity={identity}
            linkClass={panelLinkClass}
            onNavigate={() => setOpen(null)}
            admin={
              <div>
                <p className="mt-2 border-t border-primary/10 px-3 pt-3 pb-1 text-xs font-bold tracking-[0.12em] text-red-800 uppercase">
                  {t("nav.admin")}
                </p>
                <div className="pl-3">
                  <AdminLinks
                    linkClass={panelLinkClass}
                    onNavigate={() => setOpen(null)}
                  />
                </div>
              </div>
            }
          />
        </nav>
      )}
    </div>
  );
}

function HeaderEnd({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 md:gap-4">
      {children}
    </div>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState<OpenMenu>(null);
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
      setOpen(null);
      queryClient.setQueryData(currentUserQueryKey, null);
      navigate("/", { replace: true });
    },
  });

  // A new page closes whichever menu led to it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path is the trigger, not a value read.
  useEffect(() => {
    setOpen(null);
  }, [location.pathname]);

  const identity = currentUser.data ?? null;

  return (
    // A page that scrolls inside itself (Fieldbot's conversation) gets a
    // layout exactly the window's height, footer included; every other page
    // grows with its content.
    <div className="flex min-h-screen flex-col has-[.fieldbot-page]:h-dvh">
      <header className="relative border-b border-primary/10 bg-white/85 backdrop-blur-sm">
        {/* One row at every width: what does not fit goes in the menu. */}
        <div className="mx-auto flex w-full max-w-6xl flex-nowrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2 text-ink no-underline sm:gap-3"
          >
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-primary/10 sm:size-11">
              <img
                src={logo}
                alt=""
                className="size-9 object-cover sm:size-11"
              />
            </span>
            <span className="brand-title truncate text-xl tracking-[-0.035em] sm:text-2xl">
              {t("app.name")}
            </span>
          </Link>

          <HeaderEnd>
            <nav
              aria-label={t("nav.main")}
              className="hidden items-center gap-2 md:flex"
            >
              {!currentUser.isPending && (
                <NavLinks
                  identity={identity}
                  linkClass={navLinkClass}
                  admin={<AdminMenu open={open} setOpen={setOpen} />}
                />
              )}
            </nav>
            {currentUser.isPending ? (
              <span role="status" className="truncate text-sm text-muted">
                {t("auth.checkingSession")}
              </span>
            ) : (
              <>
                {identity && (
                  <AccountMenu
                    identity={identity}
                    open={open}
                    setOpen={setOpen}
                    logout={logout}
                  />
                )}
                <MobileMenu identity={identity} open={open} setOpen={setOpen} />
              </>
            )}
          </HeaderEnd>
        </div>
        {logout.isError && (
          <div className="mx-auto w-full max-w-6xl px-5 pb-3 sm:px-8">
            <RequestError error={logout.error} />
          </div>
        )}
      </header>

      <Outlet />

      <footer className="mt-auto border-t border-primary/10 px-5 py-5 text-center text-xs text-muted sm:px-8">
        <p>{t("app.footer")}</p>
        <p className="mt-2 flex justify-center gap-4">
          <Link to="/privacy" className="hover:text-ink hover:underline">
            {t("app.privacy")}
          </Link>
          <Link to="/terms" className="hover:text-ink hover:underline">
            {t("app.terms")}
          </Link>
        </p>
      </footer>
    </div>
  );
}
