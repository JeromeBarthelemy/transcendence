import { expect, mine, sessionOf, test } from "./fixtures";

// Relative to frontend/, where Playwright runs.
const photo = "e2e/photo.png";

test.describe("Tom's own profile", () => {
  test.use({ storageState: sessionOf("Tom") });

  test("a member renames themselves, and the header follows", async ({
    page,
  }) => {
    const name = mine("Tom");
    await page.goto("/profile");
    const form = page.getByRole("form", { name: "Modifier mon profil" });

    await form.getByLabel("Nom d'affichage").fill(name);
    await form.getByRole("button", { name: "Enregistrer" }).click();
    await expect(form.getByText("Profil mis à jour.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Menu du compte (${name})` }),
    ).toBeVisible();

    // Every other scenario knows him as Tom.
    await form.getByLabel("Nom d'affichage").fill("Tom");
    await form.getByRole("button", { name: "Enregistrer" }).click();
    await expect(
      page.getByRole("button", { name: "Menu du compte (Tom)" }),
    ).toBeVisible();
  });

  test("a member adds a photo, then removes it", async ({ page }) => {
    await page.goto("/profile");
    const region = page.getByRole("region", { name: "Photo de profil" });

    await region.getByLabel("Choisir une photo").setInputFiles(photo);
    await region.getByRole("button", { name: "Envoyer la photo" }).click();
    await expect(
      region.getByText("Votre nouvelle photo est enregistrée."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      region.getByRole("img", { name: "Votre photo de profil actuelle" }),
    ).toBeVisible();

    await region.getByRole("button", { name: "Supprimer la photo" }).click();
    await expect(
      region.getByText("Votre photo a été supprimée."),
    ).toBeVisible();
    await expect(region.getByText("Pas encore de photo")).toBeVisible();
  });

  test("a member asks for a copy of their data", async ({ page }) => {
    await page.goto("/profile");
    const region = page.getByRole("region", { name: "Données personnelles" });

    await region.getByRole("button", { name: "Exporter" }).click();

    await expect(region.getByRole("status")).toContainText(
      "parent.tom@demo.invalid",
    );
  });
});

test.describe("seeing a teammate", () => {
  test.use({ storageState: sessionOf("Lina") });

  test("a teammate's profile shows their team, and their dot while they are here", async ({
    page,
    pageAs,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Tom" }).first().click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Tom" }),
    ).toBeVisible();
    await expect(page.getByText("Équipe : 24601 · Rouages")).toBeVisible();
    await expect(page.getByRole("img", { name: "En ligne" })).toHaveCount(0);

    const tom = await pageAs("Tom");
    await tom.goto("/");
    await expect(page.getByRole("img", { name: "En ligne" })).toBeVisible();

    await tom.close();
    await expect(page.getByRole("img", { name: "En ligne" })).toHaveCount(0);
  });
});
