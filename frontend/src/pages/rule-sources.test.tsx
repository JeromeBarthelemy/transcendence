import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import i18n from "../i18n";

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
    display_name: "Paul",
    club_role: "mentor",
    is_club_admin: isClubAdmin,
    avatar: null,
    team_seasons: [],
  };
}

function manualRow(overrides: Record<string, unknown> = {}) {
  return {
    source: "game_manual",
    title: "Manuel BioBuzz TU03",
    url: "https://ftc-resources.firstinspires.org/ftc/game/cm-html/manual.htm",
    fetched_at: "2026-10-01T10:00:00Z",
    checked_at: "2026-10-09T08:00:00Z",
    pending: null,
    check: null,
    ...overrides,
  };
}

function qaRow(overrides: Record<string, unknown> = {}) {
  return {
    source: "official_qa",
    title: null,
    url: "",
    fetched_at: null,
    checked_at: null,
    pending: null,
    check: null,
    ...overrides,
  };
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

function renderSources() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, {
    initialEntries: ["/rules/sources"],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(async () => {
  await i18n.changeLanguage("fr");
  setDocumentCookie("csrftoken=test-token; path=/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
  localStorage.clear();
});

it("keeps the screen from a member who is not a club admin", async () => {
  const fetchMock = stubApi((path) =>
    path === "/api/auth/me/" ? json(identity(false)) : undefined,
  );

  renderSources();

  expect(
    await screen.findByRole("heading", { name: "Accès réservé" }),
  ).toBeTruthy();
  expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain(
    "/api/rules/sources/",
  );
});

it("shows each source and when it was last checked", async () => {
  stubApi((path) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") return json([manualRow(), qaRow()]);
    return undefined;
  });

  renderSources();

  expect(
    await screen.findByRole("heading", { name: "Manuel de jeu" }),
  ).toBeTruthy();
  expect(screen.getByText("Manuel BioBuzz TU03")).toBeTruthy();
  expect(screen.getByText(/Vérifié le/)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Q&A officiel" })).toBeTruthy();
  expect(
    screen.getByText("Rien n'a encore été ingéré pour cette source."),
  ).toBeTruthy();
  expect(screen.getByText("Jamais vérifié")).toBeTruthy();
});

it("reviews a pending update and accepts it", async () => {
  const user = userEvent.setup();
  const pending = {
    detected_at: "2026-10-10T09:00:00Z",
    summary: {
      added: 2,
      removed: 1,
      changed: 3,
      references: ["G420", "10.6.4"],
      references_total: 5,
    },
  };
  let accepted = false;
  stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/")
      return json([manualRow({ pending: accepted ? null : pending }), qaRow()]);
    if (
      path === "/api/rules/sources/game_manual/accept/" &&
      init?.method === "POST"
    ) {
      accepted = true;
      return json([manualRow({ pending: null }), qaRow()]);
    }
    return undefined;
  });

  renderSources();

  await screen.findByText(/Une nouvelle version a été trouvée/);
  expect(screen.getByText(/2 passage\(s\) ajouté\(s\)/)).toBeTruthy();
  expect(screen.getByText(/G420, 10\.6\.4/)).toBeTruthy();
  expect(screen.getByText(/et 3 de plus/)).toBeTruthy();

  await user.click(
    screen.getByRole("button", { name: "Accepter la mise à jour" }),
  );

  expect(screen.queryByText(/Une nouvelle version a été trouvée/)).toBeNull();
});

it("reports a failed accept without touching the review", async () => {
  const user = userEvent.setup();
  const pending = {
    detected_at: "2026-10-10T09:00:00Z",
    summary: {
      added: 1,
      removed: 0,
      changed: 0,
      references: [],
      references_total: 0,
    },
  };
  stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/")
      return json([manualRow({ pending }), qaRow()]);
    if (
      path === "/api/rules/sources/game_manual/accept/" &&
      init?.method === "POST"
    )
      return json(
        {
          detail: {
            code: "not_found",
            message: "Aucune mise à jour en attente pour cette source.",
          },
        },
        404,
      );
    return undefined;
  });

  renderSources();

  await screen.findByText(/Une nouvelle version a été trouvée/);
  await user.click(
    screen.getByRole("button", { name: "Accepter la mise à jour" }),
  );

  expect(
    await screen.findByText("Cet élément n'existe plus. Rechargez la page."),
  ).toBeTruthy();
  // The failed accept did not silently drop the review itself.
  expect(screen.getByText(/Une nouvelle version a été trouvée/)).toBeTruthy();
});

