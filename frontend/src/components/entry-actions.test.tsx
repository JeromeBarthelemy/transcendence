import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import "../i18n";
import { EntryActions } from "./EntryActions";

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = "csrftoken=; Max-Age=0; path=/";
});

function note(overrides: object = {}) {
  return {
    id: 41,
    type: "note",
    body: "Perceuse HS.",
    can_remove: true,
    can_correct: true,
    ...overrides,
  };
}

function renderActions(
  entry: ReturnType<typeof note>,
  respond: (path: string, options: RequestInit) => Response,
  currentBody = async () => "Perceuse HS.",
) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = "csrftoken=test; path=/";
  const fetchMock = vi.fn(async (path: string, options: RequestInit = {}) =>
    respond(path, options),
  );
  vi.stubGlobal("fetch", fetchMock);
  const onChanged = vi.fn(async () => {});
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EntryActions
        entry={entry}
        onChanged={onChanged}
        currentBody={currentBody}
      >
        <p>{entry.body}</p>
      </EntryActions>
    </QueryClientProvider>,
  );
  return { fetchMock, onChanged };
}

const sent = (fetchMock: ReturnType<typeof vi.fn>, method: string) =>
  fetchMock.mock.calls.filter(([, options]) => options?.method === method);

it("shows only the actions its reader is allowed", () => {
  renderActions(note({ can_remove: true, can_correct: false }), () => json({}));

  expect(screen.getByRole("button", { name: "Retirer" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Corriger" })).toBeNull();
});

it("shows nothing to a reader allowed nothing", () => {
  renderActions(note({ can_remove: false, can_correct: false }), () =>
    json({}),
  );

  expect(screen.queryByRole("button")).toBeNull();
});

it("removes a trace once confirmed", async () => {
  const { fetchMock, onChanged } = renderActions(
    note(),
    () => new Response(null, { status: 204 }),
  );

  await userEvent.click(screen.getByRole("button", { name: "Retirer" }));
  expect(screen.getByText("Retirer cette remarque ?")).toBeTruthy();
  expect(sent(fetchMock, "DELETE")).toHaveLength(0);
  await userEvent.click(
    screen.getByRole("button", { name: "Retirer définitivement" }),
  );

  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(sent(fetchMock, "DELETE")[0]?.[0]).toBe("/api/entries/41/");
});

it("says a progress goes with its participants and files", async () => {
  renderActions(note({ type: "progress" }), () => json({}));

  await userEvent.click(screen.getByRole("button", { name: "Retirer" }));

  expect(
    screen.getByText(
      "Retirer cette avancée, avec ses participants et ses fichiers ?",
    ),
  ).toBeTruthy();
});

it("corrects a text from the version it was opened on", async () => {
  const { fetchMock, onChanged } = renderActions(note(), (_, options) =>
    json({ ...note(), body: JSON.parse(String(options.body)).body }),
  );

  await userEvent.click(screen.getByRole("button", { name: "Corriger" }));
  const text = screen.getByLabelText("Corriger le texte");
  await userEvent.clear(text);
  await userEvent.type(text, "Perceuse à changer.");
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  const [path, options] = sent(fetchMock, "PATCH")[0] ?? [];
  expect(path).toBe("/api/entries/41/");
  expect(JSON.parse(String(options?.body))).toEqual({
    body: "Perceuse à changer.",
    body_was: "Perceuse HS.",
  });
  expect(screen.queryByLabelText("Corriger le texte")).toBeNull();
});

it("after a refusal, shows the text as it now is and corrects from it", async () => {
  let refused = false;
  const { fetchMock } = renderActions(
    note(),
    () => {
      if (!refused) {
        refused = true;
        return json(
          {
            detail: {
              code: "entry_changed",
              message: "Ce texte a été modifié pendant que vous le corrigiez.",
            },
          },
          409,
        );
      }
      return json(note());
    },
    async () => "Perceuse HS. Mèche de 4 cassée.",
  );

  await userEvent.click(screen.getByRole("button", { name: "Corriger" }));
  const text = screen.getByLabelText("Corriger le texte");
  await userEvent.clear(text);
  await userEvent.type(text, "Perceuse à changer.");
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Perceuse HS. Mèche de 4 cassée.",
  );
  expect((text as HTMLTextAreaElement).value).toBe("Perceuse à changer.");
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

  await waitFor(() => expect(sent(fetchMock, "PATCH")).toHaveLength(2));
  expect(JSON.parse(String(sent(fetchMock, "PATCH")[1]?.[1]?.body))).toEqual({
    body: "Perceuse à changer.",
    body_was: "Perceuse HS. Mèche de 4 cassée.",
  });
});
