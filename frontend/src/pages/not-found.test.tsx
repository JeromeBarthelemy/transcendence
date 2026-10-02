import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import "../i18n";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows a French page inside the site's layout for an unknown address", async () => {
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
});
