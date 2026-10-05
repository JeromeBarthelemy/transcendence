import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import "../i18n";

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setDocumentCookie(value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = value;
}

function identity() {
  return {
    display_name: "Marie",
    club_role: "student",
    is_club_admin: false,
    avatar: null,
    team_seasons: [
      {
        id: 7,
        team: { id: 4, number: 1796, name: "Les Rouages" },
        season: { start_year: 2026, game_name: "BioBuzz" },
      },
    ],
  };
}

function progress(overrides: object = {}) {
  return {
    id: 31,
    work_item: { id: 10, title: "Intake" },
    type: "progress",
    body: "Galets montés.",
    step: "prototyping",
    handover: "Tester les galets à 12 V.",
    occurred_at: "2026-09-28T14:30:00+02:00",
    updated_by: null as string | null,
    author: "Lina",
    participants: [
      { display_name: "Lina", avatar: null },
      { display_name: "Marie", avatar: null },
    ],
    attachments: [
      {
        id: 5,
        name: "plan-intake.pdf",
        content_type: "application/pdf",
        url: "/api/attachments/5/",
        people_recognisable: false,
        uploaded_by: "Lina",
      },
    ],
    ...overrides,
  };
}

function workItem(overrides: object = {}) {
  const currentProgress = progress();
  return {
    id: 10,
    team_season: 7,
    title: "Intake",
    on_robot: true,
    status: "open",
    opened_at: "2026-09-10T10:00:00+02:00",
    current_step: "prototyping",
    handover: {
      body: "Tester les galets à 12 V.",
      author: "Lina",
      step: "prototyping",
      occurred_at: "2026-09-28T14:30:00+02:00",
      day: "2026-09-28",
    },
    last_progress: {
      occurred_at: "2026-09-28T14:30:00+02:00",
      day: "2026-09-28",
      participants: currentProgress.participants,
    },
    current_progress: currentProgress,
    current_user_participates: true,
    thread: [currentProgress],
    ...overrides,
  };
}

function renderWorkItem() {
  // The application's staleTime: a fresh cache must not hide a newer save.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  const router = createMemoryRouter(routes, {
    initialEntries: ["/work-items/10"],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return queryClient;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
});

it("shows the current progress, handover, participants and full history", async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/auth/me/") {
      return json(identity());
    }
    if (path === "/api/work-items/10/") {
      return json(workItem());
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWorkItem();

  expect(
    await screen.findByRole("heading", { name: "Intake", level: 1 }),
  ).toBeTruthy();
  expect(screen.getByText(/Robot · 1796 · Les Rouages/)).toBeTruthy();
  expect(screen.getAllByText("Lina et Marie")).toHaveLength(2);
  expect(screen.getAllByText("Tester les galets à 12 V.")).toHaveLength(3);
  expect(screen.getAllByText("Galets montés.").length).toBeGreaterThan(0);
  expect(
    screen.getByRole("link", { name: "plan-intake.pdf" }).getAttribute("href"),
  ).toBe("/api/attachments/5/");
});

