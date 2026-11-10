import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { parseConjugation } from "../../server/conjugation.mjs";
import { createApp } from "../../server/app.mjs";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("PWA compilée : carnet consultable et rechargement sans réseau", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "caderno-offline-"));
  const { app, db } = createApp({
    dataDir: dir,
    origin: "http://localhost:4173",
  });
  const imported = {
    ...parseConjugation(
      readFileSync("tests/fixtures/dirigir.html", "utf8"),
      "dirigir",
    ),
    fr: "conduire",
  };
  db.prepare("INSERT INTO verbs VALUES (?,?)").run(
    "dirigir",
    JSON.stringify(imported),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(4173, "127.0.0.1", () => resolve(s));
  });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((r) => server.close(r));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("http://localhost:4173");
  await page.locator(".translator").waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page
    .locator("nav:visible")
    .getByRole("button", { name: "Mon carnet" })
    .click();
  await page.getByRole("button", { name: "Ajouter une fiche" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Portugais brésilien")
    .fill("memória");
  await page.getByRole("dialog").getByLabel("Français / sens").fill("mémoire");
  await page
    .getByRole("dialog")
    .getByLabel("Un exemple en contexte")
    .fill("Você parece feliz.");
  await page
    .getByRole("dialog")
    .getByLabel("Mes notes")
    .fill("Tu as l’air heureux. — Tatoeba, CC BY 2.0 FR");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await context.setOffline(true);
  await page.reload();
  await page.locator(".offline-banner").waitFor();
  await page
    .locator("nav:visible")
    .getByRole("button", { name: "Mon carnet" })
    .click();
  assert.match(await page.locator(".entry-card").textContent(), /memória/);
  await page.locator(".entry-card").click();
  assert.equal(
    await page
      .getByRole("dialog")
      .getByLabel("Un exemple en contexte")
      .inputValue(),
    "Você parece feliz.",
  );
  assert.match(
    await page.getByRole("dialog").getByLabel("Mes notes").inputValue(),
    /Tatoeba/,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Fermer", exact: true })
    .click();
  assert.equal(
    await page.getByRole("button", { name: "Ajouter une fiche" }).isDisabled(),
    true,
  );
  await page
    .locator("nav:visible")
    .getByRole("button", { name: "Verbes", exact: true })
    .click();
  assert.match(await page.locator(".conjugation-table").textContent(), /sou/);
  await page.getByLabel("Chercher un verbe").fill("dirigir");
  await page.locator(".verb-option").click();
  assert.match(
    await page.locator(".conjugation-table").textContent(),
    /dirijo/,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Ajouter un verbe", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Retirer ce verbe ajouté" })
      .isDisabled(),
    true,
  );
});
