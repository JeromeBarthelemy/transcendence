import {
  isCancelledError,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import "../i18n";

const marie = {
  first_name: "Marie",
  last_name: "Dubois",
  birth_date: "2009-06-08",
  display_name: "Marie",
  email: "",
  password: "rouage-bleu-2026",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderAt(path: string, queryClient = newQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return queryClient;
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

/** What a previous account left behind on a shared laptop's tab: a team's
 * board and day, and an admin's member list with its addresses. */
const PREVIOUS_ACCOUNT_KEYS = [
  ["team-seasons", 7, "work-items"],
  ["team-seasons", 7, "days", "today"],
  ["users", "list"],
];

function previousAccountCache() {
  const queryClient = newQueryClient();
  for (const key of PREVIOUS_ACCOUNT_KEYS) {
    queryClient.setQueryData(key, [{ email: "paul@club.fr" }]);
  }
  return queryClient;
}

function cached(queryClient: QueryClient) {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => [query.queryKey, query.state.data]);
}

const marieIdentity = {
  display_name: "Marie",
  club_role: "student",
  is_club_admin: false,
  avatar: null,
  team_seasons: [],
};

function issue(code: string, message = "Message du backend") {
  return { code, message };
}

function setDocumentCookie(value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = value;
}

async function fillSignup() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Prénom"), marie.first_name);
  await user.type(
    screen.getByLabelText("Nom", { exact: true }),
    marie.last_name,
  );
  fireEvent.change(screen.getByLabelText("Date de naissance"), {
    target: { value: marie.birth_date },
  });
  await user.type(screen.getByLabelText("Nom d'affichage"), marie.display_name);
  await user.type(
    screen.getByLabelText("Mot de passe", { exact: true }),
    marie.password,
  );
  await user.type(
    screen.getByLabelText("Confirmer le mot de passe"),
    marie.password,
  );
  return user;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
});

