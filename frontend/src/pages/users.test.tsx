import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import { photoChanged } from "../components/Avatar";
import "../i18n";

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

function identity(isClubAdmin = true) {
  return {
    display_name: "Paul",
    club_role: "mentor",
    is_club_admin: isClubAdmin,
    avatar: null,
    team_seasons: [],
  };
}

function account(
  id: number,
  displayName: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    display_name: displayName,
    email: `${displayName.toLowerCase()}@club.fr`,
    club_role: "student",
    is_club_admin: false,
    is_active: true,
    is_anonymized: false,
    avatar: null,
    ...extra,
  };
}

const PAUL = account(1, "Paul", { club_role: "mentor", is_club_admin: true });
const ELODIE = account(2, "Élodie");
const TOM = account(3, "Tom", { is_active: false });
const GONE = account(4, "Ancien membre 4", {
  is_active: false,
  is_anonymized: true,
});

type Handler = (
  path: string,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;

function stubApi(handler: Handler) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/auth/me/") return json(identity());
    const response = await handler(path, init);
    if (!response) {
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calls(fetchMock: ReturnType<typeof stubApi>, method: string) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === method);
}

function renderAt(path: string) {
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

function listedNames() {
  return screen.getAllByRole("listitem").map(
    (item) =>
      // The first visible text: the avatar's initial is aria-hidden.
      within(item)
        .getAllByText(/./)
        .find((element) => !element.closest("[aria-hidden]"))?.textContent,
  );
}

beforeEach(() => {
  setDocumentCookie("csrftoken=test-token; path=/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
});

it("keeps the screen from a mentor who is not a club admin", async () => {
  const fetchMock = vi.fn(async (path: string) =>
    path === "/api/notifications/"
      ? json({ unread: 0, items: [] })
      : json(identity(false)),
  );
  vi.stubGlobal("fetch", fetchMock);

  renderAt("/users");

  expect(
    await screen.findByRole("heading", { name: "Accès réservé" }),
  ).toBeTruthy();
  expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain(
    "/api/users/",
  );
});

it("lists the members, finds one without accents, and hides deleted accounts", async () => {
  const user = userEvent.setup();
  stubApi((path) =>
    path === "/api/users/" ? json([TOM, GONE, PAUL, ELODIE]) : undefined,
  );

  renderAt("/users");

  expect(await screen.findByText("3 membres")).toBeTruthy();
  expect(listedNames()).toEqual(["Élodie", "Paul (vous)", "Tom"]);
  expect(screen.getByText("Suspendu")).toBeTruthy();

  await user.type(screen.getByLabelText("Rechercher"), "elo");
  expect(listedNames()).toEqual(["Élodie"]);

  await user.clear(screen.getByLabelText("Rechercher"));
  await user.selectOptions(screen.getByLabelText("Statut"), "anonymized");
  expect(listedNames()).toEqual(["Ancien membre 4"]);
});

it("changes a member's role, admin flag and suspension in one save", async () => {
  const user = userEvent.setup();
  let elodie = ELODIE;
  const fetchMock = stubApi((path, init) => {
    if (path === "/api/users/2/" && init?.method === "PATCH") {
      elodie = { ...elodie, ...JSON.parse(String(init.body)) };
      return json(elodie);
    }
    if (path === "/api/users/2/") return json(elodie);
    if (path === "/api/users/") return json([PAUL, elodie]);
    return undefined;
  });

  renderAt("/users/2");

  const admin = await screen.findByLabelText("Administrateur du club");
  // An administrator is a mentor: not offered to a student.
  expect((admin as HTMLInputElement).disabled).toBe(true);

  await user.click(screen.getByLabelText("Mentor"));
  await user.click(admin);
  await user.click(screen.getByLabelText("Compte actif"));
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(await screen.findByText("Modifications enregistrées.")).toBeTruthy();
  const [[, init]] = calls(fetchMock, "PATCH");
  expect(JSON.parse(String(init?.body))).toEqual({
    club_role: "mentor",
    is_club_admin: true,
    is_active: false,
  });
  expect(new Headers(init?.headers).get("X-CSRFToken")).toBe("test-token");
  expect(screen.getByText("Suspendu")).toBeTruthy();
});

it.each(["/users", "/users/2"])(
  "refreshes changed photos and falls back to initials for broken photos on %s",
  async (path) => {
    const elodie = { ...ELODIE, avatar: "/api/users/2/avatar/" };
    stubApi((url) => {
      if (url === "/api/users/") return json([elodie]);
      if (url === "/api/users/2/") return json(elodie);
      return undefined;
    });
    renderAt(path);
    await screen.findByText("Élodie");
    const main = screen.getByRole("main");
    const image = main.querySelector("img");
    expect(image).not.toBeNull();
    const original = image?.getAttribute("src");

    act(() => photoChanged());
    expect(image?.getAttribute("src")).not.toBe(original);
    fireEvent.error(image as HTMLImageElement);
    expect(main.querySelector("img")).toBeNull();
    expect(within(main).getByText("É").getAttribute("aria-hidden")).toBe(
      "true",
    );

    act(() => photoChanged());
    expect(main.querySelector("img")).not.toBeNull();
  },
);

it("drops the admin flag when a mentor is made a student again", async () => {
  const user = userEvent.setup();
  stubApi((path) =>
    path === "/api/users/5/"
      ? json(account(5, "Claire", { club_role: "mentor", is_club_admin: true }))
      : undefined,
  );

  renderAt("/users/5");

  const admin = (await screen.findByLabelText(
    "Administrateur du club",
  )) as HTMLInputElement;
  expect(admin.checked).toBe(true);
  await user.click(screen.getByLabelText("Élève"));

  expect(admin.checked).toBe(false);
  expect(admin.disabled).toBe(true);
});

it("shows why the server refused an edit", async () => {
  const user = userEvent.setup();
  stubApi((path, init) => {
    if (path === "/api/users/2/" && init?.method === "PATCH") {
      return json(
        { detail: { code: "cannot_target_staff", message: "…" } },
        403,
      );
    }
    if (path === "/api/users/2/") return json(ELODIE);
    return undefined;
  });

  renderAt("/users/2");

  await user.click(await screen.findByLabelText("Compte actif"));
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(
    await screen.findByText(
      "Ce compte a accès à l'admin Django ; seul un accès équivalent peut le modifier.",
    ),
  ).toBeTruthy();
});

it("lets an admin read their own account but not change or delete it", async () => {
  stubApi((path) => (path === "/api/users/1/" ? json(PAUL) : undefined));

  renderAt("/users/1");

  expect(
    await screen.findByText(
      "C'est votre compte : un autre administrateur peut modifier vos droits, pas vous-même.",
    ),
  ).toBeTruthy();
  // Disabled through its fieldset, which `.disabled` does not reflect.
  expect(screen.getByLabelText("Compte actif").matches(":disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Supprimer/ })).toBeNull();
});

it("deletes a member only after confirming, then returns to the list", async () => {
  const user = userEvent.setup();
  let users = [PAUL, ELODIE];
  const fetchMock = stubApi((path, init) => {
    if (path === "/api/users/2/" && init?.method === "DELETE") {
      users = [PAUL, { ...GONE, id: 2, display_name: "Ancien membre 2" }];
      return new Response(null, { status: 204 });
    }
    if (path === "/api/users/2/") return json(ELODIE);
    if (path === "/api/users/") return json(users);
    return undefined;
  });

  const router = renderAt("/users/2");

  await user.click(
    await screen.findByRole("button", { name: "Supprimer ce compte…" }),
  );
  expect(calls(fetchMock, "DELETE")).toHaveLength(0);
  await user.click(
    screen.getByRole("button", { name: "Supprimer définitivement" }),
  );

  expect(
    await screen.findByText("Le compte de Élodie a été supprimé."),
  ).toBeTruthy();
  expect(router.state.location.pathname).toBe("/users");
  await waitFor(() => expect(listedNames()).toEqual(["Paul (vous)"]));
});

it("shows a deleted account as final, with nothing left to change", async () => {
  stubApi((path) => (path === "/api/users/4/" ? json(GONE) : undefined));

  renderAt("/users/4");

  expect(
    await screen.findByText(/Ce compte a été supprimé : son identité/),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Supprimer/ })).toBeNull();
});

it("says once why a role and admin flag cannot go together", async () => {
  const user = userEvent.setup();
  stubApi((path, init) => {
    if (path === "/api/users/2/" && init?.method === "PATCH") {
      return json(
        {
          non_field_errors: [{ code: "admin_must_be_mentor", message: "…" }],
        },
        400,
      );
    }
    if (path === "/api/users/2/") return json(ELODIE);
    return undefined;
  });

  renderAt("/users/2");

  await user.click(await screen.findByLabelText("Mentor"));
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(
    await screen.findAllByText("Un administrateur doit être mentor."),
  ).toHaveLength(1);
});