it("keeps a dismissal while the same change is still the one waiting", async () => {
  const user = userEvent.setup();
  const pending = {
    detected_at: "2026-10-10T09:00:00Z",
    summary: {
      added: 1,
      removed: 0,
      changed: 0,
      references: [],
      references_total: 0,
    },
  };
  stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/")
      return json([manualRow({ pending }), qaRow()]);
    if (path === "/api/rules/sources/check/" && init?.method === "POST")
      return json([manualRow({ pending }), qaRow()]);
    return undefined;
  });

  renderSources();

  await screen.findByText(/Une nouvelle version a été trouvée/);
  await user.click(
    screen.getByRole("button", { name: "Ignorer pour l'instant" }),
  );
  expect(screen.queryByText(/Une nouvelle version a été trouvée/)).toBeNull();

  // The exact same change again, from a fresh check: still dismissed.
  await user.click(screen.getByRole("button", { name: "Vérifier maintenant" }));
  expect(screen.queryByText(/Une nouvelle version a été trouvée/)).toBeNull();
});

it("brings a dismissed review back once a newer change replaces it", async () => {
  const user = userEvent.setup();
  const first = {
    detected_at: "2026-10-10T09:00:00Z",
    summary: {
      added: 1,
      removed: 0,
      changed: 0,
      references: [],
      references_total: 0,
    },
  };
  const second = { ...first, detected_at: "2026-10-11T09:00:00Z" };
  stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/")
      return json([manualRow({ pending: first }), qaRow()]);
    if (path === "/api/rules/sources/check/" && init?.method === "POST")
      return json([manualRow({ pending: second }), qaRow()]);
    return undefined;
  });

  renderSources();

  await screen.findByText(/Une nouvelle version a été trouvée/);
  await user.click(
    screen.getByRole("button", { name: "Ignorer pour l'instant" }),
  );
  expect(screen.queryByText(/Une nouvelle version a été trouvée/)).toBeNull();

  // A later check found a different change: it is not the one dismissed.
  await user.click(screen.getByRole("button", { name: "Vérifier maintenant" }));
  expect(
    await screen.findByText(/Une nouvelle version a été trouvée/),
  ).toBeTruthy();
});

it("keeps a dismissal across leaving the screen and coming back", async () => {
  const user = userEvent.setup();
  const pending = {
    detected_at: "2026-10-10T09:00:00Z",
    summary: {
      added: 1,
      removed: 0,
      changed: 0,
      references: [],
      references_total: 0,
    },
  };
  stubApi((path) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/")
      return json([manualRow({ pending }), qaRow()]);
    return undefined;
  });

  renderSources();
  await screen.findByText(/Une nouvelle version a été trouvée/);
  await user.click(
    screen.getByRole("button", { name: "Ignorer pour l'instant" }),
  );
  cleanup();

  renderSources();

  await screen.findByRole("heading", { name: "Manuel de jeu" });
  expect(screen.queryByText(/Une nouvelle version a été trouvée/)).toBeNull();
});

it("reports a failed check without touching what is searched", async () => {
  const user = userEvent.setup();
  stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") return json([manualRow(), qaRow()]);
    if (path === "/api/rules/sources/check/" && init?.method === "POST")
      return json([
        manualRow({ check: { status: "error", detail: "hors ligne" } }),
        qaRow(),
      ]);
    return undefined;
  });

  renderSources();
  await screen.findByRole("heading", { name: "Manuel de jeu" });
  await user.click(screen.getByRole("button", { name: "Vérifier maintenant" }));

  expect(
    await screen.findByText("Échec de la vérification : hors ligne"),
  ).toBeTruthy();
});

