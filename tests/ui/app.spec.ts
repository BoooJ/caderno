import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/context", (route) =>
    route.fulfill({
      json: {
        synonyms: { status: "empty", groups: [] },
        examples: { status: "empty", items: [] },
      },
    }),
  );
});

test("catalogue étendu : recherche française sans accents et futur proche correct", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("nav:visible")
    .getByRole("button", { name: "Verbes", exact: true })
    .click();
  await expect(page.locator(".verb-option")).toHaveCount(60);
  await expect(page.locator(".verb-count")).toContainText("60 / 60");
  await page.getByLabel("Chercher un verbe").fill("reussir");
  await expect(page.locator(".verb-option")).toHaveCount(1);
  await page.locator(".verb-option").click();
  await expect(page.locator(".conjugation-table")).toContainText("consigo");
  await page
    .getByRole("combobox", { name: "Temps", exact: true })
    .selectOption("near");
  await expect(page.locator(".conjugation-table")).toContainText(
    "vou conseguir",
  );
  await page.getByLabel("Chercher un verbe").fill("comecar");
  await page.locator(".verb-option").click();
  await page
    .getByRole("combobox", { name: "Temps", exact: true })
    .selectOption("past");
  await expect(page.locator(".conjugation-table")).toContainText("comecei");
  await page
    .getByRole("button", { name: "Ajouter ce verbe au carnet" })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Portugais brésilien"),
  ).toHaveValue("começar");
  await expect(
    page.getByRole("dialog").getByLabel("Un exemple en contexte"),
  ).toHaveValue("A aula começa às nove.");
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByLabel("Chercher un verbe").fill("zzzz");
  await expect(
    page.getByText("Ce verbe n’est pas encore dans cette sélection."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("carnet réel : création, recherche, rechargement, édition et suppression", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.locator("nav:visible");
  await nav.getByRole("button", { name: "Mon carnet" }).click();
  await page.getByRole("button", { name: "Ajouter une fiche" }).click();
  const dialog = page.getByRole("dialog");
  const unique = `teste-${Date.now()}`;
  await dialog.getByLabel("Portugais brésilien").fill(unique);
  await dialog.getByLabel("Français / sens").fill("Un test de sauvegarde");
  await dialog.getByLabel("Mes notes").fill("Une note personnelle");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page
    .locator("nav:visible")
    .getByRole("button", { name: "Mon carnet" })
    .click();
  await page.getByLabel("Rechercher dans mon carnet").fill(unique);
  await page.locator(".entry-card").filter({ hasText: unique }).click();
  await expect(dialog.getByLabel("Mes notes")).toHaveValue(
    "Une note personnelle",
  );
  await dialog.getByLabel("Mes notes").fill("Une note modifiée");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await page.locator(".entry-card").filter({ hasText: unique }).click();
  await expect(dialog.getByLabel("Mes notes")).toHaveValue("Une note modifiée");
  await dialog.getByRole("button", { name: "Supprimer", exact: true }).click();
  await dialog.getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(
    page.locator(".entry-card").filter({ hasText: unique }),
  ).toHaveCount(0);
});
test("traduction, inversion, verbes et absence de débordement sur mobile", async ({
  page,
}) => {
  await page.route("**/api/translate", (route) =>
    route.fulfill({
      json: { text: "Olá", cached: false, quota: { used: 7, limit: 4500 } },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Texte à traduire").fill("Bonjour");
  await page
    .locator("form")
    .getByRole("button", { name: "Traduire", exact: true })
    .click();
  await expect(page.locator(".translation-result")).toContainText("Olá");
  await page.getByRole("button", { name: "Garder dans mon carnet" }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Portugais brésilien"),
  ).toHaveValue("Olá");
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: "Inverser les langues" }).click();
  await expect(page.getByLabel("Texte à traduire")).toHaveValue("Olá");
  await page
    .locator("nav:visible")
    .getByRole("button", { name: "Verbes", exact: true })
    .click();
  await page.getByRole("button", { name: "ter avoir" }).click();
  await expect(page.locator(".conjugation-table")).toContainText("tenho");
  await page
    .getByRole("combobox", { name: "Temps", exact: true })
    .selectOption("past");
  await expect(page.locator(".conjugation-table")).toContainText("tive");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("erreur de traduction présentée sans résultat inventé", async ({
  page,
}) => {
  await page.route("**/api/translate", (route) =>
    route.fulfill({
      status: 502,
      json: { error: "Service indisponible. Réessaie plus tard." },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Texte à traduire").fill("Bonjour");
  await page
    .locator("form")
    .getByRole("button", { name: "Traduire", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Service indisponible");
  await expect(page.locator(".translation-result")).toHaveCount(0);
});
import { readFileSync } from "node:fs";
import { parseConjugation } from "../../server/conjugation.mjs";
const importedVerb = {
  ...parseConjugation(
    readFileSync("tests/fixtures/dirigir.html", "utf8"),
    "dirigir",
  ),
  fr: "conduire",
};

test("ajout de verbe : formulaire, erreur, doublon, temps, rechargement et retrait", async ({
  page,
}) => {
  let custom: (typeof importedVerb)[] = [];
  let posts = 0;
  await page.route("**/api/verbs", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: custom });
    posts++;
    if (posts === 1)
      return route.fulfill({
        status: 404,
        json: { error: "Verbe introuvable. Vérifie l’infinitif portugais." },
      });
    const added = custom.length === 0;
    custom = [importedVerb];
    return route.fulfill({
      status: added ? 201 : 200,
      json: { verb: importedVerb, added },
    });
  });
  await page.route("**/api/verbs/dirigir", async (route) => {
    custom = [];
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  const openVerbs = () =>
    page
      .locator("nav:visible")
      .getByRole("button", { name: "Verbes", exact: true })
      .click();
  await openVerbs();
  await page
    .getByRole("button", { name: "Ajouter un verbe", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Infinitif portugais").fill("dirigir");
  await dialog.getByLabel("Sens en français").fill("conduire");
  await dialog
    .getByRole("button", { name: "Ajouter avec les conjugaisons" })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Verbe introuvable");
  await dialog
    .getByRole("button", { name: "Ajouter avec les conjugaisons" })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".conjugation-table")).toContainText("dirijo");
  for (const [tense, expected] of [
    ["past", "dirigi"],
    ["imperfect", "dirigíamos"],
    ["near", "vou dirigir"],
  ]) {
    await page
      .getByRole("combobox", { name: "Temps", exact: true })
      .selectOption(tense);
    await expect(page.locator(".conjugation-table")).toContainText(expected);
  }
  await page.reload();
  await openVerbs();
  await page.getByLabel("Chercher un verbe").fill("conduire");
  await expect(page.locator(".verb-option")).toHaveCount(1);
  await page.locator(".verb-option").click();
  await expect(page.locator(".conjugation-table")).toContainText("dirijo");
  await page
    .getByRole("button", { name: "Ajouter un verbe", exact: true })
    .click();
  await dialog.getByLabel("Infinitif portugais").fill("dirigir");
  await dialog.getByLabel("Sens en français").fill("conduire");
  await dialog
    .getByRole("button", { name: "Ajouter avec les conjugaisons" })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".verb-option")).toHaveCount(61);
  await page.getByRole("button", { name: "Retirer ce verbe ajouté" }).click();
  await dialog.getByRole("button", { name: "Oui, retirer" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".verb-option")).toHaveCount(60);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("synonymes et exemples : raccourci, sauvegarde complète, navigation et absence de résultats périmés", async ({
  page,
}) => {
  const example = {
    pt: "Você parece feliz.",
    fr: "Tu as l’air heureux.",
    ptId: 4600639,
    frId: 4602248,
    ptAuthor: "KimiP",
    frAuthor: "sicerabibax",
    ptLicense: "CC BY 2.0 FR",
    frLicense: "CC BY 2.0 FR",
  };
  await page.route("**/api/translate", (route) =>
    route.fulfill({
      json: { text: "feliz", cached: false, quota: { used: 7, limit: 4500 } },
    }),
  );
  await page.route("**/api/context", (route) =>
    route.fulfill({
      json: {
        synonyms: {
          status: "ready",
          source: "https://www.sinonimos.com.br/feliz/",
          groups: [
            { sense: "Que denota alegria:", words: ["alegre", "contente"] },
          ],
        },
        examples: { status: "ready", items: [example] },
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Texte à traduire").fill("heureux");
  await page.getByLabel("Texte à traduire").press("Control+Enter");
  const context = page.getByRole("region", { name: "Synonymes et exemples" });
  await expect(context).toContainText("Você parece feliz.");
  await page.getByRole("button", { name: "Garder avec cet exemple" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Portugais brésilien")).toHaveValue("feliz");
  await expect(dialog.getByLabel("Un exemple en contexte")).toHaveValue(
    example.pt,
  );
  await expect(dialog.getByLabel("Mes notes")).toHaveValue(/Tatoeba/);
  await expect(dialog.getByLabel("Mes notes")).toHaveValue(
    /Tu as l’air heureux/,
  );
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByText("Source et auteurs", { exact: true }).click();
  await expect(
    context.getByRole("link", { name: "Portugais : KimiP" }),
  ).toHaveAttribute("href", "https://tatoeba.org/fr/sentences/show/4600639");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Traduire le synonyme alegre" })
    .click();
  await expect(page.getByLabel("Texte à traduire")).toHaveValue("alegre");
  await expect(context).toHaveCount(0);
  await expect(page.locator(".translation-result")).toHaveCount(0);
});

test("compléments en panne : traduction utilisable et nouvelle tentative", async ({
  page,
}) => {
  let unavailable = true;
  await page.route("**/api/translate", (route) =>
    route.fulfill({
      json: { text: "feliz", cached: false, quota: { used: 7, limit: 4500 } },
    }),
  );
  await page.route("**/api/context", (route) => {
    return route.fulfill({
      json: {
        synonyms: {
          status: unavailable ? "unavailable" : "empty",
          groups: [],
        },
        examples: { status: "empty", items: [] },
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("Texte à traduire").fill("heureux");
  await page
    .locator("form")
    .getByRole("button", { name: "Traduire", exact: true })
    .click();
  await expect(
    page.getByText("Le dictionnaire est momentanément indisponible."),
  ).toBeVisible();
  await expect(page.locator(".translation-result")).toContainText("feliz");
  unavailable = false;
  await page.getByRole("button", { name: "Réessayer les compléments" }).click();
  await expect(
    page.getByText("Aucun synonyme trouvé pour ce mot dans cette source."),
  ).toBeVisible();
});
