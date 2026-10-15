import { expect, mine, PASSWORD, test } from "./fixtures";

// Signed out: each test signs in for real at most once, against the limit of
// ten attempts a minute (auth.setup.ts).

test.describe("refused sign-in", () => {
  // Chrome and Firefox log the API's 400 as a failed resource.
  test.use({ allowConsole: [/status of 400/] });

  test("a wrong password is refused, and says so", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail ou nom d'affichage").fill("Lina");
    await page.getByLabel("Mot de passe").fill("pas-le-bon");
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(
      page.getByText("Identifiant ou mot de passe incorrect."),
    ).toBeVisible();
  });
});

test("a member signs in by display name, then signs out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail ou nom d'affichage").fill("Tom");
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Équipe 24601 · Rouages" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Menu du compte (Tom)" }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();

  await expect(
    page.getByRole("link", { name: "J'ai déjà un compte" }),
  ).toBeVisible();
});

test("a newcomer signs up", async ({ page }) => {
  const name = mine("Nouveau");
  await page.goto("/");
  await page.getByRole("link", { name: "Créer mon compte" }).click();

  await page.getByLabel("Prénom").fill("Camille");
  await page.getByLabel("Nom", { exact: true }).fill("Martin");
  await page.getByLabel("Date de naissance").fill("2010-05-04");
  await page.getByLabel("Nom d'affichage").fill(name);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirmer le mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  await expect(
    page.getByRole("heading", { name: "Bienvenue sur Fieldnotes." }),
  ).toBeVisible();
  await expect(page.getByText(`« ${name} »`)).toBeVisible();
});

test("the privacy policy and the terms open without an account", async ({
  page,
}) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await footer.getByRole("link", { name: "Confidentialité" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Politique de confidentialité",
    }),
  ).toBeVisible();

  await footer.getByRole("link", { name: "Conditions d'utilisation" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/terms$/);
});

test("an unknown address says so, with a way back", async ({ page }) => {
  await page.goto("/nulle-part");

  await expect(
    page.getByRole("heading", { name: "Page introuvable" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Retour à l'accueil" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the language changes everywhere and stays after a reload", async ({
  page,
}) => {
  await page.goto("/login");

  await page.getByLabel("Langue").selectOption("English");
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
    "Content de vous revoir.",
  );
  const english = await page.getByRole("heading", { level: 1 }).textContent();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    english ?? "",
  );

  await page.getByLabel("Language").selectOption("Français");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Content de vous revoir.",
  );
});
