import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import type { Identity } from "../api/auth";
import { routes } from "../app/router";
import i18n, { getInitialLanguage, languageStorageKey } from "../i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";

function renderAt(path: string, identity: Identity | null = null) {
  let signedIn = identity;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/auth/me/") {
        // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
        document.cookie = "csrftoken=language-test; path=/";
        return Response.json(signedIn);
      }
      if (url === "/api/notifications/") {
        return Response.json({ items: [], unread: 0 });
      }
      if (url === "/api/auth/logout/") {
        signedIn = null;
        return new Response(null, { status: 204 });
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

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await i18n.changeLanguage("fr");
  localStorage.clear();
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = "csrftoken=; Max-Age=0; path=/";
});

it("offers all languages in a keyboard-focusable native select while signed out", async () => {
  const user = userEvent.setup();
  renderAt("/login");
  const select = await screen.findByRole<HTMLSelectElement>("combobox", {
    name: "Langue",
  });
  expect(select.tagName).toBe("SELECT");
  expect(localStorage.getItem(languageStorageKey)).toBeNull();
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["Français", "English", "Español"]);
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(select);

  for (const [language, label] of [
    ["en", "Language"],
    ["es", "Idioma"],
    ["fr", "Langue"],
  ]) {
    await user.selectOptions(select, language);
    expect(screen.getByRole("combobox", { name: label })).toBe(select);
    expect(document.documentElement.lang).toBe(language);
    expect(localStorage.getItem(languageStorageKey)).toBe(language);
  }
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["es-ES"]);
  expect(getInitialLanguage()).toBe("fr");
});

it.each([
  ["/login", "E-mail ou nom d'affichage"],
  ["/signup", "Prénom"],
])(
  "keeps the route and unsaved form values when switching on %s",
  async (path, fieldLabel) => {
    const user = userEvent.setup();
    const router = renderAt(path);
    const field = await screen.findByLabelText<HTMLInputElement>(fieldLabel);
    await user.type(field, "Mon brouillon");
    const password = screen.getByLabelText<HTMLInputElement>("Mot de passe", {
      exact: true,
    });
    await user.type(password, "secret-not-submitted");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Langue" }),
      "en",
    );
    expect(router.state.location.pathname).toBe(path);
    const translatedLabel =
      path === "/login" ? "Email or display name" : "First name";
    expect(screen.getByLabelText(translatedLabel)).toBe(field);
    expect(field.value).toBe("Mon brouillon");
    expect(password.value).toBe("secret-not-submitted");
    expect(
      screen.getAllByRole("link", { name: "Log in" }).length,
    ).toBeGreaterThan(0);
  },
);

it("keeps the selected language after signing out", async () => {
  const user = userEvent.setup();
  const router = renderAt("/privacy", {
    display_name: "Paul",
    club_role: "mentor",
    is_club_admin: false,
    avatar: null,
    team_seasons: [],
  });
  await screen.findByRole("button", { name: "Menu du compte (Paul)" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Langue" }),
    "es",
  );
  await user.click(
    screen.getByRole("button", { name: "Menú de la cuenta (Paul)" }),
  );
  await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(
    screen.queryByRole("button", { name: "Menú de la cuenta (Paul)" }),
  ).toBeNull();
  expect(
    (screen.getByRole("combobox", { name: "Idioma" }) as HTMLSelectElement)
      .value,
  ).toBe("es");
  expect(document.documentElement.lang).toBe("es");
  expect(localStorage.getItem(languageStorageKey)).toBe("es");
});

it("shows the resolved option for a regional language without saving it", async () => {
  render(<LanguageSwitcher />);

  await act(() => i18n.changeLanguage("es-MX"));

  expect(i18n.resolvedLanguage).toBe("es");
  expect(
    (screen.getByRole("combobox", { name: "Idioma" }) as HTMLSelectElement)
      .value,
  ).toBe("es");
  expect(localStorage.getItem(languageStorageKey)).toBeNull();
});

it("still changes the language when saving the selection is denied", async () => {
  const user = userEvent.setup();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage full", "QuotaExceededError");
  });
  render(<LanguageSwitcher />);

  await user.selectOptions(
    screen.getByRole("combobox", { name: "Langue" }),
    "es",
  );

  expect(i18n.language).toBe("es");
  expect(document.documentElement.lang).toBe("es");
  expect(
    (screen.getByRole("combobox", { name: "Idioma" }) as HTMLSelectElement)
      .value,
  ).toBe("es");
  expect(localStorage.getItem(languageStorageKey)).toBeNull();
});

it.each([
  ["/login", "Se connecter"],
  ["/signup", "Créer mon compte"],
])(
  "updates existing validation errors without clearing inputs on %s",
  async (path, submit) => {
    const user = userEvent.setup();
    renderAt(path);
    await screen.findByLabelText("Mot de passe", { exact: true });
    if (path === "/signup") {
      await user.type(screen.getByLabelText("Nom d'affichage"), "Lina");
    }
    await user.click(screen.getByRole("button", { name: submit }));
    expect(
      (await screen.findAllByText("Ce champ est obligatoire.")).length,
    ).toBeGreaterThan(0);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Langue" }),
      "es",
    );
    await waitFor(() =>
      expect(screen.queryAllByText("Ce champ est obligatoire.")).toHaveLength(
        0,
      ),
    );
    expect(
      screen.getAllByText("Este campo es obligatorio.").length,
    ).toBeGreaterThan(0);
    if (path === "/signup") {
      expect(
        screen.getByLabelText<HTMLInputElement>("Nombre para mostrar").value,
      ).toBe("Lina");
    }
  },
);
