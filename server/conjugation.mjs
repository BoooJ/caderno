import he from "he";
import { z } from "zod";

export const verbKey = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const infinitive = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(35)
  .regex(/^[a-záâãàéêíóôõúüç]+$/u);
const form = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{M}\s/\-]+$/u);
export const customVerbSchema = z
  .object({
    pt: infinitive,
    fr: z.string().trim().min(1).max(120),
    present: z.array(form).length(5),
    past: z.array(form).length(5),
    imperfect: z.array(form).length(5),
    irregular: z.boolean(),
    hint: z.string().max(1000).default(""),
    example: z.string().max(1000).default(""),
    verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z
      .string()
      .regex(/^https:\/\/www\.conjugacao\.com\.br\/verbo-[a-z]+\/$/),
    custom: z.literal(true),
  })
  .refine(
    (v) => v.source === `https://www.conjugacao.com.br/verbo-${verbKey(v.pt)}/`,
  );
export const verbRequestSchema = z.object({
  pt: infinitive,
  fr: z.string().trim().min(1).max(120),
});
export class ConjugationError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
const incomplete = () =>
  new ConjugationError(
    "Les formes complètes de ce verbe ne sont pas disponibles. Rien n’a été ajouté. Essaie un infinitif simple, sans « -se ».",
    422,
  );
const strip = (html) =>
  he
    .decode(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

export function parseConjugation(html, requested) {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!heading) throw incomplete();
  const pt = strip(heading[1])
    .replace(/^Verbo\s+/i, "")
    .toLowerCase();
  if (!infinitive.safeParse(pt).success || verbKey(pt) !== verbKey(requested))
    throw incomplete();
  const data = {
    pt,
    source: `https://www.conjugacao.com.br/verbo-${verbKey(pt)}/`,
    verifiedAt: new Date().toISOString().slice(0, 10),
    hint: "",
    example: "",
    custom: true,
  };
  const kind = html.match(/Tipo de verbo<\/strong>:\s*([^<]+)/i);
  if (!kind) throw incomplete();
  data.irregular = /\birregular\b/i.test(kind[1]);
  // Only the first indicative tables, never the later pronominal or clitic tables.
  const indicative = html.split(/<h3[^>]*>Subjuntivo<\/h3>/i)[0];
  for (const [key, label] of [
    ["present", "Presente"],
    ["past", "Pretérito Perfeito"],
    ["imperfect", "Pretérito Imperfeito"],
  ]) {
    const table = indicative.match(
      new RegExp(
        `<h4\\b[^>]*>\\s*${label}\\s*</h4>\\s*<p>([\\s\\S]*?)</p>`,
        "i",
      ),
    );
    if (!table) throw incomplete();
    const rows = table[1]
      .split(/<br\s*\/?\s*>/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (rows.length !== 6) throw incomplete();
    const forms = rows.map((row, i) => {
      const pronoun = row.match(
        /<span\b[^>]*>\s*<span\b[^>]*>([^<]+)<\/span>/i,
      );
      if (
        !pronoun ||
        strip(pronoun[1]) !== ["eu", "tu", "ele", "nós", "vós", "eles"][i]
      )
        throw incomplete();
      const spans = [
        ...row.matchAll(
          /<span\b[^>]*class=["']f(?:\s+[^"']*)?["'][^>]*>([\s\S]*?)<\/span>/gi,
        ),
      ];
      if (spans.length !== 1) throw incomplete();
      const value = strip(spans[0][1]);
      if (!form.safeParse(value).success || value === "-") throw incomplete();
      return value;
    });
    data[key] = [0, 1, 2, 3, 5].map((i) => forms[i]);
  }
  return data;
}

export async function fetchConjugation(pt, fetcher = fetch) {
  const source = `https://www.conjugacao.com.br/verbo-${verbKey(pt)}/`;
  try {
    const response = await fetcher(source, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404)
      throw new ConjugationError(
        "Verbe introuvable. Vérifie l’infinitif portugais, par exemple « dirigir ».",
        404,
      );
    if (!response.ok) throw new Error("upstream");
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new Error("oversize");
      }
      chunks.push(Buffer.from(value));
    }
    return parseConjugation(Buffer.concat(chunks).toString("utf8"), pt);
  } catch (error) {
    if (error instanceof ConjugationError) throw error;
    throw new ConjugationError(
      "La source de conjugaison est momentanément indisponible. Réessaie plus tard ; tes verbes enregistrés restent accessibles.",
    );
  }
}