it("creates an account without email and recommends the display name", async () => {
  const fetchMock = vi.fn(async (path: string, options?: RequestInit) => {
    if (path === "/api/auth/me/") {
      setDocumentCookie("csrftoken=first-token; path=/");
      return json(null, 200);
    }
    if (path === "/api/auth/signup/") {
      expect(options?.headers).toMatchObject({ "X-CSRFToken": "first-token" });
      expect(JSON.parse(String(options?.body))).toEqual(marie);
      return json(
        { email: "marie.dubois@rouages.invalid", display_name: "Marie" },
        201,
      );
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/signup");

  const user = await fillSignup();
  await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

  expect(
    await screen.findByText(
      "Connectez-vous avec votre nom d'affichage « Marie » et votre mot de passe.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText("marie.dubois@rouages.invalid")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("shows a real email as an alternative after sign-up", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      setDocumentCookie("csrftoken=first-token; path=/");
      return json(null, 200);
    }
    if (path === "/api/auth/signup/") {
      return json({ email: "marie@example.org", display_name: "Marie" }, 201);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/signup");

  const user = await fillSignup();
  await user.type(
    screen.getByLabelText("Adresse e-mail (facultative)"),
    "marie@example.org",
  );
  await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

  expect(
    await screen.findByText(
      "Vous pouvez aussi utiliser votre adresse marie@example.org.",
    ),
  ).toBeTruthy();
});

it("shows a backend email refusal under the email field", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      setDocumentCookie("csrftoken=first-token; path=/");
      return json(null, 200);
    }
    if (path === "/api/auth/signup/") {
      return json({ email: [issue("email_taken")] }, 400);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/signup");

  const user = await fillSignup();
  await user.type(
    screen.getByLabelText("Adresse e-mail (facultative)"),
    "marie@example.org",
  );
  await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

  expect(
    await screen.findByText("Cette adresse est déjà utilisée."),
  ).toBeTruthy();
  expect(
    screen
      .getByLabelText("Adresse e-mail (facultative)")
      .getAttribute("aria-invalid"),
  ).toBe("true");
});

it("explains in French that the names of former members are reserved", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      setDocumentCookie("csrftoken=first-token; path=/");
      return json(null, 200);
    }
    if (path === "/api/auth/signup/") {
      return json({ display_name: [issue("display_name_reserved")] }, 400);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/signup");

  const user = await fillSignup();
  await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

  expect(
    await screen.findByText(
      "Ce nom est réservé aux comptes des anciens membres.",
    ),
  ).toBeTruthy();
});

it("shows an unknown error when a refusal has no API body", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      setDocumentCookie("csrftoken=first-token; path=/");
      return json(null, 200);
    }
    if (path === "/api/auth/signup/") {
      return new Response("<h1>CSRF verification failed</h1>", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/signup");

  const user = await fillSignup();
  await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

  expect(
    await screen.findByText("Une erreur inattendue est survenue."),
  ).toBeTruthy();
});

it("stops mismatched passwords before sending an account request", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      setDocumentCookie("csrftoken=first-token; path=/");
      return json(null, 200);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/signup");

  const user = await fillSignup();
  const confirmation = screen.getByLabelText("Confirmer le mot de passe");
  await user.clear(confirmation);
  await user.type(confirmation, "un-autre-mot-de-passe");
  await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

  expect(
    await screen.findByText("Les mots de passe ne correspondent pas."),
  ).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("shows the server's rate-limit explanation on the login form", async () => {
  const message =
    "Trop de tentatives de connexion. Réessayez dans quelques instants.";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me/") {
        setDocumentCookie("csrftoken=first-token; path=/");
        return json(null, 200);
      }
      if (path === "/api/auth/login/")
        // DRF's own Throttled exception, raised before the serializer ever
        // runs, answers under "detail" as one object — never the list under
        // "non_field_errors" a serializer's own validate() raises.
        return json({ detail: issue("login_throttled", message) }, 429);
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  renderAt("/login");
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("E-mail ou nom d'affichage"),
    "Marie",
  );
  await user.type(screen.getByLabelText("Mot de passe"), marie.password);
  await user.click(screen.getByRole("button", { name: "Se connecter" }));
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByText("Une erreur inattendue est survenue.")).toBeNull();
});

it("shows one login error for bad credentials", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      setDocumentCookie("csrftoken=first-token; path=/");
      return json(null, 200);
    }
    if (path === "/api/auth/login/") {
      return json({ non_field_errors: [issue("bad_credentials")] }, 400);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/login");

  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("E-mail ou nom d'affichage"),
    "Marie",
  );
  await user.type(screen.getByLabelText("Mot de passe"), "pas-le-bon");
  await user.click(screen.getByRole("button", { name: "Se connecter" }));

  expect(
    await screen.findByText("Identifiant ou mot de passe incorrect."),
  ).toBeTruthy();
});

it("opens and closes a session using the rotated CSRF cookie", async () => {
  // Like the server: once logged in, /me answers with the session, and the
  // cookie the login rotated stays rotated.
  let loggedIn = false;
  const fetchMock = vi.fn(async (path: string, options?: RequestInit) => {
    if (path === "/api/auth/me/") {
      if (loggedIn) {
        return json(marieIdentity, 200);
      }
      setDocumentCookie("csrftoken=first-token; path=/");
      return json({ detail: issue("not_authenticated") }, 403);
    }
    if (path === "/api/auth/login/") {
      expect(options?.headers).toMatchObject({ "X-CSRFToken": "first-token" });
      setDocumentCookie("csrftoken=rotated-token; path=/");
      loggedIn = true;
      return json(marieIdentity, 200);
    }
    if (path === "/api/auth/logout/") {
      expect(options?.headers).toMatchObject({
        "X-CSRFToken": "rotated-token",
      });
      loggedIn = false;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/login");

  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("E-mail ou nom d'affichage"),
    "Marie",
  );
  await user.type(screen.getByLabelText("Mot de passe"), marie.password);
  await user.click(screen.getByRole("button", { name: "Se connecter" }));
  expect(await screen.findByText("Bonjour, Marie.")).toBeTruthy();

  await user.click(
    screen.getByRole("button", { name: "Menu du compte (Marie)" }),
  );
  await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
  await waitFor(() => {
    expect(screen.getByRole("link", { name: "Créer mon compte" })).toBeTruthy();
  });
  const paths = fetchMock.mock.calls.map(([path]) => path);
  expect(paths.filter((path) => path === "/api/auth/login/")).toHaveLength(1);
  expect(paths.filter((path) => path === "/api/auth/logout/")).toHaveLength(1);
});

it("clears a stale session when logout says it is already gone", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json(
        {
          display_name: "Marie",
          club_role: "student",
          is_club_admin: false,
          avatar: null,
          team_seasons: [],
        },
        200,
      );
    }
    if (path === "/api/auth/logout/") {
      return json({ detail: issue("not_authenticated") }, 403);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  setDocumentCookie("csrftoken=stale-token; path=/");
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/");

  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Menu du compte (Marie)" }),
  );
  await user.click(screen.getByRole("button", { name: "Se déconnecter" }));

  expect(
    await screen.findByRole("link", { name: "Créer mon compte" }),
  ).toBeTruthy();
  expect(
    screen.queryByText("Vous devez vous connecter pour continuer."),
  ).toBeNull();
});

