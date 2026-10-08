import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { fieldClass } from "./Field";
import { ConfirmPanel, Notice } from "./Notice";
import { SectionTabs } from "./SectionTabs";

afterEach(cleanup);

it("names the confirmation by what will go, and only removes when confirmed", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmPanel
      message="Retirer cette remarque ?"
      cancelLabel="Annuler"
      confirmLabel="Retirer définitivement"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );

  const dialog = screen.getByRole("alertdialog", {
    name: "Retirer cette remarque ?",
  });
  expect(dialog).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Annuler" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onConfirm).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Retirer définitivement" }),
  );
  expect(onConfirm).toHaveBeenCalledOnce();
});

it("holds both choices while the removal is under way", () => {
  render(
    <ConfirmPanel
      message="Retirer ce fichier ?"
      cancelLabel="Annuler"
      confirmLabel="Retirer définitivement"
      pending
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );

  for (const button of screen.getAllByRole("button")) {
    expect(button).toHaveProperty("disabled", true);
  }
});

it("marks the current section, each one a link of its own", () => {
  render(
    <MemoryRouter>
      <SectionTabs
        label="Sections"
        current="activity"
        tabs={[
          { key: "work-items", label: "Chantiers", to: "/?section=work-items" },
          { key: "activity", label: "Activité", to: "/?section=activity" },
        ]}
      />
    </MemoryRouter>,
  );

  const current = screen.getByRole("link", { name: "Activité" });
  expect(current.getAttribute("aria-current")).toBe("page");
  expect(
    screen
      .getByRole("link", { name: "Chantiers" })
      .getAttribute("aria-current"),
  ).toBeNull();
});

it("moves the focus into the confirmation, on the choice that removes nothing", () => {
  render(
    <ConfirmPanel
      message="Supprimer définitivement l'équipe ?"
      cancelLabel="Annuler"
      confirmLabel="Supprimer l'équipe"
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Annuler" }),
  );
});

it("lets a message read in full keep the page's text size", () => {
  render(
    <>
      <Notice>Remarque</Notice>
      <Notice textSize="inherit">Passation</Notice>
    </>,
  );

  expect(screen.getByText("Remarque").className).toContain("text-sm");
  expect(screen.getByText("Passation").className).not.toContain("text-sm");
});

it("sizes every field at 16 px, under which iOS zooms in", () => {
  expect(fieldClass()).toContain("text-base");
  expect(fieldClass("warning")).toContain("text-base");
});
