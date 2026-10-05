import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import "../i18n";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("shows a French page inside the site's layout for an unknown address", async () => {
  // A lazy route opened first warns in the console unless the router has
  // something to show while it loads; the subject allows no console warning.
  const warn = vi.spyOn(console, "warn");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            detail: { code: "not_authenticated", message: "Non connecté." },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  const router = createMemoryRouter(routes, {
    initialEntries: ["/une-adresse-qui-n-existe-pas"],
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("heading", { level: 1, name: "Page introuvable" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("navigation", { name: "Navigation principale" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Retour à l'accueil" })
      .getAttribute("href"),
  ).toBe("/");
  expect(warn).not.toHaveBeenCalled();
});