it("keeps a logout permission refusal visible", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json(
        {
          display_name: "Marie",
          club_role: "student",
          is_club_admin: false,
          avatar: null,
          team_seasons: [],
        },
        200,
      );
    }
    if (path === "/api/auth/logout/") {
      return json({ detail: issue("permission_denied") }, 403);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  setDocumentCookie("csrftoken=stale-token; path=/");
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/");

  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Menu du compte (Marie)" }),
  );
  await user.click(screen.getByRole("button", { name: "Se déconnecter" }));

  expect(
    await screen.findByText("Vous n'avez pas l'autorisation nécessaire."),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeTruthy();
});

it("distinguishes a current-user server failure from a network failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({}, 500)),
  );
  renderAt("/");

  expect(
    await screen.findByText("Une erreur inattendue est survenue."),
  ).toBeTruthy();
  expect(screen.queryByText(/Impossible de joindre le serveur/)).toBeNull();
});

it("forgets every query of the previous account on logout", async () => {
  let releaseLateBoard: (response: Response) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me/") return json(marieIdentity, 200);
      if (path === "/api/auth/logout/")
        return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  setDocumentCookie("csrftoken=token; path=/");
  const queryClient = renderAt("/", previousAccountCache());
  // Still loading when the member logs out: its answer must not land after.
  const lateBoard = queryClient
    .fetchQuery({
      queryKey: ["team-seasons", 8, "work-items"],
      queryFn: () =>
        new Promise<Response>((resolve) => {
          releaseLateBoard = resolve;
        }).then((response) => response.json()),
    })
    .catch((error: unknown) => error);

  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Menu du compte (Marie)" }),
  );
  await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
  await screen.findByRole("link", { name: "Créer mon compte" });
  releaseLateBoard(json([{ id: 2 }], 200));
  expect(isCancelledError(await lateBoard)).toBe(true);

  expect(cached(queryClient)).toEqual([[["auth", "me"], null]]);
});

it("starts a login with nothing of the previous account cached", async () => {
  // The home page refetches the identity once the login lands: like a real
  // session, the fake answers Marie from then on, not `null` over her.
  let signedIn = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me/") {
        setDocumentCookie("csrftoken=first-token; path=/");
        return json(signedIn ? marieIdentity : null, 200);
      }
      if (path === "/api/auth/login/") {
        signedIn = true;
        return json(marieIdentity, 200);
      }
      if (path.endsWith("/work-items/")) return json([], 200);
      if (path.includes("/days/")) {
        return json(
          {
            day: "2026-10-08",
            entries: [],
            present: [],
            roster: 0,
            advanced_work_items: 0,
          },
          200,
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  // The previous account's session ended elsewhere: this tab still held
  // its data when the next member reached the login page.
  const queryClient = previousAccountCache();
  queryClient.setQueryData(["auth", "me"], null);
  renderAt("/login", queryClient);

  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("E-mail ou nom d'affichage"),
    "Marie",
  );
  await user.type(screen.getByLabelText("Mot de passe"), marie.password);
  await user.click(screen.getByRole("button", { name: "Se connecter" }));

  await waitFor(() =>
    expect(queryClient.getQueryData(["auth", "me"])).toEqual(marieIdentity),
  );
  // Whatever the home screen now loads is Marie's; nothing is left of before.
  for (const key of PREVIOUS_ACCOUNT_KEYS) {
    expect(queryClient.getQueryState(key)).toBeUndefined();
  }
});