it("asks a non-participant to join before editing the progress", async () => {
  const currentProgress = progress({
    participants: [{ display_name: "Lina", avatar: null }],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me/") {
        return json(identity());
      }
      if (path === "/api/work-items/10/") {
        return json(
          workItem({
            current_progress: currentProgress,
            current_user_participates: false,
            thread: [currentProgress],
          }),
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  renderWorkItem();

  expect(
    await screen.findByText(
      "Rejoignez cette avancée pour pouvoir la compléter.",
    ),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Votre ajout")).toBeNull();
  expect(screen.getByRole("button", { name: "Je participe" })).toBeTruthy();
});

it.each([
  { onRobot: true, action: "Continuer cette étape" },
  { onRobot: false, action: "Reprendre aujourd'hui" },
])(
  "offers to continue an existing chantier with '$action'",
  async (scenario) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path === "/api/auth/me/") {
          return json(identity());
        }
        if (path === "/api/work-items/10/") {
          return json(
            workItem({
              on_robot: scenario.onRobot,
              current_progress: null,
              current_user_participates: false,
            }),
          );
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    renderWorkItem();

    expect(
      await screen.findByRole("button", { name: scenario.action }),
    ).toBeTruthy();
  },
);

it("offers to start a step with no progress history", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me/") {
        return json(identity());
      }
      if (path === "/api/work-items/10/") {
        return json(
          workItem({
            current_progress: null,
            current_user_participates: false,
          }),
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  renderWorkItem();

  expect(
    await screen.findByRole("button", { name: "Continuer cette étape" }),
  ).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Étape"), "integration");
  expect(
    screen.getByRole("button", { name: "Commencer cette étape" }),
  ).toBeTruthy();
});

it("joins an existing progress without changing its step", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  const existingProgress = progress({
    participants: [{ display_name: "Lina", avatar: null }],
  });
  let item = workItem({
    current_progress: existingProgress,
    current_user_participates: false,
    thread: [existingProgress],
  });
  const joinedProgress = progress({
    participants: [
      { display_name: "Lina", avatar: null },
      { display_name: "Marie", avatar: null },
    ],
  });
  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json(identity());
      }
      if (path === "/api/work-items/10/" && !options?.method) {
        return json(item);
      }
      if (path === "/api/work-items/10/tick/" && options?.method === "POST") {
        item = workItem({
          current_progress: joinedProgress,
          current_user_participates: true,
          thread: [joinedProgress],
        });
        return json(joinedProgress);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderWorkItem();

  await userEvent.click(
    await screen.findByRole("button", { name: "Je participe" }),
  );

  expect(await screen.findByLabelText("Votre ajout")).toBeTruthy();
  const tickRequest = fetchMock.mock.calls.find(
    ([path]) => path === "/api/work-items/10/tick/",
  );
  expect(JSON.parse(String(tickRequest?.[1]?.body))).toEqual({});
});

it("starts today's progress at the chosen step", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  let item = workItem({
    current_step: null,
    handover: null,
    last_progress: null,
    current_progress: null,
    current_user_participates: false,
    thread: [],
  });
  const created = progress({
    body: "",
    handover: "",
    step: "building",
    participants: [{ display_name: "Marie", avatar: null }],
    attachments: [],
    author: "Marie",
  });
  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json(identity());
      }
      if (path === "/api/work-items/10/" && !options?.method) {
        return json(item);
      }
      if (path === "/api/work-items/10/tick/" && options?.method === "POST") {
        item = workItem({
          current_step: "building",
          current_progress: created,
          current_user_participates: true,
          thread: [created],
        });
        return json(created, 201);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderWorkItem();

  await screen.findByRole("heading", { name: "Rien de commencé aujourd'hui" });
  await userEvent.selectOptions(screen.getByLabelText("Étape"), "building");
  await userEvent.click(
    screen.getByRole("button", { name: "Commencer cette étape" }),
  );

  expect(await screen.findByLabelText("Votre ajout")).toBeTruthy();
  const tickRequest = fetchMock.mock.calls.find(
    ([path]) => path === "/api/work-items/10/tick/",
  );
  expect(JSON.parse(String(tickRequest?.[1]?.body))).toEqual({
    step: "building",
  });
});

function progressServer(
  respond: (input: Record<string, string>) => Response,
  identityOverrides: object = {},
) {
  const server = { progress: progress() };
  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json({ ...identity(), ...identityOverrides });
      }
      if (path === "/api/work-items/10/" && !options?.method) {
        return json(
          workItem({
            current_progress: server.progress,
            thread: [server.progress],
          }),
        );
      }
      if (path === "/api/entries/31/" && options?.method === "PATCH") {
        return respond(JSON.parse(String(options.body)));
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { server, fetchMock };
}

function saveRequests(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(
      ([path, options]) =>
        path === "/api/entries/31/" && options?.method === "PATCH",
    )
    .map(([, options]) => JSON.parse(String(options?.body)));
}

/** The note an input points to, so a test checks it sits with that field. */
function noteUnder(field: HTMLElement) {
  const id = field.getAttribute("aria-describedby");
  return id ? document.getElementById(id) : null;
}

const progressChanged = () =>
  json(
    {
      detail: {
        code: "progress_changed",
        message: "Lina a modifié cette avancée pendant que vous écriviez.",
      },
    },
    409,
  );

it("adds to what was done and saves the changed handoff", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  const { server, fetchMock } = progressServer((input) => {
    server.progress = {
      ...server.progress,
      body: `${server.progress.body}\n\n${input.addition}`,
      handover: input.handover,
      updated_by: "Marie",
    };
    return json(server.progress);
  });
  const queryClient = renderWorkItem();
  const homeWorkItemsKey = ["team-seasons", 7, "work-items"] as const;
  const todayKey = ["team-seasons", 7, "days", "today"] as const;
  const daySummaryKey = [
    "team-seasons",
    7,
    "days",
    "2026-09-28",
    "summary",
  ] as const;
  queryClient.setQueryData(homeWorkItemsKey, { cached: true });
  queryClient.setQueryData(todayKey, { cached: true });
  queryClient.setQueryData(daySummaryKey, { cached: true });

  const addition = await screen.findByLabelText("Votre ajout");
  const handover = screen.getByLabelText("À faire la prochaine fois");
  await userEvent.type(addition, "Courroie alignée.");
  await userEvent.clear(handover);
  await userEvent.type(handover, "Mesurer le jeu latéral.");
  await userEvent.click(
    screen.getByRole("button", { name: "Enregistrer l'avancée" }),
  );

  expect(await screen.findByText("Avancée enregistrée.")).toBeTruthy();
  expect(saveRequests(fetchMock)).toEqual([
    {
      addition: "Courroie alignée.",
      handover: "Mesurer le jeu latéral.",
      handover_was: "Tester les galets à 12 V.",
    },
  ]);
  expect((addition as HTMLTextAreaElement).value).toBe("");
  await waitFor(() => {
    expect(queryClient.getQueryState(homeWorkItemsKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(todayKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(daySummaryKey)?.isInvalidated).toBe(true);
  });
  await waitFor(() => {
    expect(screen.getAllByText(/Courroie alignée\./).length).toBeGreaterThan(0);
  });
});

it("shows what was done as text no participant can erase", async () => {
  progressServer(() => json({}));
  renderWorkItem();

  await screen.findByLabelText("Votre ajout");
  expect(screen.queryByDisplayValue("Galets montés.")).toBeNull();
  expect(
    screen.getByText(
      "Un seul texte pour l'avancée, commun à tous les participants : ce que vous ajoutez s'écrit à la suite.",
    ),
  ).toBeTruthy();
});

it("sends no handoff it did not change, and nothing at all when empty", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  const { server, fetchMock } = progressServer(() => json(server.progress));
  renderWorkItem();
  const save = await screen.findByRole("button", {
    name: "Enregistrer l'avancée",
  });

  expect((save as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(screen.getByLabelText("Votre ajout"), "Moteur testé.");
  await userEvent.click(save);

  await waitFor(() => {
    expect(saveRequests(fetchMock)).toEqual([{ addition: "Moteur testé." }]);
  });
});

it("keeps the handoff it started from when the work item reloads in the background", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  const { server, fetchMock } = progressServer(progressChanged);
  const queryClient = renderWorkItem();
  const handover = await screen.findByLabelText("À faire la prochaine fois");
  await userEvent.type(handover, " Puis à 14 V.");

  server.progress = progress({ handover: "Régler le PID." });
  await queryClient.refetchQueries({ queryKey: ["work-items", 10] });
  await userEvent.click(
    screen.getByRole("button", { name: "Enregistrer l'avancée" }),
  );

  await waitFor(() => {
    expect(saveRequests(fetchMock)[0]?.handover_was).toBe(
      "Tester les galets à 12 V.",
    );
  });
});

it("after a refusal, shows the other version under the field in conflict, then saves from it", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  let refusedOnce = false;
  const { server, fetchMock } = progressServer((input) => {
    if (!refusedOnce) {
      refusedOnce = true;
      server.progress = progress({
        handover: "Ne pas resserrer la courroie.",
        updated_by: "Lina",
      });
      return progressChanged();
    }
    server.progress = { ...server.progress, handover: input.handover };
    return json(server.progress);
  });
  renderWorkItem();
  const addition = await screen.findByLabelText("Votre ajout");
  const handover = screen.getByLabelText("À faire la prochaine fois");
  await userEvent.type(addition, "Moteur testé.");
  await userEvent.clear(handover);
  await userEvent.type(handover, "Régler le PID.");
  const save = screen.getByRole("button", { name: "Enregistrer l'avancée" });

  await userEvent.click(save);

  await waitFor(() => {
    expect(noteUnder(handover)?.textContent).toContain(
      "Lina a enregistré une autre version pendant que vous écriviez :",
    );
  });
  expect(noteUnder(handover)?.textContent).toContain(
    "Ne pas resserrer la courroie.",
  );
  expect(noteUnder(addition)).toBeNull();
  expect(screen.queryByText(/Quelqu'un a modifié cette avancée/)).toBeNull();
  expect((addition as HTMLTextAreaElement).value).toBe("Moteur testé.");
  expect((handover as HTMLTextAreaElement).value).toBe("Régler le PID.");

  await userEvent.clear(handover);
  await userEvent.type(
    handover,
    "Ne pas resserrer la courroie. Régler le PID.",
  );
  await userEvent.click(save);

  expect(await screen.findByText("Avancée enregistrée.")).toBeTruthy();
  expect(saveRequests(fetchMock)[1]).toEqual({
    addition: "Moteur testé.",
    handover: "Ne pas resserrer la courroie. Régler le PID.",
    handover_was: "Ne pas resserrer la courroie.",
  });
  expect(noteUnder(handover)).toBeNull();
});

it("lets a mentor add to what was done, as anyone else", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  const { server, fetchMock } = progressServer(() => json(server.progress), {
    display_name: "Claire",
    club_role: "mentor",
  });
  renderWorkItem();

  await userEvent.type(
    await screen.findByLabelText("Votre ajout"),
    "Retenir celle en TPU.",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Enregistrer l'avancée" }),
  );

  await waitFor(() => {
    expect(saveRequests(fetchMock)).toEqual([
      { addition: "Retenir celle en TPU." },
    ]);
  });
});

it("adds a note to the work item and refreshes its history", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  let item = workItem();
  const createdNote = {
    id: 41,
    work_item: { id: 10, title: "Intake" },
    type: "note",
    body: "Le câble du capteur frotte contre le guide.",
    step: null,
    handover: "",
    occurred_at: "2026-09-29T14:30:00+02:00",
    updated_by: null,
    author: "Marie",
    participants: [],
    attachments: [],
  };
  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json(identity());
      }
      if (path === "/api/work-items/10/" && !options?.method) {
        return json(item);
      }
      if (path === "/api/team-seasons/7/notes/" && options?.method === "POST") {
        item = workItem({ thread: [createdNote, ...item.thread] });
        return json(createdNote, 201);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderWorkItem();

  const note = await screen.findByLabelText("Remarque sur ce chantier");
  await userEvent.type(note, "  Le câble du capteur frotte contre le guide.  ");
  await userEvent.click(
    screen.getByRole("button", { name: "Enregistrer la remarque" }),
  );

  expect(await screen.findByText("Remarque enregistrée.")).toBeTruthy();
  expect(
    await screen.findByText("Le câble du capteur frotte contre le guide."),
  ).toBeTruthy();
  const noteRequest = fetchMock.mock.calls.find(
    ([path]) => path === "/api/team-seasons/7/notes/",
  );
  expect(JSON.parse(String(noteRequest?.[1]?.body))).toEqual({
    body: "Le câble du capteur frotte contre le guide.",
    work_item: 10,
  });
});

it("drops a robot work item, but offers no way to finish it", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  let item = workItem({ on_robot: true, status: "open" });
  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json(identity());
      }
      if (path === "/api/work-items/10/" && !options?.method) {
        return json(item);
      }
      if (path === "/api/work-items/10/" && options?.method === "PATCH") {
        item = workItem({ on_robot: true, status: "dropped" });
        return json(item);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderWorkItem();

  expect(
    await screen.findByRole("button", { name: "Abandonner" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Terminer" })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Abandonner" }));

  expect(await screen.findByText("Abandonné")).toBeTruthy();
  const closeRequest = fetchMock.mock.calls.find(
    ([path, options]) =>
      path === "/api/work-items/10/" && options?.method === "PATCH",
  );
  expect(JSON.parse(String(closeRequest?.[1]?.body))).toEqual({
    status: "dropped",
  });
});