it("opens from its own route", async () => {
  stubApi((path) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") return json([manualRow(), qaRow()]);
    return undefined;
  });

  const router = renderSources();

  await screen.findByRole("heading", { name: "Manuel de jeu" });
  expect(router.state.location.pathname).toBe("/rules/sources");
});

class SourceUpload extends EventTarget {
  static last: SourceUpload | null = null;
  upload = new EventTarget();
  headers = new Map<string, string>();
  method = "";
  url = "";
  form: FormData | null = null;
  status = 0;
  responseText = "";

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }
  send(form: FormData) {
    this.form = form;
    SourceUpload.last = this;
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.dispatchEvent(new Event("load"));
  }
}

function submitFileImport() {
  // jsdom's native required-file validation still reports valueMissing
  // after userEvent.upload sets files. Submit the filled form directly;
  // the component's file/size/replacement guards still run normally.
  const form = screen.getByLabelText("Document HTML").closest("form");
  if (!form) throw new Error("Missing import form");
  fireEvent.submit(form);
}

function sentUpload(): SourceUpload {
  if (!SourceUpload.last) throw new Error("No upload sent yet");
  return SourceUpload.last;
}

it("uploads a first HTML source with CSRF and shows the indexed copy", async () => {
  const user = userEvent.setup();
  SourceUpload.last = null;
  vi.stubGlobal("XMLHttpRequest", SourceUpload);
  stubApi((path) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/")
      return json([manualRow({ title: null, url: "" }), qaRow()]);
    return undefined;
  });
  renderSources();
  await screen.findByRole("heading", { name: "Importer une source" });
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Vérifier maintenant",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);

  const file = new File(["<p>Rule G101.</p>"], "manual.html", {
    type: "text/html",
  });
  await user.upload(screen.getByLabelText("Document HTML"), file);
  expect(
    (screen.getByLabelText("Document HTML") as HTMLInputElement).files?.[0],
  ).toBe(file);
  await user.type(
    screen.getByLabelText("Titre du document (facultatif)"),
    "Manuel TU04",
  );
  submitFileImport();

  const request = await waitFor(sentUpload);
  expect(request.method).toBe("POST");
  expect(request.url).toBe("/api/rules/sources/");
  expect(request.headers.get("X-CSRFToken")).toBe("test-token");
  expect(request.headers.has("Content-Type")).toBe(false);
  expect(request.form?.get("source")).toBe("game_manual");
  expect(request.form?.get("title")).toBe("Manuel TU04");
  expect(request.form?.get("file")).toBe(file);
  expect(screen.getByLabelText("Document HTML").matches(":disabled")).toBe(
    true,
  );

  act(() =>
    SourceUpload.last?.respond(201, [
      manualRow({ title: "Manuel TU04", url: "" }),
      qaRow(),
    ]),
  );
  expect(
    await screen.findByText(
      "Document importé : la recherche utilise cette nouvelle version.",
    ),
  ).toBeTruthy();
  expect(screen.getByText("Manuel TU04")).toBeTruthy();
  expect(screen.getByText(/Fichier importé sans lien officiel/)).toBeTruthy();
  expect(
    (screen.getByLabelText("Document HTML") as HTMLInputElement).value,
  ).toBe("");
});

