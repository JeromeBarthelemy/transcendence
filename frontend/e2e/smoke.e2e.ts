import { expect, test } from "@playwright/test";

// seed_demo's shared password and one of its students.
const PASSWORD = "rouage-demo-2026";

test("a student signs in and lands on their team's home", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("E-mail ou nom d'affichage").fill("Lina");
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Équipe 24601 · Rouages" }),
  ).toBeVisible();
});
