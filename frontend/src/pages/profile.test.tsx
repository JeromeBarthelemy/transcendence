import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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

function identity(avatar: string | null) {
  return {
    display_name: "Marie Durand",
    club_role: "student",
    is_club_admin: false,
    avatar,
    team_seasons: [],
  };
}

function photo(name: string, type: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** Stands in for the browser's XMLHttpRequest: each request waits until the
 * test makes it progress and answer. */
class FakeXhr {
  static last: FakeXhr | null = null;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  responseText = "";
  private listeners: Record<string, (() => void)[]> = {};
  private uploadListeners: ((event: ProgressEvent) => void)[] = [];
  upload = {
    addEventListener: (_: string, listener: (event: ProgressEvent) => void) =>
      this.uploadListeners.push(listener),
  };

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }
  send(body: unknown) {
    this.body = body;
  }
  progress(loaded: number, total: number) {
    for (const listener of this.uploadListeners) {
      listener({ lengthComputable: true, loaded, total } as ProgressEvent);
    }
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    for (const listener of this.listeners.load ?? []) listener();
  }
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
}

beforeEach(() => {
  setDocumentCookie("csrftoken=test-token; path=/");
  FakeXhr.last = null;
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("fr");
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
});

it("opens the profile from the signed-in member's name", async () => {
  const user = userEvent.setup();
  stubApi((path) =>
    path === "/api/auth/me/" ? json(identity(null)) : undefined,
  );

  renderAt("/teams");
  await user.click(
    await screen.findByRole("button", {
      name: "Menu du compte (Marie Durand)",
    }),
  );
  await user.click(screen.getByRole("link", { name: "Voir mon profil" }));

  expect(
    await screen.findByRole("heading", { name: "Marie Durand" }),
  ).toBeTruthy();
  const placeholder = screen.getByRole("img", {
    name: "Pas de photo : vos initiales s'affichent à la place",
  });
  expect(placeholder.textContent).toBe("MD");
});

