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
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
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

function identity(isClubAdmin: boolean) {
  return {
    id: 1,
    display_name: "Paul",
    club_role: "mentor",
    is_club_admin: isClubAdmin,
    avatar: null,
    team_seasons: [],
  };
}

function member(membership: number, user: number, displayName: string) {
  return { membership, user, display_name: displayName, avatar: null };
}

function teamList(teams: object[]) {
  return {
    season: { start_year: 2026, game_name: "BioBuzz" },
    teams,
  };
}

function renderTeams() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: ["/teams"] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

type Handler = (
  path: string,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;

function stubApi(handler: Handler) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
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

beforeEach(() => {
  setDocumentCookie("csrftoken=test-token; path=/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
});

it("keeps the screen from a member who is not a club admin", async () => {
  const fetchMock = stubApi((path) =>
    path === "/api/auth/me/" ? json(identity(false)) : undefined,
  );

  renderTeams();

  expect(
    await screen.findByRole("heading", { name: "Accès réservé" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Administration" })).toBeNull();
  expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain(
    "/api/teams/",
  );
});

it("finds a member as the name is typed and adds them to the team", async () => {
  const user = userEvent.setup();
  let members = [member(1, 10, "Lina")];
  const fetchMock = stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/teams/") {
      return json(
        teamList([
          {
            id: 7,
            number: 1796,
            name: "Les Rouages",
            team_season: 70,
            members,
          },
        ]),
      );
    }
    // The server leaves Lina out: she is already on team season 70.
    if (path === "/api/users/?search=lin&team_season=70") {
      return json([
        { id: 11, display_name: "Linus", avatar: null, club_role: "student" },
      ]);
    }
    if (path === "/api/memberships/" && init?.method === "POST") {
      members = [...members, member(2, 11, "Linus")];
      return json({ id: 2, user: 11, team_season: 70 }, 201);
    }
    return undefined;
  });

  renderTeams();

  expect(
    await screen.findByRole("button", { name: "Administration" }),
  ).toBeTruthy();
  const search = await screen.findByRole("combobox", {
    name: "Ajouter un membre",
  });
  await user.type(search, "lin");

  const option = await screen.findByRole("option", { name: /Linus/ });

  await user.click(option);

  await waitFor(() => {
    expect(
      screen.getByRole("button", {
        name: "Retirer Linus de l'équipe 1796 · Les Rouages",
      }),
    ).toBeTruthy();
  });
  const [[, init]] = calls(fetchMock, "POST");
  expect(JSON.parse(String(init?.body))).toEqual({ user: 11, team_season: 70 });
  expect(new Headers(init?.headers).get("X-CSRFToken")).toBe("test-token");
});

it("adds the person highlighted, not whoever lands at their place", async () => {
  const user = userEvent.setup();
  const person = (id: number, name: string) => ({
    id,
    display_name: name,
    avatar: null,
    club_role: "student",
  });
  let releaseSecondSearch = () => {};
  const secondSearch = new Promise<void>((resolve) => {
    releaseSecondSearch = resolve;
  });
  const fetchMock = stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/teams/") {
      return json(
        teamList([
          {
            id: 7,
            number: 1796,
            name: "Rouages",
            team_season: 70,
            members: [],
          },
        ]),
      );
    }
    if (path === "/api/users/?search=l&team_season=70") {
      return json([person(12, "Lina"), person(13, "Léo")]);
    }
    if (path === "/api/users/?search=le&team_season=70") {
      return secondSearch.then(() =>
        json([person(13, "Léo"), person(14, "Léon")]),
      );
    }
    if (path === "/api/memberships/" && init?.method === "POST") {
      return json({ id: 1, user: 13, team_season: 70 }, 201);
    }
    return undefined;
  });

  renderTeams();

  const search = await screen.findByRole("combobox", {
    name: "Ajouter un membre",
  });
  await user.type(search, "l");
  await screen.findByRole("option", { name: /Léo/ });

  // The first results stay on screen while the next ones load: Léo is
  // second there, and Léon will be second in the results that replace them.
  await user.type(search, "e{ArrowDown}{ArrowDown}");
  expect(
    screen.getByRole("option", { name: /Léo/, selected: true }),
  ).toBeTruthy();
  releaseSecondSearch();
  await screen.findByRole("option", { name: /Léon/ });
  await user.keyboard("{Enter}");

  await waitFor(() => expect(calls(fetchMock, "POST")).toHaveLength(1));
  const [[, init]] = calls(fetchMock, "POST");
  expect(JSON.parse(String(init?.body))).toEqual({ user: 13, team_season: 70 });
});

