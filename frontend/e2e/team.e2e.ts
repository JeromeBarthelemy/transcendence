import { expect, mine, sessionOf, test } from "./fixtures";

test.use({ storageState: sessionOf("Lina") });

test("the team's home lists its work items and each teammate once", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Équipe 24601 · Rouages" }),
  ).toBeVisible();
  const robot = page.getByRole("region", { name: "Robot" });
  await expect(robot.getByRole("heading", { name: "Intake" })).toBeVisible();
  await expect(robot.getByRole("heading", { name: "Bras" })).toBeVisible();
  // Drawn again after a change of filter: a roster drawn twice is a bug (#276).
  await page.getByLabel("Filtrer par statut").selectOption("Tous les statuts");
  await expect(page.getByRole("heading", { name: "Châssis" })).toBeVisible();
  for (const teammate of ["Inès", "Tom"]) {
    await expect(
      page.getByRole("link", { name: teammate, exact: true }),
    ).toHaveCount(1);
  }
});

test("opening a work item reaches a teammate live, and rings their bell", async ({
  page,
  pageAs,
}) => {
  const title = mine("Banc de test");
  const tom = await pageAs("Tom");
  await tom.goto("/");
  await expect(tom.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto("/");
  await page
    .getByRole("button", { name: "Ouvrir un nouveau chantier" })
    .click();
  const form = page.getByRole("region", { name: "Ouvrir un nouveau chantier" });
  await form
    .getByRole("combobox", { name: "Chantier" })
    .selectOption("Autre chantier…");
  await form.getByLabel("Nom").fill(title);
  await form.getByLabel("Hors robot").check();
  await form.getByRole("button", { name: "Ouvrir" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();

  // Without reloading: the socket tells Tom's page.
  await expect(
    tom
      .getByRole("region", { name: "Hors robot" })
      .getByRole("heading", { name: title }),
  ).toBeVisible();
  await tom.getByRole("button", { name: /^Notifications/ }).click();
  await expect(
    tom.getByRole("link", {
      name: new RegExp(`Lina a ouvert un chantier.*${title}`),
    }),
  ).toBeVisible();
});

test("a day's progress and a remark land in the work item's history", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("region", { name: "Hors robot" })
    .getByRole("link", { name: new RegExp(mine("Banc de test")) })
    .click();

  await page.getByRole("button", { name: /^(Commencer|Continuer)/ }).click();
  const today = page.getByRole("region", { name: "L'avancée d'aujourd'hui" });
  await today.getByLabel("Votre ajout").fill("Châssis du banc monté.");
  await today
    .getByLabel("À faire la prochaine fois")
    .fill("Brancher les capteurs.");
  await today.getByRole("button", { name: "Enregistrer l'avancée" }).click();

  const remark = page.getByRole("region", { name: "Ajouter une remarque" });
  await remark
    .getByLabel("Remarque sur ce chantier")
    .fill("Penser aux vis de rechange.");
  await remark.getByRole("button", { name: "Enregistrer la remarque" }).click();

  const history = page.getByRole("region", { name: "Historique" });
  await expect(history.getByText("Châssis du banc monté.")).toBeVisible();
  await expect(history.getByText("Brancher les capteurs.")).toBeVisible();
  await expect(history.getByText("Penser aux vis de rechange.")).toBeVisible();
});

test("the notebook opens a past session and finds a trace by its words", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Séance précédente" }).click();
  await expect(
    page.getByRole("region", { name: "Ce que la journée a produit" }),
  ).toBeVisible();
  const calendar = page.getByRole("region", { name: "Calendrier des séances" });
  const openCalendar = page.getByRole("button", {
    name: "Ouvrir le calendrier",
  });
  await expect(calendar).toHaveCount(0);
  await openCalendar.click();
  await expect(calendar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(openCalendar).toBeFocused();

  await page.goto("/");
  await page
    .getByRole("link", { name: "Rechercher dans les chantiers" })
    .click();
  await page.getByRole("searchbox", { name: "Texte" }).fill("entreprises");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "1 trace" }),
  ).toBeVisible();
  await expect(
    page.getByText("Liste des entreprises du coin à contacter."),
  ).toBeVisible();
});

test("Fieldbot answers, even before the manual is loaded", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Fieldbot" }).click();

  await page
    .getByLabel("Votre question sur le règlement")
    .fill("How long is AUTO?");
  await page.getByRole("button", { name: "Envoyer la question" }).click();

  const log = page.getByRole("log", { name: "Conversation avec Fieldbot" });
  await expect(log.getByText("How long is AUTO?")).toBeVisible();
  await expect(log).toContainText("pas encore chargé");
});

test.describe("offline", () => {
  // What the browser itself logs for a request made while cut off.
  test.use({ allowConsole: [/ERR_INTERNET_DISCONNECTED/] });

  test("losing the network says so, and coming back clears it", async ({
    page,
    context,
  }) => {
    const notice = page.getByText(
      "Hors ligne : les changements des autres arriveront à la reconnexion.",
    );
    await page.goto("/");
    // Loaded first: a request cut off midway shows its own loading status.
    await expect(page.getByRole("heading", { name: "Intake" })).toBeVisible();

    await context.setOffline(true);
    await expect(notice).toBeVisible();
    await context.setOffline(false);
    await expect(notice).toHaveCount(0);
  });
});
