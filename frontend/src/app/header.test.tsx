import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { routes } from "./router";
import "../i18n";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderAs(identity: object | null, path = "/privacy") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/auth/me/") {
        return identity ? json(identity) : json({}, 403);
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const paul = {
  display_name: "Paul",
  club_role: "mentor",
  is_club_admin: true,
  avatar: null,
  team_seasons: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("opens the account menu from the avatar, without a logout button in the bar", async () => {
  const user = userEvent.setup();
  const router = renderAs(paul);

  const account = await screen.findByRole("button", {
    name: "Menu du compte (Paul)",
  });
  expect(screen.queryByRole("button", { name: "Se déconnecter" })).toBeNull();
  expect(account.getAttribute("aria-expanded")).toBe("false");

  await user.click(account);
  expect(account.getAttribute("aria-expanded")).toBe("true");
  expect(
    screen.getByRole("button", { name: "Se déconnecter" }).className,
  ).toContain("text-red-800");

  await user.click(screen.getByRole("link", { name: "Voir mon profil" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/profile"));
  expect(screen.queryByRole("link", { name: "Voir mon profil" })).toBeNull();
});

it("puts the account menu away with Escape, focus back on its button", async () => {
  const user = userEvent.setup();
  renderAs(paul);

  const account = await screen.findByRole("button", {
    name: "Menu du compte (Paul)",
  });
  await user.click(account);
  await user.keyboard("{Escape}");

  expect(screen.queryByRole("link", { name: "Voir mon profil" })).toBeNull();
  expect(document.activeElement).toBe(account);
});

it("puts the account menu away on a click elsewhere", async () => {
  const user = userEvent.setup();
  renderAs(paul);

  await user.click(
    await screen.findByRole("button", { name: "Menu du compte (Paul)" }),
  );
  await user.click(screen.getByRole("heading", { level: 1 }));

  expect(screen.queryByRole("link", { name: "Voir mon profil" })).toBeNull();
});

it("lists the navigation in the phone's menu, one menu open at a time", async () => {
  const user = userEvent.setup();
  const router = renderAs(paul);

  const hamburger = await screen.findByRole("button", { name: "Menu" });
  await user.click(
    screen.getByRole("button", { name: "Menu du compte (Paul)" }),
  );
  await user.click(hamburger);

  // Opening one menu puts the other away.
  expect(screen.queryByRole("link", { name: "Voir mon profil" })).toBeNull();
  const panel = document.getElementById(
    hamburger.getAttribute("aria-controls") ?? "",
  );
  if (!panel) throw new Error("The menu panel is missing");
  expect(
    within(panel)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Fieldbot", "Équipes", "Membres"]);

  await user.click(within(panel).getByRole("link", { name: "Équipes" }));
  // The screen is loaded on demand: the address changes once it is in.
  await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
  expect(hamburger.getAttribute("aria-expanded")).toBe("false");
});

it("offers signing in and signing up in the phone's menu when signed out", async () => {
  const user = userEvent.setup();
  renderAs(null);

  const hamburger = await screen.findByRole("button", { name: "Menu" });
  expect(screen.queryByRole("button", { name: /Menu du compte/ })).toBeNull();
  await user.click(hamburger);

  const panel = document.getElementById(
    hamburger.getAttribute("aria-controls") ?? "",
  );
  if (!panel) throw new Error("The menu panel is missing");
  expect(
    within(panel)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Se connecter", "S'inscrire"]);
});
