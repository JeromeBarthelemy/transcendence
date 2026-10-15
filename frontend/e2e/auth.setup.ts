import { test as setup } from "@playwright/test";

import { type Member, PASSWORD, sessionOf } from "./fixtures";

// Once per run, not per browser: a session cookie is the same for all three.
for (const member of ["Lina", "Tom", "Paul"] satisfies Member[]) {
  setup(`sign ${member} in`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail ou nom d'affichage").fill(member);
    await page.getByLabel("Mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page
      .getByRole("button", { name: `Menu du compte (${member})` })
      .waitFor();
    await page.context().storageState({ path: sessionOf(member) });
  });
}