it("refuses a file in a forbidden format or too heavy without sending it", async () => {
  // The member may pick "all files" in the dialog: the accept list is a hint.
  const user = userEvent.setup({ applyAccept: false });
  stubApi((path) =>
    path === "/api/auth/me/" ? json(identity(null)) : undefined,
  );

  renderAt("/profile");
  const input = await screen.findByLabelText("Choisir une photo");

  await user.upload(input, photo("scan.gif", "image/gif"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Ce fichier n'a pas été envoyé : choisissez une photo JPEG, PNG, WebP ou HEIC.",
  );

  await user.upload(
    input,
    photo("huge.jpg", "image/jpeg", 10 * 1024 * 1024 + 1),
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "Ce fichier n'a pas été envoyé : la photo dépasse 10 Mo.",
  );
  expect(FakeXhr.last).toBeNull();
});

it("previews the photo, shows the upload's progress and puts the new face everywhere", async () => {
  const user = userEvent.setup();
  let current = identity(null);
  stubApi((path) => (path === "/api/auth/me/" ? json(current) : undefined));

  renderAt("/profile");
  await user.upload(
    await screen.findByLabelText("Choisir une photo"),
    photo("moi.png", "image/png"),
  );

  const preview = screen.getByRole("img", {
    name: "Aperçu de la nouvelle photo",
  }) as HTMLImageElement;
  expect(preview.src).toBe("blob:preview");

  await user.click(screen.getByRole("button", { name: "Envoyer la photo" }));
  const xhr = FakeXhr.last;
  if (!xhr) throw new Error("No upload was sent");
  expect(xhr.method).toBe("PUT");
  expect(xhr.url).toBe("/api/auth/me/avatar/");
  expect(xhr.headers["X-CSRFToken"]).toBe("test-token");
  expect(xhr.headers["Content-Type"]).toBeUndefined();
  expect((xhr.body as FormData).get("avatar")).toBeInstanceOf(File);

  xhr.progress(42, 100);
  const bar = (await screen.findByRole("progressbar", {
    name: "Progression de l'envoi",
  })) as HTMLProgressElement;
  expect(await screen.findByText("Envoi… 42 %")).toBeTruthy();
  expect(bar.value).toBe(42);

  current = identity("/api/users/3/avatar/");
  xhr.respond(200, current);

  expect(
    await screen.findByText("Votre nouvelle photo est enregistrée."),
  ).toBeTruthy();
  const header = screen.getByRole("button", {
    name: "Menu du compte (Marie Durand)",
  });
  // A version on the address, or the browser would show the face it already
  // drew under that address.
  expect(within(header).getByRole("presentation").getAttribute("src")).toMatch(
    /^\/api\/users\/3\/avatar\/\?v=\d+$/,
  );
  expect(
    screen.getByRole("img", { name: "Votre photo de profil actuelle" }),
  ).toBeTruthy();
});

it.each([
  ["image/heic", "image/heic"],
  // What many browsers announce for a HEIC photo copied off an iPhone.
  ["no type", ""],
])(
  "lets a HEIC photo through with %s and says it cannot be previewed",
  async (_, type) => {
    const user = userEvent.setup({ applyAccept: false });
    stubApi((path) =>
      path === "/api/auth/me/" ? json(identity(null)) : undefined,
    );

    renderAt("/profile");
    const input = await screen.findByLabelText("Choisir une photo");
    expect(input.getAttribute("accept")).toContain(".heic");
    await user.upload(input, photo("IMG_0042.HEIC", type));

    // The browser cannot draw it: the preview gives up rather than break.
    fireEvent.error(
      screen.getByRole("img", { name: "Aperçu de la nouvelle photo" }),
    );
    expect(
      screen.getByRole("img", { name: "Aperçu indisponible" }).textContent,
    ).toBe("HEIC");
    expect(screen.queryByRole("alert")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Envoyer la photo" }));
    const xhr = FakeXhr.last;
    if (!xhr) throw new Error("No upload was sent");
    expect(((xhr.body as FormData).get("avatar") as File).name).toBe(
      "IMG_0042.HEIC",
    );
  },
);

it("shows the server's refusal by its code", async () => {
  const user = userEvent.setup();
  stubApi((path) =>
    path === "/api/auth/me/" ? json(identity(null)) : undefined,
  );

  renderAt("/profile");
  // Announced as a JPEG by its name, but not an image at all.
  await user.upload(
    await screen.findByLabelText("Choisir une photo"),
    photo("notes.jpg", "image/jpeg"),
  );
  await user.click(screen.getByRole("button", { name: "Envoyer la photo" }));
  FakeXhr.last?.respond(400, {
    avatar: [
      {
        code: "avatar_not_an_image",
        message: "Ce fichier n'est pas une image.",
      },
    ],
  });

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Ce fichier n'est pas une image.",
  );
});

it("removes the photo and falls back to the initials", async () => {
  const user = userEvent.setup();
  let current = identity("/api/users/3/avatar/");
  const fetchMock = stubApi((path, init) => {
    if (path === "/api/auth/me/") return json(current);
    if (path === "/api/auth/me/avatar/" && init?.method === "DELETE") {
      current = identity(null);
      return new Response(null, { status: 204 });
    }
    return undefined;
  });

  renderAt("/profile");
  await user.click(
    await screen.findByRole("button", { name: "Supprimer la photo" }),
  );

  expect(await screen.findByText("Votre photo a été supprimée.")).toBeTruthy();
  expect(
    screen.getByRole("img", {
      name: "Pas de photo : vos initiales s'affichent à la place",
    }),
  ).toBeTruthy();
  const remove = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "DELETE",
  );
  expect(new Headers(remove?.[1]?.headers).get("X-CSRFToken")).toBe(
    "test-token",
  );
});

it("localizes the chosen photo's size without losing the file or preview", async () => {
  stubApi((path) =>
    path === "/api/auth/me/" ? json(identity(null)) : undefined,
  );
  renderAt("/profile");
  const input = await screen.findByLabelText("Choisir une photo");
  await userEvent.upload(
    input,
    photo("portrait.png", "image/png", 1.5 * 1024 ** 2),
  );
  const preview = screen.getByRole("img", {
    name: "Aperçu de la nouvelle photo",
  });
  for (const [language, size] of [
    ["en", "1.5 MB"],
    ["es", "1,5 MB"],
    ["fr", "1,5\u202fMo"],
  ] as const) {
    await userEvent.selectOptions(screen.getByRole("combobox"), language);
    expect(screen.getByText("portrait.png")).toBeTruthy();
    expect(
      screen.getByText(
        (_, node) =>
          node?.tagName === "P" &&
          node.textContent === `portrait.png · ${size}`,
      ),
    ).toBeTruthy();
    expect(document.querySelector('img[src="blob:preview"]')).toBe(preview);
  }
  expect(FakeXhr.last).toBeNull();
});
