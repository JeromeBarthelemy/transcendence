import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
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

const identity = {
  id: 1,
  display_name: "Lina",
  club_role: "student",
  is_club_admin: false,
  avatar: null,
  team_seasons: [],
};

const TITLE = "Des questions sur le règlement du club ?";

function stubApi(
  ask: (init?: RequestInit) => Response | Promise<Response>,
  glossary: () => Response | Promise<Response> = () => json([]),
) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/auth/me/") return json(identity);
    if (path === "/api/rules/ask/" && init?.method === "POST") return ask(init);
    if (path === "/api/rules/glossary/") return glossary();
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
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
  // jsdom lays nothing out: an element has no scrollTo of its own.
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setDocumentCookie("csrftoken=; Max-Age=0; path=/");
});

it("opens from the header and sends the question with Enter", async () => {
  const user = userEvent.setup();
  let reply: (response: Response) => void = () => {};
  const fetchMock = stubApi(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );

  renderAt("/");
  await user.click(await screen.findByRole("link", { name: "Fieldbot" }));
  const heading = await screen.findByRole("heading", { name: TITLE });
  expect(heading.className).not.toContain("sr-only");

  const box = screen.getByLabelText("Votre question sur le règlement");
  await user.type(box, "Peut-on toucher{Shift>}{Enter}{/Shift}le robot ?");
  // Shift+Enter breaks the line rather than sending.
  expect(
    fetchMock.mock.calls.some(([path]) => path === "/api/rules/ask/"),
  ).toBe(false);
  await user.keyboard("{Enter}");

  const [, init] =
    fetchMock.mock.calls.find(([path]) => path === "/api/rules/ask/") ?? [];
  expect(JSON.parse(String(init?.body))).toEqual({
    question: "Peut-on toucher\nle robot ?",
  });
  expect(new Headers(init?.headers).get("X-CSRFToken")).toBe("test-token");
  expect((box as HTMLTextAreaElement).value).toBe("");

  // The title steps aside for the conversation, the question shows with its
  // author's name, and Fieldbot says it is looking.
  expect(heading.className).toContain("sr-only");
  const log = screen.getByRole("log", { name: "Conversation avec Fieldbot" });
  expect(within(log).getByText("Lina")).toBeTruthy();
  expect(within(log).getByText(/Peut-on toucher/)).toBeTruthy();
  expect(within(log).getByRole("status").textContent).toBe(
    "Fieldbot cherche dans le règlement…",
  );
  expect(
    screen.getByRole("button", { name: "Envoyer la question" }),
  ).toHaveProperty("disabled", true);

  reply(
    json(
      {
        question: "Peut-on toucher\nle robot ?",
        answer: "",
        citations: [
          {
            rank: 1,
            reference: "G420",
            text: "Do not tip or entangle.",
            source: "game_manual",
            authority: "binding",
            document_title: "Manuel BioBuzz TU02",
            url: "https://ftc-resources.firstinspires.org/manual.htm#G420",
          },
          {
            rank: 2,
            reference: "Q44",
            text: "Blue robot over their gate…",
            source: "official_qa",
            authority: "ruling",
            document_title: "Q&A BioBuzz",
            url: null,
          },
        ],
      },
      201,
    ),
  );

  const citations = await within(log).findByRole("list", {
    name: "Passages cités",
  });
  const items = within(citations).getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual([
    "G420Manuel de jeu · fait foiManuel BioBuzz TU02Do not tip or entangle.Voir dans le manuel",
    "Q44Q&A officiel · décision officielleQ&A BioBuzzBlue robot over their gate…",
  ]);
  // Only the citation with a URL gets a link out to FIRST's own page.
  expect(
    within(items[0]).getByRole("link", { name: "Voir dans le manuel" }),
  ).toHaveProperty(
    "href",
    "https://ftc-resources.firstinspires.org/manual.htm#G420",
  );
  expect(within(items[1]).queryByRole("link")).toBeNull();
  expect(within(log).queryByRole("status")).toBeNull();
});