it("requires fresh consent to replace a source and imports its official URL", async () => {
  const user = userEvent.setup();
  let submitted: RequestInit | undefined;
  stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") {
      if (init?.method === "POST") {
        submitted = init;
        return json(
          [manualRow({ title: "Nouveau manuel", pending: null }), qaRow()],
          201,
        );
      }
      return json([manualRow(), qaRow()]);
    }
    return undefined;
  });
  renderSources();
  await screen.findByRole("heading", { name: "Importer une source" });
  await user.selectOptions(screen.getByLabelText("Méthode d'import"), "url");
  await user.type(screen.getByLabelText("Adresse officielle"), manualRow().url);
  expect(
    (
      screen.getByRole("button", {
        name: "Importer le document",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.click(screen.getByRole("checkbox"));
  await user.type(
    screen.getByLabelText("Titre du document (facultatif)"),
    "Nouveau manuel",
  );
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
    false,
  );
  await user.click(screen.getByRole("checkbox"));
  await user.click(
    screen.getByRole("button", { name: "Importer le document" }),
  );

  expect(await screen.findByText("Nouveau manuel")).toBeTruthy();
  expect(JSON.parse(submitted?.body as string)).toEqual({
    source: "game_manual",
    url: manualRow().url,
    title: "Nouveau manuel",
  });
  expect(new Headers(submitted?.headers).get("X-CSRFToken")).toBe("test-token");
  expect(submitted?.credentials).toBe("same-origin");
});

it("keeps the previous source and the chosen file after an upload refusal", async () => {
  const user = userEvent.setup();
  SourceUpload.last = null;
  vi.stubGlobal("XMLHttpRequest", SourceUpload);
  stubApi((path) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") return json([manualRow(), qaRow()]);
    return undefined;
  });
  renderSources();
  await screen.findByRole("heading", { name: "Importer une source" });
  const file = new File(["<html></html>"], "empty.html", { type: "text/html" });
  await user.upload(screen.getByLabelText("Document HTML"), file);
  await user.click(screen.getByRole("checkbox"));
  submitFileImport();
  await waitFor(() => expect(SourceUpload.last?.form).toBeTruthy());
  expect(
    (
      screen.getByRole("button", {
        name: "Vérifier maintenant",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);

  act(() =>
    SourceUpload.last?.respond(400, {
      detail: {
        code: "no_passage",
        message: "La source ne contient aucun passage à indexer.",
      },
    }),
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("Manuel BioBuzz TU03")).toBeTruthy();
  expect(
    (screen.getByLabelText("Document HTML") as HTMLInputElement).files?.[0],
  ).toBe(file);
  expect(screen.queryByText(/Document importé :/)).toBeNull();
});

it.each([
  [
    "manual.pdf",
    32,
    "Choisissez l'export HTML officiel (.htm ou .html), pas un PDF.",
  ],
  [
    "manual.html",
    5 * 1024 * 1024 + 1,
    "Le document ne doit pas dépasser 5 Mio.",
  ],
])("refuses %s before sending its bytes", async (name, size, message) => {
  const user = userEvent.setup({ applyAccept: false });
  SourceUpload.last = null;
  vi.stubGlobal("XMLHttpRequest", SourceUpload);
  stubApi((path) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") return json([manualRow(), qaRow()]);
    return undefined;
  });
  renderSources();
  await screen.findByRole("heading", { name: "Importer une source" });
  await user.upload(
    screen.getByLabelText("Document HTML"),
    new File([new Uint8Array(size)], name),
  );
  await user.click(screen.getByRole("checkbox"));
  submitFileImport();

  expect(await screen.findByText(message)).toBeTruthy();
  expect(SourceUpload.last).toBeNull();
});

it.each([
  ["en", "Import a source", "HTML document"],
  ["es", "Importar una fuente", "Documento HTML"],
])("translates the import form in %s", async (language, heading, label) => {
  await i18n.changeLanguage(language);
  stubApi((path) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") return json([manualRow(), qaRow()]);
    return undefined;
  });
  renderSources();

  expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
  expect(screen.getByLabelText(label)).toBeTruthy();
});

it("does not offer an import when no season exists", async () => {
  stubApi((path) => {
    if (path === "/api/auth/me/") return json(identity(true));
    if (path === "/api/rules/sources/") return json([]);
    return undefined;
  });
  renderSources();

  expect(
    await screen.findByText("Aucune saison n'est encore ouverte."),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Importer le document" }),
  ).toBeNull();
});
