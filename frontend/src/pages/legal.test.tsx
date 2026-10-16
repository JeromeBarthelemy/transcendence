import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import i18n from "../i18n";

// The subject rejects the project without these pages, reachable from every
// page: "Missing or inadequate Privacy Policy/Terms of Service pages will
// result in project rejection."

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const anonymous = () =>
  json(
    { detail: { code: "not_authenticated", message: "Non connecté." } },
    403,
  );

const signedIn = () =>
  json({
    id: 1,
    display_name: "Lina",
    club_role: "student",
    is_club_admin: false,
    avatar: null,
    team_seasons: [],
  });

function renderAt(path: string, me: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/auth/me/") return me();
      if (url === "/api/health/") return json({ status: "ok" });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

async function footerLinks() {
  const footer = await screen.findByRole("contentinfo");
  return within(footer)
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);
}

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("fr");
  localStorage.clear();
});

it.each([
  ["en", "Privacy policy", "Your rights", "Terms of use", "privacy policy"],
  [
    "es",
    "Política de privacidad",
    "Tus derechos",
    "Condiciones de uso",
    "política de privacidad",
  ],
])(
  "translates legal pages and retains real links and contact details in %s",
  async (language, privacyTitle, rights, termsTitle, policyLink) => {
    await i18n.changeLanguage(language);
    renderAt("/privacy", anonymous);
    await screen.findByRole("heading", { level: 1, name: privacyTitle });
    expect(screen.getByRole("heading", { name: rights })).toBeTruthy();
    const main = screen.getByRole("main");
    expect(
      within(main).getAllByText("robotique.civ@gmail.com").length,
    ).toBeGreaterThan(0);
    const terms = within(main).getByRole("link");
    expect(terms.getAttribute("href")).toBe("/terms");
    cleanup();
    renderAt("/terms", anonymous);
    await screen.findByRole("heading", { level: 1, name: termsTitle });
    expect(
      within(screen.getByRole("main"))
        .getByRole("link", { name: policyLink })
        .getAttribute("href"),
    ).toBe("/privacy");
  },
);

it("links both pages from the footer before signing in", async () => {
  renderAt("/", anonymous);

  expect(await footerLinks()).toEqual([
    ["Confidentialité", "/privacy"],
    ["Conditions d'utilisation", "/terms"],
  ]);
});

it("links both pages from the footer once signed in", async () => {
  renderAt("/", signedIn);

  expect(await screen.findByText("Lina")).toBeTruthy();
  expect(await footerLinks()).toEqual([
    ["Confidentialité", "/privacy"],
    ["Conditions d'utilisation", "/terms"],
  ]);
});

it("shows the privacy policy without a session", async () => {
  renderAt("/privacy", anonymous);

  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: "Politique de confidentialité",
    }),
  ).toBeTruthy();
  for (const section of [
    "Qui est responsable de vos données",
    "Ce que nous enregistrons, et pourquoi",
    "L'assistant sur le règlement",
    "Combien de temps nous gardons vos données",
    "Vos droits",
  ]) {
    expect(
      screen.getByRole("heading", { level: 2, name: section }),
    ).toBeTruthy();
  }
});

it("shows the terms of service without a session, pointing to the policy", async () => {
  renderAt("/terms", anonymous);

  const main = await screen.findByRole("main");
  expect(
    within(main).getByRole("heading", {
      level: 1,
      name: "Conditions d'utilisation",
    }),
  ).toBeTruthy();
  expect(
    within(main)
      .getByRole("link", { name: "politique de confidentialité" })
      .getAttribute("href"),
  ).toBe("/privacy");
});