it("renames a team and removes a member", async () => {
  const user = userEvent.setup();
  let name = "Les Rouages";
  let members = [member(1, 10, "Lina")];
  const fetchMock = stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/teams/") {
      return json(
        teamList([{ id: 7, number: 1796, name, team_season: 70, members }]),
      );
    }
    if (path === "/api/teams/7/" && init?.method === "PATCH") {
      name = JSON.parse(String(init.body)).name;
      return json({ id: 7, number: 1796, name });
    }
    if (path === "/api/memberships/1/" && init?.method === "DELETE") {
      members = [];
      return new Response(null, { status: 204 });
    }
    return undefined;
  });

  renderTeams();

  await user.click(await screen.findByRole("button", { name: "Renommer" }));
  const field = screen.getByLabelText("Nouveau nom de l'équipe 1796");
  await user.clear(field);
  await user.type(field, "Les Engrenages");
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect(
    await screen.findByRole("heading", { name: "1796 · Les Engrenages" }),
  ).toBeTruthy();

  await user.click(
    screen.getByRole("button", {
      name: "Retirer Lina de l'équipe 1796 · Les Engrenages",
    }),
  );

  expect(await screen.findByText("Aucun membre pour l'instant.")).toBeTruthy();
  expect(calls(fetchMock, "DELETE")).toHaveLength(1);
});

it("only lets an empty team be deleted, after confirming", async () => {
  const user = userEvent.setup();
  let teams = [
    {
      id: 7,
      number: 1796,
      name: "Les Rouages",
      team_season: 70,
      members: [member(1, 10, "Lina")],
    },
    { id: 8, number: 2024, name: "Vide", team_season: 80, members: [] },
  ];
  const fetchMock = stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/teams/") return json(teamList(teams));
    if (path === "/api/teams/8/" && init?.method === "DELETE") {
      teams = teams.filter((team) => team.id !== 8);
      return new Response(null, { status: 204 });
    }
    return undefined;
  });

  renderTeams();

  const staffed = await screen.findByRole("article", {
    name: "1796 · Les Rouages",
  });
  const blocked = within(staffed).getByRole("button", { name: "Supprimer" });
  expect((blocked as HTMLButtonElement).disabled).toBe(true);
  expect(
    within(staffed).getByText(
      "Retirez tous ses membres pour pouvoir supprimer cette équipe.",
    ),
  ).toBeTruthy();

  const empty = screen.getByRole("article", { name: "2024 · Vide" });
  await user.click(within(empty).getByRole("button", { name: "Supprimer" }));
  expect(calls(fetchMock, "DELETE")).toHaveLength(0);
  await user.click(
    within(empty).getByRole("button", { name: "Supprimer l'équipe" }),
  );

  await waitFor(() => {
    expect(screen.queryByRole("article", { name: "2024 · Vide" })).toBeNull();
  });
  expect(calls(fetchMock, "DELETE")).toHaveLength(1);
});

it("shows why the server refused to delete a team", async () => {
  const user = userEvent.setup();
  stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/teams/") {
      return json(
        teamList([
          {
            id: 8,
            number: 2024,
            name: "Ancienne",
            team_season: 80,
            members: [],
          },
        ]),
      );
    }
    if (path === "/api/teams/8/" && init?.method === "DELETE") {
      return json({ detail: { code: "team_has_history", message: "…" } }, 409);
    }
    return undefined;
  });

  renderTeams();

  await user.click(await screen.findByRole("button", { name: "Supprimer" }));
  await user.click(screen.getByRole("button", { name: "Supprimer l'équipe" }));

  expect(
    await screen.findByText(
      "Cette équipe a un historique de plusieurs saisons : elle ne peut pas être supprimée.",
    ),
  ).toBeTruthy();
});

it("creates a team for the current season", async () => {
  const user = userEvent.setup();
  let teams: object[] = [];
  const fetchMock = stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/teams/" && init?.method === "POST") {
      teams = [
        { id: 9, number: 31415, name: "Pi", team_season: 90, members: [] },
      ];
      return json({ id: 9, number: 31415, name: "Pi" }, 201);
    }
    if (path === "/api/teams/") return json(teamList(teams));
    return undefined;
  });

  renderTeams();

  await user.type(await screen.findByLabelText("Numéro FIRST"), "31415");
  await user.type(screen.getByLabelText("Nom"), "Pi");
  await user.click(screen.getByRole("button", { name: "Créer l'équipe" }));

  expect(
    await screen.findByRole("heading", { name: "31415 · Pi" }),
  ).toBeTruthy();
  const [[, init]] = calls(fetchMock, "POST");
  expect(JSON.parse(String(init?.body))).toEqual({
    number: 31415,
    name: "Pi",
    season: 2026,
  });
});