it("shows the generated answer above its citations", async () => {
  const user = userEvent.setup();
  stubApi(() =>
    json(
      {
        question: "Les robots peuvent-ils se toucher ?",
        answer:
          "Oui, un contact fortuit entre coéquipiers n'est pas une infraction [Q45].",
        citations: [
          {
            rank: 1,
            reference: "Q45",
            text: "Two robots touching during autonomous…",
            source: "official_qa",
            authority: "ruling",
            document_title: "Q&A BioBuzz",
            url: null,
          },
        ],
      },
      201,
    ),
  );

  renderAt("/fieldbot");
  await user.type(
    await screen.findByLabelText("Votre question sur le règlement"),
    "Les robots peuvent-ils se toucher ?{Enter}",
  );

  const log = screen.getByRole("log", { name: "Conversation avec Fieldbot" });
  expect(
    await within(log).findByText(
      "Oui, un contact fortuit entre coéquipiers n'est pas une infraction [Q45].",
    ),
  ).toBeTruthy();
  expect(within(log).getByText("Passages cités :")).toBeTruthy();
  expect(
    within(log).getByRole("list", { name: "Passages cités" }),
  ).toBeTruthy();
});

it("shows the server's own sentence when nothing could be cited", async () => {
  const user = userEvent.setup();
  const refusal =
    "Le manuel et le Q&A officiel ne disent rien d'assez sûr sur cette question. Consultez le Q&A officiel de FIRST pour une réponse engageante.";
  stubApi(() =>
    json({ question: "Quelle heure ?", answer: refusal, citations: [] }, 201),
  );

  renderAt("/fieldbot");
  await user.type(
    await screen.findByLabelText("Votre question sur le règlement"),
    "Quelle heure ?",
  );
  await user.click(screen.getByRole("button", { name: "Envoyer la question" }));

  expect(await screen.findByText(refusal)).toBeTruthy();
});

it("shows a refusal by its code in Fieldbot's reply", async () => {
  const user = userEvent.setup();
  stubApi(() =>
    json(
      {
        detail: { code: "no_season", message: "Aucune saison n'est ouverte." },
      },
      400,
    ),
  );

  renderAt("/fieldbot");
  await user.type(
    await screen.findByLabelText("Votre question sur le règlement"),
    "Une question{Enter}",
  );

  const log = screen.getByRole("log");
  expect((await within(log).findByRole("alert")).textContent).toBe(
    "Aucune saison n'est ouverte.",
  );
});

it("does not send a question made of blanks", async () => {
  const user = userEvent.setup();
  const fetchMock = stubApi(() => json({}));

  renderAt("/fieldbot");
  await user.type(
    await screen.findByLabelText("Votre question sur le règlement"),
    "   {Enter}",
  );

  expect(
    screen.getByRole("button", { name: "Envoyer la question" }),
  ).toHaveProperty("disabled", true);
  expect(screen.queryByRole("log")).toBeNull();
  expect(
    fetchMock.mock.calls.some(([path]) => path === "/api/rules/ask/"),
  ).toBe(false);
});

it("scrolls the conversation's own box to its end on each reply, not the page", async () => {
  const user = userEvent.setup();
  stubApi(() =>
    json({ question: "Quelle heure ?", answer: "Midi.", citations: [] }, 201),
  );

  renderAt("/fieldbot");
  await user.type(
    await screen.findByLabelText("Votre question sur le règlement"),
    "Quelle heure ?",
  );
  await user.click(screen.getByRole("button", { name: "Envoyer la question" }));
  await screen.findByText("Midi.");

  // Once for the question, once for its reply, both on the log itself.
  const log = screen.getByRole("log", { name: "Conversation avec Fieldbot" });
  const scrollTo = vi.mocked(Element.prototype.scrollTo);
  expect(scrollTo).toHaveBeenCalledTimes(2);
  expect(scrollTo.mock.contexts.at(-1)).toBe(log);
  expect(scrollTo).toHaveBeenLastCalledWith({
    top: log.scrollHeight,
    behavior: "smooth",
  });
  // The main element is what fits the layout to the window.
  expect(log.closest("main")?.className).toContain("fieldbot-page");
});

