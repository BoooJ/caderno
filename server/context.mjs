import he from "he";
import { createHash } from "node:crypto";
import { z } from "zod";

const clean = (html) =>
  he
    .decode(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
const slug = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const simpleWord = /^[\p{L}]+(?:-[\p{L}]+)?$/u;
export function parseSynonyms(html) {
  const groups = [];
  const pattern =
    /<div class="content-detail--subtitle">([\s\S]*?)<\/div>\s*<p class="syn-list[^"<>]*">([\s\S]*?)<\/p>/g;
  for (const match of html.matchAll(pattern)) {
    const words = [
      ...match[2].matchAll(/<a\b[^>]*class="sinonimo"[^>]*>([^<]+)<\/a>/g),
    ]
      .map((m) => clean(m[1]))
      .filter((w) => w.length < 60 && /^[\p{L}\s-]+$/u.test(w));
    const sense = clean(match[1]);
    if (words.length && sense.length <= 200)
      groups.push({ sense, words: [...new Set(words)].slice(0, 4) });
    if (groups.length === 2) break;
  }
  return groups;
}
const sentenceSchema = z.object({
  id: z.number().int().positive(),
  text: z.string().min(1).max(400),
  lang: z.enum(["por", "fra"]),
  owner: z.string().min(1).max(100),
  license: z.enum(["CC BY 2.0 FR", "CC0 1.0", "CC0"]),
  is_unapproved: z.literal(false),
});
export function parseExamples(json) {
  if (!Array.isArray(json.data)) throw new Error("Invalid sentence response");
  const examples = [];
  const seen = new Set();
  for (const row of json.data) {
    const main = sentenceSchema.safeParse(row);
    if (!main.success || !Array.isArray(row.translations)) continue;
    const other = row.translations.find(
      (t) =>
        t.is_direct === true &&
        t.lang !== main.data.lang &&
        sentenceSchema.safeParse(t).success,
    );
    if (!other) continue;
    const pt =
      main.data.lang === "por" ? main.data : sentenceSchema.parse(other);
    const fr =
      main.data.lang === "fra" ? main.data : sentenceSchema.parse(other);
    if (seen.has(pt.text)) continue;
    seen.add(pt.text);
    examples.push({
      pt: pt.text,
      fr: fr.text,
      ptId: pt.id,
      frId: fr.id,
      ptAuthor: pt.owner,
      frAuthor: fr.owner,
      ptLicense: pt.license,
      frLicense: fr.license,
    });
    if (examples.length === 3) break;
  }
  return examples;
}
async function readLimited(response) {
  if (!response.ok) throw new Error("Provider unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 1024 * 1024) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function installContext(app, db, fetcher = fetch) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS learning_context (key TEXT PRIMARY KEY, body TEXT NOT NULL, expires INTEGER NOT NULL)",
  );
  let attempts = [];
  const pending = new Map();
  async function cached(key, loader) {
    const found = db
      .prepare("SELECT body FROM learning_context WHERE key=? AND expires>?")
      .get(key, Date.now());
    if (found) return { ...JSON.parse(found.body), cached: true };
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const data = await loader();
      if (data.status !== "unavailable") {
        db.prepare("DELETE FROM learning_context WHERE expires<?").run(
          Date.now(),
        );
        db.prepare("INSERT OR REPLACE INTO learning_context VALUES(?,?,?)").run(
          key,
          JSON.stringify(data),
          Date.now() + (data.status === "ready" ? 7 * 86400000 : 3600000),
        );
      }
      return data;
    })();
    pending.set(key, task);
    try {
      return await task;
    } finally {
      pending.delete(key);
    }
  }
  app.post("/api/context", async (req, res) => {
    const { pt, query, language } = z
      .object({
        pt: z.string().trim().min(1).max(2000),
        query: z.string().trim().min(1).max(500),
        language: z.enum(["fr", "pt"]),
      })
      .parse(req.body);
    attempts = attempts.filter((t) => Date.now() - t < 60000);
    if (attempts.length >= 20)
      return res
        .status(429)
        .json({
          error: "Patiente une minute avant de chercher d’autres exemples.",
        });
    attempts.push(Date.now());
    const word = pt
      .trim()
      .replace(/[.!?]+$/, "")
      .toLowerCase();
    const options = () => ({
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    const synonymTask = async () => {
      if (word.length > 50 || !simpleWord.test(word))
        return { status: "unsupported", groups: [] };
      const source = `https://www.sinonimos.com.br/${slug(word)}/`;
      return cached("syn:" + slug(word), async () => {
        try {
          const response = await fetcher(source, options());
          if (response.status === 404)
            return { status: "empty", groups: [], source };
          const groups = parseSynonyms(await readLimited(response));
          return { status: groups.length ? "ready" : "empty", groups, source };
        } catch {
          return { status: "unavailable", groups: [], source };
        }
      });
    };
    const exampleTask = async () => {
      const words = query.match(/[\p{L}\p{M}]+/gu) || [];
      if (!words.length || words.length > 8 || query.length > 100)
        return { status: "unsupported", items: [] };
      const search = words.join(" ");
      const key = createHash("sha256")
        .update(language + ":" + search.toLowerCase())
        .digest("hex");
      return cached("ex:" + key, async () => {
        try {
          const url = new URL("https://api.tatoeba.org/v1/sentences");
          for (const [k, v] of Object.entries({
            lang: language === "pt" ? "por" : "fra",
            q: `"${search}"`,
            "trans:lang": language === "pt" ? "fra" : "por",
            "trans:is_direct": "yes",
            is_unapproved: "no",
            is_orphan: "no",
            "trans:is_unapproved": "no",
            "trans:is_orphan": "no",
            word_count: "3-18",
            limit: "12",
            sort: "relevance",
          }))
            url.searchParams.set(k, v);
          const items = parseExamples(
            JSON.parse(await readLimited(await fetcher(url, options()))),
          );
          return { status: items.length ? "ready" : "empty", items };
        } catch {
          return { status: "unavailable", items: [] };
        }
      });
    };
    const [synonyms, examples] = await Promise.all([
      synonymTask(),
      exampleTask(),
    ]);
    res.json({ synonyms, examples });
  });
}
