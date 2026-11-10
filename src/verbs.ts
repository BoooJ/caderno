import builtinVerbs from "../shared/verbs.json" with { type: "json" };

export type Verb = {
  pt: string;
  fr: string;
  irregular: boolean;
  source?: string;
  verifiedAt?: string;
  custom?: boolean;
  hint: string;
  example: string;
  present: string[];
  past: string[];
  imperfect: string[];
};
export const verbs: Verb[] = builtinVerbs;
export const futureAuxiliary = verbs.find((verb) => verb.pt === "ir")!.present;
export const starters = [
  {
    pt: "Tudo bem?",
    fr: "Ça va ?",
    kind: "expression" as const,
    example: "Oi! Tudo bem com você?",
    note: "Une manière courante de saluer quelqu’un.",
  },
  {
    pt: "saudade",
    fr: "manque, nostalgie",
    kind: "mot" as const,
    example: "Estou com saudade de você.",
    note: "Le manque d’une personne, d’un lieu ou d’un moment.",
  },
  {
    pt: "Pode repetir?",
    fr: "Tu peux répéter ?",
    kind: "expression" as const,
    example: "Desculpa, pode repetir mais devagar?",
    note: "À garder sous la main dans une conversation.",
  },
  {
    pt: "ficar à vontade",
    fr: "se mettre à l’aise",
    kind: "expression" as const,
    example: "Pode entrar, fique à vontade!",
    note: "Une invitation à se sentir chez soi.",
  },
];
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
