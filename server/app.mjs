import express from "express";
import helmet from "helmet";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import he from "he";
import { installContext } from "./context.mjs";
import builtinVerbs from "../shared/verbs.json" with { type: "json" };
import {
  verbKey,
  customVerbSchema,
  verbRequestSchema,
  fetchConjugation,
  ConjugationError,
} from "./conjugation.mjs";

const entrySchema = z.object({
  pt: z.string().trim().min(1).max(1000),
  fr: z.string().trim().min(1).max(1000),
  kind: z.enum(["mot", "expression", "verbe"]),
  note: z.string().max(4000).default(""),
  example: z.string().max(1000).default(""),
  favorite: z.boolean().default(false),
  source: z.enum(["personnel", "MyMemory"]).default("personnel"),
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function createApp({
  dataDir,
  password,
  origin,
  production = false,
  translateFetch = fetch,
  conjugationFetch = fetch,
  contextFetch = fetch,
}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(resolve(dataDir, "caderno.sqlite"));
  db.exec(
    `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS verbs(key TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS translations(key TEXT PRIMARY KEY, result TEXT NOT NULL); CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY, count INTEGER NOT NULL);`,
  );
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "upgrade-insecure-requests": production ? [] : null,
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  const permittedOrigins = new Set([
    origin,
    ...(production
      ? []
      : [
          "http://localhost:5173",
          "http://127.0.0.1:5173",
          "http://localhost:3090",
          "http://127.0.0.1:3090",
        ]),
  ]);
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      (!req.is("application/json") || !permittedOrigins.has(req.get("origin")))
    )
      return res.status(403).json({ error: "Origine de la requête refusée." });
    next();
  });
  const salt = randomBytes(16);
  const credential = password ? scryptSync(password, salt, 32) : null;
  const sessionHash = (req) => {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("caderno="))
      ?.slice(8);
    return token ? hash(token) : "";
  };
  const authenticated = (req) =>
    !credential ||
    !!db
      .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
      .get(sessionHash(req), Date.now());
  app.get("/api/session", (req, res) =>
    res.json({ authenticated: authenticated(req), local: !credential }),
  );
  let attempts = [];
  app.post("/api/login", (req, res) => {
    attempts = attempts.filter((time) => Date.now() - time < 15 * 60 * 1000);
    if (attempts.length >= 10)
      return res
        .status(429)
        .json({ error: "Trop de tentatives. Réessaie dans 15 minutes." });
    attempts.push(Date.now());
    if (
      !credential ||
      typeof req.body.password !== "string" ||
      req.body.password.length > 500 ||
      !timingSafeEqual(credential, scryptSync(req.body.password, salt, 32))
    )
      return res.status(401).json({ error: "Mot de passe incorrect." });
    attempts = [];
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?,?)").run(
      hash(token),
      Date.now() + 7 * 86400000,
    );
    res
      .cookie("caderno", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: production,
        maxAge: 7 * 86400000,
        path: "/",
      })
      .json({ ok: true });
  });
  app.use("/api", (req, res, next) =>
    authenticated(req)
      ? next()
      : res
          .status(401)
          .json({ error: "Connecte-toi pour accéder à ton carnet." }),
  );
  app.post("/api/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(sessionHash(req));
    res.clearCookie("caderno", { path: "/" }).json({ ok: true });
  });
  const readVerbs = () =>
    db
      .prepare("SELECT body FROM verbs ORDER BY key")
      .all()
      .map((row) => JSON.parse(row.body));
  const existingVerb = (key) =>
    builtinVerbs.find((v) => verbKey(v.pt) === key) ||
    readVerbs().find((v) => verbKey(v.pt) === key);
  const pendingVerbs = new Set();
  let verbAttempts = [];
  app.get("/api/verbs", (req, res) => res.json(readVerbs()));
  app.post("/api/verbs", async (req, res) => {
    const { pt, fr } = verbRequestSchema.parse(req.body);
    const key = verbKey(pt),
      existing = existingVerb(key);
    if (existing) return res.json({ verb: existing, added: false });
    if (pendingVerbs.has(key))
      return res.status(409).json({
        error: "Ce verbe est déjà en cours d’ajout. Patiente un instant.",
      });
    verbAttempts = verbAttempts.filter((time) => Date.now() - time < 60000);
    if (verbAttempts.length >= 10)
      return res.status(429).json({
        error: "Patiente une minute avant d’ajouter d’autres verbes.",
      });
    verbAttempts.push(Date.now());
    pendingVerbs.add(key);
    try {
      const verb = customVerbSchema.parse({
        ...(await fetchConjugation(pt, conjugationFetch)),
        fr,
      });
      // Another request or an import may have saved it while the source was loading.
      const saved = existingVerb(key);
      if (saved) return res.json({ verb: saved, added: false });
      db.prepare("INSERT INTO verbs VALUES (?,?)").run(
        key,
        JSON.stringify(verb),
      );
      res.status(201).json({ verb, added: true });
    } finally {
      pendingVerbs.delete(key);
    }
  });
  app.delete("/api/verbs/:pt", (req, res) => {
    db.prepare("DELETE FROM verbs WHERE key=?").run(verbKey(req.params.pt));
    res.json({ ok: true });
  });
  installContext(app, db, contextFetch);
  const readEntries = () =>
    db
      .prepare("SELECT * FROM entries ORDER BY created DESC")
      .all()
      .map((row) => ({
        ...JSON.parse(row.body),
        id: row.id,
        revision: row.revision,
        created: row.created,
      }));
  app.get("/api/entries", (req, res) => res.json(readEntries()));
  app.post("/api/entries", (req, res) => {
    const entry = entrySchema.parse(req.body),
      id = randomUUID(),
      created = new Date().toISOString();
    db.prepare("INSERT INTO entries VALUES (?,?,1,?)").run(
      id,
      JSON.stringify(entry),
      created,
    );
    res.status(201).json({ ...entry, id, revision: 1, created });
  });
  app.put("/api/entries/:id", (req, res) => {
    const entry = entrySchema.parse(req.body),
      revision = z.number().int().positive().parse(req.body.revision);
    const result = db
      .prepare(
        "UPDATE entries SET body=?,revision=revision+1 WHERE id=? AND revision=?",
      )
      .run(JSON.stringify(entry), req.params.id, revision);
    if (!result.changes)
      return res.status(409).json({
        error:
          "Cette fiche a changé sur un autre appareil. Ferme-la puis actualise le carnet avant de réessayer.",
      });
    res.json(readEntries().find((e) => e.id === req.params.id));
  });
  app.delete("/api/entries/:id", (req, res) => {
    const revision = z.number().int().positive().parse(req.body.revision);
    const result = db
      .prepare("DELETE FROM entries WHERE id=? AND revision=?")
      .run(req.params.id, revision);
    if (!result.changes)
      return res.status(409).json({
        error:
          "Cette fiche a changé. Actualise le carnet avant de la supprimer.",
      });
    res.json({ ok: true });
  });
  app.get("/api/export", (req, res) =>
    res.json({
      format: "caderno",
      version: 2,
      verbs: readVerbs(),
      exportedAt: new Date().toISOString(),
      entries: readEntries(),
    }),
  );
  app.post("/api/import", (req, res) => {
    const incoming = z
      .object({
        format: z.literal("caderno"),
        version: z.union([z.literal(1), z.literal(2)]),
        verbs: z.array(customVerbSchema).max(2000).default([]),
        entries: z.array(entrySchema).max(2000),
      })
      .parse(req.body);
    const keys = new Set(
      readEntries().map(
        (e) => `${e.pt.toLocaleLowerCase()}|${e.fr.toLocaleLowerCase()}`,
      ),
    );
    let added = 0,
      verbsAdded = 0;
    db.exec("BEGIN");
    try {
      for (const e of incoming.entries) {
        const key = `${e.pt.toLocaleLowerCase()}|${e.fr.toLocaleLowerCase()}`;
        if (keys.has(key)) continue;
        db.prepare("INSERT INTO entries VALUES (?,?,1,?)").run(
          randomUUID(),
          JSON.stringify(e),
          new Date().toISOString(),
        );
        keys.add(key);
        added++;
      }
      for (const verb of incoming.verbs) {
        const key = verbKey(verb.pt);
        if (existingVerb(key)) continue;
        db.prepare("INSERT INTO verbs VALUES (?,?)").run(
          key,
          JSON.stringify(verb),
        );
        verbsAdded++;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({ added, verbsAdded });
  });
  const today = () => new Date().toISOString().slice(0, 10);
  const quota = () => ({
    used:
      db.prepare("SELECT count FROM usage WHERE day=?").get(today())?.count ||
      0,
    limit: 4500,
  });
  app.get("/api/usage", (req, res) => res.json(quota()));
  const inflight = new Map();
  app.post("/api/translate", async (req, res) => {
    const { text, direction } = z
      .object({
        text: z.string().trim().min(1).max(500),
        direction: z.enum(["fr-pt", "pt-fr"]),
      })
      .parse(req.body);
    if (Buffer.byteLength(text, "utf8") > 500)
      return res.status(400).json({
        error:
          "Cette phrase est trop longue. Essaie une phrase plus courte (500 octets maximum).",
      });
    const key = hash(`${direction}:${text}`),
      cached = db
        .prepare("SELECT result FROM translations WHERE key=?")
        .get(key);
    if (cached)
      return res.json({ text: cached.result, cached: true, quota: quota() });
    if (inflight.has(key))
      return res.status(409).json({
        error: "Cette traduction est déjà en cours. Patiente un instant.",
      });
    if (quota().used + text.length > 4500)
      return res.status(429).json({
        error:
          "Limite quotidienne atteinte. Le carnet et les verbes restent disponibles. Réessaie demain (remise à zéro à 00 h UTC).",
      });
    db.prepare(
      "INSERT INTO usage VALUES (?,?) ON CONFLICT(day) DO UPDATE SET count=count+excluded.count",
    ).run(today(), text.length);
    inflight.set(key, true);
    try {
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", text);
      url.searchParams.set(
        "langpair",
        direction === "fr-pt" ? "fr|pt-BR" : "pt-BR|fr",
      );
      const response = await translateFetch(url, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("upstream");
      const result = await response.json();
      if (
        Number(result.responseStatus) !== 200 ||
        result.quotaFinished ||
        typeof result.responseData?.translatedText !== "string"
      )
        throw new Error("upstream");
      const translated = he.decode(result.responseData.translatedText).trim();
      if (!translated || translated.length > 2000) throw new Error("upstream");
      db.prepare("INSERT OR REPLACE INTO translations VALUES (?,?)").run(
        key,
        translated,
      );
      res.json({ text: translated, cached: false, quota: quota() });
    } catch {
      res.status(502).json({
        error:
          "Le service gratuit est indisponible ou sa limite est atteinte. Réessaie plus tard ; tu peux toujours ajouter une fiche manuellement.",
      });
    } finally {
      inflight.delete(key);
    }
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Route inconnue." }),
  );
  app.use(express.static(resolve("dist"), { index: false }));
  app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
  app.use((error, req, res, next) => {
    if (error instanceof ConjugationError)
      return res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError || error.status === 400)
      return res.status(400).json({
        error:
          "Vérifie les champs : certains sont vides, invalides ou trop longs.",
      });
    if (error.status === 413)
      return res
        .status(413)
        .json({ error: "Le fichier est trop volumineux (2 Mo maximum)." });
    console.error("Erreur serveur:", error.message);
    res
      .status(500)
      .json({ error: "Impossible de terminer cette action. Réessaie." });
  });
  return { app, db };
}