it("finishes an off-robot work item", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  let item = workItem({ on_robot: false, status: "open" });
  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json(identity());
      }
      if (path === "/api/work-items/10/" && !options?.method) {
        return json(item);
      }
      if (path === "/api/work-items/10/" && options?.method === "PATCH") {
        item = workItem({ on_robot: false, status: "done" });
        return json(item);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderWorkItem();

  await userEvent.click(
    await screen.findByRole("button", { name: "Terminer" }),
  );

  expect(await screen.findByText("Terminé")).toBeTruthy();
  const closeRequest = fetchMock.mock.calls.find(
    ([path, options]) =>
      path === "/api/work-items/10/" && options?.method === "PATCH",
  );
  expect(JSON.parse(String(closeRequest?.[1]?.body))).toEqual({
    status: "done",
  });
});

it("offers no close action on a work item that is already closed", async () => {
  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json(identity());
      }
      if (path === "/api/work-items/10/" && !options?.method) {
        return json(workItem({ status: "dropped" }));
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderWorkItem();

  expect(await screen.findByText("Abandonné")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Abandonner" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Terminer" })).toBeNull();
});

it("uploads a file with its image-right answer", async () => {
  setDocumentCookie("csrftoken=test; path=/");

  class FakeXMLHttpRequest {
    static last: FakeXMLHttpRequest | null = null;
    method = "";
    url = "";
    headers = new Map<string, string>();
    sent: FormData | null = null;
    status = 201;
    responseText = JSON.stringify({
      id: 9,
      name: "photo.png",
      content_type: "image/png",
      url: "/api/attachments/9/",
      people_recognisable: false,
      uploaded_by: "Marie",
    });
    upload = {
      onprogress: null as ((event: ProgressEvent) => void) | null,
    };
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;

    constructor() {
      FakeXMLHttpRequest.last = this;
    }

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name: string, value: string) {
      this.headers.set(name, value);
    }

    send(body: FormData) {
      this.sent = body;
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 5,
        total: 10,
      } as ProgressEvent);
      this.onload?.();
    }
  }

  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me/") {
        return json(identity());
      }
      if (path === "/api/work-items/10/") {
        return json(workItem());
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  renderWorkItem();

  const input = await screen.findByLabelText("Photo, mesure ou fichier");
  await userEvent.upload(
    input,
    new File(["image"], "photo.png", { type: "image/png" }),
  );
  await userEvent.click(screen.getByRole("radio", { name: "Non" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Ajouter le fichier" }),
  );

  expect(await screen.findByText("Fichier ajouté.")).toBeTruthy();
  expect(FakeXMLHttpRequest.last?.method).toBe("POST");
  expect(FakeXMLHttpRequest.last?.url).toBe("/api/entries/31/attachments/");
  expect(FakeXMLHttpRequest.last?.headers.get("X-CSRFToken")).toBe("test");
  expect(FakeXMLHttpRequest.last?.sent?.get("people_recognisable")).toBe(
    "false",
  );
  expect(
    (FakeXMLHttpRequest.last?.sent?.get("file") as File | null)?.name,
  ).toBe("photo.png");
});

// --- deleting a work item opened by mistake ---

function untouched() {
  return workItem({
    current_step: null,
    handover: null,
    last_progress: null,
    current_progress: null,
    current_user_participates: false,
    thread: [],
  });
}

it("deletes a work item opened by mistake, after a confirmation", async () => {
  setDocumentCookie("csrftoken=test; path=/");
  const fetchMock = vi.fn(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (path === "/api/auth/me/") {
        return json(identity());
      }
      if (path === "/api/work-items/10/" && options?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (path === "/api/work-items/10/") {
        return json(untouched());
      }
      return json([]);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const router = createMemoryRouter(routes, {
    initialEntries: ["/work-items/10"],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  await userEvent.click(
    await screen.findByRole("button", { name: "Supprimer ce chantier" }),
  );
  expect(
    screen.getByText("Le chantier disparaît, son nom pourra être rouvert."),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Supprimer" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(
    fetchMock.mock.calls.some(
      ([path, options]) =>
        path === "/api/work-items/10/" && options?.method === "DELETE",
    ),
  ).toBe(true);
});

it("offers no deletion once the work item has a trace", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === "/api/auth/me/" ? json(identity()) : json(workItem()),
    ),
  );
  renderWorkItem();

  expect(
    await screen.findByRole("heading", { name: "Intake", level: 1 }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Supprimer ce chantier" }),
  ).toBeNull();
});
