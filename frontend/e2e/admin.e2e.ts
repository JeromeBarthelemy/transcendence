import { expect, sessionOf, test } from "./fixtures";

test.use({ storageState: sessionOf("Paul") });

// A FIRST number of its own per browser, the three sharing one database.
const NUMBERS: Record<string, number> = {
  chromium: 90001,
  firefox: 90002,
  webkit: 90003,
};

test("an administrator finds a member and opens their account", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Administration" }).click();
  await page.getByRole("link", { name: "Membres", exact: true }).click();

  await page.getByRole("searchbox", { name: "Rechercher" }).fill("tom");
  const list = page.getByRole("region", { name: /membres?$/ });
  await expect(list.getByRole("link")).toHaveCount(1);
  await list.getByRole("link", { name: /^Tom/ }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Tom" }),
  ).toBeVisible();
  const form = page.getByRole("form", { name: "Rôle et accès" });
  await expect(form.getByLabel("Élève")).toBeChecked();
  await expect(form.getByLabel("Compte actif")).toBeChecked();
});

test("an administrator creates, renames and deletes a team", async ({
  page,
}) => {
  const number = NUMBERS[test.info().project.name];
  await page.goto("/teams");

  const create = page.getByRole("form", { name: "Nouvelle équipe" });
  await create.getByLabel("Numéro FIRST").fill(String(number));
  await create.getByLabel("Nom").fill("Essai");
  await create.getByRole("button", { name: "Créer l'équipe" }).click();
  const team = page.getByRole("article", { name: `${number} · Essai` });
  await expect(team).toBeVisible();

  await team.getByRole("button", { name: "Renommer" }).click();
  await team.getByRole("textbox").fill("Essai renommé");
  await team.getByRole("button", { name: "Enregistrer" }).click();
  const renamed = page.getByRole("article", {
    name: `${number} · Essai renommé`,
  });
  await expect(renamed).toBeVisible();

  await renamed.getByRole("button", { name: "Supprimer" }).click();
  await renamed
    .getByRole("alertdialog")
    .getByRole("button", { name: "Supprimer l'équipe" })
    .click();
  await expect(renamed).toHaveCount(0);
});

test("an administrator sees the rulebook's sources", async ({ page }) => {
  await page.goto("/rules/sources");

  await expect(
    page.getByRole("heading", { level: 1, name: "Sources du règlement" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Manuel de jeu" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Vérifier maintenant" }),
  ).toBeVisible();
});
