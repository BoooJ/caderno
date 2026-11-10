import { test } from "node:test";
import assert from "node:assert/strict";
import { verbs, futureAuxiliary, normalize } from "../src/verbs.ts";

test("catalogue : 60 verbes uniques, trois temps complets et aucun texte corrompu", () => {
  assert.equal(verbs.length, 60);
  assert.equal(new Set(verbs.map((v) => v.pt)).size, 60);
  for (const v of verbs) {
    assert.ok(v.fr.trim() && v.hint.trim() && v.example.trim(), v.pt);
    assert.ok(!JSON.stringify(v).includes("\uFFFD"), v.pt);
    for (const tense of ["present", "past", "imperfect"]) {
      assert.equal(v[tense].length, 5, `${v.pt} ${tense}`);
      assert.ok(
        v[tense].every((form) => form.trim() && !/[<>]/.test(form)),
        `${v.pt} ${tense}`,
      );
    }
  }
});
test("irréguliers et graphies distinctives : passé, accents et radical", () => {
  const byName = (pt) => verbs.find((v) => v.pt === pt);
  for (const [pt, tense, index, expected] of [
    ["querer", "past", 0, "quis"],
    ["poder", "past", 2, "pôde"],
    ["poder", "present", 2, "pode"],
    ["vir", "past", 0, "vim"],
    ["ver", "past", 0, "vi"],
    ["dizer", "past", 4, "disseram"],
    ["conseguir", "present", 0, "consigo"],
    ["dormir", "present", 0, "durmo"],
    ["ler", "present", 4, "leem"],
    ["começar", "past", 0, "comecei"],
    ["pagar", "past", 0, "paguei"],
    ["ter", "present", 4, "têm"],
    ["sair", "past", 0, "saí"],
    ["saber", "past", 0, "soube"],
  ])
    assert.equal(byName(pt)[tense][index], expected, `${pt} ${tense}`);
});
test("le futur proche utilise ir même après le tri alphabétique", () => {
  assert.equal(verbs[0].pt, "abrir");
  assert.deepEqual(futureAuxiliary, ["vou", "vais", "vai", "vamos", "vão"]);
  assert.equal(
    `${futureAuxiliary[0]} ${verbs.find((v) => v.pt === "aprender").pt}`,
    "vou aprender",
  );
  assert.equal(normalize("começar"), "comecar");
});
