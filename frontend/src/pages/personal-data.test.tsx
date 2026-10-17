import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import i18n, { languageStorageKey, supportedLanguages } from "../i18n";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setDocumentCookie(value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = value;
}

function refusal(code: string) {
  return json({ detail: { code, message: "Message du backend" } }, 400);
}

const marie = {
  display_name: "Marie Durand",
  club_role: "student",
  is_club_admin: false,
  avatar: null,
  team_seasons: [],
};

type Handler = (
  path: string,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;

/** /me answers with Marie until her account is deleted, then with nobody. */
function stubApi(handler: Handler) {
  let deleted = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/auth/me/" && init?.method === "DELETE") {
      const response = await handler(path, init);
      if (response?.ok) {
        deleted = true;
      }
      if (response) return response;
    }
    if (path === "/api/auth/me/" && (init?.method ?? "GET") === "GET") {
      return json(deleted ? null : marie);
    }
    const response = await handler(path, init);
    if (!response) {
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderProfile() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: ["/profile"] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function section() {
  return screen.findByRole("region", { name: "Données personnelles" });
}

beforeEach(() => {
  setDocumentCookie("csrftoken=test-token; path=/");
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
  localStorage.removeItem(languageStorageKey);
  await i18n.changeLanguage("fr");
});

it("sends the data export by e-mail and says so", async () => {
  const user = userEvent.setup();
  const fetchMock = stubApi((path, init) =>
    path === "/api/auth/me/export/" && init?.method === "POST"
      ? json({ sent_to: "parent.marie@club.fr" }, 202)
      : undefined,
  );

  renderProfile();
  const data = await section();
  await user.click(within(data).getByRole("button", { name: "Exporter" }));

  expect((await within(data).findByRole("status")).textContent).toBe(
    "C'est envoyé à parent.marie@club.fr : la copie de vos données arrive par courriel.",
  );
  const [, init] =
    fetchMock.mock.calls.find(([path]) => path === "/api/auth/me/export/") ??
    [];
  expect(new Headers(init?.headers).get("X-CSRFToken")).toBe("test-token");
  expect(JSON.parse(String(init?.body))).toEqual({ language: "fr" });
});

it("shows why an export cannot be sent", async () => {
  const user = userEvent.setup();
  stubApi((path) =>
    path === "/api/auth/me/export/" ? refusal("no_contact_email") : undefined,
  );

  renderProfile();
  const data = await section();
  await user.click(within(data).getByRole("button", { name: "Exporter" }));

  expect((await within(data).findByRole("alert")).textContent).toBe(
    "Aucune adresse de contact n'est enregistrée pour ce compte : impossible d'envoyer la confirmation.",
  );
});

it("asks for the password before deleting, and keeps the account on a wrong one", async () => {
  const user = userEvent.setup();
  stubApi((path, init) =>
    path === "/api/auth/me/" && init?.method === "DELETE"
      ? refusal("wrong_password")
      : undefined,
  );

  renderProfile();
  const data = await section();
  await user.click(within(data).getByRole("button", { name: "Supprimer" }));

  const confirm = within(data).getByRole("button", {
    name: "Supprimer définitivement",
  });
  expect(confirm).toHaveProperty("disabled", true);
  const password = within(data).getByLabelText("Mot de passe");
  await user.type(password, "pas-le-bon");
  await user.click(confirm);

  expect((await within(data).findByRole("alert")).textContent).toBe(
    "Mot de passe incorrect : le compte n'a pas été supprimé.",
  );
  expect(password.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("heading", { name: "Marie Durand" })).toBeTruthy();

  await user.click(within(data).getByRole("button", { name: "Annuler" }));
  expect(within(data).queryByLabelText("Mot de passe")).toBeNull();
});

it("deletes the account with its password and lands on the home page", async () => {
  const user = userEvent.setup();
  const fetchMock = stubApi((path, init) =>
    path === "/api/auth/me/" && init?.method === "DELETE"
      ? json({ sent_to: "parent.marie@club.fr" })
      : undefined,
  );

  const router = renderProfile();
  const data = await section();
  await user.click(within(data).getByRole("button", { name: "Supprimer" }));
  await user.type(
    within(data).getByLabelText("Mot de passe"),
    "rouage-demo-2026",
  );
  await user.click(
    within(data).getByRole("button", { name: "Supprimer définitivement" }),
  );

  expect(
    (await screen.findByText(/Votre compte a été supprimé/)).textContent,
  ).toBe(
    "Votre compte a été supprimé. Une confirmation a été envoyée à parent.marie@club.fr.",
  );
  expect(router.state.location.pathname).toBe("/");
  expect(screen.queryByText("Marie Durand")).toBeNull();

  const [, init] =
    fetchMock.mock.calls.find(
      ([path, options]) =>
        path === "/api/auth/me/" && options?.method === "DELETE",
    ) ?? [];
  expect(JSON.parse(String(init?.body))).toEqual({
    password: "rouage-demo-2026",
    language: "fr",
  });
  expect(new Headers(init?.headers).get("X-CSRFToken")).toBe("test-token");
});

it.each(supportedLanguages)(
  "requests the export in the selected interface language (%s)",
  async (language) => {
    const user = userEvent.setup();
    const fetchMock = stubApi((path) =>
      path === "/api/auth/me/export/"
        ? json({ sent_to: "parent.marie@club.fr" }, 202)
        : undefined,
    );
    renderProfile();
    await section();

    await user.selectOptions(
      screen.getByRole("combobox", { name: i18n.t("language.label") }),
      language,
    );
    const data = screen.getByRole("region", {
      name: i18n.t("personalData.title"),
    });
    await user.click(
      within(data).getByRole("button", { name: i18n.t("personalData.export") }),
    );

    expect(await within(data).findByRole("status")).toBeTruthy();
    const [, init] =
      fetchMock.mock.calls.find(([path]) => path === "/api/auth/me/export/") ??
      [];
    expect(JSON.parse(String(init?.body))).toEqual({ language });
  },
);

it.each(supportedLanguages)(
  "uses the language chosen just before deletion without losing the password (%s)",
  async (language) => {
    const user = userEvent.setup();
    const fetchMock = stubApi((path, init) =>
      path === "/api/auth/me/" && init?.method === "DELETE"
        ? json({ sent_to: "parent.marie@club.fr" })
        : undefined,
    );
    const router = renderProfile();
    const data = await section();
    await user.click(within(data).getByRole("button", { name: "Supprimer" }));
    await user.type(
      within(data).getByLabelText("Mot de passe"),
      "rouage-demo-2026",
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: i18n.t("language.label") }),
      language,
    );
    await user.click(
      within(data).getByRole("button", {
        name: i18n.t("personalData.confirmDelete"),
      }),
    );
    await screen.findByText(
      i18n.t("personalData.deleted", { address: "parent.marie@club.fr" }),
    );

    const [, init] =
      fetchMock.mock.calls.find(
        ([path, options]) =>
          path === "/api/auth/me/" && options?.method === "DELETE",
      ) ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      password: "rouage-demo-2026",
      language,
    });
    expect(router.state.location.pathname).toBe("/");
  },
);
