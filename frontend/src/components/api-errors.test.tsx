import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ApiRequestError } from "../api/client";
import "../i18n";
import { FieldErrors, RequestError } from "./ApiErrors";

afterEach(cleanup);

it("keeps the catalogue translation when the code is known", () => {
  render(
    <FieldErrors
      id="field-error"
      issues={[
        { code: "bad_credentials", message: "Different server wording" },
      ]}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "Identifiant ou mot de passe incorrect.",
  );
});

it.each(["new_refusal", "constructor"])(
  "shows the server sentence for untranslated code %s",
  (code) => {
    render(
      <FieldErrors
        id="field-error"
        issues={[{ code, message: "Le fichier est refusé pour cette séance." }]}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Le fichier est refusé pour cette séance.",
    );
  },
);

it.each(["", "   "])(
  "keeps the generic message if the untranslated refusal has no usable sentence: %j",
  (message) => {
    render(
      <FieldErrors
        id="field-error"
        issues={[{ code: "new_refusal", message }]}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Une erreur inattendue est survenue.",
    );
  },
);

it("renders a server message as text, not HTML or an i18n template", () => {
  const message = "Fichier <img src=x onerror=alert(1)> refusé : {{name}}.";
  const { container } = render(
    <FieldErrors
      id="field-error"
      issues={[{ code: "new_refusal", message }]}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe(message);
  expect(container.querySelector("img")).toBeNull();
});

it.each(["detail", "non_field_errors", "file"])(
  "shows an untranslated request refusal on %s",
  (field) => {
    render(
      <RequestError
        error={
          new ApiRequestError(400, {
            [field]: [
              {
                code: "new_refusal",
                message: "Le serveur explique précisément son refus.",
              },
            ],
          })
        }
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Le serveur explique précisément son refus.",
    );
  },
);

it("shows general and unhandled field issues, without repeating a handled field", () => {
  render(
    <RequestError
      handledFields={["username"]}
      error={
        new ApiRequestError(400, {
          detail: [{ code: "new_refusal", message: "Compte refusé." }],
          username: [
            { code: "required", message: "Déjà affiché sous le champ." },
          ],
          new_field: [
            { code: "new_refusal", message: "Nouveau champ refusé." },
          ],
        })
      }
    />,
  );
  expect(screen.getByText("Compte refusé.")).toBeTruthy();
  expect(screen.getByText("Nouveau champ refusé.")).toBeTruthy();
  expect(screen.queryByText("Ce champ est obligatoire.")).toBeNull();
});

it("does not repeat errors that the form handles under its inputs", () => {
  const { container } = render(
    <RequestError
      handledFields={["file"]}
      error={
        new ApiRequestError(400, {
          file: [{ code: "new_refusal", message: "Affiché sous le fichier." }],
        })
      }
    />,
  );
  expect(container.textContent).toBe("");
});

it.each([
  new ApiRequestError(500, {}),
  new Error("Internal diagnostic, not a server refusal"),
])("keeps unexpected failures generic", (error) => {
  render(<RequestError error={error} />);
  expect(screen.getByRole("alert").textContent).toBe(
    "Une erreur inattendue est survenue.",
  );
});

it("keeps a network failure distinct from a server refusal", () => {
  render(<RequestError error={new TypeError("Failed to fetch")} />);
  expect(screen.getByRole("alert").textContent).toBe(
    "Impossible de joindre le serveur. Réessayez dans un instant.",
  );
});