it("takes one question at a time, keeping the next one until the answer is in", async () => {
  const user = userEvent.setup();
  let reply: (response: Response) => void = () => {};
  const fetchMock = stubApi(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const asked = () =>
    fetchMock.mock.calls.filter(([path]) => path === "/api/rules/ask/");

  renderAt("/fieldbot");
  const box = await screen.findByLabelText("Votre question sur le règlement");
  await user.type(box, "How long is AUTO?{Enter}");
  expect(asked()).toHaveLength(1);

  // The first answer is still pending: a second question can be written,
  // but neither the button nor Enter sends it.
  await user.type(box, "And TELEOP?");
  const send = screen.getByRole("button", { name: "Envoyer la question" });
  expect(send).toHaveProperty("disabled", true);
  await user.keyboard("{Enter}");
  expect(asked()).toHaveLength(1);
  expect((box as HTMLTextAreaElement).value).toBe("And TELEOP?");

  reply(
    json(
      { question: "How long is AUTO?", answer: "30 s.", citations: [] },
      201,
    ),
  );
  await screen.findByText("30 s.");

  expect(send).toHaveProperty("disabled", false);
  await user.keyboard("{Enter}");
  expect(asked()).toHaveLength(2);
  expect(JSON.parse(String(asked()[1][1]?.body))).toEqual({
    question: "And TELEOP?",
  });
});

it("hides the glossary panel when the season has no terms yet", async () => {
  stubApi(() =>
    json({ question: "?", answer: "Réponse.", citations: [] }, 201),
  );

  renderAt("/fieldbot");
  await screen.findByLabelText("Votre question sur le règlement");

  expect(screen.queryByText("Termes du manuel")).toBeNull();
});

it("lists the manual's glossary and inserts a clicked term into the question", async () => {
  const user = userEvent.setup();
  stubApi(
    () => json({ question: "HIVE?", answer: "", citations: [] }, 201),
    () =>
      json([
        { term: "HIVE", definition: "the structure robots score into" },
        { term: "AUTO", definition: "the first 30 seconds of a MATCH" },
      ]),
  );

  renderAt("/fieldbot");
  const summary = await screen.findByText("Termes du manuel");
  await user.click(summary);
  expect(screen.getByText("the structure robots score into")).toBeTruthy();

  const box = screen.getByLabelText("Votre question sur le règlement");
  await user.type(box, "Can a");
  await user.click(
    screen.getByRole("button", { name: "Insérer HIVE dans la question" }),
  );
  expect((box as HTMLTextAreaElement).value).toBe("Can a HIVE");

  await user.click(
    screen.getByRole("button", { name: "Insérer AUTO dans la question" }),
  );
  expect((box as HTMLTextAreaElement).value).toBe("Can a HIVE AUTO");
});

it("shows the large sphere only until the conversation starts", async () => {
  const user = userEvent.setup();
  stubApi(() =>
    json({ question: "Quelle heure ?", answer: "Midi.", citations: [] }, 201),
  );

  renderAt("/fieldbot");
  const field = await screen.findByLabelText("Votre question sur le règlement");
  expect(document.querySelector(".fieldbot-sphere-lg")).not.toBeNull();

  await user.type(field, "Quelle heure ?");
  await user.click(screen.getByRole("button", { name: "Envoyer la question" }));

  expect(await screen.findByText("Midi.")).toBeTruthy();
  expect(document.querySelector(".fieldbot-sphere-lg")).toBeNull();
  // Each answer keeps its own small one.
  expect(document.querySelector(".fieldbot-sphere-sm")).not.toBeNull();
});
