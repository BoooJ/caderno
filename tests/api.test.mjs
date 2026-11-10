import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";

const origin = "https://caderno.test";
const sample = {
  pt: "café",
  fr: "café",
  kind: "mot",
  note: "Au café du quartier",
  example: "Um café, por favor.",
  favorite: true,
  source: "personnel",
};
async function setup(t, opts = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "caderno-"));
  const { app, db } = createApp({
    dataDir,
    password: "test-password-long-enough",
    origin,
    ...opts,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  async function request(path, method = "GET", body, headers = {}) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  }
  async function login() {
    const r = await request("/login", "POST", {
      password: "test-password-long-enough",
    });
    cookie = r.headers.get("set-cookie").split(";")[0];
    return r;
  }
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { request, login, db };
}
test("authentification, protection CSRF et invalidation de session", async (t) => {
  const { request, login } = await setup(t);
  assert.equal((await request("/entries")).status, 401);
  assert.equal(
    (await request("/login", "POST", { password: "wrong" })).status,
    401,
  );
  const auth = await login();
  assert.match(auth.headers.get("set-cookie"), /HttpOnly/);
  assert.match(auth.headers.get("set-cookie"), /SameSite=Strict/);
  assert.equal((await request("/entries")).status, 200);
  assert.equal(
    (await request("/entries", "POST", sample, { Origin: "https://evil.test" }))
      .status,
    403,
  );
  await request("/logout", "POST", {});
  assert.equal((await request("/entries")).status, 401);
});
test("fiches : création, modification, conflit, export, import sans écraser, suppression", async (t) => {
  const { request, login } = await setup(t);
  await login();
  assert.equal(
    (await request("/entries", "POST", { ...sample, pt: "" })).status,
    400,
  );
  const created = await request("/entries", "POST", sample);
  assert.equal(created.status, 201);
  const e = created.data;
  const updated = await request("/entries/" + e.id, "PUT", {
    ...e,
    note: "Nouvelle note",
  });
  assert.equal(updated.data.revision, 2);
  assert.equal((await request("/entries/" + e.id, "PUT", e)).status, 409);
  const backup = (await request("/export")).data;
  assert.equal(backup.entries[0].note, "Nouvelle note");
  assert.equal((await request("/import", "POST", backup)).data.added, 0);
  const imp = await request("/import", "POST", {
    ...backup,
    entries: [{ ...sample, pt: "obrigado", fr: "merci" }],
  });
  assert.equal(imp.data.added, 1);
  assert.equal(
    (await request("/entries/" + e.id, "DELETE", { revision: 1 })).status,
    409,
  );
  assert.equal(
    (await request("/entries/" + e.id, "DELETE", { revision: 2 })).status,
    200,
  );
  assert.equal((await request("/entries")).data.length, 1);
});
test("traduction : portugais brésilien, cache, caractères Unicode et quota persistant", async (t) => {
  let calls = 0;
  const { request, login, db } = await setup(t, {
    translateFetch: async (url) => {
      calls++;
      assert.equal(url.searchParams.get("langpair"), "fr|pt-BR");
      return Response.json({
        responseStatus: 200,
        responseData: { translatedText: "Ol&aacute;" },
      });
    },
  });
  await login();
  const body = { text: "Bonjour", direction: "fr-pt" };
  assert.equal((await request("/translate", "POST", body)).data.text, "Olá");
  assert.equal((await request("/translate", "POST", body)).data.cached, true);
  assert.equal(calls, 1);
  assert.equal((await request("/usage")).data.used, 7);
  assert.equal(
    (await request("/translate", "POST", { ...body, text: "é".repeat(251) }))
      .status,
    400,
  );
  db.prepare("UPDATE usage SET count=4500").run();
  assert.equal(
    (await request("/translate", "POST", { ...body, text: "Bonsoir" })).status,
    429,
  );
  assert.equal(calls, 1);
  assert.equal((await request("/translate", "POST", body)).status, 200);
});
test("échec fournisseur : pas de fausse traduction ni de résultat mis en cache", async (t) => {
  const { request, login, db } = await setup(t, {
    translateFetch: async () =>
      Response.json({ responseStatus: 403, responseDetails: "quota" }),
  });
  await login();
  const result = await request("/translate", "POST", {
    text: "Bonjour",
    direction: "fr-pt",
  });
  assert.equal(result.status, 502);
  assert.match(result.data.error, /indisponible/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM translations").get().n, 0);
});
import { readFileSync } from "node:fs";
import { parseConjugation } from "../server/conjugation.mjs";
const verbHtml = readFileSync(
  new URL("./fixtures/dirigir.html", import.meta.url),
  "utf8",
);

test("verbes : authentification, ajout réel via parseur, doublons, export/import et suppression", async (t) => {
  let calls = 0;
  const { request, login } = await setup(t, {
    conjugationFetch: async (url, options) => {
      calls++;
      assert.equal(url, "https://www.conjugacao.com.br/verbo-dirigir/");
      assert.equal(options.redirect, "error");
      return new Response(verbHtml);
    },
  });
  assert.equal((await request("/verbs")).status, 401);
  assert.equal(
    (await request("/verbs", "POST", { pt: "dirigir", fr: "conduire" })).status,
    401,
  );
  await login();
  assert.equal(
    (
      await request(
        "/verbs",
        "POST",
        { pt: "dirigir", fr: "conduire" },
        { Origin: "https://evil.test" },
      )
    ).status,
    403,
  );
  for (const pt of ["https://evil.test", "../dirigir", "lavar-se", ""])
    assert.equal(
      (await request("/verbs", "POST", { pt, fr: "test" })).status,
      400,
    );
  const result = await request("/verbs", "POST", {
    pt: " DIRIGIR ",
    fr: "conduire",
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.verb.present[0], "dirijo");
  assert.equal(result.data.verb.past[4], "dirigiram");
  assert.equal(result.data.verb.imperfect[3], "dirigíamos");
  assert.equal(
    (await request("/verbs", "POST", { pt: "dirigir", fr: "ne pas écraser" }))
      .data.added,
    false,
  );
  assert.equal(
    (await request("/verbs", "POST", { pt: "comecar", fr: "commencer" })).data
      .verb.pt,
    "começar",
  );
  assert.equal(calls, 1);
  assert.equal((await request("/verbs")).data[0].fr, "conduire");
  const backup = (await request("/export")).data;
  assert.equal(backup.verbs.length, 1);
  await request("/verbs/dirigir", "DELETE", {});
  assert.equal((await request("/verbs")).data.length, 0);
  assert.equal((await request("/import", "POST", backup)).data.verbsAdded, 1);
  assert.equal((await request("/import", "POST", backup)).data.verbsAdded, 0);
  assert.equal((await request("/verbs")).data[0].present[0], "dirijo");
  const invalid = structuredClone(backup);
  invalid.verbs[0].past = [];
  invalid.entries = [sample];
  assert.equal((await request("/import", "POST", invalid)).status, 400);
  assert.equal((await request("/entries")).data.length, 0);
  assert.equal(
    (
      await request("/import", "POST", {
        format: "caderno",
        version: 1,
        entries: [sample],
      })
    ).status,
    200,
  );
});

test("verbes : source absente ou incomplète, aucune conjugaison inventée ou enregistrée", async (t) => {
  let response = new Response("absent", { status: 404 });
  const { request, login } = await setup(t, {
    conjugationFetch: async () => response,
  });
  await login();
  assert.equal(
    (await request("/verbs", "POST", { pt: "dirigir", fr: "conduire" })).status,
    404,
  );
  response = new Response(verbHtml.replace("dirigíamos", "-"));
  assert.equal(
    (await request("/verbs", "POST", { pt: "dirigir", fr: "conduire" })).status,
    422,
  );
  response = new Response("x".repeat(1024 * 1024 + 1));
  assert.equal(
    (await request("/verbs", "POST", { pt: "dirigir", fr: "conduire" })).status,
    502,
  );
  response = new Response("error", { status: 503 });
  assert.equal(
    (await request("/verbs", "POST", { pt: "dirigir", fr: "conduire" })).status,
    502,
  );
  assert.equal((await request("/verbs")).data.length, 0);
  assert.throws(() => parseConjugation(verbHtml, "inventar"));
  assert.throws(() =>
    parseConjugation(
      verbHtml.replace("<span>nós</span>", "<span>eles</span>"),
      "dirigir",
    ),
  );
});
import { parseExamples, parseSynonyms } from "../server/context.mjs";
const synonymHtml = readFileSync(
  new URL("./fixtures/synonyms.html", import.meta.url),
  "utf8",
);
const sentenceJson = JSON.parse(
  readFileSync(new URL("./fixtures/tatoeba.json", import.meta.url), "utf8"),
);
test("compléments : sources, sens séparés, traductions directes, cache et protection", async (t) => {
  let calls = 0;
  const { request, login } = await setup(t, {
    contextFetch: async (url) => {
      calls++;
      const u = new URL(url);
      assert.ok(
        ["www.sinonimos.com.br", "api.tatoeba.org"].includes(u.hostname),
      );
      if (u.hostname === "api.tatoeba.org") {
        assert.equal(u.searchParams.get("trans:is_direct"), "yes");
        assert.equal(u.searchParams.get("q"), '"feliz"');
        return Response.json(sentenceJson);
      }
      return new Response(synonymHtml);
    },
  });
  const body = { pt: "feliz", query: "feliz", language: "pt" };
  assert.equal((await request("/context", "POST", body)).status, 401);
  await login();
  assert.equal(
    (await request("/context", "POST", body, { Origin: "https://evil.test" }))
      .status,
    403,
  );
  const first = await request("/context", "POST", body);
  assert.equal(first.status, 200);
  assert.equal(first.data.synonyms.groups.length, 2);
  assert.equal(first.data.synonyms.groups[0].words.length, 4);
  assert.equal(first.data.examples.items.length, 3);
  assert.equal(first.data.examples.items[0].ptAuthor, "carlosalberto");
  assert.equal(first.data.examples.items[0].fr, "Joyeux Noël, Tatoeba !");
  await request("/context", "POST", body);
  assert.equal(calls, 2);
  assert.equal((await request("/usage")).data.used, 0);
  const long = await request("/context", "POST", {
    pt: "uma frase muito longa",
    query: "a ".repeat(60),
    language: "pt",
  });
  assert.equal(long.data.synonyms.status, "unsupported");
  assert.equal(long.data.examples.status, "unsupported");
  assert.equal(calls, 2);
});
test("compléments : panne partielle, reprise, mots absents et liens indirects exclus", async (t) => {
  let fail = true;
  const { request, login } = await setup(t, {
    contextFetch: async (url) => {
      if (String(url).includes("sinonimos"))
        return new Response("", { status: 404 });
      if (fail) throw Error("offline");
      return Response.json({ data: [] });
    },
  });
  await login();
  const body = { pt: "feliz", query: "feliz", language: "pt" };
  const first = (await request("/context", "POST", body)).data;
  assert.equal(first.synonyms.status, "empty");
  assert.equal(first.examples.status, "unavailable");
  fail = false;
  assert.equal(
    (await request("/context", "POST", body)).data.examples.status,
    "empty",
  );
  const indirect = structuredClone(sentenceJson);
  indirect.data.forEach((s) =>
    s.translations.forEach((t) => (t.is_direct = false)),
  );
  assert.deepEqual(parseExamples(indirect), []);
  const rejected = structuredClone(sentenceJson);
  rejected.data.forEach((s) => (s.is_unapproved = true));
  assert.deepEqual(parseExamples(rejected), []);
  assert.deepEqual(parseSynonyms("<h1>Service indisponible</h1>"), []);
});
